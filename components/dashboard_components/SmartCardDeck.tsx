import React, { useState, useRef, useCallback, useEffect } from 'react';
import type { SmartCard } from '../../lib/smartCards';
import { dismissCard } from '../../lib/smartCards';
import { REST_BASE, getAuthHeaders } from '../../lib/apiHelpers';

// ── Accent color map ──────────────────────────────────────────────
const accentBg: Record<string, string> = {
  amber: 'bg-amber-500',
  emerald: 'bg-emerald-500',
  blue: 'bg-blue-500',
  violet: 'bg-violet-500',
  rose: 'bg-rose-500',
};

const accentBorder: Record<string, string> = {
  amber: 'border-amber-200 dark:border-amber-800/40',
  emerald: 'border-emerald-200 dark:border-emerald-800/40',
  blue: 'border-blue-200 dark:border-blue-800/40',
  violet: 'border-violet-200 dark:border-violet-800/40',
  rose: 'border-rose-200 dark:border-rose-800/40',
};

const accentIcon: Record<string, string> = {
  amber: '⚠️',
  emerald: '✨',
  blue: '📊',
  violet: '📅',
  rose: '🚨',
};

interface SmartCardDeckProps {
  cards: SmartCard[];
  onDismiss: (id: string) => void;
  onAllDismissed: () => void;
  userId?: string;
}

const SWIPE_THRESHOLD = 80;

/** Convert app-format budget ID ('budget:groceries') to DB Budgets enum ('Groceries'). */
function budgetIdToName(budgetId: string): string {
  if (budgetId.startsWith('budget:')) {
    const name = budgetId.slice('budget:'.length).replace(/-/g, ' ');
    return name.charAt(0).toUpperCase() + name.slice(1);
  }
  return budgetId;
}

/** Extract vendor name and category ID from a vendor-suggestion card ID */
function parseVendorSuggestion(card: SmartCard): { vendor: string; categoryId: string } | null {
  if (card.type !== 'vendor-suggestion') return null;
  // id format: vendor-suggest-<vendor>-<categoryId>-<YYYY-MM>
  const prefix = 'vendor-suggest-';
  if (!card.id.startsWith(prefix)) return null;
  const rest = card.id.slice(prefix.length);
  // Strip the trailing month key (e.g. "-2026-04")
  const monthMatch = rest.match(/-(\d{4}-\d{2})$/);
  const core = monthMatch ? rest.slice(0, -monthMatch[0].length) : rest;
  const lastDash = core.lastIndexOf('-');
  if (lastDash < 0) return null;
  return { vendor: core.slice(0, lastDash), categoryId: core.slice(lastDash + 1) };
}

