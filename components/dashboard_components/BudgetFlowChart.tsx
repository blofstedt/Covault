import React from 'react';
import { BudgetCategory, Transaction } from '../../types';

interface BudgetFlowChartProps {
  budgets: BudgetCategory[];
  transactions: Transaction[];
}

// Simple helper to get a color per budget name (same palette as before)
const getBudgetColor = (budgetName: string) => {
  const palette = [
    'rgb(16, 185, 129)',  // emerald
    'rgb(52, 211, 153)',  // light emerald
    'rgb(148, 163, 184)', // slate
  ];
  const index =
    Math.abs(budgetName.toLowerCase().split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0)) %
    palette.length;
  return palette[index];
};

const BudgetFlowChart: React.FC<BudgetFlowChartProps> = ({
  budgets,
  transactions,
}) => {
  // ✅ Make sure we always have arrays (even if parent passes undefined/null)
  const safeBudgets = Array.isArray(budgets) ? budgets : [];
  const safeTransactions = Array.isArray(transactions) ? transactions : [];

  // We’ll do all work in a try/catch so NOTHING here can crash React
  let content: React.ReactNode = null;

  try {
    // Build a simple summary of ACTUAL (non-projected) spending by category for the current month
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth(); // 0–11

    const spendingByCategory = new Map<string, number>();
    let total = 0;

    for (const tx of safeTransactions) {
      const anyTx = tx as any;

      // Skip projected transactions
      if (anyTx.is_projected) continue;

      const rawDate = anyTx.date;
      const date = rawDate ? new Date(rawDate) : null;
      if (!date || isNaN(date.getTime())) continue;

      if (date.getFullYear() !== currentYear || date.getMonth() !== currentMonth) {
        continue; // not in current month
      }

      const categoryId = anyTx.category_id;
      if (!categoryId) continue;

      const amount = Number(anyTx.amount) || 0;
      if (amount === 0) continue;

      const current = spendingByCategory.get(categoryId) || 0;
      spendingByCategory.set(categoryId, current + amount);
      total += amount;
    }

    if (total === 0 || spendingByCategory.size === 0) {
      content = (
        <div className="text-center py-8">
          <p className="text-sm font-bold text-slate-500 dark:text-slate-400 mb-2">
            No spending yet this month
          </p>
          <p className="text-xs text-slate-400 dark:text-slate-500">
            Once you add transactions, your monthly spending summary will appear here.
          </p>
        </div>
      );
    } else {
      // Map category_id → name for display
      const nameById = new Map<string, string>();
      safeBudgets.forEach((b) => {
        (nameById as any).set((b as any).id, (b as any).name);
      });

      const rows = Array.from(spendingByCategory.entries())
        .map(([categoryId, amount]) => {
          const name = nameById.get(categoryId) || 'Uncategorized';
          return { categoryId, name, amount };
        })
        .sort((a, b) => b.amount - a.amount); // biggest spend first

      content = (
        <>
          {/* Simple list + progress bars */}
          <div className="space-y-3">
            {rows.map((row) => {
              const share = total > 0 ? (row.amount / total) * 100 : 0;
              return (
                <div key={row.categoryId} className="space-y-1">
                  <div className="flex justify-between items-baseline">
                    <span className="text-[11px] font-bold text-slate-600 dark:text-slate-300">
                      {row.name}
                    </span>
                    <span className="text-[11px] font-bold text-slate-700 dark:text-slate-100">
                      ${row.amount.toFixed(0)}
                    </span>
                  </div>
                  <div className="w-full h-2.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${share}%`,
                        backgroundColor: getBudgetColor(row.name),
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Total footer */}
          <div className="mt-4 pt-3 border-t-2 border-slate-100 dark:border-slate-800 flex justify-between items-center">
            <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">
              Total This Month
            </span>
            <span className="text-sm font-black text-slate-700 dark:text-slate-100">
              ${total.toFixed(0)}
            </span>
          </div>
        </>
      );
    }
  } catch (err) {
    console.error('[BudgetFlowChart] Failed to render chart:', err);
    content = (
      <div className="text-center py-8">
        <p className="text-sm font-bold text-red-500">
          Spending chart unavailable
        </p>
        <p className="text-xs text-slate-400 dark:text-slate-500">
          Something went wrong while rendering the chart. Please try again later.
        </p>
      </div>
    );
  }

  return (
    <div className="w-full mb-4">
      <div className="bg-white/70 dark:bg-slate-900/70 backdrop-blur-md rounded-3xl p-4 border-2 border-slate-100 dark:border-slate-800 shadow-lg">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">
            Spending Overview
          </h3>
        </div>

        {content}
      </div>
    </div>
  );
};

export default BudgetFlowChart;
