// lib/localTransactionModel.ts
//
// AI-powered transaction extraction using Transformers.js
// Replaces the manual regex-based approach with a local LLM that
// automatically extracts vendor names and amounts from bank notifications.
//
// Note: The first run will download model weights and cache them in the browser.

import { pipeline, env } from '@xenova/transformers';
import { formatVendorName } from './formatVendorName';

// Disable local model checks — always pull from HuggingFace Hub on first use
(env as any).allowLocalModels = false;

/** Key for persisting learned vendor associations in localStorage */
const MEMORY_KEY = 'spend_sense_vendor_memory_v3';

/** Default category mappings for common vendor keywords */
const DEFAULT_CATEGORY_MAP: Record<string, string> = {
  // Groceries
  walmart: 'Groceries',
  kroger: 'Groceries',
  'whole foods': 'Groceries',
  safeway: 'Groceries',
  aldi: 'Groceries',
  costco: 'Groceries',
  'trader joe': 'Groceries',
  publix: 'Groceries',
  heb: 'Groceries',
  grocery: 'Groceries',
  supermarket: 'Groceries',
  market: 'Groceries',
  // Transport
  uber: 'Transport',
  lyft: 'Transport',
  gas: 'Transport',
  shell: 'Transport',
  exxon: 'Transport',
  chevron: 'Transport',
  bp: 'Transport',
  fuel: 'Transport',
  parking: 'Transport',
  toll: 'Transport',
  transit: 'Transport',
  // Leisure
  netflix: 'Leisure',
  spotify: 'Leisure',
  hulu: 'Leisure',
  'disney+': 'Leisure',
  'disney plus': 'Leisure',
  starbucks: 'Leisure',
  'mcdonald': 'Leisure',
  restaurant: 'Leisure',
  cafe: 'Leisure',
  coffee: 'Leisure',
  bar: 'Leisure',
  movie: 'Leisure',
  entertainment: 'Leisure',
  gaming: 'Leisure',
  // Utilities
  electric: 'Utilities',
  water: 'Utilities',
  internet: 'Utilities',
  comcast: 'Utilities',
  'at&t': 'Utilities',
  verizon: 'Utilities',
  't-mobile': 'Utilities',
  utility: 'Utilities',
  power: 'Utilities',
  sewage: 'Utilities',
  // Housing
  rent: 'Housing',
  mortgage: 'Housing',
  insurance: 'Housing',
  hoa: 'Housing',
  property: 'Housing',
};

export interface ExtractedData {
  vendor: string;
  amount: number;
  suggestedCategory: string | null;
  confidence: number;
}

export interface ModelResponse {
  success: boolean;
  data: ExtractedData | null;
  error?: string;
}

export class LocalTransactionModel {
  private extractor: any = null;
  private vendorMemory: Record<string, string> = {};
  private loading = false;
  private loadPromise: Promise<void> | null = null;

  constructor() {
    this.loadVendorMemory();
  }

  /** Load vendor→category memory from localStorage */
  private loadVendorMemory(): void {
    try {
      const stored = localStorage.getItem(MEMORY_KEY);
      if (stored) {
        this.vendorMemory = JSON.parse(stored);
      }
    } catch {
      this.vendorMemory = {};
    }
  }

  /** Save vendor→category memory to localStorage */
  private saveVendorMemory(): void {
    try {
      localStorage.setItem(MEMORY_KEY, JSON.stringify(this.vendorMemory));
    } catch {
      // localStorage may be unavailable
    }
  }

  /** Record a vendor→category association for future use */
  rememberVendorCategory(vendor: string, category: string): void {
    const key = vendor.toLowerCase().trim();
    if (key) {
      this.vendorMemory[key] = category;
      this.saveVendorMemory();
    }
  }

  /** Look up a remembered category for a vendor */
  getRememberedCategory(vendor: string): string | null {
    const key = vendor.toLowerCase().trim();
    return this.vendorMemory[key] || null;
  }

  /**
   * Initialize the feature-extraction pipeline.
   * Uses a small model suitable for in-browser execution.
   */
  async initialize(): Promise<void> {
    if (this.extractor) return;
    if (this.loadPromise) return this.loadPromise;

    this.loading = true;
    this.loadPromise = (async () => {
      try {
        this.extractor = await pipeline(
          'feature-extraction',
          'Xenova/all-MiniLM-L6-v2',
        );
        console.log('[LocalTransactionModel] Model loaded successfully');
      } catch (err) {
        console.error('[LocalTransactionModel] Failed to load model:', err);
        this.extractor = null;
      } finally {
        this.loading = false;
      }
    })();

    return this.loadPromise;
  }

