import React, { useCallback, useEffect, useState } from 'react';
import type { CovaultNotificationPlugin } from '../../lib/covaultNotification';
import { applySourceSelection } from '../../lib/covaultNotification';
import {
  buildSourceOptions,
  defaultSourcesFor,
  getSelectedSources,
  hasChosenSources,
  type CaptureSourceOption,
} from '../../lib/captureSources';
import { log } from '../../lib/log';

/**
 * Which apps Covault may read — the user's own answer, in one place.
 *
 * Rendered identically in three places (the setup step, the top of the Review
 * screen, and settings) because three hand-rolled copies of a chip grid is how
 * the old notification settings ended up with an "approve an unrecognised bank"
 * feature that existed on one screen and not the other. One component, three
 * mount points.
 *
 * Nothing is written until the user actually touches something. Before that the
 * ticks show the default — every bank we recognise, no mail apps — which is
 * exactly what the app does when it has never been asked, so what is on screen
 * and what is happening agree without a write having to happen first.
 */

interface CaptureSourcePickerProps {
  plugin: CovaultNotificationPlugin | null;
  /** False while notification access has not been granted; the picker explains itself instead. */
  ready?: boolean;
  /** Told how many sources are selected, whenever that changes. */
  onSelectionChange?: (selected: string[]) => void;
}

const CHIP_BASE =
  'flex items-center space-x-2 px-3 py-2.5 rounded-xl text-left border transition-all duration-200 active:scale-[0.97]';
const CHIP_ON =
  'bg-emerald-50 dark:bg-emerald-900/30 border-emerald-300 dark:border-emerald-700/50';
const CHIP_OFF =
  'bg-slate-100 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700/30';

const BankIcon = () => (
  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <rect x="1" y="4" width="22" height="16" rx="2" />
    <line x1="1" y1="10" x2="23" y2="10" />
  </svg>
);

const MailIcon = () => (
  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="4" width="20" height="16" rx="2" />
    <path d="M2 7l10 6 10-6" />
  </svg>
);

const Tick: React.FC<{ on: boolean }> = ({ on }) => (
  <div
    className={`w-4 h-4 rounded-md flex items-center justify-center shrink-0 ${
      on ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'
    }`}
  >
    {on && (
      <svg className="w-3 h-3 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 6L9 17l-5-5" />
      </svg>
    )}
  </div>
);

