import { MEASUREMENT_BATCH_SIZE } from './cadence';
import { OBJECT_SCORE, type StudyObjectScores } from './objects';
import { HAND_SCORE } from './palm';

/**
 * - `checking`: not enough frames yet, or the frames went stale.
 * - `focused`: a hand and a book, laptop or keyboard were found in the same frame, in at least 2 of 3 frames.
 * - `missingHand`: fewer than 2 frames show a hand.
 * - `missingObject`: 2 or more frames show a hand, but the combined evidence is too thin.
 * - `unavailable`: a model, the resizer or the camera failed, so the result cannot be decided.
 */
export type VerificationDetection =
  'checking' | 'focused' | 'missingHand' | 'missingObject' | 'unavailable';

/**
 * Decides from three frames. A frame passes only when its hand score and one of its
 * object scores reach the thresholds together. Each model is not voted separately and
 * combined afterwards. An error is kept apart from a miss: a `null` object result is
 * unknown, so a hand alone never passes.
 */
export function focusDetection(
  hands: readonly number[] | null,
  objects: readonly (StudyObjectScores | null)[]
): VerificationDetection {
  if (!hands) return 'unavailable';
  if (hands.length < MEASUREMENT_BATCH_SIZE) return 'checking';
  if (hands.length !== MEASUREMENT_BATCH_SIZE || objects.length !== hands.length)
    return 'unavailable';
  let passed = 0;
  let handsSeen = 0;
  let unknown = 0;
  for (let i = 0; i < hands.length; i++) {
    const hand = hands[i]!;
    if (!Number.isFinite(hand) || hand < 0 || hand > 1) {
      unknown++;
      continue;
    }
    if (hand < HAND_SCORE) continue;
    handsSeen++;
    const object = objects[i];
    if (!object) {
      unknown++;
      continue;
    }
    if ([object.book, object.laptop, object.keyboard].some((v) => v >= OBJECT_SCORE && v <= 1))
      passed++;
  }
  if (passed >= 2) return 'focused';
  if (passed + unknown >= 2) return 'unavailable';
  // When both are short, report the hand first.
  return handsSeen < 2 ? 'missingHand' : 'missingObject';
}
