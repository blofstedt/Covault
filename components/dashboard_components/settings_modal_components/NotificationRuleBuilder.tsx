import React, { useState, useCallback } from 'react';
import type {
  NotificationRule,
  NotificationSubjectType,
  BudgetCondition,
  BudgetThresholdType,
  RecurringTimingCondition,
  RecurringValueCondition,
  BalanceCondition,
  DeliveryMethod,
  BudgetCategory,
  Transaction,
} from '../../../types';

interface NotificationRuleBuilderProps {
  budgets: BudgetCategory[];
  transactions: Transaction[];
  existingRule?: NotificationRule;
  onSave: (rule: NotificationRule) => void;
  onCancel: () => void;
}

const SUBJECT_OPTIONS: { value: NotificationSubjectType; label: string }[] = [
  { value: 'specific_budget', label: 'a specific budget' },
  { value: 'all_budgets', label: 'all budgets' },
  { value: 'specific_recurring', label: 'a recurring transaction' },
  { value: 'all_recurring', label: 'all recurring transactions' },
  { value: 'remaining_balance', label: 'My Remaining Balance' },
];

const BUDGET_CONDITIONS: { value: BudgetCondition; label: string }[] = [
  { value: 'within', label: 'within' },
  { value: 'over', label: 'over' },
  { value: 'under', label: 'under' },
];

const RECURRING_TIMING: { value: RecurringTimingCondition; label: string }[] = [
  { value: 'days_before', label: 'days before due' },
  { value: 'on_due_date', label: 'on the due date' },
  { value: 'if_missed', label: 'if missed' },
];

const RECURRING_VALUE: { value: RecurringValueCondition; label: string }[] = [
  { value: 'is_over', label: 'is over' },
  { value: 'higher_than_last_month', label: 'is higher than last month' },
];

const BALANCE_CONDITIONS: { value: BalanceCondition; label: string }[] = [
  { value: 'falls_below', label: 'falls below' },
  { value: 'is_over', label: 'is over' },
];

const DELIVERY_OPTIONS: { value: DeliveryMethod; label: string }[] = [
  { value: 'push', label: 'Push' },
  { value: 'in_app', label: 'In-App' },
  { value: 'email', label: 'Email' },
];

type ActivePicker =
  | 'subject'
  | 'subject_id'
  | 'budget_condition'
  | 'budget_threshold_type'
  | 'recurring_timing'
  | 'recurring_value'
  | 'balance_condition'
  | null;

