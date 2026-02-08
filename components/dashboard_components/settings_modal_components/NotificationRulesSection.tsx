import React, { useState } from 'react';
import type { NotificationRule, BudgetCategory, Transaction } from '../../../types';
import NotificationRuleBuilder from './NotificationRuleBuilder';

interface NotificationRulesSectionProps {
  enabled: boolean;
  onToggle: (v: boolean) => void;
  rules: NotificationRule[];
  onUpdateRules: (rules: NotificationRule[]) => void;
  budgets: BudgetCategory[];
  transactions: Transaction[];
}

/** Build a human-readable sentence from a NotificationRule */
function ruleToSentence(rule: NotificationRule): string {
  const { subjectType, subjectName } = rule;

  let subject = '';
  switch (subjectType) {
    case 'specific_budget':
      subject = subjectName || 'a budget';
      break;
    case 'all_budgets':
      subject = 'any budget';
      break;
    case 'specific_recurring':
      subject = subjectName || 'a recurring transaction';
      break;
    case 'all_recurring':
      subject = 'any recurring transaction';
      break;
    case 'remaining_balance':
      subject = 'My Remaining Balance';
      break;
  }

  if (subjectType === 'specific_budget' || subjectType === 'all_budgets') {
    const cond = rule.budgetCondition || 'within';
    const val = rule.budgetThresholdValue ?? 0;
    const unit = rule.budgetThresholdType === 'dollar' ? `$${val}` : `${val}%`;
    return `Notify me when ${subject} is ${cond} ${unit} of its limit.`;
  }

  if (subjectType === 'specific_recurring' || subjectType === 'all_recurring') {
    let timing = '';
    if (rule.recurringTimingCondition === 'days_before') {
      timing = `${rule.recurringTimingDays || 2} days before due`;
    } else if (rule.recurringTimingCondition === 'on_due_date') {
      timing = 'on the due date';
    } else {
      timing = 'if missed';
    }

    let valueStr = '';
    if (rule.recurringValueCondition === 'is_over') {
      valueStr = `the amount is over $${rule.recurringValueAmount || 0}`;
    } else {
      valueStr = 'the amount is higher than last month';
    }

    return `Notify me ${timing} for ${subject} if ${valueStr}.`;
  }

  if (subjectType === 'remaining_balance') {
    const cond = rule.balanceCondition === 'is_over' ? 'is over' : 'falls below';
    return `Notify me when ${subject} ${cond} $${rule.balanceThresholdValue ?? 0}.`;
  }

  return 'Custom notification rule';
}

