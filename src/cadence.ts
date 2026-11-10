/**
 * Sampling cadence. The live check samples continuously; the periodic check judges an
 * independent batch of three frames every 20 seconds.
 */
export const LIVE_SAMPLE_MS = 300;
export const LIVE_STALE_MS = 2_000;
export const MEASUREMENT_INTERVAL_MS = 20_000;
export const MEASUREMENT_BATCH_SIZE = 3;
/**
 * Time the next check needs to start the camera and process three frames. When no result
 * arrives by then, verification stops.
 */
export const MEASUREMENT_STALE_MS = MEASUREMENT_INTERVAL_MS + LIVE_STALE_MS;
export const MEASUREMENT_CAPTURE_TIMEOUT_MS = 5_000;
export type VerificationCadence = 'live' | 'periodic';
