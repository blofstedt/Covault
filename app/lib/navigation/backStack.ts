/**
 * What the Android back button means, in one place.
 *
 * Anything on screen that the user would expect "back" to close registers a
 * handler here while it is open. The button asks the stack, and the most
 * recently opened thing of the highest layer answers. When nothing answers the
 * app steps aside to the home screen, as every Android app does.
 *
 * Layers rather than one flat list because the order things were opened in is
 * not always the order they sit in: the walkthrough is drawn over everything
 * and a dialog over a page, whatever registered first.
 */

export type BackLayer = 'page' | 'modal' | 'walkthrough';

/** Return `false` to decline, which lets the next handler down have a go. */
export type BackHandler = () => boolean | void;

interface Entry {
  handler: BackHandler;
  layer: BackLayer;
  order: number;
}

const LAYER_RANK: Record<BackLayer, number> = { page: 0, modal: 1, walkthrough: 2 };

const entries: Entry[] = [];
let nextOrder = 0;

/** Registers a handler; the returned function takes it off again. */
export function pushBackHandler(handler: BackHandler, layer: BackLayer = 'page'): () => void {
  const entry: Entry = { handler, layer, order: nextOrder++ };
  entries.push(entry);
  return () => {
    const index = entries.indexOf(entry);
    if (index !== -1) entries.splice(index, 1);
  };
}

/** Runs the topmost handler that accepts. `true` means something took the press. */
export function handleBack(): boolean {
  const ranked = [...entries].sort(
    (a, b) => LAYER_RANK[b.layer] - LAYER_RANK[a.layer] || b.order - a.order,
  );
  for (const entry of ranked) {
    if (entry.handler() !== false) return true;
  }
  return false;
}