const CaptureSourcePicker: React.FC<CaptureSourcePickerProps> = ({
  plugin,
  ready = true,
  onSelectionChange,
}) => {
  const [options, setOptions] = useState<CaptureSourceOption[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!plugin || !ready) {
        if (!cancelled) setLoading(false);
        return;
      }
      try {
        const { apps } = await plugin.getInstalledApps();
        if (cancelled) return;
        const built = buildSourceOptions(apps || []);
        setOptions(built);
        // Before the user has answered, show what the app is actually doing:
        // every recognised bank on, every mail app off.
        const initial = hasChosenSources()
          ? getSelectedSources()
          : defaultSourcesFor(built.map((o) => o.packageName));
        setSelected(new Set(initial));
        onSelectionChange?.(initial);
      } catch (e) {
        log.warn('[CaptureSourcePicker] Could not read the installed apps:', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();

    // Re-read when the app comes back to the foreground. Installing a bank, or
    // granting notification access, both happen outside Covault — and the user
    // returns expecting the new app to be here.
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
    };
    // onSelectionChange is deliberately not a dependency: callers pass an inline
    // function, and depending on it would re-read the installed app list on
    // every render of the parent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plugin, ready]);

  /**
   * Persist to BOTH lists, always through the one helper.
   *
   * Writing only the web list means Covault accepts alerts that never reach it;
   * writing only the phone list means notifications are read and thrown away,
   * with nothing saved and nothing saying why.
   */
  const commit = useCallback((next: Set<string>) => {
    setSelected(new Set(next));
    const packages = Array.from(next);
    onSelectionChange?.(packages);
    void applySourceSelection(packages);
  }, [onSelectionChange]);

  const toggle = useCallback((packageName: string) => {
    const next = new Set(selected);
    if (next.has(packageName)) next.delete(packageName);
    else next.add(packageName);
    commit(next);
  }, [selected, commit]);

  const setAllOfKind = useCallback((kind: 'bank' | 'email', on: boolean) => {
    const next = new Set(selected);
    for (const option of options) {
      if (option.kind !== kind) continue;
      if (on) next.add(option.packageName);
      else next.delete(option.packageName);
    }
    commit(next);
  }, [options, selected, commit]);

  if (!plugin) return null;

  if (!ready) {
    return (
      <p className="text-[11px] text-slate-400 dark:text-slate-500 font-medium leading-relaxed">
        Once Android has given Covault permission to read notifications, you can
        choose exactly which apps it listens to.
      </p>
    );
  }

  if (loading) {
    return (
      <p className="text-[11px] text-slate-400 dark:text-slate-500 font-medium">
        Looking at what's installed…
      </p>
    );
  }

  const banks = options.filter((o) => o.kind === 'bank');
  const mail = options.filter((o) => o.kind === 'email');
  const nothingSelected = selected.size === 0;

  const section = (
    kind: 'bank' | 'email',
    title: string,
    blurb: string,
    items: CaptureSourceOption[],
  ) => (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold tracking-wide text-slate-500 dark:text-slate-400">
          {title} <span className="text-slate-400 dark:text-slate-500">({items.length})</span>
        </span>
        {items.length > 0 && (
          <div className="flex items-center space-x-3">
            <button
              type="button"
              onClick={() => setAllOfKind(kind, true)}
              className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400"
            >
              All
            </button>
            <button
              type="button"
              onClick={() => setAllOfKind(kind, false)}
              className="text-[10px] font-semibold text-slate-400 dark:text-slate-500"
            >
              None
            </button>
          </div>
        )}
      </div>
      <p className="text-[10px] text-slate-400 dark:text-slate-500 leading-relaxed">{blurb}</p>
      {items.length === 0 ? (
        <p className="text-[10px] text-slate-400 dark:text-slate-500 italic">
          None found on this phone.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {items.map((option) => {
            const on = selected.has(option.packageName);
            return (
              <button
                key={option.packageName}
                type="button"
                onClick={() => toggle(option.packageName)}
                className={`${CHIP_BASE} ${on ? CHIP_ON : CHIP_OFF}`}
              >
                <Tick on={on} />
                <span className={on ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400 dark:text-slate-500'}>
                  {kind === 'bank' ? <BankIcon /> : <MailIcon />}
                </span>
                <span className="text-[11px] font-bold truncate text-slate-700 dark:text-slate-200">
                  {option.name}
                </span>
                {!option.recognised && (
                  <span className="text-[9px] font-semibold text-amber-600 dark:text-amber-400 shrink-0">
                    ?
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-5">
      {section(
        'bank',
        'Banking apps',
        'Covault reads purchase alerts from the apps you tick here, and no others.',
        banks,
      )}

      {section(
        'email',
        'Email apps',
        'For banks that only tell you by email. Covault reads a message only when the sender is a bank — receipts, orders and newsletters are ignored, even when they mention an amount.',
        mail,
      )}

      {options.some((o) => !o.recognised) && (
        <p className="text-[10px] text-slate-400 dark:text-slate-500 leading-relaxed">
          Apps marked <span className="font-semibold text-amber-600 dark:text-amber-400">?</span> aren't
          ones Covault recognises — they just look like a bank or a mail app by name.
          Tick one only if you know it is.
        </p>
      )}

      {nothingSelected && (
        <div className="p-3 rounded-2xl border border-amber-200 dark:border-amber-800/40 bg-amber-50 dark:bg-amber-900/20">
          <p className="text-[11px] font-bold text-amber-700 dark:text-amber-400">
            Nothing is selected, so nothing will be captured.
          </p>
          <p className="text-[10px] text-amber-600/80 dark:text-amber-500/80 leading-relaxed mt-1">
            Covault will stay completely silent until you tick at least one app.
          </p>
        </div>
      )}
    </div>
  );
};

export default CaptureSourcePicker;
