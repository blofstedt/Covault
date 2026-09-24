import type React from 'react';
import { CARD_SURFACE_CLASSES } from './cardSurface';

interface CardWrapperProps {
  id?: string;
  color?: 'amber' | 'emerald' | 'blue' | 'red' | 'violet' | 'slate';
  children: React.ReactNode;
  spacing?: 'sm' | 'md';
}

const borderMap = {
  amber: 'border-amber-200 dark:border-amber-800/40',
  emerald: 'border-emerald-200 dark:border-emerald-800/40',
  blue: 'border-blue-200 dark:border-blue-800/40',
  red: 'border-slate-100 dark:border-slate-800/60',
  violet: 'border-violet-200 dark:border-violet-800/40',
  slate: 'border-slate-100 dark:border-slate-800/60',
};

const CardWrapper: React.FC<CardWrapperProps> = ({ id, color = 'slate', children, spacing = 'md' }) => (
  <div
    id={id}
    className={`${CARD_SURFACE_CLASSES} ${borderMap[color]} ${spacing === 'sm' ? 'space-y-3' : 'space-y-4'}`}
  >
    {children}
  </div>
);

export default CardWrapper;
