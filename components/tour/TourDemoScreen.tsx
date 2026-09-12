import React, { useMemo, useRef } from 'react';
import { Transaction, BudgetCategory } from '../../types';
import PageShell from '../ui/PageShell';
import DashboardBalanceSection from '../dashboard_components/DashboardBalanceSection';
import DashboardBudgetSectionsList from '../dashboard_components/DashboardBudgetSectionsList';
import DashboardBottomBar from '../dashboard_components/DashboardBottomBar';
import { SYSTEM_CATEGORIES } from '../../constants';
import { getLocalMonthKey, getLocalToday } from '../../lib/dateUtils';
import { shiftMonthKey } from '../../lib/monthWindow';

// Same lazy chunk the dashboard loads d3 through, so the intro does not pull
// the chart into the entry bundle either.
const BudgetFlowChart = React.lazy(() => import('../dashboard_components/BudgetFlowChart'));

/**
 * The dashboard, with example figures in it.
 *
 * Only the intro uses this. Replayed from Settings the walkthrough points at
 * the user's own dashboard directly (see `GuidedTour`), because by then there
 * is one to point at; during the intro there is not, and a brand-new one is a
 * row of zeroes — a spotlight circling blanks, explaining what would have
 * been there.
 *
 * The important thing about this file is what it does NOT contain: a drawing
 * of a dashboard. It used to be one, hand-built from the same colours and
 * roughly the same shapes, and it drifted the way every copy of a screen
 * drifts — the balance ended up left-aligned where the real one is centred
 * and emerald, the chart was replaced by a plain row of month names, and the
 * search field was missing altogether. Someone who had used the app for a
 * while was being shown a worse version of the screen they already knew.
 *
 * So it is now the REAL components — `DashboardBalanceSection`,
 * `BudgetFlowChart`, `DashboardBudgetSectionsList`, `DashboardBottomBar`,
 * inside the real `PageShell` — laid out exactly as `Dashboard` lays them
 * out, handed invented data. It cannot look like a different app, because it
 * is not a different app; when the dashboard changes, this changes with it.
 *
 * It is inert by construction: `pointer-events-none` at the root, every
 * handler a no-op, and `aria-hidden` because the tour's captions carry the
 * meaning for a screen reader.
 *
 * The figures are invented, and the walkthrough says so — the "Example
 * figures" chip is on the tour's own caption card rather than on this screen.
 * That is the same rule the widget preview in `HomeScreenWidgetSection`
 * follows (a preview that could be mistaken for the user's own money is worse
 * than no preview), but the chip cannot live here: every corner of a real
 * dashboard is already spoken for, and the only free one is directly on top
 * of the "Remaining Balance" label. On the caption it is always legible,
 * always on top, and never fighting the layout it is describing.
 *
 * The one thing NOT invented is the calendar: the months come from today's
 * date through the same window the real rail uses, since being wrong about
 * which month it is, in a budget app, is not a small thing.
 */

/** Enough categories to look like a used dashboard, few enough to stay two-line. */
const DEMO_BUDGET_NAMES = ['Housing', 'Groceries', 'Transport', 'Leisure', 'Utilities'] as const;

const DEMO_LIMITS: Record<string, number> = {
  Housing: 1400,
  Groceries: 600,
  Transport: 250,
  Leisure: 300,
  Utilities: 220,
};

/** Invented, and labelled as such on the screen. */
const DEMO_MONTHLY_INCOME = 4200;

/** Spending per category, this month and the three before it. Invented. */
const DEMO_SPEND: Record<string, [number, number, number, number]> = {
  //          3 back  2 back  1 back   now
  Housing:   [1400,   1400,   1400,   1400],
  Groceries: [ 512,    488,    544,    342],
  Transport: [ 196,    221,    174,    118],
  Leisure:   [ 268,    312,    241,    205],
  Utilities: [ 203,    188,    211,    160],
};

const NOOP = () => {};

