import React, { useState, useEffect, useCallback } from 'react';

// ── Local storage persistence ──────────────────────────────────────
const SAVINGS_KEY = 'covault_savings_goal';

interface SavingsGoalData {
  name: string;
  target: number;
  accumulated: number; // sum of monthly contributions
}

function loadGoal(): SavingsGoalData | null {
  try {
    const raw = localStorage.getItem(SAVINGS_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return null;
}

function saveGoal(goal: SavingsGoalData | null): void {
  if (goal) {
    localStorage.setItem(SAVINGS_KEY, JSON.stringify(goal));
  } else {
    localStorage.removeItem(SAVINGS_KEY);
  }
}

// ── Track which months have been "banked" ───────────────────────
const BANKED_KEY = 'covault_savings_banked_months';

function getBankedMonths(): Set<string> {
  try {
    const raw = localStorage.getItem(BANKED_KEY);
    if (raw) return new Set(JSON.parse(raw));
  } catch { /* ignore */ }
  return new Set();
}

function markMonthBanked(monthKey: string, amount: number): void {
  const months = getBankedMonths();
  months.add(monthKey);
  localStorage.setItem(BANKED_KEY, JSON.stringify([...months]));

  // Add to accumulated total
  const goal = loadGoal();
  if (goal) {
    goal.accumulated = (goal.accumulated || 0) + amount;
    saveGoal(goal);
  }
}

// ── Component ───────────────────────────────────────────────────

interface SavingsGoalBarProps {
  monthlyIncome: number;
  totalSpent: number;
  totalProjected: number;
}

const SavingsGoalBar: React.FC<SavingsGoalBarProps> = ({
  monthlyIncome,
  totalSpent,
  totalProjected,
}) => {
  const [goal, setGoal] = useState<SavingsGoalData | null>(loadGoal);
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editTarget, setEditTarget] = useState('');

  // Current month savings = Income - Spent - Projected remaining
  const monthlySavings = Math.max(0, monthlyIncome - totalSpent - totalProjected);

  // Snapshot this month's savings so we can bank it accurately on rollover
  const SNAPSHOT_KEY = 'covault_savings_snapshot';
  useEffect(() => {
    if (!goal) return;
    const now = new Date();
    const curKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    // Keep a running snapshot of the current month's savings
    try {
      localStorage.setItem(SNAPSHOT_KEY, JSON.stringify({ month: curKey, amount: monthlySavings }));
    } catch { /* ignore */ }
  }, [goal, monthlySavings]);

  // Bank previous month's savings on month rollover
  useEffect(() => {
    if (!goal) return;
    const now = new Date();
    const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevKey = `${prevMonth.getFullYear()}-${String(prevMonth.getMonth() + 1).padStart(2, '0')}`;
    const banked = getBankedMonths();

    if (!banked.has(prevKey)) {
      // Retrieve the snapshot from last month (written while we were still in that month)
      let bankedAmount = 0;
      try {
        const raw = localStorage.getItem(SNAPSHOT_KEY);
        if (raw) {
          const snapshot = JSON.parse(raw);
          if (snapshot.month === prevKey && typeof snapshot.amount === 'number') {
            bankedAmount = snapshot.amount;
          }
        }
      } catch { /* ignore */ }

      if (bankedAmount > 0) {
        markMonthBanked(prevKey, bankedAmount);
        setGoal(loadGoal());
      }
    }
  }, [goal]);
  const totalSaved = (goal?.accumulated || 0) + monthlySavings;
  const progress = goal && goal.target > 0 ? Math.min(1, totalSaved / goal.target) : 0;

  const handleSave = useCallback(() => {
    const target = parseFloat(editTarget);
    if (!editName.trim() || isNaN(target) || target <= 0) return;

    const newGoal: SavingsGoalData = {
      name: editName.trim(),
      target,
      accumulated: goal?.accumulated || 0,
    };
    saveGoal(newGoal);
    setGoal(newGoal);
    setIsEditing(false);
  }, [editName, editTarget, goal?.accumulated]);

  const handleDelete = useCallback(() => {
    saveGoal(null);
    localStorage.removeItem(BANKED_KEY);
    setGoal(null);
    setIsEditing(false);
  }, []);

  // No goal set — show small "Set a goal" button
  if (!goal && !isEditing) {
    return (
      <button
        onClick={() => {
          setEditName('');
          setEditTarget('');
          setIsEditing(true);
        }}
        className="w-full py-2.5 text-[10px] font-semibold tracking-wide text-slate-400 dark:text-slate-500 hover:text-emerald-500 transition-colors"
      >
        + Set Savings Goal
      </button>
    );
  }

  // Editing mode
  if (isEditing) {
    return (
      <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-3xl border border-slate-100 dark:border-slate-800/60 space-y-3">
        <p className="text-[10px] font-semibold tracking-wide text-slate-400 dark:text-slate-500">
          Savings Goal
        </p>
        <input
          type="text"
          placeholder="Goal name (e.g. Vacation)"
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          className="w-full px-3 py-2.5 text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-700 dark:text-slate-200 placeholder:text-slate-300 dark:placeholder:text-slate-600"
        />
        <input
          type="number"
          placeholder="Target amount ($)"
          value={editTarget}
          onChange={(e) => setEditTarget(e.target.value)}
          className="w-full px-3 py-2.5 text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-700 dark:text-slate-200 placeholder:text-slate-300 dark:placeholder:text-slate-600"
          min="1"
          step="1"
        />
        <div className="flex gap-2">
          <button
            onClick={handleSave}
            className="flex-1 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-2xl text-xs font-semibold tracking-wide active:scale-[0.97] transition-all duration-200"
          >
            Save
          </button>
          <button
            onClick={() => setIsEditing(false)}
            className="flex-1 py-2.5 bg-slate-100 dark:bg-slate-800 text-slate-500 rounded-2xl text-xs font-semibold tracking-wide active:scale-[0.97] transition-all duration-200"
          >
            Cancel
          </button>
        </div>
        {goal && (
          <button
            onClick={handleDelete}
            className="w-full py-2 text-[10px] font-semibold tracking-wide text-rose-400 hover:text-rose-500 transition-colors"
          >
            Remove Goal
          </button>
        )}
      </div>
    );
  }

  // Display mode — compact bar
  return (
    <button
      onClick={() => {
        setEditName(goal!.name);
        setEditTarget(String(goal!.target));
        setIsEditing(true);
      }}
      className="w-full text-left active:scale-[0.98] transition-transform"
    >
      <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-3xl border border-emerald-200 dark:border-emerald-800/40 space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-semibold tracking-wide text-emerald-600 dark:text-emerald-400">
            🎯 {goal!.name}
          </p>
          <p className="text-[10px] font-black text-slate-400 dark:text-slate-500">
            ${totalSaved.toFixed(0)} / ${goal!.target.toFixed(0)}
          </p>
        </div>

        {/* Progress bar */}
        <div className="relative h-3 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
          <div
            className="absolute inset-y-0 left-0 bg-emerald-500 rounded-full transition-all duration-700 ease-out"
            style={{ width: `${Math.round(progress * 100)}%` }}
          />
        </div>

        <p className="text-[9px] font-medium text-slate-400 dark:text-slate-500">
          {Math.round(progress * 100)}% complete • ${monthlySavings.toFixed(0)} saved this month
        </p>
      </div>
    </button>
  );
};

export default SavingsGoalBar;
