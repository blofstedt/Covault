import React, { useMemo, useRef } from 'react';
import { Transaction, BudgetCategory } from '../../types';
import PageShell from '../ui/PageShell';
import DashboardBalanceSection from '../dashboard_components/DashboardBalanceSection';
import DashboardBudgetSectionsList from '../dashboard_components/DashboardBudgetSectionsList';
import DashboardBottomBar from '../dashboard_components/DashboardBottomBar';
import { SYSTEM_CATEGORIES } from '../../constants';
import { getLocalMonthKey, getLocalToday } from '../../lib/dateUtils';
import { shiftMonthKey } from '../../lib/monthWindow';
import type { TourStage } from '../../lib/tourSteps';

// Same lazy chunk the dashboard loads d3 through, so the intro does not pull
// the chart into the entry bundle either.
const BudgetFlowChart = React.lazy(() => import('../dashboard_components/BudgetFlowChart'));

/**
 * The dashboard, with example figures in it.
 *
 * Only the intro uses this. Replayed from Settings the walkthrough points at
 * the user's own app directly and drives it (see `GuidedTour`), because by
 * then there is one to point at; during the intro there is not, and a
 * brand-new one is a row of zeroes — a spotlight circling blanks, explaining
 * what would have been there.
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
 * The budget expand the tour describes is the real one too: `stage` opens a
 * vial through the same prop the dashboard uses, so what plays is
 * `BudgetSection`'s own 320ms animation and not an impression of it.
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
 * date through the same window the real rail uses, and no example purchase is
 * dated later than today, since a budget app that is wrong about what day it
 * is has given the game away before it starts.
 */

interface TourDemoScreenProps {
  /** Which stage the walkthrough is on. Only 'budget' changes anything here. */
  stage?: TourStage;
}

/** Enough categories to look like a used dashboard, few enough to stay two-line. */
const DEMO_BUDGET_NAMES = ['Housing', 'Groceries', 'Transport', 'Leisure', 'Utilities'] as const;

const DEMO_LIMITS: Record<string, number> = {
  Housing: 1400,
  Groceries: 600,
  Transport: 250,
  Leisure: 300,
  Utilities: 220,
};

/** Invented, and labelled as such on the tour's caption. */
const DEMO_MONTHLY_INCOME = 4200;

/**
 * This month's example purchases, per category.
 *
 * Named and itemised rather than one lump per category, because the
 * walkthrough opens one of these cards and the list inside it is a step of
 * its own — a card with a single row in it would teach the wrong thing about
 * what opening a vial is for.
 */
const DEMO_THIS_MONTH: Record<string, { vendor: string; amount: number; day: number }[]> = {
  Housing: [{ vendor: 'Rent', amount: 1400, day: 1 }],
  Groceries: [
    { vendor: 'Superstore', amount: 128.45, day: 2 },
    { vendor: 'Costco', amount: 96.2, day: 6 },
    { vendor: 'Safeway', amount: 62.1, day: 11 },
    { vendor: 'No Frills', amount: 55.25, day: 16 },
  ],
  Transport: [
    { vendor: 'Petro-Canada', amount: 71.4, day: 4 },
    { vendor: 'Calgary Transit', amount: 46.6, day: 13 },
  ],
  Leisure: [
    { vendor: 'Netflix', amount: 20.99, day: 3 },
    { vendor: 'Second Cup', amount: 9.51, day: 8 },
    { vendor: 'Cineplex', amount: 38.5, day: 12 },
    { vendor: 'Kinton Ramen', amount: 136.0, day: 18 },
  ],
  Utilities: [
    { vendor: 'Enmax', amount: 92.0, day: 5 },
    { vendor: 'Telus', amount: 68.0, day: 15 },
  ],
};

/** What the three months before this one spent, per category. Chart only. */
const DEMO_HISTORY: Record<string, [number, number, number]> = {
  Housing: [1400, 1400, 1400],
  Groceries: [512, 488, 544],
  Transport: [196, 221, 174],
  Leisure: [268, 312, 241],
  Utilities: [203, 188, 211],
};

const NOOP = () => {};
const NO_EXPANDED: Set<string> = new Set();

const TourDemoScreen: React.FC<TourDemoScreenProps> = ({ stage = 'home' }) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  const today = getLocalToday();
  const currentMonthKey = getLocalMonthKey(today);
  const todayDay = Number(today.slice(8, 10)) || 1;

  const budgets: BudgetCategory[] = useMemo(
    () =>
      SYSTEM_CATEGORIES.filter((category) =>
        (DEMO_BUDGET_NAMES as readonly string[]).includes(category.name),
      ).map((category) => ({ ...category, totalLimit: DEMO_LIMITS[category.name] })),
    [],
  );

  const thisMonthTransactions: Transaction[] = useMemo(() => {
    const rows: Transaction[] = [];
    budgets.forEach((budget) => {
      (DEMO_THIS_MONTH[budget.name] ?? []).forEach((entry, i) => {
        // Never later than today: an example screen dated into the future is
        // the one mistake a budget app cannot make quietly.
        const day = String(Math.min(entry.day, todayDay)).padStart(2, '0');
        rows.push({
          id: `tour-${budget.name}-${i}`,
          user_id: 'tour',
          vendor: entry.vendor,
          amount: entry.amount,
          date: `${currentMonthKey}-${day}`,
          budget_id: budget.id,
          label: 'Automatic',
          is_projected: false,
          created_at: `${currentMonthKey}-${day}T12:00:00.000Z`,
        });
      });
    });
    return rows;
  }, [budgets, currentMonthKey, todayDay]);

  // The chart reads this month plus the three before it; the earlier months
  // are one row each, since nothing ever opens them.
  const chartTransactions: Transaction[] = useMemo(() => {
    const rows: Transaction[] = [...thisMonthTransactions];
    budgets.forEach((budget) => {
      (DEMO_HISTORY[budget.name] ?? []).forEach((amount, i) => {
        const monthKey = shiftMonthKey(currentMonthKey, i - 3);
        rows.push({
          id: `tour-history-${budget.name}-${i}`,
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
  }, [thisMonthTransactions, budgets, currentMonthKey]);

  const remaining = useMemo(
    () =>
      DEMO_MONTHLY_INCOME - thisMonthTransactions.reduce((sum, tx) => sum + tx.amount, 0),
    [thisMonthTransactions],
  );

  // The vial the walkthrough opens. Groceries: it has the most rows, so the
  // list inside it has something to say. Driven through the dashboard's own
  // prop, so the animation is the dashboard's own.
  const expandedBudgets = useMemo(() => {
    if (stage !== 'budget') return NO_EXPANDED;
    const groceries = budgets.find((budget) => budget.name === 'Groceries') ?? budgets[0];
    return groceries ? new Set([groceries.id]) : NO_EXPANDED;
  }, [stage, budgets]);

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
                transactions={chartTransactions}
                monthlyIncome={DEMO_MONTHLY_INCOME}
                theme={theme}
                highlightedBudgetId={
                  expandedBudgets.size > 0 ? Array.from(expandedBudgets)[0] : null
                }
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
            expandedBudgets={expandedBudgets}
            settings={{ useLeisureAsBuffer: false }}
            currentUserName=""
            isSharedAccount={false}
            scrollContainerRef={scrollRef}
            onToggleExpand={NOOP}
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
