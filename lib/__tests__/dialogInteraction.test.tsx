// @vitest-environment happy-dom
import { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ConfirmModal from '../../components/ui/ConfirmModal';
import NoticeModal from '../../components/ui/NoticeModal';
import { useDialogInteraction } from '../hooks/useDialogInteraction';
import { DIALOG_EXIT_DURATION_MS } from '../hooks/useDialogExit';

let container: HTMLDivElement;
let root: Root;
let trigger: HTMLButtonElement;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div');
  trigger = document.createElement('button');
  trigger.textContent = 'Open dialog';
  document.body.append(container, trigger);
  trigger.focus();
  root = createRoot(container);
  document.body.style.overflow = 'clip';
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
  container.remove();
  trigger.remove();
  document.body.style.overflow = '';
});

function pressKey(element: HTMLElement, key: string, shiftKey = false): void {
  const event = new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true });
  element.dispatchEvent(event);
}

function DisabledInitialFocusDialog() {
  const dialogRef = useRef<HTMLDivElement>(null);
  const handleKeyDown = useDialogInteraction(dialogRef, () => {});

  return (
    <div ref={dialogRef} role="dialog" tabIndex={-1} onKeyDown={handleKeyDown}>
      <button data-dialog-initial-focus disabled>
        Busy
      </button>
      <button>Continue</button>
    </div>
  );
}

function LayeredDialogs({
  showLowerDialog,
  onWalkthroughEscape,
  onLowerEscape,
}: {
  showLowerDialog: boolean;
  onWalkthroughEscape: () => void;
  onLowerEscape: () => void;
}) {
  const walkthroughRef = useRef<HTMLDivElement>(null);
  const lowerDialogRef = useRef<HTMLDivElement>(null);
  const walkthroughKeyDown = useDialogInteraction(
    walkthroughRef,
    onWalkthroughEscape,
    { layer: 'walkthrough' },
  );
  const lowerDialogKeyDown = useDialogInteraction(lowerDialogRef, onLowerEscape);

  return (
    <>
      <div ref={walkthroughRef} role="dialog" aria-modal="true" tabIndex={-1} onKeyDown={walkthroughKeyDown}>
        <button data-dialog-initial-focus>Continue walkthrough</button>
      </div>
      {showLowerDialog && (
        <div ref={lowerDialogRef} role="dialog" aria-modal="true" tabIndex={-1} onKeyDown={lowerDialogKeyDown}>
          <button>Open entry</button>
        </div>
      )}
    </>
  );
}