const NotificationRulesSection: React.FC<NotificationRulesSectionProps> = ({
  enabled,
  onToggle,
  rules,
  onUpdateRules,
  budgets,
  transactions,
}) => {
  const [showBuilder, setShowBuilder] = useState(false);
  const [editingRule, setEditingRule] = useState<NotificationRule | undefined>(undefined);

  const handleAddRule = (rule: NotificationRule) => {
    if (editingRule) {
      onUpdateRules(rules.map((r) => (r.id === rule.id ? rule : r)));
    } else {
      onUpdateRules([...rules, rule]);
    }
    setShowBuilder(false);
    setEditingRule(undefined);
  };

  const handleDeleteRule = (ruleId: string) => {
    onUpdateRules(rules.filter((r) => r.id !== ruleId));
  };

  const handleToggleRule = (ruleId: string) => {
    onUpdateRules(
      rules.map((r) => (r.id === ruleId ? { ...r, enabled: !r.enabled } : r)),
    );
  };

  const handleEditRule = (rule: NotificationRule) => {
    setEditingRule(rule);
    setShowBuilder(true);
  };

  const deliveryIcon = (method: string) => {
    switch (method) {
      case 'push':
        return '🔔';
      case 'email':
        return '✉️';
      case 'in_app':
        return '📱';
      default:
        return '🔔';
    }
  };

  return (
    <>
      <div className="p-5 bg-slate-50 dark:bg-slate-800/50 rounded-3xl border border-slate-100 dark:border-slate-800/60">
        {/* Header with global toggle */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex flex-col">
            <span className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
              Notification Rules
            </span>
            <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5 leading-relaxed">
              Custom alerts in plain English.
            </p>
          </div>
          <button
            onClick={() => onToggle(!enabled)}
            className={`relative w-12 h-7 rounded-full transition-colors duration-200 flex-shrink-0 ${
              enabled ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full shadow transition-transform duration-200 ${
                enabled ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>

        {enabled && (
          <>
            {/* Rules list */}
            {rules.length > 0 && (
              <div className="space-y-2 mb-3">
                {rules.map((rule) => (
                  <div
                    key={rule.id}
                    className={`p-3 rounded-2xl border transition-all ${
                      rule.enabled
                        ? 'bg-white dark:bg-slate-800/60 border-slate-100 dark:border-slate-700/50'
                        : 'bg-slate-100/50 dark:bg-slate-800/30 border-slate-100/50 dark:border-slate-700/30 opacity-60'
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      {/* Rule toggle */}
                      <button
                        onClick={() => handleToggleRule(rule.id)}
                        className={`mt-0.5 w-8 h-5 rounded-full transition-colors duration-200 flex-shrink-0 ${
                          rule.enabled
                            ? 'bg-emerald-500'
                            : 'bg-slate-300 dark:bg-slate-600'
                        }`}
                      >
                        <span
                          className={`block w-4 h-4 mt-0.5 ml-0.5 bg-white rounded-full shadow transition-transform duration-200 ${
                            rule.enabled ? 'translate-x-3' : 'translate-x-0'
                          }`}
                        />
                      </button>

                      {/* Rule sentence */}
                      <button
                        onClick={() => handleEditRule(rule)}
                        className="flex-1 text-left"
                      >
                        <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">
                          {ruleToSentence(rule)}
                        </p>
                        <span className="text-[9px] text-slate-400 dark:text-slate-500 mt-0.5 block">
                          {deliveryIcon(rule.delivery)}{' '}
                          {rule.delivery === 'push'
                            ? 'Push'
                            : rule.delivery === 'email'
                              ? 'Email'
                              : 'In-App'}
                        </span>
                      </button>

                      {/* Delete */}
                      <button
                        onClick={() => handleDeleteRule(rule.id)}
                        className="p-1 text-slate-300 dark:text-slate-600 hover:text-rose-400 transition-colors flex-shrink-0"
                      >
                        <svg
                          className="w-3.5 h-3.5"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2.5}
                            d="M6 18L18 6M6 6l12 12"
                          />
                        </svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {rules.length === 0 && (
              <p className="text-[10px] text-slate-400 dark:text-slate-500 text-center py-3 mb-2">
                No rules yet. Tap + to create one.
              </p>
            )}

            {/* Add Rule button */}
            <button
              onClick={() => {
                setEditingRule(undefined);
                setShowBuilder(true);
              }}
              className="w-full py-3 rounded-2xl border-2 border-dashed border-emerald-300 dark:border-emerald-700 text-emerald-500 dark:text-emerald-400 text-[11px] font-black uppercase tracking-[0.15em] hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors active:scale-[0.98] flex items-center justify-center gap-1.5"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                strokeWidth={3}
                strokeLinecap="round"
              >
                <path d="M12 5v14M5 12h14" />
              </svg>
              Add Rule
            </button>
          </>
        )}
      </div>

      {/* Rule builder modal */}
      {showBuilder && (
        <NotificationRuleBuilder
          budgets={budgets}
          transactions={transactions}
          existingRule={editingRule}
          onSave={handleAddRule}
          onCancel={() => {
            setShowBuilder(false);
            setEditingRule(undefined);
          }}
        />
      )}
    </>
  );
};

export default NotificationRulesSection;
