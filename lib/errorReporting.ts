// lib/errorReporting.ts
//
// Knowing that the app broke on somebody else's phone.
//
// Until now a crash on a user's device was visible to nobody. The error
// boundary drew an apology, `log.error` wrote to a console no one would ever
// read, and the only way to learn that capture had stopped working was for the
// user to say so. That is survivable while the only user is the person who
// wrote it, and not survivable for anyone paying.
//
// ─── What must never leave the phone ────────────────────────────────────────
//
// This is a budgeting app, so the ordinary defaults of an error reporter are
// dangerous here in a way they are not in most apps. Three of them are turned
// off deliberately, and each one has sent somebody's private data to a third
// party in some app somewhere:
//
//   1. Session Replay is OFF and must stay off. It records the screen. On this
//      app that screen is the user's income, their balance, and every shop
//      they have been to. There is no sampling rate at which that is
//      acceptable.
//
//   2. Console breadcrumbs are OFF. `log.warn` and `log.error` still emit in
//      production builds, and some of those lines name a merchant. Sentry's
//      default is to attach the last hundred console lines to every event.
//
//   3. Network breadcrumb URLs are stripped of their query strings. Covault
//      talks to PostgREST, where the query string IS the data: a request can
//      read `?vendor=eq.STARBUCKS&amount=eq.12.34`. The path alone says which
//      table was being read, which is all that is useful for debugging anyway.
//
// What does get sent: the error and its stack, the build number, whether this
// is the phone or the browser, and the user's account id — an opaque UUID,
// never their name or email. The id is there because "one user hit this fifty
// times" and "fifty users hit this once" need completely different responses
// and are otherwise indistinguishable. The privacy policy says so.
//
// ─── Inert until configured ─────────────────────────────────────────────────
//
// With no DSN in the build, every function here is a no-op. That is not a
// failure mode, it is the normal state of a local `npm run dev` and of any
// build made before the secret exists — so nothing here may throw, log
// loudly, or slow anything down when it is switched off.

import { log } from './log';

/** Set once init has been attempted, so it cannot run twice. */
let started = false;
/** Resolved Sentry module, once the dynamic import has landed. */
let sentry: typeof import('@sentry/react') | null = null;

/**
 * Errors raised before the reporter finished loading.
 *
 * Small on purpose: this only has to cover the few hundred milliseconds
 * between the first render and the dynamic import resolving. An unbounded
 * queue on a device that is failing to load Sentry is a memory leak in the
 * middle of whatever is already going wrong.
 */
const pending: Array<{ error: unknown; context?: Record<string, unknown> }> = [];
const MAX_PENDING = 20;

function dsn(): string | undefined {
  try {
    const value = (import.meta as { env?: Record<string, string | undefined> }).env
      ?.VITE_SENTRY_DSN;
    return value && value.trim() ? value.trim() : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The build this is, as Sentry's release identity.
 *
 * The CI run number is the versionCode, the release tag and the update check
 * all at once (see the invariant in CLAUDE.md), so it is the one number that
 * identifies a build to everything else in this project. Passed in at build
 * time because Sentry needs the release at init, before anything native can be
 * asked.
 */
function release(): string | undefined {
  try {
    const build = (import.meta as { env?: Record<string, string | undefined> }).env
      ?.VITE_BUILD_NUMBER;
    return build && build.trim() ? `covault@${build.trim()}` : undefined;
  } catch {
    return undefined;
  }
}

/** Query strings are data here, not routing. Keep the path, drop the rest. */
function stripQuery(url: unknown): unknown {
  if (typeof url !== 'string') return url;
  const cut = url.indexOf('?');
  return cut === -1 ? url : `${url.slice(0, cut)}?[redacted]`;
}

/**
 * Start reporting, if this build was given somewhere to report to.
 *
 * Fire and forget: the caller does not wait for it, and a failure to load the
 * reporter must never be the reason the app does not start.
 */
export function initErrorReporting(): void {
  if (started) return;
  started = true;

  const url = dsn();
  if (!url) {
    log.debug('[errorReporting] No DSN in this build — reporting is off.');
    return;
  }

  // Imported dynamically so it stays out of the entry chunk. Nothing waits on
  // it, and the few hundred milliseconds before it lands are covered by the
  // queue above.
  import('@sentry/react')
    .then((Sentry) => {
      Sentry.init({
        dsn: url,
        release: release(),
        environment: import.meta.env?.PROD ? 'production' : 'development',

        // No performance tracing and NO SESSION REPLAY. See the note at the
        // top: replay records the screen, and this screen is somebody's money.
        tracesSampleRate: 0,
        replaysSessionSampleRate: 0,
        replaysOnErrorSampleRate: 0,

        // Never attach the things Sentry can infer about a person.
        sendDefaultPii: false,

        integrations: (defaults) =>
          defaults
            // The console integration attaches recent console output to every
            // event, and `log.warn`/`log.error` survive into production builds
            // where some of them name a merchant.
            .filter((integration) => integration.name !== 'Breadcrumbs')
            .concat(Sentry.breadcrumbsIntegration({ console: false })),

        beforeBreadcrumb(breadcrumb) {
          if (breadcrumb.category === 'console') return null;
          if (breadcrumb.data && 'url' in breadcrumb.data) {
            breadcrumb.data.url = stripQuery(breadcrumb.data.url);
          }
          return breadcrumb;
        },

        beforeSend(event) {
          // Belt and braces over `sendDefaultPii: false`, because these are
          // the fields that would carry a real person's identity and the cost
          // of one of them slipping through is not recoverable.
          if (event.user) {
            delete event.user.email;
            delete event.user.username;
            delete event.user.ip_address;
          }
          if (event.request) {
            delete event.request.query_string;
            delete event.request.cookies;
            delete event.request.data;
            event.request.url = stripQuery(event.request.url) as string | undefined;
          }
          return event;
        },
      });

      sentry = Sentry;
      for (const item of pending.splice(0)) {
        forward(item.error, item.context);
      }
      log.debug('[errorReporting] Reporting is on.');
    })
    .catch((e) => {
      // A phone that cannot load the reporter is a phone that carries on
      // without one.
      log.debug('[errorReporting] Could not start reporting:', e);
    });
}

function forward(error: unknown, context?: Record<string, unknown>): void {
  if (!sentry) return;
  try {
    sentry.captureException(error, context ? { extra: context } : undefined);
  } catch (e) {
    log.debug('[errorReporting] Could not report an error:', e);
  }
}

/**
 * Report an error that was caught and handled.
 *
 * Sentry catches what reaches the window by itself; this is for the places
 * that already catch — the error boundary above all — where the app recovers
 * and the user is told, but nobody would otherwise know it happened.
 */
export function reportError(error: unknown, context?: Record<string, unknown>): void {
  if (!started || !dsn()) return;
  if (sentry) {
    forward(error, context);
    return;
  }
  if (pending.length < MAX_PENDING) pending.push({ error, context });
}

/**
 * Who this is, as an opaque id and nothing else.
 *
 * Never the name or the email, both of which are on the settings row this id
 * comes from and neither of which helps debug anything.
 */
export function setReportingUser(userId: string | null | undefined): void {
  if (!sentry) return;
  try {
    sentry.setUser(userId ? { id: userId } : null);
  } catch (e) {
    log.debug('[errorReporting] Could not set the user:', e);
  }
}

/** Record which build is running, once the phone can say. */
export function setReportingBuild(versionCode: number | null): void {
  if (!sentry || versionCode === null) return;
  try {
    sentry.setTag('versionCode', String(versionCode));
  } catch (e) {
    log.debug('[errorReporting] Could not tag the build:', e);
  }
}
