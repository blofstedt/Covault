import React, { useState, useRef, useCallback } from 'react';
import type { SmartCard } from '../../lib/smartCards';
import { dismissCard } from '../../lib/smartCards';
import { REST_BASE, getAuthHeaders } from '../../lib/apiHelpers';

const accentDot: Record<string, string> = {
  amber: 'bg-amber-500',
  emerald: 'bg-emerald-500',
  blue: 'bg-blue-500',
  violet: 'bg-violet-500',
  rose: 'bg-rose-500',
};

interface InlineSmartCardProps {
  cards: SmartCard[];
  onDismiss: (id: string) => void;
  onAllDismissed: () => void;
  userId?: string;
  theme?: 'light' | 'dark';
}

const SWIPE_THRESHOLD = 60;
const STACK_SPREAD = 10;

function parseVendorSuggestion(card: SmartCard): { vendor: string; categoryId: string } | null {
  if (card.type !== 'vendor-suggestion') return null;
  const prefix = 'vendor-suggest-';
  if (!card.id.startsWith(prefix)) return null;
  const rest = card.id.slice(prefix.length);
  const monthMatch = rest.match(/-(\d{4}-\d{2})$/);
  const core = monthMatch ? rest.slice(0, -monthMatch[0].length) : rest;
  const lastDash = core.lastIndexOf('-');
  if (lastDash < 0) return null;
  return { vendor: core.slice(0, lastDash), categoryId: core.slice(lastDash + 1) };
}

function SmartCardBody({
  card,
  theme,
  showVendorActions,
  onVendorAccept,
  onDismiss,
}: {
  card: SmartCard;
  theme: 'light' | 'dark';
  showVendorActions?: boolean;
  onVendorAccept?: () => void;
  onDismiss?: () => void;
}) {
  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <div className={`w-2 h-2 rounded-full shrink-0 mt-1 ${accentDot[card.accent] || accentDot.blue}`} />

      <div className="flex-1 min-w-0">
        <p className={`text-[11px] font-semibold tracking-wide mb-0.5 ${
          theme === 'dark' ? 'text-slate-400' : 'text-slate-500'
        }`}>
          {card.title}
        </p>
        <p className={`text-xs font-medium leading-snug ${
          theme === 'dark' ? 'text-slate-300' : 'text-slate-600'
        }`}>
          {card.body}
        </p>

        {showVendorActions && (
          <div className="flex gap-2 mt-2">
            <button
              className="px-3 py-1.5 rounded-xl bg-emerald-500 text-white text-[10px] font-semibold tracking-wide active:scale-[0.97] transition-all duration-200"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onVendorAccept?.();
              }}
            >
              Yes
            </button>
            <button
              className="px-3 py-1.5 rounded-xl bg-slate-200 dark:bg-slate-700 text-slate-500 dark:text-slate-300 text-[10px] font-semibold tracking-wide active:scale-[0.97] transition-all duration-200"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onDismiss?.();
              }}
            >
              No
            </button>
          </div>
        )}
      </div>

      <button
        className={`p-1 rounded-lg shrink-0 transition-colors ${
          theme === 'dark' ? 'text-slate-600 hover:text-slate-400' : 'text-slate-300 hover:text-slate-500'
        }`}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onDismiss?.();
        }}
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

