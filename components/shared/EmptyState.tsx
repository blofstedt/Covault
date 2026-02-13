import React from 'react';

interface EmptyStateProps {
  icon?: React.ReactNode;
  message: string;
  description?: string;
  size?: 'sm' | 'md';
}

const EmptyState: React.FC<EmptyStateProps> = ({ icon, message, description, size = 'sm' }) => (
  <div className={`${size === 'md' ? 'py-8' : 'py-6'} text-center`}>
    {icon && (
      <div className={`${size === 'md' ? 'w-12 h-12 mb-3' : 'w-10 h-10 mb-2'} bg-slate-100 dark:bg-slate-800 rounded-full flex items-center justify-center mx-auto`}>
        {icon}
      </div>
    )}
    <p className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
      {message}
    </p>
    {description && (
      <p className="text-[11px] text-slate-400 dark:text-slate-600 mt-1 leading-relaxed max-w-xs mx-auto">
        {description}
      </p>
    )}
  </div>
);

export default EmptyState;
