import React, { useState, useRef, useCallback, useEffect } from 'react';
import type { SmartCard } from '../../lib/smartCards';
import { dismissCard } from '../../lib/smartCards';

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
}

const SWIPE_THRESHOLD = 80;

const SmartCardDeck: React.FC<SmartCardDeckProps> = ({ cards, onDismiss, onAllDismissed }) => {
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

  const handleSwipeComplete = useCallback(() => {
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

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
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
      // Determine dominant direction for exit animation
      if (absX >= absY) {
        setExitDirection(dragX > 0 ? 'right' : 'left');
      } else {
        setExitDirection(dragY > 0 ? 'down' : 'up');
      }
      setIsExiting(true);
      setTimeout(handleSwipeComplete, 250);
    } else {
      // Snap back
      setDragX(0);
      setDragY(0);
    }
  }, [isDragging, dragX, dragY, handleSwipeComplete]);

  if (activeCards.length === 0) return null;

  const topCard = activeCards[0];
  const rotation = isDragging ? dragX * 0.08 : 0;
  const opacity = isDragging
    ? Math.max(0.4, 1 - (Math.abs(dragX) + Math.abs(dragY)) / 400)
    : 1;

  // Exit transform
  const exitTransforms: Record<string, string> = {
    left: 'translateX(-120vw) rotate(-30deg)',
    right: 'translateX(120vw) rotate(30deg)',
    up: 'translateY(-120vh) rotate(-10deg)',
    down: 'translateY(120vh) rotate(10deg)',
  };

  const topTransform = isExiting
    ? exitTransforms[exitDirection]
    : `translate(${dragX}px, ${dragY}px) rotate(${rotation}deg)`;

  return (
    <div
      className="fixed inset-0 z-[130] bg-slate-900/50 backdrop-blur-md flex items-center justify-center p-6 animate-in fade-in duration-300"
      onPointerDown={(e) => {
        // Dismiss if tapping backdrop (not a card)
        if (e.target === e.currentTarget) onAllDismissed();
      }}
    >
      <div className="relative w-full max-w-sm" style={{ height: 220 }}>
        {/* Card counter */}
        <div className="absolute -top-8 left-0 right-0 text-center">
          <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/60">
            {currentIndex + 1} / {cards.length}
          </span>
        </div>

        {/* Stacked cards (max 3 visible behind) */}
        {activeCards.slice(1, 4).map((card, i) => {
          const depth = i + 1;
          return (
            <div
              key={card.id}
              className={`absolute inset-0 bg-white dark:bg-slate-900 rounded-[2.5rem] border shadow-xl ${accentBorder[card.accent] || accentBorder.blue}`}
              style={{
                transform: `scale(${1 - depth * 0.04}) translateY(${depth * 10}px)`,
                opacity: 1 - depth * 0.15,
                zIndex: 10 - depth,
              }}
            />
          );
        })}

        {/* Top card — draggable */}
        <div
          ref={cardRef}
          className={`absolute inset-0 bg-white dark:bg-slate-900 rounded-[2.5rem] border shadow-2xl overflow-hidden select-none touch-none ${accentBorder[topCard.accent] || accentBorder.blue}`}
          style={{
            transform: topTransform,
            opacity: isExiting ? 0 : opacity,
            transition: isDragging ? 'none' : 'transform 0.25s cubic-bezier(0.25,1,0.5,1), opacity 0.25s ease',
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

          <div className="p-6 pl-8 flex flex-col justify-center h-full">
            <div className="flex items-center gap-3 mb-3">
              <span className="text-2xl">{accentIcon[topCard.accent] || '💡'}</span>
              <h3 className="text-sm font-black text-slate-500 dark:text-slate-100 tracking-tight uppercase">
                {topCard.title}
              </h3>
            </div>
            <p className="text-sm font-medium text-slate-400 dark:text-slate-400 leading-relaxed">
              {topCard.body}
            </p>
            <p className="mt-4 text-[9px] font-black uppercase tracking-[0.2em] text-slate-300 dark:text-slate-600">
              Swipe to dismiss
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SmartCardDeck;
