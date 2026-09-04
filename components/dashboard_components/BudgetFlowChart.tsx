import React, { useEffect, useRef, useMemo } from 'react';
import * as d3 from 'd3';
import { BudgetCategory, Transaction } from '../../types';
import { getBudgetGradient, getBudgetColor } from '../../lib/budgetColors';
import { buildMonthWindow, shortMonthName, longMonthLabel } from '../../lib/monthWindow';

interface BudgetFlowChartProps {
  budgets: BudgetCategory[];
  transactions: Transaction[];
  monthlyIncome?: number;
  theme?: 'light' | 'dark';
  highlightedBudgetId?: string | null;
  /** The month we are really in, from the dashboard's single clock. */
  currentMonthKey: string;
  /** The month being shown — the middle of the rail unless the user moved it. */
  selectedMonthKey: string;
  /** A tap on the rail. Passing the current month is how the user comes back. */
  onSelectMonth: (monthKey: string) => void;
}

interface MonthlyBudgetData {
  month: string;
  monthKey: string;
  total: number;
  budgetLimit: number;
  [key: string]: number | string;
}

function getGradient(name: string, index: number): [string, string] {
  return getBudgetGradient(name, index);
}

/**
 * d3 transitions bypass CSS entirely, so `prefers-reduced-motion` and the
 * `motion-safe:` variants used elsewhere in the app have no effect here. The
 * chart has to ask directly, and collapse its durations to zero.
 */
function motionDuration(ms: number): number {
  if (typeof window === 'undefined' || !window.matchMedia) return ms;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : ms;
  } catch {
    return ms;
  }
}

/**
 * The solo fade runs on the same 320ms ease-out as the budget card's expand
 * (`.budget-row-anim` in index.css), because it accompanies it.
 *
 * It is a CSS transition on `opacity`, declared once when each path is created,
 * and NOT a d3 transition. d3 transitions are a requestAnimationFrame loop that
 * writes attributes on the main thread every frame — and the frames they were
 * competing for are the same ones the card expand needs for its layout
 * animation. `fill-opacity` / `stroke-opacity` cannot be composited either, so
 * the old version paid twice. Element `opacity` is the one form of "make this
 * fade" the compositor can take off the main thread entirely; the static
 * fill-opacity / stroke-opacity values below multiply through it, so the
 * rendered result is unchanged.
 */
const SOLO_FADE_EASE = 'cubic-bezier(0.32, 0.72, 0.24, 1)';
function soloFadeTransition(): string {
  return `opacity ${motionDuration(320)}ms ${SOLO_FADE_EASE}`;
}

const NO_BUDGETS: BudgetCategory[] = [];
const NO_TRANSACTIONS: Transaction[] = [];

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatMonthLabel(key: string): string {
  const [year, month] = key.split('-');
  return `${MONTH_ABBR[parseInt(month, 10) - 1]} ${year}`;
}

