# Budget Flow Chart Feature

## Overview
The Budget Flow Chart is a Sankey-like visualization component that displays budget spending patterns over time. It shows how money flows across all six budget categories (Housing, Groceries, Transport, Utilities, Leisure, Other) month by month.

## Features

### Visual Display
- **Rectangular Sankey-style chart** with rounded corners
- **Color-coded flows** for each budget category:
  - Housing: Blue (rgba(59, 130, 246))
  - Groceries: Emerald (rgba(16, 185, 129))
  - Transport: Amber (rgba(245, 158, 11))
  - Utilities: Purple (rgba(139, 92, 246))
  - Leisure: Pink (rgba(236, 72, 153))
  - Other: Gray (rgba(107, 114, 128))
- **Budget icons** displayed in the center of each flow for easy identification
- **Month labels** at the bottom of each column
- **Proportional heights** based on spending amounts relative to the max spending across all months

### Interactions
1. **Tap on any budget flow** to expand that specific budget
2. **View detailed breakdown** showing:
   - Budget name and icon
   - Month-by-month spending amounts
   - Percentage of total spending per month
3. **Tap outside or tap again** to collapse back to the full view
4. **Smooth animations** (300-400ms) for expand/collapse transitions

### Data Handling
- **Aggregates transactions** by month and budget category
- **Excludes projected transactions** (only shows actual spending)
- **Handles split transactions** correctly by budget allocation
- **Adaptive scaling**: Chart automatically adjusts to fill available space whether there's one month or many months of data
- **No blank space**: All months are distributed evenly across the chart width

## Location
The chart appears on the Dashboard, positioned:
- Just above the budget sections list
- Below the balance section
- Only visible when not in focus mode and not searching

## Implementation Details

### Component: `BudgetFlowChart.tsx`
- Uses React hooks (useState, useMemo, useRef)
- Responsive and mobile-friendly
- Supports both light and dark themes
- Accessible with proper contrast ratios (WCAG AA compliant)

### Data Flow
1. Receives `budgets` and `transactions` as props from Dashboard
2. Processes transactions to create monthly aggregations
3. Calculates proportional heights for visual representation
4. Renders interactive chart with event handlers

### Styling
- Consistent with app's design system
- Uses Tailwind CSS classes
- Backdrop blur and transparency effects
- Smooth transitions and animations

## User Experience
- **Quick overview**: See spending trends at a glance
- **Detailed exploration**: Tap to dive into specific budget details
- **No clutter**: Hidden when searching or in focus mode
- **Intuitive**: Icons and colors make budgets immediately recognizable
- **Responsive**: Works on all screen sizes
