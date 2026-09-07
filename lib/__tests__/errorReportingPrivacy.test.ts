/**
 * An error reporter in a budgeting app, and the three defaults that would send
 * somebody's money to a third party.
 *
 * None of these can fail a build by breaking. Session Replay switched on is a
 * working app that quietly films the user's finances; console breadcrumbs are a
 * working app that attaches merchant names to every crash; an unstripped
 * PostgREST URL is a working app that puts `?vendor=eq.STARBUCKS` in a bug
 * report. Every one of them looks fine from the inside, which is why they are
 * pinned here rather than trusted to review.
 *
 * The source is read as text on purpose. Calling `Sentry.init` for real would
 * mean either shipping a DSN into the test suite or asserting on a mock, and
 * neither tells you what a production build actually does.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

const SOURCE = read('lib/errorReporting.ts');
const POLICY = read('components/PrivacyPolicy.tsx');
const WORKFLOW = read('.github/workflows/build-android.yml');

describe('the recording that must never happen', () => {
  it('never records the screen', () => {
    // This screen is the user's income, their balance and every shop they have
    // been to. There is no sample rate at which filming it is acceptable.
    expect(SOURCE).toContain('replaysSessionSampleRate: 0');
    expect(SOURCE).toContain('replaysOnErrorSampleRate: 0');
  });

  it('never attaches the console', () => {
    // log.warn and log.error survive into production builds and some of those
    // lines name a merchant. Sentry's default is to attach the last hundred.
    expect(SOURCE).toContain('console: false');
    expect(SOURCE).toMatch(/category === 'console'\)\s*return null/);
  });

  it('never sends what Sentry can infer about a person', () => {
    expect(SOURCE).toContain('sendDefaultPii: false');
  });

  it('drops the name and the email even so', () => {
    // Belt and braces: these are the fields that carry a real identity, and
    // one of them slipping through is not recoverable.
    for (const field of ['email', 'username', 'ip_address']) {
      expect(SOURCE).toContain(`delete event.user.${field}`);
    }
  });
});

describe('the integration this replaces', () => {
  it('is still called what the code thinks it is called', () => {
    // The console is switched off twice over: the default Breadcrumbs
    // integration is swapped for one built with `console: false`, AND
    // beforeBreadcrumb drops console entries outright. This pins the first
    // half, which is a magic string that a Sentry major could rename — if it
    // ever does, the swap silently stops matching and only the second half is
    // left holding the line.
    const sentry = require('@sentry/react');
    const defaults = sentry.getDefaultIntegrations({}).map((i: { name: string }) => i.name);
    expect(defaults).toContain('Breadcrumbs');
    expect(sentry.breadcrumbsIntegration({ console: false }).name).toBe('Breadcrumbs');
  });
});

describe('query strings, which here are the data', () => {
  it('are stripped from breadcrumbs and from the event', () => {
    // Covault talks to PostgREST, where a URL can read
    // ?vendor=eq.STARBUCKS&amount=eq.12.34. The path says which table was
    // being read, which is all that helps anyway.
    expect(SOURCE).toContain('function stripQuery');
    expect(SOURCE).toMatch(/breadcrumb\.data\.url = stripQuery/);
    expect(SOURCE).toContain('delete event.request.query_string');
  });

  it('keeps the path, so an event still says what was being talked to', () => {
    expect(SOURCE).toContain('[redacted]');
  });
});

describe('switched off until it is configured', () => {
  it('does nothing without a DSN', () => {
    // The normal state of `npm run dev`, and of every build made before the
    // secret exists. It must be inert, not broken.
    expect(SOURCE).toMatch(/if \(!url\)/);
    expect(SOURCE).toContain('VITE_SENTRY_DSN');
  });

  it('is loaded dynamically, so it stays out of the entry chunk', () => {
    // ~30KB that nothing on the first paint waits for.
    expect(SOURCE).toContain("import('@sentry/react')");
  });

  it('reports against the build number the rest of the project already uses', () => {
    // The CI run number is the versionCode AND the release tag AND the update
    // check. Making it the release identity too means a crash names the build
    // that introduced it.
    expect(SOURCE).toContain('VITE_BUILD_NUMBER');
    expect(WORKFLOW).toContain('VITE_BUILD_NUMBER: ${{ github.run_number }}');
    expect(WORKFLOW).toContain('VITE_SENTRY_DSN: ${{ secrets.VITE_SENTRY_DSN }}');
  });
});

describe('the privacy policy keeps up with the code', () => {
  it('names the reporter as a third party', () => {
    // Adding a service that receives anything at all, without saying so, is
    // the policy becoming untrue.
    expect(POLICY).toMatch(/Sentry/);
  });

  it('says what it does and does not receive', () => {
    expect(POLICY).toMatch(/crash|error/i);
  });
});
