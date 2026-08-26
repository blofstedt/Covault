// lib/hooks/useDataLoading.ts
import { log } from '../log';
import { useCallback, useRef, useState } from 'react';
import { SYSTEM_CATEGORIES } from '../../constants';
import { sortBudgets } from '../budgetOrder';
import {
  budgetsAfterFailedRead,
  looksLikeWrongColumn,
  worthRetryingWithFreshToken,
} from '../budgetFallback';
import type { BudgetCategory, Transaction, PendingTransaction } from '../../types';
import {
  REST_BASE,
  getAuthHeaders,
  restFetch,
  clearCachedAccessToken,
  DEFAULT_MONTHLY_INCOME,
} from '../apiHelpers';
import { useFromSupabaseTransaction } from './transactionMappers';
import { deduplicatePendingTransactions } from '../notificationProcessor';
import { readFirstPaintCache } from '../firstPaintCache';
import { createReadGate, type ReadGate } from '../readGate';
import type { UseUserDataParams } from './types';

/** Merge incoming transactions into existing ones, deduplicating by ID. */
function mergeTransactions(existing: Transaction[], incoming: Transaction[]): Transaction[] {
  const incomingIds = new Set(incoming.map(t => t.id));
  return [...existing.filter(t => !incomingIds.has(t.id)), ...incoming];
}

const toBudgetId = (row: any): string => {
  if (row?.id !== undefined && row?.id !== null) return String(row.id);
  const name = (row?.category || row?.budget || 'other').toString().toLowerCase();
  return `budget:${name}`;
};

