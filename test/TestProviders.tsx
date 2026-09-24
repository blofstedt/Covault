import type { PropsWithChildren } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { queryClient } from '../lib/queryClient';

/** Mount components under the same query client that the app uses. */
export function TestProviders({ children }: PropsWithChildren) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

afterEach(() => {
  cleanup();
  queryClient.clear();
});
