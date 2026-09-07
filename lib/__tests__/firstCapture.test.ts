/**
 * The first-capture note fires once, for the person it is written for.
 *
 * The rule it encodes is narrow on purpose — see lib/firstCapture.ts. The
 * tests that matter are the two ways it could go wrong: never showing it to a
 * new user, whose whole understanding of the app depends on it, and showing it
 * to somebody who has been using Covault for months, where it is simply wrong.
 */
import { describe, it, expect } from 'vitest';
import { shouldShowFirstCapture } from '../firstCapture';

const facts = (over: Partial<Parameters<typeof shouldShowFirstCapture>[0]> = {}) => ({
  userId: 'user-1',
  waitingCount: 1,
  seen: false,
  ...over,
});

describe('shouldShowFirstCapture', () => {
  it('shows when the first capture is waiting', () => {
    expect(shouldShowFirstCapture(facts())).toBe(true);
  });

  it('does not need to have watched the count change', () => {
    // The alert almost always lands while the app is closed, so the app opens
    // to a badge that is already at one. A transition-watching rule would miss
    // exactly the case this exists for.
    expect(shouldShowFirstCapture(facts({ waitingCount: 1 }))).toBe(true);
  });

  it('never shows twice', () => {
    expect(shouldShowFirstCapture(facts({ seen: true }))).toBe(false);
  });

  it('stays quiet when nothing is waiting', () => {
    expect(shouldShowFirstCapture(facts({ waitingCount: 0 }))).toBe(false);
  });

  it('stays quiet for an established user with a backlog', () => {
    // The one thing it must not do is tell somebody with six purchases waiting
    // that their first one has just been caught.
    expect(shouldShowFirstCapture(facts({ waitingCount: 6 }))).toBe(false);
  });

  it('stays quiet with no user', () => {
    expect(shouldShowFirstCapture(facts({ userId: null }))).toBe(false);
    expect(shouldShowFirstCapture(facts({ userId: undefined }))).toBe(false);
  });
});
