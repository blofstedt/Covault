import { log } from '../lib/log';
import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import DashboardBottomBar from './dashboard_components/DashboardBottomBar';
import { Transaction, BudgetCategory } from '../types';
import type { Toast } from '../types';

import ActiveBanksCard from './transaction_parsing/ActiveBanksCard';
import AITransactionsEnteredCard from './transaction_parsing/AITransactionsEnteredCard';
import AutoFiledCard from './transaction_parsing/AutoFiledCard';
import SetupInfoCard from './transaction_parsing/SetupInfoCard';
import ClearConfirmModal from './transaction_parsing/ClearConfirmModal';
import ClearAutoFiledConfirmModal from './transaction_parsing/ClearAutoFiledConfirmModal';
import DeleteAllConfirmModal from './transaction_parsing/DeleteAllConfirmModal';
import PageShell from './ui/PageShell';
import LearnedRulesCard from './transaction_parsing/LearnedRulesCard';
import { useNotificationRules } from './transaction_parsing/useNotificationRules';
import type { NotATxRuleType } from './transaction_parsing/NotATransactionModal';

import { covaultNotification } from '../lib/covaultNotification';
import { restFetch } from '../lib/apiHelpers';
import { loadBankingAppsFromDB } from '../lib/bankingApps';
import { getNeedsReviewIdSet, getReviewQueueChangedEventName } from '../lib/localNotificationMemory';
import { buildAutoFiledClearPayload, buildFilePayload, buildUndoPayload } from '../lib/caughtTransactionOps';
import { selectAwaitingReview, countHiddenRefunds, selectRecentlyAutoFiled } from '../lib/reviewQueue';
import { useCurrentDay } from '../lib/hooks/useCurrentDay';
import { toVendorKey } from '../lib/deviceTransactionParser';

/** Delay (ms) after scanning to allow notification processing before reloading data */
const SCAN_PROCESSING_DELAY_MS = 2000;

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

interface TransactionParsingProps {
  /**
   * Bumped when Review is opened from a capture notification or the widget's
   * review pill, to run the light around the rows that are waiting. Ignored
   * when the user walked here themselves — they already know what they came
   * for, and a highlight then is decoration.
   */
  reviewHighlightNonce?: number;
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  onBack: () => void;
  onAddTransaction: () => void;
  onGoHome: () => void;
  allTransactions?: Transaction[];
  onTransactionTap?: (tx: Transaction) => void;
  budgets?: BudgetCategory[];
  userId?: string;
  onRefreshNotifications?: () => Promise<void>;
  onReloadTransactions?: (userId: string) => Promise<void>;
  onClearEntered?: () => void;
  /** Delete a transaction by ID. Used by the soft-dup badge to remove the
   *  similar older transaction when the user confirms a duplicate. */
  onDeleteTransaction?: (id: string) => void;
  /** Update a transaction (full record, persisted). Used by the inline
   *  vendor rename in the Caught Transactions list. The handler also
   *  writes the vendor correction to the overrides table. */
  onUpdateTransaction?: (tx: Transaction) => void;
  /** Currently-loaded vendor overrides, used by the Learned Rules card. */
  vendorOverrides?: import('./transaction_parsing/useVendorOverrides').VendorOverride[];
  /** Delete a vendor override. */
  onDeleteVendorOverride?: (overrideId: string) => void;
  /** Persist and update local state for a vendor category rule. */
  onSetVendorCategory: (vendorName: string, categoryId: string) => void | Promise<void>;
  /** Persist and update local state for a vendor display name. */
  onSetProperName: (vendorName: string, properName: string) => void | Promise<void>;
  /** Raise a transient toast — used for the Undo offered after filing a row. */
  onToast?: (toast: Toast) => void;
}

