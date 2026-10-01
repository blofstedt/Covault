import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { handleBack, pushBackHandler } from '../backStack';
import { previousStep } from '../onboardingProgress';

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

const released: Array<() => void> = [];
const push = (...args: Parameters<typeof pushBackHandler>) => {
  const release = pushBackHandler(...args);
  released.push(release);
  return release;
};
afterEach(() => {
  released.splice(0).forEach((release) => release());
});

describe('the back stack', () => {
  it('reports nothing to close when empty, so the app can leave', () => {
    expect(handleBack()).toBe(false);
  });

  it('closes the most recently opened thing first', () => {
    const calls: string[] = [];
    push(() => { calls.push('page'); });
    push(() => { calls.push('vial'); });
    expect(handleBack()).toBe(true);
    expect(calls).toEqual(['vial']);
  });

  it('puts a dialog above a page that opened after it', () => {
    const calls: string[] = [];
    push(() => { calls.push('dialog'); }, 'modal');
    push(() => { calls.push('page'); }, 'page');
    handleBack();
    expect(calls).toEqual(['dialog']);
  });

  it('puts the walkthrough above everything', () => {
    const calls: string[] = [];
    push(() => { calls.push('tour'); }, 'walkthrough');
    push(() => { calls.push('dialog'); }, 'modal');
    handleBack();
    expect(calls).toEqual(['tour']);
  });

  it('lets the next one down answer when a handler declines', () => {
    const calls: string[] = [];
    push(() => { calls.push('lower'); });
    push(() => { calls.push('declined'); return false; });
    expect(handleBack()).toBe(true);
    expect(calls).toEqual(['declined', 'lower']);
  });

  it('forgets a handler once it is released', () => {
    const release = push(() => true);
    release();
    expect(handleBack()).toBe(false);
  });
});

describe('going back through the intro', () => {
  it('retraces the path that was walked, skipping the partner step when solo', () => {
    expect(previousStep('income', { solo: true })).toBe('who');
    expect(previousStep('income', { solo: false })).toBe('partner');
    expect(previousStep('who', { solo: true })).toBe('intro');
  });

  it('has nothing behind the first step', () => {
    expect(previousStep('intro', { solo: true })).toBeNull();
  });
});

describe('the wiring', () => {
  it('listens for the phone back button and only minimises when nothing took it', () => {
    const hook = read('lib/hooks/useHardwareBack.ts');
    expect(hook).toContain("addListener('backButton'");
    expect(hook).toContain('handleBack()');
    expect(hook).toContain('minimizeApp');
    expect(read('App.tsx')).toContain('useHardwareBack()');
  });

  it('makes every dialog answer the back button as it answers Escape', () => {
    expect(read('lib/hooks/useDialogInteraction.ts')).toContain('pushBackHandler');
  });
});
