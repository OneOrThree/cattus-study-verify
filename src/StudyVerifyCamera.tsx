import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTensorflowModel } from 'react-native-fast-tflite';
import {
  NativePreviewView,
  useCamera,
  useFrameOutput,
  usePreviewOutput,
  type Frame,
} from 'react-native-vision-camera';
import { useResizer } from 'react-native-vision-camera-resizer';
import { createSynchronizable, scheduleOnRN } from 'react-native-worklets';

import {
  LIVE_SAMPLE_MS,
  LIVE_STALE_MS,
  MEASUREMENT_BATCH_SIZE,
  MEASUREMENT_CAPTURE_TIMEOUT_MS,
  MEASUREMENT_INTERVAL_MS,
  MEASUREMENT_STALE_MS,
  type VerificationCadence,
} from './cadence';
import { focusDetection, type VerificationDetection } from './detection';
import {
  OBJECT_INPUT,
  objectScoreIndex,
  studyObjectPresence,
  studyObjectScores,
  type StudyObjectPresence,
  type StudyObjectScores,
} from './objects';
import { PALM_INPUT, maxSigmoid, scoreTensorIndex } from './palm';
import type { VerificationCameraPosition } from './types';

export const PREVIEW_SAMPLE_MS = LIVE_SAMPLE_MS;
export const PREVIEW_STALE_MS = LIVE_STALE_MS;
const PREVIEW_RESOLUTION = { width: 640, height: 480 };
const LOG = '[cattus-study-verify]';

type Samples = {
  lastAt: number;
  scores: number[];
  objects: (StudyObjectScores | null)[];
  startedAt: number;
  complete: boolean;
};
const emptySamples = (): Samples => {
  'worklet';
  return { lastAt: 0, scores: [], objects: [], startedAt: 0, complete: false };
};

export type StudyVerifyCameraProps = {
  /** Which camera to open. */
  position: VerificationCameraPosition;
  /** When false the component renders nothing and opens no camera. */
  active: boolean;
  /**
   * When false the component shows the camera preview only: no model, no resizer, no frame
   * output and no timers are created. Default true.
   */
  measurementEnabled?: boolean;
  /**
   * Show the camera preview. When false the camera still runs for measurement, without a
   * visible view. Default true.
   */
  previewVisible?: boolean;
  /**
   * `'live'` samples every 300 ms and keeps the camera running. `'periodic'` judges an
   * independent batch of three frames every 20 seconds and rests the camera in between.
   * Default `'live'`.
   */
  cadence?: VerificationCadence;
  /** The first analysis frame arrived (the camera is working). Not a detection result. */
  onReady: () => void;
  /** The camera stopped or was interrupted; no frames are arriving. */
  onPaused: () => void;
  /** Every new decision, including `'checking'` and `'unavailable'`. */
  onDetection: (detection: VerificationDetection) => void;
  /** Per-object presence over the latest three frames, or null when unknown. */
  onStudyObjects?: (objects: StudyObjectPresence | null) => void;
  /** A camera error reported by VisionCamera. */
  onError: (error: unknown) => void;
};

/**
 * Opens the camera and judges the frames of the same capture session that feeds the
 * preview. It creates no photo or video file and sends nothing off the device.
 */
export function StudyVerifyCamera({
  active,
  measurementEnabled = true,
  ...props
}: StudyVerifyCameraProps) {
  if (!active) return null;
  if (!measurementEnabled)
    return props.previewVisible === false ? null : <PreviewCamera {...props} />;
  return <LiveVerificationCamera {...props} />;
}

/** With measurement off, no model, resizer or analysis frame output is created. */
function PreviewCamera({
  position,
  onError,
}: Pick<StudyVerifyCameraProps, 'position' | 'onError'>) {
  const previewOutput = usePreviewOutput();
  const outputs = useMemo(() => [previewOutput], [previewOutput]);
  useCamera({ device: position, isActive: true, outputs, onError });
  return <CameraPreview output={previewOutput} />;
}

