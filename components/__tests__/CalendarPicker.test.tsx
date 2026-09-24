// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CalendarPicker from '../CalendarPicker';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe('calendar month navigation', () => {
  it('names both month controls and announces the month when it changes', async () => {
    await act(async () =>
      root.render(
        <CalendarPicker value="2026-12-15" onChange={vi.fn()} onClose={vi.fn()} />,
      ),
    );

    const previousMonth = document.querySelector<HTMLButtonElement>('[aria-label="Previous month"]');
    const nextMonth = document.querySelector<HTMLButtonElement>('[aria-label="Next month"]');
    const monthHeading = document.getElementById('calendar-month-label');
    if (!previousMonth || !nextMonth || !monthHeading) {
      throw new Error('Calendar navigation or month label did not render');
    }

    expect(previousMonth.getAttribute('aria-controls')).toBe('calendar-month-label');
    expect(nextMonth.getAttribute('aria-controls')).toBe('calendar-month-label');
    expect(monthHeading.getAttribute('aria-live')).toBe('polite');
    expect(monthHeading.textContent).toContain('2026');
    const decemberLabel = monthHeading.textContent;

    act(() => nextMonth.click());
    expect(monthHeading.textContent).not.toBe(decemberLabel);
    expect(monthHeading.textContent).toContain('2027');

    act(() => previousMonth.click());
    expect(monthHeading.textContent).toBe(decemberLabel);
  });
});