const InlineSmartCard: React.FC<InlineSmartCardProps> = ({ cards, onDismiss, onAllDismissed, userId, theme = 'light' }) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [dragX, setDragX] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [isExiting, setIsExiting] = useState(false);

  const startX = useRef(0);
  const isDismissingRef = useRef(false);

  const activeCards = cards.slice(currentIndex);
  const topCard = activeCards[0];

  const advanceCard = useCallback(() => {
    if (isDismissingRef.current) return;
    isDismissingRef.current = true;

    const card = cards[currentIndex];
    if (!card) { isDismissingRef.current = false; return; }

    dismissCard(card.id);
    onDismiss(card.id);

    setIsExiting(false);
    setDragX(0);
    setCurrentIndex((i) => i + 1);

    setTimeout(() => { isDismissingRef.current = false; }, 100);
  }, [cards, currentIndex, onDismiss]);

  const handleVendorAccept = useCallback(async () => {
    const card = cards[currentIndex];
    if (!card || !userId) return;
    const parsed = parseVendorSuggestion(card);
    if (!parsed) return;

    try {
      const authHeaders = await getAuthHeaders();
      await fetch(`${REST_BASE}/vendor-overrides`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ user_id: userId, vendor_name: parsed.vendor, category_id: parsed.categoryId }),
      });
    } catch { /* ignore */ }

    advanceCard();
  }, [cards, currentIndex, userId, advanceCard]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (isDismissingRef.current) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    startX.current = e.clientX;
    setIsDragging(true);
    setDragX(0);
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDragging) return;
    setDragX(e.clientX - startX.current);
  }, [isDragging]);

  const handlePointerUp = useCallback(() => {
    if (!isDragging) return;
    setIsDragging(false);

    if (Math.abs(dragX) > SWIPE_THRESHOLD) {
      setIsExiting(true);
      setTimeout(advanceCard, 200);
    } else {
      setDragX(0);
    }
  }, [isDragging, dragX, advanceCard]);

  if (!topCard || activeCards.length === 0) return null;

  const isVendorCard = topCard.type === 'vendor-suggestion';
  const dragProgress = isDragging || isExiting ? Math.min(1, Math.abs(dragX) / 120) : 0;
  const topOpacity = isDragging ? Math.max(0.3, 1 - Math.abs(dragX) / 150) : isExiting ? 0 : 1;
  const topTransform = isDragging
    ? `translateX(${dragX}px) rotate(${dragX * 0.05}deg)`
    : isExiting
      ? `translateX(${dragX > 0 ? 300 : -300}px) rotate(${dragX > 0 ? 15 : -15}deg)`
      : 'translateX(0)';
  const queuedCards = activeCards.slice(1, 3);
  const cardThemeClass = theme === 'dark'
    ? 'bg-slate-900 border-slate-800/50'
    : 'bg-white border-slate-200/40';

  return (
    <div className="px-4 mb-2">
      <div className="relative">
        {queuedCards
          .slice()
          .reverse()
          .map((card, reverseIndex) => {
            const stackIndex = queuedCards.length - reverseIndex;
            const translateY = stackIndex === 1
              ? STACK_SPREAD - dragProgress * 6
              : STACK_SPREAD * 1.8 - dragProgress * 5;
            const scale = stackIndex === 1
              ? 0.985 + dragProgress * 0.015
              : 0.97 + dragProgress * 0.012;
            const opacity = stackIndex === 1
              ? 0.82 + dragProgress * 0.16
              : 0.58 + dragProgress * 0.12;

            return (
              <div
                key={card.id}
                className={`absolute inset-0 overflow-hidden rounded-2xl border pointer-events-none ${cardThemeClass}`}
                style={{
                  transform: `translateY(${translateY}px) scale(${scale})`,
                  opacity,
                  transition: 'transform 0.26s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.22s ease',
                  zIndex: 10 + stackIndex,
                  boxShadow: theme === 'dark'
                    ? '0 14px 30px rgba(2, 6, 23, 0.22)'
                    : '0 14px 30px rgba(15, 23, 42, 0.08)',
                }}
                aria-hidden="true"
              >
                <SmartCardBody card={card} theme={theme} />
              </div>
            );
          })}

        <div
          className={`relative overflow-hidden rounded-2xl border select-none touch-none ${cardThemeClass}`}
          style={{
            transform: topTransform,
            opacity: topOpacity,
            transition: isDragging ? 'none' : 'transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.2s ease',
            cursor: isDragging ? 'grabbing' : 'grab',
            zIndex: 30,
            boxShadow: theme === 'dark'
              ? '0 20px 40px rgba(2, 6, 23, 0.28)'
              : '0 20px 40px rgba(15, 23, 42, 0.12)',
          }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          {activeCards.length > 1 && (
            <div className="absolute right-3 top-3 z-40 pointer-events-none">
              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-semibold tracking-wide backdrop-blur-md ${
                theme === 'dark'
                  ? 'bg-slate-950/70 text-slate-400 border border-slate-800/70'
                  : 'bg-white/80 text-slate-500 border border-slate-200/70'
              }`}>
                {currentIndex + 1} / {cards.length}
              </span>
            </div>
          )}

          <SmartCardBody
            card={topCard}
            theme={theme}
            showVendorActions={isVendorCard}
            onVendorAccept={handleVendorAccept}
            onDismiss={advanceCard}
          />
        </div>
      </div>
    </div>
  );
};

export default InlineSmartCard;
