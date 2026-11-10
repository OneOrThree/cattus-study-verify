import {
  STUDY_OBJECT_LABELS,
  objectScoreIndex,
  studyObjectPresence,
  studyObjectScores,
} from './objects';

const inputs = [{ shape: [1, 320, 320, 3], dataType: 'uint8' }];
const scores = (book: number, keyboard = 0, laptop = 0) => ({ book, keyboard, laptop });

test('the label indices follow the 90-slot COCO map of the model', () => {
  expect(STUDY_OBJECT_LABELS).toEqual({ laptop: 72, keyboard: 75, book: 83 });
});

test('picks the 90-class probability output of the int8 model and rejects other inputs and box tensors', () => {
  const outputs = [
    { shape: [1, 19206, 4], dataType: 'float32' },
    { shape: [1, 19206, 90], dataType: 'float32' },
  ];
  expect(objectScoreIndex(inputs, outputs)).toBe(1);
  expect(objectScoreIndex([{ ...inputs[0]!, dataType: 'float32' }], outputs)).toBe(-1);
  expect(objectScoreIndex(inputs, [{ shape: [1, 19206, 80], dataType: 'float32' }])).toBe(-1);
});

test('extracts by the indices with empty COCO labels included and applies no second sigmoid', () => {
  const raw = new Float32Array(90 * 2);
  raw[72] = 0.8;
  raw[75] = 0.4;
  raw[90 + 75] = 0.9;
  raw[83] = 0.7;
  raw[0] = 1;
  const result = studyObjectScores(raw);
  expect(result.laptop).toBeCloseTo(0.8);
  expect(result.keyboard).toBeCloseTo(0.9);
  expect(result.book).toBeCloseTo(0.7);
  expect(studyObjectScores(new Float32Array(90))).toEqual(scores(0));
});

test('rejects a malformed output', () => {
  expect(() => studyObjectScores(new Float32Array(89))).toThrow('Invalid');
  expect(() => studyObjectScores(new Float32Array(0))).toThrow('Invalid');
});

test.each([NaN, Infinity, -Infinity, -0.1, 1.1])(
  'an invalid object probability %s is kept as an error even when other anchors are valid',
  (invalid) => {
    for (const index of [0, 72, 75, 83]) {
      const raw = new Float32Array(90 * 2);
      raw[90 + 83] = 0.9;
      raw[index] = invalid;
      expect(() => studyObjectScores(raw)).toThrow('Invalid object score probability');
    }
  }
);

test('each object needs 2 of the same 3 frames, so one false positive does not count', () => {
  expect(studyObjectPresence([scores(1)])).toBeNull();
  expect(studyObjectPresence([null, null, null])).toBeNull();
  expect(studyObjectPresence([scores(1), scores(0), scores(0)])).toEqual({
    book: false,
    keyboard: false,
    laptop: false,
  });
  expect(studyObjectPresence([scores(0.5, 0.9), scores(0.5), scores(0, 0.8)])).toEqual({
    book: true,
    keyboard: true,
    laptop: false,
  });
});
