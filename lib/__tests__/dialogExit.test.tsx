// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DIALOG_EXIT_DURATION_MS, useDialogExit } from '../hooks/useDialogExit';

let container: HTMLDivElement;
let root: Root;
let originalMatchMedia: typeof window.matchMedia;

function ExitProbe({ onClose }: { onClose: () => void }) {
  const { isClosing, close } = useDialogExit();
  return (
    <button
      data-closing={isClosing}
      onClick={() => close(onClose)}
    >
      Close
    </button>
  );
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  originalMatchMedia = window.matchMedia;
  window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as typeof window.matchMedia;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  vi.useFakeTimers();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  window.matchMedia = originalMatchMedia;
  vi.useRealTimers();
});

describe('dialog exit feedback', () => {
  it('keeps the dialog open for one shared-motion duration and ignores repeated closes', async () => {
    const onClose = vi.fn();
    await act(async () => root.render(<ExitProbe onClose={onClose} />));
    const button = document.querySelector<HTMLButtonElement>('button');
    if (!button) throw new Error('Exit probe did not render');

    act(() => {
      button.click();
      button.click();
    });

    expect(button.dataset.closing).toBe('true');
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(DIALOG_EXIT_DURATION_MS - 1));
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('closes immediately when reduced motion is requested', async () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as typeof window.matchMedia;
    const onClose = vi.fn();
    await act(async () => root.render(<ExitProbe onClose={onClose} />));
    const button = document.querySelector<HTMLButtonElement>('button');
    if (!button) throw new Error('Exit probe did not render');

    act(() => button.click());

    expect(onClose).toHaveBeenCalledOnce();
    expect(button.dataset.closing).toBe('false');
  });
});
