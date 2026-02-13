import React, { useState } from 'react';
import type { NotificationRule, BudgetCategory, Transaction } from '../../../types';
import NotificationRuleBuilder from './NotificationRuleBuilder';
import SettingsCard from '../../ui/SettingsCard';
import SectionHeader from '../../ui/SectionHeader';
import ToggleSwitch from '../../ui/ToggleSwitch';
import ConfirmModal from '../../ui/ConfirmModal';

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
  const [deletingRuleId, setDeletingRuleId] = useState<string | null>(null);

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
    setDeletingRuleId(null);
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
      <SettingsCard id="settings-notification-rules-container">
        {/* Header with global toggle */}
        <div className="flex items-center justify-between mb-3">
          <SectionHeader title="Notification Rules" subtitle="Custom alerts in plain English." />
          <ToggleSwitch enabled={enabled} onToggle={() => onToggle(!enabled)} />
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
                      <div className="mt-0.5">
                        <ToggleSwitch enabled={rule.enabled} onToggle={() => handleToggleRule(rule.id)} size="sm" />
                      </div>

                      {/* Rule sentence */}
                      <button
                        onClick={() => handleEditRule(rule)}
                        className="flex-1 text-left"
                      >
                        <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                          {ruleToSentence(rule)}
                        </p>
                        <span className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5 block">
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
                        onClick={() => setDeletingRuleId(rule.id)}
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
              <p className="text-[11px] text-slate-400 dark:text-slate-500 text-center py-3 mb-2">
                No rules yet. Tap + to create one.
              </p>
            )}

            {/* Add Rule button */}
            <button
              onClick={() => {
                setEditingRule(undefined);
                setShowBuilder(true);
              }}
              className="w-full py-3 rounded-2xl border-2 border-dashed border-emerald-300 dark:border-emerald-700 text-emerald-500 dark:text-emerald-400 text-xs font-black uppercase tracking-[0.15em] hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors active:scale-[0.98] flex items-center justify-center gap-1.5"
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
      </SettingsCard>
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

      {/* Delete confirmation modal */}
      {deletingRuleId && (
        <ConfirmModal
          title="Delete Rule?"
          message="This will permanently remove this notification rule."
          confirmLabel="Confirm Delete"
          variant="danger"
          onConfirm={() => handleDeleteRule(deletingRuleId)}
          onCancel={() => setDeletingRuleId(null)}
        />
      )}
    </>
  );
};

export default NotificationRulesSection;
