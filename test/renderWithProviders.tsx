import type { ReactElement } from 'react';
import { render, type RenderOptions } from '@testing-library/react';
import { TestProviders } from './TestProviders';

export function renderWithProviders(ui: ReactElement, options?: Omit<RenderOptions, 'wrapper'>) {
  return render(ui, { ...options, wrapper: TestProviders });
}
