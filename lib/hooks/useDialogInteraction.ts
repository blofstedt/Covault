import { useLayoutEffect, type KeyboardEvent, type RefObject } from 'react';

let bodyScrollLockCount = 0;
let bodyOverflowBeforeLock: string | undefined;

type DialogLayer = 'modal' | 'walkthrough';

interface ActiveDialog {
  element: HTMLElement;
  layer: DialogLayer;
  order: number;
}

const activeDialogs: ActiveDialog[] = [];
let nextDialogOrder = 0;

function topDialog(): ActiveDialog | undefined {
  return activeDialogs.reduce<ActiveDialog | undefined>((top, current) => {
    if (!top) return current;
    if (current.layer !== top.layer) {
      return current.layer === 'walkthrough' ? current : top;
    }
    return current.order > top.order ? current : top;
  }, undefined);
}

function acquireBodyScrollLock(): () => void {
  if (bodyScrollLockCount === 0) {
    bodyOverflowBeforeLock = document.body.style.overflow;
  }

  bodyScrollLockCount += 1;
  document.body.style.overflow = 'hidden';

  let released = false;
  return () => {
    if (released) return;
    released = true;
    bodyScrollLockCount -= 1;

    if (bodyScrollLockCount === 0) {
      document.body.style.overflow = bodyOverflowBeforeLock ?? '';
      bodyOverflowBeforeLock = undefined;
    }
  };
}

function getFocusableElements(dialog: HTMLElement): HTMLElement[] {
  const selector =
    'a[href], area[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

  return Array.from(dialog.querySelectorAll<HTMLElement>(selector)).filter(
    (element) =>
      element.tabIndex >= 0 &&
      !element.closest('[hidden], [aria-hidden="true"], [inert]'),
  );
}

function getInitialFocusTarget(dialog: HTMLElement): HTMLElement {
  const focusableElements = getFocusableElements(dialog);
  const requestedInitialFocus = dialog.querySelector<HTMLElement>('[data-dialog-initial-focus]');
  return requestedInitialFocus && focusableElements.includes(requestedInitialFocus)
    ? requestedInitialFocus
    : focusableElements[0] ?? dialog;
}

/** Adds the keyboard and scroll behavior shared by modal dialogs. */
export function useDialogInteraction(
  dialogRef: RefObject<HTMLElement | null>,
  onEscape: () => void,
  { layer = 'modal', disabled = false }: { layer?: DialogLayer; disabled?: boolean } = {},
): (event: KeyboardEvent<HTMLElement>) => void {
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || dialog.closest('[aria-hidden="true"], [inert]')) return undefined;

    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const releaseScrollLock = acquireBodyScrollLock();
    const registration: ActiveDialog = { element: dialog, layer, order: nextDialogOrder++ };
    activeDialogs.push(registration);
    if (topDialog() === registration) getInitialFocusTarget(dialog).focus();

    return () => {
      const stackIndex = activeDialogs.indexOf(registration);
      if (stackIndex !== -1) activeDialogs.splice(stackIndex, 1);
      releaseScrollLock();
      const nextTop = topDialog();
      if (nextTop) {
        if (!nextTop.element.contains(document.activeElement)) {
          const previousFocusIsInNextTop =
            previousFocus?.isConnected && nextTop.element.contains(previousFocus);
          const target = previousFocusIsInNextTop
            ? previousFocus
            : getInitialFocusTarget(nextTop.element);
          target.focus();
        }
      } else if (previousFocus?.isConnected) {
        previousFocus.focus();
      }
    };
  }, [dialogRef, layer]);

  useLayoutEffect(() => {
    if (!disabled) return;
    dialogRef.current?.focus();
  }, [dialogRef, disabled]);

  return (event) => {
    const dialog = dialogRef.current;
    if (!dialog || topDialog()?.element !== dialog) return;

    if (disabled) {
      if (event.key === 'Escape' || event.key === 'Tab') {
        event.preventDefault();
        event.stopPropagation();
      }
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onEscape();
      return;
    }

    if (event.key !== 'Tab') return;

    const focusableElements = getFocusableElements(dialog);
    const first = focusableElements[0];
    const last = focusableElements[focusableElements.length - 1];

    if (!first || !last) {
      event.preventDefault();
      dialog.focus();
    } else if (
      event.shiftKey &&
      (document.activeElement === first || !dialog.contains(document.activeElement))
    ) {
      event.preventDefault();
      last.focus();
    } else if (
      !event.shiftKey &&
      (document.activeElement === last || !dialog.contains(document.activeElement))
    ) {
      event.preventDefault();
      first.focus();
    }
  };
}