const SmartCardDeck: React.FC<SmartCardDeckProps> = ({ cards, onDismiss, onAllDismissed, userId }) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [dragX, setDragX] = useState(0);
  const [dragY, setDragY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [isExiting, setIsExiting] = useState(false);
  const [exitDirection, setExitDirection] = useState<'left' | 'right' | 'up' | 'down'>('right');

  const startPos = useRef({ x: 0, y: 0 });
  const cardRef = useRef<HTMLDivElement>(null);
  const isDismissingRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const pendingDrag = useRef<{ x: number; y: number } | null>(null);

  const activeCards = cards.slice(currentIndex);

  // Close modal when all cards are swiped
  useEffect(() => {
    if (activeCards.length === 0 && cards.length > 0) {
      onAllDismissed();
    }
  }, [activeCards.length, cards.length, onAllDismissed]);

  const advanceCard = useCallback(() => {
    if (isDismissingRef.current) return;
    isDismissingRef.current = true;

    const card = cards[currentIndex];
    if (!card) { isDismissingRef.current = false; return; }

    dismissCard(card.id);
    onDismiss(card.id);

    setIsExiting(false);
    setDragX(0);
    setDragY(0);
    setCurrentIndex((i) => i + 1);

    setTimeout(() => { isDismissingRef.current = false; }, 50);
  }, [cards, currentIndex, onDismiss]);

  const handleSwipeComplete = useCallback(() => {
    advanceCard();
  }, [advanceCard]);

  /** Handle "Yes" on vendor-suggestion card — create vendor_override, then advance */
  const handleVendorAccept = useCallback(async () => {
    const card = cards[currentIndex];
    if (!card || !userId) { advanceCard(); return; }
    const parsed = parseVendorSuggestion(card);
    if (!parsed) { advanceCard(); return; }

    try {
      const headers = await getAuthHeaders();
      (headers as any)['Prefer'] = 'return=representation';
      // category_id in DB is a Budgets enum e.g. 'Groceries', not the app-format 'budget:groceries'
      const dbCategoryId = budgetIdToName(parsed.categoryId);
      // Upsert: try insert, fallback to patch
      const res = await fetch(`${REST_BASE}/overrides`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          user_id: userId,
          proper_name: parsed.vendor,
          category_id: dbCategoryId,
        }),
      });
      if (!res.ok) {
        // If conflict, update existing
        await fetch(
          `${REST_BASE}/overrides?user_id=eq.${userId}&proper_name=eq.${encodeURIComponent(parsed.vendor)}`,
          { method: 'PATCH', headers, body: JSON.stringify({ category_id: dbCategoryId }) },
        );
      }
    } catch (e) {
      console.warn('[SmartCard] vendor override save failed:', e);
    }

    dismissCard(card.id);
    onDismiss(card.id);
    setIsExiting(false);
    setDragX(0);
    setDragY(0);
    setCurrentIndex((i) => i + 1);
    setTimeout(() => { isDismissingRef.current = false; }, 50);
  }, [cards, currentIndex, userId, advanceCard, onDismiss]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    // Don't start drag on button taps
    if ((e.target as HTMLElement).closest('button')) return;
    setIsDragging(true);
    startPos.current = { x: e.clientX, y: e.clientY };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  }, []);

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isDragging) return;
      pendingDrag.current = {
        x: e.clientX - startPos.current.x,
        y: e.clientY - startPos.current.y,
      };
      if (!rafRef.current) {
        rafRef.current = requestAnimationFrame(() => {
          if (pendingDrag.current) {
            setDragX(pendingDrag.current.x);
            setDragY(pendingDrag.current.y);
          }
          rafRef.current = null;
        });
      }
    },
    [isDragging],
  );

  const handlePointerUp = useCallback(() => {
    if (!isDragging) return;
    setIsDragging(false);

    const absX = Math.abs(dragX);
    const absY = Math.abs(dragY);

    if (absX > SWIPE_THRESHOLD || absY > SWIPE_THRESHOLD) {
      if (absX >= absY) {
        setExitDirection(dragX > 0 ? 'right' : 'left');
      } else {
        setExitDirection(dragY > 0 ? 'down' : 'up');
      }
      setIsExiting(true);
      setTimeout(handleSwipeComplete, 250);
    } else {
      setDragX(0);
      setDragY(0);
    }
  }, [isDragging, dragX, dragY, handleSwipeComplete]);

  if (activeCards.length === 0) return null;

  const topCard = activeCards[0];
  const isVendorCard = topCard.type === 'vendor-suggestion';
  const rotation = isDragging ? dragX * 0.08 : 0;
  const opacity = isDragging
    ? Math.max(0.4, 1 - (Math.abs(dragX) + Math.abs(dragY)) / 400)
    : 1;

  const exitTransforms: Record<string, string> = {
    left: 'translateX(-120vw) rotate(-30deg)',
    right: 'translateX(120vw) rotate(30deg)',
    up: 'translateY(-120vh) rotate(-10deg)',
    down: 'translateY(120vh) rotate(10deg)',
  };

  const topTransform = isExiting
    ? exitTransforms[exitDirection]
    : `translate(${dragX}px, ${dragY}px) rotate(${rotation}deg)`;

  // Progress of swipe (0 = resting, 1 = at threshold)
  const swipeProgress = isDragging
    ? Math.min(1, (Math.abs(dragX) + Math.abs(dragY)) / SWIPE_THRESHOLD)
    : isExiting ? 1 : 0;

  return (
    <div
      className="fixed inset-0 z-[130] bg-slate-900/50 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-300"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onAllDismissed();
      }}
    >
      <div className="relative w-full max-w-md" style={{ height: 300 }}>
        {/* Card counter */}
        <div className="absolute -top-8 left-0 right-0 text-center">
          <span className="text-[10px] font-semibold tracking-wide text-white/60">
            {currentIndex + 1} / {cards.length}
          </span>
        </div>

        {/* Stacked cards behind — scale up smoothly when top card is dismissed */}
        {activeCards.slice(1, 4).map((card, i) => {
          const depth = i + 1;
          // Cards sit behind at progressively smaller scales
          const restScale = 1 - depth * 0.05;
          const targetScale = 1 - (depth - 1) * 0.05;
          const scale = restScale + (targetScale - restScale) * swipeProgress;
          const restOpacity = 1 - depth * 0.12;
          const targetOpacity = 1 - (depth - 1) * 0.12;
          const cardOpacity = restOpacity + (targetOpacity - restOpacity) * swipeProgress;

          return (
            <div
              key={card.id}
              className={`absolute inset-0 bg-white dark:bg-slate-900 rounded-[2.5rem] border shadow-xl overflow-hidden ${accentBorder[card.accent] || accentBorder.blue}`}
              style={{
                transform: `scale(${scale})`,
                opacity: cardOpacity,
                zIndex: 10 - depth,
                transformOrigin: 'center center',
                transition: isDragging
                  ? 'none'
                  : 'transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.4s ease',
              }}
            >
              {/* Accent strip */}
              <div className={`absolute left-0 top-0 bottom-0 w-2 ${accentBg[card.accent] || accentBg.blue} rounded-l-[2.5rem]`} />
              {/* Show next card content so it's visible behind */}
              <div className="p-8 pl-10 flex flex-col justify-center h-full">
                <div className="flex items-center gap-3 mb-3">
                  <span className="text-2xl">{accentIcon[card.accent] || '💡'}</span>
                  <h3 className="text-sm font-bold text-slate-500 dark:text-slate-100 tracking-tight">
                    {card.title}
                  </h3>
                </div>
                <p className="text-sm font-medium text-slate-400 dark:text-slate-400 leading-relaxed">
                  {card.body}
                </p>
              </div>
            </div>
          );
        })}

        {/* Top card — draggable */}
        <div
          key={topCard.id}
          ref={cardRef}
          className={`absolute inset-0 bg-white dark:bg-slate-900 rounded-[2.5rem] border shadow-2xl overflow-hidden select-none touch-none ${accentBorder[topCard.accent] || accentBorder.blue}`}
          style={{
            transform: topTransform,
            opacity: isExiting ? 0 : opacity,
            transition: isDragging
              ? 'none'
              : 'transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.3s ease',
            zIndex: 20,
            cursor: isDragging ? 'grabbing' : 'grab',
          }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          {/* Accent strip */}
          <div className={`absolute left-0 top-0 bottom-0 w-2 ${accentBg[topCard.accent] || accentBg.blue} rounded-l-[2.5rem]`} />

          <div className="p-8 pl-10 flex flex-col justify-center h-full">
            <div className="flex items-center gap-3 mb-4">
              <span className="text-2xl">{accentIcon[topCard.accent] || '💡'}</span>
              <h3 className="text-sm font-bold text-slate-500 dark:text-slate-100 tracking-tight">
                {topCard.title}
              </h3>
            </div>
            <p className="text-[15px] font-medium text-slate-400 dark:text-slate-400 leading-relaxed">
              {topCard.body}
            </p>

            {/* Vendor suggestion: Yes/No buttons */}
            {isVendorCard ? (
              <div className="flex gap-3 mt-6">
                <button
                  className="flex-1 py-3 rounded-2xl bg-emerald-500 text-white text-xs font-semibold tracking-wide active:scale-[0.97] transition-all duration-200"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => { e.stopPropagation(); handleVendorAccept(); }}
                >
                  Yes
                </button>
                <button
                  className="flex-1 py-3 rounded-2xl bg-slate-200 dark:bg-slate-700 text-slate-500 dark:text-slate-300 text-xs font-semibold tracking-wide active:scale-[0.97] transition-all duration-200"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => { e.stopPropagation(); advanceCard(); }}
                >
                  No
                </button>
              </div>
            ) : (
              <p className="mt-6 text-[9px] font-medium tracking-wide text-slate-300 dark:text-slate-600">
                Swipe to dismiss
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default SmartCardDeck;
