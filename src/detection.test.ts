import { focusDetection } from './detection';
import { maxSigmoid } from './palm';

const no = { book: 0, laptop: 0, keyboard: 0 };
const book = { ...no, book: 0.5 };
const laptop = { ...no, laptop: 0.8 };
const keyboard = { ...no, keyboard: 0.7 };

test.each([book, laptop, keyboard])(
  'a hand and any study object must show together in the same two frames: %j',
  (object) => {
    expect(focusDetection([0.5, 0.9, 0], [object, object, no])).toBe('focused');
    expect(focusDetection([0.9, 0.9, 0.9], [no, no, no])).toBe('missingObject');
    expect(focusDetection([0, 0, 0], [object, object, object])).toBe('missingHand');
  }
);

test('counts combined evidence of the same frame instead of voting each model separately', () => {
  expect(focusDetection([0.9, 0.9, 0], [no, book, book])).toBe('missingObject');
  expect(focusDetection([0.9, 0.9, 0], [book, laptop, no])).toBe('focused');
});

test('two frames do not succeed, and an error is kept apart from a miss and from a success', () => {
  expect(focusDetection([1, 1], [book, book])).toBe('checking');
  expect(focusDetection(null, [])).toBe('unavailable');
  expect(focusDetection([1, 1, 1], [])).toBe('unavailable');
  expect(focusDetection([1, 1, 1], [null, null, null])).toBe('unavailable');
  expect(focusDetection([1, 1, 1], [book, null, no])).toBe('unavailable');
  expect(focusDetection([1, 1, 1], [book, book, null])).toBe('focused');
  expect(focusDetection([0, 0, 1], [null, null, null])).toBe('missingHand');
});

test('when both are short, the hand guidance comes first and changes to the object once the hand is met', () => {
  expect(focusDetection([0, 0, 0], [no, no, no])).toBe('missingHand');
  expect(focusDetection([0.9, 0, 0], [no, no, no])).toBe('missingHand');
  expect(focusDetection([0.9, 0.9, 0], [no, no, no])).toBe('missingObject');
  expect(focusDetection([0.9, 0.9, 0], [book, book, no])).toBe('focused');
});

test.each([Infinity, -Infinity, NaN])(
  'an invalid hand output %s with two study-object frames does not verify',
  (raw) => {
    const hand = maxSigmoid(new Float32Array([raw]));
    const withBook = { book: 0.9, laptop: 0, keyboard: 0 };
    expect(focusDetection([hand, hand, 0], [withBook, withBook, null])).toBe('unavailable');
  }
);
