// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../../../test/renderWithProviders';
import ErrorBoundary from '../ErrorBoundary';

vi.mock('../../../lib/observability/log', () => ({ log: { error: vi.fn() } }));
vi.mock('../../../lib/observability/errorReporting', () => ({ reportError: vi.fn() }));

afterEach(() => vi.restoreAllMocks());

describe('the crash screen', () => {
  it('offers refresh without displaying the exception text', () => {
    const privateDetail = 'private vendor data from a database exception';
    const BrokenChild = () => {
      throw new Error(privateDetail);
    };
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    renderWithProviders(
      <ErrorBoundary>
        <BrokenChild />
      </ErrorBoundary>,
    );

    expect(screen.getByRole('heading', { name: 'Something went wrong' })).toBeVisible();
    expect(screen.getByText('The app hit an unexpected error. Try refreshing the page.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeVisible();
    expect(document.body).not.toHaveTextContent(privateDetail);
  });
});
