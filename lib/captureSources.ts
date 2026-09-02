// lib/captureSources.ts
//
// The single answer to "may this app produce a capture, and what kind of app is
// it".
//
// Before this module there were two lists kept in agreement by hand — the Java
// listener's `monitored_apps` (which decides what is forwarded off the phone at
// all) and the JS side's bank list (which decides what is accepted on arrival) —
// and four separate gates reading them. Adding a third class of app to that
// arrangement is how you end up with notifications that are read but never
// saved, in silence.
//
// Two things this module exists to make possible, neither of which the old
// arrangement could express:
//
//   1. TURNING A BANK OFF. `NotificationListener.isMonitoredApp` used to answer
//      "is it in the hardcoded list of ~350 banks?" first and only then consult
//      the user's choices, so deselecting a built-in bank changed nothing at
//      all. The selection below is authoritative once it exists.
//
//   2. EMAIL AS A SOURCE. Some banks only ever announce a purchase by email —
//      for one household member that is most of their spending. An email app is
//      a capture source of a different KIND, with a different safety rule
//      (see lib/emailNotification.ts: the sender has to be a bank), and the
//      pipeline has to be able to tell the two kinds apart.
//
// The selection is device-local, like the lists it replaces. Approving an app is
// a statement about the phone in your hand, not about the account — and a bad
// choice must never propagate to a partner's phone.

import { log } from './log';
import {
  getBankingApps,
  getApprovedCaptureSources,
  isExcludedApp,
  KNOWN_BANKING_APPS,
  suggestUnknownBankApps,
} from './bankingApps';

/** What a capture source is, which decides which safety rules apply to it. */
export type CaptureSourceKind = 'bank' | 'email';

/**
 * Mail apps Covault will offer as capture sources.
 *
 * Must stay in sync with EMAIL_APPS in NotificationListener.java;
 * lib/__tests__/captureSourcesConsistency.test.ts fails the build otherwise.
 *
 * The same rule as the bank list applies here: a package name only does
 * something if it is exactly right, there is no partial match, and a typo means
 * that app is silently never offered. Entries marked "verified" were checked
 * against the app's real Play Store listing; the rest are unproven and should be
 * treated as such. An unused package name matches nothing and costs nothing,
 * which is why a doubtful entry is left in rather than removed.
 *
 * Being on this list does NOT mean Covault reads that app. Every email app is
 * off until the user ticks it, and even then only mail from a bank sender is
 * ever looked at.
 */
export const KNOWN_EMAIL_APPS: Record<string, string> = {
  'com.google.android.gm': 'Gmail', // verified
  'com.google.android.gm.lite': 'Gmail Go',
  'com.microsoft.office.outlook': 'Outlook', // verified
  'com.samsung.android.email.provider': 'Samsung Email', // verified
  'com.yahoo.mobile.client.android.mail': 'Yahoo Mail', // verified
  'ch.protonmail.android': 'Proton Mail', // verified
  'me.proton.android.mail': 'Proton Mail',
  'com.readdle.spark': 'Spark',
  'me.bluemail.mail': 'BlueMail',
  'org.kman.AquaMail': 'Aqua Mail', // verified — note the capitals
  'com.fsck.k9': 'K-9 Mail',
  'net.thunderbird.android': 'Thunderbird',
  'com.fastmail.app': 'Fastmail',
  'com.zoho.mail': 'Zoho Mail',
  'com.easilydo.mail': 'Edison Mail',
  'com.my.mail': 'myMail',
  'ru.mail.mailapp': 'Mail.ru',
  'com.gmx.mobile.android.mail': 'GMX Mail',
  'com.onemobile.android.mail': 'Mail.com',
  'com.gomail.android': 'Newton Mail',
  'com.gmail.app': 'Canary Mail',
};

/**
 * The one way a package name is compared, anywhere.
 *
 * A dozen entries in the bank list carry capital letters
 * ('com.ally.MobileBanking', 'co.uk.Nationwide.Mobile'), and Aqua Mail's does
 * too. The JS side has always lowercased while the Java side compared exactly,
 * so a mixed-case package approved in settings was written lowercased into
 * `monitored_apps` and then never matched by the listener — the app read
 * nothing and said nothing. Both sides now fold case, and this is the function
 * that defines what that means.
 */
export function normalizePackage(packageName: string | null | undefined): string {
  return (packageName || '').trim().toLowerCase();
}

/** Lowercased keys of every mail app Covault recognises. */
function emailPackageKeys(): Set<string> {
  return new Set(Object.keys(KNOWN_EMAIL_APPS).map(normalizePackage));
}

