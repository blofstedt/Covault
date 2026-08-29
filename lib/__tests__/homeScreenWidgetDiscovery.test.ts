import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BUDGET_CATEGORY_COLORS } from '../budgetColors';

/**
 * The widget has existed since it shipped, and nothing in the app ever said
 * so. Adding one has always meant knowing, unprompted, to long-press an empty
 * patch of home screen and dig through the widget drawer — which most people
 * never do on the strength of nothing, so most users never had it.
 *
 * Settings now shows what it looks like and offers the platform's own
 * one-tap placement route (`AppWidgetManager.requestPinAppWidget`) where the
 * phone allows it, falling back to the same written steps that have always
 * worked everywhere else.
 *
 * What is testable here, in the absence of anything that runs the app: that
 * the preview cannot show a colour the widget doesn't (it is drawn from the
 * same palette source, not a copy of it), that the native plugin never
 * promises more than a request was accepted, and that every route — old
 * Android, a launcher without support, an OEM that throws — lands back on
 * the one route that has always worked.
 */
const SECTION = readFileSync(
  resolve(__dirname, '../../components/dashboard_components/settings_modal_components/HomeScreenWidgetSection.tsx'),
  'utf-8',
);
const PLUGIN = readFileSync(resolve(__dirname, '../../android-custom/CovaultWidgetPlugin.java'), 'utf-8');
const BRIDGE = readFileSync(resolve(__dirname, '../covaultWidget.ts'), 'utf-8');
const MAIN_ACTIVITY = readFileSync(resolve(__dirname, '../../android-custom/MainActivity.java'), 'utf-8');
const MODAL = readFileSync(
  resolve(__dirname, '../../components/dashboard_components/DashboardSettingsModal.tsx'),
  'utf-8',
);

describe('the in-app preview', () => {
  it('draws its three slices from the shared palette, not from its own copy', () => {
    // The whole safety property: this file cannot show a category colour the
    // real widget doesn't, because there is only one source for either of
    // them to read.
    expect(SECTION).toContain('BUDGET_CATEGORY_COLORS');
    expect(SECTION).not.toMatch(/#[0-9a-fA-F]{6}/);
  });

  it('uses categories the palette actually has', () => {
    for (const name of ['Groceries', 'Leisure', 'Transport']) {
      expect(BUDGET_CATEGORY_COLORS[name], `${name} missing from BUDGET_CATEGORY_COLORS`)
        .toBeTruthy();
      expect(SECTION).toContain(`BUDGET_CATEGORY_COLORS.${name}`);
    }
  });

  it('invents no numbers', () => {
    // Same rule the native picker preview follows, and for the same reason —
    // a placeholder bar cannot be mistaken for a real total; an invented
    // figure could be.
    expect(SECTION).not.toMatch(/\$\d/);
  });

  it('follows the app theme the same way every other element does', () => {
    // No isDarkMode prop, no media-query check — Tailwind's class strategy,
    // like the rest of the app, and like the widget itself (WidgetRenderer's
    // LIGHT/DARK palettes follow the same in-app theme setting).
    expect(SECTION).toContain('dark:fill-slate-900');
    expect(SECTION).toContain('dark:stroke-slate-800');
  });
});

describe('the plugin', () => {
  it('separates checking support from asking for it', () => {
    // So settings can decide what to show — the button or the written steps
    // — before it commits to anything real.
    expect(PLUGIN).toContain('public void isSupported(PluginCall call)');
    expect(PLUGIN).toContain('public void requestPin(PluginCall call)');
  });

  it('never claims more than "the launcher accepted the request"', () => {
    // Nothing on this side can see past the request — the launcher's own
    // placement screen is the only real confirmation, same as the
    // restricted-settings unlock elsewhere in this app.
    const requestPin = PLUGIN.slice(
      PLUGIN.indexOf('public void requestPin(PluginCall call)'),
      PLUGIN.indexOf('private boolean supported()'),
    );
    expect(requestPin).not.toContain('successCallback');
    expect(requestPin).toContain('result.put("requested"');
  });

  it('is refused outright below Android 8', () => {
    expect(PLUGIN).toContain('Build.VERSION_CODES.O');
  });

  it('resolves rather than throws when the launcher refuses or errors', () => {
    // A refusal is an ordinary outcome the UI already reads, not a fault —
    // and an OEM launcher that lies about supporting this and then throws
    // must not crash the settings screen over a feature that was never load
    // bearing.
    const requestPin = PLUGIN.slice(PLUGIN.indexOf('public void requestPin(PluginCall call)'));
    expect(requestPin).toContain('catch (Exception e)');
    expect(requestPin.slice(0, requestPin.indexOf('catch'))).not.toContain('call.reject');
  });

  it('is registered with the bridge', () => {
    expect(MAIN_ACTIVITY).toContain('registerPlugin(CovaultWidgetPlugin.class)');
  });
});

describe('the JS bridge', () => {
  it('is null off-device rather than throwing', () => {
    expect(BRIDGE).toContain('Capacitor.isNativePlatform()');
    expect(BRIDGE).toMatch(/:\s*CovaultWidgetPlugin \| null/);
  });
});

describe('what settings shows on every route', () => {
  it('offers the one-tap button only once support is actually known', () => {
    // Never the button by default with support assumed — that would open a
    // dead tap on a phone or launcher that cannot honour it.
    expect(SECTION).toContain("useState<PinRoute>(isNative ? 'checking' : 'manual')");
    expect(SECTION).toContain("route === 'button'");
  });

  it('falls back to the written steps on every kind of refusal', () => {
    // Not supported, refused at the moment of asking, or the call throwing —
    // three different failures, one fallback.
    expect(SECTION).toContain("setRoute('manual')");
    const unsupported = SECTION.indexOf("setRoute(supported ? 'button' : 'manual')");
    const refusedAtAsk = SECTION.indexOf("else setRoute('manual')");
    const threw = SECTION.lastIndexOf("setRoute('manual')");
    expect(unsupported).toBeGreaterThan(-1);
    expect(refusedAtAsk).toBeGreaterThan(-1);
    expect(threw).toBeGreaterThan(refusedAtAsk);
  });

  it('gives a phone with no route at all the exact steps that have always worked', () => {
    expect(SECTION).toContain('Long-press an empty spot on your home screen');
  });

  it('says plainly on the web build that this is a phone feature', () => {
    expect(SECTION).toContain('open Covault on your phone to add it');
  });

  it('is wired into the settings screen', () => {
    expect(MODAL).toContain('<HomeScreenWidgetSection');
  });

  it('is not gated behind premium', () => {
    // The widget already exists for everyone; this is visibility into it, not
    // a paid capability.
    const inserted = MODAL.indexOf('<HomeScreenWidgetSection');
    const before = MODAL.slice(Math.max(0, inserted - 400), inserted);
    expect(before).not.toContain('<PremiumGate');
  });
});
