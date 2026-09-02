import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The entry form asked for three things and named none of them.
 *
 * Amount, vendor and vault are all required, every section was live at once,
 * and the only feedback was a Confirm button that stayed grey — with nothing
 * saying which of the three was missing. The vendor field was the worst of it:
 * "Where was this spent?" was a PLACEHOLDER, so it read as a location, and it
 * disappeared on the first keystroke leaving the field unlabelled entirely.
 *
 * Source-level, like onboardingOnce.test.ts, because there is no React test
 * renderer in this repo. What is pinned here is the shape of the decision, not
 * the wording.
 */
const FORM = readFileSync(
  resolve(__dirname, '../../components/TransactionForm.tsx'),
  'utf8',
);
const TAILWIND = readFileSync(resolve(__dirname, '../../tailwind.config.js'), 'utf8');

describe('the entry form', () => {
  it('names the vendor field instead of only hinting at it in a placeholder', () => {
    expect(FORM).toContain('Vendor');
    expect(FORM).not.toContain('Where was this spent?');
  });

  it('asks for one thing at a time, in reading order', () => {
    expect(FORM).toContain(
      "!hasAmount ? 'amount' : !hasVendor ? 'vendor' : !hasVault ? 'vault' : null",
    );
  });

  it('keeps the vaults inert until there is a vendor to file', () => {
    expect(FORM).toContain("hasVendor ? 'opacity-100' : 'opacity-40 pointer-events-none'");
    expect(FORM).toContain('disabled={!hasVendor}');
  });

  it('puts the cursor where it is waiting rather than ignoring the tap', () => {
    // A dimmed control that does nothing when tapped teaches the user the app
    // is broken.
    expect(FORM).toContain('vendorInputRef.current?.focus()');
  });

  it('still lets the submit button be the only judge of what may be saved', () => {
    // The gating and the button must not be able to disagree about what the
    // form requires.
    expect(FORM).toContain(
      "const isFormValid = amount > 0 && selectedId !== null && vendor.trim() !== '';",
    );
    expect(FORM).toContain('disabled={!canSubmit}');
  });

  it('stops asking the moment nothing is missing', () => {
    // `awaiting` is null once all three are satisfied, so no ring is applied —
    // an editing user with a complete entry is never nagged.
    expect(FORM).toContain("awaiting === section ? 'motion-safe:animate-attention-pulse' : ''");
  });

  it('has the animation it asks for, and respects a user who wants less motion', () => {
    // `animate-attention-pulse` without the keyframe emits no CSS and fails
    // silently — the same class of mistake tailwindAnimatePlugin.test.ts and
    // durationClasses.test.ts exist for.
    expect(TAILWIND).toContain("'attention-pulse':");
    expect(FORM).toContain('motion-safe:animate-attention-pulse');
  });
});
