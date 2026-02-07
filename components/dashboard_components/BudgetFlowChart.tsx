import React, { useEffect, useRef, useState, useMemo } from 'react';
import * as d3 from 'd3';
import { BudgetCategory, Transaction, TransactionLabel } from '../../types';

interface BudgetFlowChartProps {
  budgets: BudgetCategory[];
  transactions: Transaction[];
  isTutorialMode?: boolean;
  theme?: 'light' | 'dark';
}

interface MonthlyBudgetData {
  month: string;
  total: number;
  budgetLimit: number;
  [key: string]: number | string;
}

// Saturated monochromatic teal palette for budget categories
const CATEGORY_GRADIENTS: Record<string, [string, string]> = {
  Housing:   ['#064e3b', '#0d9488'],
  Groceries: ['#1EA078', '#059669'],
  Transport: ['#059669', '#10b981'],
  Utilities: ['#34d399', '#10b981'],
  Leisure:   ['#0d9488', '#1EA078'],
  Services:  ['#047857', '#34d399'],
  Other:     ['#10b981', '#6ee7b7'],
};

// Fallback gradient for unknown category names
const FALLBACK_GRADIENTS: [string, string][] = [
  ['#064e3b', '#0d9488'],
  ['#1EA078', '#059669'],
  ['#059669', '#10b981'],
  ['#34d399', '#10b981'],
  ['#0d9488', '#1EA078'],
  ['#10b981', '#6ee7b7'],
];

function getGradient(name: string, index: number): [string, string] {
  return CATEGORY_GRADIENTS[name] || FALLBACK_GRADIENTS[index % FALLBACK_GRADIENTS.length];
}

