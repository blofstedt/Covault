// components/FlagTransactionButton.tsx
import React, { useState } from 'react';
import type { Transaction, User } from '../types';
import { flagNotificationAndRegenerateRule } from '../lib/useNotificationListener';

interface FlagTransactionButtonProps {
  user: User;
  transaction: Transaction;
}

export const FlagTransactionButton: React.FC<FlagTransactionButtonProps> = ({
  user,
  transaction,
}) => {
  const [loading, setLoading] = useState(false);

  const handleFlag = async () => {
    // We only support flagging if this transaction came from a parsed notification
    if (!transaction.notification_rule_id || !transaction.raw_notification) {
      alert('Sorry, this transaction cannot be flagged for correction.');
      return;
    }

    setLoading(true);
    try {
      await flagNotificationAndRegenerateRule({
        userId: user.id,
        notificationRuleId: transaction.notification_rule_id,
        rawNotification: transaction.raw_notification,
        // You can later add:
        // expectedVendor: transaction.vendor,
        // expectedAmount: transaction.amount,
      });

      alert("Thanks! We'll improve how we detect this bank's transactions.");
    } catch (err: any) {
      console.error(err);
      alert(
        err?.message ||
          'Unable to flag this transaction right now. Please try again later.',
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleFlag}
      disabled={loading}
      className="text-[10px] font-bold text-rose-500 underline disabled:opacity-40"
    >
      {loading ? 'Flagging…' : 'This looks wrong'}
    </button>
  );
};

export default FlagTransactionButton;
