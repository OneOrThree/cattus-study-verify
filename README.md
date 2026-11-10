# cattus-study-verify

Check, on the device, whether a person has a hand and a book, laptop or keyboard in view of the camera. React Native, iOS and Android.

The code was extracted from [Cattus](https://github.com/OneOrThree), a focus app, where it verifies study sessions. It runs two MediaPipe TensorFlow Lite models on camera frames: a palm detector and an EfficientDet-Lite0 object detector. There is no server and no account.

> Version 0.1.0. Unit-tested and built on Expo SDK 57 and React Native 0.86. See [Status](#status) for what has been verified and what has not.

## What it does, and what it does not

It does one thing: a **presence check**. A frame passes when a hand and one of a book, laptop or keyboard are found **in the same frame**. A decision uses three frames and needs two that pass.

It does **not**:

- judge writing, typing, reading or attention. A hand resting beside a closed book passes. A person who writes on paper without a book in view does not.
- relate the hand to the object, or use positions. It decodes no boxes.
- prove that someone studied. The rule is a product choice made in Cattus, not a validated measure of attention.
- tell you how accurate it is. Detection accuracy, battery use and heat have **not** been measured for this package.

## Privacy

Frames are processed on the device. The package saves no photo or video and sends nothing to a server. The two models are bundled with the package and run locally. Your app is still responsible for its own camera-permission text and privacy policy.

## How a decision is made

For every analysed frame the package produces a hand score (palm model) and the highest probability of a book, a laptop and a keyboard (object model). Three frames make one decision:

- A frame **passes** when its hand score is at least 0.5 **and** one of its book, laptop or keyboard probabilities is at least 0.5.
- The decision is `focused` when at least 2 of the 3 frames pass. Each model is not voted separately and combined afterwards.
- A model, resizer or inference error is not a miss. An object result that failed is unknown, so a hand alone never passes. If errors leave the outcome open, the state is `unavailable`.

States of `VerificationDetection`:

| State           | Meaning                                                                                      |
| --------------- | -------------------------------------------------------------------------------------------- |
| `checking`      | Fewer than three frames so far, or frames went stale (no result for 2 seconds in live mode). |
| `focused`       | At least 2 of 3 frames have a hand and a study object together.                              |
| `missingHand`   | Fewer than 2 frames show a hand. Shown first when both are short.                            |
| `missingObject` | At least 2 frames show a hand, but not enough frames also show a book, laptop or keyboard.   |
| `unavailable`   | A model, the resizer or the camera failed, or a frame timed out in a periodic check.         |

## Cadence

| `cadence`          | Behavior                                                                                                                                                                                                                                                          |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `'live'` (default) | Samples a frame every 300 ms. A new decision comes with each frame once three are in. Stale after 2 seconds without a result. For a "before you start" screen.                                                                                                    |
| `'periodic'`       | Judges an independent batch of three frames, then stops inference and, if no preview is shown, the camera, until 20 seconds after the batch began. If no frame arrives within 5 seconds the check ends as `unavailable`. For a session that runs for a long time. |

The constants are exported (`LIVE_SAMPLE_MS`, `MEASUREMENT_INTERVAL_MS`, and so on).

## Requirements

- An Expo app with a development build (`npx expo prebuild` or EAS Build), or a React Native app with native projects. Expo Go cannot load the native modules.
- Expo SDK 57, React Native 0.86, React 19. Other versions have not been tested.
- **Android `minSdkVersion` 26 (Android 8.0) or higher.** The GPU frame resizer needs `AHardwareBuffer`.
- Camera permission. Add the iOS `NSCameraUsageDescription` and the Android `CAMERA` permission yourself. VisionCamera 5 ships no Expo config plugin for them.

## Install

```sh
npm install github:OneOrThree/cattus-study-verify

npm install react-native-vision-camera react-native-vision-camera-resizer \
  react-native-vision-camera-worklets react-native-fast-tflite react-native-worklets \
  react-native-nitro-modules react-native-nitro-image
```

The package is not on npm. Installing from GitHub builds the TypeScript on install. The first five native packages are peer dependencies of this package, so your app owns their versions. `react-native-vision-camera-worklets` is required: VisionCamera 5 runs frame processors through it. `react-native-nitro-modules` and `react-native-nitro-image` are peer dependencies of VisionCamera and `react-native-fast-tflite`, so install them too. The versions this package was built with are in `peerDependencies` of [package.json](package.json) and in the [example app](example/package.json).

Then:

1. **Metro: serve `.tflite` files.** The package loads its models with `require('….tflite')`.

   ```js
   // metro.config.js
   const { getDefaultConfig } = require('expo/metro-config');
   const config = getDefaultConfig(__dirname);
   config.resolver.assetExts.push('tflite');
   module.exports = config;
   ```

2. **Babel: the worklets plugin.** The library's frame code is marked `'worklet'`. `babel-preset-expo` adds the `react-native-worklets` plugin when that package is installed. Without `babel-preset-expo`, add `'react-native-worklets/plugin'` as the last plugin in `babel.config.js`.

3. **Android `minSdkVersion` 26.** With Expo, use `expo-build-properties`:

   ```json
   ["expo-build-properties", { "android": { "minSdkVersion": 26 } }]
   ```

4. **Camera permission.** For example in `app.json`:

   ```json
   {
     "expo": {
       "ios": {
         "infoPlist": {
           "NSCameraUsageDescription": "Checks your desk on this device. Nothing is saved or sent."
         }
       },
       "android": { "permissions": ["android.permission.CAMERA"] }
     }
   }
   ```

5. Rebuild the native app (`npx expo prebuild`, then run it).

The package metadata has a `react-native` field that points to the TypeScript source, so Metro compiles it with your Babel config. The compiled output in `build/` is for type declarations.

## Usage

```tsx
import { useCallback, useState } from 'react';
import { Button, Text } from 'react-native';
import {
  StudyVerifyCamera,
  createVerifiedTimeTracker,
  type VerificationDetection,
} from 'cattus-study-verify';
import { useCameraPermission } from 'react-native-vision-camera';

const tracker = createVerifiedTimeTracker(); // live mode

function StudyCheck() {
  const { hasPermission, requestPermission } = useCameraPermission();
  const [seconds, setSeconds] = useState(0);

  const onDetection = useCallback((detection: VerificationDetection) => {
    setSeconds(tracker.observe(detection === 'focused'));
  }, []);

  if (!hasPermission) return <Button title="Allow camera" onPress={requestPermission} />;
  return (
    <>
      <StudyVerifyCamera
        position="front"
        active
        cadence="live"
        onReady={() => {}}
        onPaused={() => tracker.pause()}
        onDetection={onDetection}
        onError={(error) => console.warn(error)}
      />
      <Text>{seconds} s verified</Text>
    </>
  );
}
```

The camera view fills its parent (`StyleSheet.absoluteFill`), so place it in a sized container. The [example app](example/App.tsx) shows the detection, the objects and the verified seconds on one screen.

For a long session, use `cadence="periodic"` and `createVerifiedTimeTracker({ holdMs: 22_000 })`: a pass counts as verified time until the next check, at most 22 seconds. Time keeps flowing between checks, and a failed check, `pause()` or `close()` stops it.

## API

### `<StudyVerifyCamera />`

| Prop                 | Type                                       | Notes                                                                                         |
| -------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `position`           | `'front' \| 'back'`                        | Which camera to open.                                                                         |
| `active`             | `boolean`                                  | When `false` nothing is rendered and no camera opens.                                         |
| `measurementEnabled` | `boolean` (default `true`)                 | When `false`, only the preview is shown. No model, resizer, frame output or timer is created. |
| `previewVisible`     | `boolean` (default `true`)                 | When `false`, the camera still measures but shows no view.                                    |
| `cadence`            | `'live' \| 'periodic'` (default `'live'`)  | See [Cadence](#cadence).                                                                      |
| `onReady`            | `() => void`                               | The first analysis frame arrived. Not a detection result.                                     |
| `onPaused`           | `() => void`                               | The camera stopped or was interrupted. Pause your tracker here.                               |
| `onDetection`        | `(d: VerificationDetection) => void`       | Every new decision.                                                                           |
| `onStudyObjects`     | `(o: StudyObjectPresence \| null) => void` | `{ book, laptop, keyboard }` booleans over the last three frames, or `null` when unknown.     |
| `onError`            | `(error: unknown) => void`                 | A camera error from VisionCamera.                                                             |

The preview view has `testID="study-verify-camera-preview"`. In development builds the component logs with the prefix `[cattus-study-verify]`.

### `createVerifiedTimeTracker({ holdMs = 0 })`

Returns `{ observe, pause, close, verifiedMs }`. It keeps its state in memory only.

| Method                               | Returns                | Notes                                                                                                                                                    |
| ------------------------------------ | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `observe(focused, now = Date.now())` | verified whole seconds | Live mode adds the gap since the previous positive observation when it is under 2 seconds. Hold mode counts a positive observation until `now + holdMs`. |
| `pause(now?)`                        |                        | Stops counting until the next positive observation.                                                                                                      |
| `close(now?)`                        |                        | Counts what is due, then ignores every later call.                                                                                                       |
| `verifiedMs(now?)`                   | milliseconds           | The total so far.                                                                                                                                        |

### Functions and constants

The building blocks are exported and have no native dependency: `focusDetection(hands, objects)`, `studyObjectPresence`, `studyObjectScores`, `objectScoreIndex`, `maxSigmoid`, `scoreTensorIndex`, `majorityPass`, and the constants `HAND_SCORE`, `OBJECT_SCORE`, `PALM_INPUT`, `OBJECT_INPUT`, `OBJECT_CLASSES`, `STUDY_OBJECT_LABELS`, `LIVE_SAMPLE_MS`, `LIVE_STALE_MS`, `MEASUREMENT_INTERVAL_MS`, `MEASUREMENT_BATCH_SIZE`, `MEASUREMENT_STALE_MS`, `MEASUREMENT_CAPTURE_TIMEOUT_MS`. Types: `VerificationDetection`, `VerificationCadence`, `VerificationCameraPosition`, `StudyVerifyCameraProps`, `StudyObjectPresence`, `StudyObjectScores`, `StudyObject`, `VerifiedTimeTracker`.

How a frame becomes a decision: [docs/how-it-works.md](docs/how-it-works.md).

## Models and licenses

| Model                            | Source                                      | Use                                         |
| -------------------------------- | ------------------------------------------- | ------------------------------------------- |
| `palm_detection_lite.tflite`     | Google MediaPipe Palm Detection Lite        | Is a hand in the frame.                     |
| `efficientdet_lite0_int8.tflite` | Google MediaPipe EfficientDet-Lite0 int8 v1 | Is a book, laptop or keyboard in the frame. |

Both are unmodified, Apache License 2.0. Download URLs, SHA-256 hashes, tensor shapes and COCO indices are in [assets/MODELS.md](assets/MODELS.md). The package code is Apache License 2.0 too. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

## Status

| Check                                                                                                                                          | Result                                                                              |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Unit tests (Jest): the decision rule, score and tensor helpers, the verified-time tracker, and the camera component with mocked native modules | Passing in CI                                                                       |
| Type check and lint                                                                                                                            | Passing in CI                                                                       |
| Android: debug build of the example app                                                                                                        | See CI                                                                              |
| iOS: simulator build of the example app                                                                                                        | See CI                                                                              |
| Detection accuracy (hand and object, different light, desks, people)                                                                           | **Not measured**                                                                    |
| Battery use and heat during a long session                                                                                                     | **Not measured**                                                                    |
| Real devices                                                                                                                                   | Not yet run for this package. See [docs/device-testing.md](docs/device-testing.md). |

The unit tests use mocked models. They prove the rules, not that the models find what is in front of a camera.

## Development

```sh
npm install
npm test            # Jest
npm run typecheck
npm run lint
npm run build
cd example && npm install && npx expo run:ios --device   # or run:android
```

## License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
