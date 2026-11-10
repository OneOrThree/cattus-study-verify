/** Input size, class count and thresholds of the object detector (EfficientDet-Lite0 int8 v1). */
export const OBJECT_INPUT = 320;
/** Size of the model's built-in COCO label map, empty labels included. Do not renumber. */
export const OBJECT_CLASSES = 90;
export const OBJECT_SCORE = 0.5;

/** 0-based indices in the model's built-in labels.txt. */
export const STUDY_OBJECT_LABELS = { laptop: 72, keyboard: 75, book: 83 } as const;
export type StudyObject = keyof typeof STUDY_OBJECT_LABELS;
export type StudyObjectScores = Record<StudyObject, number>;
export type StudyObjectPresence = Record<StudyObject, boolean>;

const OBJECT_KEYS = ['laptop', 'keyboard', 'book'] as const;

/**
 * Index of the per-anchor probability output, or -1 when the model does not have the
 * expected tensors. This model outputs probabilities before post-processing: they are
 * already sigmoid-applied, so do not apply sigmoid again.
 */
export function objectScoreIndex(
  inputs: readonly { shape: readonly number[]; dataType: string }[],
  outputs: readonly { shape: readonly number[]; dataType: string }[]
): number {
  'worklet';
  const input = inputs[0];
  if (
    inputs.length !== 1 ||
    input?.dataType !== 'uint8' ||
    input.shape.length !== 4 ||
    input.shape[0] !== 1 ||
    input.shape[1] !== OBJECT_INPUT ||
    input.shape[2] !== OBJECT_INPUT ||
    input.shape[3] !== 3
  )
    return -1;
  return outputs.findIndex(
    (tensor) =>
      tensor.dataType === 'float32' &&
      tensor.shape.length === 3 &&
      tensor.shape[0] === 1 &&
      tensor.shape[1]! > 0 &&
      tensor.shape[2] === OBJECT_CLASSES
  );
}

/**
 * Highest probability of each study object over all anchors. The check only asks whether
 * the object is present, so it decodes no boxes and runs no NMS. Throws on a malformed
 * tensor or an invalid probability; the caller keeps that error as a missing result.
 */
export function studyObjectScores(raw: Float32Array): StudyObjectScores {
  'worklet';
  if (!raw.length || raw.length % OBJECT_CLASSES !== 0)
    throw new Error('Invalid object score tensor');
  // An invalid probability must not turn into a normal miss or into another anchor's hit.
  for (let i = 0; i < raw.length; i++) {
    const score = raw[i]!;
    if (!Number.isFinite(score) || score < 0 || score > 1)
      throw new Error('Invalid object score probability');
  }
  const result: StudyObjectScores = { laptop: 0, keyboard: 0, book: 0 };
  for (let offset = 0; offset < raw.length; offset += OBJECT_CLASSES) {
    for (const key of OBJECT_KEYS) {
      const score = raw[offset + STUDY_OBJECT_LABELS[key]]!;
      if (score > result[key]) result[key] = score;
    }
  }
  return result;
}

/**
 * Per-object presence for display: an object counts when at least two of the three frames
 * reach the threshold. The focus decision itself pairs the hand and the object of the
 * same frame in `focusDetection`. Returns null for fewer or more than three samples, or
 * when every sample failed.
 */
export function studyObjectPresence(
  samples: readonly (StudyObjectScores | null)[]
): StudyObjectPresence | null {
  'worklet';
  if (samples.length !== 3 || samples.every((s) => s == null)) return null;
  return {
    laptop: samples.filter((s) => (s?.laptop ?? 0) >= OBJECT_SCORE).length >= 2,
    keyboard: samples.filter((s) => (s?.keyboard ?? 0) >= OBJECT_SCORE).length >= 2,
    book: samples.filter((s) => (s?.book ?? 0) >= OBJECT_SCORE).length >= 2,
  };
}
