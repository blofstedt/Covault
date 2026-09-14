/**
 * The manual entry form is filled top to bottom, and it says so.
 *
 * Every section used to be live at once. You could tap into the vendor before
 * naming an amount, choose a recurrence before a vault, and the Confirm button
 * sat greyed out with nothing saying which of the three missing things it was
 * waiting for. Now each section unlocks the one below it, and reaching for a
 * control that is not ready yet is answered rather than ignored — the section
 * the form IS waiting on flashes its ring twice, brighter than the ambient
 * pulse, and the cursor goes there.
 *
 * These are class names and prop names, not a rendered form, so this cannot
 * prove the sequence feels right — only that every step is still gated on the
 * one before it and that nothing taps into silence.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');
const form = readFileSync(resolve(ROOT, 'components/TransactionForm.tsx'), 'utf8');
const tailwind = readFileSync(resolve(ROOT, 'tailwind.config.js'), 'utf8');

describe('each step waits for the one above it', () => {
  it('the gates are defined in order, each including the last', () => {
    expect(form).toContain('const vendorUnlocked = hasAmount;');
    expect(form).toContain('const vaultUnlocked = hasAmount && hasVendor;');
    expect(form).toContain('const detailsUnlocked = vaultUnlocked && hasVault;');
  });

  it('the vendor field is inert until there is an amount', () => {
    expect(form).toContain('disabled={!vendorUnlocked}');
    expect(form).toContain("vendorUnlocked ? 'opacity-100' : LOCKED");
  });

  it('the vault grid waits for the amount too, not just the vendor', () => {
    // It used to be gated on `hasVendor` alone, which let an empty amount
    // through if a vendor had somehow been typed first.
    expect(form).toContain('disabled={!vaultUnlocked}');
    expect(form).toContain("vaultUnlocked ? 'opacity-100' : LOCKED");
    expect(form).not.toContain("hasVendor ? 'opacity-100'");
  });

  it('date and recurrence wait for the vault', () => {
    expect(form).toContain("detailsUnlocked ? 'opacity-100' : LOCKED");
  });

  it('says which step is holding things up, for anyone who cannot see motion', () => {
    // The flash is motion-safe, so it is the only signal a reduced-motion
    // reader gets. Losing it would leave them with a dead control.
    expect(form).toContain('Enter the amount first');
    expect(form).toContain('Name the vendor first');
  });
});

describe('a tap on a locked control is answered, never swallowed', () => {
  it('every locked region refuses rather than doing nothing', () => {
    // A dimmed control that ignores a tap teaches people the app is broken.
    const refusals = form.match(/onClick=\{\w+ \? undefined : refuse\}/g) ?? [];
    // Vendor, vault, the date/recurrence block, and the Confirm button.
    expect(refusals.length).toBe(4);
  });

  it('the Confirm button is reachable for the refusal', () => {
    // `disabled` raises no click event at all, so the button has to let the
    // wrapper hear the tap — otherwise the likeliest tap in the form is the
    // one place that stays silent.
    expect(form).toContain('onClick={isFormValid ? undefined : refuse}');
    expect(form).toContain("isFormValid ? '' : 'pointer-events-none'");
  });

  it('the flash lands on the section being waited for, not the one tapped', () => {
    expect(form).toContain("awaiting === section ? nudgeClass : ''");
  });

  it('the cursor follows the refusal where there is a field to put it in', () => {
    expect(form).toContain("if (awaiting === 'amount') amountInputRef.current?.focus();");
    expect(form).toContain("else if (awaiting === 'vendor') vendorInputRef.current?.focus();");
  });
});

describe('the flash restarts on every tap', () => {
  it('alternates between two animation names', () => {
    // A browser restarts a CSS animation only when the animation NAME changes.
    // Re-rendering with the same class does nothing, so tapping a locked
    // control twice would flash once. Collapsing these into one class is the
    // obvious tidy-up and it silently breaks the second tap.
    expect(form).toContain('motion-safe:animate-attention-nudge-a');
    expect(form).toContain('motion-safe:animate-attention-nudge-b');
    expect(form).toContain('nudges % 2 === 1');
  });

  it('both names exist in the Tailwind config and are identical', () => {
    for (const name of ['attention-nudge-a', 'attention-nudge-b']) {
      expect(tailwind).toContain(`'${name}': {`);
      // Twice, on the app's one duration and one curve.
      expect(tailwind).toContain(`'${name}': '${name} 320ms cubic-bezier(0.32, 0.72, 0.24, 1) 2'`);
    }
  });

  it('is brighter than the ambient pulse it has to be distinguishable from', () => {
    // Same colour, said louder. If these ever match, the answer to a tap
    // becomes indistinguishable from the waiting state carrying on.
    expect(tailwind).toContain("boxShadow: '0 0 0 4px rgba(16, 185, 129, 0.18)'"); // ambient
    expect(tailwind).toContain("boxShadow: '0 0 0 5px rgba(16, 185, 129, 0.45)'"); // the answer
  });
});

describe('the modal names itself', () => {
  it('is Manual Entry, not New Entry', () => {
    // The distinction that matters in a list where nearly everything arrived
    // on its own from a bank alert.
    expect(form).toContain("initialTransaction ? 'Edit Entry' : 'Manual Entry'");
    expect(form).not.toContain("'New Entry'");
  });
});
