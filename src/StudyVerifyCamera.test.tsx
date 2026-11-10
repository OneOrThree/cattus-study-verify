import { act, render } from '@testing-library/react-native';
import { useTensorflowModel } from 'react-native-fast-tflite';
import { useCamera, useFrameOutput, type Frame } from 'react-native-vision-camera';
import { useResizer } from 'react-native-vision-camera-resizer';
import { scheduleOnRN } from 'react-native-worklets';

import { PREVIEW_SAMPLE_MS, PREVIEW_STALE_MS, StudyVerifyCamera } from './StudyVerifyCamera';
import { MEASUREMENT_INTERVAL_MS, MEASUREMENT_STALE_MS } from './cadence';

jest.mock('../assets/palm_detection_lite.tflite', () => 1, { virtual: true });
jest.mock('../assets/efficientdet_lite0_int8.tflite', () => 2, { virtual: true });
jest.mock('react-native-vision-camera-resizer', () => ({ useResizer: jest.fn() }));
jest.mock('react-native-fast-tflite', () => ({ useTensorflowModel: jest.fn() }));
jest.mock('react-native-worklets', () => ({
  createSynchronizable: jest.fn((value) => {
    let current = value;
    return {
      getBlocking: () => current,
      setBlocking: (next: unknown) => {
        current = typeof next === 'function' ? next(current) : next;
      },
    };
  }),
  scheduleOnRN: jest.fn((fn, ...args) => fn(...args)),
}));
jest.mock('react-native-vision-camera', () => ({
  useCamera: jest.fn(),
  usePreviewOutput: jest.fn(() => ({})),
  NativePreviewView: (props: object) =>
    require('react').createElement(require('react-native').View, {
      ...props,
      testID: 'native-camera',
    }),
  useFrameOutput: jest.fn(() => ({})),
}));

const runSync = jest.fn();
const objectRunSync = jest.fn();
const objectDispose = jest.fn();
const objectResized = {
  getPixelBuffer: jest.fn(() => new Uint8Array([255, 0, 127]).buffer),
  dispose: objectDispose,
};
const objectResize = jest.fn(() => objectResized);
const resizedDispose = jest.fn();
const resized = {
  getPixelBuffer: jest.fn(() => new Uint8Array([255, 0, 127]).buffer),
  dispose: resizedDispose,
};
const resize = jest.fn(() => resized);

// The component logs in development builds; keep the test output readable.
beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterAll(() => jest.restoreAllMocks());

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-10-30T00:00:00Z'));
  jest.clearAllMocks();
  resized.getPixelBuffer.mockImplementation(() => new Uint8Array([255, 0, 127]).buffer);
  resize.mockImplementation(() => resized);
  objectResize.mockImplementation(() => objectResized);
  const objectScores = new Float32Array(180);
  objectScores[83] = 0.9;
  objectRunSync.mockImplementation(() => [objectScores.buffer, new Float32Array(8).buffer]);
  jest.mocked(useResizer).mockImplementation(
    (options) =>
      ({
        state: 'ready',
        resizer: { resize: options.width === 320 ? objectResize : resize },
        error: undefined,
      }) as unknown as ReturnType<typeof useResizer>
  );
  jest.mocked(useTensorflowModel).mockReturnValue({
    state: 'loaded',
    model: {
      inputs: [{ shape: [1, 192, 192, 3], dataType: 'float32' }],
      outputs: [{ shape: [1, 2016, 18] }, { shape: [1, 2016, 1] }],
      runSync,
    },
  } as unknown as ReturnType<typeof useTensorflowModel>);
  enableObjects(objectRunSync);
});
afterEach(() => jest.useRealTimers());

