import React, { useRef, useState, useMemo } from 'react';
import { useDialogInteraction } from '../lib/hooks/useDialogInteraction';
import { useDialogExit } from '../lib/hooks/useDialogExit';

interface CalendarPickerProps {
  value: string; // YYYY-MM-DD
  onChange: (date: string) => void;
  onClose: () => void;
}

const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

function parseDate(value: string): Date {
  const parts = value.split('-').map(Number);
  if (parts.length === 3 && parts.every(n => !isNaN(n))) {
    return new Date(parts[0], parts[1] - 1, parts[2]);
  }
  return new Date();
}

const CalendarPicker: React.FC<CalendarPickerProps> = ({ value, onChange, onClose }) => {
  const selected = useMemo(() => parseDate(value), [value]);

  const [viewYear, setViewYear] = useState(selected.getFullYear());
  const [viewMonth, setViewMonth] = useState(selected.getMonth());
  const dialogRef = useRef<HTMLDivElement>(null);
  const { isClosing, close } = useDialogExit();
  const dismiss = () => close(onClose);
  const handleKeyDown = useDialogInteraction(dialogRef, dismiss, { disabled: isClosing });

  const today = useMemo(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }, []);

  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const firstDayOfWeek = new Date(viewYear, viewMonth, 1).getDay();

  const monthLabel = new Date(viewYear, viewMonth).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });

  const prevMonth = () => {
    if (viewMonth === 0) {
      setViewYear(viewYear - 1);
      setViewMonth(11);
    } else {
      setViewMonth(viewMonth - 1);
    }
  };

  const nextMonth = () => {
    if (viewMonth === 11) {
      setViewYear(viewYear + 1);
      setViewMonth(0);
    } else {
      setViewMonth(viewMonth + 1);
    }
  };

  const handleSelect = (day: number) => {
    const mm = String(viewMonth + 1).padStart(2, '0');
    const dd = String(day).padStart(2, '0');
    onChange(`${viewYear}-${mm}-${dd}`);
    dismiss();
  };

  const isSelected = (day: number) =>
    viewYear === selected.getFullYear() &&
    viewMonth === selected.getMonth() &&
    day === selected.getDate();

  const isToday = (day: number) =>
    viewYear === today.getFullYear() &&
    viewMonth === today.getMonth() &&
    day === today.getDate();

  // Build grid cells: empty slots + day numbers
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDayOfWeek; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label="Choose a date"
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      className={`fixed inset-0 z-[110] flex items-center justify-center p-6 bg-slate-900/60 backdrop-blur-xl ${isClosing ? 'dialog-exiting dialog-exit-backdrop' : 'animate-in fade-in dialog-motion'}`}
    >
      <div className={`w-full max-w-xs bg-white dark:bg-slate-900 rounded-[2rem] p-5 shadow-2xl border border-slate-100 dark:border-slate-800/60 ${isClosing ? 'dialog-exiting dialog-exit-surface' : 'animate-in zoom-in-95 dialog-motion'}`}>
        {/* Month navigation */}
        <div className="flex items-center justify-between mb-4">
          <button
            type="button"
            onClick={prevMonth}
            aria-label="Previous month"
            aria-controls="calendar-month-label"
            className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 active:scale-[0.97] transition-transform duration-200"
          >
            <svg className="w-4 h-4 text-slate-500 dark:text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h2
            id="calendar-month-label"
            aria-live="polite"
            aria-atomic="true"
            className="text-xs font-semibold tracking-wide text-slate-700 dark:text-slate-100"
          >
            {monthLabel}
          </h2>
          <button
            type="button"
            onClick={nextMonth}
            aria-label="Next month"
            aria-controls="calendar-month-label"
            className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 active:scale-[0.97] transition-transform duration-200"
          >
            <svg className="w-4 h-4 text-slate-500 dark:text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>

        {/* Day-of-week headers */}
        <div className="grid grid-cols-7 mb-1">
          {DAYS.map((d) => (
            <div key={d} className="text-center text-[9px] font-semibold tracking-wide text-slate-600 dark:text-slate-400 py-1">
              {d}
            </div>
          ))}
        </div>

        {/* Day grid */}
        <div className="grid grid-cols-7 gap-1">
          {cells.map((day, i) =>
            day === null ? (
              <div key={`empty-${i}`} />
            ) : (
              <button
                key={day}
                type="button"
                data-dialog-initial-focus={isSelected(day) ? true : undefined}
                onClick={() => handleSelect(day)}
                className={`
                  aspect-square flex items-center justify-center rounded-xl text-xs font-bold transition-all duration-200 active:scale-[0.97]
                  ${isSelected(day)
                    ? 'bg-emerald-700 text-white shadow-lg shadow-emerald-500/20'
                    : isToday(day)
                    ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 ring-1 ring-emerald-300 dark:ring-emerald-700'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }
                `}
              >
                {day}
              </button>
            )
          )}
        </div>

        {/* Close / Today shortcut */}
        <div className="flex items-center justify-between mt-4 gap-2">
          <button
            type="button"
            onClick={() => {
              const mm = String(today.getMonth() + 1).padStart(2, '0');
              const dd = String(today.getDate()).padStart(2, '0');
              onChange(`${today.getFullYear()}-${mm}-${dd}`);
              dismiss();
            }}
            className="flex-1 py-2.5 text-[10px] font-semibold tracking-wide text-emerald-800 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/20 rounded-xl active:scale-[0.97] transition-all duration-200"
          >
            Today
          </button>
          <button
            type="button"
            onClick={dismiss}
            className="flex-1 py-2.5 text-[10px] font-semibold tracking-wide text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 rounded-xl active:scale-[0.97] transition-all duration-200"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};

export default CalendarPicker;
