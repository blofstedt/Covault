import type React from 'react';
import { BUDGET_CATEGORY_COLORS } from '../../../../../lib/budgets/budgetColors';

/**
 * A schematic likeness of the home-screen widget: donut left, legend right.
 *
 * Nothing here is fake data. Every bar and dot is a placeholder shape, the
 * same rule the native picker preview follows
 * (`native/android/res/drawable/widget_preview.xml`) and for the same reason —
 * an invented total would read as real. The three category colours ARE real:
 * they come from `BUDGET_CATEGORY_COLORS`, the one source both this and the
 * widget draw from, so the preview can never show a shade the widget doesn't.
 *
 * Colours are Tailwind's `dark:` variant rather than a theme prop, matching
 * every other themed element in the app — and matching the widget itself,
 * which draws from the same slate values (see the LIGHT/DARK palettes in
 * `WidgetRenderer.java`) because it follows the in-app theme setting too.
 */
const WidgetPreview: React.FC = () => {
  const groceries = BUDGET_CATEGORY_COLORS.Groceries;
  const leisure = BUDGET_CATEGORY_COLORS.Leisure;
  const transport = BUDGET_CATEGORY_COLORS.Transport;

  return (
    <svg
      viewBox="0 0 250 110"
      className="w-full h-auto rounded-[1.4rem] shadow-sm"
      role="img"
      aria-label="Preview of the Covault home-screen widget: a ring of this month's spending by category, with a legend beside it"
    >
      <path
        className="fill-white dark:fill-slate-900"
        d="M28,0 L222,0 A28,28 0 0 1 250,28 L250,82 A28,28 0 0 1 222,110 L28,110 A28,28 0 0 1 0,82 L0,28 A28,28 0 0 1 28,0 Z"
      />

      {/* Month label, as a bar */}
      <path
        className="fill-slate-200 dark:fill-slate-700"
        d="M14,14 L58,14 A3,3 0 0 1 58,20 L14,20 A3,3 0 0 1 14,14 Z"
      />

      {/* Donut track */}
      <path
        className="fill-none stroke-slate-200 dark:stroke-slate-800"
        strokeWidth={11}
        d="M60,39 A27,27 0 1 1 59.9,39"
      />

      {/* Three slices, the app's own category colours */}
      <path className="fill-none" stroke={groceries} strokeWidth={11} d="M60,39 A27,27 0 0 1 80.7,83.4" />
      <path className="fill-none" stroke={leisure} strokeWidth={11} d="M78.4,85.1 A27,27 0 0 1 35.3,78.9" />
      <path className="fill-none" stroke={transport} strokeWidth={11} d="M34.2,77.2 A27,27 0 0 1 59.5,39.0" />

      {/* Centre figure, as a bar */}
      <path
        className="fill-slate-300 dark:fill-slate-600"
        d="M45,61 L75,61 A3.5,3.5 0 0 1 75,68 L45,68 A3.5,3.5 0 0 1 45,61 Z"
      />

      {/* Legend: dot + name bar + amount bar, one row per slice */}
      {[
        { cy: 44, color: groceries, name: 48, amount: 32 },
        { cy: 64, color: leisure, name: 40, amount: 26 },
        { cy: 84, color: transport, name: 44, amount: 24 },
      ].map((row, i) => (
        <g key={i}>
          <circle cx={110} cy={row.cy} r={4} fill={row.color} />
          <path
            className="fill-slate-300 dark:fill-slate-600"
            d={`M122,${row.cy - 3} L${122 + row.name},${row.cy - 3} A2.5,2.5 0 0 1 ${122 + row.name},${row.cy + 2} L122,${row.cy + 2} A2.5,2.5 0 0 1 122,${row.cy - 3} Z`}
          />
          <path
            className="fill-slate-200 dark:fill-slate-700"
            d={`M204,${row.cy - 3} L${204 + row.amount},${row.cy - 3} A2.5,2.5 0 0 1 ${204 + row.amount},${row.cy + 2} L204,${row.cy + 2} A2.5,2.5 0 0 1 204,${row.cy - 3} Z`}
          />
        </g>
      ))}
    </svg>
  );
};


export default WidgetPreview;