async function setup(
  previewVisible = true,
  cadence: 'live' | 'periodic' = 'live',
  measurementEnabled = true
) {
  const onReady = jest.fn();
  const onPaused = jest.fn();
  const onDetection = jest.fn();
  const onError = jest.fn();
  const onStudyObjects = jest.fn();
  const screen = await render(
    <StudyVerifyCamera
      position="back"
      active
      measurementEnabled={measurementEnabled}
      previewVisible={previewVisible}
      cadence={cadence}
      onReady={onReady}
      onPaused={onPaused}
      onDetection={onDetection}
      onError={onError}
      onStudyObjects={onStudyObjects}
    />
  );
  return { ...screen, onReady, onPaused, onDetection, onError, onStudyObjects };
}

test('with measurement off, only the preview output is connected: no model, resizer, frame output or check timer', async () => {
  const screen = await setup(true, 'periodic', false);
  expect(screen.getByTestId('native-camera')).toBeTruthy();
  expect(jest.mocked(useCamera).mock.calls.at(-1)![0]).toMatchObject({
    isActive: true,
    device: 'back',
    outputs: [{}],
  });
  expect(useTensorflowModel).not.toHaveBeenCalled();
  expect(useResizer).not.toHaveBeenCalled();
  expect(useFrameOutput).not.toHaveBeenCalled();
  const cameraCalls = jest.mocked(useCamera).mock.calls.length;
  await act(async () => jest.advanceTimersByTime(60_000));
  expect(runSync).not.toHaveBeenCalled();
  expect(objectRunSync).not.toHaveBeenCalled();
  expect(screen.onDetection).not.toHaveBeenCalled();
  expect(useCamera).toHaveBeenCalledTimes(cameraCalls);
  const error = new Error('preview unavailable');
  await act(async () => jest.mocked(useCamera).mock.calls.at(-1)![0].onError!(error));
  expect(screen.onError).toHaveBeenCalledWith(error);
});

test('with measurement and preview both off, the camera is not configured either', async () => {
  const screen = await setup(false, 'periodic', false);
  expect(screen.queryByTestId('native-camera')).toBeNull();
  expect(useCamera).not.toHaveBeenCalled();
  expect(useTensorflowModel).not.toHaveBeenCalled();
  expect(useFrameOutput).not.toHaveBeenCalled();
});

test('turning measurement off while the preview is open drops the check timer and late results, and turning it on again starts a fresh batch of three', async () => {
  const screen = await setup(true, 'periodic');
  let deliver: (() => void) | undefined;
  jest.mocked(scheduleOnRN).mockImplementationOnce(((
    fn: (...args: unknown[]) => void,
    ...args: unknown[]
  ) => {
    deliver = () => fn(...args);
  }) as typeof scheduleOnRN);
  await sample(4);
  await sample(4);
  await sample(4);
  const props = {
    position: 'back' as const,
    active: true,
    previewVisible: true,
    cadence: 'periodic' as const,
    onReady: screen.onReady,
    onPaused: screen.onPaused,
    onDetection: screen.onDetection,
    onError: screen.onError,
  };
  await screen.rerender(<StudyVerifyCamera {...props} measurementEnabled={false} />);
  screen.onDetection.mockClear();
  const cameraCalls = jest.mocked(useCamera).mock.calls.length;
  await act(async () => {
    deliver!();
    jest.advanceTimersByTime(60_000);
  });
  expect(screen.getByTestId('native-camera')).toBeTruthy();
  expect(runSync).toHaveBeenCalledTimes(3);
  expect(objectRunSync).toHaveBeenCalledTimes(3);
  expect(screen.onDetection).not.toHaveBeenCalled();
  expect(useCamera).toHaveBeenCalledTimes(cameraCalls);
  await screen.rerender(<StudyVerifyCamera {...props} measurementEnabled />);
  await sample(4);
  await sample(4);
  expect(screen.onDetection).not.toHaveBeenCalledWith('focused');
  await sample(4);
  expect(screen.onDetection).toHaveBeenLastCalledWith('focused');
});