export const useDataLoading = ({
  setAppState,
  setDbError,
}: Pick<UseUserDataParams, 'setAppState' | 'setDbError'>) => {
  const [categoriesLoaded, setCategoriesLoaded] = useState(false);
  const fromSupabaseTransaction = useFromSupabaseTransaction();

  // ── Which transaction load is allowed to win ──
  //
  // Loading transactions REPLACES the list, and two loads are routinely in
  // flight at the same moment: the one loadUserData issues while the app is
  // starting, and the one a capture issues the instant its row is written.
  // Launching the app by tapping a capture notification starts both.
  //
  // Nothing made them arrive in the order they were sent. When the launch
  // request — issued a moment BEFORE the capture was written — answered last,
  // it put back the list as it stood before the purchase existed, and the
  // purchase was gone from the dashboard until something happened to reload
  // again. On a capture the user still has to review, that is one tap away
  // from being noticed and fixed; on one filed automatically there is no such
  // tap, so the row simply was not there, and the purchase got entered a
  // second time by hand. See lib/readGate.ts.
  //
  // A ref, not state: this must not re-render anything, and it has to be
  // readable inside a callback created several renders ago. Initialised
  // lazily so a fresh gate is not allocated on every render.
  const readGateRef = useRef<ReadGate | null>(null);
  if (!readGateRef.current) readGateRef.current = createReadGate();
  const transactionReads = readGateRef.current;

  // ── The linked partner, remembered between loads ──
  //
  // Loading transactions REPLACES the list, and the query is scoped to one
  // user_id. loadHouseholdLink merges the partner's rows in on top afterwards —
  // but only it did, and only on a full loadUserData. Every other reload
  // (filing a caught row, a capture landing, the Review page's scan button)
  // calls loadTransactions with the signed-in user alone, which threw the
  // partner's spending straight back out of app state.
  //
  // On a shared vault that is a wrong number on the screen, not a missing list:
  // the donut, the vials and "remaining" all silently rose by whatever the
  // partner had spent this month, until the next cold start put it back.
  //
  // So a replace-load now fetches both halves and applies them together. A ref
  // rather than state: this is read inside a callback and must not re-render or
  // re-create anything.
  const partnerIdRef = useRef<string | null>(null);
  // Whose partner that is. A different account signing in must not inherit the
  // previous one's partner: RLS would refuse the read anyway, but "the read
  // comes back empty" is a weak place to be relying on for correctness.
  const partnerOwnerIdRef = useRef<string | null>(null);

  // Load budgets from Supabase (replaces both loadCategories and loadUserBudgets)
  // The budgets table now serves as both categories and per-user budget limits.
  const loadCategories = useCallback(async () => {
    // Categories are now loaded as part of loadUserBudgets; mark as loaded immediately
    setCategoriesLoaded(true);
  }, []);

  // Ensure all default budgets exist in the budgets table for this user
  const ensureDefaultBudgets = useCallback(
    async (userId: string, existingCategories: Set<string>) => {
      try {
        const headers = await getAuthHeaders();
        const missing = SYSTEM_CATEGORIES.filter(sc => !existingCategories.has(sc.name));
        if (missing.length === 0) return;

        const newRows = missing.map(sc => ({
          user_uuid: userId,
          budget: sc.name,
          amount: sc.totalLimit,
          Visible: true,
        }));

        (headers as any)['Prefer'] = 'return=representation,resolution=ignore-duplicates';
        let res = await fetch(`${REST_BASE}/budgets?on_conflict=user_uuid,budget`, {
          method: 'POST',
          headers,
          body: JSON.stringify(newRows),
        });

        if (!res.ok) {
          // Fallback for alternate schema column names
          const altRows = missing.map(sc => ({
            user_id: userId,
            category: sc.name,
            limit_amount: sc.totalLimit,
            visible: true,
          }));
          res = await fetch(`${REST_BASE}/budgets?on_conflict=user_id,category`, {
            method: 'POST',
            headers,
            body: JSON.stringify(altRows),
          });
        }

        if (!res.ok) {
          const body = await res.text();
          log.error('[ensureDefaultBudgets] insert failed:', body.slice(0, 200));
        } else {
          log.debug('[ensureDefaultBudgets] inserted', missing.length, 'default budgets');
        }
      } catch (err: any) {
        log.error('[ensureDefaultBudgets] exception:', err?.message || err);
      }
    },
    [],
  );

  /**
   * The starter set of budgets — but only into a dashboard that has none.
   *
   * This used to run on every failed read, and that is how a moment's bad luck
   * erased the user's own budgets from the screen: their limits reverted to the
   * starter 500s and the categories they had hidden came back. Nothing was
   * wrong in the database; the app simply could not read it that second and
   * treated "I could not ask" as "you have not set any".
   *
   * The rule is the one fetchTransactionsFor already follows: an empty answer
   * is an answer, a failed request is not. So defaults are seeded only when
   * there is genuinely nothing to show — a first-ever load — and a failure
   * leaves whatever is already on screen (the previous load, or the first-paint
   * cache) exactly where it is until a read succeeds.
   *
   * This matters beyond the display. The limits on screen are what the settings
   * screen edits and writes back, so showing the starter 500s over the user's
   * real figures put the app one tap away from saving them.
   */
  const seedDefaultBudgetsIfEmpty = useCallback(() => {
    setAppState(prev => {
      const next = budgetsAfterFailedRead(prev.budgets, SYSTEM_CATEGORIES);
      return next === prev.budgets ? prev : { ...prev, budgets: next as BudgetCategory[] };
    });
  }, [setAppState]);

  // Load user budgets from budgets table (this is now the single source of truth for categories)
  const loadUserBudgets = useCallback(
    async (userId: string) => {
      try {
        const headers = await getAuthHeaders();
        let res = await fetch(
          `${REST_BASE}/budgets?select=*&user_uuid=eq.${userId}`,
          { headers },
        );

        // A 401 here is a token, not a schema.
        //
        // loadUserData fires this read alongside settings, transactions and
        // pending — four requests that resolve their auth header at the same
        // instant. When the session's access token is rotated in that instant,
        // one of the four can go out holding the token that rotation just
        // retired, and the server refuses it. Which one loses is luck; on the
        // occasion that prompted this, it was the budgets read, and the other
        // three came back fine a millisecond apart.
        //
        // So the token is dropped and re-read from the session, which returns
        // the current one, and the request goes again. Safe to repeat: it is a
        // GET, and a 401 means the first attempt never reached the data.
        if (worthRetryingWithFreshToken(res.status)) {
          log.warn('[loadUserBudgets] 401 — retrying once with a fresh token');
          clearCachedAccessToken();
          res = await fetch(
            `${REST_BASE}/budgets?select=*&user_uuid=eq.${userId}`,
            { headers: await getAuthHeaders() },
          );
        }

        // The user_uuid/user_id fallback, narrowed to the failure it is for.
        //
        // It exists because the column is named differently on different
        // installs, and PostgREST answers an unknown column with 400. It used
        // to run on ANY non-ok response, which meant a 401 was answered by
        // asking a second time for a column this schema does not have — a
        // guaranteed 400, turning one recoverable failure into a certain one.
        if (!res.ok && looksLikeWrongColumn(res.status)) {
          res = await fetch(
            `${REST_BASE}/budgets?select=*&user_id=eq.${userId}`,
            { headers },
          );
        }
        const body = await res.text();

        if (!res.ok) {
          if (res.status === 404 && body.includes('Could not find the table')) {
            log.debug('[loadUserBudgets] budgets table not found - using defaults');
            seedDefaultBudgetsIfEmpty();
            setCategoriesLoaded(true);
            return;
          }
          log.error('[loadUserBudgets] failed:', res.status, body.slice(0, 200));
          seedDefaultBudgetsIfEmpty();
          setCategoriesLoaded(true);
          return;
        }

        const rows = JSON.parse(body);

        // Ensure all default budgets exist in the table
        const existingCategories = new Set<string>(rows.map((r: any) => r.category || r.budget).filter(Boolean));
        await ensureDefaultBudgets(userId, existingCategories);

        // If we just seeded new budgets, re-fetch to get their IDs
        let finalRows = rows;
        if (SYSTEM_CATEGORIES.some(sc => !existingCategories.has(sc.name))) {
          let refetchRes = await fetch(
            `${REST_BASE}/budgets?select=*&user_uuid=eq.${userId}`,
            { headers },
          );
          if (!refetchRes.ok) {
            refetchRes = await fetch(
              `${REST_BASE}/budgets?select=*&user_id=eq.${userId}`,
              { headers },
            );
          }
          if (refetchRes.ok) {
            finalRows = JSON.parse(await refetchRes.text());
          }
        }

        // Build budgets directly from the budgets table rows
        const hiddenCategoryIds: string[] = [];
        const budgets: BudgetCategory[] = finalRows.map((row: any) => {
          const isVisible = row.visible ?? row.Visible ?? true;
          if (isVisible === false) {
            hiddenCategoryIds.push(toBudgetId(row));
          }

          return {
            id: toBudgetId(row),
            name: row.category || row.budget || 'Other',
            totalLimit: Number(row.limit_amount ?? row.amount) || 0,
          };
        });

        // Ensure all system categories are present (fallback for newly seeded ones)
        const loadedNames = new Set(budgets.map(b => b.name));
        for (const sysCat of SYSTEM_CATEGORIES) {
          if (!loadedNames.has(sysCat.name)) {
            budgets.push({ ...sysCat });
          }
        }

        // Fixed order, decided here rather than by the database.
        //
        // `budgets` has no sort column and this select has no ORDER BY, so
        // PostgREST returns rows in Postgres's heap order — which changes the
        // moment a row is UPDATEd, because the new version is written at the
        // end of the heap. Editing one budget's limit therefore moved that
        // vial to the bottom of the dashboard on the next load, for no reason
        // the user could see. See lib/budgetOrder.ts.
        const orderedBudgets = sortBudgets(budgets);

        setAppState(prev => ({
          ...prev,
          budgets: orderedBudgets,
          settings: {
            ...prev.settings,
            hiddenCategories: hiddenCategoryIds,
          },
        }));

        log.debug('[loadUserBudgets] loaded:', orderedBudgets.map(b => ({ id: b.id, name: b.name, limit: b.totalLimit })));
        setCategoriesLoaded(true);
      } catch (err: any) {
        log.error('[loadUserBudgets] exception:', err?.message || err);
        seedDefaultBudgetsIfEmpty();
        setCategoriesLoaded(true);
      }
    },
    [setAppState, ensureDefaultBudgets, seedDefaultBudgetsIfEmpty],
  );

  // Load user settings from Supabase (monthly_income, etc.)
  const loadUserSettings = useCallback(
    async (userId: string) => {
      try {
        const BASE_COLUMNS =
          'monthly_income,theme_selected,trial_started_at,trial_ends_at,trial_consumed,' +
          'subscription_status,rollover_enabled,leisure_buffer_enabled,show_savings_insight,' +
          'app_notifications_enabled,budgeting_solo';

        // These two are requested separately because they were added later
        // (supabase/migrations/2026_add_smart_notifications_column.sql and
        // 2026_add_auto_accept_column.sql). PostgREST 400s the WHOLE select if
        // any column is unknown, and this function returns early on a non-ok
        // response — so naming them unconditionally would take theme, income
        // and the trial fields down with them on any project where the
        // migrations haven't been applied yet.
        // Same defensive shape as the user_uuid/user_id fallback below.
        const LATER_COLUMNS = 'smart_notifications_enabled,auto_accept_known_vendors,haptics_enabled';
        let res = await restFetch(
          `/settings?select=${BASE_COLUMNS},${LATER_COLUMNS}&user_id=eq.${userId}`,
          { cache: 'no-store' }, // Prevent caching to always get fresh data
        );

        if (!res.ok) {
          res = await restFetch(
            `/settings?select=${BASE_COLUMNS}&user_id=eq.${userId}`,
            { cache: 'no-store' },
          );
        }

        if (!res.ok) {
          log.error('[loadUserSettings] failed:', res.status);
          return;
        }
        
        const rows = await res.json();

        if (rows && rows.length > 0) {
          const rawMonthlyIncome = rows[0].monthly_income;
          const parsedMonthlyIncome =
            rawMonthlyIncome === null || rawMonthlyIncome === undefined
              ? null
              : Number(rawMonthlyIncome);
          const shouldUseDefault =
            parsedMonthlyIncome === null || Number.isNaN(parsedMonthlyIncome);
          const monthlyIncome = shouldUseDefault
            ? DEFAULT_MONTHLY_INCOME
            : parsedMonthlyIncome;

          // Load theme from database. A row that has never stored one falls
          // back to the same default as App.tsx and index.html — three places
          // that have to agree or the app changes colour as it loads.
          const theme = rows[0].theme_selected || 'dark';

          // Load trial/subscription fields
          const trial_started_at = rows[0].trial_started_at || null;
          const trial_ends_at = rows[0].trial_ends_at || null;
          const trial_consumed = rows[0].trial_consumed ?? false;
          const subscription_status = rows[0].subscription_status || 'none';

          setAppState(prev => ({
            ...prev,
            user: prev.user
              ? {
                  ...prev.user,
                  monthlyIncome,
                  trial_started_at,
                  trial_ends_at,
                  trial_consumed,
                  subscription_status,
                  // Only use DB value if partner_id hasn't already set budgetingSolo=false
                  budgetingSolo: prev.user.budgetingSolo === false
                    ? false
                    : (rows[0].budgeting_solo ?? prev.user.budgetingSolo),
                }
              : null,
            settings: {
              ...prev.settings,
              theme: theme as 'light' | 'dark',
              rolloverEnabled: rows[0].rollover_enabled ?? prev.settings.rolloverEnabled,
              useLeisureAsBuffer: rows[0].leisure_buffer_enabled ?? prev.settings.useLeisureAsBuffer,
              showSavingsInsight: rows[0].show_savings_insight ?? prev.settings.showSavingsInsight,
              app_notifications_enabled: rows[0].app_notifications_enabled ?? prev.settings.app_notifications_enabled,
              // Undefined when the column is missing (pre-migration) — the
              // `??` then keeps whatever the local default/localStorage held,
              // which is the behaviour users had while the write was failing.
              smart_notifications_enabled:
                rows[0].smart_notifications_enabled ?? prev.settings.smart_notifications_enabled,
              auto_accept_known_vendors:
                rows[0].auto_accept_known_vendors ?? prev.settings.auto_accept_known_vendors,
              haptics_enabled:
                rows[0].haptics_enabled ?? prev.settings.haptics_enabled,
            },
          }));

          log.debug(
            shouldUseDefault
              ? '[loadUserSettings] monthly_income missing, using default:'
              : '[loadUserSettings] loaded monthly_income:',
            monthlyIncome,
          );
          log.debug('[loadUserSettings] loaded theme:', theme);
        } else {
          // No settings row exists (shouldn't happen with trigger, but handle it)
          // Use default value only in this case
          log.debug('[loadUserSettings] no settings row found, using default:', DEFAULT_MONTHLY_INCOME);
          setAppState(prev => ({
            ...prev,
            user: prev.user
              ? { ...prev.user, monthlyIncome: DEFAULT_MONTHLY_INCOME }
              : null,
          }));
        }
      } catch (err: any) {
        log.error('[loadUserSettings] exception:', err?.message || err);
      }
    },
    [setAppState],
  );

  /**
   * One user's rows, mapped. Null means the request failed and the caller must
   * leave app state alone — an empty array is an answer, null is the absence of
   * one, and conflating them is how a failed read empties the dashboard.
   */
  const fetchTransactionsFor = useCallback(
    async (userId: string): Promise<Transaction[] | null> => {
      const res = await restFetch(
        `/transactions?select=*&user_id=eq.${userId}&order=date.desc`,
        // The settings read has said this for a while, for the same reason.
        // A capture's whole purpose is that the list is different now, so a
        // cached answer to "what are my transactions" is always the wrong one.
        { cache: 'no-store' },
      );
      const body = await res.text();
      log.debug(
        '[loadTransactions] status:',
        res.status,
        'body:',
        body.slice(0, 300),
      );

      if (!res.ok) {
        const msg = `Load transactions failed (${res.status}): ${body.slice(0, 200)}`;
        log.error(msg);
        setDbError(msg);
        return null;
      }

      const data = JSON.parse(body);
      if (!data || data.length === 0) return [];

      const transactions: Transaction[] = [];
      for (const row of data) {
        try {
          transactions.push(fromSupabaseTransaction(row));
        } catch (mapErr: any) {
          log.warn('[loadTransactions] Skipping invalid row:', row?.id, mapErr?.message);
        }
      }
      return transactions;
    },
    [fromSupabaseTransaction, setDbError],
  );

  // Load transactions from Supabase via raw fetch
  // When merge is true, new transactions are appended to existing ones (used for partner data)
  const loadTransactions = useCallback(
    async (userId: string, { merge = false }: { merge?: boolean } = {}) => {
      // Claimed before the request goes out, so tickets are ordered by when
      // the read STARTED — which is what decides whose answer is older.
      const ticket = transactionReads.take();
      try {
        const own = await fetchTransactionsFor(userId);
        if (own === null) return;

        // A replace has to carry the partner's rows too, or it drops them.
        // Best-effort: a partner read that fails leaves the signed-in user's
        // own list intact rather than blocking the whole reload.
        let data = own;
        const partnerId = partnerOwnerIdRef.current === userId ? partnerIdRef.current : null;
        if (!merge && partnerId && partnerId !== userId) {
          const partnerRows = await fetchTransactionsFor(partnerId);
          if (partnerRows && partnerRows.length > 0) {
            data = mergeTransactions(own, partnerRows);
          }
        }

        if (data.length > 0) {
          const transactions = data;

          log.debug('[loadTransactions] OK, count:', transactions.length);
          // A partner merge only ever adds rows, so it can never take one away
          // and is applied whenever it lands. A replace has to be the newest.
          if (!merge && !transactionReads.accepts(ticket)) {
            log.debug('[loadTransactions] dropping a slower, older read');
            return;
          }
          setAppState(prev => {
            const mergedTransactions = merge
              ? mergeTransactions(prev.transactions, transactions)
              : transactions;
            return { ...prev, transactions: mergedTransactions };
          });
        } else {
          log.debug('[loadTransactions] no transactions found');
          if (!merge) {
            // The most destructive answer of all, and the one most worth
            // dropping when it is out of date: emptying the list.
            if (!transactionReads.accepts(ticket)) {
              log.debug('[loadTransactions] dropping a slower, older empty read');
              return;
            }
            setAppState(prev => ({ ...prev, transactions: [] }));
          }
        }
      } catch (err: any) {
        const msg = `Load transactions exception: ${err?.message || err}`;
        log.error(msg);
        setDbError(msg);
      }
    },
    [fetchTransactionsFor, transactionReads, setAppState, setDbError],
  );

  // Load pending transactions awaiting approval
  const loadPendingTransactions = useCallback(
    async (userId: string) => {
      try {
        const res = await restFetch(
          `/pending_transactions?select=*&user_id=eq.${userId}&status=eq.pending&order=created_at.desc`,
        );

        if (!res.ok) {
          // Check if table doesn't exist (expected during initial setup)
          const body = await res.text();
          if (res.status === 404 && body.includes('Could not find the table')) {
            log.debug('[loadPendingTransactions] table not found - using defaults (run schema.sql to create tables)');
            setAppState(prev => ({ ...prev, pendingTransactions: [] }));
            return;
          }
          log.debug('[loadPendingTransactions] failed or no pending transactions');
          return;
        }

        const data: PendingTransaction[] = JSON.parse(await res.text());
        if (data && data.length > 0) {
          // Second-phase dedup: remove any duplicates that slipped through
          const deduped = await deduplicatePendingTransactions(data);
          log.debug('[loadPendingTransactions] OK, count:', deduped.length);
          setAppState(prev => ({ ...prev, pendingTransactions: deduped }));
        } else {
          log.debug('[loadPendingTransactions] no pending transactions');
          setAppState(prev => ({ ...prev, pendingTransactions: [] }));
        }
      } catch (err: any) {
        log.error('[loadPendingTransactions]', err?.message || err);
      }
    },
    [setAppState],
  );

  // Load household link status from settings table (partner_id field)
  const loadHouseholdLink = useCallback(
    async (userId: string) => {
      try {
        // Check if the user has a partner_id set in their settings
        const res = await restFetch(
          `/settings?select=partner_id,partner_name,partner_email&user_id=eq.${userId}&limit=1`,
        );

        if (!res.ok) {
          log.debug('[loadHouseholdLink] Could not load settings');
          return;
        }

        const body = await res.text();
        const data = JSON.parse(body);
        // Recorded (or cleared) before anything else, so a reload triggered
        // while this is still resolving already knows who to fetch alongside
        // the signed-in user — and so unlinking, or signing in as somebody
        // else, does not leave a stale partner's rows being pulled in.
        partnerIdRef.current =
          data && data.length > 0 && data[0].partner_id ? String(data[0].partner_id) : null;
        partnerOwnerIdRef.current = userId;
        if (data && data.length > 0 && data[0].partner_id) {
          const partnerId = data[0].partner_id;
          const partnerName = data[0].partner_name;

          setAppState(prev => ({
            ...prev,
            user: prev.user
              ? {
                  ...prev.user,
                  budgetingSolo: false,
                  hasJointAccounts: true,
                  partnerId,
                  partnerName: partnerName || undefined,
                }
              : null,
          }));

          // Load partner's transactions and merge with existing user transactions
          await loadTransactions(partnerId, { merge: true });
        }
      } catch (err: any) {
        log.error('[loadHouseholdLink]', err?.message || err);
      }
    },
    [loadTransactions, setAppState],
  );

  /**
   * Draw the last known state before the network is asked anything.
   *
   * Only into empty slots. This runs on every load, including the reloads a
   * token refresh or a resume triggers mid-session, and at those moments the
   * live list is the newer one — hydrating over it would put deleted rows back
   * on screen until the fetch returned.
   */
  const hydrateFromCache = useCallback(
    (userId: string) => {
      const cached = readFirstPaintCache(userId);
      if (!cached) return;

      setAppState(prev => {
        const wantsTransactions = prev.transactions.length === 0 && cached.transactions.length > 0;
        const wantsBudgets = prev.budgets.length === 0 && cached.budgets.length > 0;
        const wantsIncome =
          !!prev.user && !prev.user.monthlyIncome && cached.monthlyIncome > 0;
        if (!wantsTransactions && !wantsBudgets && !wantsIncome) return prev;

        return {
          ...prev,
          transactions: wantsTransactions ? cached.transactions : prev.transactions,
          budgets: wantsBudgets ? cached.budgets : prev.budgets,
          user:
            prev.user && wantsIncome
              ? { ...prev.user, monthlyIncome: cached.monthlyIncome }
              : prev.user,
          settings: wantsBudgets
            ? { ...prev.settings, hiddenCategories: cached.hiddenCategories }
            : prev.settings,
        };
      });
      log.debug('[loadUserData] painted from cache:', cached.transactions.length, 'transactions');
    },
    [setAppState],
  );

  // Load all data from Supabase
  const loadUserData = useCallback(
    async (userId: string) => {
      log.debug('loadUserData called for user:', userId);
      // Before the round-trips, not after: the whole point is the second the
      // fetches spend in flight.
      hydrateFromCache(userId);
      await loadCategories();

      // These four are mutually independent: each uses a functional
      // setAppState updater and they touch disjoint keys (budgets +
      // hiddenCategories / user + theme / transactions / pendingTransactions).
      // Running them serially cost four round-trips for no ordering benefit.
      await Promise.all([
        loadUserBudgets(userId), // user-specific budget limits
        loadUserSettings(userId), // monthly_income, theme, trial flags
        loadTransactions(userId),
        loadPendingTransactions(userId), // awaiting approval
      ]);

      // Must stay after loadTransactions: it merges the partner's rows onto
      // the list that call populates. It must also stay after
      // loadUserSettings, which reads budgetingSolo and defers to the
      // `=== false` this call sets.
      await loadHouseholdLink(userId);
      log.debug('loadUserData completed');
    },
    [hydrateFromCache, loadCategories, loadHouseholdLink, loadPendingTransactions, loadTransactions, loadUserBudgets, loadUserSettings],
  );

  return {
    categoriesLoaded,
    loadUserData,
    loadPendingTransactions,
    loadTransactions,
  };
};
