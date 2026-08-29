import React, { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import SettingsCard from '../../ui/SettingsCard';
import SectionHeader from '../../ui/SectionHeader';
import { covaultWidget } from '../../../lib/covaultWidget';
import { BUDGET_CATEGORY_COLORS } from '../../../lib/budgetColors';

/**
 * A schematic likeness of the home-screen widget: donut left, legend right.
 *
 * Nothing here is fake data. Every bar and dot is a placeholder shape, the
 * same rule the native picker preview follows
 * (`android-custom/res/drawable/widget_preview.xml`) and for the same reason —
 * an invented total would read as real. The three category colours ARE real:
 * they come from `BUDGET_CATEGORY_COLORS`, the one source both this and the
 * widget draw from, so the preview can never show a shade the widget doesn't.
 *
 * Colours are Tailwind's `dark:` variant rather than a theme prop, matching
 * every other themed element in the app — and matching the widget itself,
 * which draws from the same slate values (see the LIGHT/DARK palettes in
 * `WidgetRenderer.java`) because it follows the in-app theme setting too.
 */
const WidgetPreview: React.FC = () => {
  const groceries = BUDGET_CATEGORY_COLORS.Groceries;
  const leisure = BUDGET_CATEGORY_COLORS.Leisure;
  const transport = BUDGET_CATEGORY_COLORS.Transport;

  return (
    <svg
      viewBox="0 0 250 110"
      className="w-full h-auto rounded-[1.4rem] shadow-sm"
      role="img"
      aria-label="Preview of the Covault home-screen widget: a ring of this month's spending by category, with a legend beside it"
    >
      <path
        className="fill-white dark:fill-slate-900"
        d="M28,0 L222,0 A28,28 0 0 1 250,28 L250,82 A28,28 0 0 1 222,110 L28,110 A28,28 0 0 1 0,82 L0,28 A28,28 0 0 1 28,0 Z"
      />

      {/* Month label, as a bar */}
      <path
        className="fill-slate-200 dark:fill-slate-700"
        d="M14,14 L58,14 A3,3 0 0 1 58,20 L14,20 A3,3 0 0 1 14,14 Z"
      />

      {/* Donut track */}
      <path
        className="fill-none stroke-slate-200 dark:stroke-slate-800"
        strokeWidth={11}
        d="M60,39 A27,27 0 1 1 59.9,39"
      />

      {/* Three slices, the app's own category colours */}
      <path className="fill-none" stroke={groceries} strokeWidth={11} d="M60,39 A27,27 0 0 1 80.7,83.4" />
      <path className="fill-none" stroke={leisure} strokeWidth={11} d="M78.4,85.1 A27,27 0 0 1 35.3,78.9" />
      <path className="fill-none" stroke={transport} strokeWidth={11} d="M34.2,77.2 A27,27 0 0 1 59.5,39.0" />

      {/* Centre figure, as a bar */}
      <path
        className="fill-slate-300 dark:fill-slate-600"
        d="M45,61 L75,61 A3.5,3.5 0 0 1 75,68 L45,68 A3.5,3.5 0 0 1 45,61 Z"
      />

      {/* Legend: dot + name bar + amount bar, one row per slice */}
      {[
        { cy: 44, color: groceries, name: 48, amount: 32 },
        { cy: 64, color: leisure, name: 40, amount: 26 },
        { cy: 84, color: transport, name: 44, amount: 24 },
      ].map((row, i) => (
        <g key={i}>
          <circle cx={110} cy={row.cy} r={4} fill={row.color} />
          <path
            className="fill-slate-300 dark:fill-slate-600"
            d={`M122,${row.cy - 3} L${122 + row.name},${row.cy - 3} A2.5,2.5 0 0 1 ${122 + row.name},${row.cy + 2} L122,${row.cy + 2} A2.5,2.5 0 0 1 122,${row.cy - 3} Z`}
          />
          <path
            className="fill-slate-200 dark:fill-slate-700"
            d={`M204,${row.cy - 3} L${204 + row.amount},${row.cy - 3} A2.5,2.5 0 0 1 ${204 + row.amount},${row.cy + 2} L204,${row.cy + 2} A2.5,2.5 0 0 1 204,${row.cy - 3} Z`}
          />
        </g>
      ))}
    </svg>
  );
};

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