async function sample(rawScore: number, elapsed = PREVIEW_SAMPLE_MS) {
  await act(async () => jest.advanceTimersByTime(elapsed));
  runSync.mockReturnValue([new Float32Array(18).buffer, new Float32Array([rawScore]).buffer]);
  const dispose = jest.fn();
  const onFrame = jest.mocked(useFrameOutput).mock.calls.at(-1)![0].onFrame!;
  await act(async () => onFrame({ dispose } as unknown as Frame));
  expect(dispose).toHaveBeenCalledTimes(1);
}

test('the first camera frame and the three-frame decision are separate, and success needs a hand and a study object together in at least two frames', async () => {
  const screen = await setup();
  expect(screen.onReady).not.toHaveBeenCalled();
  expect(screen.onDetection).not.toHaveBeenCalledWith('focused');
  await sample(-4);
  expect(screen.onReady).toHaveBeenCalledTimes(1);
  await sample(-4);
  await sample(-4);
  expect(screen.onDetection).toHaveBeenLastCalledWith('missingHand');
  await sample(4);
  expect(screen.onDetection).toHaveBeenLastCalledWith('missingHand');
  await sample(4);
  expect(screen.onDetection).toHaveBeenLastCalledWith('focused');
  await sample(-4);
  await sample(-4);
  expect(screen.onDetection).toHaveBeenLastCalledWith('missingHand');
  expect(resizedDispose).toHaveBeenCalledTimes(7);
});

test('the palm model gets the float32 buffer of the resizer without a JS conversion, and the buffer is released after the run', async () => {
  await setup();
  expect(jest.mocked(useResizer).mock.calls.find(([o]) => o.width === 192)![0]).toMatchObject({
    channelOrder: 'rgb',
    dataType: 'float32',
  });
  const buffer = new Float32Array([1, 0, 0.5]).buffer;
  resized.getPixelBuffer.mockImplementation(() => buffer);
  await sample(4);
  expect(runSync).toHaveBeenCalledWith([buffer]);
  expect(resizedDispose).toHaveBeenCalledTimes(1);
  // Running the model after the buffer is released would read freed memory.
  expect(runSync.mock.invocationCallOrder[0]).toBeLessThan(
    resizedDispose.mock.invocationCallOrder[0]!
  );
});

test('a frame skipped to respect the sampling interval is still released', async () => {
  await setup();
  expect(jest.mocked(useFrameOutput).mock.calls.at(-1)![0]).toMatchObject({
    pixelFormat: 'yuv',
    allowDeferredStart: false,
  });
  await sample(4);
  await sample(4, 1);
  expect(runSync).toHaveBeenCalledTimes(1);
  expect(resizedDispose).toHaveBeenCalledTimes(1);
});

test('when frames stop, the success is cleared and old scores are not reused', async () => {
  const screen = await setup();
  await sample(4);
  await sample(4);
  await sample(4);
  expect(screen.onDetection).toHaveBeenLastCalledWith('focused');
  await act(async () => jest.advanceTimersByTime(PREVIEW_STALE_MS + PREVIEW_SAMPLE_MS));
  expect(screen.onDetection).toHaveBeenLastCalledWith('checking');
  await sample(-4);
  expect(screen.onDetection).toHaveBeenLastCalledWith('checking');
});

test('a conversion failure releases the source and intermediate buffers and does not count as success', async () => {
  const screen = await setup();
  resized.getPixelBuffer.mockImplementationOnce(() => {
    throw new Error('buffer unavailable');
  });
  await sample(4);
  expect(screen.onDetection).toHaveBeenLastCalledWith('unavailable');
  expect(resizedDispose).toHaveBeenCalledTimes(1);
  expect(runSync).not.toHaveBeenCalled();
});

test('a model loading failure is reported as unavailable, apart from camera readiness', async () => {
  jest
    .mocked(useTensorflowModel)
    .mockReturnValue({ state: 'error', model: undefined, error: new Error('model unavailable') });
  const screen = await setup();
  expect(screen.onDetection).toHaveBeenLastCalledWith('unavailable');
  await sample(4);
  expect(runSync).not.toHaveBeenCalled();
});

