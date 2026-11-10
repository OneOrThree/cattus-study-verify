import { createVerifiedTimeTracker } from './verifiedTime';

test('starts at zero and counts the gaps between consecutive positive observations', () => {
  const tracker = createVerifiedTimeTracker();
  expect(tracker.observe(false, 0)).toBe(0);
  expect(tracker.observe(true, 0)).toBe(0);
  expect(tracker.observe(true, 1500)).toBe(1);
  expect(tracker.verifiedMs()).toBe(1500);
});

test('counts only continuous positive stretches and leaves out failures, pauses, stale gaps and closed trackers', () => {
  const tracker = createVerifiedTimeTracker();
  tracker.observe(true, 0);
  tracker.observe(true, 1000);
  tracker.observe(false, 1300);
  tracker.observe(true, 2000);
  tracker.observe(true, 3000);
  tracker.pause();
  tracker.observe(true, 10_000);
  tracker.observe(true, 11_000);
  tracker.observe(true, 20_000);
  tracker.close();
  expect(tracker.observe(true, 21_000)).toBe(3);
  expect(tracker.verifiedMs()).toBe(3000);
});

test('a gap of 2 seconds or more is not counted', () => {
  const tracker = createVerifiedTimeTracker();
  tracker.observe(true, 0);
  expect(tracker.observe(true, 2000)).toBe(0);
  expect(tracker.observe(true, 3999)).toBe(1);
});

test('two trackers do not share state', () => {
  const a = createVerifiedTimeTracker();
  const b = createVerifiedTimeTracker();
  a.observe(true, 0);
  a.observe(true, 1500);
  expect(b.verifiedMs()).toBe(0);
  expect(a.verifiedMs()).toBe(1500);
});

describe('hold mode, for periodic checks 20 seconds apart', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
  });
  afterEach(() => jest.useRealTimers());

  test('one success flows second by second until the next check, and a short stretch before close is included', () => {
    const tracker = createVerifiedTimeTracker({ holdMs: 22000 });
    tracker.observe(true);
    jest.advanceTimersByTime(10000);
    expect(Math.floor(tracker.verifiedMs() / 1000)).toBe(10);
    jest.advanceTimersByTime(3000);
    tracker.close();
    expect(Math.floor(tracker.verifiedMs() / 1000)).toBe(13);
    jest.advanceTimersByTime(60000);
    expect(Math.floor(tracker.verifiedMs() / 1000)).toBe(13);
  });

  test('without a next check it adds only up to the hold limit, and reading does not extend it', () => {
    const tracker = createVerifiedTimeTracker({ holdMs: 22000 });
    tracker.observe(true);
    jest.advanceTimersByTime(20000);
    expect(tracker.verifiedMs()).toBe(20000);
    jest.advanceTimersByTime(60000);
    expect(tracker.verifiedMs()).toBe(22000);
    expect(tracker.verifiedMs()).toBe(22000);
  });

  test('a failure or a pause stops counting, and the next success starts again', () => {
    const tracker = createVerifiedTimeTracker({ holdMs: 22000 });
    tracker.observe(true);
    jest.advanceTimersByTime(20000);
    tracker.observe(false);
    jest.advanceTimersByTime(20000);
    expect(tracker.verifiedMs()).toBe(20000);
    tracker.observe(true);
    jest.advanceTimersByTime(5000);
    tracker.pause();
    jest.advanceTimersByTime(60000);
    expect(tracker.verifiedMs()).toBe(25000);
  });

  test('observe returns whole seconds and ignores calls after close', () => {
    const tracker = createVerifiedTimeTracker({ holdMs: 22000 });
    expect(tracker.observe(true)).toBe(0);
    jest.advanceTimersByTime(20000);
    expect(tracker.observe(true)).toBe(20);
    tracker.close();
    jest.advanceTimersByTime(5000);
    expect(tracker.observe(true)).toBe(20);
  });
});