const BudgetFlowChart: React.FC<BudgetFlowChartProps> = ({
  budgets,
  transactions,
  monthlyIncome = 0,
  theme = 'light',
  highlightedBudgetId = null,
  currentMonthKey,
  selectedMonthKey,
  onSelectMonth,
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  // There is no scrub-and-read here any more. Dragging a finger across the
  // chart used to raise a card naming the month, the category and its share —
  // a readout for a month you could not then do anything with. Tapping a month
  // on the rail now puts the whole dashboard on it, vials and balance and all,
  // which answers the same question in the place the user was already looking.
  // What went with the card: the scrubber line and dot, the per-band dimming
  // it drove, and `touch-action: none` on the SVG, which was swallowing every
  // vertical swipe that began over the chart.
  // Refs to store chart internals for morph animation
  const chartInternalsRef = useRef<{
    stackedData: d3.Series<MonthlyBudgetData, string>[];
    x: d3.ScalePoint<string>;
    y: d3.ScaleLinear<number, number>;
    innerHeight: number;
    innerWidth: number;
  } | null>(null);
  const highlightedRef = useRef<string | null>(null);
  // Stable fallbacks. A fresh `[]` in the defensive branch would give
  // safeBudgets a new identity every render, cascading through budgetNameById
  // -> categoryNames -> chartData and rebuilding the entire SVG on every
  // render. (safeTransactions' useMemo was an identity function, so the same
  // stable-fallback pattern replaces it.)
  const safeBudgets = Array.isArray(budgets) ? budgets : NO_BUDGETS;
  const safeTransactions = Array.isArray(transactions) ? transactions : NO_TRANSACTIONS;

  // Build a map from budget id -> budget name
  const budgetNameById = useMemo(() => {
    const map = new Map<string, string>();
    safeBudgets.forEach((b) => map.set(b.id, b.name));
    return map;
  }, [safeBudgets]);

  // Get the ordered list of category names that actually appear in data
  const categoryNames = useMemo(() => {
    const names = safeBudgets.map((b) => b.name);
    return names.length > 0 ? names : [];
  }, [safeBudgets]);

  // Total monthly budget limit (sum of all category limits)
  const totalBudgetLimit = useMemo(() => {
    return safeBudgets.reduce((sum, b) => sum + (b.totalLimit || 0), 0);
  }, [safeBudgets]);

  const thresholdValue = monthlyIncome > 0 ? monthlyIncome : totalBudgetLimit;

  // Aggregate transactions into monthly data by category
  const chartData: MonthlyBudgetData[] = useMemo(() => {
    if (categoryNames.length === 0) return [];

    // Group spending by "YYYY-MM" and category name
    const monthMap = new Map<string, Map<string, number>>();

    for (const tx of safeTransactions) {
      const rawDate = tx.date;
      if (!rawDate || rawDate.length < 7) continue;

      // Extract YYYY-MM directly from the date string to avoid timezone shifts
      const txMonthKey = rawDate.slice(0, 7);

      const amount = Number(tx.amount) || 0;
      if (amount === 0) continue;

      const monthKey = txMonthKey;

      if (!monthMap.has(monthKey)) {
        monthMap.set(monthKey, new Map<string, number>());
      }
      const catMap = monthMap.get(monthKey)!;

      const catName = tx.budget_id ? (budgetNameById.get(tx.budget_id) || 'Other') : 'Other';
      catMap.set(catName, (catMap.get(catName) || 0) + amount);
    }

    // The seven months of the rail — three back, this one, three forward —
    // built from the calendar rather than from whichever months happen to hold
    // transactions. A month with no spending is a real answer and has to keep
    // its place on the axis; drawing only the months with data moved every
    // label sideways the first time a new month was spent in.
    const displayMonths = buildMonthWindow(currentMonthKey);

    // Build the data array
    const data = displayMonths.map((monthKey) => {
      const catMap = monthMap.get(monthKey);
      const entry: MonthlyBudgetData = {
        month: formatMonthLabel(monthKey),
        monthKey,
        total: 0,
        budgetLimit: totalBudgetLimit,
      };

      for (const name of categoryNames) {
        const val = catMap?.get(name) || 0;
        entry[name] = val;
        entry.total += val;
      }

      return entry;
    });

    return data;
  }, [safeTransactions, categoryNames, budgetNameById, totalBudgetLimit, currentMonthKey]);

  // Draw the D3 stacked area chart
  useEffect(() => {
    if (!svgRef.current || !containerRef.current || chartData.length === 0 || categoryNames.length === 0) return;

    const container = containerRef.current;
    const width = container.clientWidth;
    // Scale chart height proportionally — compact on mobile, capped on desktop
    const isDesktop = width >= 1024;
    const height = isDesktop
      ? Math.min(Math.max(120, window.innerHeight * 0.18), 200)
      : Math.min(Math.max(120, window.innerHeight * 0.2), width * 0.4);
    // No bottom gutter for month labels any more: they are HTML buttons on the
    // rail below the SVG, which is what makes them tappable (and lets the
    // selected month wear a real pill that slides on the app's own 320ms
    // clock, rather than a rectangle drawn into the chart).
    const margin = { top: 12, right: 0, bottom: 6, left: 0 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    const svgElement = d3.select(svgRef.current);
    svgElement.selectAll('*').remove();

    const defs = svgElement.append('defs');

    // Create gradients for each category
    categoryNames.forEach((name, i) => {
      const [c0, c1] = getGradient(name, i);
      const grad = defs
        .append('linearGradient')
        .attr('id', `bfc-grad-${i}`)
        .attr('x1', '0%')
        .attr('y1', '0%')
        .attr('x2', '0%')
        .attr('y2', '100%');
      grad.append('stop').attr('offset', '0%').attr('stop-color', c0).attr('stop-opacity', 0.95);
      grad.append('stop').attr('offset', '100%').attr('stop-color', c1).attr('stop-opacity', 0.75);
    });

    const svg = svgElement
      .attr('viewBox', `0 0 ${width} ${height}`)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    // Use zero-baseline stacking (no silhouette/cone)
    const stack = d3
      .stack<MonthlyBudgetData>()
      .keys(categoryNames)
      .value((d, key) => (typeof d[key] === 'number' ? (d[key] as number) : 0))
      .offset(d3.stackOffsetNone)
      .order(d3.stackOrderReverse);

    const stackedData = stack(chartData);

    // padding 0.5 puts each month at the CENTRE of its own equal slice of the
    // width — the same seven slices the rail's buttons occupy — so a label and
    // the point it names line up exactly. Anything else and the pill sits
    // beside its own data.
    const x = d3.scalePoint().domain(chartData.map((d) => d.month)).range([0, innerWidth]).padding(0.5);

    const maxTotal = d3.max(chartData, (d) => d.total) || 1;
    const yMax = Math.max(maxTotal, thresholdValue) * 1.15;

    const y = d3
      .scaleLinear()
      .domain([0, yMax])
      .range([innerHeight, 0]);

    const isDarkTheme = theme === 'dark';

    // Store internals for morph animation
    chartInternalsRef.current = { stackedData, x, y, innerHeight, innerWidth };

    // ── Helpers to extend area/line paths to chart edges ──
    // Adds anchor points at x=0 and x=innerWidth with the same values as the
    // first/last data points so CatmullRom curves fill the full container width.
    const makeExtendedArea = (
      layer: d3.SeriesPoint<MonthlyBudgetData>[],
      y0Fn: (d: d3.SeriesPoint<MonthlyBudgetData>) => number,
      y1Fn: (d: d3.SeriesPoint<MonthlyBudgetData>) => number,
    ) => {
      const pts = layer.map(d => ({ x: x(d.data.month) || 0, y0: y0Fn(d), y1: y1Fn(d) }));
      pts.unshift({ x: 0, y0: pts[0].y0, y1: pts[0].y1 });
      pts.push({ x: innerWidth, y0: pts[pts.length - 1].y0, y1: pts[pts.length - 1].y1 });
      return d3.area<{ x: number; y0: number; y1: number }>()
        .x(d => d.x).y0(d => d.y0).y1(d => d.y1)
        .curve(d3.curveCatmullRom.alpha(0.5))(pts) || '';
    };

    const makeExtendedLine = (
      layer: d3.SeriesPoint<MonthlyBudgetData>[],
      yFn: (d: d3.SeriesPoint<MonthlyBudgetData>) => number,
    ) => {
      const pts = layer.map(d => ({ x: x(d.data.month) || 0, y: yFn(d) }));
      pts.unshift({ x: 0, y: pts[0].y });
      pts.push({ x: innerWidth, y: pts[pts.length - 1].y });
      return d3.line<{ x: number; y: number }>()
        .x(d => d.x).y(d => d.y)
        .curve(d3.curveCatmullRom.alpha(0.5))(pts) || '';
    };

    // Subtle horizontal grid lines
    const gridValues = y.ticks(3);
    gridValues.forEach((val) => {
      if (val === 0) return;
      svg
        .append('line')
        .attr('x1', 0)
        .attr('x2', innerWidth)
        .attr('y1', y(val))
        .attr('y2', y(val))
        .attr('stroke', isDarkTheme ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)')
        .attr('stroke-width', 1);
    });

    // area (d3.area<...>()) was a stacked-area generator built here
    // but never invoked — the actual drawing uses makeExtendedArea
    // defined above. Removed; restore if a future render path needs it.

    // Draw stacked area bands with highlight strokes
    const layerGroup = svg.selectAll('.bfc-layer').data(stackedData).enter().append('g').attr('class', 'bfc-layer');

    layerGroup
      .append('path')
      .attr('class', 'bfc-band')
      .attr('d', (d: any) => makeExtendedArea(d, (pt: any) => y(pt[0]) - 1, (pt: any) => y(pt[1])))
      .style('fill', (_d, i) => `url(#bfc-grad-${i})`)
      // fill-opacity is the resting value; element opacity is the solo
      // channel. Keeping them apart means the solo fade never has to know what
      // the band's resting opacity was.
      .style('transition', soloFadeTransition())
      .attr('fill-opacity', 0.85);

    // Highlight stroke along the top edge of each band
    layerGroup
      .append('path')
      .attr('class', 'bfc-band-stroke')
      .attr('d', (d: any) => makeExtendedLine(d, (pt: any) => y(pt[1])))
      .style('fill', 'none')
      .style('stroke', (_d, i) => {
        const [c0] = getGradient(categoryNames[i], i);
        return c0;
      })
      .style('stroke-width', 1.5)
      // 0.7 rather than 0.6: this used to also carry
      // `filter: drop-shadow(0 0 2px rgba(0,0,0,0.15))`. The solo effect below
      // rewrites this path's `d` on every frame of a 320ms d3 transition, and
      // an SVG filter means the filter region is recomputed and the shadow
      // re-rasterized every one of those frames — on the CPU, in the Android
      // WebView. A 2px shadow at 15% alpha over a filled band was doing almost
      // nothing visually; the slightly stronger stroke covers the separation
      // it provided, for free.
      .style('transition', soloFadeTransition())
      .style('stroke-opacity', 0.7);

    // ── Solo overlay paths ───────────────────────────────────────────────────
    // Invisible twins of the two paths above, used by the solo effect further
    // down. They exist so that soloing a budget never has to MUTATE the `d` of
    // a visible path.
    //
    // The solo transition used to interpolate `d` as a string, every frame, for
    // 320ms: d3.interpolateString over a long CatmullRom path, then
    // setAttribute, forcing Blink to re-parse and re-tessellate the geometry —
    // all on the main thread, concurrently with the CSS card expand, which is
    // itself animating two layout properties. Two per-frame costs fighting for
    // the same frame budget on a 120Hz phone.
    //
    // Cross-fading two static paths instead means the shape is computed once
    // and only opacity animates, which the compositor can do. The `d` of these
    // twins is assigned while they are fully transparent, so swapping geometry
    // is never visible.
    //
    // Their fill-opacity / stroke-opacity are the *soloed* values and never
    // move; the element opacity below is what fades, for the reason in the
    // note on soloFadeTransition().
    layerGroup
      .append('path')
      .attr('class', 'bfc-solo-band')
      .style('fill', (_d, i) => `url(#bfc-grad-${i})`)
      .attr('fill-opacity', 0.95)
      .style('transition', soloFadeTransition())
      .style('opacity', 0);

    layerGroup
      .append('path')
      .attr('class', 'bfc-solo-stroke')
      .style('fill', 'none')
      .style('stroke', (_d, i) => {
        const [c0] = getGradient(categoryNames[i], i);
        return c0;
      })
      .style('stroke-width', 1.5)
      .style('stroke-opacity', 0.9)
      .style('transition', soloFadeTransition())
      .style('opacity', 0);

    // ── Savings area: hatched white region between top of bands and income line ──
    // Income threshold Y position (must be computed before savings area uses it)
    const budgetY = y(thresholdValue);

    // Create a hatched pattern for the savings area (mirroring budget projected bars)
    const savingsPattern = defs.append('pattern')
      .attr('id', 'bfc-savings-hatch')
      .attr('patternUnits', 'userSpaceOnUse')
      .attr('width', 6)
      .attr('height', 6)
      .attr('patternTransform', 'rotate(45)');
    savingsPattern.append('line')
      .attr('x1', 0).attr('y1', 0).attr('x2', 0).attr('y2', 6)
      .attr('stroke', isDarkTheme ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.06)')
      .attr('stroke-width', 1.5);

    // Build savings area path: top of stacked bands → income threshold (extended to edges)
    const savingsPts = chartData.map(d => ({
      x: x(d.month) || 0,
      y0: y(d.total),
      y1: budgetY,
    }));
    savingsPts.unshift({ x: 0, y0: savingsPts[0].y0, y1: budgetY });
    savingsPts.push({ x: innerWidth, y0: savingsPts[savingsPts.length - 1].y0, y1: budgetY });

    const extSavingsPath = d3.area<{ x: number; y0: number; y1: number }>()
      .x(d => d.x).y0(d => d.y0).y1(d => d.y1)
      .curve(d3.curveCatmullRom.alpha(0.5))(savingsPts) || '';

    svg.append('path')
      .attr('class', 'bfc-savings')
      .attr('d', extSavingsPath)
      .style('fill', 'url(#bfc-savings-hatch)')
      .style('transition', soloFadeTransition())
      .attr('fill-opacity', 0.6);

    // Income threshold line (dotted, stronger)
    svg
      .append('line')
      .attr('class', 'bfc-income-line')
      .attr('x1', 0)
      .attr('x2', innerWidth)
      .attr('y1', budgetY)
      .attr('y2', budgetY)
      .attr('stroke', isDarkTheme ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.18)')
      .attr('stroke-width', 1.5)
      .attr('stroke-dasharray', '2 4')
      .style('transition', soloFadeTransition());

    // "INCOME" chip label on the threshold line
    const labelX = innerWidth - 40;
    const labelY = budgetY - 6;
    svg
      .append('rect')
      .attr('class', 'bfc-income-label')
      .attr('x', labelX - 38)
      .attr('y', labelY - 8)
      .attr('width', 42)
      .attr('height', 14)
      .attr('rx', 4)
      .attr('fill', isDarkTheme ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.04)')
      .attr('stroke', isDarkTheme ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)')
      .attr('stroke-width', 0.5)
      .style('transition', soloFadeTransition());
    svg
      .append('text')
      .attr('class', 'bfc-income-label')
      .attr('x', labelX - 17)
      .attr('y', labelY + 2)
      .attr('text-anchor', 'middle')
      .attr('font-size', '7px')
      .attr('font-weight', '700')
      .attr('letter-spacing', '0.08em')
      .attr('fill', isDarkTheme ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.4)')
      .style('transition', soloFadeTransition())
      .text('INCOME');
  }, [chartData, categoryNames, thresholdValue, theme]);

  // ── Highlighted budget band (when a budget is expanded below) ──
  const highlightedBudgetName = highlightedBudgetId ? (budgetNameById.get(highlightedBudgetId) || null) : null;
  // Written in an effect rather than during render: the d3 event handlers read
  // this ref to suppress interaction while a budget is soloed, and a render
  // that React discards must not leave the ref pointing at uncommitted state.
  useEffect(() => {
    highlightedRef.current = highlightedBudgetName;
  }, [highlightedBudgetName]);

  // Totals for the highlighted budget, in the month on screen — not in this
  // one. The pill above the chart sits beside vials that are already showing
  // the selected month, and two different months in one glance is worse than
  // either of them alone.
  const highlightedTotals = useMemo(() => {
    if (!highlightedBudgetId) return null;
    const budget = safeBudgets.find(b => b.id === highlightedBudgetId);
    if (!budget) return null;

    let spent = 0;
    let projected = 0;
    for (const tx of safeTransactions) {
      if (tx.budget_id !== highlightedBudgetId) continue;
      const rawDate = tx.date;
      if (!rawDate || rawDate.slice(0, 7) !== selectedMonthKey) continue;
      const amt = Number(tx.amount) || 0;
      if (tx.is_projected) {
        projected += amt;
      } else {
        spent += amt;
      }
    }

    return { spent, projected, limit: budget.totalLimit };
  }, [highlightedBudgetId, safeBudgets, safeTransactions, selectedMonthKey]);

  // The rail's own seven keys, from the same calendar the chart data uses.
  // Kept separate from chartData so the rail does not depend on the SVG having
  // been built, and so a month with nothing in it still gets its button.
  const monthKeys = useMemo(() => buildMonthWindow(currentMonthKey), [currentMonthKey]);
  const selectedMonthIndex = Math.max(0, monthKeys.indexOf(selectedMonthKey));
  const isViewingCurrentMonth = selectedMonthKey === currentMonthKey;

  const highlightedCatIndex = highlightedBudgetName ? categoryNames.indexOf(highlightedBudgetName) : -1;
  const highlightedCatColor = highlightedBudgetName ? getBudgetColor(highlightedBudgetName, highlightedCatIndex) : null;

  // Apply band highlight/dim when a budget is expanded (separate from touch interaction)
  // Snap to solo view on budget open, reverse on close
  // Fades savings area & income line, shows per-month totals for the category
  useEffect(() => {
    if (!svgRef.current) return;
    const svgElement = d3.select(svgRef.current);
    const internals = chartInternalsRef.current;

    // Every fade below is a one-line opacity write. The CSS transition that
    // carries it was declared when each element was created (see
    // soloFadeTransition), on the same 320ms ease-out as the budget card's
    // expand — so the chart solos in lockstep with the card, without a d3
    // rAF loop competing for the frames the card's layout animation needs.
    // Remove any previous solo month labels
    svgElement.selectAll('.bfc-solo-label').remove();

    if (!highlightedBudgetName) {
      // Reset to defaults. Only opacities move now — the stacked bands' `d`
      // is never mutated, so there is nothing to restore and no risk of the
      // path/opacity transition conflict that used to leave bands invisible.
      // (`data-original-d` and the per-element .each() bookkeeping it needed
      // are gone with it.)
      // Both channels are restored together — the fade the eye follows, and
      // the fill/stroke opacity underneath it. Belt and braces against a band
      // that stays invisible: this file has been there.
      svgElement.selectAll('.bfc-band')
        .attr('fill-opacity', 0.85)
        .style('opacity', 1);
      svgElement.selectAll('.bfc-band-stroke')
        .style('stroke-opacity', 0.7)
        .style('opacity', 1);
      // Fade the solo overlays back out.
      svgElement.selectAll('.bfc-solo-band').style('opacity', 0);
      svgElement.selectAll('.bfc-solo-stroke').style('opacity', 0);
      // Restore savings & income
      svgElement.select('.bfc-savings').style('opacity', 1);
      svgElement.select('.bfc-income-line').style('opacity', 1);
      svgElement.selectAll('.bfc-income-label').style('opacity', 1);
      return;
    }

    // ── Solo snap: show only the highlighted band ──

    // Hide ALL stacked bands — including the highlighted one, whose shape is
    // now carried by the .bfc-solo-band overlay faded in below.
    svgElement.selectAll('.bfc-band').style('opacity', 0);
    svgElement.selectAll('.bfc-band-stroke').style('opacity', 0);

    // Fade out savings area and income line/label
    svgElement.select('.bfc-savings').style('opacity', 0);
    svgElement.select('.bfc-income-line').style('opacity', 0);
    svgElement.selectAll('.bfc-income-label').style('opacity', 0);

    if (!internals) return;
    const { stackedData, x, y, innerHeight, innerWidth } = internals;
    const highlightLayer = stackedData.find(l => l.key === highlightedBudgetName);
    if (!highlightLayer) return;

    // Morph band to solo view (from baseline, using only its own values, extended to edges)
    const soloPts = highlightLayer.map(d => ({
      x: x(d.data.month) || 0,
      y0: innerHeight,
      y1: y(d[1] - d[0]),
    }));
    soloPts.unshift({ x: 0, y0: innerHeight, y1: soloPts[0].y1 });
    soloPts.push({ x: innerWidth, y0: innerHeight, y1: soloPts[soloPts.length - 1].y1 });

    const soloPath = d3.area<{ x: number; y0: number; y1: number }>()
      .x(d => d.x).y0(d => d.y0).y1(d => d.y1)
      .curve(d3.curveCatmullRom.alpha(0.5))(soloPts) || '';

    const soloLinePts = soloPts.map(d => ({ x: d.x, y: d.y1 }));
    const soloStrokePath = d3.line<{ x: number; y: number }>()
      .x(d => d.x).y(d => d.y)
      .curve(d3.curveCatmullRom.alpha(0.5))(soloLinePts) || '';
    const highlightIdx = categoryNames.indexOf(highlightedBudgetName);

    // Cross-fade the solo shape in on its own overlay path rather than morphing
    // the visible band's `d`. The geometry is assigned instantly here — safe,
    // because the overlay is still at opacity 0 — and only opacity animates.
    // See the note where .bfc-solo-band is created.
    svgElement.selectAll('.bfc-solo-band')
      .filter((_d: any, i: number) => i === highlightIdx)
      .attr('d', soloPath)
      .style('opacity', 1);

    svgElement.selectAll('.bfc-solo-stroke')
      .filter((_d: any, i: number) => i === highlightIdx)
      .attr('d', soloStrokePath)
      .style('opacity', 1);

    // Show per-month totals for the highlighted category
    const isDark = theme === 'dark';
    const catColor = highlightedCatColor || (isDark ? '#6ee7b7' : '#059669');

    // Access the inner <g> group (first child g of the svg)
    const innerG = svgElement.select('g');

    highlightLayer.forEach((pt) => {
      const val = pt[1] - pt[0];
      if (val === 0) return;
      const xPos = x(pt.data.month) || 0;
      const yPos = y(val);

      innerG.append('text')
        .attr('class', 'bfc-solo-label')
        .attr('x', xPos)
        .attr('y', yPos - 8)
        .attr('text-anchor', 'middle')
        .attr('font-size', '9px')
        .attr('font-weight', '800')
        .attr('fill', catColor)
        // The fade-in is a CSS animation (`.bfc-solo-label` in index.css), not
        // a d3 transition. A transition would not have fired here anyway
        // without a forced style flush — the element is brand new — and a
        // freshly appended node cannot be handed to the compositor mid-fade
        // while JS is rewriting its opacity every frame.
        //
        // It still lands inside the card's 320ms: 120ms delay + 200ms fade.
        // The old `delay(200).duration(300)` ran the chart's rAF loop out to
        // 500ms, leaving the tail of the chart animation running alone after
        // the motion it accompanies had stopped, which read as a stutter at
        // the end of the expand.
        .text(`$${val.toFixed(0)}`);
    });
  }, [highlightedBudgetName, categoryNames, highlightedCatColor, theme]);

  // No data fallback
  if (chartData.length === 0) {
    return (
      <div id="spending-flow-chart" className="w-full mb-2">
        <div className="bg-white/70 dark:bg-slate-900/70 backdrop-blur-md rounded-3xl p-4 border-2 border-slate-100 dark:border-slate-800 shadow-lg">
          <div className="mb-3">
            <h3 className="text-[10px] font-semibold tracking-wide text-slate-400 dark:text-slate-500">
              Spending Flow
            </h3>
          </div>
          <div className="text-center py-8">
            <p className="text-sm font-bold text-slate-500 dark:text-slate-400 mb-2">No spending data yet</p>
            <p className="text-xs text-slate-400 dark:text-slate-500">
              Once you add transactions, your spending flow will appear here.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div id="spending-flow-chart" className="w-full mb-1 shrink-0 px-4">
      <div className="relative" ref={wrapperRef}>
        {/* Chart container */}
        <div ref={containerRef} className="w-full relative">
          <div className="rounded-2xl p-0.5 overflow-hidden">
            <div className="bg-white dark:bg-slate-900/80 rounded-2xl overflow-hidden relative">
              {/* Edge fade overlays */}
              <div className="absolute left-0 top-0 bottom-0 w-10 z-20 pointer-events-none rounded-l-2xl" style={{ background: 'linear-gradient(to right, var(--chart-bg) 30%, transparent)' }} />
              <div className="absolute right-0 top-0 bottom-0 w-10 z-20 pointer-events-none rounded-r-2xl" style={{ background: 'linear-gradient(to left, var(--chart-bg) 30%, transparent)' }} />
              <style>{`
                :root { --chart-bg: #ffffff; }
                .dark { --chart-bg: rgba(15, 23, 42, 0.8); }
              `}</style>
              {/* No touch handlers and no `touch-action: none`: the chart is
                  something to look at, and a swipe that starts on it scrolls
                  the page like a swipe anywhere else. */}
              <svg
                ref={svgRef}
                className="w-full h-auto overflow-visible relative z-10 select-none"
              />

              {/* Highlighted budget totals overlay */}
              {highlightedBudgetName && highlightedTotals && (
                <div className="absolute top-2 left-0 right-0 z-20 flex justify-center pointer-events-none transition-opacity duration-300">
                  <div
                    className={`flex items-center gap-3 px-3 py-1.5 rounded-full backdrop-blur-xl text-[10px] font-semibold ${
                      theme === 'dark'
                        ? 'bg-slate-800/90 shadow-lg shadow-black/30'
                        : 'bg-white/90 shadow-md shadow-slate-200/60'
                    }`}
                    style={{
                      borderWidth: '1.5px',
                      borderStyle: 'solid',
                      borderColor: highlightedCatColor
                        ? `${highlightedCatColor}40`
                        : theme === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)',
                    }}
                  >
                    <span
                      className="tracking-wide truncate max-w-[80px]"
                      style={{ color: highlightedCatColor || undefined }}
                    >
                      {highlightedBudgetName}
                    </span>
                    <span className={`${theme === 'dark' ? 'text-white/30' : 'text-slate-300'}`}>|</span>
                    <div className="flex items-center gap-1">
                      <span className={theme === 'dark' ? 'text-white/40' : 'text-slate-400'}>Spent</span>
                      <span className={theme === 'dark' ? 'text-white' : 'text-slate-900'}>${highlightedTotals.spent.toFixed(0)}</span>
                    </div>
                    {highlightedTotals.projected > 0 && (
                      <>
                        <span className={`${theme === 'dark' ? 'text-white/30' : 'text-slate-300'}`}>|</span>
                        <div className="flex items-center gap-1">
                          <span className={theme === 'dark' ? 'text-white/40' : 'text-slate-400'}>Proj</span>
                          <span className={theme === 'dark' ? 'text-white/60' : 'text-slate-500'}>${highlightedTotals.projected.toFixed(0)}</span>
                        </div>
                      </>
                    )}
                    <span className={`${theme === 'dark' ? 'text-white/30' : 'text-slate-300'}`}>|</span>
                    <div className="flex items-center gap-1">
                      <span className={theme === 'dark' ? 'text-white/40' : 'text-slate-400'}>Limit</span>
                      <span
                        className="font-bold"
                        style={{ color: highlightedCatColor || (theme === 'dark' ? '#ffffff' : '#0f172a') }}
                      >
                        ${highlightedTotals.limit.toFixed(0)}
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ── The month rail ──────────────────────────────────────────────
              Seven months, three back and three forward, each one tappable.
              HTML rather than SVG text, for three reasons: a button is the tap
              target a finger expects (and announces itself to a screen reader
              as one), the pill can be a real rounded-full element on the app's
              own 320ms curve instead of a rectangle drawn into the chart, and
              the labels stay out of the SVG that d3 tears down and rebuilds on
              every data change.

              The pill is ONE element that slides, rather than a background
              that turns on and off per button: a transform is the only way to
              move it that the compositor can take, and it makes the move read
              as the same pill going somewhere rather than two pills blinking.
          */}
          <div className="relative mt-1 flex" role="group" aria-label="Choose a month">
            <div
              aria-hidden="true"
              className="absolute inset-y-0 left-0 pointer-events-none motion-safe:transition-transform motion-safe:duration-[320ms] motion-safe:ease-[cubic-bezier(0.32,0.72,0.24,1)]"
              style={{
                width: `${100 / monthKeys.length}%`,
                transform: `translateX(${selectedMonthIndex * 100}%)`,
              }}
            >
              <div
                className={`mx-1 h-full rounded-full motion-safe:transition-colors motion-safe:duration-[320ms] ${
                  isViewingCurrentMonth
                    ? 'bg-emerald-500/15 dark:bg-emerald-400/15'
                    : 'bg-slate-400/20 dark:bg-slate-400/20'
                }`}
              />
            </div>

            {monthKeys.map((key) => {
              const isSelected = key === selectedMonthKey;
              const isNow = key === currentMonthKey;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => onSelectMonth(key)}
                  aria-pressed={isSelected}
                  aria-label={longMonthLabel(key)}
                  className={`relative flex-1 py-1.5 text-[10px] font-semibold tracking-[0.04em] active:scale-[0.97] motion-safe:transition-[color,transform] motion-safe:duration-[320ms] motion-safe:ease-[cubic-bezier(0.32,0.72,0.24,1)] ${
                    isSelected
                      ? isNow
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-slate-700 dark:text-slate-100'
                      : 'text-slate-400 dark:text-slate-500'
                  }`}
                >
                  {shortMonthName(key)}
                  {/* Where "now" is, while the pill is somewhere else. Without
                      it the rail says which month is on screen but not which
                      month it actually is, and every label looks equally like
                      today. */}
                  {isNow && !isSelected && (
                    <span
                      aria-hidden="true"
                      className="absolute left-1/2 -translate-x-1/2 bottom-0.5 w-1 h-1 rounded-full bg-emerald-500 dark:bg-emerald-400"
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

export default BudgetFlowChart;
