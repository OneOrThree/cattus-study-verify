# How it works

This document describes what `StudyVerifyCamera` does with a camera frame, in order. The names match the source in `src/`.

```
camera frame (YUV, 640x480 target)
  -> GPU resize, twice:  192x192 float32 RGB   and   320x320 uint8 RGB
  -> palm model   -> max raw score -> sigmoid          = hand score of the frame
  -> object model -> max probability per class         = laptop / keyboard / book of the frame
  -> three frames collected (hand score + object scores, paired by frame)
  -> focusDetection: at least 2 of 3 frames have a hand AND an object
  -> VerificationDetection  ->  onDetection  ->  createVerifiedTimeTracker
```

## 1. Frame

`useFrameOutput` from VisionCamera delivers frames to a worklet on the camera thread. The component asks for a 640x480 target and the `yuv` pixel format. On iOS the resizer accepts only full-range input, and the native default can be video-range, so the format is requested explicitly. `allowDeferredStart` is `false`: on iOS 26 and later a frame output that waits for a preview gets no frames when no preview is shown.

The same capture session also feeds the preview. Showing or hiding the preview view does not rebuild the measurement session.

## 2. Resize

`react-native-vision-camera-resizer` resizes on the GPU (`scaleMode: 'contain'`, interleaved RGB). It produces exactly what each model takes, so JS converts nothing for each frame:

- palm model: 192x192, `float32`, values 0..1
- object model: 320x320, `uint8`

The resized buffer is passed to the model while it is alive and is disposed right after, also when an error is thrown. The source frame is disposed in a `finally` block, also for frames skipped by the sampling interval.

## 3. Models

`react-native-fast-tflite` runs both models synchronously on the worklet thread. Tensor shapes and indices are in [assets/MODELS.md](../assets/MODELS.md).

- **Palm.** The component picks the output whose last dimension is 1 (`scoreTensorIndex`). `maxSigmoid` takes the largest raw score over the 2016 anchors and applies a sigmoid, clamped to +-100. A non-finite value gives `NaN`, which never passes.
- **Objects.** `objectScoreIndex` accepts the model only with a `uint8` `[1, 320, 320, 3]` input and a `float32` `[1, N, 90]` output. `studyObjectScores` takes the largest probability per class over all anchors for laptop (72), keyboard (75) and book (83). The probabilities are already sigmoid-applied. A value outside 0..1 throws; the throw is caught and stored as `null` in the slot of that frame.

If a model fails to load, a tensor does not match, or the resizer fails, the component reports `unavailable`.

## 4. Three frames

Each frame stores its hand score and its object scores (or `null`) as a pair. The component keeps the last three. Samples are at least 300 ms apart; a gap of 2 seconds or more discards the older samples.

`focusDetection(hands, objects)` then decides:

1. Fewer than three hand scores: `checking`.
2. For each frame: a hand score that is not in 0..1 counts as unknown. A hand score below 0.5 is a miss. Otherwise the hand is seen, and the frame passes when its book, laptop or keyboard probability is at least 0.5. A `null` object result counts as unknown.
3. Two or more passes: `focused`.
4. Passes plus unknowns of two or more: `unavailable`. An error is not a miss.
5. Otherwise `missingHand` when fewer than two hands were seen, else `missingObject`.

`studyObjectPresence` is a separate, display-only view: an object is present when it reaches 0.5 in at least two of the three frames.

## 5. Cadence

In `'live'` cadence a decision is emitted for every new frame once three are in. In `'periodic'` cadence the component emits one decision after three frames, sets inference to rest, and wakes `20 s` after the batch began. When the preview is hidden the camera is stopped between checks. A result older than 22 seconds (`MEASUREMENT_STALE_MS`) is replaced by `checking`, so an old success is not kept forever. If no frame arrives within 5 seconds, the check ends as `unavailable`.

A capture epoch is bumped on every start, stop, interruption and cadence change. A result from an older epoch (for example one that was scheduled before the camera was interrupted) is dropped.

## 6. Verified time

`createVerifiedTimeTracker` turns decisions into seconds. It knows nothing about the camera; you pass `focused` and optionally the time.

- Live mode (`holdMs` = 0): a positive observation adds the time since the previous positive observation, only when that gap is under 2 seconds (`LIVE_STALE_MS`).
- Hold mode (`holdMs` > 0): a positive observation counts until the next observation, at most `holdMs` later. A negative observation, `pause()` or `close()` stops the count. Reading `verifiedMs()` never extends the hold.

State lives in the returned object only. The tracker stores nothing and sends nothing.
