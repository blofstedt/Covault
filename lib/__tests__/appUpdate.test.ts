import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  fetchLatestRelease,
  parseRelease,
  parseReleaseTag,
  selectUpdate,
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
      { browser_download_url: 'https://example.test/Covault-20260803-120000.apk' },
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
      parseRelease(release({ assets: [{ browser_download_url: 'https://x.test/notes.txt' }] })),
    ).toBeNull();
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

  it('pins the signing key, so updates install over the old app', () => {
    // Without this the runner mints a fresh debug key per build and Android
    // refuses the install, which is what forced uninstall-and-reinstall.
    expect(workflow).toContain('$HOME/.android/debug.keystore');
  });
});
