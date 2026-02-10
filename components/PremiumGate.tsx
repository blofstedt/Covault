import React, { useState } from 'react';
import SubscribeModal from './SubscribeModal';

interface PremiumGateProps {
  /** Whether the user currently has premium access */
  hasPremium: boolean;
  /** Called when user taps Subscribe in the modal */
  onSubscribe: () => void;
  /** The child content — rendered normally when premium, greyed out when locked */
  children: React.ReactNode;
}

const PremiumGate: React.FC<PremiumGateProps> = ({
  hasPremium,
  onSubscribe,
  children,
}) => {
  const [showModal, setShowModal] = useState(false);

  if (hasPremium) {
    return <>{children}</>;
  }

  return (
    <>
      <div
        className="relative cursor-pointer"
        onClick={() => setShowModal(true)}
      >
        {/* Greyed-out overlay */}
        <div className="opacity-50 pointer-events-none select-none">
          {children}
        </div>
        {/* Lock badge */}
        <div className="absolute top-2 right-2 bg-slate-200 dark:bg-slate-700 rounded-full p-1.5">
          <svg className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
          </svg>
        </div>
      </div>

      {showModal && (
        <SubscribeModal
          onClose={() => setShowModal(false)}
          onSubscribe={() => {
            setShowModal(false);
            onSubscribe();
          }}
        />
      )}
    </>
  );
};

export default PremiumGate;
