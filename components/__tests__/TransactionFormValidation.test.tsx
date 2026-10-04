// @vitest-environment happy-dom
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../test/renderWithProviders';
import { Recurrence, TransactionLabel } from '../../types';
import TransactionForm from '../TransactionForm';

const budgets = [{ id: 'food', name: 'Food', totalLimit: 500 }];

function openForm(initialValues?: { amount?: number; vendor?: string; budgetId?: string }) {
  const onSave = vi.fn();
  renderWithProviders(<TransactionForm
    budgets={budgets} userId="user-1" userName="Alex"
    onClose={vi.fn()} onSave={onSave} initialValues={initialValues}
  />);
  return { onSave, user: userEvent.setup() };
}

describe('manual entry validation', () => {
  it('requires an amount, a named vendor and a vault, then saves the exact cents', async () => {
    const { user, onSave } = openForm();
    const vendor = screen.getByRole('combobox', { name: 'Vendor' });
    const food = screen.getByRole('button', { name: /^Food$/ });
    const confirm = screen.getByRole('button', { name: 'Confirm Entry' });
    expect(vendor).toBeDisabled();
    expect(food).toBeDisabled();
    expect(confirm).toBeDisabled();

    await user.type(screen.getByLabelText('Amount'), '1234.56');
    expect(vendor).toBeEnabled();
    expect(food).toBeDisabled();
    await user.type(vendor, ' '.repeat(3));
    expect(food).toBeDisabled();
    await user.clear(vendor);
    await user.type(vendor, '  Corner   Store  ');
    expect(food).toBeEnabled();
    expect(confirm).toBeDisabled();
    await user.click(food);
    await user.click(confirm);
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      amount: 1234.56, vendor: 'Corner Store', budget_id: 'food',
      recurrence: Recurrence.ONE_TIME, label: TransactionLabel.MANUAL, user_id: 'user-1',
    })));
  });

  it.each(['12abc', '1e3', '1k', '-12', '0.001', '12.345'])('rejects pasted %s and allows correction', async text => {
    const { user, onSave } = openForm({ vendor: 'Store', budgetId: 'food' });
    await user.paste(text);
    expect(screen.getByLabelText('Amount')).toHaveValue('');
    expect(screen.getByText('Paste an amount only, with up to two decimal places.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Confirm Entry' })).toBeDisabled();
    expect(onSave).not.toHaveBeenCalled();

    await user.paste('$12.34');
    await user.click(screen.getByRole('button', { name: 'Confirm Entry' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ amount: 12.34 })));
  });

  it('blocks zero and a deleted vault, then allows a valid selection', async () => {
    const { user, onSave } = openForm({ vendor: 'Store', budgetId: 'deleted-vault' });
    const amount = screen.getByLabelText('Amount');
    await user.type(amount, '0');
    await user.tab();
    expect(screen.getByText('Enter an amount greater than zero, with up to two decimal places.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Confirm Entry' })).toBeDisabled();
    await user.clear(amount);
    await user.type(amount, '0.01');
    expect(screen.getByRole('button', { name: 'Confirm Entry' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: /^Food$/ }));
    await user.click(screen.getByRole('button', { name: 'Confirm Entry' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ amount: 0.01, budget_id: 'food' })));
  });

  it.each(['12abc', '1e3', '-12', '12.345'])('rejects typed %s without saving a numeric prefix', async text => {
    const { user, onSave } = openForm({ vendor: 'Store', budgetId: 'food' });
    const amount = screen.getByLabelText('Amount');
    await user.type(amount, text);
    expect(amount).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Enter numbers only, with up to two decimal places.')).toBeVisible();
    await user.tab();
    expect(amount).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('button', { name: 'Confirm Entry' })).toBeDisabled();
    fireEvent.submit(screen.getByRole('form', { name: 'Manual entry' }));
    expect(onSave).not.toHaveBeenCalled();

    await user.clear(amount);
    await user.type(amount, '12.34');
    await user.click(screen.getByRole('button', { name: 'Confirm Entry' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ amount: 12.34 })));
  });

  it('rejects a whole mobile insertion before formatting and allows a replacement', async () => {
    const { user, onSave } = openForm({ vendor: 'Store', budgetId: 'food' });
    const amount = screen.getByLabelText('Amount');
    fireEvent.input(amount, { target: { value: '12abc' }, inputType: 'insertText', data: '12abc' });
    expect(amount).toHaveValue('');
    expect(amount).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('button', { name: 'Confirm Entry' })).toBeDisabled();
    fireEvent.input(amount, { target: { value: '12.34' }, inputType: 'insertText', data: '12.34' });
    await user.click(screen.getByRole('button', { name: 'Confirm Entry' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ amount: 12.34 })));
  });

  it('lets Backspace erase a rejected attempt on an empty field', async () => {
    const { user, onSave } = openForm({ vendor: 'Store', budgetId: 'food' });
    const amount = screen.getByLabelText('Amount');
    await user.type(amount, '-');
    expect(amount).toHaveValue('');
    expect(amount).toHaveAttribute('aria-invalid', 'true');
    await user.keyboard('{Backspace}1');
    expect(amount).toHaveAttribute('aria-invalid', 'false');
    await user.click(screen.getByRole('button', { name: 'Confirm Entry' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ amount: 1 })));
  });

  it('allows completing zero into a positive amount after Next explains the error', async () => {
    const { user, onSave } = openForm({ vendor: 'Store', budgetId: 'food' });
    const amount = screen.getByLabelText('Amount');
    await user.type(amount, '0{Enter}');
    expect(amount).toHaveAttribute('aria-invalid', 'true');
    await user.type(amount, '.01');
    expect(amount).toHaveAttribute('aria-invalid', 'false');
    await user.click(screen.getByRole('button', { name: 'Confirm Entry' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ amount: 0.01 })));
  });

  it('accepts a decimal comma from the keyboard without changing cents', async () => {
    const { user, onSave } = openForm({ vendor: 'Store', budgetId: 'food' });
    const amount = screen.getByLabelText('Amount');
    await user.type(amount, '12,34');
    expect(amount).toHaveValue('12.34');
    await user.click(screen.getByRole('button', { name: 'Confirm Entry' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ amount: 12.34 })));
  });

  it.each([['1,2', '1,2'], ['1,,2', null], ['12,34', '12,34']])('rejects malformed whole insertion %s', async (text, data) => {
    const { user, onSave } = openForm({ vendor: 'Store', budgetId: 'food' });
    const amount = screen.getByLabelText('Amount');
    fireEvent.input(amount, { target: { value: text }, inputType: 'insertReplacementText', data });
    expect(amount).toHaveValue('');
    expect(amount).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('button', { name: 'Confirm Entry' })).toBeDisabled();
    await user.clear(amount);
    await user.type(amount, '12.34');
    await user.click(screen.getByRole('button', { name: 'Confirm Entry' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ amount: 12.34 })));
  });

  it('does not reuse an empty Backspace as permission to strip a later malformed replacement', async () => {
    const { user, onSave } = openForm({ vendor: 'Store', budgetId: 'food' });
    const amount = screen.getByLabelText('Amount');
    await user.keyboard('{Backspace}');
    fireEvent.input(amount, { target: { value: '1,,2' }, inputType: 'insertReplacementText', data: null });
    expect(amount).toHaveValue('');
    expect(amount).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('button', { name: 'Confirm Entry' })).toBeDisabled();
    await user.keyboard('{Backspace}');
    await user.type(amount, '12.34');
    await user.click(screen.getByRole('button', { name: 'Confirm Entry' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ amount: 12.34 })));
  });

  it('keeps a valid amount unchanged after a bad paste and accepts a corrected amount', async () => {
    const { user, onSave } = openForm({ amount: 12.34, vendor: 'Store', budgetId: 'food' });
    const amount = screen.getByLabelText('Amount');
    await user.click(amount);
    await user.paste('99abc');
    expect(amount).toHaveValue('12.34');
    await user.tab();
    expect(amount).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Paste an amount only, with up to two decimal places.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Confirm Entry' })).toBeDisabled();
    fireEvent.submit(screen.getByRole('form', { name: 'Manual entry' }));
    expect(onSave).not.toHaveBeenCalled();

    await user.clear(amount);
    await user.type(amount, '24.50');
    await user.click(screen.getByRole('button', { name: 'Confirm Entry' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ amount: 24.5 })));
  });

  it('refuses an amount above the storage limit, then allows a precise amount', async () => {
    const { user, onSave } = openForm({ vendor: 'Store', budgetId: 'food' });
    const amount = screen.getByLabelText('Amount');
    await user.type(amount, '10000000000');
    expect(screen.getByText('Enter an amount of $9,999,999,999.99 or less.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Confirm Entry' })).toBeDisabled();
    await user.clear(amount);
    await user.type(amount, '12.34');
    await user.click(screen.getByRole('button', { name: 'Confirm Entry' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ amount: 12.34 })));
  });

  it('explains an oversized pasted amount and saves the maximum without changing cents', async () => {
    const { user, onSave } = openForm({ vendor: 'Store', budgetId: 'food' });
    await user.paste('$10,000,000,000.00');
    expect(screen.getByLabelText('Amount')).toHaveValue('');
    expect(screen.getByText('Enter an amount of $9,999,999,999.99 or less.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Confirm Entry' })).toBeDisabled();

    await user.paste('$9,999,999,999.99');
    await user.click(screen.getByRole('button', { name: 'Confirm Entry' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ amount: 9999999999.99 })));
    expect(JSON.stringify(onSave.mock.calls[0][0].amount)).toBe('9999999999.99');
  });

  it('uses Enter to move through the required fields without saving early', async () => {
    const { user, onSave } = openForm();
    await user.type(screen.getByLabelText('Amount'), '24.50{Enter}');
    const vendor = screen.getByRole('combobox', { name: 'Vendor' });
    expect(vendor).toHaveFocus();
    await user.type(vendor, 'Store{Enter}');
    const food = screen.getByRole('button', { name: /^Food$/ });
    expect(food).toHaveFocus();
    expect(onSave).not.toHaveBeenCalled();
    await user.keyboard(' ');
    await user.click(screen.getByRole('button', { name: 'Confirm Entry' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ amount: 24.5, vendor: 'Store' })));
  });

  it('saves a refund as a negative amount while editing shows its magnitude', async () => {
    const onSave = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<TransactionForm
      budgets={budgets} userId="user-1" userName="Alex" onClose={vi.fn()} onSave={onSave}
      initialTransaction={{
        id: 'existing', vendor: 'Store', amount: -12.34, budget_id: 'food', user_id: 'user-1',
        date: '2026-09-01T12:00:00.000Z', recurrence: Recurrence.ONE_TIME, label: TransactionLabel.AUTOMATIC,
        is_projected: false, created_at: '2026-09-01T12:00:00.000Z',
      }}
    />);
    expect(screen.getByLabelText('Amount')).toHaveValue('12.34');
    expect(screen.getByRole('button', { name: /Refund/ })).toHaveAttribute('aria-pressed', 'true');
    await user.clear(screen.getByLabelText('Amount'));
    await user.type(screen.getByLabelText('Amount'), '15.25');
    await user.click(screen.getByRole('button', { name: 'Update Transaction' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      id: 'existing', amount: -15.25, label: TransactionLabel.AUTOMATIC,
    })));
  });

  it('checks the same requirements when the form is submitted directly', async () => {
    const { user, onSave } = openForm({ amount: 12.34, vendor: 'Store', budgetId: 'deleted' });
    const form = screen.getByRole('form', { name: 'Manual entry' });
    fireEvent.submit(form);
    expect(onSave).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /^Food$/ }));
    fireEvent.submit(form);
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ amount: 12.34, budget_id: 'food' })));
  });

  it('asks for a real calendar date and allows the user to repair it', async () => {
    const onSave = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<TransactionForm
      budgets={budgets} userId="user-1" userName="Alex" onClose={vi.fn()} onSave={onSave}
      initialTransaction={{
        id: 'existing', vendor: 'Store', amount: 12.34, budget_id: 'food', user_id: 'user-1',
        date: '2026-02-29T12:00:00.000Z', recurrence: Recurrence.ONE_TIME,
        is_projected: false, created_at: '2026-01-01T12:00:00.000Z',
      }}
    />);
    expect(screen.getByText('Choose a valid date.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Update Transaction' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Date Choose a date' }));
    const calendar = screen.getByRole('dialog', { name: 'Choose a date' });
    await user.click(within(calendar).getByRole('button', { name: /^2$/ }));
    await waitFor(() => expect(calendar).not.toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Update Transaction' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ date: '2026-03-02T12:00:00.000Z' })));
  });

  it('does not reintroduce a hidden vault through vendor history', async () => {
    const onSave = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<TransactionForm
      budgets={[...budgets, { id: 'transport', name: 'Transport', totalLimit: 200 }]}
      hiddenCategories={['transport']} vendorHistory={[{ vendor: 'Fuel Shop', budget_id: 'transport' }]}
      userId="user-1" userName="Alex" onClose={vi.fn()} onSave={onSave}
      initialValues={{ amount: 12.34 }}
    />);
    await user.type(screen.getByRole('combobox', { name: 'Vendor' }), 'Fuel');
    await user.click(screen.getByRole('option', { name: /Fuel Shop/ }));
    expect(screen.queryByRole('button', { name: 'Transport' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm Entry' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: /^Food$/ }));
    await user.click(screen.getByRole('button', { name: 'Confirm Entry' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ vendor: 'Fuel Shop', budget_id: 'food' })));
  });

  it('preserves the hidden vault an existing entry is already filed under', async () => {
    const onSave = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<TransactionForm
      budgets={[...budgets, { id: 'transport', name: 'Transport', totalLimit: 200 }]}
      hiddenCategories={['transport']} userId="user-1" userName="Alex" onClose={vi.fn()} onSave={onSave}
      initialTransaction={{
        id: 'existing', vendor: 'Fuel Shop', amount: 12.34, budget_id: 'transport', user_id: 'user-1',
        date: '2026-09-01T12:00:00.000Z', recurrence: Recurrence.ONE_TIME,
        is_projected: false, created_at: '2026-09-01T12:00:00.000Z',
      }}
    />);
    expect(screen.getByRole('button', { name: 'Transport' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'Update Transaction' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ amount: 12.34, budget_id: 'transport' })));
  });

  it('records one entry while saving is pending even if the form is submitted again', async () => {
    let finishSave: (() => void) | undefined;
    const saving = new Promise<void>(resolve => { finishSave = resolve; });
    const onSave = vi.fn(() => saving);
    renderWithProviders(<TransactionForm
      budgets={budgets} userId="user-1" userName="Alex" onClose={vi.fn()} onSave={onSave}
      initialValues={{ amount: 12.34, vendor: 'Store', budgetId: 'food' }}
    />);
    const form = screen.getByRole('form', { name: 'Manual entry' });
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ amount: 12.34, vendor: 'Store', budget_id: 'food' }));
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
    finishSave?.();
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Manual entry' })).toHaveClass('dialog-exiting'));
  });
});
