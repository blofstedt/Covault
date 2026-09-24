import { useState } from 'react';
import CalendarPicker from '../components/CalendarPicker';

export default function CalendarFixture() {
  const [value, setValue] = useState('2026-09-24');
  const [isOpen, setIsOpen] = useState(true);

  return (
    <main className="flex min-h-full items-center justify-center bg-slate-50 p-6 dark:bg-slate-950">
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="rounded-2xl bg-white px-5 py-4 text-sm font-semibold text-slate-700 shadow-sm dark:bg-slate-900 dark:text-slate-100"
      >
        Selected date: {value}
      </button>
      {isOpen && (
        <CalendarPicker
          value={value}
          onChange={setValue}
          onClose={() => setIsOpen(false)}
        />
      )}
    </main>
  );
}
