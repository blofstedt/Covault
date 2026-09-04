import React from 'react';
import SettingsCard from '../../ui/SettingsCard';
import SectionHeader from '../../ui/SectionHeader';
import ToggleSwitch from '../../ui/ToggleSwitch';

interface SharedRulesSectionProps {
  useCommunityRules: boolean;
  onToggleUseCommunityRules: () => void;
  contributeCommunityRules: boolean;
  onToggleContributeCommunityRules: () => void;
}

/**
 * The two answers about the shared pool of vendor rules.
 *
 * They are separate switches because they are separate acts, and their defaults
 * are deliberately not symmetrical: receiving a suggestion costs the user
 * nothing and sends nothing, while contributing puts something of theirs
 * somewhere else. So receiving is on and contributing is off until somebody
 * deliberately turns it on.
 *
 * The wording below is the whole disclosure, and it is meant to be read rather
 * than skimmed past: exactly what one contributed row contains, and what
 * turning the switch back off does. Both are load-bearing promises — see
 * lib/communityRules.ts, which withdraws every past contribution on opt-out.
 */
const SharedRulesSection: React.FC<SharedRulesSectionProps> = ({
  useCommunityRules,
  onToggleUseCommunityRules,
  contributeCommunityRules,
  onToggleContributeCommunityRules,
}) => (
  <SettingsCard>
    <SectionHeader
      title="Shared Rules"
      subtitle="What other people file a shop under, as a suggestion"
    />

    <div className="mt-4 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-slate-500 dark:text-slate-300 tracking-wide">
            Use shared rules
          </p>
          <p className="text-[10px] font-medium text-slate-400 dark:text-slate-500 mt-0.5 leading-relaxed">
            When you've no rule for a shop, Covault suggests the category most
            households use. It's only ever a suggestion — you accept it in
            Review, and only then does it become your rule. Nothing about you is
            sent to receive one.
          </p>
        </div>
        <ToggleSwitch enabled={useCommunityRules} onToggle={onToggleUseCommunityRules} />
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-slate-500 dark:text-slate-300 tracking-wide">
            Share your rules
          </p>
          <p className="text-[10px] font-medium text-slate-400 dark:text-slate-500 mt-0.5 leading-relaxed">
            Sends the shop's name and the category you chose — nothing else. No
            amounts, no dates, no bank, and nothing about how often you shop
            anywhere. A shop is only ever passed on once several households
            agree, so a place only you go is never shared. Turning this off
            takes back everything you've sent.
          </p>
        </div>
        <ToggleSwitch
          enabled={contributeCommunityRules}
          onToggle={onToggleContributeCommunityRules}
        />
      </div>
    </div>
  </SettingsCard>
);

export default SharedRulesSection;
