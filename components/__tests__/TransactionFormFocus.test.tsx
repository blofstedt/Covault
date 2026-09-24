// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TransactionForm from '../TransactionForm';

let container: HTMLDivElement;
let root: Root;
let trigger: HTMLButtonElement;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div');
  trigger = document.createElement('button');
  document.body.append(container, trigger);
  trigger.focus();
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  trigger.remove();
});

describe('manual entry focus', () => {
  it('focuses the amount field once when a new entry opens', async () => {
    const focusedTargets: EventTarget[] = [];
    const onFocusIn = (event: FocusEvent) => focusedTargets.push(event.target!);
    document.addEventListener('focusin', onFocusIn);

    await act(async () =>
      root.render(
        <TransactionForm
          onClose={vi.fn()}
          onSave={vi.fn()}
          budgets={[{ id: 'food', name: 'Food', totalLimit: 500 }]}
          userId="user-1"
          userName="Alex"
        />,
      ),
    );

    const amount = document.querySelector<HTMLInputElement>('input[type="number"]');
    if (!amount) throw new Error('Manual-entry amount field did not render');

    expect(document.activeElement).toBe(amount);
    expect(focusedTargets).toEqual([amount]);

    document.removeEventListener('focusin', onFocusIn);
  });
});
