import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  fetchLatestRelease,
  parseRelease,
  parseReleaseTag,
  parseWebBundleName,
  selectUpdate,
  selectWebBundle,
} from '../appUpdate';

/**
 * Self-update has no server behind it. The phone compares one integer — the CI
 * run number — against the tag on the newest GitHub release, and that integer
 * is also the APK's versionCode. Both halves are produced by
 * `.github/workflows/build-android.yml`, and if they ever stop agreeing the
 * failure is silent: the app simply never offers an update again, forever.
 *
 * So there are two things to hold: the parsing here, and the workflow still
 * emitting the shape the parsing expects.
 */

function release(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    tag_name: 'v42',
    name: 'Covault 1.0.42',
    body: 'Show one month per vial',
    draft: false,
    prerelease: false,
    assets: [
      {
        name: 'Covault-20260803-120000.apk',
        browser_download_url: 'https://example.test/Covault-20260803-120000.apk',
      },
      {
        name: 'covault-web-a1b2c3d4e5f6.zip',
        browser_download_url: 'https://example.test/covault-web-a1b2c3d4e5f6.zip',
      },
    ],
    ...over,
  };
}

describe('parseReleaseTag', () => {
  it('reads the build number out of the tag', () => {
    expect(parseReleaseTag('v42')).toBe(42);
    expect(parseReleaseTag(' v7 ')).toBe(7);
  });

  it('refuses anything that is not exactly a build tag', () => {
    // A hand-made tag must never be read as a version to install.
    for (const tag of ['v1.0.42', '42', 'latest', 'v', 'v0', 'vx', '', null, 12]) {
      expect(parseReleaseTag(tag)).toBeNull();
    }
  });
});

describe('parseRelease', () => {
  it('pulls out the version, the APK and the note', () => {
    expect(parseRelease(release())).toEqual({
      versionCode: 42,
      versionName: 'Covault 1.0.42',
      apkUrl: 'https://example.test/Covault-20260803-120000.apk',
      notes: 'Show one month per vial',
      webBundles: {
        a1b2c3d4e5f6: 'https://example.test/covault-web-a1b2c3d4e5f6.zip',
      },
    });
  });

  it('falls back to a version name when the release has none', () => {
    expect(parseRelease(release({ name: '' }))?.versionName).toBe('1.0.42');
  });

  it('ignores drafts and pre-releases', () => {
    expect(parseRelease(release({ draft: true }))).toBeNull();
    expect(parseRelease(release({ prerelease: true }))).toBeNull();
  });

  it('ignores a release with no APK attached', () => {
    // What a half-failed build looks like: the tag exists, the file does not.
    expect(parseRelease(release({ assets: [] }))).toBeNull();
    expect(
      parseRelease(
        release({ assets: [{ name: 'notes.txt', browser_download_url: 'https://x.test/notes.txt' }] }),
      ),
    ).toBeNull();
  });

  it('reads no web bundles when none are published', () => {
    const only = release({
      assets: [{ name: 'Covault.apk', browser_download_url: 'https://x.test/Covault.apk' }],
    });
    expect(parseRelease(only)?.webBundles).toEqual({});
  });

  it('survives junk', () => {
    expect(parseRelease(null)).toBeNull();
    expect(parseRelease('nope')).toBeNull();
    expect(parseRelease({})).toBeNull();
  });
});

describe('selectUpdate', () => {
  const latest = parseRelease(release())!;

  it('offers a strictly newer build', () => {
    expect(selectUpdate(latest, 41)).toBe(latest);
  });

  it('says nothing when the phone is current', () => {
    expect(selectUpdate(latest, 42)).toBeNull();
  });

  it('never offers a downgrade', () => {
    // A locally built APK carries a higher number than anything published.
    expect(selectUpdate(latest, 99)).toBeNull();
  });

  it('says nothing when either side is unknown', () => {
    expect(selectUpdate(null, 41)).toBeNull();
    expect(selectUpdate(latest, null)).toBeNull();
  });
});

describe('parseWebBundleName', () => {
  it('reads the native fingerprint out of the filename', () => {
    expect(parseWebBundleName('covault-web-a1b2c3d4e5f6.zip')).toBe('a1b2c3d4e5f6');
  });

  it('refuses anything else', () => {
    for (const name of [
      'covault-web.zip',
      'covault-web-.zip',
      'covault-web-NOTHEX.zip',
      'covault-web-a1b2c3d4e5f6.tar',
      'Covault.apk',
      null,
      42,
    ]) {
      expect(parseWebBundleName(name)).toBeNull();
    }
  });
});

describe('selectWebBundle', () => {
  const latest = parseRelease(release())!;

  it('takes the bundle built against this phone’s native code', () => {
    expect(selectWebBundle(latest, 'a1b2c3d4e5f6')).toBe(
      'https://example.test/covault-web-a1b2c3d4e5f6.zip',
    );
  });

  it('takes nothing when the native code has changed', () => {
    // The whole point: a bundle expecting native code this APK does not have
    // must fall through to a full install rather than be applied.
    expect(selectWebBundle(latest, 'ffffffffffff')).toBeNull();
  });

  it('takes nothing when the phone cannot say what it is running', () => {
    // An APK built without the fingerprint resource reports an empty string.
    expect(selectWebBundle(latest, '')).toBeNull();
    expect(selectWebBundle(null, 'a1b2c3d4e5f6')).toBeNull();
  });
});

describe('fetchLatestRelease', () => {
  it('returns the parsed release', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => release(),
    })) as unknown as typeof fetch;
    expect((await fetchLatestRelease(fetchImpl))?.versionCode).toBe(42);
  });

  it('treats a rate-limited or missing release as nothing new', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, json: async () => ({}) })) as unknown as typeof fetch;
    expect(await fetchLatestRelease(fetchImpl)).toBeNull();
  });

  it('swallows a dead network rather than throwing into render', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    expect(await fetchLatestRelease(fetchImpl)).toBeNull();
  });
});

describe('the workflow that feeds it', () => {
  const workflow = readFileSync(
    resolve(__dirname, '../../.github/workflows/build-android.yml'),
    'utf8',
  );

  it('stamps the run number as the APK versionCode', () => {
    expect(workflow).toMatch(/versionCode \$\{\{ github\.run_number \}\}/);
  });

  it('tags the release with the same number, as v<n>', () => {
    // parseReleaseTag only accepts `v<digits>`; anything else and the app goes
    // permanently quiet about updates.
    expect(workflow).toMatch(/TAG="v\$\{\{ github\.run_number \}\}"/);
    expect(workflow).toContain('gh release create "$TAG"');
  });

  it('names the signing key in the Gradle build rather than by location', () => {
    // Dropping the keystore where Gradle is *expected* to look for it is what
    // this used to do, and it silently did nothing — three releases went out
    // under three different keys with a green build every time.
    expect(workflow).toContain('signingConfigs');
    expect(workflow).toContain('keyAlias "androiddebugkey"');
  });

  it('proves the pinned key was the one actually used', () => {
    // The assertion above only says the workflow asks for the right key. This
    // is the one that says the APK got it: without a check on the built file,
    // a signing config that fails to apply is indistinguishable from success.
    expect(workflow).toContain('apksigner');
    expect(workflow).toContain('certificate SHA-256 digest');
  });
});
