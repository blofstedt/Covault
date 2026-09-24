// lib/queryClient.ts
//
// The one React Query cache for the app.
//
// Scope, on purpose: this caches the reads a SCREEN makes when it opens, so
// going back to a screen draws what it showed last time instantly and quietly
// checks for anything newer, and so a screen can be loaded before it is
// opened (see lib/queries/). It does NOT hold transactions, budgets or
// settings. Those are loaded once by lib/hooks/useDataLoading.ts, which
// already draws the last-seen data on launch (lib/firstPaintCache.ts) and
// carries rules a generic cache would break — a failed read never replaces
// what is on screen, an older answer never overwrites a newer one, and the
// column-name fallbacks. Moving them in here means re-proving all of that.
import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Fresh for 30 seconds: opening a screen twice in quick succession
      // reuses the answer rather than asking again. After that the cached
      // answer is still DRAWN at once and replaced when the network answers.
      staleTime: 30_000,
      // Kept for half an hour after its screen closes, so a return visit
      // within a session never starts from an empty screen.
      gcTime: 30 * 60_000,
      retry: 1,
      // A WebView gains and loses focus for reasons that have nothing to do
      // with the user coming back (the keyboard, a system sheet). A refetch
      // on each of those is traffic for nothing; opening the screen is the
      // signal.
      refetchOnWindowFocus: false,
    },
  },
});
