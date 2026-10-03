// @vitest-environment happy-dom
import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SoftDuplicateBadge from '../SoftDuplicateBadge';
import { renderWithProviders } from '../../../test/renderWithProviders';
import { handleBack } from '../../../lib/backStack';
import { DIALOG_EXIT_DURATION_MS } from '../../../lib/hooks/useDialogExit';
import type { Transaction } from '../../../types';

function pressKey(element: HTMLElement, key: string, shiftKey = false): void {
  const event = new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true });
  element.dispatchEvent(event);
}

const dummyTx: Transaction = {
  id: 'tx-1',
  user_id: 'user-1',
  vendor: 'Chevron',
  amount: 45.5,
  date: '2026-10-01',
  budget_id: 'transport',
  is_projected: false,
  created_at: '2026-10-01T12:00:00Z',
  softDuplicateOf: {
    id: 'tx-0',
    vendor: 'Chevron',
    amount: 45.5,
    date: '2026-10-01',
  },
};

describe('SoftDuplicateBadge popover interaction', () => {
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    document.body.style.overflow = 'clip';
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
    document.body.style.overflow = '';
  });

  it('moves focus to "keep both" on open, and closes on Escape returning focus to badge', () => {
    const { getByRole, getByText } = renderWithProviders(
      <SoftDuplicateBadge
        tx={dummyTx}
        similar={dummyTx.softDuplicateOf!}
        onDismiss={vi.fn()}
        onDeleteSimilar={vi.fn()}
      />,
    );

    const badgeButton = getByRole('button', { name: /possible duplicate/i });
    act(() => {
      badgeButton.focus();
      badgeButton.click();
    });

    const popover = document.querySelector('[role="dialog"]') as HTMLElement;
    expect(popover).not.toBeNull();

    const keepBothButton = getByText('Not a duplicate — keep both');
    expect(document.activeElement).toBe(keepBothButton);

    act(() => {
      pressKey(popover, 'Escape');
    });

    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(badgeButton);
  });

  it('closes popover and returns focus to badge when handleBack() is called', () => {
    const { getByRole } = renderWithProviders(
      <SoftDuplicateBadge
        tx={dummyTx}
        similar={dummyTx.softDuplicateOf!}
        onDismiss={vi.fn()}
        onDeleteSimilar={vi.fn()}
      />,
    );

    const badgeButton = getByRole('button', { name: /possible duplicate/i });
    act(() => {
      badgeButton.focus();
      badgeButton.click();
    });

    expect(document.querySelector('[role="dialog"]')).not.toBeNull();

    let handled = false;
    act(() => {
      handled = handleBack();
    });

    expect(handled).toBe(true);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(badgeButton);
  });

  it('closes only the confirm modal when delete confirm is open, leaving popover open', async () => {
    const { getByRole, getByText } = renderWithProviders(
      <SoftDuplicateBadge
        tx={dummyTx}
        similar={dummyTx.softDuplicateOf!}
        onDismiss={vi.fn()}
        onDeleteSimilar={vi.fn()}
      />,
    );

    const badgeButton = getByRole('button', { name: /possible duplicate/i });
    act(() => {
      badgeButton.focus();
      badgeButton.click();
    });

    const deleteOlderButton = getByText('Delete the older one');
    act(() => {
      deleteOlderButton.focus();
      deleteOlderButton.click();
    });

    // Confirm modal is mounted
    expect(getByText('Delete the older one?')).not.toBeNull();

    vi.useFakeTimers();

    // Trigger back
    let handled = false;
    act(() => {
      handled = handleBack();
    });
    expect(handled).toBe(true);

    // Advance through the exit animation
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DIALOG_EXIT_DURATION_MS);
    });

    // Confirm modal is unmounted, but popover stays open
    expect(document.body.textContent).not.toContain('Delete it');
    expect(getByText('Looks like a duplicate')).not.toBeNull();
    expect(document.activeElement).toBe(deleteOlderButton);

    // Press Escape on popover now closes the popover and restores focus to badge
    const popover = document.querySelector('[role="dialog"]') as HTMLElement;
    act(() => {
      pressKey(popover, 'Escape');
    });

    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(badgeButton);

    vi.useRealTimers();
  });

  it('closes only the confirm modal when Escape is pressed on the confirm modal', async () => {
    const { getByRole, getByText } = renderWithProviders(
      <SoftDuplicateBadge
        tx={dummyTx}
        similar={dummyTx.softDuplicateOf!}
        onDismiss={vi.fn()}
        onDeleteSimilar={vi.fn()}
      />,
    );

    const badgeButton = getByRole('button', { name: /possible duplicate/i });
    act(() => {
      badgeButton.focus();
      badgeButton.click();
    });

    const deleteOlderButton = getByText('Delete the older one');
    act(() => {
      deleteOlderButton.focus();
      deleteOlderButton.click();
    });

    const dialogs = document.querySelectorAll('[role="dialog"]');
    const confirmDialog = dialogs[dialogs.length - 1] as HTMLElement;
    expect(confirmDialog).not.toBeNull();

    vi.useFakeTimers();

    act(() => {
      pressKey(confirmDialog, 'Escape');
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(DIALOG_EXIT_DURATION_MS);
    });

    expect(document.body.textContent).not.toContain('Delete it');
    expect(getByText('Looks like a duplicate')).not.toBeNull();
    expect(document.activeElement).toBe(deleteOlderButton);

    vi.useRealTimers();
  });

  it('does not set body overflow to hidden while popover is open', () => {
    document.body.style.overflow = 'clip';

    const { getByRole } = renderWithProviders(
      <SoftDuplicateBadge
        tx={dummyTx}
        similar={dummyTx.softDuplicateOf!}
        onDismiss={vi.fn()}
        onDeleteSimilar={vi.fn()}
      />,
    );

    const badgeButton = getByRole('button', { name: /possible duplicate/i });
    act(() => {
      badgeButton.click();
    });

    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.body.style.overflow).toBe('clip');
    expect(document.body.style.overflow).not.toBe('hidden');
  });

  it('supports the existing dismiss flow', () => {
    const onDismiss = vi.fn();
    const { getByRole, getByText } = renderWithProviders(
      <SoftDuplicateBadge
        tx={dummyTx}
        similar={dummyTx.softDuplicateOf!}
        onDismiss={onDismiss}
        onDeleteSimilar={vi.fn()}
      />,
    );

    const badgeButton = getByRole('button', { name: /possible duplicate/i });
    act(() => {
      badgeButton.click();
    });

    const keepBothButton = getByText('Not a duplicate — keep both');
    act(() => {
      keepBothButton.click();
    });

    expect(onDismiss).toHaveBeenCalledWith('tx-1', 'tx-0');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('supports the existing delete-confirm flow', () => {
    const onDeleteSimilar = vi.fn();
    const { getByRole, getByText } = renderWithProviders(
      <SoftDuplicateBadge
        tx={dummyTx}
        similar={dummyTx.softDuplicateOf!}
        onDismiss={vi.fn()}
        onDeleteSimilar={onDeleteSimilar}
      />,
    );

    const badgeButton = getByRole('button', { name: /possible duplicate/i });
    act(() => {
      badgeButton.click();
    });

    act(() => {
      getByText('Delete the older one').click();
    });

    const confirmDeleteBtn = getByText('Delete it');
    act(() => {
      confirmDeleteBtn.click();
    });

    expect(onDeleteSimilar).toHaveBeenCalledWith('tx-0');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('closes popover on outside click', () => {
    const { getByRole } = renderWithProviders(
      <SoftDuplicateBadge
        tx={dummyTx}
        similar={dummyTx.softDuplicateOf!}
        onDismiss={vi.fn()}
        onDeleteSimilar={vi.fn()}
      />,
    );

    const badgeButton = getByRole('button', { name: /possible duplicate/i });
    act(() => {
      badgeButton.click();
    });

    expect(document.querySelector('[role="dialog"]')).not.toBeNull();

    act(() => {
      document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });

    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});
