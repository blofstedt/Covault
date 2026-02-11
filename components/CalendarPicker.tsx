import React, { useState, useMemo } from 'react';

interface CalendarPickerProps {
  value: string; // YYYY-MM-DD
  onChange: (date: string) => void;
  onClose: () => void;
}

const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

const CalendarPicker: React.FC<CalendarPickerProps> = ({ value, onChange, onClose }) => {
  const selected = useMemo(() => {
    const [y, m, d] = value.split('-').map(Number);
    return new Date(y, m - 1, d);
  }, [value]);

  const [viewYear, setViewYear] = useState(selected.getFullYear());
  const [viewMonth, setViewMonth] = useState(selected.getMonth());

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
    onClose();
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
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-6 bg-slate-900/60 backdrop-blur-xl animate-in fade-in duration-200">
      <div className="w-full max-w-xs bg-white dark:bg-slate-900 rounded-[2rem] p-5 shadow-2xl border border-slate-100 dark:border-slate-800/60 animate-in zoom-in-95 duration-200">
        {/* Month navigation */}
        <div className="flex items-center justify-between mb-4">
          <button
            type="button"
            onClick={prevMonth}
            className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 active:scale-90 transition-transform"
          >
            <svg className="w-4 h-4 text-slate-500 dark:text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <span className="text-xs font-black uppercase tracking-widest text-slate-500 dark:text-slate-100">
            {monthLabel}
          </span>
          <button
            type="button"
            onClick={nextMonth}
            className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 active:scale-90 transition-transform"
          >
            <svg className="w-4 h-4 text-slate-500 dark:text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>

        {/* Day-of-week headers */}
        <div className="grid grid-cols-7 mb-1">
          {DAYS.map((d) => (
            <div key={d} className="text-center text-[9px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-600 py-1">
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
                onClick={() => handleSelect(day)}
                className={`
                  aspect-square flex items-center justify-center rounded-xl text-xs font-bold transition-all active:scale-90
                  ${isSelected(day)
                    ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-500/20'
                    : isToday(day)
                    ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 ring-1 ring-emerald-300 dark:ring-emerald-700'
                    : 'text-slate-500 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
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
              onClose();
            }}
            className="flex-1 py-2.5 text-[10px] font-black uppercase tracking-widest text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 rounded-xl active:scale-95 transition-all"
          >
            Today
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2.5 text-[10px] font-black uppercase tracking-widest text-slate-400 bg-slate-100 dark:bg-slate-800 rounded-xl active:scale-95 transition-all"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};

export default CalendarPicker;
