// lib/useNotificationListener.ts
import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import type { Transaction, User } from '../types';
import { supabase } from './supabase';
import { covaultNotification } from './covaultNotification';

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY;

/**
 * Call Gemini Flash to generate regex + category suggestion
 * for a given bank notification.
 *
 * 👉 This is only called:
 *    - when there is NO existing notification_rules row
 *      for this (user, bank_app_id, bank_name)
 *    - or later when we regenerate after a user flag (see below)
 */
async function generateRuleWithGemini(
  bankName: string,
  rawNotification: string
): Promise<{ amount_regex: string; vendor_regex: string; category_name: string }> {
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not set');
  }

  const prompt = `
You are helping parse bank transaction notification text.

Here is a sample notification from ${bankName}:
"${rawNotification}"

Return a JSON object with these exact keys:
- "amount_regex": a JavaScript regular expression (without surrounding slashes) that matches this kind of notification and captures the numeric amount in the FIRST capturing group.
- "vendor_regex": a JavaScript regular expression (without surrounding slashes) that matches this kind of notification and captures the vendor/merchant name in the FIRST capturing group.
- "category_name": a short category name for this transaction, e.g. "Groceries", "Restaurants", "Transport", "Income", "Bills", etc.

Rules:
- Use simple, robust regex patterns.
- Make sure the first capturing group (...) is the numeric amount for amount_regex, and vendor name for vendor_regex.
- Escape special characters that appear in the notification text.
- Return ONLY valid JSON. No comments, no code blocks, no explanations.
`;

  const body = {
    contents: [{ parts: [{ text: prompt }] }],
  };

  const response = await fetch(
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=' +
      GEMINI_API_KEY,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  );

  if (!response.ok) {
    const text = await response.text();
    console.error('Gemini error:', text);
    throw new Error('Gemini API error');
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    console.error('Failed to parse Gemini response:', text, e);
    throw new Error('Invalid JSON from Gemini');
  }

  return {
    amount_regex: parsed.amount_regex,
    vendor_regex: parsed.vendor_regex,
    category_name: parsed.category_name,
  };
}

/**
 * Use an existing regex rule to extract vendor + amount
 * from a raw notification string.
 *
 * Returns null if parsing fails.
 */
function applyRuleToNotification(
  amountRegexSource: string,
  vendorRegexSource: string,
  rawNotification: string
): { vendor: string; amount: number } | null {
  try {
    const amountRegex = new RegExp(amountRegexSource);
    const vendorRegex = new RegExp(vendorRegexSource);

    const amountMatch = rawNotification.match(amountRegex);
    const vendorMatch = rawNotification.match(vendorRegex);

    if (!amountMatch || !amountMatch[1] || !vendorMatch || !vendorMatch[1]) {
      return null;
    }

    // Clean the amount (remove currency symbols, spaces, commas)
    const rawAmount = amountMatch[1].replace(/[^0-9.,-]/g, '');
    const amount = Number(rawAmount.replace(',', ''));

    if (Number.isNaN(amount)) {
      return null;
    }

    const vendor = vendorMatch[1].trim();

    return { vendor, amount };
  } catch (err) {
    console.error('[applyRuleToNotification] Error applying regex:', err);
    return null;
  }
}

