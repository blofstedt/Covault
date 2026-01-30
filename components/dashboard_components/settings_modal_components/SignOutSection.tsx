import React from 'react';

interface SignOutSectionProps {
  onSignOut: () => void;
}

const SignOutSection: React.FC<SignOutSectionProps> = ({ onSignOut }) => {
  return (
    <button
      id="sign-out-button"
      onClick={onSignOut}
      className="w-full py-6 text-rose-500 font-black bg-rose-50 dark:bg-rose-900/20 rounded-3xl active:scale-95 transition-transform uppercase tracking-widest mt-6"
    >
      Sign Out
    </button>
  );
};

export default SignOutSection;
