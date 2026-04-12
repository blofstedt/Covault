import React, { useEffect, useRef, useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import * as d3 from 'd3';
import { BudgetCategory, Transaction } from '../../types';
import { getBudgetGradient, getBudgetColor } from '../../lib/budgetColors';

interface BudgetFlowChartProps {
  budgets: BudgetCategory[];
  transactions: Transaction[];
  monthlyIncome?: number;
  theme?: 'light' | 'dark';
  highlightedBudgetId?: string | null;
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

// Tooltip vertical positioning is now handled by absolute positioning above the chart

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

const BudgetFlowChart: React.FC<BudgetFlowChartProps> = ({ budgets, transactions, monthlyIncome = 0, theme = 'light', highlightedBudgetId = null }) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [hoveredMonthIdx, setHoveredMonthIdx] = useState<number | null>(null);
  const [mouseCoords, setMouseCoords] = useState<{ x: number; y: number } | null>(null);
  const [screenCoords, setScreenCoords] = useState<{ x: number; y: number } | null>(null);
  const [chartWidth, setChartWidth] = useState(0);
  const [chartHeight, setChartHeight] = useState(0);
  // Refs to store chart internals for morph animation
  const chartInternalsRef = useRef<{
    stackedData: d3.Series<MonthlyBudgetData, string>[];
    x: d3.ScalePoint<string>;
    y: d3.ScaleLinear<number, number>;
    innerHeight: number;
  } | null>(null);
  const highlightedRef = useRef<string | null>(null);
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

  const thresholdValue = monthlyIncome > 0 ? monthlyIncome : totalBudgetLimit;

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
    // Scale chart height proportionally — compact on mobile, capped on desktop
    const isDesktop = width >= 1024;
    const height = isDesktop
      ? Math.min(Math.max(120, window.innerHeight * 0.18), 200)
      : Math.min(Math.max(120, window.innerHeight * 0.2), width * 0.4);
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

    const x = d3.scalePoint().domain(chartData.map((d) => d.month)).range([0, innerWidth]).padding(0.25);

    const maxTotal = d3.max(chartData, (d) => d.total) || 1;
    const yMax = Math.max(maxTotal, thresholdValue) * 1.15;

    const y = d3
      .scaleLinear()
      .domain([0, yMax])
      .range([innerHeight, 0]);

    const isDarkTheme = theme === 'dark';

    // Store internals for morph animation
    chartInternalsRef.current = { stackedData, x, y, innerHeight };

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

    const area = d3
      .area<d3.SeriesPoint<MonthlyBudgetData>>()
      .x((d) => x(d.data.month) || 0)
      .y0((d) => y(d[0]))
      .y1((d) => y(d[1]))
      .curve(d3.curveCatmullRom.alpha(0.5));

    // Draw stacked area bands with highlight strokes
    const layerGroup = svg.selectAll('.bfc-layer').data(stackedData).enter().append('g').attr('class', 'bfc-layer');

    // Create area generator for the top edge (stroke)
    const topLine = d3
      .line<d3.SeriesPoint<MonthlyBudgetData>>()
      .x((d) => x(d.data.month) || 0)
      .y((d) => y(d[1]))
      .curve(d3.curveCatmullRom.alpha(0.5));

    // Hairline gap area — shrink each band by 1px on y0 to create visual separation
    const areaWithGap = d3
      .area<d3.SeriesPoint<MonthlyBudgetData>>()
      .x((d) => x(d.data.month) || 0)
      .y0((d) => y(d[0]) - 1)
      .y1((d) => y(d[1]))
      .curve(d3.curveCatmullRom.alpha(0.5));

    layerGroup
      .append('path')
      .attr('class', 'bfc-band')
      .attr('d', areaWithGap)
      .style('fill', (_d, i) => `url(#bfc-grad-${i})`)
      .attr('fill-opacity', 0.85);

    // Highlight stroke along the top edge of each band
    layerGroup
      .append('path')
      .attr('class', 'bfc-band-stroke')
      .attr('d', topLine)
      .style('fill', 'none')
      .style('stroke', (_d, i) => {
        const [c0] = getGradient(categoryNames[i], i);
        return c0;
      })
      .style('stroke-width', 1.5)
      .style('stroke-opacity', 0.6)
      .style('filter', 'drop-shadow(0 0 2px rgba(0,0,0,0.15))');

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

    // Build savings area path: top of stacked bands → income threshold
    const savingsArea = d3
      .area<MonthlyBudgetData>()
      .x((d) => x(d.month) || 0)
      .y0((d) => y(d.total))
      .y1(() => budgetY)
      .curve(d3.curveCatmullRom.alpha(0.5));

    svg.append('path')
      .datum(chartData)
      .attr('class', 'bfc-savings')
      .attr('d', savingsArea)
      .style('fill', 'url(#bfc-savings-hatch)')
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
      .attr('stroke-dasharray', '2 4');

    // "INCOME" chip label on the threshold line
    const labelX = innerWidth - 4;
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
      .attr('stroke-width', 0.5);
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
      .text('INCOME');

    // Month labels on the x-axis
    chartData.forEach((d, idx) => {
      const xPos = x(d.month) || 0;
      const isFirst = idx === 0;
      const isLast = idx === chartData.length - 1;
      svg
        .append('text')
        .attr('x', isFirst ? xPos + 6 : isLast ? xPos - 6 : xPos)
        .attr('y', innerHeight + 14)
        .attr('text-anchor', 'middle')
        .attr('font-size', '9px')
        .attr('font-weight', '600')
        .attr('letter-spacing', '0.04em')
        .attr('fill', isDarkTheme ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.45)')
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
      const monthTotal = chartData[monthIdx].total;
      const topOfBandsY = y(monthTotal);

      // Check if finger is in the savings area (between top of bands and income line)
      let foundCat: string | null = null;
      if (my >= Math.min(budgetY, topOfBandsY) && my <= Math.max(budgetY, topOfBandsY) && thresholdValue > monthTotal) {
        foundCat = '__savings__';
      }

      if (!foundCat) {
        for (const layer of stackedData) {
          const point = layer[monthIdx];
          const y0 = y(point[0]);
          const y1 = y(point[1]);
          if (my >= Math.min(y0, y1) && my <= Math.max(y0, y1)) {
            foundCat = layer.key;
            break;
          }
        }
      }

      // If finger is outside all bands and savings, find the closest by vertical distance
      if (!foundCat) {
        let minDist = Infinity;
        // Check savings area distance
        if (thresholdValue > monthTotal) {
          const savingsMid = (budgetY + topOfBandsY) / 2;
          const savingsDist = Math.abs(my - savingsMid);
          if (savingsDist < minDist) {
            minDist = savingsDist;
            foundCat = '__savings__';
          }
        }
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
        .attr('fill-opacity', (d: any) => (foundCat && foundCat !== '__savings__' && d.key === foundCat ? 0.95 : 0.2));

      // Dim strokes for non-selected bands
      svg
        .selectAll('.bfc-band-stroke')
        .transition()
        .duration(100)
        .style('stroke-opacity', (_d: any, i: number) => (foundCat && foundCat !== '__savings__' && categoryNames[i] === foundCat ? 0.9 : 0.1));

      // Highlight savings area
      svg.select('.bfc-savings')
        .transition()
        .duration(100)
        .attr('fill-opacity', foundCat === '__savings__' ? 0.9 : 0.6);
    };

    // Interaction handler for mouse events
    const handleInteraction = (event: any) => {
      if (highlightedRef.current) return;
      const [mx, my] = d3.pointer(event, svg.node());
      setScreenCoords({ x: event.clientX, y: event.clientY });
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
      if (highlightedRef.current) return;
      event.preventDefault();
      const touch = event.touches[0] || event.changedTouches[0];
      setScreenCoords({ x: touch.clientX, y: touch.clientY });
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
      if (highlightedRef.current) return;
      event.preventDefault();
      const touch = event.touches[0] || event.changedTouches[0];
      setScreenCoords({ x: touch.clientX, y: touch.clientY });
      const [mx, my] = d3.pointer(touch, svg.node());
      const domain = x.domain();
      if (domain.length < 2) return;
      const step = innerWidth / (domain.length - 1);
      const index = Math.round(mx / step);
      const monthIdx = Math.max(0, Math.min(chartData.length - 1, index));
      updateSelection(monthIdx, my);
    };

    const handleEnd = () => {
      if (highlightedRef.current) return;
      setActiveCategory(null);
      setHoveredMonthIdx(null);
      setMouseCoords(null);
      setScreenCoords(null);
      scrubber.style('opacity', 0);
      scrubberDot.style('opacity', 0);
      svg.selectAll('.bfc-band').transition().duration(300).attr('fill-opacity', 0.85);
      svg.selectAll('.bfc-band-stroke').transition().duration(300).style('stroke-opacity', 0.6);
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
  }, [chartData, categoryNames, thresholdValue, theme]);

  const activeMonthData = hoveredMonthIdx !== null ? chartData[hoveredMonthIdx] : null;
  const isSavingsSelected = activeCategory === '__savings__';
  const activeCatAmount =
    isSavingsSelected && activeMonthData
      ? Math.max(0, thresholdValue - activeMonthData.total)
      : activeCategory && activeMonthData && typeof activeMonthData[activeCategory] === 'number'
        ? (activeMonthData[activeCategory] as number)
        : 0;
  const categoryPercentage =
    isSavingsSelected && activeMonthData && thresholdValue > 0
      ? Math.round((activeCatAmount / thresholdValue) * 100)
      : activeCategory && activeMonthData && activeMonthData.total > 0
        ? Math.round((activeCatAmount / activeMonthData.total) * 100)
        : 0;

  const activeCatIndex = activeCategory && !isSavingsSelected ? categoryNames.indexOf(activeCategory) : -1;
  const activeCatGradient = activeCategory && !isSavingsSelected ? getGradient(activeCategory, activeCatIndex) : null;
  const activeCatColor = isSavingsSelected
    ? (theme === 'dark' ? '#ffffff' : '#94a3b8')
    : activeCategory ? getBudgetColor(activeCategory, activeCatIndex) : null;

  // ── Highlighted budget band (when a budget is expanded below) ──
  const highlightedBudgetName = highlightedBudgetId ? (budgetNameById.get(highlightedBudgetId) || null) : null;
  highlightedRef.current = highlightedBudgetName;

  // Compute current-month totals for the highlighted budget
  const highlightedTotals = useMemo(() => {
    if (!highlightedBudgetId) return null;
    const budget = safeBudgets.find(b => b.id === highlightedBudgetId);
    if (!budget) return null;

    const now = new Date();
    const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    let spent = 0;
    let projected = 0;
    for (const tx of safeTransactions) {
      if (tx.budget_id !== highlightedBudgetId) continue;
      const rawDate = tx.date;
      if (!rawDate || rawDate.slice(0, 7) !== currentMonthKey) continue;
      const amt = Number(tx.amount) || 0;
      if (tx.is_projected) {
        projected += amt;
      } else {
        spent += amt;
      }
    }

    return { spent, projected, limit: budget.totalLimit };
  }, [highlightedBudgetId, safeBudgets, safeTransactions]);

  const highlightedCatIndex = highlightedBudgetName ? categoryNames.indexOf(highlightedBudgetName) : -1;
  const highlightedCatColor = highlightedBudgetName ? getBudgetColor(highlightedBudgetName, highlightedCatIndex) : null;

  // Apply band highlight/dim when a budget is expanded (separate from touch interaction)
  // Snap to solo view on budget open, reverse on close
  // Fades savings area & income line, shows per-month totals for the category
  useEffect(() => {
    if (!svgRef.current) return;
    const svgElement = d3.select(svgRef.current);
    const internals = chartInternalsRef.current;
    const snapMs = 500;
    const easing = d3.easeCubicOut;

    // Remove any previous solo month labels
    svgElement.selectAll('.bfc-solo-label').remove();

    if (!highlightedBudgetName || activeCategory) {
      if (!activeCategory) {
        // Reset everything to defaults
        svgElement.selectAll('.bfc-band').transition().duration(snapMs).ease(easing).attr('fill-opacity', 0.85);
        svgElement.selectAll('.bfc-band-stroke').transition().duration(snapMs).ease(easing).style('stroke-opacity', 0.6);
        svgElement.selectAll('.bfc-band, .bfc-band-stroke').each(function(this: any) {
          const el = d3.select(this);
          const orig = el.attr('data-original-d');
          if (orig) el.transition().duration(snapMs).ease(easing).attr('d', orig);
        });
        // Restore savings & income
        svgElement.select('.bfc-savings').transition().duration(snapMs).ease(easing).attr('fill-opacity', 0.6);
        svgElement.select('.bfc-income-line').transition().duration(snapMs).ease(easing).style('opacity', 1);
        svgElement.selectAll('.bfc-income-label').transition().duration(snapMs).ease(easing).style('opacity', 1);
      }
      return;
    }

    // ── Solo snap: show only the highlighted band ──

    // Hide non-highlighted bands
    svgElement.selectAll('.bfc-band')
      .transition().duration(snapMs).ease(easing)
      .attr('fill-opacity', (d: any) => d.key === highlightedBudgetName ? 0.95 : 0);
    svgElement.selectAll('.bfc-band-stroke')
      .transition().duration(snapMs).ease(easing)
      .style('stroke-opacity', (_d: any, i: number) => categoryNames[i] === highlightedBudgetName ? 0.9 : 0);

    // Fade out savings area and income line/label
    svgElement.select('.bfc-savings').transition().duration(snapMs).ease(easing).attr('fill-opacity', 0);
    svgElement.select('.bfc-income-line').transition().duration(snapMs).ease(easing).style('opacity', 0);
    svgElement.selectAll('.bfc-income-label').transition().duration(snapMs).ease(easing).style('opacity', 0);

    if (!internals) return;
    const { stackedData, x, y, innerHeight } = internals;
    const highlightLayer = stackedData.find(l => l.key === highlightedBudgetName);
    if (!highlightLayer) return;

    // Morph band to solo view (from baseline, using only its own values)
    const soloArea = d3
      .area<d3.SeriesPoint<MonthlyBudgetData>>()
      .x((d) => x(d.data.month) || 0)
      .y0(() => innerHeight)
      .y1((d) => y(d[1] - d[0]))
      .curve(d3.curveCatmullRom.alpha(0.5));

    const soloLine = d3
      .line<d3.SeriesPoint<MonthlyBudgetData>>()
      .x((d) => x(d.data.month) || 0)
      .y((d) => y(d[1] - d[0]))
      .curve(d3.curveCatmullRom.alpha(0.5));

    const soloPath = soloArea(highlightLayer) || '';
    const soloStrokePath = soloLine(highlightLayer) || '';
    const highlightIdx = categoryNames.indexOf(highlightedBudgetName);

    svgElement.selectAll('.bfc-band')
      .filter((d: any) => d.key === highlightedBudgetName)
      .each(function(this: any) {
        const el = d3.select(this);
        if (!el.attr('data-original-d')) el.attr('data-original-d', el.attr('d'));
        el.transition().duration(snapMs).ease(easing).attr('d', soloPath);
      });

    svgElement.selectAll('.bfc-band-stroke')
      .filter((_d: any, i: number) => i === highlightIdx)
      .each(function(this: any) {
        const el = d3.select(this);
        if (!el.attr('data-original-d')) el.attr('data-original-d', el.attr('d'));
        el.transition().duration(snapMs).ease(easing).attr('d', soloStrokePath);
      });

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
        .style('opacity', 0)
        .text(`$${val.toFixed(0)}`)
        .transition().delay(200).duration(300).ease(easing)
        .style('opacity', 1);
    });
  }, [highlightedBudgetName, activeCategory, categoryNames, highlightedCatColor, theme]);

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
        {/* Tooltip card — portaled to body, follows finger, on top of all UI */}
        {activeCategory && screenCoords && activeMonthData && createPortal(
          <div
            className="fixed z-[200] pointer-events-none"
            style={{
              left: screenCoords.x > window.innerWidth * 0.5
                ? Math.max(8, screenCoords.x - 170)
                : Math.min(window.innerWidth - 158, screenCoords.x + 20),
              top: Math.max(8, screenCoords.y - 160),
              transition: 'left 0.1s ease-out, top 0.1s ease-out',
            }}
          >
            <div
              className={`p-2.5 w-[150px] backdrop-blur-xl rounded-xl flex flex-col gap-2 ${
                theme === 'dark'
                  ? 'bg-slate-900/95 shadow-[0_20px_50px_-10px_rgba(0,0,0,0.9)]'
                  : 'bg-white/95 shadow-[0_20px_50px_-10px_rgba(0,0,0,0.15)]'
              }`}
              style={{
                borderWidth: '1.5px',
                borderStyle: 'solid',
                borderColor: activeCatColor || (theme === 'dark' ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.1)'),
              }}
            >
              <div className="flex justify-between items-center">
                <span
                  className="text-[10px] font-semibold tracking-wide"
                  style={{ color: activeCatColor || (theme === 'dark' ? '#6ee7b7' : '#059669') }}
                >
                  {activeMonthData.month}
                </span>
                <div
                  className={`px-2 py-0.5 rounded-full border text-[8px] font-bold tracking-wide ${
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
                  <h4 className={`text-[8px] font-semibold tracking-wide truncate mb-0.5 ${theme === 'dark' ? 'text-white/40' : 'text-slate-400'}`}>
                    {isSavingsSelected ? 'Savings' : activeCategory}
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
                      background: isSavingsSelected
                        ? (theme === 'dark' ? 'rgba(255,255,255,0.5)' : '#94a3b8')
                        : activeCatGradient
                          ? `linear-gradient(to top, ${activeCatGradient[1]}, ${activeCatGradient[0]})`
                          : '#10b981',
                    }}
                  />
                </div>
              </div>

              <div className={`pt-1.5 border-t grid grid-cols-2 gap-2 ${theme === 'dark' ? 'border-white/10' : 'border-slate-200'}`}>
                <div className="flex flex-col">
                  <span className={`text-[7px] font-semibold tracking-tight mb-0.5 ${theme === 'dark' ? 'text-white/30' : 'text-slate-400'}`}>Part</span>
                  <span className={`text-[11px] font-black ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>{categoryPercentage}%</span>
                </div>
                <div className="flex flex-col text-right">
                  <span className={`text-[7px] font-semibold tracking-tight mb-0.5 ${theme === 'dark' ? 'text-white/30' : 'text-slate-400'}`}>Total</span>
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
          </div>,
          document.body,
        )}

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
              <svg
                ref={svgRef}
                className={`w-full h-auto overflow-visible relative z-10 select-none ${highlightedBudgetName ? 'cursor-default' : 'cursor-crosshair'}`}
                style={{ touchAction: 'none' }}
              />

              {/* Highlighted budget totals overlay */}
              {highlightedBudgetName && highlightedTotals && !activeCategory && (
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
        </div>
      </div>
    </div>
  );
};

export default BudgetFlowChart;
