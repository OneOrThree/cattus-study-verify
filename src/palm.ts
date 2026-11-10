/**
 * Helpers for the palm detector (MediaPipe palm_detection_lite): input size, score tensor
 * and decision threshold. They are pure functions used on both the camera worklet thread
 * and the JS thread, so each one carries the 'worklet' directive.
 * The check only asks whether a hand is present. It decodes no boxes and runs no NMS: it
 * uses the maximum of the score tensor.
 */

/** Model input side in pixels. 192x192 RGB. */
export const PALM_INPUT = 192;

/** Hand score threshold. A frame with a score at or above this value has a hand. */
export const HAND_SCORE = 0.5;

/** Index of the score tensor ([1, 2016, 1]) among the outputs, or -1 when there is none. */
export function scoreTensorIndex(outputs: readonly { shape: number[] }[]): number {
  'worklet';
  for (let i = 0; i < outputs.length; i++) {
    const shape = outputs[i]!.shape;
    if (shape[shape.length - 1] === 1) return i;
  }
  return -1;
}

/**
 * Sigmoid (clamped to +-100) of the largest raw per-anchor score, the same formula as the
 * MediaPipe graph. Returns NaN for an empty or non-finite tensor.
 */
export function maxSigmoid(raw: Float32Array): number {
  'worklet';
  if (!raw.length) return NaN;
  let m = -Infinity;
  for (let i = 0; i < raw.length; i++) {
    const score = raw[i]!;
    if (!Number.isFinite(score)) return NaN;
    if (score > m) m = score;
  }
  const x = Math.max(-100, Math.min(100, m));
  return 1 / (1 + Math.exp(-x));
}

/** True when at least `need` of the frame scores reach the threshold. */
export function majorityPass(scores: readonly number[], threshold = HAND_SCORE, need = 2): boolean {
  'worklet';
  let hit = 0;
  for (const s of scores) if (Number.isFinite(s) && s >= threshold) hit++;
  return hit >= need;
}