/** Lowercased keys of every bank Covault recognises, hardcoded plus DB plus approved. */
function bankPackageKeys(): Set<string> {
  const keys = new Set<string>();
  for (const pkg of Object.keys(KNOWN_BANKING_APPS)) keys.add(normalizePackage(pkg));
  for (const pkg of Object.keys(getBankingApps())) keys.add(normalizePackage(pkg));
  for (const pkg of getApprovedCaptureSources()) keys.add(normalizePackage(pkg));
  return keys;
}

/**
 * What kind of source this package is, or null if Covault does not know it.
 *
 * Excluded apps are nothing, whatever else they look like. Google Wallet is on
 * that list because it re-announces the same tap-to-pay purchase the card's own
 * bank app already announced, and a tick in a picker is not a reason to reopen
 * a duplicate-capture problem that was closed deliberately.
 *
 * A bank wins over a mail app if a package were ever somehow both, because the
 * bank path is the one with the stronger parsing guarantees.
 */
export function captureSourceKind(
  packageName: string | null | undefined,
): CaptureSourceKind | null {
  const pkg = normalizePackage(packageName);
  if (!pkg || isExcludedApp(pkg)) return null;
  if (bankPackageKeys().has(pkg)) return 'bank';
  if (emailPackageKeys().has(pkg)) return 'email';
  return null;
}

/** The friendly name for a recognised source, or null. */
export function captureSourceName(packageName: string | null | undefined): string | null {
  const pkg = normalizePackage(packageName);
  if (!pkg) return null;
  for (const [key, name] of Object.entries(getBankingApps())) {
    if (normalizePackage(key) === pkg) return name;
  }
  for (const [key, name] of Object.entries(KNOWN_BANKING_APPS)) {
    if (normalizePackage(key) === pkg) return name;
  }
  for (const [key, name] of Object.entries(KNOWN_EMAIL_APPS)) {
    if (normalizePackage(key) === pkg) return name;
  }
  return null;
}

// ── The user's selection ─────────────────────────────────────────────────────
//
// Three states, not two, and the third is the whole point.
//
//   never chosen  — a fresh install, or one upgrading from a build that had no
//                   picker. Falls back to "every bank we recognise, no mail
//                   apps", which is exactly what the app did before, so an
//                   upgrade keeps capturing with no user action.
//   chosen, on    — the user ticked it.
//   chosen, off   — the user UNTICKED it, and it must stay off through a
//                   relaunch, a rescan and a reboot.
//
// Without the "never chosen" state there is no way to tell "the user turned this
// bank off" from "we have not asked yet", and the app has to guess. Guessing
// wrong in one direction re-enables a bank the user switched off; guessing wrong
// in the other silently stops capturing everything. Neither is acceptable, so
// the distinction is stored.

const SELECTION_KEY = 'covault_capture_sources_v2';

interface StoredSelection {
  /** True once the user has been given the choice — see the note above. */
  chosen: boolean;
  /** Exactly the packages that may capture. Authoritative when `chosen`. */
  selected: string[];
}

