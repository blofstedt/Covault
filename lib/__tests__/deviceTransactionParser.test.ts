import { describe, it, expect } from 'vitest';
import { findAllAmounts, parseNotificationText, pickAmount } from '../deviceTransactionParser';

describe('deviceTransactionParser', () => {
  it('ignores OTP/security notifications', () => {
    const result = parseNotificationText('Your verification code is 123456 for login.');
    expect(result.isOutgoing).toBe(false);
  });

  it('picks spend amount over balance amount', () => {
    const text = 'You spent $12.34 at Walmart. Available balance $923.12';
    const candidates = findAllAmounts(text);
    const picked = pickAmount(candidates, text.toLowerCase());
    expect(picked).toBe(12.34);
  });

  it('extracts vendor and recurrence', () => {
    const result = parseNotificationText('Payment to netflix monthly for $22.99');
    expect(result.isOutgoing).toBe(true);
    expect(result.vendorDisplay).toBe('Netflix');
    expect(result.recurrence).toBe('Monthly');
  });

  it('parses transfer out notifications', () => {
    const result = parseNotificationText('Interac e-transfer sent to Alex for CAD 40.00');
    expect(result.isOutgoing).toBe(true);
    expect(result.amount).toBe(40);
    expect(result.vendorDisplay).toBe('Alex');
  });

  it('parses spent notifications with store suffix ids (real-world case)', () => {
    const result = parseNotificationText('TIM HORTONS #5028 You spent $7.34 with your credit card.');
    expect(result.isOutgoing).toBe(true);
    expect(result.amount).toBe(7.34);
    expect(result.vendorDisplay).toBe('Tim Hortons');
  });

  it('ignores store number ids as amount candidates', () => {
    const text = 'TIM HORTONS #5028 You spent $7.34 with your credit card.';
    const candidates = findAllAmounts(text);
    const picked = pickAmount(candidates, text.toLowerCase());
    expect(picked).toBe(7.34);
  });

  it('supports outgoing cost wording', () => {
    const result = parseNotificationText('This transaction costs $19.99 at Uber Eats');
    expect(result.isOutgoing).toBe(true);
    expect(result.amount).toBe(19.99);
    expect(result.vendorDisplay).toBe('Uber Eats');
  });

  it('accepts one-time purchase wording as outgoing spend', () => {
    const result = parseNotificationText('One-time purchase at Steam for $35.00');
    expect(result.isOutgoing).toBe(true);
    expect(result.amount).toBe(35);
    expect(result.vendorDisplay).toBe('Steam');
  });

  // ── Income rejection (per product spec: only expenses are captured) ──
  it('rejects e-Transfer received notifications', () => {
    const result = parseNotificationText('You received an Interac e-Transfer of $200 from John Smith');
    expect(result.isOutgoing).toBe(false);
    expect(result.isIncome).toBe(true);
    expect(result.rejectionReason).toContain('Income');
  });

  it('rejects "You Got" boilerplate via isCommonNounOnly guard', () => {
    // Production false positive: all-caps "YOU GOT $282.00" used to extract
    // "You Got" as a vendor. The new isCommonNounOnly guard rejects it.
    const result = parseNotificationText('YOU GOT $282.00');
    expect(result.isOutgoing).toBe(false);
    expect(result.rejectionReason).toMatch(/boilerplate|No vendor/i);
  });

  it('rejects direct deposit notifications', () => {
    const result = parseNotificationText('Direct deposit of $2,500.00 has been received in your account');
    expect(result.isOutgoing).toBe(false);
    expect(result.isIncome).toBe(true);
  });

  it('rejects payroll notifications', () => {
    const result = parseNotificationText('Payroll deposit of $3,200.00 from Acme Corp');
    expect(result.isOutgoing).toBe(false);
    expect(result.isIncome).toBe(true);
  });

  // ── Common-noun vendor rejection (Subscription Panic / You Got bug) ──
  it('rejects "Subscription Panic" as a boilerplate vendor', () => {
    // Real-world false positive: a Wealthsimple news push mentioning
    // "subscription panic" with a $ figure in the body. The parser used
    // to extract "Subscription Panic" as the vendor. Now rejected.
    const result = parseNotificationText('Market alert · Subscription Panic · $200.00');
    expect(result.isOutgoing).toBe(false);
    expect(result.rejectionReason).toMatch(/boilerplate|No vendor/i);
  });

  it('rejects "Transaction Alert" as a boilerplate vendor', () => {
    const result = parseNotificationText('Transaction Alert · $50.00');
    expect(result.isOutgoing).toBe(false);
  });

  it('rejects "Monthly Payment" as a boilerplate vendor', () => {
    const result = parseNotificationText('Monthly Payment · $42.00');
    expect(result.isOutgoing).toBe(false);
  });

  it('still accepts real vendors via the at/from/to pattern', () => {
    // Sanity check: the common-noun filter must not be too aggressive.
    // A normal "at Netflix" notification must still parse correctly.
    const result = parseNotificationText('You spent $15.99 at Netflix');
    expect(result.isOutgoing).toBe(true);
    expect(result.vendorDisplay).toBe('Netflix');
  });

  // ── Refund detection still works ──
  it('parses refund notifications and flags isRefund', () => {
    const result = parseNotificationText('Refund of $14.23 from AMAZON.CA');
    expect(result.isOutgoing).toBe(true);
    expect(result.isRefund).toBe(true);
    expect(result.amount).toBe(14.23);
    // .CA is lowercased to .ca by formatVendorName normalization
    expect(result.vendorDisplay).toBe('Amazon.ca');
  });

  it('parses "will be refunded" notifications and flags isRefund', () => {
    const result = parseNotificationText('$57.74 will be refunded to your credit card from AMZN MKTP CA');
    expect(result.isOutgoing).toBe(true);
    expect(result.isRefund).toBe(true);
    expect(result.amount).toBe(57.74);
  });

  it('refund amount is positive in the parser (the processor does the strike-through)', () => {
    // The parser returns a positive amount; the notification processor
    // handles the strike-through by setting refunded=true on the original
    // (no new row inserted).
    const result = parseNotificationText('Credit card refund - $52.49 from CANADIAN TIRE #611');
    expect(result.isOutgoing).toBe(true);
    expect(result.isRefund).toBe(true);
    expect(result.amount).toBe(52.49);
    expect(result.amount).toBeGreaterThan(0);
  });


  // ── Payment-processor prefixes ──────────────────────────────────────────
  //
  // None of the vendor character classes include "*", so extraction used to
  // stop at it and save the processor as the merchant. Every Toast, Square and
  // PayPal charge arrived in the review queue named "Tst" / "Sq" / "Pp" with
  // the real merchant gone — and at high enough confidence that the AI
  // fallback never ran to fix it.

  it('keeps the merchant behind a TST* (Toast) prefix', () => {
    const result = parseNotificationText('BMO You spent $18.40 at TST* LA CARNITA on your card');
    expect(result.vendorDisplay).toBe('La Carnita');
    expect(result.amount).toBe(18.40);
  });

  it('keeps the merchant behind a SQ* (Square) prefix', () => {
    const result = parseNotificationText('BMO You spent $24.00 at SQ *BRIGHTON BARBERS on your card');
    expect(result.vendorDisplay).toBe('Brighton Barbers');
  });

  it('keeps the merchant behind a PayPal prefix', () => {
    expect(parseNotificationText('You spent $9.99 at PP* STEAM GAMES').vendorDisplay).toBe('Steam Games');
    expect(parseNotificationText('You spent $9.99 at PAYPAL *STEAMGAMES').vendorDisplay).toBe('Steamgames');
  });

  it('keeps the merchant behind a Google Pay prefix', () => {
    expect(parseNotificationText('You spent $2.99 at GOOGLE *YOUTUBEPREMIUM').vendorDisplay).toBe('Youtubepremium');
  });

  it('tolerates the spacing variants banks emit around the star', () => {
    for (const text of [
      'You spent $18.40 at TST* LA CARNITA',
      'You spent $18.40 at TST *LA CARNITA',
      'You spent $18.40 at TST * LA CARNITA',
    ]) {
      expect(parseNotificationText(text).vendorDisplay, text).toBe('La Carnita');
    }
  });

  it('leaves an ordinary merchant name untouched', () => {
    expect(parseNotificationText('You spent $32.10 at KINTON RAMEN').vendorDisplay).toBe('Kinton Ramen');
  });

  // ── The prefixed name is kept as an alias ────────────────────────────────
  //
  // Stripping the prefix is right for the name we show and store, and wrong for
  // matching: the user's learned rules were taught on the prefixed name, and so
  // were the charges already in their history. Handing the pipeline both names
  // is what lets a rule keyed "googleyoutubepremium" keep firing.

  it('keeps the prefixed name as an alias for matching', () => {
    const result = parseNotificationText(
      'GOOGLE *YOUTUBEPREMIUM  You spent $24.14 with your credit card.',
    );
    expect(result.vendorDisplay).toBe('Youtubepremium');
    expect(result.vendorAliases).toEqual(['Google Youtubepremium']);
  });

  it('offers no alias for a merchant that arrived without a prefix', () => {
    expect(parseNotificationText('You spent $32.10 at KINTON RAMEN').vendorAliases).toEqual([]);
  });

  it('does not build an alias from a prefix that belongs to a different merchant', () => {
    // The star here sits in front of something else entirely; the extracted
    // vendor is not what follows it, so there is no second name for it.
    const result = parseNotificationText('You spent $18.40 at KINTON RAMEN. Paid with SQ *TERMINAL');
    expect(result.vendorAliases).toEqual([]);
  });

  // ── A bracketed aside is never the merchant ──────────────────────────────
  //
  // The all-caps fallback picks the longest run of capitals, and a qualifier is
  // routinely longer than the name it qualifies. "FIZZ (TX. INCL.)" therefore
  // came out as the vendor "Tx. Incl" — which no learned rule, no recurring row
  // and no duplicate check can recognise as Fizz, so a subscription already on
  // the books was captured a second time.

  it('reads the merchant, not the parenthetical qualifier next to it', () => {
    const result = parseNotificationText(
      'FIZZ (TX. INCL.) You made a recurring payment for $26.20 with your credit card.',
    );
    expect(result.isOutgoing).toBe(true);
    expect(result.amount).toBe(26.20);
    expect(result.vendorDisplay).toBe('Fizz');
    expect(result.recurrence).toBe('Monthly');
  });

  it('ignores a bracketed aside mid-sentence too', () => {
    const result = parseNotificationText(
      'You spent $41.95 at PUBLIC MOBILE (PRE-AUTHORIZED PAYMENT) with your credit card.',
    );
    expect(result.vendorDisplay).toBe('Public Mobile');
  });

});
