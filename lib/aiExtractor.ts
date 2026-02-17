// lib/aiExtractor.ts
//
// AI-based notification extraction using Google Gemini.
// Extracts vendor name, amount, and determines if a notification
// is an actual transaction (purchase/charge/payment) or not.
// Also assigns a budget category based on vendor overrides or AI guess.

import { GoogleGenAI } from '@google/genai';
import { formatVendorName } from './formatVendorName';

// ─── Types ───────────────────────────────────────────────────────

export interface AIExtractionResult {
  /** Whether the notification represents a real transaction */
  isTransaction: boolean;
  /** Cleaned vendor name (e.g., "Subway" from "Subway#327") */
  vendor: string | null;
  /** Dollar amount extracted */
  amount: number | null;
  /** AI-suggested budget category name */
  suggestedCategory: string | null;
  /** Reason for rejection if not a transaction */
  rejectionReason: string | null;
}

// ─── Gemini Client ───────────────────────────────────────────────

let genaiClient: GoogleGenAI | null = null;

function getGenAIClient(): GoogleGenAI | null {
  if (genaiClient) return genaiClient;

  const apiKey =
    (typeof process !== 'undefined' && process.env?.GEMINI_API_KEY) ||
    (typeof process !== 'undefined' && process.env?.API_KEY) ||
    '';

  if (!apiKey) {
    console.warn('[aiExtractor] No GEMINI_API_KEY configured');
    return null;
  }

  genaiClient = new GoogleGenAI({ apiKey });
  return genaiClient;
}

// ─── AI Extraction ───────────────────────────────────────────────

/**
 * Use Google Gemini to extract transaction details from a bank notification.
 *
 * The AI will:
 *   1. Determine if the notification is an actual transaction (purchase, charge,
 *      payment, spend, cost) vs. other notification types (balance alerts, login
 *      notifications, OTPs, transfer confirmations, etc.)
 *   2. Extract the vendor name and clean it up (remove store numbers, fix typos)
 *   3. Extract the dollar amount
 *   4. Suggest a budget category from the provided list
 */
export async function extractWithAI(
  notificationText: string,
  availableCategories: string[],
): Promise<AIExtractionResult> {
  const client = getGenAIClient();

  if (!client) {
    // Fallback: try basic extraction without AI
    return fallbackExtraction(notificationText);
  }

  const categoryList = availableCategories.length > 0
    ? availableCategories.join(', ')
    : 'Housing, Groceries, Transport, Utilities, Leisure, Services, Other';

  const prompt = `You are a financial notification parser. Analyze this bank/payment notification and respond ONLY with valid JSON (no markdown, no code fences).

Notification: "${notificationText}"

Available budget categories: ${categoryList}

Respond with this exact JSON structure:
{
  "isTransaction": true/false,
  "vendor": "cleaned vendor name or null",
  "amount": number or null,
  "suggestedCategory": "category name from the list or null",
  "rejectionReason": "reason string or null"
}

Rules:
1. isTransaction is TRUE only for actual purchases, charges, payments, costs, or spending. FALSE for balance alerts, login notifications, OTP codes, transfer confirmations between own accounts, reward points, card activation, or any non-spending notification.
2. For vendor: Clean up the name. Remove store/location numbers (e.g., "Subway#327" → "Subway", "WALMART SUPERCENTER #1234" → "Walmart"). Fix obvious abbreviations (e.g., "SPRT CHECK" → "Sport Check", "AMZN" → "Amazon"). Convert to proper title case. The vendor can be one word or multiple words.
3. For amount: Find the dollar value. Look for $ sign followed by a number, or any monetary amount mentioned.
4. For suggestedCategory: Pick the most likely category from the provided list based on what the vendor sells/provides.
5. If isTransaction is false, set vendor and amount to null and provide a clear rejectionReason.`;

  try {
    const response = await client.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: prompt,
    });

    const text = response.text?.trim() || '';

    // Parse JSON response - strip markdown fences if present
    let jsonStr = text;
    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) {
      jsonStr = fenceMatch[1].trim();
    }

    const parsed = JSON.parse(jsonStr);

    return {
      isTransaction: parsed.isTransaction === true,
      vendor: parsed.vendor ? formatVendorName(String(parsed.vendor)) : null,
      amount: typeof parsed.amount === 'number' && !isNaN(parsed.amount) ? parsed.amount : null,
      suggestedCategory: parsed.suggestedCategory || null,
      rejectionReason: parsed.rejectionReason || null,
    };
  } catch (err) {
    console.error('[aiExtractor] Gemini extraction failed:', err);
    // Fallback to basic extraction
    return fallbackExtraction(notificationText);
  }
}

// ─── Fallback Extraction (no AI) ─────────────────────────────────

/**
 * Basic regex-based fallback when AI is unavailable.
 * Extracts amount using $ pattern and uses remaining text as vendor hint.
 */
function fallbackExtraction(notificationText: string): AIExtractionResult {
  // Extract amount: find $ followed by number
  const amountMatch = notificationText.match(/\$\s?([\d,]+\.?\d{0,2})/);
  const amount = amountMatch
    ? parseFloat(amountMatch[1].replace(/,/g, ''))
    : null;

  // Basic vendor extraction: look for common patterns
  // "at VENDOR", "to VENDOR", "from VENDOR", "VENDOR purchase"
  let vendor: string | null = null;
  const vendorPatterns = [
    /(?:at|to|from|@)\s+([A-Za-z][A-Za-z0-9\s&'.#-]{1,40}?)(?:\s+(?:for|on|with|$))/i,
    /(?:purchase|payment|charge|transaction)\s+(?:at|to|from)?\s*([A-Za-z][A-Za-z0-9\s&'.#-]{1,40})/i,
  ];

  for (const pattern of vendorPatterns) {
    const match = notificationText.match(pattern);
    if (match?.[1]) {
      vendor = cleanVendorName(match[1].trim());
      break;
    }
  }

  // If we have an amount, assume it's probably a transaction
  const isTransaction = amount !== null && amount > 0;

  return {
    isTransaction,
    vendor: vendor ? formatVendorName(vendor) : null,
    amount,
    suggestedCategory: null,
    rejectionReason: isTransaction ? null : 'Could not determine if this is a transaction',
  };
}

/**
 * Clean a vendor name by removing store numbers, extra punctuation, etc.
 */
function cleanVendorName(raw: string): string {
  let cleaned = raw
    // Remove store/location numbers: "Subway#327" → "Subway"
    .replace(/[#]\d+/g, '')
    // Remove trailing numbers after space: "WALMART 1234" → "WALMART"
    .replace(/\s+\d{3,}$/g, '')
    // Remove "STORE" suffix
    .replace(/\s+STORE$/i, '')
    // Remove excess whitespace
    .replace(/\s+/g, ' ')
    .trim();

  return cleaned;
}
