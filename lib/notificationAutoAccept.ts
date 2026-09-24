import type { CaptureSourceKind } from './captureSources';
import { shouldAutoAccept } from './vendorMatchConfidence';

interface AutoAcceptCaptureContext {
  source: CaptureSourceKind;
  optedIn: boolean;
  hasFuelHold: boolean;
  hasUncertainExtraction: boolean;
  hasPossibleDuplicate: boolean;
  hasForeignCurrency: boolean;
  matchConfidence: number;
  hasCategory: boolean;
}

/**
 * Decide whether a capture can skip Review and be filed immediately.
 *
 * Email, fuel holds, uncertain merchant reads, possible duplicates, and foreign
 * currency all require a person to see the row. For everything else,
 * shouldAutoAccept still requires opt-in, a resolved category, and a confident
 * user-authored vendor rule.
 */
export function canAutoAcceptCapture(context: AutoAcceptCaptureContext): boolean {
  if (
    context.source === 'email'
    || context.hasFuelHold
    || context.hasUncertainExtraction
    || context.hasPossibleDuplicate
    || context.hasForeignCurrency
  ) {
    return false;
  }

  return shouldAutoAccept({
    enabled: context.optedIn,
    confidence: context.matchConfidence,
    hasCategory: context.hasCategory,
  });
}
