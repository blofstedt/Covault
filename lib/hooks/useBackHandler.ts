import { useEffect, useRef } from 'react';
import { pushBackHandler, type BackHandler, type BackLayer } from '../navigation/backStack';

/**
 * Makes the Android back button close this thing while `active` is true.
 *
 * The handler is read through a ref, so a new function every render does not
 * re-register it — that would move it to the top of the stack each time and
 * let a page jump ahead of a dialog opened after it.
 */
export function useBackHandler(
  active: boolean,
  handler: BackHandler,
  layer: BackLayer = 'page',
): void {
  const latest = useRef(handler);
  latest.current = handler;

  useEffect(() => {
    if (!active) return undefined;
    return pushBackHandler(() => latest.current(), layer);
  }, [active, layer]);
}