describe('shared modal interaction', () => {
  it('keeps confirmation keyboard focus contained and restores the page on close', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();

    await act(async () =>
      root.render(
        <ConfirmModal
          title="Delete this entry?"
          message="This cannot be undone."
          confirmLabel="Delete"
          onConfirm={onConfirm}
          onCancel={onCancel}
        />,
      ),
    );

    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    const confirmButton = Array.from(document.querySelectorAll('button')).find(
      (button) => button.textContent === 'Delete',
    );
    const cancelButton = document.querySelector<HTMLElement>('[data-dialog-initial-focus]');
    if (!dialog || !confirmButton || !cancelButton) throw new Error('Confirmation dialog did not render');

    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(document.getElementById(dialog.getAttribute('aria-labelledby') ?? '')?.textContent).toBe(
      'Delete this entry?',
    );
    expect(document.getElementById(dialog.getAttribute('aria-describedby') ?? '')?.textContent).toBe(
      'This cannot be undone.',
    );
    expect(document.activeElement).toBe(cancelButton);
    expect(document.body.style.overflow).toBe('hidden');

    confirmButton.focus();
    act(() => pressKey(confirmButton, 'Tab', true));
    expect(document.activeElement).toBe(cancelButton);

    act(() => pressKey(cancelButton, 'Tab'));
    expect(document.activeElement).toBe(confirmButton);

    vi.useFakeTimers();
    act(() => pressKey(dialog, 'Escape'));
    expect(onCancel).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(dialog);
    act(() => {
      pressKey(dialog, 'Tab');
      pressKey(dialog, 'Escape');
    });
    expect(document.activeElement).toBe(dialog);
    expect(onCancel).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(DIALOG_EXIT_DURATION_MS));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();

    await act(async () => root.unmount());
    expect(document.activeElement).toBe(trigger);
    expect(document.body.style.overflow).toBe('clip');
  });

  it('labels the notice and gives its acknowledgement button initial focus', async () => {
    const onDismiss = vi.fn();

    await act(async () =>
      root.render(
        <NoticeModal
          title="Saved"
          message="Your choice is up to date."
          onDismiss={onDismiss}
        />,
      ),
    );

    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    const dismissButton = document.querySelector<HTMLElement>('[data-dialog-initial-focus]');
    if (!dialog || !dismissButton) throw new Error('Notice dialog did not render');

    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(document.getElementById(dialog.getAttribute('aria-labelledby') ?? '')?.textContent).toBe(
      'Saved',
    );
    expect(document.activeElement).toBe(dismissButton);

    vi.useFakeTimers();
    act(() => pressKey(dialog, 'Escape'));
    expect(onDismiss).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(DIALOG_EXIT_DURATION_MS));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('lets only the top dialog handle Escape when dialogs overlap', async () => {
    const onCancel = vi.fn();
    const onDismiss = vi.fn();

    await act(async () =>
      root.render(
        <>
          <ConfirmModal
            title="Confirm"
            message="This is the lower dialog."
            confirmLabel="Continue"
            onConfirm={vi.fn()}
            onCancel={onCancel}
          />
          <NoticeModal title="Notice" message="This is on top." onDismiss={onDismiss} />
        </>,
      ),
    );

    const dialogs = document.querySelectorAll<HTMLElement>('[role="dialog"]');
    if (dialogs.length !== 2) throw new Error('Both dialogs did not render');

    act(() => pressKey(dialogs[0], 'Escape'));
    expect(onCancel).not.toHaveBeenCalled();

    vi.useFakeTimers();
    act(() => pressKey(dialogs[1], 'Escape'));
    expect(onDismiss).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(DIALOG_EXIT_DURATION_MS));
    expect(onDismiss).toHaveBeenCalledOnce();
    expect(document.body.style.overflow).toBe('hidden');
  });

  it('keeps a visible walkthrough above a stage dialog mounted later', async () => {
    const onWalkthroughEscape = vi.fn();
    const onLowerEscape = vi.fn();

    await act(async () =>
      root.render(
        <LayeredDialogs
          showLowerDialog={false}
          onWalkthroughEscape={onWalkthroughEscape}
          onLowerEscape={onLowerEscape}
        />,
      ),
    );
    const walkthrough = document.querySelector<HTMLElement>('[role="dialog"]');
    const walkthroughButton = document.querySelector<HTMLButtonElement>('[data-dialog-initial-focus]');
    if (!walkthrough || !walkthroughButton) throw new Error('Walkthrough did not render');

    await act(async () =>
      root.render(
        <LayeredDialogs
          showLowerDialog
          onWalkthroughEscape={onWalkthroughEscape}
          onLowerEscape={onLowerEscape}
        />,
      ),
    );
    const lowerDialog = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]'))
      .find((dialog) => dialog !== walkthrough);
    if (!lowerDialog) throw new Error('Stage dialog did not render');

    expect(document.activeElement).toBe(walkthroughButton);
    act(() => pressKey(lowerDialog, 'Escape'));
    expect(onLowerEscape).not.toHaveBeenCalled();
    act(() => pressKey(walkthrough, 'Escape'));
    expect(onWalkthroughEscape).toHaveBeenCalledOnce();
  });

  it('leaves an aria-hidden walkthrough fixture inert', async () => {
    const onCancel = vi.fn();
    container.setAttribute('aria-hidden', 'true');

    await act(async () =>
      root.render(
        <ConfirmModal
          title="Confirm"
          message="The fixture is hidden."
          confirmLabel="Continue"
          onConfirm={vi.fn()}
          onCancel={onCancel}
        />,
      ),
    );

    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    if (!dialog) throw new Error('Notice dialog did not render');

    expect(document.activeElement).toBe(trigger);
    expect(document.body.style.overflow).toBe('clip');
    act(() => pressKey(dialog, 'Escape'));
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('does not focus or trap a dialog inside a natively inert fixture', async () => {
    const onCancel = vi.fn();
    container.setAttribute('inert', '');

    await act(async () =>
      root.render(
        <ConfirmModal
          title="Confirm"
          message="The fixture is inert."
          confirmLabel="Continue"
          onConfirm={vi.fn()}
          onCancel={onCancel}
        />,
      ),
    );

    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    if (!dialog) throw new Error('Confirmation dialog did not render');

    expect(document.activeElement).toBe(trigger);
    expect(document.body.style.overflow).toBe('clip');
    act(() => pressKey(dialog, 'Escape'));
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('skips a disabled requested target when choosing initial focus', async () => {
    await act(async () => root.render(<DisabledInitialFocusDialog />));

    expect(document.activeElement).toBe(document.querySelector('button:not([disabled])'));
    expect(document.body.style.overflow).toBe('hidden');
  });
});
