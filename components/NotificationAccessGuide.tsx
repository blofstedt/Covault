// components/NotificationAccessGuide.tsx
import { log } from '../lib/log';
import React, { useCallback, useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import type { CovaultNotificationPlugin } from '../lib/covaultNotification';
import {
  canPostCaptureNotifications,
  openAppInfo,
  openNotificationSettings,
  restrictedSettingsApply,
} from '../lib/covaultNotification';
import { requestPostNotifications } from '../lib/appNotifications';
import {
  buildSetupSteps,
  hasAttemptedListener,
  hasVisitedRestrictedSettings,
  isSetupComplete,
  markListenerAttempted,
  markRestrictedSettingsVisited,
  type AccessState,
  type SetupStep,
  type SetupStepId,
  type SetupStepStatus,
} from '../lib/notificationAccessSetup';

interface NotificationAccessGuideProps {
  /** The native plugin, or null before it has been registered. */
  plugin: CovaultNotificationPlugin | null;
  /**
   * Fired the first time notification access is seen as granted. The settings
   * screen uses it to switch capture on, so finishing the flow is the whole
   * job — there is no separate toggle left to remember.
   */
  onGranted?: () => void;
  /** Fired when every step is behind the user. */
  onComplete?: () => void;
}

/**
 * What each step says. Kept beside the copy it belongs to, not in the logic.
 *
 * The first step has two versions of itself and the difference matters more
 * than the words do. Where Android's restricted-settings block applies — a
 * sideloaded install on Android 13 or newer, which is every Covault install —
 * the switch is GOING to refuse, and the user needs to be told that before they
 * tap it rather than left to read a refusal as a failure. Where the block does
 * not apply, the same tap simply works, and promising a refusal that never
 * comes would be its own small lie.
 */
const STEP_COPY: Record<
  SetupStepId,
  { title: string; body: string; action: string }
> = {
  listener: {
    title: 'Tap the switch — it will refuse',
    body:
      "Opens Covault's own notification-access page. Tap the switch there. Android will not let it move, and that is exactly what should happen: being refused once is what makes the unlock in step 2 exist. Then come straight back here.",
    action: 'Open notification access',
  },
  restricted: {
    title: 'Allow restricted settings',
    body:
      'On the page that opens: tap the ⋮ at the top right, choose Allow restricted settings, and confirm with your fingerprint. That menu item is there only because the switch just refused you.',
    action: 'Open App info',
  },
  confirm: {
    title: 'Now turn the switch on',
    body:
      'Back to the same page as step 1. The switch will move this time — turn it on and confirm. Covault ticks this off by itself the moment it sees access.',
    action: 'Open notification access',
  },
  post: {
    title: 'Let Covault notify you',
    body:
      'So a purchase caught while the app is closed tells you about itself, and the bank alert can be replaced rather than doubled.',
    action: 'Allow notifications',
  },
};

/**
 * The first step where nothing is blocking it: one tap, and it works.
 *
 * Same step, same button — only the promise changes, because on this install
 * the switch is not going to refuse anything.
 */
const UNBLOCKED_LISTENER_COPY = {
  title: 'Turn on notification access',
  body:
    "Opens Covault's own permission page. Switch it on and confirm — this is what lets Covault read your bank's alerts. If the switch won't move, come back here: Android has one more thing to unlock and it only appears once you've tried.",
  action: 'Open notification access',
};

/**
 * Said once, above the steps, after a trip to the notification-access page
 * that didn't come back with access.
 *
 * Phrased as a question because it is a guess: all that is known is that the
 * user went and returned without the permission. Backing out of the page
 * without touching anything looks identical from here, and telling someone
 * their phone refused them when it didn't is how a guide loses their trust.
 */
const BLOCKED_HEADLINE = "The switch wouldn't move — good";
const BLOCKED_BODY =
  "That is the refusal these steps were waiting for. Covault didn't come from the Play Store, so Android holds notification access behind an unlock, and it only offers that unlock after an app has been refused once. Step 2 opens the page where it now lives.";

/** One clock for everything that moves in this card. */
const CLOCK = 'motion-safe:transition-all motion-safe:duration-[320ms] ease-[cubic-bezier(0.32,0.72,0.24,1)]';

/**
 * Where the ⋮ is on the App info page.
 *
 * The two notification-access steps land on the exact toggle they are talking
 * about, so they need no picture. This step cannot: "Allow restricted settings"
 * lives inside Android's own overflow menu, and no intent, extra or flag opens
 * a menu or points at an item inside one — the platform simply does not expose
 * it. A drawing of where to tap is the whole of what any app can do here, which
 * is why every app that asks for this permission draws one.
 *
 * Deliberately a sketch and not a screenshot: it has to be right on a phone
 * whose Settings look nothing like the one this was written on, and a wrong
 * screenshot is more confusing than an obviously schematic one.
 */
const AppInfoSketch: React.FC = () => (
  <div
    aria-hidden="true"
    className="mt-2 rounded-xl border border-amber-200/80 dark:border-amber-800/50 bg-white/70 dark:bg-slate-900/40 p-2"
  >
    <div className="flex items-center justify-between">
      <span className="text-[9px] font-semibold text-slate-400 dark:text-slate-500 tracking-wide">
        App info
      </span>
      <span className="relative flex items-center justify-center w-5 h-5">
        {/* The same pulse the app uses elsewhere to say "here", on the app's
            own clock rather than a faster one of its own. */}
        <span className="absolute inset-0 rounded-full bg-amber-400/40 motion-safe:animate-ping" />
        <span className="relative flex flex-col items-center justify-center gap-[2px] w-5 h-5 rounded-full bg-amber-100 dark:bg-amber-900/50 ring-1 ring-amber-400 dark:ring-amber-600">
          <span className="w-[2px] h-[2px] rounded-full bg-amber-700 dark:bg-amber-300" />
          <span className="w-[2px] h-[2px] rounded-full bg-amber-700 dark:bg-amber-300" />
          <span className="w-[2px] h-[2px] rounded-full bg-amber-700 dark:bg-amber-300" />
        </span>
      </span>
    </div>
    <div className="mt-1.5 ml-auto w-[70%] rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200/70 dark:border-amber-800/40 px-2 py-1">
      <span className="text-[9px] font-semibold text-amber-800 dark:text-amber-200">
        Allow restricted settings
      </span>
    </div>
  </div>
);

const CheckMark: React.FC = () => (
  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={3}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
  </svg>
);

/**
 * The step marker: number while there is work to do, check once there isn't.
 *
 * `assumed` gets the same emerald as `done` but hollow — the step is behind
 * the user without ever having been confirmed, and claiming a solid tick for
 * something Android will not report would be a lie the user pays for later.
 */
const StepMarker: React.FC<{ status: SetupStepStatus; number: number }> = ({ status, number }) => {
  const base = `w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 text-[11px] font-bold ${CLOCK}`;

  if (status === 'done') {
    return (
      <span className={`${base} bg-emerald-500 text-white`}>
        <CheckMark />
      </span>
    );
  }
  if (status === 'assumed') {
    return (
      <span
        className={`${base} bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-300 dark:border-emerald-700/60 text-emerald-600 dark:text-emerald-400`}
      >
        <CheckMark />
      </span>
    );
  }
  if (status === 'active') {
    return <span className={`${base} bg-amber-500 text-white`}>{number}</span>;
  }
  return (
    <span className={`${base} bg-slate-200 dark:bg-slate-700/60 text-slate-400 dark:text-slate-500`}>
      {number}
    </span>
  );
};

/**
 * The guided route to notification access.
 *
 * Replaces a collapsed list of written instructions that skipped the one step
 * nobody can guess. Every step here is a button that lands on the exact screen
 * it names, and the card re-checks itself every time the app comes back to the
 * foreground — for as long as it is on screen, not for a fixed window. The
 * previous flow watched for forty seconds and then stopped, which is less time
 * than the detour through the restricted-settings menu takes, so the common
 * case was permission granted and the app none the wiser.
 */
const NotificationAccessGuide: React.FC<NotificationAccessGuideProps> = ({
  plugin,
  onGranted,
  onComplete,
}) => {
  const isNative = Capacitor.isNativePlatform();
  const [state, setState] = useState<AccessState>({
    listenerGranted: false,
    canPostNotifications: true,
    restrictedApplies: false,
    listenerAttempted: hasAttemptedListener(),
    restrictedVisited: hasVisitedRestrictedSettings(),
  });
  const [busy, setBusy] = useState<SetupStepId | null>(null);
  // Fired once. `onGranted` switches capture on, and re-firing it would undo a
  // user who has since turned capture off with the permission still granted.
  const [announcedGrant, setAnnouncedGrant] = useState(false);
  const [announcedComplete, setAnnouncedComplete] = useState(false);

  const refresh = useCallback(async () => {
    if (!plugin) return;
    try {
      const [{ enabled: listenerGranted }, canPost, restrictedApplies] = await Promise.all([
        plugin.isEnabled(),
        canPostCaptureNotifications(plugin),
        restrictedSettingsApply(plugin),
      ]);
      setState({
        listenerGranted,
        canPostNotifications: canPost,
        restrictedApplies,
        listenerAttempted: hasAttemptedListener(),
        restrictedVisited: hasVisitedRestrictedSettings(),
      });
    } catch (e) {
      log.warn('[NotificationAccessGuide] refresh failed:', e);
    }
  }, [plugin]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Every route back into the app re-checks. `resume` is the Capacitor event;
  // `visibilitychange` covers the WebView being restored without one, which is
  // what happens on some devices when Settings is dismissed rather than backed
  // out of. Both are cheap, and a duplicate check costs nothing.
  useEffect(() => {
    if (!isNative) return;
    const onBack = () => { refresh(); };
    const onVisible = () => { if (!document.hidden) refresh(); };
    document.addEventListener('resume', onBack);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('resume', onBack);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [isNative, refresh]);

  useEffect(() => {
    if (state.listenerGranted && !announcedGrant) {
      setAnnouncedGrant(true);
      onGranted?.();
    }
  }, [state.listenerGranted, announcedGrant, onGranted]);

  useEffect(() => {
    if (isSetupComplete(state) && !announcedComplete) {
      setAnnouncedComplete(true);
      onComplete?.();
    }
  }, [state, announcedComplete, onComplete]);

  const runStep = async (id: SetupStepId) => {
    if (busy) return;
    setBusy(id);
    try {
      if (id === 'restricted') {
        // Recorded before the trip, not after: the WebView is often destroyed
        // while the user is away, so anything written on return may never run.
        markRestrictedSettingsVisited();
        setState((s) => ({ ...s, restrictedVisited: true }));
        await openAppInfo(plugin);
      } else if (id === 'listener' || id === 'confirm') {
        // Recorded before the trip for the same reason, and because the
        // attempt itself is what makes Android offer the unlock at all — so
        // this is also what reveals the step below.
        markListenerAttempted();
        setState((s) => ({ ...s, listenerAttempted: true }));
        await plugin?.requestAccess();
      } else {
        // Two routes, because Android offers the prompt once ever: ask, and if
        // the answer is still no — already denied, or the channel rather than
        // the app is switched off — the settings page is the only way left.
        await requestPostNotifications();
        const allowed = await canPostCaptureNotifications(plugin);
        setState((s) => ({ ...s, canPostNotifications: allowed }));
        if (!allowed) await openNotificationSettings(plugin);
      }
    } catch (e) {
      log.warn('[NotificationAccessGuide] step failed:', id, e);
    } finally {
      setBusy(null);
    }
  };

  if (!isNative) return null;

  const steps = buildSetupSteps(state);
  const complete = isSetupComplete(state);
  // The unlock is the step in hand, which can only happen after the switch has
  // refused. Once it is behind the user the headline goes back to the ordinary
  // one — the flow has a next step again, and dwelling on the refusal reads as
  // if it were still the problem.
  const blocked = steps.some((step) => step.id === 'restricted' && step.status === 'active');

  if (complete) {
    return (
      <div
        className={`rounded-2xl border border-emerald-200 dark:border-emerald-800/50 bg-emerald-50/70 dark:bg-emerald-950/25 px-3 py-2.5 ${CLOCK}`}
        data-testid="notification-access-guide"
      >
        <div className="flex items-center">
          <span className="w-2 h-2 rounded-full bg-emerald-500 mr-2 flex-shrink-0" />
          <span className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
            Capture is set up
          </span>
        </div>
        <p className="mt-1.5 text-[10px] leading-relaxed text-emerald-900/70 dark:text-emerald-200/70">
          Covault can read your bank's alerts and tell you what it caught. Nothing else to grant.
        </p>
      </div>
    );
  }

  return (
    <div
      className={`rounded-2xl border border-amber-200/70 dark:border-amber-800/40 bg-amber-50/60 dark:bg-amber-950/20 px-3 py-3 ${CLOCK}`}
      data-testid="notification-access-guide"
    >
      <span className="text-[11px] font-semibold text-amber-800 dark:text-amber-300">
        {state.listenerGranted
          ? 'One thing left'
          : blocked
            ? BLOCKED_HEADLINE
            : 'Set up capture'}
      </span>
      <p className="mt-1 text-[10px] leading-relaxed text-amber-900/70 dark:text-amber-200/70">
        {state.listenerGranted
          ? 'Capture is on. This last step is what lets Covault tell you about it.'
          : blocked
            ? BLOCKED_BODY
            : 'Android asks for these one screen at a time. Each button opens exactly the right page — come back here after each one and it ticks itself off.'}
      </p>

      <ol className="mt-3 space-y-3">
        {steps.map((step: SetupStep, index) => {
          // The first step reads differently where nothing is going to block
          // it — see UNBLOCKED_LISTENER_COPY. Keyed off the same flag that
          // decides whether the unlock step exists at all, so the promise and
          // the list can never disagree.
          const copy =
            step.id === 'listener' && !state.restrictedApplies
              ? UNBLOCKED_LISTENER_COPY
              : STEP_COPY[step.id];
          const settled = step.status === 'done' || step.status === 'assumed';
          // Numbered by position, because the list changes shape: the unlock
          // step appears only once Android has refused, and a fixed number per
          // step would leave a gap where it used to be.
          const number = index + 1;
          return (
            <li key={step.id} className="flex items-start space-x-3">
              <StepMarker status={step.status} number={number} />
              <div className="flex-1 min-w-0">
                <span
                  className={`block text-[11px] font-semibold ${CLOCK} ${
                    settled
                      ? 'text-emerald-700/80 dark:text-emerald-400/80'
                      : step.status === 'active'
                        ? 'text-amber-900 dark:text-amber-200'
                        : 'text-slate-400 dark:text-slate-500'
                  }`}
                >
                  {copy.title}
                </span>

                {/* Only the step in hand carries its instructions. Three
                    paragraphs of Android trivia at once is how the old help
                    text went unread. */}
                {step.status === 'active' && (
                  <>
                    <p className="mt-1 text-[10px] leading-relaxed text-amber-900/80 dark:text-amber-200/80">
                      {copy.body}
                    </p>
                    {step.id === 'restricted' && <AppInfoSketch />}
                    <button
                      type="button"
                      onClick={() => runStep(step.id)}
                      disabled={busy !== null}
                      className={`mt-2 inline-flex items-center px-2.5 py-1 rounded-full bg-amber-100 dark:bg-amber-900/40 border border-amber-300 dark:border-amber-700 text-[10px] font-semibold text-amber-800 dark:text-amber-200 ${CLOCK} ${
                        busy !== null ? 'opacity-50' : 'active:scale-[0.97]'
                      }`}
                    >
                      {copy.action} →
                    </button>
                  </>
                )}

                {/* The first visit, behind the user. It ticks off by being
                    made, because Android reports nothing about it and the
                    refusal it was expected to end in is not a failure to
                    report. The way back stays visible for the one case this
                    cannot tell apart: someone who backed out without tapping
                    anything. */}
                {step.id === 'listener' && step.status === 'assumed' && (
                  <button
                    type="button"
                    onClick={() => runStep(step.id)}
                    disabled={busy !== null}
                    className={`mt-1 text-[10px] font-medium text-amber-700/80 dark:text-amber-300/70 underline underline-offset-2 text-left ${CLOCK} ${
                      busy !== null ? 'opacity-50' : 'active:scale-[0.97]'
                    }`}
                  >
                    Didn't get as far as the switch? Open it again
                  </button>
                )}

                {/* The one step Android will not report back on. Saying so is
                    better than a tick the user can't trust, and it keeps the
                    way back visible if the switch above still won't move. */}
                {step.id === 'restricted' && step.status === 'assumed' && (
                  <button
                    type="button"
                    onClick={() => runStep(step.id)}
                    disabled={busy !== null}
                    className={`mt-1 text-[10px] font-medium text-amber-700/80 dark:text-amber-300/70 underline underline-offset-2 text-left ${CLOCK} ${
                      busy !== null ? 'opacity-50' : 'active:scale-[0.97]'
                    }`}
                  >
                    Switch still greyed out? Open App info again
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      <p className="mt-3 text-[10px] leading-relaxed text-amber-700/70 dark:text-amber-300/60">
        One-time setup. Android keeps these behind extra steps so no app can read your
        notifications without you saying so.
      </p>
    </div>
  );
};

export default NotificationAccessGuide;
