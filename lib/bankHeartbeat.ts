// lib/bankHeartbeat.ts
//
// "Have we ever actually heard from this bank?"
//
// A user whose bank app has its own notifications switched off in Android sees
// an app that simply never captures anything. Nothing is broken, nothing is
// logged, and there is no message anywhere — it looks exactly like a feature
// that does not work, which is what the first person to use Covault concluded.
//
// The app cannot read that state. Android has no public way to ask whether
// ANOTHER app's notifications are enabled: `areNotificationsEnabled` and
// `getNotificationChannels` are scoped to the calling package, and the
// per-package variants are system APIs a sideloaded app cannot hold. The
// listener's own ranking data only describes notifications that have been
// posted, which is no help at all when the complaint is that none are.
//
// So this records the one thing the app CAN observe — the last time anything
// arrived from each bank — and lets the settings screen say, honestly, "we
// have heard nothing from this one since you turned capture on, and the most
// likely reason is its notifications are off". An inference offered as an
// inference, with a button that goes straight to the page that fixes it.
//
// Device-level rather than per-user, unlike lib/onboardingState.ts. What it
// records is a fact about this phone's Android settings, not about an account,
// and it stays true when a second person signs in on the same handset.

/** `{ [packageName]: epoch millis }` — when each bank last reached us. */
const LAST_SEEN_KEY = 'covault_bank_last_seen_v1';

/** When capture was switched on, so nothing is judged before it was listening. */
const CAPTURE_SINCE_KEY = 'covault_capture_on_since_v1';

/**
 * How long a selected bank may stay silent before it is worth mentioning.
 *
 * Deliberately generous. The signal is "no alerts", and no alerts is also what
 * a quiet week on a card the user rarely touches looks like — so the warning
 * has to be slow enough that it is nearly always right, and worded so that
 * being wrong costs the user a shrug rather than a wrong action.
 */
export const BANK_SILENCE_DAYS = 7;

const MS_PER_DAY = 86_400_000;

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as T) : fallback;
  } catch {
    // Storage blocked or holding something unparseable. The cost is a warning
    // that never appears, which is where the app already was.
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* see readJson */
  }
}

/** Everything we have heard from, and when. */
export function readBankLastSeen(): Record<string, number> {
  const stored = readJson<Record<string, unknown>>(LAST_SEEN_KEY, {});
  const out: Record<string, number> = {};
  for (const [pkg, at] of Object.entries(stored)) {
    const millis = Number(at);
    if (pkg && Number.isFinite(millis) && millis > 0) out[pkg.toLowerCase()] = millis;
  }
  return out;
}

/**
 * An alert arrived from this app.
 *
 * Called for every alert a monitored bank sends, including ones the pipeline
 * later decides are not purchases — a price alert still proves the bank's
 * notifications reach Covault, which is the only question this answers.
 */
export function noteBankAlertSeen(
  packageName: string | null | undefined,
  now: number = Date.now(),
): void {
  const pkg = String(packageName || '').trim().toLowerCase();
  if (!pkg) return;
  const seen = readBankLastSeen();
  seen[pkg] = now;
  writeJson(LAST_SEEN_KEY, seen);
}

/** When capture was switched on, or null if it is off or was never on. */
export function captureOnSince(): number | null {
  try {
    const raw = localStorage.getItem(CAPTURE_SINCE_KEY);
    const millis = Number(raw);
    return raw && Number.isFinite(millis) && millis > 0 ? millis : null;
  } catch {
    return null;
  }
}

/**
 * Record that capture is on, keeping the original moment.
 *
 * Idempotent on purpose: this is called from an effect that runs on every
 * launch while capture is enabled, and re-stamping it would restart the grace
 * period every time the app was opened — so a bank could stay silent forever
 * without ever being mentioned.
 */
export function noteCaptureEnabled(now: number = Date.now()): void {
  if (captureOnSince() !== null) return;
  try {
    localStorage.setItem(CAPTURE_SINCE_KEY, String(now));
  } catch {
    /* see readJson */
  }
}

/** Capture was switched off; the clock starts again if it comes back on. */
export function noteCaptureDisabled(): void {
  try {
    localStorage.removeItem(CAPTURE_SINCE_KEY);
  } catch {
    /* see readJson */
  }
}

/**
 * Which of these banks have said nothing for long enough to be worth raising.
 *
 * Pure, so the rule can be tested without a phone. A bank counts as silent
 * when capture has been on for longer than the grace period AND either nothing
 * has ever arrived from it, or the last thing that did is older than that.
 */
export function silentBanks({
  packages,
  lastSeen,
  onSince,
  now = Date.now(),
  graceDays = BANK_SILENCE_DAYS,
}: {
  packages: readonly string[];
  lastSeen: Record<string, number>;
  onSince: number | null;
  now?: number;
  graceDays?: number;
}): string[] {
  // Capture off, or on too recently to have missed anything: say nothing.
  if (onSince === null) return [];
  const grace = graceDays * MS_PER_DAY;
  if (now - onSince < grace) return [];

  return (packages || []).filter((pkg) => {
    const key = String(pkg || '').trim().toLowerCase();
    if (!key) return false;
    const seen = lastSeen[key];
    if (!seen) return true;
    return now - seen >= grace;
  });
}