const TourDemoScreen: React.FC = () => {
  const scrollRef = useRef<HTMLDivElement>(null);

  const currentMonthKey = getLocalMonthKey(getLocalToday());

  const budgets: BudgetCategory[] = useMemo(
    () =>
      SYSTEM_CATEGORIES.filter((category) =>
        (DEMO_BUDGET_NAMES as readonly string[]).includes(category.name),
      ).map((category) => ({ ...category, totalLimit: DEMO_LIMITS[category.name] })),
    [],
  );

  const transactions: Transaction[] = useMemo(() => {
    const rows: Transaction[] = [];
    budgets.forEach((budget) => {
      const months = DEMO_SPEND[budget.name];
      if (!months) return;
      months.forEach((amount, i) => {
        const monthKey = shiftMonthKey(currentMonthKey, i - (months.length - 1));
        rows.push({
          id: `tour-${budget.name}-${i}`,
          user_id: 'tour',
          vendor: budget.name,
          amount,
          date: `${monthKey}-05`,
          budget_id: budget.id,
          is_projected: false,
          created_at: `${monthKey}-05T12:00:00.000Z`,
        });
      });
    });
    return rows;
  }, [budgets, currentMonthKey]);

  const thisMonthTransactions = useMemo(
    () => transactions.filter((tx) => tx.date.slice(0, 7) === currentMonthKey),
    [transactions, currentMonthKey],
  );

  const remaining = useMemo(
    () =>
      DEMO_MONTHLY_INCOME -
      thisMonthTransactions.reduce((sum, tx) => sum + tx.amount, 0),
    [thisMonthTransactions],
  );

  // The chart is told which theme it is in explicitly, because it draws into
  // an SVG rather than through Tailwind's `dark:` variants. The rest of the
  // screen follows the class on <html> like every other page does.
  const theme =
    typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
      ? 'dark'
      : 'light';

  return (
    // `isolate` is load-bearing: the real bottom bar is `fixed ... z-40`, and
    // without a stacking context here that z-index would compete with the
    // tour's dim (which has none) and paint the nav bar over the top of it,
    // undimmed, on every step.
    <div aria-hidden="true" className="absolute inset-0 isolate pointer-events-none select-none">
      <PageShell>
        <DashboardBalanceSection
          isSharedAccount={false}
          remainingMoney={remaining}
          monthlyIncome={DEMO_MONTHLY_INCOME}
          isIncomeLoaded
          searchQuery=""
          isSearchOpen={false}
          onSearchQueryChange={NOOP}
          onSearchOpenChange={NOOP}
          onOpenSettings={NOOP}
        />

        <div className="flex-1 min-h-0 flex flex-col overflow-hidden lg:px-6">
          {/* Same wrapper, same classes, same `data-tour` anchor as the
              dashboard's own chart slot. */}
          <div
            data-tour="months"
            className="transition-all duration-500 ease-in-out overflow-hidden shrink-0 max-h-[300px] opacity-100 translate-y-0 mb-2 lg:max-h-none lg:mb-3"
          >
            <React.Suspense fallback={<div className="h-full w-full" />}>
              <BudgetFlowChart
                budgets={budgets}
                transactions={transactions}
                monthlyIncome={DEMO_MONTHLY_INCOME}
                theme={theme}
                currentMonthKey={currentMonthKey}
                selectedMonthKey={currentMonthKey}
                onSelectMonth={NOOP}
              />
            </React.Suspense>
          </div>

          <DashboardBudgetSectionsList
            budgets={budgets}
            transactions={thisMonthTransactions}
            isCurrentMonth
            settings={{ useLeisureAsBuffer: false }}
            currentUserName=""
            isSharedAccount={false}
            scrollContainerRef={scrollRef}
            onTransactionTap={NOOP}
          />
        </div>

        <div
          aria-hidden="true"
          className="shrink-0 h-[calc(env(safe-area-inset-bottom,0px)+5rem+0.5rem)]"
        />

        <DashboardBottomBar
          onGoHome={NOOP}
          onAddTransaction={NOOP}
          onOpenParsing={NOOP}
          activeView="home"
          pendingCount={3}
        />
      </PageShell>
    </div>
  );
};

export default TourDemoScreen;
