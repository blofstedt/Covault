import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  EMAIL_BANK_SENDERS,
  EMAIL_BANK_SENDER_WORDS,
  EMAIL_SUMMARY_PHRASES,
  isBundledEmailNotification,
  looksLikeBankSender,
  parseEmailAlert,
} from '../emailNotification';
import { parseNotificationText } from '../deviceTransactionParser';

/**
 * Reading email is the most dangerous thing this app does, and this file is the
 * argument that it is safe enough to do.
 *
 * The reason it had to be done at all: some banks announce a purchase ONLY by
 * email. For one member of the household that is most of their spending, and
 * none of it was being captured — the app read banking apps and nothing else.
 *
 * The reason it is dangerous: a bank app essentially never says anything except
 * "you were charged". An inbox says everything, and a great deal of it carries a
 * dollar amount. Order confirmations, shipping notices, invoices, receipts,
 * donation appeals, newsletters and price-drop alerts would every one of them
 * read as a purchase to a parser built for bank wording.
 *
 * The whole defence is that the SENDER is vetted before the body is read. These
 * tests pin that, from both directions: real bank alerts get through, and the
 * mail a person actually receives all day does not.
 *
 * What cannot be tested here is the phone. Nothing in CI posts a notification,
 * and what Gmail, Outlook and Samsung Email really put in the title and body of
 * one is the assumption this whole module rests on.
 */

describe('the sender gate', () => {
  it('accepts the banks people actually get alerts from', () => {
    for (const sender of [
      'RBC Royal Bank',
      'Scotiabank',
      'CIBC Alerts',
      'BMO',
      'TD Canada Trust',
      'American Express',
      'Chase',
      'alerts@rbc.com',
      'no-reply@scotiabank.com',
      'Barclays',
      'Tangerine',
      'Smalltown Credit Union',
      'Cardmember Services',
    ]) {
      expect(looksLikeBankSender(sender), sender).toBe(true);
    }
  });

  it('refuses the mail that fills an actual inbox', () => {
    // Every one of these routinely carries a dollar amount, and every one of
    // them would have become a purchase without this gate. This is the list
    // that matters most in the file.
    for (const sender of [
      'Amazon.ca',
      'Amazon Marketplace',
      'Uber Receipts',
      'DoorDash',
      'Netflix',
      'Spotify',
      'Apple',
      'Google Play',
      'LinkedIn',
      'Costco Wholesale',
      'Best Buy',
      'Indigo',
      'Air Canada',
      'Expedia',
      'PayPal Shopping Deals Newsletter'.replace('PayPal ', ''), // "Shopping Deals Newsletter"
      'Dave',
      'Albert Chen',
      'Simple Habit',
      'Current Affairs Weekly',
      'Step Fitness',
      'Discover Toronto',
      'Ally Robinson',
      'Marcus Webb',
      'mom',
      'Google Calendar',
      'GitHub',
      'Slack',
    ]) {
      expect(looksLikeBankSender(sender), sender).toBe(false);
    }
  });

  it('does not match a bank name buried inside a longer word', () => {
    // Whole-word matching is what keeps two- and three-letter bank names safe.
    expect(looksLikeBankSender('Unlimited Ltd')).toBe(false);
    expect(looksLikeBankSender('Custom Framing')).toBe(false);
    expect(looksLikeBankSender('Ingredients Weekly')).toBe(false);
    expect(looksLikeBankSender('Chasing Waterfalls')).toBe(false);
  });

  it('treats an empty or missing sender as not a bank', () => {
    expect(looksLikeBankSender('')).toBe(false);
    expect(looksLikeBankSender('   ')).toBe(false);
    expect(looksLikeBankSender(null)).toBe(false);
    expect(looksLikeBankSender(undefined)).toBe(false);
  });

  it('folds accents, so a decorated name still matches', () => {
    expect(looksLikeBankSender('Société Générale')).toBe(true);
    expect(looksLikeBankSender("Caisse d'Épargne")).toBe(true);
  });
});

describe('bundled notifications', () => {
  it('refuses a rolled-up inbox however the mail app signals it', () => {
    expect(isBundledEmailNotification({ title: 'Gmail', body: '3 new messages' })).toBe(true);
    expect(isBundledEmailNotification({ title: 'RBC', body: 'x', isGroupSummary: true })).toBe(true);
    expect(isBundledEmailNotification({ title: 'RBC', body: 'x', lineCount: 4 })).toBe(true);
  });

  it('lets a single message through', () => {
    expect(isBundledEmailNotification({
      title: 'RBC Royal Bank',
      body: 'A purchase of $42.10 at LOBLAWS was made on your card.',
      lineCount: 1,
    })).toBe(false);
  });
});