test('a late inference result after unmount is not delivered', async () => {
  const screen = await setup();
  screen.onDetection.mockClear();
  let deliver: (() => void) | undefined;
  jest.mocked(scheduleOnRN).mockImplementationOnce(((
    fn: (...args: unknown[]) => void,
    ...args: unknown[]
  ) => {
    deliver = () => fn(...args);
  }) as typeof scheduleOnRN);
  await sample(4);
  await screen.unmount();
  deliver!();
  expect(screen.onDetection).not.toHaveBeenCalled();
});

test('without a preview view, the frame output still runs and decides readiness and focus from real frames', async () => {
  const screen = await setup(false);
  expect(screen.queryByTestId('native-camera')).toBeNull();
  expect(jest.mocked(useCamera).mock.calls.at(-1)![0]).toMatchObject({
    isActive: true,
    device: 'back',
  });
  await sample(4);
  await sample(4);
  await sample(4);
  expect(screen.onReady).toHaveBeenCalledTimes(1);
  expect(screen.onDetection).toHaveBeenLastCalledWith('focused');
  expect(screen.onPaused).not.toHaveBeenCalled();
});

test('the periodic check judges an independent batch of three frames every 20 seconds and rests the camera when there is no preview', async () => {
  const screen = await setup(false, 'periodic');
  await sample(4);
  await sample(4);
  expect(screen.onDetection).not.toHaveBeenCalledWith('focused');
  await sample(4);
  expect(screen.onDetection).toHaveBeenLastCalledWith('focused');
  expect(runSync).toHaveBeenCalledTimes(3);
  let camera = jest.mocked(useCamera).mock.calls.at(-1)![0];
  expect(camera.isActive).toBe(false);
  await act(async () => camera.onStopped!());
  expect(screen.onPaused).not.toHaveBeenCalled();
  await sample(-4, 1000);
  expect(runSync).toHaveBeenCalledTimes(3);
  expect(screen.onDetection).toHaveBeenLastCalledWith('focused');
  // 20 seconds from the start of the first batch (300 ms). The 2 second stale rule does not apply before that.
  await act(async () => jest.advanceTimersByTime(MEASUREMENT_INTERVAL_MS - 1600));
  camera = jest.mocked(useCamera).mock.calls.at(-1)![0];
  expect(camera.isActive).toBe(true);
  expect(screen.onDetection).toHaveBeenLastCalledWith('focused');
  await sample(-4);
  await sample(-4);
  expect(screen.onDetection).toHaveBeenLastCalledWith('focused');
  await sample(-4);
  expect(runSync).toHaveBeenCalledTimes(6);
  expect(screen.onDetection).toHaveBeenLastCalledWith('missingHand');
  expect(jest.mocked(useCamera).mock.calls.at(-1)![0].isActive).toBe(false);
});

test('with a preview shown, the camera stays on but inference rests after three frames', async () => {
  const screen = await setup(true, 'periodic');
  await sample(4);
  await sample(4);
  await sample(4);
  expect(jest.mocked(useCamera).mock.calls.at(-1)![0].isActive).toBe(true);
  await sample(4, 1000);
  expect(runSync).toHaveBeenCalledTimes(3);
  expect(screen.onDetection).toHaveBeenLastCalledWith('focused');
});

test('when the next periodic check gets no frames, the previous success is not kept forever', async () => {
  const screen = await setup(false, 'periodic');
  await sample(4);
  await sample(4);
  await sample(4);
  await act(async () => jest.advanceTimersByTime(MEASUREMENT_STALE_MS + 1000));
  expect(screen.onDetection).toHaveBeenLastCalledWith('checking');
});

