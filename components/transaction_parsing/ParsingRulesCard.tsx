import React from 'react';
import { type NotificationRuleRow } from '../../lib/notificationProcessor';
import ParsingCard from '../ui/ParsingCard';

interface ParsingRulesCardProps {
  savedRules: NotificationRuleRow[];
  rulesByBank: Map<string, NotificationRuleRow[]>;
  showDemoData: boolean;
  addingRuleForBank: string | null;
  newRuleType: string;
  keywordEditRuleId: string | null;
  onlyParseText: string;
  keywordMode: 'all' | 'some' | 'one';
  savingKeywords: boolean;
  onStartAddRuleForBank: (bankAppId: string) => void;
  onSetAddingRuleForBank: (bankAppId: string | null) => void;
  onSetNewRuleType: (value: string) => void;
  onConfirmNewRuleType: (bankAppId: string) => void;
  onEditRule: (rule: NotificationRuleRow) => void;
  onOpenKeywordEdit: (rule: NotificationRuleRow) => void;
  onSetKeywordEditRuleId: (id: string | null) => void;
  onSetOnlyParseText: (text: string) => void;
  onSetKeywordMode: (mode: 'all' | 'some' | 'one') => void;
  onSaveKeywords: (ruleId: string) => void;
}

const ParsingRulesCard: React.FC<ParsingRulesCardProps> = ({
  savedRules,
  rulesByBank,
  showDemoData,
  addingRuleForBank,
  newRuleType,
  keywordEditRuleId,
  onlyParseText,
  keywordMode,
  savingKeywords,
  onStartAddRuleForBank,
  onSetAddingRuleForBank,
  onSetNewRuleType,
  onConfirmNewRuleType,
  onEditRule,
  onOpenKeywordEdit,
  onSetKeywordEditRuleId,
  onSetOnlyParseText,
  onSetKeywordMode,
  onSaveKeywords,
}) => {
  if (savedRules.length === 0 && !showDemoData) return null;

  return (
    <ParsingCard
      id="parsing-rules-section"
      colorScheme="emerald"
      icon={<><polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" /></>}
      title="Parsing Rules"
      subtitle="How Covault reads transactions from each bank"
      count={showDemoData && savedRules.length === 0 ? 1 : savedRules.length}
      className="space-y-3"
    >
      {savedRules.length > 0 ? (
        <>
          {Array.from(rulesByBank.entries()).map(([bankAppId, bankRules]) => (
            <div key={bankAppId} className="space-y-2">
              <div className="flex items-center justify-between px-1">
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                  {bankRules[0].bank_name}
                  {bankRules.length > 1 && (
                    <span className="ml-1 text-emerald-500">
                      — {bankRules.length} rules
                    </span>
                  )}
                </p>
                <button
                  onClick={() => onStartAddRuleForBank(bankAppId)}
                  className="text-[11px] font-black uppercase tracking-wider text-emerald-600 dark:text-emerald-400 px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800/30 transition-all active:scale-95"
                >
                  + Add Rule
                </button>
              </div>

              {/* Add new rule type input */}
              {addingRuleForBank === bankAppId && (
                <div className="p-3 bg-emerald-50 dark:bg-emerald-900/10 rounded-2xl border border-emerald-200 dark:border-emerald-800/30 space-y-2">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    New Notification Type
                  </p>
                  <p className="text-[11px] text-slate-400 dark:text-slate-500 leading-relaxed">
                    Add a label for this notification type (e.g. "Purchase", "Transfer", "Payment")
                  </p>
                  <input
                    type="text"
                    value={newRuleType}
                    onChange={(e) => onSetNewRuleType(e.target.value)}
                    placeholder="e.g. Purchase, Transfer..."
                    className="w-full px-3 py-2 text-[11px] rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-400/50"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => onSetAddingRuleForBank(null)}
                      className="flex-1 py-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500 bg-slate-100 dark:bg-slate-800 rounded-xl transition-all active:scale-[0.98]"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => onConfirmNewRuleType(bankAppId)}
                      disabled={!newRuleType.trim()}
                      className="flex-1 py-1.5 text-[11px] font-bold uppercase tracking-wider text-white bg-emerald-500 disabled:bg-slate-300 dark:disabled:bg-slate-700 rounded-xl transition-all active:scale-[0.98]"
                    >
                      Set Up Regex
                    </button>
                  </div>
                </div>
              )}

              {bankRules.map((rule) => {
                const effectiveOnlyParse = rule.only_parse || (rule.filter_keywords || []).join(', ');
                return (
                <div key={rule.id} className="bg-emerald-50 dark:bg-emerald-900/10 rounded-2xl border border-emerald-100 dark:border-emerald-800/30 overflow-hidden">
                  <button
                    onClick={() => onEditRule(rule)}
                    className="w-full flex items-center justify-between p-3 transition-all active:scale-[0.98]"
                  >
                    <div className="flex items-center space-x-3">
                      <div className="w-8 h-8 bg-emerald-100 dark:bg-emerald-900/30 rounded-full flex items-center justify-center shrink-0">
                        <svg className="w-4 h-4 text-emerald-600 dark:text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      </div>
                      <div className="min-w-0 text-left">
                        {rule.notification_type && rule.notification_type !== 'default' && (
                          <p className="text-[11px] font-black uppercase tracking-wider text-emerald-600 dark:text-emerald-400 mb-0.5">
                            {rule.notification_type}
                          </p>
                        )}
                        <p className="text-[11px] text-slate-400 dark:text-slate-500 font-mono truncate max-w-[200px]">
                          vendor: /{rule.vendor_regex}/
                        </p>
                        <p className="text-[11px] text-slate-400 dark:text-slate-500 font-mono truncate max-w-[200px]">
                          amount: /{rule.amount_regex}/
                        </p>
                      </div>
                    </div>
                    <svg className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </button>

                  {/* Only Parse (keyword filter) section */}
                  <div className="px-3 pb-3 border-t border-emerald-100 dark:border-emerald-800/30 pt-2">
                    <button
                      onClick={() => keywordEditRuleId === rule.id ? onSetKeywordEditRuleId(null) : onOpenKeywordEdit(rule)}
                      className="w-full flex items-center justify-between py-1"
                      aria-label="Edit keyword filters"
                    >
                      <div className="flex items-center gap-1">
                        <span className="text-[11px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
                          Only Parse…
                        </span>
                        <svg className="w-3 h-3 text-emerald-500 dark:text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                          <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                          <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                        </svg>
                      </div>
                      <svg className={`w-3 h-3 text-slate-400 transition-transform ${keywordEditRuleId === rule.id ? 'rotate-90' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                    </button>

                    {/* Show saved keywords summary when editor is closed */}
                    {keywordEditRuleId !== rule.id && effectiveOnlyParse && effectiveOnlyParse.trim() && (
                      <p className="text-[11px] text-slate-400 dark:text-slate-500 font-mono truncate mt-0.5 px-1">
                        {effectiveOnlyParse}
                      </p>
                    )}

                    {keywordEditRuleId === rule.id && (
                      <div className="mt-2 space-y-2">
                        <p className="text-[11px] text-slate-400 dark:text-slate-500 leading-relaxed">
                          Only parse notifications that contain these keywords. Others will be ignored.
                        </p>

                        {/* Filter mode selector */}
                        <div className="flex items-center gap-1 flex-wrap">
                          <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400">Must contain</span>
                          {(['all', 'some', 'one'] as const).map((mode) => (
                            <button
                              key={mode}
                              onClick={() => onSetKeywordMode(mode)}
                              className={`px-2 py-0.5 text-[11px] font-bold rounded-full border transition-all active:scale-95 ${
                                keywordMode === mode
                                  ? 'bg-emerald-500 text-white border-emerald-600'
                                  : 'bg-slate-100 dark:bg-slate-800 text-slate-400 border-slate-200 dark:border-slate-700'
                              }`}
                            >
                              {mode}
                            </button>
                          ))}
                          <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400">of the words</span>
                        </div>

                        {/* Only Parse text input */}
                        <div>
                          <input
                            type="text"
                            value={onlyParseText}
                            onChange={(e) => onSetOnlyParseText(e.target.value)}
                            placeholder="e.g. debit, purchase, withdrawal"
                            className="w-full px-2 py-1.5 text-[10px] rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-emerald-400/50"
                          />
                          <p className="text-[7px] text-slate-400 dark:text-slate-500 mt-1">
                            Separate keywords with commas
                          </p>
                        </div>

                        {/* Save/Cancel buttons */}
                        <div className="flex gap-2 pt-1">
                          <button
                            onClick={() => onSetKeywordEditRuleId(null)}
                            className="flex-1 py-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500 bg-slate-100 dark:bg-slate-800 rounded-xl transition-all active:scale-[0.98]"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={() => onSaveKeywords(rule.id)}
                            disabled={savingKeywords}
                            className="flex-1 py-1.5 text-[11px] font-bold uppercase tracking-wider text-white bg-emerald-500 disabled:bg-slate-300 dark:disabled:bg-slate-700 rounded-xl transition-all active:scale-[0.98]"
                          >
                            {savingKeywords ? 'Saving…' : 'Save Keywords'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
              })}
            </div>
          ))}
        </>
      ) : showDemoData && (
        <div className="w-full flex items-center justify-between p-3 bg-emerald-50 dark:bg-emerald-900/10 rounded-2xl border border-emerald-100 dark:border-emerald-800/30">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 bg-emerald-100 dark:bg-emerald-900/30 rounded-full flex items-center justify-center shrink-0">
              <svg className="w-4 h-4 text-emerald-600 dark:text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <div className="min-w-0 text-left">
              <p className="text-xs font-bold text-slate-700 dark:text-slate-200">
                Example Bank
              </p>
              <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5 font-mono truncate max-w-[200px]">
                vendor: /Purchase at (.+?) on/
              </p>
              <p className="text-[11px] text-slate-400 dark:text-slate-500 font-mono truncate max-w-[200px]">
                amount: /\$(\d+\.\d{'{2}'})/
              </p>
            </div>
          </div>
          <span className="text-[11px] font-black uppercase tracking-wider text-slate-400 dark:text-slate-500 shrink-0">
            Demo
          </span>
        </div>
      )}
    </ParsingCard>
  );
};

export default ParsingRulesCard;
