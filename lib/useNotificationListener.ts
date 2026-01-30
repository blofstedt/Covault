// lib/useNotificationListener.ts
import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import type { Transaction, User } from '../types';

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY;

/**
 * Call Gemini Flash to generate regex + category suggestion
 * for a given bank notification.
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

interface UseNotificationListenerParams {
  user: User | null;
  onTransactionDetected: (tx: Transaction) => void;
}

export const useNotificationListener = ({
  user,
  onTransactionDetected,
}: UseNotificationListenerParams) => {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    let cleanup: (() => void) | null = null;

    const setupListener = async () => {
      try {
        const plugin = (Capacitor as any).Plugins?.CovaultNotification;
        if (!plugin || typeof plugin.addListener !== 'function') return;

        const handle = await plugin.addListener(
          'transactionDetected',
          (event: any) => {
            console.log('[notification] Transaction detected:', event);
            if (!user?.id) {
              console.warn(
                '[notification] No user logged in, ignoring transaction',
              );
              return;
            }

            const tx: Transaction = {
              id: crypto.randomUUID(),
              user_id: user.id,
              vendor: event.vendor || 'Unknown Merchant',
              amount: event.amount || 0,
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
