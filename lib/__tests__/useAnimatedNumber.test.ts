import { describe, it, expect } from 'vitest';
import { easeOutCubic, tweenValue } from '../hooks/useAnimatedNumber';

/**
 * The hook itself needs a DOM and a frame loop, but the part that decides what
 * number is on screen at any instant is pure — and it's the part with the
 * failure modes worth pinning: a tween that overshoots its target, or one that
 * never quite arrives, both read as a bug in the balance rather than as motion.
 */

describe('easeOutCubic', () => {
  it('starts at 0 and ends at 1', () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
  });

  it('is front-loaded — most of the distance is covered early', () => {
    // That's what makes it feel responsive rather than sluggish.
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.8);
  });

  it('clamps outside 0..1 instead of extrapolating', () => {
    // A late frame with elapsed > duration must not overshoot past the target.
    expect(easeOutCubic(1.5)).toBe(1);
    expect(easeOutCubic(-0.5)).toBe(0);
  });

  it('never exceeds 1', () => {
    for (let t = 0; t <= 1.001; t += 0.05) {
      expect(easeOutCubic(t)).toBeLessThanOrEqual(1);
    }
  });
});

describe('tweenValue', () => {
  it('returns the start value at t=0', () => {
    expect(tweenValue(100, 200, 0, 600)).toBe(100);
  });

  it('lands exactly on the target at the end', () => {
    // Exactly, not approximately — a balance that settles at $412.5999 would
    // render as the wrong number.
    expect(tweenValue(100, 200, 600, 600)).toBe(200);
  });

  it('lands on the target for any elapsed past the duration', () => {
    expect(tweenValue(100, 200, 5000, 600)).toBe(200);
  });

  it('moves monotonically toward the target', () => {
    let previous = tweenValue(0, 100, 0, 600);
    for (let elapsed = 50; elapsed <= 600; elapsed += 50) {
      const next = tweenValue(0, 100, elapsed, 600);
      expect(next).toBeGreaterThanOrEqual(previous);
      expect(next).toBeLessThanOrEqual(100);
      previous = next;
    }
  });

  it('counts down as readily as up', () => {
    const mid = tweenValue(200, 100, 300, 600);
    expect(mid).toBeLessThan(200);
    expect(mid).toBeGreaterThan(100);
  });

  it('handles a zero duration without dividing by zero', () => {
    expect(tweenValue(100, 200, 0, 0)).toBe(200);
  });

  it('handles negative targets', () => {
    // Remaining balance goes negative when the user overspends.
    expect(tweenValue(50, -50, 600, 600)).toBe(-50);
  });

  it('is a no-op when start and target match', () => {
    expect(tweenValue(42, 42, 123, 600)).toBe(42);
  });
});