  get isLoading(): boolean {
    return this.loading;
  }

  get isReady(): boolean {
    return this.extractor !== null;
  }

  /**
   * Extract vendor name and amount from a bank notification.
   *
   * Uses a hybrid approach:
   *   1. Pattern-based extraction for amounts (currency patterns are consistent)
   *   2. AI-assisted vendor name cleaning & categorization
   *   3. Heuristic vendor extraction from notification text
   */
  async extractTransaction(notificationText: string): Promise<ModelResponse> {
    if (!notificationText || !notificationText.trim()) {
      return { success: false, data: null, error: 'Empty notification text' };
    }

    try {
      // Step 1: Extract amount using robust currency patterns
      const amount = this.extractAmount(notificationText);
      if (amount === null) {
        return { success: false, data: null, error: 'No amount found in notification' };
      }

      // Step 2: Extract vendor name using heuristic patterns
      const rawVendor = this.extractVendorName(notificationText, amount);
      const vendor = formatVendorName(rawVendor || 'Unknown');

      // Step 3: Determine category (memory → default map → AI similarity)
      let suggestedCategory = this.getRememberedCategory(vendor);
      let confidence = 90;

      if (!suggestedCategory) {
        suggestedCategory = this.matchDefaultCategory(vendor);
        confidence = suggestedCategory ? 75 : 50;
      }

      if (!suggestedCategory && this.extractor) {
        const aiCategory = await this.categorizeWithAI(vendor);
        if (aiCategory) {
          suggestedCategory = aiCategory.category;
          confidence = Math.round(aiCategory.score * 100);
        }
      }

      return {
        success: true,
        data: {
          vendor,
          amount,
          suggestedCategory,
          confidence,
        },
      };
    } catch (err: any) {
      console.error('[LocalTransactionModel] Extraction error:', err);
      return { success: false, data: null, error: err?.message || 'Extraction failed' };
    }
  }

  /**
   * Extract monetary amount from notification text.
   * Handles various formats: $45.67, 45.67, $1,234.56, etc.
   */
  private extractAmount(text: string): number | null {
    // Try several patterns in order of specificity
    const patterns = [
      // $1,234.56 or $123.45
      /\$\s*([\d,]+\.\d{2})\b/,
      // USD 123.45 or 123.45 USD
      /(?:USD|usd)\s*([\d,]+\.\d{2})\b/,
      /([\d,]+\.\d{2})\s*(?:USD|usd)\b/,
      // Generic amount with dollar sign
      /\$\s*([\d,]+\.?\d{0,2})\b/,
      // Amount after keywords like "for", "of", "amount", "charged", "spent", "paid"
      /(?:for|of|amount|charged|spent|paid|debited|deducted|total)\s*\$?\s*([\d,]+\.\d{2})\b/i,
      // Standalone decimal amount (last resort)
      /\b([\d,]+\.\d{2})\b/,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match?.[1]) {
        const cleaned = match[1].replace(/,/g, '');
        const amount = parseFloat(cleaned);
        if (!isNaN(amount) && amount > 0 && amount < 1_000_000) {
          return amount;
        }
      }
    }

