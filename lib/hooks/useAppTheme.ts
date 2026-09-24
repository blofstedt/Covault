// lib/useAppTheme.ts
import { useEffect } from 'react';

export const useAppTheme = (theme: 'light' | 'dark') => {
  useEffect(() => {
    const el = document.documentElement;
    el.classList.add('theme-transitioning');

    el.classList.toggle('dark', theme === 'dark');

    const timer = setTimeout(() => {
      el.classList.remove('theme-transitioning');
    }, 500);

    return () => clearTimeout(timer);
  }, [theme]);
};
