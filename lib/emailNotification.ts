// lib/emailNotification.ts
//
// Deciding whether an email notification is a bank telling you about a purchase.
//
// Some banks only ever announce a purchase by email — for one member of this
// household that is most of their spending, and Covault could not see any of it.
// Letting mail apps through is therefore worth doing, but it is the single most
// dangerous source the app has, for a reason worth stating plainly:
//
//   AN EMAIL THAT MENTIONS A DOLLAR AMOUNT IS NOT A PURCHASE.
//
// Order confirmations, shipping notices, receipts, invoices, newsletters,
// donation appeals and price-drop alerts all carry amounts, and a bank-app
// notification essentially never does anything but announce a transaction. The
// whole safety argument for reading mail at all is the gate below: the SENDER
// has to be a bank before the body is looked at. Everything else — the amount,
// the merchant, the deposit and declined-card rules — is the existing parser's
// job, unchanged, and it only ever runs on mail that got past the sender.
//
// The other half of the safety argument is what an email notification actually
// contains. A mail app does not put the message in the notification; it puts the
// sender in the title and a truncated subject-and-snippet in the body. That is a
// short string of roughly the shape the parser was built for — which is why this
// module hands the parser a reconstructed short string rather than teaching the
// parser about email. `parseNotificationText` is not modified by this feature at
// all, so no bank-app capture changes behaviour.
//
// Mirrored into android-custom/NotificationListener.java. The listener has to
// reach the same verdict on sight, or it announces a capture — and, worse,
// declines to forward one — hours before the app would have decided otherwise.
// lib/__tests__/emailSenderMirror.test.ts parses both files and fails the build
// on drift.

/**
 * Sender fragments distinctive enough to mean "a bank" on their own.
 *
 * Curated by hand rather than derived from the ~350-entry banking app list,
 * for a reason that matters: a great many of those display names are ordinary
 * English words — Simple, Current, Step, One, Dave, Albert, Discover, Ally,
 * Popular, Marcus, Empower, Stack, Curve, Tide. Matching on those would let a
 * mail from a person called Dave, or any shop's "Discover our new range",
 * through the gate. A missed bank costs one uncaptured email, which the bank's
 * own app usually catches anyway; a false match costs a wrong row on the
 * dashboard. The list is deliberately biased towards the first.
 *
 * Matched as whole words against a normalised sender, so "td" does not match
 * "limited" and "cu" does not match "custom".
 */
// EMAIL_BANK_SENDERS_BEGIN
export const EMAIL_BANK_SENDERS = [
  // Canada
  'rbc', 'royal bank', 'bmo', 'bank of montreal', 'cibc', 'scotiabank', 'scotia',
  'td canada', 'canada trust', 'tangerine', 'desjardins', 'national bank',
  'banque nationale', 'atb', 'simplii', 'wealthsimple', 'koho', 'neo financial',
  'eq bank', 'motusbank', 'vancity', 'meridian', 'servus', 'coast capital',
  'interac', 'manulife', 'sun life', 'laurentian',
  // United States
  'chase', 'wells fargo', 'bank of america', 'citibank', 'citi card',
  'capital one', 'american express', 'amex', 'discover card', 'us bank',
  'usaa', 'navy federal', 'pnc bank', 'truist', 'suntrust', 'keybank',
  'huntington', 'fifth third', 'regions bank', 'synchrony', 'barclaycard',
  'citizens bank', 'comerica', 'schwab', 'fidelity', 'sofi', 'chime',
  'varo bank', 'venmo', 'cash app', 'paypal', 'zelle',
  // United Kingdom & Ireland
  'barclays', 'lloyds', 'natwest', 'halifax', 'nationwide', 'santander',
  'starling', 'monzo', 'revolut', 'hsbc', 'tsb', 'metro bank', 'virgin money',
  'bank of scotland', 'aib', 'bank of ireland', 'permanent tsb',
  // Europe
  'deutsche bank', 'commerzbank', 'sparkasse', 'volksbank', 'postbank',
  'comdirect', 'ing', 'abn amro', 'rabobank', 'bunq', 'kbc', 'belfius',
  'bnp paribas', 'societe generale', 'credit agricole', 'credit mutuel',
  'caisse epargne', 'caisse d epargne', 'boursorama', 'bbva', 'caixabank', 'sabadell', 'bankinter',
  'unicredit', 'intesa', 'fineco', 'nordea', 'danske bank', 'swedbank',
  'handelsbanken', 'dnb', 'sparebank', 'erste bank', 'raiffeisen', 'postfinance',
  'ubs', 'mbank', 'pko', 'pekao', 'wise', 'klarna', 'n26',
];
// EMAIL_BANK_SENDERS_END

/**
 * Words that mean "a financial institution" wherever they appear in a sender.
 *
 * These carry a sender on their own because no ordinary correspondent is called
 * "… Credit Union" or "Cardmember Services". Kept short and specific for the
 * same reason as the list above — "credit" and "card" alone are NOT here,
 * because "credit" appears in marketing copy and "card" in every greeting-card
 * shop on earth.
 */
