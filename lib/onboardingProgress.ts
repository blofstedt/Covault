// lib/onboardingProgress.ts
//
// Where the intro had got to, so it can be picked up rather than started again.
//
// The intro used to be three slides and two questions — nothing that mattered
// if it was interrupted. It now sets the month's money up and walks the user
// through granting Android's notification access, and that last step LEAVES
// THE APP. The WebView is routinely destroyed while the user is in Android's
// settings; coming back to slide one, or worse to a half-configured dashboard,
// would lose everything they had just answered.
//
// So each step is written down as it is reached, before the trip out, in the
// same shape lib/onboardingState.ts already uses: per user id, every access
// wrapped, and storage being unavailable degrading to today's behaviour rather
// than throwing.
//
// What is NOT stored is anything the user typed. Every setup step writes its
// answer straight to the database as it is given — the income, each budget
// limit, each hidden category — so the resume only ever has to remember which
// step, never what was in the fields. A half-finished intro therefore leaves
// real, saved settings behind it, not a draft.

const PROGRESS_PREFIX = 'covault_onboarding_progress_v1:';

/**
 * The steps, in the order they are asked.
 *
 * `intro` covers all the opening slides; which slide is ordinary component
 * state and is deliberately not persisted — resuming to slide two of three is
 * not worth a write per tap.
 *
 * `who` stays where it has always been, first among the questions, because two
 * later things depend on its answer: the income step's wording changes on a
 * shared vault, and `saveBudgetLimit`'s alternate-schema write sends
 * `is_household` from it.
 */
export const ONBOARDING_STEPS = [
  'intro',
  'who',
  'partner',
  'income',
  'limits',
  'capture',
  'tour',
] as const;

export type OnboardingStepId = (typeof ONBOARDING_STEPS)[number];

export interface OnboardingProgress {
  step: OnboardingStepId;
  /** Their answer to "who is this for", needed to know if `partner` is in the path. */
  solo: boolean;
}

const FIRST_STEP: OnboardingStepId = 'intro';

function keyFor(userId: string): string {
  return `${PROGRESS_PREFIX}${userId}`;
}

function isStep(value: unknown): value is OnboardingStepId {
  return typeof value === 'string' && (ONBOARDING_STEPS as readonly string[]).includes(value);
}

/**
 * Where this person had got to, or null if they have not started.
 *
 * Anything unreadable, unparseable or naming a step this build no longer has
 * comes back as null, which starts the intro at the beginning — the behaviour
 * before this file existed, and the only safe answer to "I don't know".
 */
export function readProgress(userId: string | null | undefined): OnboardingProgress | null {
  if (!userId) return null;
  try {
    const raw = localStorage.getItem(keyFor(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (!isStep(parsed.step)) return null;
    return { step: parsed.step, solo: parsed.solo !== false };
  } catch {
    return null;
  }
}

/** Written as each step is reached, before anything that can leave the app. */
export function writeProgress(
  userId: string | null | undefined,
  progress: OnboardingProgress,
): void {
  if (!userId) return;
  try {
    localStorage.setItem(keyFor(userId), JSON.stringify(progress));
  } catch {
    /* Storage blocked: the intro simply restarts, as it always did. */
  }
}

/** Dropped when the intro finishes, so a second run starts clean. */
export function clearProgress(userId: string | null | undefined): void {
  if (!userId) return;
  try {
    localStorage.removeItem(keyFor(userId));
  } catch {
    /* see writeProgress */
  }
}

/** The step to resume at, given whatever was stored. */
export function resumeStep(progress: OnboardingProgress | null): OnboardingStepId {
  return progress?.step ?? FIRST_STEP;
}

/**
 * The step after this one.
 *
 * `partner` is skipped for a solo vault — there is nobody to link — and
 * `null` means the intro is over.
 */
export function nextStep(
  current: OnboardingStepId,
  { solo }: { solo: boolean },
): OnboardingStepId | null {
  const index = ONBOARDING_STEPS.indexOf(current);
  if (index < 0) return FIRST_STEP;
  for (let i = index + 1; i < ONBOARDING_STEPS.length; i++) {
    const step = ONBOARDING_STEPS[i];
    if (step === 'partner' && solo) continue;
    return step;
  }
  return null;
}
