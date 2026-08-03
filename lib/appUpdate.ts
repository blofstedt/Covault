import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { log } from './log';

/**
 * Finding out whether the phone is running the newest build.
 *
 * Every push to `main` produces a signed APK and publishes it as a GitHub
 * release tagged `v<build number>`, so "is there a newer version" is one
 * unauthenticated request against a public repository — no server of our own,
 * no account, nothing to keep running.
 *
 * The build number is also the Android versionCode, which is what makes the
 * comparison trustworthy: it is the same integer on both sides, and it only
 * ever goes up.
 */

const RELEASES_LATEST_URL =
  'https://api.github.com/repos/blofstedt/Covault/releases/latest';

export interface AvailableUpdate {
  /** Android versionCode of the release — the CI run number. */
  versionCode: number;
  /** Human-readable version, e.g. `1.0.42`. */
  versionName: string;
  /** Direct download for the APK asset. */
  apkUrl: string;
  /** What changed: the commit subject the release was built from. */
  notes: string;
}

/**
 * `v42` → 42. Anything else → null, which is treated as "no update", so a
 * hand-made tag can never be read as a version to install.
 */
export function parseReleaseTag(tag: unknown): number | null {
  if (typeof tag !== 'string') return null;
  const match = /^v(\d+)$/.exec(tag.trim());
  if (!match) return null;
  const code = Number(match[1]);
  return Number.isSafeInteger(code) && code > 0 ? code : null;
}

/**
 * Pull the pieces we need out of a GitHub release payload, or null if it is
 * not something installable — a draft, a pre-release, a tag we don't
 * recognise, or a release with no APK attached (which is what a half-failed
 * build looks like).
 */
export function parseRelease(raw: unknown): AvailableUpdate | null {
  if (!raw || typeof raw !== 'object') return null;
  const release = raw as Record<string, unknown>;
  if (release.draft === true || release.prerelease === true) return null;

  const versionCode = parseReleaseTag(release.tag_name);
  if (versionCode === null) return null;

  const assets = Array.isArray(release.assets) ? release.assets : [];
  let apkUrl: string | null = null;
  for (const asset of assets) {
    if (!asset || typeof asset !== 'object') continue;
    const url = (asset as Record<string, unknown>).browser_download_url;
    if (typeof url === 'string' && url.toLowerCase().endsWith('.apk')) {
      apkUrl = url;
      break;
    }
  }
  if (!apkUrl) return null;

  const name = typeof release.name === 'string' ? release.name.trim() : '';
  const body = typeof release.body === 'string' ? release.body.trim() : '';

  return {
    versionCode,
    versionName: name || `1.0.${versionCode}`,
    apkUrl,
    notes: body,
  };
}

/**
 * The versionCode of the build actually on the phone, or null off-device.
 *
 * Capacitor reports it as a string because iOS build numbers are not
 * necessarily numeric; on Android it is always the integer Gradle stamped in.
 */
export async function getInstalledVersionCode(): Promise<number | null> {
  if (!Capacitor.isNativePlatform()) return null;
  try {
    const info = await CapApp.getInfo();
    const code = Number(info.build);
    return Number.isSafeInteger(code) ? code : null;
  } catch (e) {
    log.warn('[appUpdate] Could not read the installed version:', e);
    return null;
  }
}

/**
 * The newest published release, or null if there isn't one, the network is
 * down, or GitHub is rate-limiting us. Never throws: a failed check has to be
 * indistinguishable from "nothing new" to everything upstream.
 */
export async function fetchLatestRelease(
  fetchImpl: typeof fetch = fetch,
): Promise<AvailableUpdate | null> {
  try {
    const response = await fetchImpl(RELEASES_LATEST_URL, {
      headers: { Accept: 'application/vnd.github+json' },
      cache: 'no-store',
    });
    if (!response.ok) return null;
    return parseRelease(await response.json());
  } catch (e) {
    log.warn('[appUpdate] Update check failed:', e);
    return null;
  }
}

/**
 * The update to offer, or null if the phone is already current.
 *
 * Strictly greater than, so a phone running a build newer than the published
 * release — which is what a local `cap:build` install looks like — is never
 * told to downgrade.
 */
export function selectUpdate(
  latest: AvailableUpdate | null,
  installedVersionCode: number | null,
): AvailableUpdate | null {
  if (!latest || installedVersionCode === null) return null;
  return latest.versionCode > installedVersionCode ? latest : null;
}
