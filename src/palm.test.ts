import { majorityPass, maxSigmoid, scoreTensorIndex } from './palm';

describe('palm', () => {
  test('scoreTensorIndex picks the tensor whose last dim is 1', () => {
    expect(scoreTensorIndex([{ shape: [1, 2016, 18] }, { shape: [1, 2016, 1] }])).toBe(1);
    expect(scoreTensorIndex([{ shape: [1, 2016, 18] }])).toBe(-1);
  });

  test('maxSigmoid squashes the best anchor', () => {
    expect(maxSigmoid(new Float32Array([-5, 0, 2]))).toBeCloseTo(0.8808, 3);
    expect(maxSigmoid(new Float32Array([200]))).toBeCloseTo(1, 6); // clamped
    expect(maxSigmoid(new Float32Array([]))).toBeNaN();
  });

  test('majorityPass needs 2 of 3 by default', () => {
    expect(majorityPass([0.9, 0.1, 0.6])).toBe(true);
    expect(majorityPass([0.9, 0.1, 0.4])).toBe(false);
    expect(majorityPass([0.5, 0.5, 0.0])).toBe(true); // the threshold is inclusive
  });
});

test.each([Infinity, -Infinity, NaN])(
  'a non-finite model output %s is neither a valid probability nor a majority hit',
  (score) => {
    expect(maxSigmoid(new Float32Array([2, score]))).toBeNaN();
    expect(majorityPass([score, score, 0])).toBe(false);
  }
);
