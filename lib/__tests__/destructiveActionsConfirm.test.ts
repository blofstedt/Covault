import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Nothing in this app is destroyed on a single tap.
 *
 * The rule came out of losing a skip pattern to a stray tap on an ×. Every
 * delete on these screens removes something the user taught the app or money
 * they are tracking, and none of them has an undo — so they all go through the
 * same confirmation, and each one says what is actually lost rather than
 * "are you sure?".
 *
 * Reversible things are deliberately NOT in here: signing out, collapsing a
 * card, dismissing a duplicate warning. A confirmation on those would make the
 * real ones easier to click through.
 *
 * The skip-pattern delete also has a rendered interaction test in
 * learnedRulesCardInteractions.test.tsx. These source checks cover the other
 * delete entry points until their rendered flows are tested.
 */

const read = (rel: string) => readFileSync(resolve(__dirname, '../../', rel), 'utf8');

const RULES_CARD = read('components/transaction_parsing/LearnedRulesCard.tsx');
const DUP_BADGE = read('components/transaction_parsing/SoftDuplicateBadge.tsx');
const SHARING = read('components/dashboard_components/settings_modal_components/VaultSharingSection.tsx');
const ACTION_MODAL = read('components/TransactionActionModal.tsx');
const PARSING = read('components/TransactionParsing.tsx');

describe('the rules card', () => {
  it('sends every delete through one confirmation', () => {
    // Four buttons: the skip pattern ×, a single vendor match pattern, the
    // whole vendor rule, and the "unused Other rule" cleanup.
    const asks = [...RULES_CARD.matchAll(/setPendingConfirm\(\{/g)];
    expect(asks.length).toBeGreaterThanOrEqual(4);
  });

  it('never deletes straight from a button', () => {
    // Each of these may appear exactly once — inside the confirmation's `run`.
    expect([...RULES_CARD.matchAll(/handleRemoveRule\(/g)]).toHaveLength(1);
    expect([...RULES_CARD.matchAll(/handleRemoveStaleGroup\(group\)/g)]).toHaveLength(1);
    // The vendor override delete appears twice: one pattern, and all of them.
    // Both sit inside a `run`.
    const direct = [...RULES_CARD.matchAll(/onClick=\{\(\) => onDeleteVendorOverride\(/g)];
    expect(direct, 'a delete wired straight to onClick asks nothing').toHaveLength(0);
  });

  it('says what is lost, not just "are you sure"', () => {
    expect(RULES_CARD).toMatch(/cannot put it back/);
    expect(RULES_CARD).toMatch(/land in Review instead/);
  });

  it('escapes the card stacking context', () => {
    // The card sits inside the Review page's <main>, which is `relative z-10`
    // and would otherwise paint the modal under the nav bar.
    const modal = RULES_CARD.slice(RULES_CARD.indexOf('{pendingConfirm && ('));
    expect(modal.slice(0, modal.indexOf('</Portal>'))).toContain('<ConfirmModal');
  });

  it('leaves the cancel path harmless', () => {
    expect(RULES_CARD).toMatch(/onCancel=\{\(\) => setPendingConfirm\(null\)\}/);
  });
});

describe('the rest of the destructive actions', () => {
  it('asks before deleting the older of two lookalike purchases', () => {
    // The popover explains; it does not ask. Its red button was one tap from
    // removing a real transaction on the strength of the app's own guess.
    expect(DUP_BADGE).toContain('<ConfirmModal');
    expect(DUP_BADGE).toMatch(/setConfirmDelete\(true\)/);
    // And it is Portal'd for the same reason the rules card's modal is.
    expect(DUP_BADGE).toMatch(/import Portal from '\.\.\/ui\/Portal';/);
  });

  it('asks before disconnecting a partner', () => {
    // It clears the link in BOTH households at once.
    expect(SHARING).toContain('<ConfirmModal');
    expect(SHARING).toMatch(/onClick=\{\(\) => setConfirmDisconnect\(true\)\}/);
  });

  it('still asks before deleting a transaction, and before clearing the review list', () => {
    // These already did; pinned so they stay that way.
    expect(ACTION_MODAL).toMatch(/setShowDeleteConfirm\(true\)/);
    expect(ACTION_MODAL).toContain('<ConfirmDeleteModal');
    expect(PARSING).toContain('<DeleteAllConfirmModal');
    expect(PARSING).toContain('<ClearConfirmModal');
  });

  it('uses the one shared modal everywhere rather than a bespoke sheet each time', () => {
    for (const [name, source] of [
      ['the rules card', RULES_CARD],
      ['the duplicate badge', DUP_BADGE],
      ['vault sharing', SHARING],
    ] as const) {
      expect(source, `${name} should use components/ui/ConfirmModal`)
        .toMatch(/import ConfirmModal from '[^']*ui\/ConfirmModal';/);
    }
  });
});
