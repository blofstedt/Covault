import React, { useEffect, useRef, useState, useMemo } from 'react';
import * as d3 from 'd3';
import { BudgetCategory, Transaction } from '../../types';
import { getBudgetGradient, getBudgetColor } from '../../lib/budgetColors';

interface BudgetFlowChartProps {
  budgets: BudgetCategory[];
  transactions: Transaction[];
  theme?: 'light' | 'dark';
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

// Tooltip vertical positioning: base offset above chart + extra shift when thumb is near the top
const TOOLTIP_BASE_OFFSET = 100;
const TOOLTIP_MAX_THUMB_OFFSET = 50;
// Fallback maximum upward offset so the tooltip never escapes into the header
const TOOLTIP_MAX_UPWARD_FALLBACK = 140;

function formatMonthLabel(key: string): string {
  const [year, month] = key.split('-');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[parseInt(month, 10) - 1]} ${year}`;
}

function getWindowedMonthKeys(monthKeys: string[], currentMonthKey: string, maxMonths = 6): string[] {
  if (monthKeys.length <= maxMonths) return monthKeys;

  let currentIdx = monthKeys.indexOf(currentMonthKey);

  if (currentIdx < 0) {
    currentIdx = monthKeys.findIndex((key) => key > currentMonthKey);
    if (currentIdx < 0) currentIdx = monthKeys.length - 1;
  }

  const halfWindow = Math.floor(maxMonths / 2);
  let start = currentIdx - halfWindow;
  start = Math.max(0, Math.min(start, monthKeys.length - maxMonths));

  return monthKeys.slice(start, start + maxMonths);
}

const BudgetFlowChart: React.FC<BudgetFlowChartProps> = ({ budgets, transactions, theme = 'light' }) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [hoveredMonthIdx, setHoveredMonthIdx] = useState<number | null>(null);
  const [mouseCoords, setMouseCoords] = useState<{ x: number; y: number } | null>(null);
  const [chartWidth, setChartWidth] = useState(0);
  const [chartHeight, setChartHeight] = useState(0);
  const safeBudgets = Array.isArray(budgets) ? budgets : [];
  const safeTransactions = useMemo(() => {
    const txs = Array.isArray(transactions) ? transactions : [];
    return txs;
  }, [transactions]);

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

  // Aggregate transactions into monthly data by category
  const chartData: MonthlyBudgetData[] = useMemo(() => {
    if (categoryNames.length === 0) return [];

    // Group spending by "YYYY-MM" and category name
    const monthMap = new Map<string, Map<string, number>>();

    // Determine current month key
    const now = new Date();
    const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    for (const tx of safeTransactions) {
      const rawDate = tx.date;
      if (!rawDate || rawDate.length < 7) continue;

      // Extract YYYY-MM directly from the date string to avoid timezone shifts
      const txMonthKey = rawDate.slice(0, 7);

      // Include projected transactions only for the current month
      if (tx.is_projected) {
        if (txMonthKey !== currentMonthKey) continue;
      }

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

    // Sort month keys chronologically
    const sortedMonths = Array.from(monthMap.keys()).sort();

    // Keep at most 6 months and center current month when possible
    const displayMonths = getWindowedMonthKeys(sortedMonths, currentMonthKey, 6);

    // Build the data array
    const data = displayMonths.map((monthKey) => {
      const catMap = monthMap.get(monthKey)!;
      const entry: MonthlyBudgetData = {
        month: formatMonthLabel(monthKey),
        monthKey,
        total: 0,
        budgetLimit: totalBudgetLimit,
      };

      for (const name of categoryNames) {
        const val = catMap.get(name) || 0;
        entry[name] = val;
        entry.total += val;
      }

      return entry;
    });

    // If no transaction months exist, create a synthetic current-month entry
    // so the chart can still render its baseline.
    if (data.length === 0) {
      const entry: MonthlyBudgetData = {
        month: formatMonthLabel(currentMonthKey),
        monthKey: currentMonthKey,
        total: 0,
        budgetLimit: totalBudgetLimit,
      };
      for (const name of categoryNames) {
        entry[name] = 0;
      }
      data.push(entry);
    }

    return data;
  }, [safeTransactions, categoryNames, budgetNameById, totalBudgetLimit]);

  // Draw the D3 stacked area chart
  useEffect(() => {
    if (!svgRef.current || !containerRef.current || chartData.length === 0 || categoryNames.length === 0) return;

    const container = containerRef.current;
    const width = container.clientWidth;
    const height = Math.min(150, width * 0.35);
    const margin = { top: 12, right: 0, bottom: 20, left: 0 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;
    setChartWidth(width);
    setChartHeight(height);

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
      grad.append('stop').attr('offset', '0%').attr('stop-color', c0).attr('stop-opacity', 0.9);
      grad.append('stop').attr('offset', '100%').attr('stop-color', c1).attr('stop-opacity', 0.6);
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

    const x = d3.scalePoint().domain(chartData.map((d) => d.month)).range([0, innerWidth]).padding(0.1);

    const maxTotal = d3.max(chartData, (d) => d.total) || 1;
    const yMax = Math.max(maxTotal, totalBudgetLimit) * 1.15;

    const y = d3
      .scaleLinear()
      .domain([0, yMax])
      .range([innerHeight, 0]);

    const isDarkTheme = theme === 'dark';

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
        .attr('stroke', isDarkTheme ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)')
        .attr('stroke-width', 1);
    });

    const area = d3
      .area<d3.SeriesPoint<MonthlyBudgetData>>()
      .x((d) => x(d.data.month) || 0)
      .y0((d) => y(d[0]))
      .y1((d) => y(d[1]))
      .curve(d3.curveCatmullRom.alpha(0.5));

    // Draw stacked area bands
    const layerGroup = svg.selectAll('.bfc-layer').data(stackedData).enter().append('g').attr('class', 'bfc-layer');

    layerGroup
      .append('path')
      .attr('class', 'bfc-band')
      .attr('d', area)
      .style('fill', (_d, i) => `url(#bfc-grad-${i})`)
      .attr('fill-opacity', 0.75);

    // Budget limit line (dashed)
    const budgetY = y(totalBudgetLimit);
    svg
      .append('line')
      .attr('x1', 0)
      .attr('x2', innerWidth)
      .attr('y1', budgetY)
      .attr('y2', budgetY)
      .attr('stroke', isDarkTheme ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.12)')
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', '4 6');

    // Small "Budget" label on the threshold line
    svg
      .append('text')
      .attr('x', innerWidth - 4)
      .attr('y', budgetY - 4)
      .attr('text-anchor', 'end')
      .attr('font-size', '7px')
      .attr('font-weight', '700')
      .attr('letter-spacing', '0.1em')
      .attr('fill', isDarkTheme ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.2)')
      .text('LIMIT');

    // Month labels on the x-axis
    chartData.forEach((d) => {
      const xPos = x(d.month) || 0;
      svg
        .append('text')
        .attr('x', xPos)
        .attr('y', innerHeight + 14)
        .attr('text-anchor', 'middle')
        .attr('font-size', '8px')
        .attr('font-weight', '600')
        .attr('letter-spacing', '0.05em')
        .attr('fill', isDarkTheme ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.3)')
        .text(d.month.split(' ')[0]);
    });

    // Scrubber line
    const scrubber = svg
      .append('line')
      .attr('y1', 0)
      .attr('y2', innerHeight)
      .attr('stroke', isDarkTheme ? '#ffffff' : '#334155')
      .attr('stroke-width', 1)
      .style('opacity', 0);

    // Dot on the scrubber
    const scrubberDot = svg
      .append('circle')
      .attr('r', 3)
      .attr('fill', isDarkTheme ? '#ffffff' : '#334155')
      .style('opacity', 0);

    // Shared update function for month/category selection
    const updateSelection = (monthIdx: number, my: number) => {
      const xPos = x(chartData[monthIdx].month) || 0;

      let foundCat: string | null = null;
      for (const layer of stackedData) {
        const point = layer[monthIdx];
        const y0 = y(point[0]);
        const y1 = y(point[1]);
        if (my >= Math.min(y0, y1) && my <= Math.max(y0, y1)) {
          foundCat = layer.key;
          break;
        }
      }

      // If finger is outside all bands, find the closest category by vertical distance
      if (!foundCat) {
        let minDist = Infinity;
        for (const layer of stackedData) {
          const point = layer[monthIdx];
          const y0 = y(point[0]);
          const y1 = y(point[1]);
          const mid = (y0 + y1) / 2;
          const dist = Math.abs(my - mid);
          if (dist < minDist) {
            minDist = dist;
            foundCat = layer.key;
          }
        }
      }

      setActiveCategory(foundCat);
      setHoveredMonthIdx(monthIdx);
      setMouseCoords({ x: xPos + margin.left, y: my });

      scrubber.attr('x1', xPos).attr('x2', xPos).style('opacity', 0.3);

      // Position dot at top of total stack for this month
      const topY = y(chartData[monthIdx].total);
      scrubberDot.attr('cx', xPos).attr('cy', topY).style('opacity', 0.6);

      svg
        .selectAll('.bfc-band')
        .transition()
        .duration(100)
        .attr('fill-opacity', (d: any) => (foundCat && d.key === foundCat ? 0.95 : 0.25));
    };

    // Interaction handler for mouse events
    const handleInteraction = (event: any) => {
      const [mx, my] = d3.pointer(event, svg.node());
      const domain = x.domain();
      if (domain.length < 2) {
        setHoveredMonthIdx(0);
        setActiveCategory(categoryNames[0] || null);
        const xPos = x(chartData[0].month) || 0;
        setMouseCoords({ x: xPos + margin.left, y: my });
        scrubber.attr('x1', xPos).attr('x2', xPos).style('opacity', 0.3);
        return;
      }

      const step = innerWidth / (domain.length - 1);
      const index = Math.round(mx / step);
      const monthIdx = Math.max(0, Math.min(chartData.length - 1, index));

      updateSelection(monthIdx, my);
    };

    // Touch event handlers for drag gestures
    const handleTouchStart = (event: any) => {
      event.preventDefault();
      const touch = event.touches[0] || event.changedTouches[0];
      const [mx, my] = d3.pointer(touch, svg.node());
      const domain = x.domain();
      if (domain.length < 2) {
        setHoveredMonthIdx(0);
        setActiveCategory(categoryNames[0] || null);
        const xPos = x(chartData[0].month) || 0;
        setMouseCoords({ x: xPos + margin.left, y: my });
        scrubber.attr('x1', xPos).attr('x2', xPos).style('opacity', 0.3);
        return;
      }
      const step = innerWidth / (domain.length - 1);
      const index = Math.round(mx / step);
      const monthIdx = Math.max(0, Math.min(chartData.length - 1, index));
      updateSelection(monthIdx, my);
    };

    const handleTouchMove = (event: any) => {
      event.preventDefault();
      const touch = event.touches[0] || event.changedTouches[0];
      const [mx, my] = d3.pointer(touch, svg.node());
      const domain = x.domain();
      if (domain.length < 2) return;
      const step = innerWidth / (domain.length - 1);
      const index = Math.round(mx / step);
      const monthIdx = Math.max(0, Math.min(chartData.length - 1, index));
      updateSelection(monthIdx, my);
    };

    const handleEnd = () => {
      setActiveCategory(null);
      setHoveredMonthIdx(null);
      setMouseCoords(null);
      scrubber.style('opacity', 0);
      scrubberDot.style('opacity', 0);
      svg.selectAll('.bfc-band').transition().duration(300).attr('fill-opacity', 0.75);
    };

    svgElement.on('mousemove', handleInteraction).on('mouseleave', handleEnd);

    // Attach touch events directly to the SVG DOM node for proper passive: false handling
    const svgNode = svgRef.current;
    if (svgNode) {
      svgNode.addEventListener('touchstart', handleTouchStart, { passive: false });
      svgNode.addEventListener('touchmove', handleTouchMove, { passive: false });
      svgNode.addEventListener('touchend', handleEnd);
      svgNode.addEventListener('touchcancel', handleEnd);
    }

    return () => {
      svgElement.on('mousemove', null).on('mouseleave', null);
      if (svgNode) {
        svgNode.removeEventListener('touchstart', handleTouchStart, { passive: false } as EventListenerOptions);
        svgNode.removeEventListener('touchmove', handleTouchMove, { passive: false } as EventListenerOptions);
        svgNode.removeEventListener('touchend', handleEnd);
        svgNode.removeEventListener('touchcancel', handleEnd);
      }
    };
  }, [chartData, categoryNames, totalBudgetLimit, theme]);

  const activeMonthData = hoveredMonthIdx !== null ? chartData[hoveredMonthIdx] : null;
  const activeCatAmount =
    activeCategory && activeMonthData && typeof activeMonthData[activeCategory] === 'number'
      ? (activeMonthData[activeCategory] as number)
      : 0;
  const categoryPercentage =
    activeCategory && activeMonthData && activeMonthData.total > 0
      ? Math.round((activeCatAmount / activeMonthData.total) * 100)
      : 0;

  const activeCatIndex = activeCategory ? categoryNames.indexOf(activeCategory) : -1;
  const activeCatGradient = activeCategory ? getGradient(activeCategory, activeCatIndex) : null;
  const activeCatColor = activeCategory ? getBudgetColor(activeCategory, activeCatIndex) : null;

  // Dynamically compute the maximum upward offset so the tooltip never goes above
  // the bottom of the "Remaining Balance" header.
  const tooltipMaxUpward = useMemo(() => {
    if (!wrapperRef.current) return TOOLTIP_MAX_UPWARD_FALLBACK;
    const balanceHeader = document.getElementById('balance-header');
    if (!balanceHeader) return TOOLTIP_MAX_UPWARD_FALLBACK;
    const wrapperTop = wrapperRef.current.getBoundingClientRect().top;
    const headerBottom = balanceHeader.getBoundingClientRect().bottom;
    const available = wrapperTop - headerBottom;
    return Math.max(0, available);
    // Re-compute whenever the tooltip becomes visible (activeCategory changes)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCategory, chartHeight]);

  // No data fallback
  if (chartData.length === 0) {
    return (
      <div id="spending-flow-chart" className="w-full mb-2">
        <div className="bg-white/70 dark:bg-slate-900/70 backdrop-blur-md rounded-3xl p-4 border-2 border-slate-100 dark:border-slate-800 shadow-lg">
          <div className="mb-3">
            <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">
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
    <div id="spending-flow-chart" className="w-full mb-1 shrink-0">
      <div className="relative" ref={wrapperRef}>
        {/* Tooltip card — moves up as the user's thumb moves up so it never obscures the card */}
        {activeCategory && mouseCoords && activeMonthData && (
          <div
            className="absolute z-50 pointer-events-none transition-all duration-200 ease-out"
            style={{
              transform: `translate(${mouseCoords.x}px, 0px)`,
              left: 0,
              top: `${Math.max(-tooltipMaxUpward, -TOOLTIP_BASE_OFFSET - (chartHeight > 0 ? (1 - mouseCoords.y / chartHeight) * TOOLTIP_MAX_THUMB_OFFSET : 0))}px`,
            }}
          >
            <div
              className={`absolute p-2.5 w-[150px] backdrop-blur-xl rounded-xl flex flex-col gap-2 ${
                theme === 'dark'
                  ? 'bg-slate-900/95 shadow-[0_20px_50px_-10px_rgba(0,0,0,0.9)]'
                  : 'bg-white/95 shadow-[0_20px_50px_-10px_rgba(0,0,0,0.15)]'
              } ${
                mouseCoords.x > chartWidth * 0.7
                  ? '-translate-x-[130%]'
                  : mouseCoords.x < chartWidth * 0.3
                    ? 'translate-x-[30%]'
                    : mouseCoords.x > chartWidth / 2
                      ? '-translate-x-[125%]'
                      : 'translate-x-[25%]'
              }`}
              style={{
                borderWidth: '1.5px',
                borderStyle: 'solid',
                borderColor: activeCatColor || (theme === 'dark' ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.1)'),
              }}
            >
              <div className="flex justify-between items-center">
                <span
                  className="text-[10px] font-black uppercase tracking-widest"
                  style={{ color: activeCatColor || (theme === 'dark' ? '#6ee7b7' : '#059669') }}
                >
                  {activeMonthData.month}
                </span>
                <div
                  className={`px-2 py-0.5 rounded-full border text-[8px] font-black uppercase tracking-widest ${
                    activeMonthData.total > totalBudgetLimit
                      ? theme === 'dark'
                        ? 'bg-white text-[#030a08] border-white'
                        : 'bg-slate-900 text-white border-slate-900'
                      : theme === 'dark'
                        ? 'text-white/60 border-white/20'
                        : 'text-slate-400 border-slate-200'
                  }`}
                >
                  {activeMonthData.total > totalBudgetLimit ? 'Over' : 'Safe'}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <h4 className={`text-[8px] font-bold tracking-widest uppercase truncate mb-0.5 ${theme === 'dark' ? 'text-white/40' : 'text-slate-400'}`}>
                    {activeCategory}
                  </h4>
                  <div className={`text-base font-black tracking-tighter leading-tight ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>
                    ${activeCatAmount.toFixed(0)}
                  </div>
                </div>
                <div className={`w-1 h-8 rounded-full relative overflow-hidden shrink-0 ${theme === 'dark' ? 'bg-white/10' : 'bg-slate-200'}`}>
                  <div
                    className="absolute bottom-0 left-0 w-full rounded-full transition-all duration-500 ease-out"
                    style={{
                      height: `${categoryPercentage}%`,
                      background: activeCatGradient
                        ? `linear-gradient(to top, ${activeCatGradient[1]}, ${activeCatGradient[0]})`
                        : '#10b981',
                    }}
                  />
                </div>
              </div>

              <div className={`pt-1.5 border-t grid grid-cols-2 gap-2 ${theme === 'dark' ? 'border-white/10' : 'border-slate-200'}`}>
                <div className="flex flex-col">
                  <span className={`text-[7px] font-black uppercase tracking-tighter mb-0.5 ${theme === 'dark' ? 'text-white/30' : 'text-slate-400'}`}>Part</span>
                  <span className={`text-[11px] font-black ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>{categoryPercentage}%</span>
                </div>
                <div className="flex flex-col text-right">
                  <span className={`text-[7px] font-black uppercase tracking-tighter mb-0.5 ${theme === 'dark' ? 'text-white/30' : 'text-slate-400'}`}>Total</span>
                  <span
                    className={`text-[11px] font-black ${
                      activeMonthData.total > totalBudgetLimit
                        ? theme === 'dark'
                          ? 'text-white underline decoration-white/40 underline-offset-4'
                          : 'text-slate-900 underline decoration-slate-300 underline-offset-4'
                        : ''
                    }`}
                    style={activeMonthData.total <= totalBudgetLimit && activeCatColor ? { color: activeCatColor } : undefined}
                  >
                    ${activeMonthData.total.toFixed(0)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Chart container */}
        <div ref={containerRef} className="w-full relative">
          <div className="rounded-2xl p-0.5 overflow-hidden">
            <div className="bg-white dark:bg-slate-900/80 rounded-2xl overflow-hidden relative">
              <svg
                ref={svgRef}
                className="w-full h-auto overflow-visible cursor-crosshair relative z-10 select-none"
                style={{ touchAction: 'none' }}
              />
            </div>
          </div>

        </div>
      </div>
    </div>
  );
};

export default BudgetFlowChart;
