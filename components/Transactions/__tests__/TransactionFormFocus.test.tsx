// @vitest-environment happy-dom
import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../../test/renderWithProviders';
import TransactionForm from '../TransactionForm';

describe('manual entry focus', () => {
  it('focuses the amount field once when a new entry opens', () => {
    const trigger = document.createElement('button');
    document.body.append(trigger);
    trigger.focus();
    const focusedTargets: (EventTarget | null)[] = [];
    const onFocusIn = (event: FocusEvent) => focusedTargets.push(event.target);
    document.addEventListener('focusin', onFocusIn);

    try {
      const { unmount } = renderWithProviders(<TransactionForm
        onClose={vi.fn()} onSave={vi.fn()}
        budgets={[{ id: 'food', name: 'Food', totalLimit: 500 }]}
        userId="user-1" userName="Alex"
      />);

      const amount = screen.getByLabelText('Amount');
      expect(amount).toHaveFocus();
      expect(focusedTargets).toEqual([amount]);
      unmount();
      expect(trigger).toHaveFocus();
    } finally {
      document.removeEventListener('focusin', onFocusIn);
      trigger.remove();
    }
  });
});
