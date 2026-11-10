import { LIVE_STALE_MS } from './cadence';

export type VerifiedTimeTracker = {
  /**
   * Records one detection result and returns the verified whole seconds so far.
   * `now` defaults to `Date.now()`. Returns the current total unchanged after `close()`.
   */
  observe(focused: boolean, now?: number): number;
  /** Stops counting until the next positive observation (camera paused or interrupted). */
  pause(now?: number): void;
  /** Counts what is due, then ignores every later call. */
  close(now?: number): void;
  /** Verified milliseconds so far. In hold mode this also counts the time up to `now`. */
  verifiedMs(now?: number): number;
};

/**
 * Accumulates verified study time from detection results.
 *
 * - Live mode (`holdMs` = 0): a positive observation adds the gap since the previous
 *   positive observation, but only when the gap is under 2 seconds. Longer gaps, negative
 *   observations and `pause()` add nothing and restart the count.
 * - Hold mode (`holdMs` > 0): for periodic checks. A positive observation counts as
 *   verified until the next observation, at most `holdMs` after it. Time keeps flowing
 *   between checks, a negative observation or `pause()` stops it, and the count never
 *   extends past `now + holdMs`. Use a value a little over the check interval
 *   (the example uses 22 seconds for a 20 second interval).
 *
 * Nothing is stored outside the returned object: no disk, no network.
 */
export function createVerifiedTimeTracker({
  holdMs = 0,
}: { holdMs?: number } = {}): VerifiedTimeTracker {
  let total = 0;
  let open = true;
  let lastPositiveAt: number | null = null;
  let validUntil = 0;

  // Hold mode: add the time from the last positive observation up to `now`, capped at validUntil.
  const advance = (now: number) => {
    if (!open || !holdMs || lastPositiveAt == null || now <= lastPositiveAt) return;
    const end = Math.min(now, validUntil);
    total += Math.max(0, end - lastPositiveAt);
    lastPositiveAt = now < validUntil ? end : null;
  };

  return {
    observe(focused, now = Date.now()) {
      if (!open) return Math.floor(total / 1000);
      advance(now);
      if (!holdMs && focused && lastPositiveAt != null) {
        const elapsed = now - lastPositiveAt;
        if (elapsed > 0 && elapsed < LIVE_STALE_MS) total += elapsed;
      }
      lastPositiveAt = focused ? now : null;
      validUntil = focused ? now + holdMs : 0;
      return Math.floor(total / 1000);
    },
    pause(now = Date.now()) {
      advance(now);
      lastPositiveAt = null;
    },
    close(now = Date.now()) {
      advance(now);
      open = false;
      lastPositiveAt = null;
    },
    verifiedMs(now = Date.now()) {
      advance(now);
      return total;
    },
  };
}
