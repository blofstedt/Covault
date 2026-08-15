// lib/pendingCaptureQueue.ts
//
// The hand-off between the native capture queue and the JS pipeline.
//
// The native listener writes every captured purchase to a queue on disk, and
// draining that queue empties it in the same call — deliberately, so a failure
// downstream cannot wedge capture by looping forever on the same batch. That
// makes the moment a batch crosses the bridge the moment the phone's only copy
// lives in this process's memory: tray suppression has already removed the
// bank's own alert, so a rescan of the shade has nothing left to find.
//
// Anything that stops the batch from reaching the pipeline therefore destroys
// purchases outright. That included the ordinary case of the app being launched
// by tapping the capture notification: the listener hook mounts and drains
// before Supabase has finished restoring the session, and every drained entry
// was dropped for having no user to file it under.
//
// So the batch is parked in localStorage before the first entry is processed,
// and each entry is released only once the pipeline has actually had it.
// Whatever is left is replayed on the next launch. Re-delivery is safe — the
// pipeline dedups — and an entry that fails repeatedly is abandoned rather than
// retried forever, which keeps the original "never wedge capture" property.

import { log } from './log';
import { covaultNotification } from './covaultNotification';
import type { TransactionDetectedEvent } from './covaultNotification';

/** Where a drained batch waits while it is being processed. */
export const PENDING_CAPTURE_STASH_KEY = 'covault_capture_handoff';

/** How many times an entry may be started before it is abandoned. */
const MAX_ATTEMPTS = 3;

/** How long an unprocessed entry stays worth replaying. */
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

interface StashedCapture {
  id: string;
  /** When the batch carrying this entry crossed the bridge. */
  at: number;
  /** How many times processing it has been started. */
  attempts: number;
  event: TransactionDetectedEvent;
}

let idCounter = 0;

function newId(): string {
  idCounter += 1;
  return `${Date.now().toString(36)}-${idCounter.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function readStash(): StashedCapture[] {
  try {
    const stored = localStorage.getItem(PENDING_CAPTURE_STASH_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (row): row is StashedCapture =>
        !!row && typeof row.id === 'string' && !!row.event && typeof row.event === 'object',
    );
  } catch (e) {
    log.warn('[capture] Could not read the parked captures:', e);
    return [];
  }
}

function writeStash(rows: StashedCapture[]): void {
  try {
    if (rows.length === 0) {
      localStorage.removeItem(PENDING_CAPTURE_STASH_KEY);
      return;
    }
    localStorage.setItem(PENDING_CAPTURE_STASH_KEY, JSON.stringify(rows));
  } catch (e) {
    // Best effort. A batch that cannot be parked is still processed below —
    // this only costs the ability to replay it after a crash.
    log.warn('[capture] Could not park the drained captures:', e);
  }
}

/** Park a freshly drained batch, before any of it is processed. */
function park(events: TransactionDetectedEvent[]): StashedCapture[] {
  const now = Date.now();
  const rows = events.map((event) => ({ id: newId(), at: now, attempts: 1, event }));
  writeStash([...readStash(), ...rows]);
  return rows;
}

/** Forget one entry, because the pipeline has now had it. */
function release(id: string): void {
  const rows = readStash();
  if (!rows.some((row) => row.id === id)) return;
  writeStash(rows.filter((row) => row.id !== id));
}

/**
 * Everything a previous run parked and never finished, with its attempt count
 * bumped. Entries past the attempt or age limit are dropped here rather than
 * retried on every launch for ever.
 */
function takeParked(): StashedCapture[] {
  const rows = readStash();
  if (rows.length === 0) return [];

  const now = Date.now();
  const kept: StashedCapture[] = [];
  let abandoned = 0;
  for (const row of rows) {
    const attempts = Number(row.attempts) || 0;
    const at = Number(row.at) || 0;
    if (attempts >= MAX_ATTEMPTS || now - at > MAX_AGE_MS) {
      abandoned += 1;
      continue;
    }
    kept.push({ ...row, attempts: attempts + 1 });
  }
  if (abandoned > 0) {
    log.warn('[capture] Abandoning', abandoned, 'parked capture(s) that never processed');
  }
  writeStash(kept);
  return kept;
}

type CaptureHandler = (event: TransactionDetectedEvent) => Promise<void>;

async function processBatch(rows: StashedCapture[], handleEvent: CaptureHandler): Promise<void> {
  // Sequential on purpose: the pipeline's dedup and refund matching both read
  // state the previous item may have written.
  for (const row of rows) {
    try {
      await handleEvent(row.event);
      release(row.id);
    } catch (e) {
      // Left parked deliberately, so the next launch tries again.
      log.warn('[capture] Could not process a captured notification; it stays parked:', e);
    }
  }
}

async function runDrain(handleEvent: CaptureHandler): Promise<void> {
  // Leftovers first, so captures are processed in the order they arrived.
  await processBatch(takeParked(), handleEvent);

  if (!covaultNotification?.drainPendingNotifications) return;

  let notifications: TransactionDetectedEvent[] | undefined;
  try {
    ({ notifications } = await covaultNotification.drainPendingNotifications());
  } catch (e) {
    log.warn('[capture] Could not drain the native queue:', e);
    return;
  }
  if (!notifications?.length) return;

  log.debug('[capture] Draining', notifications.length, 'queued notification(s)');
  await processBatch(park(notifications), handleEvent);
}

let inFlight: Promise<void> = Promise.resolve();

/**
 * Take everything the native listener captured while the JS side was not
 * running and put it through the pipeline.
 *
 * Only call this once there is a signed-in user to file the captures under —
 * draining is destructive, and a batch drained too early used to be lost.
 *
 * Serialised: launch and resume can both ask at once, and two drains running
 * together would interleave their parked entries.
 */
export function drainQueuedNotifications(handleEvent: CaptureHandler): Promise<void> {
  inFlight = inFlight
    .catch(() => {})
    .then(() =>
      runDrain(handleEvent).catch((e) => {
        log.warn('[capture] Could not drain queued notifications:', e);
      }),
    );
  return inFlight;
}
