import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Deleting a skip pattern asks first.
 *
 * Every other destructive thing on this screen can be done again on demand: a
 * vendor rule is re-taught by categorising that merchant once more, a deleted
 * transaction was a row the user could see. A skip pattern cannot. It is
 * written from the text of one alert, so putting it back means waiting for
 * another of those alerts to arrive — which for something like a quarterly
 * statement notice could be months. A stray tap on a × that acted instantly
 * cost exactly that.
 *
 * Nothing in CI renders this card, so this reads the source.
 */

const CARD = resolve(__dirname, '../../components/transaction_parsing/LearnedRulesCard.tsx');
const card = readFileSync(CARD, 'utf8');

describe('the skip pattern delete button', () => {
  it('opens a confirmation rather than deleting', () => {
    expect(card).toMatch(/onClick=\{\(\) => setConfirmDeleteRule\(rule\)\}/);
    // And the delete itself is reachable from the modal's confirm and nowhere
    // else — a second call site would be a second way to lose a rule without
    // being asked.
    const calls = [...card.matchAll(/handleRemoveRule\(/g)];
    expect(calls).toHaveLength(1);
  });

  it('says which rule, and what is lost', () => {
    const fn = card.slice(card.indexOf('function describeSkipRuleDeletion('));
    const body = fn.slice(0, fn.indexOf('\n}'));
    // The modal covers the row that was tapped, so the pattern has to travel
    // into the message or nothing on screen says which rule this is.
    expect(body).toContain('rule.pattern');
    expect(body).toContain('use_count');
    expect(body).toMatch(/cannot put it back/);
  });

  it('escapes the card stacking context, or the modal lands under the nav bar', () => {
    // This card sits inside the Review page's <main>, which is `relative z-10`.
    // See components/ui/Portal.tsx.
    const modal = card.slice(card.indexOf('{confirmDeleteRule && ('));
    expect(modal.slice(0, modal.indexOf('</Portal>'))).toContain('<ConfirmModal');
    expect(card).toMatch(/import Portal from '\.\.\/ui\/Portal';/);
  });

  it('keeps the cancel path harmless', () => {
    // "Keep it" must close the modal and do nothing else.
    expect(card).toMatch(/onCancel=\{\(\) => setConfirmDeleteRule\(null\)\}/);
  });
});