// Shape of a row in public.notification_rules (simplified)
interface NotificationRule {
  id: string;
  user_id: string;
  bank_app_id: string;
  bank_name: string;
  amount_regex: string;
  vendor_regex: string;
  default_category_id: string | null;
  is_active: boolean;
  flagged_count: number;
  last_flagged_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Get an existing notification_rule for (user, bank_app_id).
 * If none exists, call Gemini ONCE to create it and save it.
 *
 * 👉 This is where we enforce:
 *    - Gemini runs ONLY if no existing rule for that bank+user.
 */
async function getOrCreateNotificationRuleForBank(options: {
  userId: string;
  bankAppId: string;
  bankName: string;
  rawNotification: string;
}): Promise<NotificationRule> {
  const { userId, bankAppId, bankName, rawNotification } = options;

  // 1) Look for an existing active rule
  const { data: existing, error: existingError } = await supabase
    .from('notification_rules')
    .select('*')
    .eq('user_id', userId)
    .eq('bank_app_id', bankAppId)
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .maybeSingle();

  if (existingError) {
    console.error(
      '[getOrCreateNotificationRuleForBank] Error fetching rule:',
      existingError,
    );
    throw existingError;
  }

  if (existing) {
    // ✅ Rule already exists – NO Gemini call
    return existing as NotificationRule;
  }

  // 2) No rule yet → FIRST TIME for this bank → call Gemini ONCE
  const geminiResult = await generateRuleWithGemini(bankName, rawNotification);

  // Optional: try to map category_name to an existing categories row
  let defaultCategoryId: string | null = null;
  if (geminiResult.category_name) {
    const { data: cat, error: catErr } = await supabase
      .from('categories')
      .select('id, name')
      .ilike('name', geminiResult.category_name)
      .maybeSingle();

    if (catErr) {
      console.warn(
        '[getOrCreateNotificationRuleForBank] Category lookup error:',
        catErr,
      );
    } else if (cat) {
      defaultCategoryId = cat.id;
    }
  }

  // 3) Save new rule in Supabase
  const { data: inserted, error: insertError } = await supabase
    .from('notification_rules')
    .insert({
      user_id: userId,
      bank_app_id: bankAppId,
      bank_name: bankName,
      amount_regex: geminiResult.amount_regex,
      vendor_regex: geminiResult.vendor_regex,
      default_category_id: defaultCategoryId,
    })
    .select()
    .single();

  if (insertError) {
    console.error(
      '[getOrCreateNotificationRuleForBank] Error inserting rule:',
      insertError,
    );
    throw insertError;
  }

  return inserted as NotificationRule;
}

/**
 * When the user marks a transaction as incorrect, we:
 * 1) Enforce rate limits via flag_reports:
 *      - max 1 flag in last 24 hours
 *      - max 5 flags in last 7 days
 * 2) Insert a row into flag_reports
 * 3) Call Gemini again to regenerate regex for THIS bank
 * 4) Update notification_rules row with new regex + flagged_count + last_flagged_at
 *
 * ✅ This respects your schema: notification_rules + flag_reports only.
 */
export async function flagNotificationAndRegenerateRule(options: {
  userId: string;
  notificationRuleId: string;
  rawNotification: string;
  expectedVendor?: string;
  expectedAmount?: number;
}): Promise<void> {
  const { userId, notificationRuleId, rawNotification, expectedVendor, expectedAmount } = options;

  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // 1) Rate limiting: 1 flag per 24 hours
  const { count: lastDayCount, error: lastDayError } = await supabase
    .from('flag_reports')
    .select('*', { head: true, count: 'exact' })
    .eq('user_id', userId)
    .gte('created_at', oneDayAgo);

  if (lastDayError) {
    console.error('[flagNotification] 24h rate limit error:', lastDayError);
    throw lastDayError;
  }

  if ((lastDayCount ?? 0) >= 1) {
    throw new Error('You can only flag one transaction every 24 hours.');
  }

  // 2) Rate limiting: max 5 flags per week
  const { count: lastWeekCount, error: lastWeekError } = await supabase
    .from('flag_reports')
    .select('*', { head: true, count: 'exact' })
    .eq('user_id', userId)
    .gte('created_at', oneWeekAgo);

  if (lastWeekError) {
    console.error('[flagNotification] weekly rate limit error:', lastWeekError);
    throw lastWeekError;
  }

  if ((lastWeekCount ?? 0) >= 5) {
    throw new Error('You can only flag up to 5 transactions per week.');
  }

  // 3) Insert into flag_reports
  const { data: flag, error: flagError } = await supabase
    .from('flag_reports')
    .insert({
      user_id: userId,
      notification_rule_id: notificationRuleId,
      raw_notification: rawNotification,
      expected_vendor: expectedVendor,
      expected_amount: expectedAmount,
    })
    .select()
    .single();

  if (flagError) {
    console.error('[flagNotification] Error inserting flag_reports:', flagError);
    throw flagError;
  }

  // 4) Fetch the existing rule so we know bank_name and current flagged_count
  const { data: rule, error: ruleError } = await supabase
    .from('notification_rules')
    .select('*')
    .eq('id', notificationRuleId)
    .maybeSingle();

  if (ruleError || !rule) {
    console.error('[flagNotification] Error fetching notification_rule:', ruleError);
    throw ruleError ?? new Error('Notification rule not found');
  }

  // 5) Call Gemini AGAIN for this bank + notification to regenerate regex
  const geminiResult = await generateRuleWithGemini(rule.bank_name, rawNotification);

  // Optional: try to map new category_name to categories table
  let newDefaultCategoryId: string | null = rule.default_category_id;
  if (geminiResult.category_name) {
    const { data: cat, error: catErr } = await supabase
      .from('categories')
      .select('id, name')
      .ilike('name', geminiResult.category_name)
      .maybeSingle();

    if (catErr) {
      console.warn('[flagNotification] Category lookup error (regen):', catErr);
    } else if (cat) {
      newDefaultCategoryId = cat.id;
    }
  }

  // 6) Update notification_rules with new regex + counters
  const { error: updateError } = await supabase
    .from('notification_rules')
    .update({
      amount_regex: geminiResult.amount_regex,
      vendor_regex: geminiResult.vendor_regex,
      default_category_id: newDefaultCategoryId,
      flagged_count: (rule.flagged_count ?? 0) + 1,
      last_flagged_at: new Date().toISOString(),
    })
    .eq('id', notificationRuleId);

  if (updateError) {
    console.error('[flagNotification] Error updating notification_rule:', updateError);
    throw updateError;
  }

  // (Optional) You could also auto-mark the flag as resolved, but your schema
  // defaults `resolved` to false, so we'll leave it for now.
}

interface UseNotificationListenerParams {
  user: User | null;
  onTransactionDetected: (tx: Transaction) => void;
}

/**
 * Hook that listens for transactionDetected events from the native CovaultNotification plugin.
 *
 * EVENT SHAPE (ideal, forward-looking):
 *   event = {
 *     rawNotification: string;  // full notification text
 *     bankAppId: string;        // e.g. "com.scotiabank.mobile"
 *     bankName: string;         // e.g. "Scotiabank"
 *     vendor?: string;          // optional fallback
 *     amount?: number;          // optional fallback
 *   }
 *
 * 👉 If rawNotification/bankAppId/bankName are missing,
 *    we fall back to event.vendor and event.amount (old behavior),
 *    so this is backwards compatible while you update the plugin.
 */
export const useNotificationListener = ({
  user,
  onTransactionDetected,
}: UseNotificationListenerParams) => {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    let cleanup: (() => void) | null = null;

    const setupListener = async () => {
      try {
        if (!covaultNotification) {
          return;
        }

        const handle = await covaultNotification.addListener(
          'transactionDetected',
          async (event) => {
            console.log('[notification] Transaction detected:', event);
            if (!user?.id) {
              console.warn(
                '[notification] No user logged in, ignoring transaction',
              );
              return;
            }

            let vendor = event.vendor || 'Unknown Merchant';
            let amount = event.amount || 0;

            // If the plugin sends raw notification info, use our regex pipeline
            if (event.rawNotification && event.bankAppId && event.bankName) {
              try {
                const rule = await getOrCreateNotificationRuleForBank({
                  userId: user.id,
                  bankAppId: event.bankAppId,
                  bankName: event.bankName,
                  rawNotification: event.rawNotification,
                });

                const parsed = applyRuleToNotification(
                  rule.amount_regex,
                  rule.vendor_regex,
                  event.rawNotification,
                );

                if (parsed) {
                  vendor = parsed.vendor;
                  amount = parsed.amount;
                } else {
                  console.warn(
                    '[notification] Could not parse notification with regex, falling back to event.vendor/amount',
                  );
                }
              } catch (err) {
                console.error(
                  '[notification] Error while getting/applying notification rule:',
                  err,
                );
              }
            }

            const tx: Transaction = {
              id: crypto.randomUUID(),
              user_id: user.id,
              vendor,
              amount,
              date: new Date().toISOString().slice(0, 10),
              budget_id: null, // User will categorize later
              is_projected: false,
              label: 'Auto-Added',
              userName: user.name || 'User',
              created_at: new Date().toISOString(),
            };

            onTransactionDetected(tx);
          },
        );

        cleanup = () => handle.remove();
      } catch (e) {
        console.warn(
          '[notification] Could not set up transaction listener:',
          e,
        );
      }
    };

    setupListener();

    return () => {
      cleanup?.();
    };
  }, [user, onTransactionDetected]);
};
