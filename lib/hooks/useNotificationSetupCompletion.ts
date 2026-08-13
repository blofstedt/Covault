// lib/hooks/useNotificationSetupCompletion.ts
import { log } from '../log';
import { useEffect, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { covaultNotification } from '../covaultNotification';
import { requestPostNotifications } from '../appNotifications';
import { clearSetupPending, isSetupPending, shouldEnableAfterGrant } from '../notificationAccessSetup';

interface Params {
  /** Covault's own capture switch. */
  enabled: boolean;
  /** Turn it on. Called at most once per run through the setup flow. */
  onEnable: () => void;
}

/**
 * Finish notification setup on the user's way back from Android's settings.
 *
 * Granting access means leaving Covault, and Android frequently destroys the
 * WebView while the user is away — so the code that notices the grant cannot
 * live on the settings screen they left from. It has to be here, at the top of
 * the app, running on every launch and every resume.
 *
 * What it replaces was a forty-second watcher started when the toggle was
 * tapped. Forty seconds is less than the trip takes, and it was the only thing
 * that switched capture on or asked for permission to post notifications. Past
 * that window the user came back to a granted OS permission, a Covault switch
 * still showing off, and no indication that the last step was theirs to do.
 *
 * The pending flag is what keeps this from being obnoxious: it fires only for
 * a user who asked for setup and hasn't finished it. Without it, "access is
 * granted" would be true forever, and anyone who deliberately turned capture
 * off would find it back on at the next launch.
 */
export function useNotificationSetupCompletion({ enabled, onEnable }: Params): void {
  // Read through refs so the check always sees current values without
  // re-registering the resume listener on every settings change.
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const onEnableRef = useRef(onEnable);
  onEnableRef.current = onEnable;

  useEffect(() => {
    if (!Capacitor.isNativePlatform() || !covaultNotification) return;

    let cancelled = false;

    const check = async () => {
      if (cancelled || !isSetupPending()) return;
      try {
        const { enabled: listenerGranted } = await covaultNotification.isEnabled();
        if (cancelled) return;

        if (
          shouldEnableAfterGrant({
            listenerGranted,
            settingEnabled: enabledRef.current,
            setupPending: true,
          })
        ) {
          // Cleared first: onEnable re-renders, and a second pass arriving
          // before the flag was written would ask twice.
          clearSetupPending();
          log.info('[setup] Notification access granted — switching capture on');
          onEnableRef.current();
          // Reading other apps' notifications and posting our own are separate
          // permissions and only the first has been asked for. Hiding a bank
          // alert depends on Covault having something to put in its place, so
          // this is asked at the moment capture starts rather than left to
          // whichever budget alert happens to fire first.
          await requestPostNotifications();
        } else if (listenerGranted && enabledRef.current) {
          // Already on — the flow is over, whoever finished it.
          clearSetupPending();
        }
      } catch (e) {
        log.debug('[setup] Could not check notification access:', e);
      }
    };

    void check();

    const handle = CapApp.addListener('resume', () => { void check(); });

    return () => {
      cancelled = true;
      void handle.then((h) => h.remove());
    };
  }, []);
}
