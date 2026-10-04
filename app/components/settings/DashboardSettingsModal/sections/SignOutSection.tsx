import React from 'react';

interface SignOutSectionProps {
  onSignOut: () => void;
}

const SignOutSection: React.FC<SignOutSectionProps> = ({ onSignOut }) => {
  return (
    <button
      id="sign-out-button"
      onClick={onSignOut}
      className="w-full py-3.5 text-xs text-rose-500 font-semibold bg-rose-50 dark:bg-rose-900/20 rounded-2xl active:scale-[0.97] transition-all duration-200 tracking-wide mt-6"
    >
      Sign Out
    </button>
  );
};

export default SignOutSection;
