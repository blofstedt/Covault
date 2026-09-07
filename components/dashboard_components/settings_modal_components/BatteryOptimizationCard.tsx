import React, { useCallback, useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import {
  BATTERY_STEP_COPY,
  hasAskedBatteryExemption,
  markBatteryExemptionAsked,
  oemBatteryNote,
  shouldOfferBatteryExemption,
} from '../../../lib/batteryOptimization';
import {
  batteryOptimizationInfo,
  requestBatteryExemption,
  type CovaultNotificationPlugin,
} from '../../../lib/covaultNotification';

interface BatteryOptimizationCardProps {
  plugin: CovaultNotificationPlugin | null;
  /** Covault's own capture switch. Nothing to protect while it is off. */
  captureEnabled: boolean;
}

/**
 * The same ask as the setup flow's last step, for somebody who is already past
 * setup.
 *
 * The guided flow only appears while capture is being switched ON. Everybody
 * who turned it on before this existed — and everybody who reinstalls, since
 * the exemption is not carried over — would never be asked at all, and the
 * failure it prevents is the quietest one this app has: the listener stops
 * being woken, purchases stop arriving, and nothing anywhere says why.
 *
 * Its words come from lib/batteryOptimization.ts, the same constant the setup
 * step uses, so the two surfaces cannot drift into saying different things
 * about the same switch.
 *
 * Shown at most once per phone. This is a setting Covault can read back, so a
 * user who went to that screen and chose to leave optimisation on has given an
 * answer — and an app that asks again every time Settings is opened is an app
 * people learn to scroll past.
 */
const BatteryOptimizationCard: React.FC<BatteryOptimizationCardProps> = ({
  plugin,
  captureEnabled,
}) => {
  const isNative = Capacitor.isNativePlatform();
  const [exempt, setExempt] = useState(true);
  const [route, setRoute] = useState({ canRequestDirectly: false, manufacturer: '' });
  const [asked, setAsked] = useState(hasAskedBatteryExemption());
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!plugin) return;
    const info = await batteryOptimizationInfo(plugin);
    setExempt(info.exempt);
    setRoute({ canRequestDirectly: info.canRequestDirectly, manufacturer: info.manufacturer });
    setAsked(hasAskedBatteryExemption());
  }, [plugin]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // The answer is given in Android's settings, so the way back into the app is
  // the only moment there is to notice it.
  useEffect(() => {
    if (!isNative) return;
    const onBack = () => { refresh(); };
    document.addEventListener('resume', onBack);
    return () => document.removeEventListener('resume', onBack);
  }, [isNative, refresh]);

  const open = async () => {
    if (busy) return;
    setBusy(true);
    try {
      // Written before the trip: the WebView is routinely destroyed while the
      // user is away in Settings, so anything recorded on return may not run.
      markBatteryExemptionAsked();
      setAsked(true);
      await requestBatteryExemption(plugin, route);
    } finally {
      setBusy(false);
    }
  };

  if (!isNative) return null;
  if (!shouldOfferBatteryExemption({ captureEnabled, exempt, alreadyAsked: asked })) return null;

  const oem = oemBatteryNote(route.manufacturer);

  return (
    <div className="rounded-2xl border border-amber-200/70 dark:border-amber-800/40 bg-amber-50/60 dark:bg-amber-950/20 px-3 py-3">
      <span className="text-[11px] font-semibold text-amber-800 dark:text-amber-300">
        {BATTERY_STEP_COPY.title}
      </span>
      <p className="mt-1 text-[10px] leading-relaxed text-amber-900/80 dark:text-amber-200/80">
        {BATTERY_STEP_COPY.body}
      </p>
      {oem && (
        <p className="mt-1.5 text-[10px] leading-relaxed text-amber-900/70 dark:text-amber-200/70">
          {oem}
        </p>
      )}
      <button
        type="button"
        onClick={open}
        disabled={busy}
        className={`mt-2 inline-flex items-center px-2.5 py-1 rounded-full bg-amber-100 dark:bg-amber-900/40 border border-amber-300 dark:border-amber-700 text-[10px] font-semibold text-amber-800 dark:text-amber-200 transition-all duration-200 ${
          busy ? 'opacity-50' : 'active:scale-[0.97]'
        }`}
      >
        {BATTERY_STEP_COPY.action} →
      </button>
    </div>
  );
};

export default BatteryOptimizationCard;