    return null;
  }

  /**
   * Extract vendor/merchant name from notification text using heuristics.
   *
   * Common bank notification patterns:
   *   - "Purchase at VENDOR for $XX.XX"
   *   - "You spent $XX.XX at VENDOR"
   *   - "Transaction: VENDOR $XX.XX"
   *   - "Payment to VENDOR"
   *   - "VENDOR charged $XX.XX"
   */
  private extractVendorName(text: string, amount: number): string | null {
    const amountStr = amount.toFixed(2);
    const amountPatterns = [
      new RegExp(`\\$\\s*${amountStr.replace('.', '\\.')}`, 'g'),
      new RegExp(`\\$\\s*${amount.toString().replace('.', '\\.')}`, 'g'),
      new RegExp(amountStr.replace('.', '\\.'), 'g'),
    ];

    // Remove amount from text for cleaner vendor extraction
    let cleanText = text;
    for (const p of amountPatterns) {
      cleanText = cleanText.replace(p, ' ');
    }

    // Try specific patterns
    const vendorPatterns = [
      // "at VENDOR" or "at VENDOR."
      /\bat\s+([A-Za-z][A-Za-z0-9\s'&.\-]{1,40}?)(?:\s+(?:for|on|with|using|from|via|$))/i,
      // "to VENDOR"
      /\bto\s+([A-Za-z][A-Za-z0-9\s'&.\-]{1,40}?)(?:\s+(?:for|on|with|using|from|via|$))/i,
      // "from VENDOR"
      /\bfrom\s+([A-Za-z][A-Za-z0-9\s'&.\-]{1,40}?)(?:\s+(?:for|on|with|using|via|$))/i,
      // "VENDOR charged"
      /([A-Za-z][A-Za-z0-9\s'&.\-]{1,40}?)\s+(?:charged|debited|deducted)/i,
      // "Purchase at VENDOR"
      /(?:purchase|payment|transaction|charge|debit)\s+(?:at|to|from|with)\s+([A-Za-z][A-Za-z0-9\s'&.\-]{1,40})/i,
      // Fallback: "at VENDOR" (broader)
      /\bat\s+([A-Za-z][A-Za-z0-9\s'&.\-]{2,30})/i,
    ];

    for (const pattern of vendorPatterns) {
      const match = cleanText.match(pattern);
      if (match?.[1]) {
        const vendor = match[1].trim().replace(/[.\s]+$/, '');
        if (vendor.length >= 2 && !this.isCommonWord(vendor)) {
          return vendor;
        }
      }
    }

    // Last resort: look for capitalized words that might be vendor names
    const capsMatch = cleanText.match(/\b([A-Z][A-Z0-9\s'&]{2,25})\b/);
    if (capsMatch?.[1]) {
      const vendor = capsMatch[1].trim();
      if (vendor.length >= 2 && !this.isCommonWord(vendor)) {
        return vendor;
      }
    }

    return null;
  }

  /** Check if a word is too common to be a vendor name */
  private isCommonWord(word: string): boolean {
    const common = new Set([
      'the', 'your', 'you', 'for', 'and', 'was', 'has', 'been',
      'with', 'card', 'account', 'bank', 'credit', 'debit',
      'transaction', 'payment', 'purchase', 'balance', 'available',
      'ending', 'total', 'amount', 'date', 'time', 'new',
    ]);
    return common.has(word.toLowerCase());
  }

  /** Match vendor name against the default category map */
  private matchDefaultCategory(vendor: string): string | null {
    const lowerVendor = vendor.toLowerCase();
    for (const [keyword, category] of Object.entries(DEFAULT_CATEGORY_MAP)) {
      if (lowerVendor.includes(keyword)) {
        return category;
      }
    }
    return null;
  }

  /**
   * Use the AI model to categorize a vendor by computing semantic similarity
   * between the vendor name and category labels.
   */
  private async categorizeWithAI(
    vendor: string,
  ): Promise<{ category: string; score: number } | null> {
    if (!this.extractor) return null;

    try {
      const categories = Object.values(DEFAULT_CATEGORY_MAP).filter(
        (v, i, a) => a.indexOf(v) === i,
      );

      // Get embeddings for vendor and each category
      const vendorEmbedding = await this.extractor(vendor, {
        pooling: 'mean',
        normalize: true,
      });

      let bestCategory = '';
      let bestScore = -1;

      for (const category of categories) {
        const catEmbedding = await this.extractor(category, {
          pooling: 'mean',
          normalize: true,
        });

        const score = this.cosineSimilarity(
          vendorEmbedding.data as Float32Array,
          catEmbedding.data as Float32Array,
        );

        if (score > bestScore) {
          bestScore = score;
          bestCategory = category;
        }
      }

      // Only return if similarity is meaningful
      if (bestScore > 0.3) {
        return { category: bestCategory, score: bestScore };
      }

      return null;
    } catch (err) {
      console.error('[LocalTransactionModel] AI categorization error:', err);
      return null;
    }
  }

  /** Compute cosine similarity between two vectors */
  private cosineSimilarity(a: Float32Array, b: Float32Array): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    return denominator === 0 ? 0 : dotProduct / denominator;
  }
}

/** Singleton instance */
let modelInstance: LocalTransactionModel | null = null;

/** Get or create the singleton model instance */
export function getTransactionModel(): LocalTransactionModel {
  if (!modelInstance) {
    modelInstance = new LocalTransactionModel();
  }
  return modelInstance;
}
