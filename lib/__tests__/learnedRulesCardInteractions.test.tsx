// @vitest-environment jsdom

import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import LearnedRulesCard from '../../components/transaction_parsing/LearnedRulesCard';
import type { NotificationRule } from '../notificationRules';
import { renderWithProviders } from '../../test/renderWithProviders';

const skipRule: NotificationRule = {
  id: 'skip-1',
  user_id: 'person-1',
  pattern: 'Your balance is $500',
  pattern_type: 'exact',
  use_count: 2,
  last_used_at: null,
  created_at: '2026-09-01T12:00:00Z',
};

describe('deleting a learned skip pattern', () => {
  it('keeps the rule after cancel and removes it only after confirmation', async () => {
    const user = userEvent.setup();
    const removeSavedRule = vi.fn(async (id: string) => id === 'skip-1');
    const RulesHarness = () => {
      const [rules, setRules] = useState([skipRule]);
      return (
        <LearnedRulesCard
          vendorOverrides={[]}
          rules={rules}
          onRemoveRule={async (id) => {
            const removed = await removeSavedRule(id);
            if (removed) setRules((current) => current.filter((rule) => rule.id !== id));
            return removed;
          }}
          onDeleteVendorOverride={vi.fn()}
        />
      );
    };

    renderWithProviders(<RulesHarness />);

    const deleteButton = screen.getByRole('button', { name: 'Delete this skip pattern' });
    await user.click(deleteButton);

    const dialog = screen.getByRole('dialog', { name: 'Delete this skip pattern?' });
    expect(within(dialog).getByText(/Your balance is \$500/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Keep it' })).toHaveFocus();
    expect(removeSavedRule).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: 'Keep it' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(deleteButton).toHaveFocus();
    expect(screen.getByText('Your balance is $500')).toBeInTheDocument();
    expect(removeSavedRule).not.toHaveBeenCalled();

    await user.click(deleteButton);
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete it' }));
    await waitFor(() => {
      expect(screen.queryByText('Your balance is $500')).not.toBeInTheDocument();
    });
    expect(removeSavedRule).toHaveBeenCalledExactlyOnceWith('skip-1');
  });

  it('keeps keyboard focus inside the confirmation', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <LearnedRulesCard
        vendorOverrides={[]}
        rules={[skipRule]}
        onRemoveRule={vi.fn(async () => true)}
        onDeleteVendorOverride={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Delete this skip pattern' }));
    const dialog = screen.getByRole('dialog');
    const cancel = within(dialog).getByRole('button', { name: 'Keep it' });
    const confirm = within(dialog).getByRole('button', { name: 'Delete it' });

    await user.tab();
    expect(confirm).toHaveFocus();
    await user.tab({ shift: true });
    expect(cancel).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('has an accessible confirmation dialog', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <LearnedRulesCard
        vendorOverrides={[]}
        rules={[skipRule]}
        onRemoveRule={vi.fn(async () => true)}
        onDeleteVendorOverride={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Delete this skip pattern' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete this skip pattern?' });
    expect(dialog).toHaveAccessibleDescription(/Your balance is \$500/);
    const result = await axe(dialog, { rules: { region: { enabled: false } } });
    expect(result.violations).toEqual([]);
  });
});
