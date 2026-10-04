import React, { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import SettingsCard from '../../../../common/SettingsCard';
import SectionHeader from '../../../../common/SectionHeader';
import { covaultWidget } from '../../../../../lib/native/covaultWidget';
import WidgetPreview from './WidgetPreview';


/** What settings knows about whether the one-tap route can be offered. */
type PinRoute = 'checking' | 'button' | 'manual';

const MANUAL_STEPS =
  'Long-press an empty spot on your home screen, choose Widgets, then find Covault and drag it out.';

/**
 * "There is a widget" — said once, where someone might actually read it.
 *
 * The widget has existed since it shipped and nothing has ever told anyone
 * so: no first-run mention, no icon in the app, nothing. Adding one has
 * always meant knowing to long-press an empty patch of home screen and dig
 * through the widget drawer, which is not a thing most people go looking for
 * on the strength of nothing.
 *
 * This shows what it looks like, in the app's own words rather than a phone
 * screenshot that ages the moment the design changes, and offers the
 * platform's own one-tap placement route where the phone allows it —
 * `AppWidgetManager.requestPinAppWidget`, the same mechanism a browser uses to
 * offer "add to home screen". Where it can't (pre-Android 8, or a launcher
 * that doesn't implement it), the written steps are exactly the route that
 * has always worked.
 */

const HomeScreenWidgetSection: React.FC = () => {
  const isNative = Capacitor.isNativePlatform();
  const [route, setRoute] = useState<PinRoute>(isNative ? 'checking' : 'manual');
  const [requested, setRequested] = useState(false);

  useEffect(() => {
    if (!isNative || !covaultWidget) return;
    let cancelled = false;
    void (async () => {
      try {
        const { supported } = await covaultWidget.isSupported();
        if (!cancelled) setRoute(supported ? 'button' : 'manual');
      } catch {
        if (!cancelled) setRoute('manual');
      }
    })();
    return () => { cancelled = true; };
  }, [isNative]);

  const addToHomeScreen = async () => {
    if (!covaultWidget) return;
    try {
      const { requested: accepted } = await covaultWidget.requestPin();
      // A launcher that refuses the request itself, rather than at the
      // isSupported() check, still has the same fallback to offer.
      if (accepted) setRequested(true);
      else setRoute('manual');
    } catch {
      setRoute('manual');
    }
  };

  return (
    <SettingsCard>
      <SectionHeader
        title="Home Screen Widget"
        subtitle="This month's spending, without opening the app"
      />

      <div className="mt-4 max-w-[280px] mx-auto">
        <WidgetPreview />
      </div>

      <p className="mt-4 text-[11px] text-slate-400 dark:text-slate-500 leading-relaxed">
        Shows the month's total, what's left, and your top categories — updated
        the moment a purchase is captured, even with the app closed.
      </p>

      {!isNative && (
        <p className="mt-3 text-[10px] font-medium text-slate-400 dark:text-slate-600">
          An Android home-screen feature — open Covault on your phone to add it.
        </p>
      )}

      {isNative && route === 'button' && (
        <div className="mt-4">
          <button
            type="button"
            onClick={() => { void addToHomeScreen(); }}
            className="w-full px-4 py-3 rounded-xl text-xs font-bold text-white bg-emerald-500 hover:bg-emerald-600 active:scale-[0.98] transition-all duration-150"
          >
            Add to Home Screen
          </button>
          {requested && (
            <p className="mt-2 text-[10px] font-medium text-emerald-600 dark:text-emerald-400 text-center">
              Check your home screen — Android will ask you to confirm placement.
            </p>
          )}
        </div>
      )}

      {isNative && route === 'manual' && (
        <p className="mt-3 text-[10px] font-medium text-slate-400 dark:text-slate-500 leading-relaxed">
          {MANUAL_STEPS}
        </p>
      )}
    </SettingsCard>
  );
};

export default HomeScreenWidgetSection;
