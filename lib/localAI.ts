// lib/localAI.ts
//
// Local-only AI inference using Transformers.js (Hugging Face).
// Runs entirely in the browser via WebAssembly/WebGPU — no cloud API calls.
// All transaction parsing and vendor name cleaning happens on-device.

import { pipeline, type TextGenerationPipeline } from '@huggingface/transformers';

// ─── Configuration ──────────────────────────────────────────────

/**
 * Small instruction-tuned language model quantized for browser use.
 * Downloaded once (~2 GB) and cached in IndexedDB for subsequent sessions.
 */
const MODEL_ID = 'onnx-community/Phi-3.5-mini-instruct-onnx-web';

/** Maximum number of new tokens the model may generate per call */
const MAX_NEW_TOKENS = 256;

// ─── Singleton Pipeline ─────────────────────────────────────────

let generatorPromise: Promise<TextGenerationPipeline> | null = null;
let initFailed = false;

/**
 * Lazily initialise the text-generation pipeline.
 * Returns `null` when the model cannot be loaded (e.g. device too
 * constrained) so callers can fall back gracefully.
 */
async function getGenerator(): Promise<TextGenerationPipeline | null> {
  if (initFailed) return null;

  if (!generatorPromise) {
    generatorPromise = pipeline('text-generation', MODEL_ID, {
      dtype: 'q4',               // 4-bit quantised weights
    }).catch((err) => {
      console.warn('[localAI] Failed to load model, falling back to heuristics:', err);
      initFailed = true;
      generatorPromise = null;
      return null as unknown as TextGenerationPipeline;
    });
  }
  return generatorPromise;
}

// ─── Public helpers ─────────────────────────────────────────────

export interface RuleGenerationResult {
  amount_regex: string;
  vendor_regex: string;
  category_name: string;
  recurrence: string;
}

/**
 * Ask the local Phi model to produce regex patterns for a bank
 * notification.  Returns `null` when the model is unavailable so
 * the caller can fall through to heuristic parsing.
 */
export async function generateRuleLocally(
  bankName: string,
  rawNotification: string,
): Promise<RuleGenerationResult | null> {
  const gen = await getGenerator();
  if (!gen) return null;

  const prompt = `<|system|>
You are an expert at parsing bank and credit card transaction notifications. Return ONLY valid JSON.
<|end|>
<|user|>
Here is a notification from ${bankName}:
"${rawNotification}"

Create regex patterns for this notification format. Return a JSON object with:
- "amount_regex": JavaScript regex (no slashes) capturing the dollar amount in group 1
- "vendor_regex": JavaScript regex (no slashes) capturing the vendor name in group 1
- "category_name": one of "Groceries","Transport","Utilities","Leisure","Housing","Dining","Shopping","Gas","Other"
- "recurrence": "One-time","Biweekly", or "Monthly"

Rules:
- Make patterns flexible for similar notifications (different vendors/amounts/card numbers)
- Do NOT hardcode specific values
- Return ONLY valid JSON
<|end|>
<|assistant|>
`;

  try {
    const outputs = await gen(prompt, {
      max_new_tokens: MAX_NEW_TOKENS,
      do_sample: false,
    });

    const raw =
      Array.isArray(outputs) && outputs.length > 0
        ? ((outputs[0] as { generated_text?: string }).generated_text ?? '')
        : '';

    // Strip everything before the first '{' and after the last '}'
    const jsonStart = raw.indexOf('{');
    const jsonEnd = raw.lastIndexOf('}');
    if (jsonStart === -1 || jsonEnd === -1) return null;

    const jsonStr = raw.slice(jsonStart, jsonEnd + 1);
    const parsed = JSON.parse(jsonStr);

    if (!parsed.amount_regex || !parsed.vendor_regex) return null;

    // Validate regex syntax
    new RegExp(parsed.amount_regex);
    new RegExp(parsed.vendor_regex);

    return {
      amount_regex: parsed.amount_regex,
      vendor_regex: parsed.vendor_regex,
      category_name: parsed.category_name || 'Other',
      recurrence: parsed.recurrence || 'One-time',
    };
  } catch (err) {
    console.warn('[localAI] generateRuleLocally failed:', err);
    return null;
  }
}

/**
 * Use the local model to normalise a raw vendor string into a
 * human-friendly merchant name.
 * Returns the original string when the model is unavailable.
 */
export async function cleanVendorNameLocally(rawVendor: string): Promise<string> {
  if (!rawVendor || rawVendor.trim().length === 0) return rawVendor;

  const gen = await getGenerator();
  if (!gen) return rawVendor;

  const prompt = `<|system|>
You are a merchant name normalizer. Return ONLY the clean merchant name as plain text.
<|end|>
<|user|>
Given this raw vendor string from a bank transaction: "${rawVendor}"
Return only the clean, human-readable merchant name. No IDs, reference numbers, or codes.
<|end|>
<|assistant|>
`;

  try {
    const outputs = await gen(prompt, {
      max_new_tokens: 32,
      do_sample: false,
    });

    const raw =
      Array.isArray(outputs) && outputs.length > 0
        ? ((outputs[0] as { generated_text?: string }).generated_text ?? '')
        : '';

    // Extract just the assistant's response (after the last <|assistant|>)
    const parts = raw.split('<|assistant|>');
    const response = (parts[parts.length - 1] ?? '').trim().replace(/^["']|["']$/g, '');

    if (!response || response.length > 100) return rawVendor;
    return response;
  } catch (err) {
    console.warn('[localAI] cleanVendorNameLocally failed:', err);
    return rawVendor;
  }
}
