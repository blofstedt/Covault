import { useEffect, useRef } from 'react';

/**
 * Close-on-Escape for modals and popovers.
 *
 * Seven components each hand-rolled this same keydown effect, and several
 * dialogs (settings, subscribe, delete confirmation, FAQ) had no Escape
 * handling at all. Pass `enabled: false` to stand down while a sub-picker
 * is open, so Escape dismisses the innermost layer first.
 *
 * The handler is kept in a ref so a caller passing an inline arrow doesn't
 * re-register the listener on every render.
 */
export function useEscapeKey(onEscape: () => void, enabled = true): void {
  const handlerRef = useRef(onEscape);
  useEffect(() => {
    handlerRef.current = onEscape;
  }, [onEscape]);

  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handlerRef.current();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled]);
}

export default useEscapeKey;