function CameraPreview({ output }: { output: ReturnType<typeof usePreviewOutput> }) {
  return (
    <View testID="study-verify-camera-preview" style={StyleSheet.absoluteFill}>
      <NativePreviewView
        style={StyleSheet.absoluteFill}
        previewOutput={output}
        resizeMode="contain"
      />
    </View>
  );
}

function LiveVerificationCamera({
  position,
  previewVisible = true,
  cadence = 'live',
  onReady,
  onPaused,
  onDetection,
  onStudyObjects,
  onError,
}: Omit<StudyVerifyCameraProps, 'active' | 'measurementEnabled'>) {
  const model = useTensorflowModel(require('../assets/palm_detection_lite.tflite'), []);
  // The palm model takes float32 RGB in 0..1. The resizer produces exactly that format on
  // the GPU, so no per-frame conversion runs in JS.
  const resize = useResizer({
    width: PALM_INPUT,
    height: PALM_INPUT,
    channelOrder: 'rgb',
    dataType: 'float32',
    scaleMode: 'contain',
    pixelLayout: 'interleaved',
  });
  const objectModel = useTensorflowModel(require('../assets/efficientdet_lite0_int8.tflite'), []);
  const objectResize = useResizer({
    width: OBJECT_INPUT,
    height: OBJECT_INPUT,
    channelOrder: 'rgb',
    dataType: 'uint8',
    scaleMode: 'contain',
    pixelLayout: 'interleaved',
  });
  const objectTflite = objectModel.state === 'loaded' ? objectModel.model : undefined;
  const objectIdx = objectTflite ? objectScoreIndex(objectTflite.inputs, objectTflite.outputs) : -1;
  const objectResizer = objectResize.resizer;
  const tflite = model.state === 'loaded' ? model.model : undefined;
  const scoreIdx = tflite ? scoreTensorIndex(tflite.outputs) : -1;
  const resizer = resize.resizer;
  const samples = useMemo(() => createSynchronizable<Samples>(emptySamples()), []);
  const captureEpoch = useMemo(() => createSynchronizable(0), []);
  const interrupted = useMemo(() => createSynchronizable(false), []);
  const mounted = useRef(true);
  const lastResult = useRef(0);
  const lastDetection = useRef<VerificationDetection>('checking');
  const lastError = useRef('');
  const lastObjects = useRef('');
  const objectsCallback = useRef(onStudyObjects);
  // Latest-callback ref: lets `reportObjects` keep a stable identity.
  // eslint-disable-next-line react-hooks/refs
  objectsCallback.current = onStudyObjects;
  const reportObjects = useCallback((presence: StudyObjectPresence | null) => {
    objectsCallback.current?.(presence);
  }, []);
  const frameReady = useRef(false);
  const periodic = cadence === 'periodic';
  const staleMs = periodic ? MEASUREMENT_STALE_MS : PREVIEW_STALE_MS;
  const [sampling, setSampling] = useState(true);
  const samplingRef = useRef(true);
  const wakeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    captureEpoch.setBlocking(captureEpoch.getBlocking() + 1);
    samples.setBlocking(emptySamples());
    samplingRef.current = true;
    // A new cadence starts a new capture, so the sampling state resets here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSampling(true);
    lastResult.current = 0;
    onDetection('checking');
    reportObjects(null);
    return () => {
      if (wakeTimer.current) clearTimeout(wakeTimer.current);
    };
  }, [periodic, samples, captureEpoch, onDetection, reportObjects]);

  useEffect(() => {
    mounted.current = true;
    const timer = setInterval(
      () => {
        if (lastResult.current && Date.now() - lastResult.current >= staleMs) {
          lastResult.current = 0;
          onDetection('checking');
          reportObjects(null);
        }
      },
      periodic ? 1000 : PREVIEW_SAMPLE_MS
    );
    return () => {
      mounted.current = false;
      clearInterval(timer);
    };
  }, [onDetection, reportObjects, staleMs, periodic]);

  useEffect(() => {
    if (
      model.state === 'error' ||
      resize.state === 'error' ||
      (tflite && scoreIdx < 0) ||
      objectModel.state === 'error' ||
      objectResize.state === 'error' ||
      (objectTflite && objectIdx < 0)
    ) {
      onDetection('unavailable');
    }
  }, [
    model.state,
    resize.state,
    tflite,
    scoreIdx,
    objectModel.state,
    objectResize.state,
    objectTflite,
    objectIdx,
    onDetection,
  ]);

  const receiveScores = useCallback(
    (
      epoch: number,
      scores: number[] | null,
      error = '',
      startedAt = Date.now(),
      objects: (StudyObjectScores | null)[] = []
    ) => {
      if (
        !mounted.current ||
        epoch !== captureEpoch.getBlocking() ||
        (interrupted.getBlocking() && scores !== null) ||
        (periodic && !samplingRef.current)
      )
        return;
      if (scores && !frameReady.current) {
        frameReady.current = true;
        onReady();
        if (__DEV__) console.log(LOG, 'measurement frames started');
      }
      lastResult.current = scores ? Date.now() : 0;
      const detection = focusDetection(scores, objects);
      if (__DEV__ && error && error !== lastError.current) {
        console.warn(LOG, 'inference failed', error);
      }
      if (__DEV__ && detection !== lastDetection.current) {
        console.log(LOG, 'detection', detection);
      }
      lastError.current = error;
      lastDetection.current = detection;
      onDetection(detection);
      reportObjects(studyObjectPresence(objects));
      if (__DEV__ && objects.length === MEASUREMENT_BATCH_SIZE) {
        const evidence = JSON.stringify(studyObjectPresence(objects));
        if (evidence !== lastObjects.current) console.log(LOG, 'object evidence', evidence);
        lastObjects.current = evidence;
      }
      if (periodic) {
        // Stop inference between checks, and stop the camera too when there is no preview.
        samplingRef.current = false;
        setSampling(false);
        if (wakeTimer.current) clearTimeout(wakeTimer.current);
        wakeTimer.current = setTimeout(
          () => {
            captureEpoch.setBlocking(captureEpoch.getBlocking() + 1);
            interrupted.setBlocking(false);
            samples.setBlocking(emptySamples());
            samplingRef.current = true;
            setSampling(true);
          },
          Math.max(0, MEASUREMENT_INTERVAL_MS - (Date.now() - startedAt))
        );
      }
    },
    [onDetection, reportObjects, onReady, periodic, samples, captureEpoch, interrupted]
  );

  const onFrame = useCallback(
    (frame: Frame) => {
      'worklet';
      const epoch = captureEpoch.getBlocking();
      try {
        if (interrupted.getBlocking()) return;
        if (!tflite || !resizer || scoreIdx < 0) return;
        const previous = samples.getBlocking();
        const now = Date.now();
        if (periodic && previous.complete) return;
        if (now - previous.lastAt < PREVIEW_SAMPLE_MS) return;
        samples.setBlocking({ ...previous, lastAt: now });
        const resized = resizer.resize(frame);
        let outputs: ArrayBuffer[];
        try {
          // Pass the buffer straight in while it is alive. No JS-side conversion of the
          // 192x192x3 values runs for each decision.
          outputs = tflite.runSync([resized.getPixelBuffer()]);
        } finally {
          resized.dispose();
        }
        const score = maxSigmoid(new Float32Array(outputs[scoreIdx]!));
        const recent = now - previous.lastAt >= PREVIEW_STALE_MS ? [] : previous.scores;
        const scores = [...recent, score].slice(-MEASUREMENT_BATCH_SIZE);
        const startedAt = recent.length ? previous.startedAt : now;
        const complete = periodic && scores.length === MEASUREMENT_BATCH_SIZE;
        // Keep the hand and object results of one frame paired. A failed object result
        // must not let the hand alone pass.
        let objectScore: StudyObjectScores | null = null;
        if (objectTflite && objectResizer && objectIdx >= 0) {
          try {
            const objectFrame = objectResizer.resize(frame);
            try {
              // The model input is uint8 RGB. Run it while the buffer is alive, with no
              // float normalisation.
              const result = objectTflite.runSync([objectFrame.getPixelBuffer()]);
              objectScore = studyObjectScores(new Float32Array(result[objectIdx]!));
            } finally {
              objectFrame.dispose();
            }
          } catch {
            // Leave null in this frame's slot, so the error is not mixed with the hand of another frame.
          }
        }
        const objects = [...(recent.length ? previous.objects : []), objectScore].slice(
          -MEASUREMENT_BATCH_SIZE
        );
        if (epoch !== captureEpoch.getBlocking() || interrupted.getBlocking()) return;
        samples.setBlocking({ lastAt: now, scores, objects, startedAt, complete });
        // A periodic check reports only when three frames are in. The first two frames
        // do not clear the previous decision.
        if (!periodic || complete)
          scheduleOnRN(receiveScores, epoch, scores, '', startedAt, objects);
      } catch (error) {
        if (epoch !== captureEpoch.getBlocking() || interrupted.getBlocking()) return;
        samples.setBlocking({ ...emptySamples(), lastAt: Date.now(), complete: periodic });
        scheduleOnRN(receiveScores, epoch, null, String(error));
      } finally {
        frame.dispose();
      }
    },
    [
      tflite,
      resizer,
      scoreIdx,
      samples,
      captureEpoch,
      interrupted,
      receiveScores,
      periodic,
      objectTflite,
      objectResizer,
      objectIdx,
    ]
  );

  // The iOS resizer accepts only full-range (420f) input, while the native default can be
  // video-range (420v), so request the format explicitly.
  const frameOutput = useFrameOutput({
    onFrame,
    targetResolution: PREVIEW_RESOLUTION,
    pixelFormat: 'yuv',
    // On iOS 26+, a frame output that waits for the preview gets no frames when no preview
    // is shown, and the check would never run.
    allowDeferredStart: false,
  });
  // Keep the preview output and attach or detach only the view. Showing and hiding the
  // preview does not rebuild the measurement session.
  const previewOutput = usePreviewOutput();
  const outputs = useMemo(() => [frameOutput, previewOutput], [frameOutput, previewOutput]);
  useCamera({
    device: position,
    isActive: previewVisible || sampling,
    outputs,
    onStarted: () => {
      if (__DEV__ && mounted.current) console.log(LOG, 'capture started', cadence);
    },
    onStopped: () => {
      if (!mounted.current) return;
      captureEpoch.setBlocking(captureEpoch.getBlocking() + 1);
      frameReady.current = false;
      if (__DEV__)
        console.log(
          LOG,
          'capture stopped',
          periodic && !samplingRef.current ? 'between checks' : 'paused'
        );
      if (!periodic || samplingRef.current) onPaused();
    },
    onInterruptionStarted: () => {
      if (!mounted.current) return;
      captureEpoch.setBlocking(captureEpoch.getBlocking() + 1);
      interrupted.setBlocking(true);
      frameReady.current = false;
      lastResult.current = 0;
      samples.setBlocking(emptySamples());
      onDetection('checking');
      reportObjects(null);
      onPaused();
    },
    onInterruptionEnded: () => {
      if (!mounted.current) return;
      captureEpoch.setBlocking(captureEpoch.getBlocking() + 1);
      samples.setBlocking(emptySamples());
      interrupted.setBlocking(false);
    },
    onError,
  });
  useEffect(() => {
    if (!periodic || !sampling) return;
    // Bound the check time, so the camera does not stay on when no frames arrive.
    const timeout = setTimeout(
      () => receiveScores(captureEpoch.getBlocking(), null, 'measurement frames timed out'),
      MEASUREMENT_CAPTURE_TIMEOUT_MS
    );
    return () => clearTimeout(timeout);
  }, [periodic, sampling, receiveScores, captureEpoch]);
  useEffect(() => {
    if (__DEV__) console.log(LOG, 'preview visible', previewVisible);
  }, [previewVisible]);
  if (!previewVisible) return null;
  return <CameraPreview output={previewOutput} />;
}
