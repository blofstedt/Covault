import { useCallback, useEffect, useRef, useState } from 'react';

export const DIALOG_EXIT_DURATION_MS = 320;

/** Keep the dialog mounted for the shared exit transition before closing it. */
export function useDialogExit() {
  const [isClosing, setIsClosing] = useState(false);
  const isClosingRef = useRef(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const close = useCallback((onClose: () => void) => {
    if (isClosingRef.current) return;
    isClosingRef.current = true;

    const reduceMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) {
      onClose();
      return;
    }

    setIsClosing(true);
    closeTimerRef.current = setTimeout(onClose, DIALOG_EXIT_DURATION_MS);
  }, []);

  useEffect(() => () => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
  }, []);

  return { isClosing, close };
}