describe('what reaches the parser', () => {
  it('captures a real bank alert email', () => {
    const alert = parseEmailAlert({
      title: 'RBC Royal Bank',
      body: 'Purchase Alert: A purchase of $42.10 at LOBLAWS #1234 was charged to your card ending 4321.',
    });
    expect(alert).not.toBeNull();

    const parsed = parseNotificationText(alert!.text);
    expect(parsed.isOutgoing).toBe(true);
    expect(parsed.amount).toBe(42.10);
    // The merchant, not the bank. The sender is dropped before parsing for
    // exactly this reason — left on the front, every capture would be filed
    // against the bank instead of the shop.
    expect(parsed.vendorDisplay?.toLowerCase()).toContain('loblaws');
  });

  it('drops the sender from the text handed on', () => {
    const alert = parseEmailAlert({
      title: 'Scotiabank',
      body: 'You spent $18.00 at TIM HORTONS.',
    });
    expect(alert!.text).not.toContain('Scotiabank');
  });

  it('refuses an order confirmation that mentions money', () => {
    expect(parseEmailAlert({
      title: 'Amazon.ca',
      body: 'Your order of $84.99 has shipped.',
    })).toBeNull();
  });

  it('refuses a newsletter that mentions money', () => {
    expect(parseEmailAlert({
      title: 'Best Buy Deals',
      body: 'Save $200 on laptops this weekend only!',
    })).toBeNull();
  });

  it('refuses a bundled notification even from a real bank', () => {
    expect(parseEmailAlert({
      title: 'RBC Royal Bank',
      body: '5 new messages',
    })).toBeNull();
  });

  it('refuses an email with no sender at all', () => {
    expect(parseEmailAlert({ title: '', body: 'You spent $10.00 at SOMEWHERE' })).toBeNull();
  });

  /**
   * The existing parser is not modified by email support, so every protection it
   * already had applies to mail for free. These are the ones that matter most,
   * because a bank's email footer and its push say different things.
   */
  it('still refuses a deposit, a declined charge and a statement notice from a bank sender', () => {
    const cases = [
      'A deposit of $2,400.00 has been made to your account.',
      'Your purchase of $37.67 at NEWSHOSTING.COM was declined.',
      'Your statement is ready. Minimum payment due: $35.00',
    ];
    for (const body of cases) {
      const alert = parseEmailAlert({ title: 'RBC Royal Bank', body });
      expect(alert, body).not.toBeNull();
      // The sender gate passed it; the ordinary parser is what refuses it.
      expect(parseNotificationText(alert!.text).isOutgoing, body).toBe(false);
    }
  });
});

/**
 * The listener has to reach the same verdict on sight. It decides whether the
 * alert is forwarded off the phone at all, so a list that drifts here costs
 * captures the web side would have accepted — silently, and with the app closed
 * where nothing can recover them.
 */
describe('the listener holds the same lists', () => {
  const JAVA = readFileSync(
    resolve(__dirname, '../../android-custom/NotificationListener.java'),
    'utf-8',
  );
  const TS = readFileSync(resolve(__dirname, '../emailNotification.ts'), 'utf-8');

  function block(source: string, name: string): string {
    const begin = source.indexOf(`// ${name}_BEGIN`);
    const end = source.indexOf(`// ${name}_END`);
    expect(begin, `${name}_BEGIN marker missing`).toBeGreaterThan(-1);
    expect(end, `${name}_END marker missing`).toBeGreaterThan(begin);
    return source.slice(begin, end);
  }

  function phrasesIn(source: string, name: string): string[] {
    return [...block(source, name).matchAll(/'([^']+)'|"([^"]+)"/g)].map((m) => m[1] ?? m[2]);
  }

  const MIRRORED: Array<[string, readonly string[]]> = [
    ['EMAIL_BANK_SENDERS', EMAIL_BANK_SENDERS],
    ['EMAIL_BANK_SENDER_WORDS', EMAIL_BANK_SENDER_WORDS],
    ['EMAIL_SUMMARY_PHRASES', EMAIL_SUMMARY_PHRASES],
  ];

  for (const [name, tsList] of MIRRORED) {
    it(`${name} is identical in both files`, () => {
      const fromTs = phrasesIn(TS, name);
      const fromJava = phrasesIn(JAVA, name);
      expect(fromTs.length, `${name} is empty in TypeScript`).toBeGreaterThan(0);
      expect(fromJava.length, `${name} is empty in Java`).toBeGreaterThan(0);
      expect([...fromJava].sort()).toEqual([...fromTs].sort());
      // And the exported constant matches its own source block, so the list the
      // code actually uses is the one being compared.
      expect([...fromTs].sort()).toEqual([...tsList].sort());
    });
  }

  it('the listener vets the sender and refuses bundles before forwarding', () => {
    expect(JAVA).toMatch(/looksLikeBankSender\(title\)/);
    expect(JAVA).toMatch(/isBundledEmailNotification\(/);
  });

  it('the listener never hides an email from the tray', () => {
    // Deleting the user's actual mail would destroy something Covault does not
    // own and cannot put back.
    expect(JAVA).toMatch(/if\s*\(\s*!fromEmail\s*\)\s*\{[\s\S]{0,200}maybeHideBankNotification/);
  });

  it('an email capture writes no optimistic widget delta', () => {
    // Most banks announce a purchase twice; the web pipeline drops whichever
    // copy arrives second. A delta for a copy about to be discarded would show
    // the purchase twice on the home screen until the app was next opened.
    expect(JAVA).toMatch(/!fromScan\s*&&\s*fromMonitored\s*&&\s*!fromEmail/);
  });
});