test('when the first check gets no frames for 5 seconds, the camera stops and the next cycle retries', async () => {
  const screen = await setup(false, 'periodic');
  await act(async () => jest.advanceTimersByTime(5000));
  expect(screen.onDetection).toHaveBeenLastCalledWith('unavailable');
  expect(jest.mocked(useCamera).mock.calls.at(-1)![0].isActive).toBe(false);
  const calls = jest.mocked(useCamera).mock.calls.length;
  const detections = screen.onDetection.mock.calls.length;
  await screen.unmount();
  await act(async () => jest.advanceTimersByTime(60000));
  expect(jest.mocked(useCamera).mock.calls).toHaveLength(calls);
  expect(screen.onDetection.mock.calls).toHaveLength(detections);
});

test('toggling the preview between checks neither pulls the check forward nor clears the decision', async () => {
  const screen = await setup(false, 'periodic');
  await sample(4);
  await sample(4);
  await sample(4);
  await screen.rerender(
    <StudyVerifyCamera
      position="back"
      active
      previewVisible
      cadence="periodic"
      onReady={screen.onReady}
      onPaused={screen.onPaused}
      onDetection={screen.onDetection}
      onError={screen.onError}
    />
  );
  expect(jest.mocked(useCamera).mock.calls.at(-1)![0].isActive).toBe(true);
  await sample(-4, 1000);
  expect(runSync).toHaveBeenCalledTimes(3);
  await screen.rerender(
    <StudyVerifyCamera
      position="back"
      active
      previewVisible={false}
      cadence="periodic"
      onReady={screen.onReady}
      onPaused={screen.onPaused}
      onDetection={screen.onDetection}
      onError={screen.onError}
    />
  );
  expect(jest.mocked(useCamera).mock.calls.at(-1)![0].isActive).toBe(false);
  expect(screen.onDetection).toHaveBeenLastCalledWith('focused');
  expect(screen.onPaused).not.toHaveBeenCalled();
});

function enableObjects(runObjects: jest.Mock) {
  const palm = jest.mocked(useTensorflowModel).getMockImplementation()!;
  jest.mocked(useTensorflowModel).mockImplementation((source, delegates) => {
    if (source !== 2) return palm(source, delegates);
    return {
      state: 'loaded',
      model: {
        inputs: [{ shape: [1, 320, 320, 3], dataType: 'uint8' }],
        outputs: [
          { shape: [1, 2, 90], dataType: 'float32' },
          { shape: [1, 2, 4], dataType: 'float32' },
        ],
        runSync: runObjects,
      },
    } as unknown as ReturnType<typeof useTensorflowModel>;
  });
}

test('an object without a hand is not focus, and no extra frames are taken', async () => {
  const raw = new Float32Array(180);
  raw[83] = 0.9;
  const runObjects = jest.fn(() => [raw.buffer, new Float32Array(8).buffer]);
  enableObjects(runObjects);
  const screen = await setup(false, 'periodic');
  await sample(-4);
  await sample(-4);
  await sample(-4);
  expect(screen.onStudyObjects).toHaveBeenLastCalledWith({
    book: true,
    keyboard: false,
    laptop: false,
  });
  expect(screen.onDetection).toHaveBeenLastCalledWith('missingHand');
  expect(runObjects).toHaveBeenCalledTimes(3);
  expect(jest.mocked(useCamera).mock.calls.at(-1)![0].isActive).toBe(false);
  await sample(4, 1000);
  expect(runObjects).toHaveBeenCalledTimes(3);
  expect(resizedDispose).toHaveBeenCalledTimes(3);
  expect(objectDispose).toHaveBeenCalledTimes(3);
});

test('an object model error does not let the hand alone succeed, and buffer release and the next 20 second check stay intact', async () => {
  const runObjects = jest.fn(() => {
    throw new Error('object inference failed');
  });
  enableObjects(runObjects);
  const screen = await setup(false, 'periodic');
  await sample(4);
  await sample(4);
  await sample(4);
  expect(screen.onStudyObjects).toHaveBeenLastCalledWith(null);
  expect(screen.onDetection).toHaveBeenLastCalledWith('unavailable');
  expect(resizedDispose).toHaveBeenCalledTimes(3);
  expect(objectDispose).toHaveBeenCalledTimes(3);
  expect(jest.mocked(useCamera).mock.calls.at(-1)![0].isActive).toBe(false);
  await act(async () => jest.advanceTimersByTime(MEASUREMENT_INTERVAL_MS));
  expect(jest.mocked(useCamera).mock.calls.at(-1)![0].isActive).toBe(true);
});