function formatMonthLabel(key: string): string {
  const [year, month] = key.split('-');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[parseInt(month, 10) - 1]} ${year}`;
}

const BudgetFlowChart: React.FC<BudgetFlowChartProps> = ({ budgets, transactions, isTutorialMode = false, theme = 'dark' }) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [hoveredMonthIdx, setHoveredMonthIdx] = useState<number | null>(null);
  const [mouseCoords, setMouseCoords] = useState<{ x: number; y: number } | null>(null);
  const [chartWidth, setChartWidth] = useState(0);

  const safeBudgets = Array.isArray(budgets) ? budgets : [];
  const safeTransactions = useMemo(() => {
    const txs = Array.isArray(transactions) ? transactions : [];
    if (isTutorialMode && txs.length === 0 && safeBudgets.length > 0) {
      // Generate placeholder transactions so the chart renders during tutorial
      const now = new Date();
      const placeholders: Transaction[] = [];
      for (let m = 5; m >= 0; m--) {
        const d = new Date(now.getFullYear(), now.getMonth() - m, 15);
        safeBudgets.forEach((b, i) => {
          const base = (b.totalLimit || 500) * (0.3 + Math.abs(Math.sin(m + i)) * 0.5);
          placeholders.push({
            id: `__tutorial_chart_${m}_${i}__`,
            vendor: 'Tutorial',
            amount: Math.round(base * 100) / 100,
            date: d.toISOString(),
            budget_id: b.id,
            user_id: '__tutorial__',
            is_projected: false,
            label: TransactionLabel.MANUAL,
            created_at: d.toISOString(),
          });
        });
      }
      return placeholders;
    }
    return txs;
  }, [transactions, isTutorialMode, safeBudgets]);

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
      const date = rawDate ? new Date(rawDate) : null;
      if (!date || isNaN(date.getTime())) continue;

      // Include projected transactions only for the current month
      if (tx.is_projected) {
        const txMonthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        if (txMonthKey !== currentMonthKey) continue;
      }

      const amount = Number(tx.amount) || 0;
      if (amount === 0) continue;

      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

      if (!monthMap.has(monthKey)) {
        monthMap.set(monthKey, new Map<string, number>());
      }
      const catMap = monthMap.get(monthKey)!;

      // Handle splits
      if (tx.splits && tx.splits.length > 0) {
        for (const split of tx.splits) {
          const catName = budgetNameById.get(split.budget_id) || 'Other';
          catMap.set(catName, (catMap.get(catName) || 0) + (split.amount || 0));
        }
      } else {
        const catName = tx.budget_id ? (budgetNameById.get(tx.budget_id) || 'Other') : 'Other';
        catMap.set(catName, (catMap.get(catName) || 0) + amount);
      }
    }

    // Sort month keys chronologically
    const sortedMonths = Array.from(monthMap.keys()).sort();

    // Build the data array
    const data = sortedMonths.map((monthKey) => {
      const catMap = monthMap.get(monthKey)!;
      const entry: MonthlyBudgetData = {
        month: formatMonthLabel(monthKey),
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

    // If no spending data, create a synthetic current-month entry with zero spending
    // so the chart always renders the budget corridor and threshold lines
    if (data.length === 0) {
      const entry: MonthlyBudgetData = {
        month: formatMonthLabel(currentMonthKey),
        total: 0,
        budgetLimit: totalBudgetLimit,
      };
      for (const name of categoryNames) {
        entry[name] = 0;
      }
      data.push(entry);
    }

    // If only one month of data, prepend a synthetic prior month with zero spending
    // so the chart renders a flat band without mislabeling the actual month
    if (data.length === 1) {
      const [labelMonth, labelYear] = data[0].month.split(' ');
      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const mIdx = monthNames.indexOf(labelMonth);
      const prevMonth = mIdx === 0 ? 11 : mIdx - 1;
      const prevYear = mIdx === 0 ? String(parseInt(labelYear, 10) - 1) : labelYear;
      const priorEntry: MonthlyBudgetData = {
        month: `${monthNames[prevMonth]} ${prevYear}`,
        total: 0,
        budgetLimit: totalBudgetLimit,
      };
      for (const name of categoryNames) {
        priorEntry[name] = 0;
      }
      data.unshift(priorEntry);
    }

    return data;
  }, [safeTransactions, categoryNames, budgetNameById, totalBudgetLimit]);

  // Draw the D3 streamgraph
  useEffect(() => {
    if (!svgRef.current || !containerRef.current || chartData.length === 0 || categoryNames.length === 0) return;

    const container = containerRef.current;
    const width = container.clientWidth;
    const height = Math.min(150, width * 0.35);
    setChartWidth(width);

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
      grad.append('stop').attr('offset', '0%').attr('stop-color', c0);
      grad.append('stop').attr('offset', '100%').attr('stop-color', c1);
    });

    // Frosted blur filter for spillover zones
    defs
      .append('filter')
      .attr('id', 'bfc-frost')
      .append('feGaussianBlur')
      .attr('in', 'SourceGraphic')
      .attr('stdDeviation', '8');

    const svg = svgElement.attr('viewBox', `0 0 ${width} ${height}`).append('g');

    const stack = d3
      .stack<MonthlyBudgetData>()
      .keys(categoryNames)
      .value((d, key) => (typeof d[key] === 'number' ? (d[key] as number) : 0))
      .offset(d3.stackOffsetSilhouette)
      .order(d3.stackOrderInsideOut);

    const stackedData = stack(chartData);

    const x = d3.scalePoint().domain(chartData.map((d) => d.month)).range([0, width]);

    const maxTotal = d3.max(chartData, (d) => d.total) || 1;
    // Ensure spending bands are visible: cap so spending is ≥ ~12% of chart height
    const baseView = Math.max(maxTotal, totalBudgetLimit) * 1.3;
    const maxViewForVisibility = maxTotal * 8;
    const viewLimit = Math.min(baseView, maxViewForVisibility);

    const y = d3
      .scaleLinear()
      .domain([-viewLimit / 2, viewLimit / 2])
      .range([height, 0]);

    const budgetYTop = y(totalBudgetLimit / 2);
    const budgetYBottom = y(-totalBudgetLimit / 2);

    // Clip paths for the "danger zone" (outside budget corridor)
    const clipTop = defs.append('clipPath').attr('id', 'bfc-clip-top');
    clipTop.append('rect').attr('x', 0).attr('y', 0).attr('width', width).attr('height', budgetYTop);

    const clipBottom = defs.append('clipPath').attr('id', 'bfc-clip-bottom');
    clipBottom
      .append('rect')
      .attr('x', 0)
      .attr('y', budgetYBottom)
      .attr('width', width)
      .attr('height', height - budgetYBottom);

    // Use theme from props
    const isDarkTheme = theme === 'dark';

    // Corridor background (safe zone)
    svg
      .append('rect')
      .attr('x', 0)
      .attr('y', budgetYTop)
      .attr('width', width)
      .attr('height', budgetYBottom - budgetYTop)
      .attr('fill', isDarkTheme ? '#0f172a' : '#f1f5f9');

    const area = d3
      .area<d3.SeriesPoint<MonthlyBudgetData>>()
      .x((d) => x(d.data.month) || 0)
      .y0((d) => y(d[0]))
      .y1((d) => y(d[1]))
      .curve(d3.curveMonotoneX);

    // Main budget bands (safe zone)
    const layerGroup = svg.selectAll('.bfc-layer').data(stackedData).enter().append('g').attr('class', 'bfc-layer');

    layerGroup
      .append('path')
      .attr('class', 'bfc-band')
      .attr('d', area)
      .style('fill', (_d, i) => `url(#bfc-grad-${i})`)
      .attr('stroke', 'rgba(255, 255, 255, 0.05)')
      .attr('stroke-width', '0.5px')
      .attr('fill-opacity', 0.95);

    // Spillover bands (frosted white in danger zones)
    const spillTop = svg.append('g').attr('clip-path', 'url(#bfc-clip-top)').attr('filter', 'url(#bfc-frost)');
    const spillBottom = svg
      .append('g')
      .attr('clip-path', 'url(#bfc-clip-bottom)')
      .attr('filter', 'url(#bfc-frost)');

    // Spillover color: white in dark theme, coral/red in light theme
    const spillColor = isDarkTheme ? '#ffffff' : '#ef4444';

    [spillTop, spillBottom].forEach((group) => {
      group
        .selectAll('.bfc-spill')
        .data(stackedData)
        .enter()
        .append('path')
        .attr('class', 'bfc-spill')
        .attr('d', area)
        .attr('fill', spillColor)
        .attr('fill-opacity', 1.0);
    });

    // Glass panels over the danger zones
    const glassColor = isDarkTheme ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.04)';
    svg
      .append('rect')
      .attr('x', 0)
      .attr('y', 0)
      .attr('width', width)
      .attr('height', budgetYTop)
      .attr('fill', glassColor);

    svg
      .append('rect')
      .attr('x', 0)
      .attr('y', budgetYBottom)
      .attr('width', width)
      .attr('height', height - budgetYBottom)
      .attr('fill', glassColor);

    // Dashed budget threshold lines
    const thresholdColor = isDarkTheme ? '#6ee7b7' : '#059669';
    [budgetYTop, budgetYBottom].forEach((yPos) => {
      svg
        .append('line')
        .attr('x1', 0)
        .attr('x2', width)
        .attr('y1', yPos)
        .attr('y2', yPos)
        .attr('stroke', thresholdColor)
        .attr('stroke-width', 1.5)
        .attr('stroke-dasharray', '6 10')
        .attr('opacity', 0.7);
    });

    // Scrubber line
    const scrubber = svg
      .append('line')
      .attr('y1', 0)
      .attr('y2', height)
      .attr('stroke', isDarkTheme ? '#ffffff' : '#334155')
      .attr('stroke-width', 1.5)
      .style('opacity', 0);

    // Interaction handler
    const handleInteraction = (event: any) => {
      const [mx, my] = d3.pointer(event, svg.node());
      const domain = x.domain();
      if (domain.length < 2) {
        // Single-point: always select index 0
        setHoveredMonthIdx(0);
        setActiveCategory(categoryNames[0] || null);
        const xPos = x(chartData[0].month) || 0;
        setMouseCoords({ x: xPos, y: my });
        scrubber.attr('x1', xPos).attr('x2', xPos).style('opacity', 0.6);
        return;
      }

      const step = width / (domain.length - 1);
      const index = Math.round(mx / step);
      const monthIdx = Math.max(0, Math.min(chartData.length - 1, index));

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

      const xPos = x(chartData[monthIdx].month) || 0;
      setActiveCategory(foundCat);
      setHoveredMonthIdx(monthIdx);
      setMouseCoords({ x: xPos, y: my });

      scrubber.attr('x1', xPos).attr('x2', xPos).style('opacity', 0.6);

      svg
        .selectAll('.bfc-band')
        .transition()
        .duration(100)
        .attr('fill-opacity', (d: any) => (foundCat && d.key === foundCat ? 1.0 : 0.2));

      svg
        .selectAll('.bfc-spill')
        .transition()
        .duration(100)
        .attr('fill-opacity', (d: any) => (foundCat && d.key === foundCat ? 1.0 : 0.1));
    };

    const handleEnd = () => {
      setActiveCategory(null);
      setHoveredMonthIdx(null);
      setMouseCoords(null);
      scrubber.style('opacity', 0);
      svg.selectAll('.bfc-band').transition().duration(300).attr('fill-opacity', 0.95);
      svg.selectAll('.bfc-spill').transition().duration(300).attr('fill-opacity', 1.0);
    };

    svgElement.on('mousemove touchmove', handleInteraction).on('mouseleave touchend', handleEnd);

    return () => {
      svgElement.on('mousemove touchmove', null).on('mouseleave touchend', null);
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
      <div className="relative">
        {/* Tooltip card */}
        {activeCategory && mouseCoords && activeMonthData && (
          <div
            className="absolute z-50 pointer-events-none transition-all duration-200 ease-out"
            style={{
              transform: `translate(${mouseCoords.x}px, ${mouseCoords.y - 80}px)`,
              left: 0,
              top: 0,
            }}
          >
            <div
              className={`absolute p-2.5 w-[150px] bg-slate-900/95 backdrop-blur-xl border border-white/20 rounded-xl shadow-[0_20px_50px_-10px_rgba(0,0,0,0.9)] flex flex-col gap-2 ${
                mouseCoords.x > chartWidth / 2 ? '-translate-x-[110%]' : 'translate-x-[12%]'
              }`}
            >
              <div className="flex justify-between items-center">
                <span className="text-[10px] font-black uppercase tracking-widest text-emerald-400">
                  {activeMonthData.month}
                </span>
                <div
                  className={`px-2 py-0.5 rounded-full border text-[8px] font-black uppercase tracking-widest ${
                    activeMonthData.total > totalBudgetLimit
                      ? 'bg-white text-[#030a08] border-white'
                      : 'text-white/60 border-white/20'
                  }`}
                >
                  {activeMonthData.total > totalBudgetLimit ? 'Over' : 'Safe'}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <h4 className="text-[8px] font-bold tracking-widest uppercase text-white/40 truncate mb-0.5">
                    {activeCategory}
                  </h4>
                  <div className="text-base font-black tracking-tighter text-white leading-tight">
                    ${activeCatAmount.toFixed(0)}
                  </div>
                </div>
                <div className="w-1 h-8 bg-white/10 rounded-full relative overflow-hidden shrink-0">
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

              <div className="pt-1.5 border-t border-white/10 grid grid-cols-2 gap-2">
                <div className="flex flex-col">
                  <span className="text-[7px] font-black uppercase tracking-tighter text-white/30 mb-0.5">Part</span>
                  <span className="text-[11px] font-black text-white">{categoryPercentage}%</span>
                </div>
                <div className="flex flex-col text-right">
                  <span className="text-[7px] font-black uppercase tracking-tighter text-white/30 mb-0.5">Total</span>
                  <span
                    className={`text-[11px] font-black ${
                      activeMonthData.total > totalBudgetLimit
                        ? 'text-white underline decoration-white/40 underline-offset-4'
                        : 'text-emerald-400'
                    }`}
                  >
                    ${activeMonthData.total.toFixed(0)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Chart container */}
        <div ref={containerRef} className="w-full">
          <div className="bg-white/[0.03] dark:bg-white/[0.02] rounded-[2.5rem] p-0.5 shadow-xl border border-slate-200/30 dark:border-white/10 overflow-hidden">
            <div className="bg-slate-100 dark:bg-slate-900 rounded-[2.4rem] overflow-hidden border border-slate-200/20 dark:border-white/10 relative">
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
