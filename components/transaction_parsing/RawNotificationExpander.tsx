import React, { useState } from 'react';

interface RawNotificationExpanderProps {
  /** The raw notification text. When null/empty, renders nothing. */
  rawNotification: string | null | undefined;
  /** Default collapsed state. Per spec: hidden by default. */
  defaultExpanded?: boolean;
}

/**
 * Collapsible panel showing the original notification text that
 * produced a transaction. Hidden by default (per spec) so the
 * list stays compact; the user can expand to audit "why was
 * this row created?" or copy the text to debug a misparse.
 *
 * Renders nothing when there is no source text (e.g. a manually-
 * created transaction, or a legacy row from before the migration).
 */
const RawNotificationExpander: React.FC<RawNotificationExpanderProps> = ({
  rawNotification,
  defaultExpanded = false,
}) => {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [copied, setCopied] = useState(false);

  if (!rawNotification) return null;

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(rawNotification);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard not available — fall through silently
    }
  };

  const handleToggle = (e: React.MouseEvent | React.KeyboardEvent) => {
    e.stopPropagation();
    setExpanded((v) => !v);
  };

  return (
    <div className="mt-1.5">
      <button
        type="button"
        onClick={handleToggle}
        className="inline-flex items-center gap-1 text-[10px] font-semibold tracking-wide text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 transition-colors duration-150"
        aria-expanded={expanded}
      >
        <svg
          className={`w-3 h-3 transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
        <span>{expanded ? 'Hide' : 'View'} original notification</span>
      </button>
      {expanded && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="mt-1.5 rounded-xl border border-slate-200/70 dark:border-slate-700/50 bg-slate-50/80 dark:bg-slate-800/40 backdrop-blur-sm p-2.5 relative animate-in fade-in slide-in-from-top-1"
        >
          <pre className="font-mono text-[10px] text-slate-600 dark:text-slate-300 whitespace-pre-wrap break-words leading-relaxed max-h-32 overflow-y-auto no-scrollbar">
            {rawNotification}
          </pre>
          <button
            type="button"
            onClick={handleCopy}
            className="absolute top-1.5 right-1.5 p-1 rounded-md hover:bg-slate-200/70 dark:hover:bg-slate-700/60 transition-colors"
            aria-label="Copy notification text"
            title="Copy"
          >
            {copied ? (
              <svg className="w-3 h-3 text-emerald-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : (
              <svg className="w-3 h-3 text-slate-400 dark:text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
              </svg>
            )}
          </button>
        </div>
      )}
    </div>
  );
};

export default RawNotificationExpander;