// EMAIL_BANK_SENDER_WORDS_BEGIN
export const EMAIL_BANK_SENDER_WORDS = [
  'bank', 'banque', 'banco', 'credit union', 'creditunion', 'building society',
  'cardmember', 'card services', 'card alert', 'fraud alert', 'kreditkarte',
  'sparkasse', 'caisse populaire', 'federal credit',
];
// EMAIL_BANK_SENDER_WORDS_END

/**
 * Fold a sender into something the lists above can be matched against.
 *
 * An email sender arrives in several shapes — a display name ("RBC Alerts"), a
 * bare address ("alerts@rbc.com"), or both. Punctuation and the @ and dots of an
 * address all become spaces so that a domain contributes its words: "rbc.com"
 * becomes "rbc com", which the word matcher can then see.
 */
export function normalizeSender(sender: string | null | undefined): string {
  return (sender || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** True when `needle` appears in `haystack` as a whole word or word sequence. */
function containsPhrase(haystack: string, needle: string): boolean {
  if (!needle) return false;
  return ` ${haystack} `.includes(` ${needle} `);
}

/**
 * The gate. True only when this sender is a bank.
 *
 * Everything about email capture rests on this returning false for the mail a
 * person actually receives all day.
 */
export function looksLikeBankSender(sender: string | null | undefined): boolean {
  const normalized = normalizeSender(sender);
  if (!normalized) return false;
  for (const token of EMAIL_BANK_SENDERS) {
    if (containsPhrase(normalized, token)) return true;
  }
  for (const word of EMAIL_BANK_SENDER_WORDS) {
    if (containsPhrase(normalized, word)) return true;
  }
  return false;
}

/**
 * Phrases that mark a notification as a rolled-up summary of several messages.
 *
 * Mail apps collapse a busy inbox into one notification. There is no way to tell
 * which message an amount belongs to — or whether the amount belongs to a
 * message from the bank at all — so these are refused outright rather than
 * guessed at.
 */
// EMAIL_SUMMARY_PHRASES_BEGIN
export const EMAIL_SUMMARY_PHRASES = [
  'new messages', 'new emails', 'new e-mails', 'unread messages', 'unread emails',
  'more messages', 'other messages', 'nouveaux messages', 'nuevos mensajes',
  'neue nachrichten',
];
// EMAIL_SUMMARY_PHRASES_END

export interface EmailNotificationInput {
  /** Notification title — the sender, for every mail app checked. */
  title?: string | null;
  /** Notification body — subject and/or a truncated snippet. */
  body?: string | null;
  /** The concatenated text, used only as a fallback when title/body are absent. */
  rawText?: string | null;
  /** True when Android flagged this as the group summary for a bundle. */
  isGroupSummary?: boolean;
  /** How many messages the notification represents, when the app says so. */
  lineCount?: number;
}

/**
 * True when this notification stands for more than one message.
 *
 * Three independent signals, because the mail apps disagree about which they
 * use: Android's own group-summary flag, an inbox-style notification carrying
 * several text lines, and a body that says so in words.
 */
export function isBundledEmailNotification(input: EmailNotificationInput): boolean {
  if (input.isGroupSummary) return true;
  if ((input.lineCount ?? 0) > 1) return true;
  const haystack = `${input.title || ''} ${input.body || ''}`.toLowerCase();
  return EMAIL_SUMMARY_PHRASES.some((phrase) => haystack.includes(phrase));
}

export interface EmailAlert {
  /** The sender as the mail app reported it. */
  sender: string;
  /** Subject plus snippet — what gets handed to the ordinary parser. */
  text: string;
}

/**
 * Turn an email notification into something the transaction parser can read, or
 * null if it must not be read at all.
 *
 * Order matters and each step can only reject:
 *
 *   1. There has to be a sender. Without a title there is nothing to vet, and an
 *      unvetted email body is exactly what this module exists to prevent.
 *   2. The sender has to be a bank.
 *   3. The notification has to stand for a single message.
 *
 * What comes back is deliberately SHORT — subject and snippet only, with the
 * sender dropped. Leaving the bank's name on the front would give the vendor
 * extractor a plausible merchant to latch onto, and every capture would be
 * attributed to the bank instead of the shop.
 */
export function parseEmailAlert(input: EmailNotificationInput): EmailAlert | null {
  const sender = (input.title || '').trim();
  if (!sender) return null;
  if (!looksLikeBankSender(sender)) return null;
  if (isBundledEmailNotification(input)) return null;

  const body = (input.body || '').trim();
  // Fall back to the concatenated text minus the sender, for an older APK that
  // sends only `raw_text`. Without this, a phone running a previous native build
  // against a newer web bundle would silently capture nothing from email.
  const text = body || (input.rawText || '').replace(sender, '').trim();
  if (!text) return null;

  return { sender, text };
}
