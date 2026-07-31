// lib/haptics.ts
//
// Thin, always-safe wrapper around @capacitor/haptics.
//
// Haptics are used sparingly on purpose: a light tap when something is filed,
// a firmer one when something is destroyed or a budget is blown. Nothing on
// scroll, navigation, or ordinary taps — constant buzzing is how a nice touch
// becomes a reason to turn notifications off entirely.
//
// Every call is a no-op unless it's a native platform, the user has haptics on,
// and the OS isn't asking for reduced motion. Nothing here ever throws or
// awaits anything the caller has to handle.

import { Capacitor } from '@capacitor/core';
import { log } from './log';

let enabled = true;

/** Kept in module state so call sites don't each need the settings object. */
export function setHapticsEnabled(value: boolean): void {
  enabled = value !== false;
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export function hapticsAllowed(): boolean {
  return enabled && Capacitor.isNativePlatform() && !prefersReducedMotion();
}

/**
 * Dynamic import so @capacitor/haptics stays out of the entry bundle and off
 * the web build's critical path entirely — it's never called there.
 */
async function impact(style: 'Light' | 'Medium' | 'Heavy'): Promise<void> {
  if (!hapticsAllowed()) return;
  try {
    const { Haptics, ImpactStyle } = await import('@capacitor/haptics');
    await Haptics.impact({ style: ImpactStyle[style] });
  } catch (e) {
    // A device without a vibrator, or a permission quirk. Never worth
    // surfacing — the visual feedback already happened.
    log.debug('[haptics] unavailable:', e);
  }
}

/** Something was accepted, filed, or confirmed. The common case. */
export function hapticTap(): void {
  void impact('Light');
}

/** Something was deleted, or a limit was crossed. Rarer, so it can be firmer. */
export function hapticWarn(): void {
  void impact('Medium');
}

/** A multi-item action completed (bulk accept). One notch above a single tap. */
export function hapticSuccess(): void {
  if (!hapticsAllowed()) return;
  void (async () => {
    try {
      const { Haptics, NotificationType } = await import('@capacitor/haptics');
      await Haptics.notification({ type: NotificationType.Success });
    } catch (e) {
      log.debug('[haptics] unavailable:', e);
    }
  })();
}