const TransactionParsing: React.FC<TransactionParsingProps> = ({
  reviewHighlightNonce = 0,
  enabled,
  onToggle,
  onBack,
  onAddTransaction,
  onGoHome,
  allTransactions = [],
  onTransactionTap,
  budgets = [],
  userId,
  onRefreshNotifications,
  onReloadTransactions,
  onClearEntered,
  onDeleteTransaction,
  onUpdateTransaction,
  vendorOverrides = [],
  onDeleteVendorOverride,
  onSetVendorCategory,
  onSetProperName,
  onToast,
}) => {
  // ── Clear/delete modal state ──
  //
  // All three hold the ROWS the user tapped on, never a flag. A scan or a
  // reload can change either list while a confirmation is open, and what the
  // user agreed to is what they were looking at when they tapped.
  const [clearTargets, setClearTargets] = useState<Transaction[] | null>(null);
  const [clearAutoFiledTargets, setClearAutoFiledTargets] = useState<Transaction[] | null>(null);
  const [deleteTargets, setDeleteTargets] = useState<Transaction[] | null>(null);
  // All sections always expanded per user request
  // Only the review queue starts open. The other two are reference/settings
  // content and previously pushed the actual task below the fold.
  const [expandedSections, setExpandedSections] = useState({
    activeBanks: false,
    caughtTransactions: true,
    autoFiled: true,
    learnedRules: false,
  });

  const toggleSection = useCallback((section: keyof typeof expandedSections) => {
    setExpandedSections((current) => ({
      ...current,
      [section]: !current[section],
    }));
  }, []);

  // ── Arriving from a capture notification or the widget's review pill ──
  // The tap said "a purchase is waiting", so it has to land on the purchases,
  // not on the top of a page that happens to contain them. Two things are
  // needed and neither is enough alone: the section has to be open (the user
  // may have collapsed it on their last visit, in which case there is
  // literally nothing to arrive at), and the page has to be scrolled to it.
  const mainRef = useRef<HTMLElement>(null);
  const reviewCardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (reviewHighlightNonce <= 0) return;

    setExpandedSections((current) =>
      current.caughtTransactions ? current : { ...current, caughtTransactions: true },
    );

    // After paint, so the expansion above is measured rather than guessed at.
    const frame = requestAnimationFrame(() => {
      const scroller = mainRef.current;
      const card = reviewCardRef.current;
      if (!scroller || !card) return;
      scroller.scrollTo({
        // A little headroom above the card, matching the "Today" jump in
        // BudgetSection so the two arrivals feel like the same gesture.
        top: Math.max(0, card.offsetTop - 12),
        behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      });
    });

    return () => cancelAnimationFrame(frame);
  }, [reviewHighlightNonce]);


  // ── Refresh spinner state ──
  const [isRefreshing, setIsRefreshing] = useState(false);

  // ── Monitored banking apps for ActiveBanksCard ──
  const [monitoredBanks, setMonitoredBanks] = useState<Map<string, string>>(new Map());

  const loadMonitoredBanks = useCallback(async () => {
    if (!covaultNotification) return;
    try {
      const knownBankingApps = await loadBankingAppsFromDB();
      const { apps: packageNames } = await covaultNotification.getMonitoredApps();
      const bankMap = new Map<string, string>();
      for (const pkg of packageNames) {
        if (pkg in knownBankingApps) {
          bankMap.set(pkg, knownBankingApps[pkg]);
        }
      }
      setMonitoredBanks(bankMap);
    } catch (e) {
      log.warn('[TransactionParsing] Error loading monitored banks:', e);
    }
  }, []);

  // Load monitored banks on mount and when notifications are enabled
  useEffect(() => {
    if (enabled) {
      loadMonitoredBanks();
    }
  }, [enabled, loadMonitoredBanks]);


  // needsReviewIds is the live source of truth for the review queue; any
  // count is derived from it at the point of use.
  const [needsReviewIds, setNeedsReviewIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const refreshReviewQueue = () => {
      setNeedsReviewIds(getNeedsReviewIdSet());
    };
    refreshReviewQueue();
    const eventName = getReviewQueueChangedEventName();
    window.addEventListener(eventName, refreshReviewQueue);
    return () => window.removeEventListener(eventName, refreshReviewQueue);
  }, []);

  // ── Captures still awaiting review ──
  // Shared definition (lib/reviewQueue.ts) so the card, the bottom-bar badge
  // and the home-screen widget cannot disagree. They used to: this filter kept
  // refunds, while the card rendered them out, so a captured refund made the
  // badge read one higher than the list it pointed at.
  const aiTransactions = useMemo(
    () => selectAwaitingReview(allTransactions),
    [allTransactions],
  );
  // Surfaced in the card's subtitle so filtered-out refunds are explained
  // rather than looking like captures that went missing.
  const hiddenRefundCount = useMemo(
    () => countHiddenRefunds(allTransactions),
    [allTransactions],
  );

  // ── What the app filed without asking ──
  // With auto-file on, a capture matching a learned rule never reaches the
  // list above — which is the point, but it also meant it reached nothing at
  // all, and the page said "All caught up" while purchases were being
  // recorded. These are shown separately so a filed purchase is still a
  // purchase the user has seen. Read off the same clock as everything else
  // on the page, so the window rolls over at local midnight with the rest.
  const todayIso = useCurrentDay();
  const autoFiled = useMemo(
    () => selectRecentlyAutoFiled(allTransactions, todayIso),
    [allTransactions, todayIso],
  );

  // ── Notification rules hook (skip patterns the user has trained) ──
  const {
    rules: notificationRules,
    create: createNotificationRule,
    remove: removeNotificationRule,
  } = useNotificationRules({ userId });

  // ── Inline vendor rename ──
  // Persists via the existing onUpdateTransaction path. The handler in
  // useTransactionOps already writes the vendor correction to the
  // overrides table (with match_type='exact' for inline renames; the
  // user can later change match_type via the VendorCategoryRulesCard).
  const handleVendorRenamed = useCallback(
    async (tx: Transaction, newVendor: string) => {
      if (!onUpdateTransaction) return;
      const updated: Transaction = { ...tx, vendor: newVendor };
      onUpdateTransaction(updated);
    },
    [onUpdateTransaction],
  );

  // ── Fuel-hold correction ──
  // The user types what they actually pumped and it replaces the placeholder.
  // Persisted through the same update path as the inline vendor rename, which
  // also clears the row's "needs a look" flag — correct here, because supplying
  // the number IS the look. The row stays in the review list so they can still
  // file it where they want.
  const handleAmountCorrected = useCallback(
    async (tx: Transaction, amount: number) => {
      if (!onUpdateTransaction) return;
      onUpdateTransaction({ ...tx, amount });
    },
    [onUpdateTransaction],
  );

  // ── Late settlement ──
  // The settled charge takes over the placeholder row and the duplicate goes
  // away. Ordered deliberately: the placeholder is corrected FIRST, so a failure
  // between the two steps leaves the user with the right amount recorded twice
  // rather than the wrong amount recorded once. Over-counting is visible and
  // fixable; a silently wrong total is neither.
  const handleSettleFuelHold = useCallback(
    async (placeholder: Transaction, charge: Transaction) => {
      if (!onUpdateTransaction || !onDeleteTransaction) return;
      onUpdateTransaction({ ...placeholder, amount: Number(charge.amount) });
      await onDeleteTransaction(charge.id);
    },
    [onUpdateTransaction, onDeleteTransaction],
  );

  // ── "Not a transaction" flow ──
  // Creates a notification_rule (so future matches are skipped) and
  // deletes the row. Both ops are independent; if one fails the other
  // still runs and we log a warning.
  const handleMarkNotTransaction = useCallback(
    async (tx: Transaction, ruleType: NotATxRuleType) => {
      if (!userId) return;
      if (tx.raw_notification && tx.raw_notification.trim()) {
        try {
          await createNotificationRule({
            pattern: tx.raw_notification.trim(),
            pattern_type: ruleType,
          });
        } catch (err) {
          log.warn('[TransactionParsing] failed to create skip rule:', err);
        }
      }
      if (onDeleteTransaction) {
        await onDeleteTransaction(tx.id);
      }
    },
    [userId, createNotificationRule, onDeleteTransaction],
  );

  // ── Caught-transaction triage (Accept / Change / Create rule) ──
  // Files a caught transaction: sets caught_cleared (so it leaves the "Caught
  // Transactions" queue) plus any budget change, then reloads from the DB.
  const fileCaughtTransaction = useCallback(
    async (txId: string, extra: Record<string, unknown> = {}) => {
      try {
        await restFetch(`/transactions?id=eq.${txId}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify(buildFilePayload(extra)),
        });
      } catch (err) {
        log.warn('[TransactionParsing] file caught transaction failed:', err);
      }
      if (userId) await onReloadTransactions?.(userId);
    },
    [userId, onReloadTransactions],
  );

  // Un-file rows: the exact inverse of fileCaughtTransaction. `budget` is
  // restored explicitly rather than left alone, because Accept can be reached
  // from a path that also moved the row (Change category), and an Undo that
  // brings the row back under the wrong budget is worse than no Undo.
  const restoreCaughtTransactions = useCallback(
    async (rows: Array<{ id: string; budget: string | null }>) => {
      await Promise.all(
        rows.map(async ({ id, budget }) => {
          try {
            await restFetch(`/transactions?id=eq.${id}`, {
              method: 'PATCH',
              headers: { Prefer: 'return=minimal' },
              body: JSON.stringify(buildUndoPayload(budget)),
            });
          } catch (err) {
            log.warn('[TransactionParsing] undo file failed:', err);
          }
        }),
      );
      if (userId) await onReloadTransactions?.(userId);
    },
    [userId, onReloadTransactions],
  );

  /** The row's category name as it stands right now, for restoring on Undo. */
  const budgetNameOf = useCallback(
    (tx: Transaction) => budgets.find((b) => b.id === tx.budget_id)?.name ?? null,
    [budgets],
  );

  // Accept: keep the current mapping, just file the row.
  const handleAcceptCaught = useCallback(
    async (tx: Transaction) => {
      const previousBudget = budgetNameOf(tx);
      await fileCaughtTransaction(tx.id);
      onToast?.({
        message: `Filed ${tx.vendor}`,
        tone: 'info',
        // Named row: a rename while this is still up rewrites the name here
        // too, rather than leaving the screen arguing with itself.
        subject: { transactionId: tx.id, vendor: tx.vendor },
        action: {
          label: 'Undo',
          run: () => { void restoreCaughtTransactions([{ id: tx.id, budget: previousBudget }]); },
        },
      });
    },
    [fileCaughtTransaction, budgetNameOf, onToast, restoreCaughtTransactions],
  );

  // Bulk accept: same as above for every row the card offered, undone together.
  const handleAcceptMany = useCallback(
    async (txs: Transaction[]) => {
      if (txs.length === 0) return;
      // Snapshot before filing — after the reload these rows are gone from state.
      const snapshot = txs.map((tx) => ({ id: tx.id, budget: budgetNameOf(tx) }));
      const idList = txs.map((tx) => `"${tx.id.replace(/"/g, '')}"`).join(',');
      try {
        await restFetch(`/transactions?id=in.(${idList})`, {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify(buildFilePayload()),
        });
      } catch (err) {
        log.warn('[TransactionParsing] bulk accept failed:', err);
      }
      if (userId) await onReloadTransactions?.(userId);
      onToast?.({
        message: `Filed ${txs.length} transactions`,
        tone: 'info',
        action: {
          label: 'Undo',
          run: () => { void restoreCaughtTransactions(snapshot); },
        },
      });
    },
    [budgetNameOf, userId, onReloadTransactions, onToast, restoreCaughtTransactions],
  );

  // Change: move the row to a different budget, then file.
  // Latest overrides, read by the Undo action. A rule created moments ago gets
  // a temp id that is swapped for the real one once the insert returns, so the
  // undo has to look the row up when it fires rather than close over an id.
  const vendorOverridesRef = useRef(vendorOverrides);
  useEffect(() => {
    vendorOverridesRef.current = vendorOverrides;
  }, [vendorOverrides]);

  // Every taught rule, in the shape the picker and the rename typeahead use.
  const knownRules = useMemo(
    () =>
      vendorOverrides.map((vo) => ({
        properName: vo.proper_name,
        categoryId: vo.category_id,
        categoryName: vo.category_name || '',
      })),
    [vendorOverrides],
  );

  // Rules already taught for a vendor, matched case-insensitively on the
  // display name or the normalized key.
  //
  // Usually one. Two or more means the capture pipeline found conflicting
  // rules, refused to guess, and routed the row here (see step 5a of
  // notificationProcessor) — the picker then offers exactly these.
  const existingRulesFor = useCallback(
    (vendor: string) => {
      if (!vendor) return [];
      const key = toVendorKey(vendor);
      const lower = vendor.toLowerCase();
      return vendorOverrides
        .filter((vo) => {
          if (vo.proper_name.toLowerCase() === lower) return true;
          return (vo.match_key || toVendorKey(vo.proper_name)) === key;
        })
        .map((vo) => ({
          properName: vo.proper_name,
          categoryId: vo.category_id,
          categoryName: vo.category_name || '',
        }));
    },
    [vendorOverrides],
  );

  // Categorising a caught transaction ALWAYS teaches the rule.
  //
  // This used to be two separate actions: "Change category" filed the row and
  // forgot, "Always use this category" also saved a rule. Teaching was
  // therefore opt-in and easy to skip, so the app went on asking about
  // merchants the user had already sorted repeatedly.
  //
  // Now every choice records the pairing. The undo on the resulting toast is
  // what keeps a one-off correction safe, which is why the old explicit
  // create-rule step is no longer needed and `handleCreateRuleForCaught` is
  // gone.
  //
  // Rule-writing is best-effort and deliberately does not block filing: the
  // row leaving the review queue is the user's actual intent, and a failed
  // override write must not strand it there.
  const handleChangeCaughtCategory = useCallback(
    async (tx: Transaction, budgetId: string) => {
      const name = budgets.find((b) => b.id === budgetId)?.name;

      // Was this pairing already known? If so nothing is being learned, and
      // offering "Undo" would be a lie — it would delete a rule the user set
      // up earlier and had every reason to keep.
      const alreadyKnown = existingRulesFor(tx.vendor).some((r) => r.categoryId === budgetId);

      try {
        await onSetVendorCategory(tx.vendor, budgetId);
      } catch (err) {
        log.warn('[TransactionParsing] learn rule failed:', err);
      }
      await fileCaughtTransaction(tx.id, name ? { budget: name } : {});

      if (alreadyKnown) return;

      // Undo takes back the RULE only, and deliberately leaves the transaction
      // filed where the user just put it. Those are two different intentions —
      // "don't remember this" is the common one, and reverting their
      // categorisation as well would be a surprise.
      //
      // The override's id is resolved at undo time, not now: the insert
      // completes asynchronously and its temp id is swapped for the real one,
      // so an id captured here would frequently be stale.
      const otherRuleCount = existingRulesFor(tx.vendor).length;
      onToast?.({
        message: otherRuleCount > 0
          ? `Learned ${tx.vendor} → ${name ?? ''} · that vendor will now ask`
          : `Learned ${tx.vendor} → ${name ?? ''}`,
        tone: 'info',
        subject: { transactionId: tx.id, vendor: tx.vendor },
        action: {
          label: 'Undo',
          run: () => {
            const match = vendorOverridesRef.current.find(
              (vo) =>
                vo.proper_name.toLowerCase() === tx.vendor.toLowerCase() &&
                vo.category_id === budgetId,
            );
            if (match) onDeleteVendorOverride?.(match.id);
          },
        },
      });
    },
    [
      fileCaughtTransaction,
      budgets,
      onSetVendorCategory,
      existingRulesFor,
      onToast,
      onDeleteVendorOverride,
    ],
  );

  // Default no-op for vendor override deletion when not provided
  const handleDeleteVendorOverride = useCallback(
    (overrideId: string) => {
      if (onDeleteVendorOverride) {
        onDeleteVendorOverride(overrideId);
      } else {
        log.warn('[TransactionParsing] onDeleteVendorOverride not provided; cannot delete', overrideId);
      }
    },
    [onDeleteVendorOverride],
  );

  const categoryNameById = useMemo(
    () => new Map<string, string>(budgets.map((b) => [b.id, b.name])),
    [budgets],
  );

  // Local state for the expanded vendor (managed here so the card stays presentational)
  const [expandedVendorCategory, setExpandedVendorCategory] = useState<string | null>(null);

  const handleSetVendorCategory = useCallback(
    async (vendorName: string, categoryId: string) => {
      await onSetVendorCategory(vendorName, categoryId);
      setExpandedVendorCategory(null);
    },
    [onSetVendorCategory],
  );

  const handleSetProperName = useCallback(
    async (vendorName: string, properName: string) => {
      await onSetProperName(vendorName, properName);
    },
    [onSetProperName],
  );

  // When notifications are enabled, trigger a scan and reload data
  // after a short delay so newly processed notifications appear.
  const prevEnabled = React.useRef(enabled);
  const reloadTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const scanCancelledRef = React.useRef(false);
  useEffect(() => {
    const wasEnabled = prevEnabled.current;
    prevEnabled.current = enabled;
    scanCancelledRef.current = false;

    if (!wasEnabled && enabled) {
      // Notifications were just enabled — refresh after scan has time to process
      (async () => {
        try {
          if (onRefreshNotifications) {
            await onRefreshNotifications();
          }
          if (scanCancelledRef.current) return;
          reloadTimeoutRef.current = setTimeout(async () => {
            if (scanCancelledRef.current) return;
            if (onReloadTransactions && userId) {
              await onReloadTransactions(userId);
            }
          }, SCAN_PROCESSING_DELAY_MS);
        } catch (e) {
          log.error('[TransactionParsing] refresh after enable failed:', e);
        }
      })();
    }

    return () => {
      scanCancelledRef.current = true;
      if (reloadTimeoutRef.current != null) {
        clearTimeout(reloadTimeoutRef.current);
        reloadTimeoutRef.current = null;
      }
    };
  }, [enabled, onRefreshNotifications, onReloadTransactions, userId]);

  // Refresh monitored banks on visibility change
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        loadMonitoredBanks();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [loadMonitoredBanks]);

  // ── Clear handlers ──
  //
  // Neither of these deletes anything. Both only flip the flag that decides
  // whether a row is still listed on this page — see lib/caughtTransactionOps.

  // File every row the review list was showing.
  const handleClearEntered = useCallback(async (rows: Transaction[]) => {
    if (!userId || rows.length === 0) return;
    try {
      const idList = rows.map((tx) => `"${String(tx.id).replace(/"/g, '')}"`).join(',');
      const res = await restFetch(`/transactions?id=in.(${idList})`, {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify(buildFilePayload()),
      });
      if (!res.ok) {
        log.error('[TransactionParsing] Error clearing entered:', res.status);
        return;
      }
    } catch (err) {
      log.error('[TransactionParsing] Error clearing entered:', err);
      return;
    }
    onClearEntered?.();
    await onReloadTransactions?.(userId);
  }, [userId, onClearEntered, onReloadTransactions]);

  // Clear the "Filed automatically" receipt.
  //
  // These rows are already filed and already counted; unsetting `auto_filed` is
  // the whole change, and it only takes them off this card. No column-missing
  // fallback is needed the way the capture insert has one: a database without
  // the column can never report `auto_filed === true`, so the card that carries
  // this button would not be on screen at all.
  const handleClearAutoFiled = useCallback(async (rows: Transaction[]) => {
    if (!userId || rows.length === 0) return;
    try {
      const idList = rows.map((tx) => `"${String(tx.id).replace(/"/g, '')}"`).join(',');
      const res = await restFetch(`/transactions?id=in.(${idList})`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify(buildAutoFiledClearPayload()),
      });
      if (!res.ok) {
        log.error('[TransactionParsing] Error clearing auto-filed:', res.status);
        return;
      }
    } catch (err) {
      log.error('[TransactionParsing] Error clearing auto-filed:', err);
      return;
    }
    await onReloadTransactions?.(userId);
  }, [userId, onReloadTransactions]);

  // ── Delete every captured row, for real ──
  //
  // Deliberately NOT routed through the per-row delete handler. That one plans a
  // recurring delete — deleting one occurrence of a series takes every later one
  // with it and stops the ones before — which is right when the user picks a row
  // out of their history, and wrong here: a captured row often carries a
  // recurrence the parser read out of the bank's own wording ("recurring
  // payment"), so a single tap on the trash could take out charges that are not
  // in this list and that the user never saw. One delete, exactly the rows they
  // were shown.
  const handleDeleteAllEntered = useCallback(async (rows: Transaction[]) => {
    if (!userId || rows.length === 0) return;
    const idList = rows.map((tx) => `"${String(tx.id).replace(/"/g, '')}"`).join(',');
    try {
      const res = await restFetch(`/transactions?id=in.(${idList})`, { method: 'DELETE' });
      if (!res.ok) {
        log.error('[TransactionParsing] Error deleting captured transactions:', res.status);
        return;
      }
    } catch (err) {
      log.error('[TransactionParsing] Error deleting captured transactions:', err);
      return;
    }
    await onReloadTransactions?.(userId);
  }, [userId, onReloadTransactions]);

  // ── Refresh handler ──
  const followUpTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (followUpTimerRef.current != null) clearTimeout(followUpTimerRef.current);
  }, []);

  const handleRefresh = useCallback(async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    try {
      if (onRefreshNotifications) {
        await onRefreshNotifications();
      }
      // scanActiveNotifications resolves immediately while notification events
      // are still moving through the AI pipeline, so show whatever has landed
      // right away rather than holding the spinner on a fixed timer.
      if (onReloadTransactions && userId) {
        await onReloadTransactions(userId);
      }
    } finally {
      setIsRefreshing(false);
      loadMonitoredBanks();
      // Slower AI extractions land after the scan resolves. Pick them up in the
      // background — the spinner is already gone, the list just fills in.
      if (onReloadTransactions && userId) {
        followUpTimerRef.current = setTimeout(() => {
          followUpTimerRef.current = null;
          void onReloadTransactions(userId);
        }, 2500);
      }
    }
  }, [isRefreshing, onRefreshNotifications, onReloadTransactions, userId, loadMonitoredBanks]);

  return (
    <PageShell>
      {/* Header */}
      <header
        className="px-6 pt-safe-top pb-2 shrink-0 z-20 transition-colors bg-transparent border-none backdrop-blur-none relative"
        style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 1rem)' }}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-slate-500 dark:text-slate-100 tracking-tight">
              Review
            </h1>
            <p className="text-[11px] font-medium text-slate-400 dark:text-slate-500 mt-0.5 truncate">
              {enabled
                ? 'Transactions Covault caught from your bank alerts'
                : 'Turn on capture to log transactions automatically'}
            </p>
          </div>
          {enabled && (
            <button
              type="button"
              onClick={() => onToggle(false)}
              className="shrink-0 inline-flex items-center gap-1.5 min-h-[36px] px-3 rounded-full bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800/40 text-[11px] font-bold text-emerald-700 dark:text-emerald-300 active:scale-95 transition-all"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
              Capture on
            </button>
          )}
        </div>
      </header>

      {/* Main content — single flex container (no extra wrapper) */}
      <main
        ref={mainRef}
        className="flex-1 min-h-0 overflow-y-auto no-scrollbar p-4 pb-0 max-w-2xl mx-auto w-full relative z-10"
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        {enabled ? (
          <>
            <div className="shrink-0 mb-4">
              <ActiveBanksCard
                activeBanks={monitoredBanks}
                isExpanded={expandedSections.activeBanks}
                onToggleExpanded={() => toggleSection('activeBanks')}
              />
            </div>

            {/* The wrapper is what the arrival scroll measures — the card is a
                composed component with no ref of its own, and offsetTop has to
                come from the element the scroller actually contains. */}
            <div ref={reviewCardRef}>
            <AITransactionsEnteredCard
              highlightNonce={reviewHighlightNonce}
              aiTransactions={aiTransactions}
              budgets={budgets}
              onTransactionTap={onTransactionTap}
              onClear={(rows) => setClearTargets(rows)}
              onRefresh={handleRefresh}
              isRefreshing={isRefreshing}
              refundCount={hiddenRefundCount}
              needsReviewIds={needsReviewIds}
              onDeleteTransaction={onDeleteTransaction}
              onDeleteAll={(rows) => setDeleteTargets(rows)}
              onVendorRenamed={handleVendorRenamed}
              onMarkNotTransaction={handleMarkNotTransaction}
              userId={userId}
              isExpanded={expandedSections.caughtTransactions}
              onToggleExpanded={() => toggleSection('caughtTransactions')}
              vendorOverrides={vendorOverrides}
              onAccept={handleAcceptCaught}
              onChangeCategory={handleChangeCaughtCategory}
              existingRulesFor={existingRulesFor}
              knownRules={knownRules}
              onAcceptMany={handleAcceptMany}
              onAmountCorrected={handleAmountCorrected}
              allTransactions={allTransactions}
              onSettleFuelHold={handleSettleFuelHold}
            />
            </div>

            {/* Gated out here as well as inside the card: the card renders
                nothing when nothing was filed for you, and a wrapper left
                behind would still push a blank 1rem between the two cards. */}
            {autoFiled.length > 0 && (
            <div className="shrink-0 mt-4">
              <AutoFiledCard
                transactions={autoFiled}
                budgets={budgets}
                onChangeCategory={handleChangeCaughtCategory}
                existingRulesFor={existingRulesFor}
                onClear={(rows) => setClearAutoFiledTargets(rows)}
                isExpanded={expandedSections.autoFiled}
                onToggleExpanded={() => toggleSection('autoFiled')}
              />
            </div>
            )}

            <div className="shrink-0 mt-4">
              <LearnedRulesCard
                vendorOverrides={vendorOverrides}
                categoryNameById={categoryNameById}
                budgets={budgets}
                allTransactions={allTransactions}
                rules={notificationRules}
                onRemoveRule={removeNotificationRule}
                onDeleteVendorOverride={handleDeleteVendorOverride}
                onSetVendorCategory={handleSetVendorCategory}
                onSetProperName={handleSetProperName}
                onSetExpandedVendorCategory={setExpandedVendorCategory}
                expandedVendorCategory={expandedVendorCategory}
                isExpanded={expandedSections.learnedRules}
                onToggleExpanded={() => toggleSection('learnedRules')}
              />
            </div>
          </>
        ) : (
          <SetupInfoCard enabled={enabled} onToggle={onToggle} />
        )}
      </main>

      <div
        aria-hidden="true"
        className="shrink-0"
        style={{ height: 'calc(env(safe-area-inset-bottom, 0px) + 5rem)' }}
      />

      <DashboardBottomBar
        onGoHome={onGoHome}
        onAddTransaction={onAddTransaction}
        onOpenParsing={onBack}
        activeView="parsing"
        pendingCount={aiTransactions.length}
      />

      {/* Clear confirmation modal — files the review list, deletes nothing */}
      {clearTargets && clearTargets.length > 0 && (
        <ClearConfirmModal
          count={clearTargets.length}
          onConfirm={async () => {
            const rows = clearTargets;
            setClearTargets(null);
            await handleClearEntered(rows);
          }}
          onCancel={() => setClearTargets(null)}
        />
      )}

      {/* Clear confirmation for the "Filed automatically" receipt */}
      {clearAutoFiledTargets && clearAutoFiledTargets.length > 0 && (
        <ClearAutoFiledConfirmModal
          count={clearAutoFiledTargets.length}
          onConfirm={async () => {
            const rows = clearAutoFiledTargets;
            setClearAutoFiledTargets(null);
            await handleClearAutoFiled(rows);
          }}
          onCancel={() => setClearAutoFiledTargets(null)}
        />
      )}

      {/* Delete confirmation modal */}
      {deleteTargets && deleteTargets.length > 0 && (
        <DeleteAllConfirmModal
          count={deleteTargets.length}
          onConfirm={async () => {
            const rows = deleteTargets;
            setDeleteTargets(null);
            await handleDeleteAllEntered(rows);
          }}
          onCancel={() => setDeleteTargets(null)}
        />
      )}
    </PageShell>
  );
};

export default TransactionParsing;