const NotificationRuleBuilder: React.FC<NotificationRuleBuilderProps> = ({
  budgets,
  transactions,
  existingRule,
  onSave,
  onCancel,
}) => {
  const [subjectType, setSubjectType] = useState<NotificationSubjectType>(
    existingRule?.subjectType || 'all_budgets',
  );
  const [subjectId, setSubjectId] = useState<string>(existingRule?.subjectId || '');
  const [subjectName, setSubjectName] = useState<string>(existingRule?.subjectName || '');

  // Budget state
  const [budgetCondition, setBudgetCondition] = useState<BudgetCondition>(
    existingRule?.budgetCondition || 'within',
  );
  const [budgetThresholdType, setBudgetThresholdType] = useState<BudgetThresholdType>(
    existingRule?.budgetThresholdType || 'percent',
  );
  const [budgetThresholdValue, setBudgetThresholdValue] = useState<string>(
    existingRule?.budgetThresholdValue?.toString() || '10',
  );

  // Recurring state
  const [recurringTimingCondition, setRecurringTimingCondition] =
    useState<RecurringTimingCondition>(existingRule?.recurringTimingCondition || 'days_before');
  const [recurringTimingDays, setRecurringTimingDays] = useState<string>(
    existingRule?.recurringTimingDays?.toString() || '2',
  );
  const [recurringValueCondition, setRecurringValueCondition] =
    useState<RecurringValueCondition>(existingRule?.recurringValueCondition || 'is_over');
  const [recurringValueAmount, setRecurringValueAmount] = useState<string>(
    existingRule?.recurringValueAmount?.toString() || '100',
  );

  // Balance state
  const [balanceCondition, setBalanceCondition] = useState<BalanceCondition>(
    existingRule?.balanceCondition || 'falls_below',
  );
  const [balanceThresholdValue, setBalanceThresholdValue] = useState<string>(
    existingRule?.balanceThresholdValue?.toString() || '500',
  );

  const [delivery, setDelivery] = useState<DeliveryMethod>(existingRule?.delivery || 'push');
  const [activePicker, setActivePicker] = useState<ActivePicker>(null);

  const recurringTransactions = transactions.filter(
    (tx) => tx.recurrence && tx.recurrence !== 'One-time',
  );

  const togglePicker = useCallback(
    (picker: ActivePicker) => {
      setActivePicker((prev) => (prev === picker ? null : picker));
    },
    [],
  );

  const handleSave = () => {
    const rule: NotificationRule = {
      id: existingRule?.id || crypto.randomUUID(),
      subjectType,
      subjectId: subjectId || undefined,
      subjectName: subjectName || undefined,
      delivery,
      enabled: true,
    };

    if (subjectType === 'specific_budget' || subjectType === 'all_budgets') {
      rule.budgetCondition = budgetCondition;
      rule.budgetThresholdType = budgetThresholdType;
      rule.budgetThresholdValue = parseFloat(budgetThresholdValue) || 0;
    } else if (subjectType === 'specific_recurring' || subjectType === 'all_recurring') {
      rule.recurringTimingCondition = recurringTimingCondition;
      if (recurringTimingCondition === 'days_before') {
        rule.recurringTimingDays = parseInt(recurringTimingDays) || 2;
      }
      rule.recurringValueCondition = recurringValueCondition;
      if (recurringValueCondition === 'is_over') {
        rule.recurringValueAmount = parseFloat(recurringValueAmount) || 0;
      }
    } else if (subjectType === 'remaining_balance') {
      rule.balanceCondition = balanceCondition;
      rule.balanceThresholdValue = parseFloat(balanceThresholdValue) || 0;
    }

    onSave(rule);
  };

  // Underlined tappable variable
  const Variable: React.FC<{
    onClick: () => void;
    active: boolean;
    children: React.ReactNode;
  }> = ({ onClick, active, children }) => (
    <button
      onClick={onClick}
      className={`inline underline decoration-2 underline-offset-4 font-bold transition-colors ${
        active
          ? 'text-emerald-500 decoration-emerald-500'
          : 'text-emerald-600 dark:text-emerald-400 decoration-emerald-400/50 dark:decoration-emerald-500/50'
      }`}
    >
      {children}
    </button>
  );

  // Picker dropdown
  const Picker: React.FC<{
    visible: boolean;
    options: { value: string; label: string }[];
    selected: string;
    onSelect: (value: string) => void;
  }> = ({ visible, options, selected, onSelect }) => {
    if (!visible) return null;
    return (
      <div className="mt-2 mb-1 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-lg overflow-hidden">
        {options.map((opt) => (
          <button
            key={opt.value}
            onClick={() => {
              onSelect(opt.value);
              setActivePicker(null);
            }}
            className={`w-full text-left px-4 py-2.5 text-xs transition-colors ${
              selected === opt.value
                ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 font-bold'
                : 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    );
  };

  const getSubjectLabel = () => {
    return SUBJECT_OPTIONS.find((s) => s.value === subjectType)?.label || subjectType;
  };

  const renderSentence = () => {
    const isBudget = subjectType === 'specific_budget' || subjectType === 'all_budgets';
    const isRecurring = subjectType === 'specific_recurring' || subjectType === 'all_recurring';
    const isBalance = subjectType === 'remaining_balance';

    return (
      <div className="space-y-3">
        {/* Main sentence */}
        <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
          Notify me when{' '}
          <Variable
            onClick={() => togglePicker('subject')}
            active={activePicker === 'subject'}
          >
            {getSubjectLabel()}
          </Variable>
          {/* Subject-specific picker */}
          {(subjectType === 'specific_budget' || subjectType === 'specific_recurring') && (
            <>
              {' '}
              <Variable
                onClick={() => togglePicker('subject_id')}
                active={activePicker === 'subject_id'}
              >
                {subjectName || '(tap to select)'}
              </Variable>
            </>
          )}
          {isBudget && (
            <>
              {' '}is{' '}
              <Variable
                onClick={() => togglePicker('budget_condition')}
                active={activePicker === 'budget_condition'}
              >
                {budgetCondition}
              </Variable>{' '}
              <span className="inline-flex items-center gap-1">
                <input
                  type="number"
                  value={budgetThresholdValue}
                  onChange={(e) => setBudgetThresholdValue(e.target.value)}
                  className="w-14 px-1.5 py-0.5 text-sm font-bold text-center bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-700 rounded-lg text-emerald-600 dark:text-emerald-400 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
                <Variable
                  onClick={() => togglePicker('budget_threshold_type')}
                  active={activePicker === 'budget_threshold_type'}
                >
                  {budgetThresholdType === 'percent' ? '%' : '$'}
                </Variable>
              </span>{' '}
              of its limit.
            </>
          )}
          {isRecurring && (
            <>
              {' '}
              {recurringTimingCondition === 'days_before' && (
                <span className="inline-flex items-center gap-1">
                  <input
                    type="number"
                    value={recurringTimingDays}
                    onChange={(e) => setRecurringTimingDays(e.target.value)}
                    className="w-10 px-1 py-0.5 text-sm font-bold text-center bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-700 rounded-lg text-emerald-600 dark:text-emerald-400 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                    min={1}
                  />
                </span>
              )}{' '}
              <Variable
                onClick={() => togglePicker('recurring_timing')}
                active={activePicker === 'recurring_timing'}
              >
                {RECURRING_TIMING.find((t) => t.value === recurringTimingCondition)?.label}
              </Variable>
              {' '}if the amount{' '}
              <Variable
                onClick={() => togglePicker('recurring_value')}
                active={activePicker === 'recurring_value'}
              >
                {RECURRING_VALUE.find((v) => v.value === recurringValueCondition)?.label}
              </Variable>
              {recurringValueCondition === 'is_over' && (
                <>
                  {' '}
                  <span className="inline-flex items-center gap-0.5">
                    $
                    <input
                      type="number"
                      value={recurringValueAmount}
                      onChange={(e) => setRecurringValueAmount(e.target.value)}
                      className="w-16 px-1.5 py-0.5 text-sm font-bold text-center bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-700 rounded-lg text-emerald-600 dark:text-emerald-400 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                    />
                  </span>
                </>
              )}.
            </>
          )}
          {isBalance && (
            <>
              {' '}
              <Variable
                onClick={() => togglePicker('balance_condition')}
                active={activePicker === 'balance_condition'}
              >
                {BALANCE_CONDITIONS.find((c) => c.value === balanceCondition)?.label}
              </Variable>{' '}
              <span className="inline-flex items-center gap-0.5">
                $
                <input
                  type="number"
                  value={balanceThresholdValue}
                  onChange={(e) => setBalanceThresholdValue(e.target.value)}
                  className="w-16 px-1.5 py-0.5 text-sm font-bold text-center bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-700 rounded-lg text-emerald-600 dark:text-emerald-400 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
              </span>.
            </>
          )}
        </p>

        {/* Pickers */}
        <Picker
          visible={activePicker === 'subject'}
          options={SUBJECT_OPTIONS.map((s) => ({ value: s.value, label: s.label }))}
          selected={subjectType}
          onSelect={(v) => {
            setSubjectType(v as NotificationSubjectType);
            setSubjectId('');
            setSubjectName('');
          }}
        />
        {subjectType === 'specific_budget' && (
          <Picker
            visible={activePicker === 'subject_id'}
            options={budgets.map((b) => ({ value: b.id, label: b.name }))}
            selected={subjectId}
            onSelect={(v) => {
              setSubjectId(v);
              setSubjectName(budgets.find((b) => b.id === v)?.name || '');
            }}
          />
        )}
        {subjectType === 'specific_recurring' && (
          <Picker
            visible={activePicker === 'subject_id'}
            options={recurringTransactions.map((tx) => ({
              value: tx.id,
              label: `${tx.vendor} ($${tx.amount})`,
            }))}
            selected={subjectId}
            onSelect={(v) => {
              setSubjectId(v);
              const tx = recurringTransactions.find((t) => t.id === v);
              setSubjectName(tx ? tx.vendor : '');
            }}
          />
        )}
        <Picker
          visible={activePicker === 'budget_condition'}
          options={BUDGET_CONDITIONS}
          selected={budgetCondition}
          onSelect={(v) => setBudgetCondition(v as BudgetCondition)}
        />
        <Picker
          visible={activePicker === 'budget_threshold_type'}
          options={[
            { value: 'percent', label: '% of Total' },
            { value: 'dollar', label: '$ Amount' },
          ]}
          selected={budgetThresholdType}
          onSelect={(v) => setBudgetThresholdType(v as BudgetThresholdType)}
        />
        <Picker
          visible={activePicker === 'recurring_timing'}
          options={RECURRING_TIMING}
          selected={recurringTimingCondition}
          onSelect={(v) => setRecurringTimingCondition(v as RecurringTimingCondition)}
        />
        <Picker
          visible={activePicker === 'recurring_value'}
          options={RECURRING_VALUE}
          selected={recurringValueCondition}
          onSelect={(v) => setRecurringValueCondition(v as RecurringValueCondition)}
        />
        <Picker
          visible={activePicker === 'balance_condition'}
          options={BALANCE_CONDITIONS}
          selected={balanceCondition}
          onSelect={(v) => setBalanceCondition(v as BalanceCondition)}
        />
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-[120] bg-slate-900/50 backdrop-blur-md flex items-end sm:items-center justify-center animate-in fade-in duration-200">
      <div className="w-full sm:max-w-md bg-white dark:bg-slate-900 rounded-t-[2rem] sm:rounded-[2rem] p-6 shadow-2xl animate-in slide-in-from-bottom-4 duration-300 max-h-[80vh] overflow-y-auto no-scrollbar border border-slate-100 dark:border-slate-800/60">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-[13px] font-black text-slate-700 dark:text-slate-200 uppercase tracking-[0.15em]">
            {existingRule ? 'Edit Rule' : 'New Rule'}
          </h3>
          <button
            onClick={onCancel}
            className="p-1.5 bg-slate-100 dark:bg-slate-800 rounded-full active:scale-90 transition-transform"
          >
            <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Natural language sentence builder */}
        <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-2xl mb-5">
          {renderSentence()}
        </div>

        {/* Delivery method */}
        <div className="mb-5">
          <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider block mb-2">
            Deliver via
          </span>
          <div className="flex gap-2">
            {DELIVERY_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setDelivery(opt.value)}
                className={`flex-1 py-2 rounded-xl text-[11px] font-black uppercase tracking-wider transition-all ${
                  delivery === opt.value
                    ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 border-2 border-emerald-500/30'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 border-2 border-transparent'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 py-3 rounded-2xl text-xs font-black uppercase tracking-wider bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 active:scale-95 transition-all"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="flex-1 py-3 rounded-2xl text-xs font-black uppercase tracking-wider bg-emerald-500 text-white active:scale-95 transition-all shadow-lg shadow-emerald-500/20"
          >
            {existingRule ? 'Update' : 'Save Rule'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default NotificationRuleBuilder;
