import {
  detectMerchantSignal,
  resolveSignalCategory,
  type MerchantSignal,
} from './merchantCategorySignals';

export type NotificationCategoryChoice<T extends { id: string; name: string }> =
  | { kind: 'ai'; category: T }
  | { kind: 'signal'; category: T; signal: MerchantSignal }
  | { kind: 'fallback'; category: T }
  | { kind: 'none' };

export interface NotificationCategoryInput<T extends { id: string; name: string }> {
  availableCategories: readonly T[];
  aiSuggestedCategory?: string | null;
  merchantText?: string | null;
  hiddenCategoryIds?: readonly string[];
}

/**
 * Choose the category for a capture after saved rules did not decide it.
 *
 * A real AI choice wins. "Other" is only a shrug, so an offline merchant
 * signal may replace it. Signals cannot target hidden categories; if no signal
 * can answer, the original Other choice is kept before trying the final
 * fallback. The fallback itself preserves the existing Other-then-first order.
 */
export function chooseNotificationFallbackCategory<T extends { id: string; name: string }>(
  input: NotificationCategoryInput<T>,
): NotificationCategoryChoice<T> {
  const { availableCategories } = input;
  if (availableCategories.length === 0) return { kind: 'none' };

  const aiMatch = input.aiSuggestedCategory
    ? availableCategories.find(
      (category) => category.name.toLowerCase() === input.aiSuggestedCategory?.toLowerCase(),
    )
    : undefined;

  if (aiMatch && aiMatch.name.toLowerCase() !== 'other') {
    return { kind: 'ai', category: aiMatch };
  }

  const signal = detectMerchantSignal(input.merchantText);
  if (signal) {
    const hiddenIds = new Set((input.hiddenCategoryIds ?? []).map(String));
    const visibleCategories = availableCategories.filter(
      (category) => !hiddenIds.has(String(category.id)),
    );
    const signalCategory = resolveSignalCategory(signal, visibleCategories);
    if (signalCategory) return { kind: 'signal', category: signalCategory, signal };
  }

  if (aiMatch) return { kind: 'ai', category: aiMatch };

  const otherCategory = availableCategories.find(
    (category) => category.name.toLowerCase() === 'other',
  );
  const fallbackCategory = otherCategory ?? availableCategories[0];
  return { kind: 'fallback', category: fallbackCategory };
}
