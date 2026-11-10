# Models

Both models are Google MediaPipe files, unmodified, licensed under the Apache License 2.0 (source project: [google-ai-edge/mediapipe](https://github.com/google-ai-edge/mediapipe)). The package bundles them as assets and loads them on the device with `react-native-fast-tflite`. No frame is sent to a service.

| File                             | Source                                                                                                                                                             | SHA-256                                                            | Size            |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ | --------------- |
| `palm_detection_lite.tflite`     | [Google MediaPipe Palm Detection Lite](https://storage.googleapis.com/mediapipe-assets/palm_detection_lite.tflite)                                                 | `e9a4aaddf90dda56a87235303cf00e4c2d3fb28725f68fd88772997dac905c18` | 1,985,440 bytes |
| `efficientdet_lite0_int8.tflite` | [Google MediaPipe EfficientDet-Lite0 int8 v1](https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/int8/1/efficientdet_lite0.tflite) | `0720bf247bd76e6594ea28fa9c6f7c5242be774818997dbbeffc4da460c723bb` | 4,602,795 bytes |

The hash of the palm model was compared with the official file on 2026-11-01. The object model was downloaded on 2026-10-31. Check a copy yourself with `shasum -a 256 assets/*.tflite`.

File size is not run-time memory use. Memory use, speed and power on a phone have not been measured for this package.

## Palm detector

- Input: `[1, 192, 192, 3]` float32 RGB, scaled to 0..1.
- Outputs: boxes and keypoints `[1, 2016, 18]`, and hand scores `[1, 2016, 1]` **before** the sigmoid.
- This package uses only the score tensor: it takes the largest raw score over the 2016 anchors and applies a sigmoid (clamped to +-100), as the MediaPipe graph does. It decodes no boxes and runs no NMS.
- A frame has a hand when the score is at least 0.5 (`HAND_SCORE`).

## Object detector

- Input: `[1, 320, 320, 3]` **uint8** RGB. The quantization (scale 0.0078125, zero point 127) is inside the model, so the RGB bytes go in as they are.
- Outputs: per-anchor class probabilities `[1, 19206, 90]` float32, and boxes before decoding `[1, 19206, 4]`. This is not the four-tensor output of the post-processed detector.
- The probabilities are **already sigmoid-applied**. Do not apply a sigmoid again.
- Class indices come from the model's built-in `labels.txt`, a 90-slot COCO map that includes empty slots. Indices are 0-based:

  | Object   | Index |
  | -------- | ----- |
  | laptop   | 72    |
  | keyboard | 75    |
  | book     | 83    |

  Do not remove the empty labels and do not renumber to 80 consecutive classes.

- The package uses the largest probability per class over all anchors. An object counts in a frame when it is at least 0.5 (`OBJECT_SCORE`). It does not use positions, and it does not relate the object to the hand.
- A probability outside 0..1 or a non-finite value is an error, not a miss.

More: [MediaPipe object detector guide](https://developers.google.com/edge/mediapipe/solutions/vision/object_detector).

## License

Apache License 2.0. See [LICENSE](../LICENSE) and [NOTICE](../NOTICE).