function readSelection(): StoredSelection | null {
  try {
    const raw = localStorage.getItem(SELECTION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const selected = Array.isArray(parsed.selected)
      ? parsed.selected.filter((v: unknown): v is string => typeof v === 'string').map(normalizePackage)
      : [];
    return { chosen: parsed.chosen === true, selected };
  } catch {
    return null;
  }
}

function writeSelection(selection: StoredSelection): void {
  try {
    localStorage.setItem(
      SELECTION_KEY,
      JSON.stringify({ chosen: selection.chosen, selected: selection.selected }),
    );
  } catch {
    log.warn('[captureSources] Could not persist the capture source selection');
  }
}

/** True once the user has actually been offered the choice. */
export function hasChosenSources(): boolean {
  return readSelection()?.chosen === true;
}

/**
 * The packages that may capture right now.
 *
 * When the user has chosen, that is the answer, full stop — including when they
 * chose nothing, which is a real answer and not a reason to fall back.
 */
export function getSelectedSources(): string[] {
  const stored = readSelection();
  if (stored?.chosen) return stored.selected.filter((pkg) => !isExcludedApp(pkg));
  return [];
}

/**
 * Record the user's choice. This is what makes deselection stick.
 *
 * Excluded apps are dropped rather than refused, so a stale selection carried
 * forward from an older build cannot smuggle one back in.
 */
export function setSelectedSources(packages: string[]): void {
  const selected = Array.from(
    new Set((packages || []).map(normalizePackage).filter((pkg) => pkg && !isExcludedApp(pkg))),
  );
  writeSelection({ chosen: true, selected });
}

/** Turn one source on or off, leaving the rest of the selection alone. */
export function setSourceSelected(packageName: string, selected: boolean): void {
  const pkg = normalizePackage(packageName);
  if (!pkg || isExcludedApp(pkg)) return;
  const current = new Set(getSelectedSources());
  if (selected) current.add(pkg);
  else current.delete(pkg);
  setSelectedSources(Array.from(current));
}

/**
 * The selection a phone should start with, given what is installed on it.
 *
 * Every bank we recognise, and no mail apps. Mail is off by default on purpose:
 * it is the source that can misread a receipt as a purchase, so it should only
 * ever be on because somebody deliberately turned it on.
 *
 * This does NOT mark the selection as chosen — it is the seed, not an answer.
 */
export function defaultSourcesFor(installedPackages: string[]): string[] {
  return Array.from(
    new Set(
      (installedPackages || [])
        .map(normalizePackage)
        .filter((pkg) => pkg && !isExcludedApp(pkg) && captureSourceKind(pkg) === 'bank'),
    ),
  );
}

/**
 * May this app produce a capture right now?
 *
 * This is the JS half of the gate; the Java listener applies the same rule
 * before a notification is ever forwarded. Both have to agree — the Java side is
 * what saves the work, this one backstops the paths that do not come through a
 * live broadcast (the offline queue, a rescan, and a phone still running an
 * older APK than its web bundle).
 *
 * Before the user has chosen, this answers exactly what `isBankingApp` used to,
 * which is what lets an existing install upgrade without losing capture.
 */
export function isCaptureSourceAllowed(packageName: string | null | undefined): boolean {
  const pkg = normalizePackage(packageName);
  if (!pkg || isExcludedApp(pkg)) return false;

  const stored = readSelection();
  if (stored?.chosen) return stored.selected.includes(pkg);

  // Never chosen: the pre-picker behaviour, unchanged.
  return bankPackageKeys().has(pkg);
}

/**
 * The kind of source a capture came from, for a package that is allowed.
 *
 * Returns null when the app may not capture at all, so a caller cannot
 * accidentally treat a blocked app as a bank.
 */
export function allowedSourceKind(
  packageName: string | null | undefined,
): CaptureSourceKind | null {
  if (!isCaptureSourceAllowed(packageName)) return null;
  // An app the user approved by hand is not in either known list; it was
  // approved through the bank flow, so it is treated as a bank.
  return captureSourceKind(packageName) ?? 'bank';
}

// ── Offering apps the user might want ────────────────────────────────────────

export interface CaptureSourceOption {
  packageName: string;
  /** The app's own label, as Android reports it. */
  name: string;
  kind: CaptureSourceKind;
  /** False when Covault does not recognise it and is guessing from the name. */
  recognised: boolean;
}

/**
 * Words that make an installed app worth OFFERING as a mail source.
 *
 * Only ever used to build a suggestion the user must confirm — nothing here
 * turns anything on. Deliberately narrow compared to the bank equivalent,
 * because "mail" is a common word: a wrong guess here puts a pointless row in a
 * settings list, but a user who ticks it has handed Covault a firehose that the
 * bank-sender rule then has to hold back on its own.
 */
const EMAILISH_RE = /\b(?:e-?mail|mail|inbox|webmail)\b/i;

/**
 * Everything the picker should show, from what is installed on the phone.
 *
 * Recognised banks and mail apps first; anything unrecognised that looks
 * financial or mail-shaped is offered separately so the user can approve it.
 * Matching is on the app's own name — no notification is ever read to decide,
 * so nothing about an unapproved app's contents is examined.
 */
export function buildSourceOptions(
  installed: Array<{ packageName: string; name: string }>,
): CaptureSourceOption[] {
  const seen = new Set<string>();
  const out: CaptureSourceOption[] = [];

  // Unrecognised apps whose NAME looks financial. Reuses the existing bank
  // suggestion rule rather than restating it, so the two can never disagree
  // about what counts as bank-shaped.
  const unknownBanks = new Set(
    suggestUnknownBankApps(installed || []).map((app) => normalizePackage(app.packageName)),
  );

  for (const app of installed || []) {
    const pkg = normalizePackage(app?.packageName);
    const name = (app?.name || '').trim();
    if (!pkg || !name || seen.has(pkg) || isExcludedApp(pkg)) continue;
    seen.add(pkg);

    const known = captureSourceKind(pkg);
    if (known) {
      out.push({ packageName: pkg, name: captureSourceName(pkg) || name, kind: known, recognised: true });
      continue;
    }
    // A name can look like both ("Mail & Money"); bank wins, matching
    // captureSourceKind, so an app never changes kind depending on which list
    // happened to be consulted first.
    if (unknownBanks.has(pkg)) {
      out.push({ packageName: pkg, name, kind: 'bank', recognised: false });
      continue;
    }
    if (EMAILISH_RE.test(name)) {
      out.push({ packageName: pkg, name, kind: 'email', recognised: false });
    }
  }

  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}
