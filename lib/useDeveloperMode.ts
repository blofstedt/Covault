import { useEffect, useRef, useState, useCallback } from 'react';
import { Capacitor } from '@capacitor/core';

const KEYWORD = 'developer';

/**
 * Hook that activates/deactivates developer mode when the user types "developer"
 * on a physical keyboard. Only works on non-native (desktop/web) platforms.
 *
 * Returns `[isActive, toggle]` where `toggle` can explicitly flip the mode.
 */
export function useDeveloperMode(): [boolean, () => void] {
  const [active, setActive] = useState(false);
  const bufferRef = useRef('');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toggle = useCallback(() => setActive((prev) => !prev), []);

  useEffect(() => {
    // Developer mode is desktop-only
    if (Capacitor.isNativePlatform()) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore key presses when the user is typing inside an input/textarea/contenteditable
      const target = e.target as HTMLElement;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) {
        return;
      }

      // Only accept single printable characters (no modifier keys)
      if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return;

      bufferRef.current += e.key.toLowerCase();

      // Reset buffer after 2 seconds of inactivity
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        bufferRef.current = '';
      }, 2000);

      // Check if the buffer ends with the keyword
      if (bufferRef.current.endsWith(KEYWORD)) {
        bufferRef.current = '';
        setActive((prev) => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return [active, toggle];
}
