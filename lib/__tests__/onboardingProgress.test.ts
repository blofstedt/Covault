import { describe, expect, it, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ONBOARDING_STEPS,
  clearProgress,
  nextStep,
  readProgress,
  resumeStep,
  writeProgress,
} from '../onboardingProgress';

/**
 * The intro now sets the month's money up and walks the user through granting
 * Android's notification access — and that last step LEAVES THE APP. Android
 * routinely destroys the WebView while the user is in its settings. Coming back
 * to slide one, having to answer everything again, is the failure this file
 * exists to prevent.
 */

class MemoryStorage {
  private store: Record<string, string> = {};
  getItem(key: string) { return key in this.store ? this.store[key] : null; }
  setItem(key: string, value: string) { this.store[key] = value; }
  removeItem(key: string) { delete this.store[key]; }
  clear() { this.store = {}; }
}

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage());
});

describe('picking the intro back up', () => {
  it('resumes at the capture step after Android killed the app mid-setup', () => {
    writeProgress('user-a', { step: 'capture', solo: true });
    expect(resumeStep(readProgress('user-a'))).toBe('capture');
  });

  it('starts at the beginning for someone who has not started', () => {
    expect(resumeStep(readProgress('user-a'))).toBe('intro');
  });

  it('is per person, so a shared phone does not resume the wrong intro', () => {
    writeProgress('user-a', { step: 'limits', solo: true });
    expect(readProgress('user-b')).toBeNull();
  });

  it('forgets it once the intro is finished', () => {
    writeProgress('user-a', { step: 'tour', solo: true });
    clearProgress('user-a');
    expect(readProgress('user-a')).toBeNull();
  });

  it('remembers the solo-or-together answer, which decides the path', () => {
    writeProgress('user-a', { step: 'income', solo: false });
    expect(readProgress('user-a')?.solo).toBe(false);
  });

  it('starts over rather than throwing on a step this build no longer has', () => {
    localStorage.setItem(
      'covault_onboarding_progress_v1:user-a',
      JSON.stringify({ step: 'a-step-from-an-older-build', solo: true }),
    );
    expect(readProgress('user-a')).toBeNull();
    expect(resumeStep(readProgress('user-a'))).toBe('intro');
  });

  it('starts over rather than throwing on unparseable storage', () => {
    localStorage.setItem('covault_onboarding_progress_v1:user-a', 'not json');
    expect(() => readProgress('user-a')).not.toThrow();
    expect(readProgress('user-a')).toBeNull();
  });

  it('survives storage being unavailable', () => {
    vi.stubGlobal('localStorage', {
      getItem() { throw new Error('blocked'); },
      setItem() { throw new Error('blocked'); },
      removeItem() { throw new Error('blocked'); },
    });
    expect(() => writeProgress('user-a', { step: 'limits', solo: true })).not.toThrow();
    expect(readProgress('user-a')).toBeNull();
  });
});

describe('the path through the steps', () => {
  it('asks who it is for before the money, because the money copy depends on it', () => {
    // The income step's wording changes on a shared vault, and saveBudgetLimit's
    // alternate-schema write sends is_household from the same answer.
    expect(ONBOARDING_STEPS.indexOf('who')).toBeLessThan(ONBOARDING_STEPS.indexOf('income'));
    expect(ONBOARDING_STEPS.indexOf('income')).toBeLessThan(ONBOARDING_STEPS.indexOf('limits'));
  });

  it('skips the partner step for someone budgeting alone', () => {
    expect(nextStep('who', { solo: true })).toBe('income');
    expect(nextStep('who', { solo: false })).toBe('partner');
  });

  it('ends after the tour', () => {
    expect(nextStep('tour', { solo: true })).toBeNull();
  });

  it('leaves the capture step before the tour, so a granted permission is the last hurdle', () => {
    expect(nextStep('capture', { solo: true })).toBe('tour');
  });
});

/**
 * Source-level guards, in the style of onboardingOnce.test.ts. These pin
 * decisions that are invisible from the outside and expensive to rediscover.
 */
const root = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('the setup steps themselves', () => {
  it('never render the starter constants instead of the real budget rows', () => {
    // The budgets table has no id column, so a loaded row is `budget:<name>`
    // while SYSTEM_CATEGORIES carries fixed UUIDs — and hiddenCategories stores
    // whichever id was on screen when the eye was tapped. Rendering the
    // constants would let a category be hidden under one id and un-hidden under
    // another the moment the real load landed.
    const source = read('components/onboarding/BudgetLimitsStep.tsx');
    expect(source).not.toMatch(/import[^;]*SYSTEM_CATEGORIES/);
    expect(source).not.toMatch(/from '\.\.\/\.\.\/constants'/);
  });

  it('mark the setup pending before the trip out to Android settings', () => {
    // Without this, a WebView destroyed in Android's settings comes back with
    // access granted and capture still switched off.
    expect(read('components/onboarding/CaptureStep.tsx')).toContain('markSetupPending(');
  });

  it('all say where the setting lives afterwards', () => {
    expect(read('components/onboarding/OnboardingStepShell.tsx')).toContain(
      'You can always change this in Settings',
    );
    for (const step of ['IncomeStep', 'BudgetLimitsStep', 'CaptureStep', 'TourStep']) {
      expect(read(`components/onboarding/${step}.tsx`)).toContain('OnboardingStepShell');
    }
  });

  it('are all skippable, so the intro can never trap a new user', () => {
    for (const step of ['IncomeStep', 'BudgetLimitsStep', 'CaptureStep', 'TourStep']) {
      expect(read(`components/onboarding/${step}.tsx`)).toContain('onSkip');
    }
  });

  it('forget the stored progress when the intro finishes', () => {
    expect(read('components/Onboarding.tsx')).toContain('clearProgress(userId)');
  });
});
