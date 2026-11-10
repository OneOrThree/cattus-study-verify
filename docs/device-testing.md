# Testing on a device

The unit tests cover the rules with mocked models and mocked native modules. They cannot show that the models find a hand or a book in front of a real camera, or what a long session costs in battery and heat. None of this has been measured for this package. Run these checks on real devices with the example app before you rely on a release. Write down the device, the OS version and the date with each result.

## Set up

```sh
cd example
npm install
npx expo run:ios --device       # needs a signing team
npx expo run:android --device   # Android 8.0 (API 26) or newer
```

For iOS, set `ios.appleTeamId` in `example/app.json` or choose a team in Xcode, and change the bundle identifier to one your team owns. The camera does not work in the simulator.

## Checks

| #   | Step                                                                                                              | Expected                                                                                                |
| --- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 1   | Fresh install, open the app.                                                                                      | "Allow camera" is shown. The camera is off. No crash.                                                   |
| 2   | Allow the camera, press Start (front camera).                                                                     | The preview appears. "Frames arriving" turns to yes within a second or two.                             |
| 3   | Show no hand and no object.                                                                                       | `missingHand`.                                                                                          |
| 4   | Show an open hand only.                                                                                           | `missingHand` or `missingObject`, never `focused`.                                                      |
| 5   | Show a book only.                                                                                                 | `missingHand`.                                                                                          |
| 6   | Show a hand and a book in the same view.                                                                          | `focused` within a few seconds. The book flag is yes. Verified time grows by about 1 second per second. |
| 7   | Repeat 6 with a laptop, then with a keyboard.                                                                     | `focused`. The matching flag is yes.                                                                    |
| 8   | Take the hand away while the book stays.                                                                          | Back to `missingHand` within a few seconds. Verified time stops.                                        |
| 9   | Cover the camera.                                                                                                 | `missingHand`. No crash.                                                                                |
| 10  | Switch to the back camera (Stop first) and repeat 6.                                                              | Same result.                                                                                            |
| 11  | Press Start, then send the app to the background and return.                                                      | The camera restarts, `checking` first, then a decision.                                                 |
| 12  | iOS: start a call or open another camera app, then return. Android: open another camera app, then return.         | `onPaused` runs (frames arriving: no), then it recovers.                                                |
| 13  | Deny the camera permission (reinstall first).                                                                     | No camera, no crash.                                                                                    |
| 14  | Try different light (dim room, window behind you), different desks and different people.                          | Record how often step 6 fails or `focused` shows without a hand and an object.                          |
| 15  | Run for 30 minutes with `cadence="periodic"`. Note battery level and device temperature at the start and the end. | Record the numbers. There is no expected value yet.                                                     |
| 16  | Android 7 or older.                                                                                               | The example does not install. The package needs `minSdkVersion` 26.                                     |

## Report

Record each check as pass or fail with the observed value. Checks 14 and 15 produce the numbers this package does not have yet. Open an issue with the device, the OS version and the values.