test('a hand without a study object does not pass in either cadence', async () => {
  objectRunSync.mockReturnValue([new Float32Array(180).buffer, new Float32Array(8).buffer]);
  const screen = await setup();
  await sample(4);
  await sample(4);
  await sample(4);
  expect(screen.onDetection).toHaveBeenLastCalledWith('missingObject');
});

test('two hand frames and two object frames fail when only one frame has both', async () => {
  const none = new Float32Array(180);
  const book = new Float32Array(180);
  book[83] = 0.9;
  objectRunSync
    .mockReturnValueOnce([none.buffer])
    .mockReturnValueOnce([book.buffer])
    .mockReturnValueOnce([book.buffer]);
  const screen = await setup(false, 'periodic');
  await sample(4);
  await sample(4);
  await sample(-4);
  expect(screen.onDetection).toHaveBeenLastCalledWith('missingObject');
});

test('one failed object inference still succeeds when the other two frames show both together', async () => {
  objectRunSync.mockImplementationOnce(() => {
    throw new Error('temporary object error');
  });
  const screen = await setup(false, 'periodic');
  await sample(4);
  await sample(4);
  await sample(4);
  expect(screen.onDetection).toHaveBeenLastCalledWith('focused');
  expect(objectDispose).toHaveBeenCalledTimes(3);
});

test.each(['live', 'periodic'] as const)(
  '%s: an inference scheduled before an interruption is dropped, and a fresh batch of three decides after resuming',
  async (cadence) => {
    const screen = await setup(false, cadence);
    await sample(4);
    await sample(4);
    let pending: (() => void) | undefined;
    jest.mocked(scheduleOnRN).mockImplementationOnce(((
      fn: (...args: unknown[]) => void,
      ...args: unknown[]
    ) => {
      pending = () => fn(...args);
    }) as typeof scheduleOnRN);
    await sample(4);
    const camera = jest.mocked(useCamera).mock.calls.at(-1)![0];
    await act(async () => camera.onInterruptionStarted!('video-device-in-use-by-another-client'));
    const readyCalls = screen.onReady.mock.calls.length;
    await act(async () => pending!());
    expect(screen.onDetection).toHaveBeenLastCalledWith('checking');
    expect(screen.onReady).toHaveBeenCalledTimes(readyCalls);
    expect(screen.onStudyObjects).toHaveBeenLastCalledWith(null);
    await sample(4);
    expect(screen.onReady).toHaveBeenCalledTimes(readyCalls);
    await act(async () => camera.onInterruptionEnded!());
    await sample(4);
    await sample(4);
    await sample(4);
    expect(screen.onDetection).toHaveBeenLastCalledWith('focused');
    expect(screen.onReady).toHaveBeenCalledTimes(readyCalls + 1);
  }
);

test('when periodic capture is interrupted, the 5 second limit rests the camera and the next check tries again', async () => {
  const screen = await setup(false, 'periodic');
  const camera = jest.mocked(useCamera).mock.calls.at(-1)![0];
  await act(async () => camera.onInterruptionStarted!('video-device-in-use-by-another-client'));
  await act(async () => jest.advanceTimersByTime(5000));
  expect(screen.onDetection).toHaveBeenLastCalledWith('unavailable');
  expect(jest.mocked(useCamera).mock.calls.at(-1)![0].isActive).toBe(false);
  await act(async () => jest.advanceTimersByTime(MEASUREMENT_INTERVAL_MS));
  await sample(4);
  await sample(4);
  await sample(4);
  expect(screen.onDetection).toHaveBeenLastCalledWith('focused');
});
