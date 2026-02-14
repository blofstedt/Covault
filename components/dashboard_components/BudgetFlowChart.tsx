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

// Monochromatic teal palette for budget categories
const CATEGORY_COLORS: Record<string, string> = {
  Housing:   '#064e3b',
  Groceries: '#059669',
  Transport: '#10b981',
  Utilities: '#34d399',
  Leisure:   '#0d9488',
  Services:  '#047857',
  Other:     '#6ee7b7',
};

const FALLBACK_COLORS: string[] = [
  '#064e3b', '#059669', '#10b981', '#34d399', '#0d9488', '#6ee7b7',
];

function getCategoryColor(name: string, index: number): string {
  return CATEGORY_COLORS[name] || FALLBACK_COLORS[index % FALLBACK_COLORS.length];
}

function formatMonthLabel(key: string): string {
  const [year, month] = key.split('-');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[parseInt(month, 10) - 1]} ${year}`;
}

function formatShortMonth(label: string): string {
  return label.split(' ')[0];
}

const BudgetFlowChart: React.FC<BudgetFlowChartProps> = ({ budgets, transactions, isTutorialMode = false, theme = 'light' }) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [selectedMonthIdx, setSelectedMonthIdx] = useState<number | null>(null);
  const safeBudgets = Array.isArray(budgets) ? budgets : [];
  const safeTransactions = useMemo(() => {
    const txs = Array.isArray(transactions) ? transactions : [];
    if (isTutorialMode && txs.length === 0 && safeBudgets.length > 0) {
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

  const budgetNameById = useMemo(() => {
    const map = new Map<string, string>();
    safeBudgets.forEach((b) => map.set(b.id, b.name));
    return map;
  }, [safeBudgets]);

  const categoryNames = useMemo(() => {
    const names = safeBudgets.map((b) => b.name);
    return names.length > 0 ? names : [];
  }, [safeBudgets]);

  const totalBudgetLimit = useMemo(() => {
    return safeBudgets.reduce((sum, b) => sum + (b.totalLimit || 0), 0);
  }, [safeBudgets]);

  const chartData: MonthlyBudgetData[] = useMemo(() => {
    if (categoryNames.length === 0) return [];

    const monthMap = new Map<string, Map<string, number>>();
    const now = new Date();
    const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    for (const tx of safeTransactions) {
      const rawDate = tx.date;
      if (!rawDate || rawDate.length < 7) continue;

      const txMonthKey = rawDate.slice(0, 7);

      if (tx.is_projected) {
        if (txMonthKey !== currentMonthKey) continue;
      }

      const amount = Number(tx.amount) || 0;
      if (amount === 0) continue;

      if (!monthMap.has(txMonthKey)) {
        monthMap.set(txMonthKey, new Map<string, number>());
      }
      const catMap = monthMap.get(txMonthKey)!;

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

    const sortedMonths = Array.from(monthMap.keys()).sort();

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

    return data;
  }, [safeTransactions, categoryNames, budgetNameById, totalBudgetLimit]);

  // Draw the D3 stacked bar chart
  useEffect(() => {
    if (!svgRef.current || !containerRef.current || chartData.length === 0 || categoryNames.length === 0) return;

    const container = containerRef.current;
    const width = container.clientWidth;
    const height = Math.min(160, width * 0.4);
    const margin = { top: 8, right: 12, bottom: 22, left: 12 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    const svgElement = d3.select(svgRef.current);
    svgElement.selectAll('*').remove();

    const isDarkTheme = theme === 'dark';

    const svg = svgElement
      .attr('viewBox', `0 0 ${width} ${height}`)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    // Scales
    const x = d3
      .scaleBand()
      .domain(chartData.map((d) => d.month))
      .range([0, innerWidth])
      .padding(0.35);

    const maxVal = Math.max(d3.max(chartData, (d) => d.total) || 1, totalBudgetLimit);
    const y = d3.scaleLinear().domain([0, maxVal * 1.1]).range([innerHeight, 0]);

    // Stack data
    const stack = d3
      .stack<MonthlyBudgetData>()
      .keys(categoryNames)
      .value((d, key) => (typeof d[key] === 'number' ? (d[key] as number) : 0))
      .order(d3.stackOrderNone);

    const stackedData = stack(chartData);

    // Budget limit dashed line
    svg
      .append('line')
      .attr('x1', 0)
      .attr('x2', innerWidth)
      .attr('y1', y(totalBudgetLimit))
      .attr('y2', y(totalBudgetLimit))
      .attr('stroke', isDarkTheme ? '#6ee7b7' : '#059669')
      .attr('stroke-width', 1.5)
      .attr('stroke-dasharray', '6 4')
      .attr('opacity', 0.5);

    // Bars
    const barGroups = svg
      .selectAll('.bfc-bar-group')
      .data(stackedData)
      .enter()
      .append('g')
      .attr('class', 'bfc-bar-group');

    barGroups
      .selectAll('rect')
      .data((d) => d)
      .enter()
      .append('rect')
      .attr('class', 'bfc-bar')
      .attr('x', (d) => x(d.data.month) || 0)
      .attr('y', (d) => y(d[1]))
      .attr('height', (d) => Math.max(0, y(d[0]) - y(d[1])))
      .attr('width', x.bandwidth())
      .attr('rx', Math.min(6, x.bandwidth() / 2))
      .attr('ry', Math.min(6, x.bandwidth() / 2))
      .attr('fill', (_d, _i, nodes) => {
        const parentData = d3.select(nodes[0].parentNode as Element).datum() as d3.Series<MonthlyBudgetData, string>;
        const catIdx = categoryNames.indexOf(parentData.key);
        return getCategoryColor(parentData.key, catIdx);
      })
      .attr('fill-opacity', 0.85);

    // Month labels
    svg
      .selectAll('.bfc-month-label')
      .data(chartData)
      .enter()
      .append('text')
      .attr('class', 'bfc-month-label')
      .attr('x', (d) => (x(d.month) || 0) + x.bandwidth() / 2)
      .attr('y', innerHeight + 16)
      .attr('text-anchor', 'middle')
      .attr('font-size', '9px')
      .attr('font-weight', '800')
      .attr('letter-spacing', '0.05em')
      .attr('fill', isDarkTheme ? '#64748b' : '#94a3b8')
      .text((d) => formatShortMonth(d.month));

    // Interaction: tap/hover on bars to select a month
    const overlay = svg
      .selectAll('.bfc-overlay')
      .data(chartData)
      .enter()
      .append('rect')
      .attr('class', 'bfc-overlay')
      .attr('x', (d) => (x(d.month) || 0) - x.step() * x.padding() / 2)
      .attr('y', 0)
      .attr('width', x.step())
      .attr('height', innerHeight)
      .attr('fill', 'transparent')
      .attr('cursor', 'pointer');

    const handleSelect = (_event: any, _d: MonthlyBudgetData, idx: number) => {
      setSelectedMonthIdx((prev) => (prev === idx ? null : idx));

      // Highlight selected bar
      svg.selectAll('.bfc-bar').transition().duration(150).attr('fill-opacity', 0.85);
    };

    overlay.on('click', function (_event, d) {
      const idx = chartData.indexOf(d);
      handleSelect(_event, d, idx);
    });

    // Touch support
    const svgNode = svgRef.current;
    if (svgNode) {
      const handleTouch = (event: TouchEvent) => {
        event.preventDefault();
        const touch = event.touches[0] || event.changedTouches[0];
        const rect = svgNode.getBoundingClientRect();
        const mx = touch.clientX - rect.left - margin.left;
        const step = x.step();
        const idx = Math.floor(mx / step);
        const clampedIdx = Math.max(0, Math.min(chartData.length - 1, idx));
        setSelectedMonthIdx(clampedIdx);
      };

      svgNode.addEventListener('touchstart', handleTouch, { passive: false });
      svgNode.addEventListener('touchmove', handleTouch, { passive: false });

      return () => {
        svgNode.removeEventListener('touchstart', handleTouch);
        svgNode.removeEventListener('touchmove', handleTouch);
      };
    }
  }, [chartData, categoryNames, totalBudgetLimit, theme]);

  const activeMonthData = selectedMonthIdx !== null ? chartData[selectedMonthIdx] : null;

  // No data fallback
  if (chartData.length === 0) {
    return (
      <div id="spending-flow-chart" className="w-full mb-2">
        <div className="bg-white dark:bg-slate-900 rounded-[2.5rem] p-6 border border-slate-100 dark:border-slate-800/60 shadow-xl">
          <div className="mb-3">
            <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">
              Spending Overview
            </h3>
          </div>
          <div className="text-center py-8">
            <p className="text-sm font-bold text-slate-500 dark:text-slate-400 mb-2">No spending data yet</p>
            <p className="text-xs text-slate-400 dark:text-slate-500">
              Once you add transactions, your spending overview will appear here.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div id="spending-flow-chart" className="w-full mb-1 shrink-0">
      <div className="bg-white dark:bg-slate-900 rounded-[2.5rem] p-4 border border-slate-100 dark:border-slate-800/60 shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between px-2 mb-2">
          <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">
            Spending Overview
          </h3>
          {activeMonthData && (
            <div className="flex items-center gap-2">
              <span className={`text-[10px] font-black uppercase tracking-widest ${theme === 'dark' ? 'text-emerald-400' : 'text-emerald-600'}`}>
                {activeMonthData.month}
              </span>
              <span
                className={`px-2 py-0.5 rounded-full text-[8px] font-black uppercase tracking-widest border ${
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
              </span>
            </div>
          )}
        </div>

        {/* Chart */}
        <div ref={containerRef} className="w-full relative">
          <svg
            ref={svgRef}
            className="w-full h-auto overflow-visible select-none"
            style={{ touchAction: 'none' }}
          />
        </div>

        {/* Selected month details */}
        {activeMonthData && (
          <div className="px-2 pt-3 mt-1 border-t border-slate-100 dark:border-slate-800/60">
            <div className="flex items-baseline justify-between mb-2">
              <span className={`text-lg font-black tracking-tighter ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>
                ${activeMonthData.total.toFixed(0)}
              </span>
              <span className={`text-[10px] font-bold ${theme === 'dark' ? 'text-slate-500' : 'text-slate-400'}`}>
                / ${totalBudgetLimit} budget
              </span>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {categoryNames.map((name, i) => {
                const val = typeof activeMonthData[name] === 'number' ? (activeMonthData[name] as number) : 0;
                if (val === 0) return null;
                return (
                  <div key={name} className="flex items-center gap-1.5">
                    <div
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: getCategoryColor(name, i) }}
                    />
                    <span className={`text-[10px] font-bold ${theme === 'dark' ? 'text-slate-400' : 'text-slate-500'}`}>
                      {name}
                    </span>
                    <span className={`text-[10px] font-black ${theme === 'dark' ? 'text-slate-300' : 'text-slate-700'}`}>
                      ${val.toFixed(0)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default BudgetFlowChart;
