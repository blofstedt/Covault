import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Mock @capacitor/core so bankingApps.ts doesn't fail
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false },
  registerPlugin: vi.fn(),
}));

import { KNOWN_BANKING_APPS, EXCLUDED_APPS, isExcludedApp } from '../bankingApps';

const JAVA_PATH = resolve(__dirname, '../../android-custom/NotificationListener.java');

/**
 * Parse a `static final Set<String> <name>` block from NotificationListener.java.
 * Extracts all quoted package names from the Java HashSet initializer.
 */
function parseJavaPackageSet(setName: string): Set<string> {
  const content = readFileSync(JAVA_PATH, 'utf-8');

  const setMatch = content.match(
    new RegExp(
      `static final Set<String> ${setName} = new HashSet<>\\(Arrays\\.asList\\(([\\s\\S]*?)\\)\\);`,
    ),
  );
  if (!setMatch) {
    throw new Error(`Could not find ${setName} set in NotificationListener.java`);
  }

  const block = setMatch[1];
  const packageNames = new Set<string>();
  const regex = /"([^"]+)"/g;
  let match;
  while ((match = regex.exec(block)) !== null) {
    packageNames.add(match[1]);
  }
  return packageNames;
}

function parseJavaBankingApps(): Set<string> {
  return parseJavaPackageSet('BANKING_APPS');
}

describe('Banking apps consistency (Java ↔ TypeScript)', () => {
  const javaBankingApps = parseJavaBankingApps();
  const tsBankingApps = new Set(Object.keys(KNOWN_BANKING_APPS));

  it('Java BANKING_APPS set is non-empty', () => {
    expect(javaBankingApps.size).toBeGreaterThan(0);
  });

  it('TypeScript KNOWN_BANKING_APPS is non-empty', () => {
    expect(tsBankingApps.size).toBeGreaterThan(0);
  });

  it('every TypeScript known app exists in the Java hardcoded set', () => {
    const missingInJava: string[] = [];
    for (const pkg of tsBankingApps) {
      if (!javaBankingApps.has(pkg)) {
        missingInJava.push(pkg);
      }
    }
    expect(
      missingInJava,
      `These TS apps are missing from Java BANKING_APPS:\n  ${missingInJava.join('\n  ')}`,
    ).toEqual([]);
  });

  it('every Java hardcoded app exists in the TypeScript known apps', () => {
    const missingInTS: string[] = [];
    for (const pkg of javaBankingApps) {
      if (!tsBankingApps.has(pkg)) {
        missingInTS.push(pkg);
      }
    }
    expect(
      missingInTS,
      `These Java apps are missing from TS KNOWN_BANKING_APPS:\n  ${missingInTS.join('\n  ')}`,
    ).toEqual([]);
  });
});

/**
 * The exclusion list is the one rule that beats a user's own choice, so it has
 * to hold on BOTH sides: Java is where the notification is actually dropped,
 * TypeScript is the backstop for queued events and rescans. If the two drift,
 * one path silently starts capturing something the other refuses.
 *
 * It is currently EMPTY. Google Wallet used to be its only entry — it repeats
 * every tap-to-pay purchase the card's own app already announced — and is now
 * an ordinary selectable bank, with the duplicate handled by the cross-app rule
 * (same amount, seconds apart, first reporter wins) instead. The mechanism is
 * kept and still tested, because it is the only lever that overrides the user.
 */
describe('Excluded apps consistency (Java ↔ TypeScript)', () => {
  const javaExcluded = parseJavaPackageSet('EXCLUDED_APPS');
  const tsExcluded = new Set(Object.keys(EXCLUDED_APPS));

  it('both sides list exactly the same packages', () => {
    expect([...javaExcluded].sort()).toEqual([...tsExcluded].sort());
  });

  it('treats Google Wallet as a bank now, not an exclusion', () => {
    // The reversal, pinned so it cannot drift back by accident in one file
    // only: a package must never be both a bank and excluded.
    for (const pkg of ['com.google.android.apps.walletnfcrel', 'com.google.android.apps.wallet']) {
      expect(tsExcluded.has(pkg), pkg).toBe(false);
      expect(javaExcluded.has(pkg), pkg).toBe(false);
      expect(pkg in KNOWN_BANKING_APPS, pkg).toBe(true);
    }
  });

  it('never excludes an app that is also a known bank', () => {
    const overlap = [...tsExcluded].filter((pkg) => pkg in KNOWN_BANKING_APPS);
    expect(
      overlap,
      `These packages are both a known bank and excluded, which is contradictory:\n  ${overlap.join('\n  ')}`,
    ).toEqual([]);
  });

  it('isExcludedApp matches the list, and tolerates junk input', () => {
    // Nothing is excluded today, so everything real answers false. The trimming
    // and the inherited-property guard below are what keep the mechanism honest
    // for whatever gets added here next.
    for (const pkg of Object.keys(EXCLUDED_APPS)) {
      expect(isExcludedApp(pkg), pkg).toBe(true);
      expect(isExcludedApp(`  ${pkg}  `), pkg).toBe(true);
    }
    expect(isExcludedApp('com.bmo.mobile')).toBe(false);
    expect(isExcludedApp('')).toBe(false);
    expect(isExcludedApp(null)).toBe(false);
    expect(isExcludedApp(undefined)).toBe(false);
  });

  it('does not treat inherited Object properties as excluded', () => {
    // `EXCLUDED_APPS` is a plain object, so a naive `EXCLUDED_APPS[pkg]` lookup
    // would report "constructor" and "toString" as excluded packages.
    expect(isExcludedApp('constructor')).toBe(false);
    expect(isExcludedApp('toString')).toBe(false);
  });

  it('Java drops excluded packages before the monitored-app check', () => {
    const content = readFileSync(JAVA_PATH, 'utf-8');

    const excludedCheck = content.indexOf('EXCLUDED_APPS.contains(packageName)');
    const monitoredCheck = content.indexOf('boolean fromMonitored = isMonitoredApp(packageName)');

    expect(excludedCheck, 'EXCLUDED_APPS check missing from NotificationListener').toBeGreaterThan(-1);
    expect(monitoredCheck, 'monitored-app check missing from NotificationListener').toBeGreaterThan(-1);
    expect(
      excludedCheck,
      'The exclusion check must come BEFORE the monitored-app check, so a user who ' +
      'selects Google Wallet in notification settings still cannot turn it into a ' +
      'capture source.',
    ).toBeLessThan(monitoredCheck);
  });
});