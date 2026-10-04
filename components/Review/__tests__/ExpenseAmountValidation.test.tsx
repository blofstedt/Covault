// @vitest-environment happy-dom
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../../test/renderWithProviders';
import { FuelHoldPrompt } from '../../Review/FuelHoldPrompt';
import UnsettledHoldsCard from '../../Review/UnsettledHoldsCard';

const hold = { id: 'hotel-hold', vendor: 'Hotel', amount: 250, at: Date.UTC(2026, 8, 1) };
const fuelHold = { holdAmount: 150, placeholderAmount: 100, basis: 'default' as const };

function openAmount(kind: 'held' | 'fuel', save = vi.fn()) {
  const user = userEvent.setup();
  if (kind === 'held') {
    renderWithProviders(<UnsettledHoldsCard holds={[hold]} onRecord={save} onDismiss={vi.fn()} />);
  } else {
    renderWithProviders(<FuelHoldPrompt hold={fuelHold} onSubmit={save} onKeepPlaceholder={vi.fn()} />);
  }
  return {
    user, save,
    open: async () => {
      if (kind === 'fuel') await user.click(screen.getByRole('button', { name: 'Enter what you paid' }));
      return screen.getByRole<HTMLInputElement>('textbox', { name: /Amount actually paid/ });
    },
    button: () => screen.getByRole('button', { name: kind === 'held' ? 'Add it' : 'Save' }),
  };
}

describe.each(['held', 'fuel'] as const)('%s expense amounts', kind => {
  it.each(['12abc', '1e3', '-12', '12.345'])('rejects typed %s and saves exact cents after correction', async text => {
    const { user, save, open, button } = openAmount(kind);
    const amount = await open();
    expect(amount).toHaveValue('');
    expect(button()).toBeDisabled();
    await user.type(amount, text);
    await user.tab();
    expect(amount).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Enter numbers only, with up to two decimal places.')).toBeVisible();
    expect(button()).toBeDisabled();
    await user.click(amount);
    await user.keyboard('{Enter}');
    expect(save).not.toHaveBeenCalled();
    await user.clear(amount);
    await user.type(amount, '72.43{Enter}');
    await waitFor(() => kind === 'held'
      ? expect(save).toHaveBeenCalledWith(hold, 72.43)
      : expect(save).toHaveBeenCalledWith(72.43));
  });

  it('keeps invalid mobile text and clipboard attempts blocked through blur', async () => {
    const { user, save, open, button } = openAmount(kind);
    const amount = await open();
    fireEvent.input(amount, { target: { value: '12abc' }, inputType: 'insertText', data: '12abc' });
    expect(amount).toHaveValue('');
    expect(amount).toHaveAttribute('aria-invalid', 'true');
    await user.click(amount);
    await user.paste('$72.43');
    expect(amount).toHaveValue('72.43');
    await user.paste('-12');
    await user.tab();
    expect(amount).toHaveValue('72.43');
    expect(screen.getByText('Paste an amount only, with up to two decimal places.')).toBeVisible();
    expect(button()).toBeDisabled();
    expect(save).not.toHaveBeenCalled();
    await user.clear(amount);
    await user.paste('$72.43');
    await user.click(button());
    await waitFor(() => kind === 'held'
      ? expect(save).toHaveBeenCalledWith(hold, 72.43)
      : expect(save).toHaveBeenCalledWith(72.43));
  });

  it('explains zero and the storage limit, then saves the maximum exactly', async () => {
    const { user, save, open, button } = openAmount(kind);
    const amount = await open();
    await user.type(amount, '0{Enter}');
    expect(screen.getByText('Enter an amount greater than zero, with up to two decimal places.')).toBeVisible();
    expect(button()).toBeDisabled();
    await user.clear(amount);
    await user.paste('$10,000,000,000.00');
    expect(screen.getByText('Enter an amount of $9,999,999,999.99 or less.')).toBeVisible();
    expect(button()).toBeDisabled();
    await user.paste('$9,999,999,999.99');
    await user.click(button());
    await waitFor(() => kind === 'held'
      ? expect(save).toHaveBeenCalledWith(hold, 9999999999.99)
      : expect(save).toHaveBeenCalledWith(9999999999.99));
    expect(JSON.stringify(save.mock.calls[0][kind === 'held' ? 1 : 0])).toBe('9999999999.99');
  });

  it.each([['56', '12.56', 12.56], ['00', '12.00', 12]])('allows replacing fractional digits with %s', async (text, display, saved) => {
    const { user, save, open, button } = openAmount(kind);
    const amount = await open();
    await user.type(amount, '12.34');
    amount.setSelectionRange(3, 5);
    await user.paste(String(text));
    expect(amount).toHaveValue(display);
    await user.click(button());
    await waitFor(() => kind === 'held'
      ? expect(save).toHaveBeenCalledWith(hold, saved)
      : expect(save).toHaveBeenCalledWith(saved));
  });

  it('disables the amount and avoids another save while saving is pending', async () => {
    let finish: (() => void) | undefined;
    const pending = new Promise<void>(resolve => { finish = resolve; });
    const save = vi.fn(() => pending);
    const { user, open, button } = openAmount(kind, save);
    const amount = await open();
    await user.type(amount, '72.43');
    await user.click(button());
    expect(amount).toBeDisabled();
    const busy = screen.getByRole('button', { name: kind === 'held' ? 'Adding…' : 'Saving…' });
    expect(busy).toBeDisabled();
    await user.click(busy);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]).toEqual(kind === 'held' ? [hold, 72.43] : [72.43]);
    finish?.();
    await waitFor(() => expect(button()).toBeEnabled());
  });
});

it('connects each fuel input to its own help and restores focus when reopening', async () => {
  const user = userEvent.setup();
  renderWithProviders(<>
    <FuelHoldPrompt hold={fuelHold} onSubmit={vi.fn()} onKeepPlaceholder={vi.fn()} />
    <FuelHoldPrompt hold={fuelHold} onSubmit={vi.fn()} onKeepPlaceholder={vi.fn()} />
  </>);
  for (const opener of screen.getAllByRole('button', { name: 'Enter what you paid' })) await user.click(opener);
  const amounts = screen.getAllByRole('textbox', { name: 'Amount actually paid' });
  expect(amounts[1]).toHaveFocus();
  await user.type(amounts[0], 'abc');
  expect(amounts[0]).toHaveAccessibleDescription('Enter numbers only, with up to two decimal places.');
  expect(amounts[1]).toHaveAccessibleDescription('Use numbers and up to two decimal places.');
  await user.click(amounts[1]);
  await user.keyboard('{Escape}');
  await user.click(screen.getByRole('button', { name: 'Enter what you paid' }));
  expect(screen.getAllByRole('textbox', { name: 'Amount actually paid' })[1]).toHaveFocus();
});

it('keeps a fuel rejection through closing and reopening until the amount is corrected', async () => {
  const { user, save, open, button } = openAmount('fuel');
  const amount = await open();
  await user.type(amount, '1e3{Escape}');
  await user.click(screen.getByRole('button', { name: 'Enter what you paid' }));
  const reopened = screen.getByRole('textbox', { name: 'Amount actually paid' });
  await user.type(reopened, '4');
  expect(reopened).toHaveAttribute('aria-invalid', 'true');
  expect(button()).toBeDisabled();
  expect(save).not.toHaveBeenCalled();
  await user.clear(reopened);
  await user.type(reopened, '72.43{Enter}');
  await waitFor(() => expect(save).toHaveBeenCalledWith(72.43));
});
