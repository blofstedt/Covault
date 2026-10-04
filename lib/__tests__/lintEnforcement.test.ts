import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const eslint = new ESLint({ cwd: fileURLToPath(new URL('../../', import.meta.url)) });

async function lint(source: string, filePath: string) {
  const [result] = await eslint.lintText(source, { filePath });
  return result.messages.map(message => message.ruleId ?? message.message);
}

describe('repository lint enforcement', () => {
  it('retains React checks through the ESLint compatibility adapter', async () => {
    const source = `
      export default function Notice() {
        return <div children="Saved" />;
      }
    `;
    expect(await lint(source, 'components/ui/LintProbe.tsx')).toEqual([
      'react/no-children-prop',
    ]);
    expect(await lint(source.replace('<div children="Saved" />', '<div>Saved</div>'),
      'components/ui/LintProbe.tsx')).toEqual([]);
  });

  it('retains accessibility checks through the ESLint compatibility adapter', async () => {
    const source = `
      export default function Avatar() {
        return <img src="/avatar.png" />;
      }
    `;
    expect(await lint(source, 'components/ui/LintProbe.tsx')).toEqual([
      'jsx-a11y/alt-text',
    ]);
    expect(await lint(source.replace('src="/avatar.png"', 'src="/avatar.png" alt="Profile"'),
      'components/ui/LintProbe.tsx')).toEqual([]);
  });

  it('rejects conditional hooks and accepts the same hook called unconditionally', async () => {
    const source = `
      import { useEffect } from 'react';
      export default function Clock({ enabled }: { enabled: boolean }) {
        if (enabled) useEffect(() => { document.title = 'Clock'; }, []);
        return <span>Clock</span>;
      }
    `;
    expect(await lint(source, 'components/ui/LintProbe.tsx')).toEqual([
      'react-hooks/rules-of-hooks',
    ]);
    expect(await lint(source.replace("if (enabled) useEffect(() => { document.title = 'Clock'; }, []);",
      "useEffect(() => { if (enabled) document.title = 'Clock'; }, [enabled]);"),
    'components/ui/LintProbe.tsx')).toEqual([]);
  });

  it('rejects stale effect dependencies and accepts the declared dependency', async () => {
    const source = `
      import { useEffect } from 'react';
      export default function Title({ title }: { title: string }) {
        useEffect(() => { document.title = title; }, []);
        return <span>{title}</span>;
      }
    `;
    expect(await lint(source, 'components/ui/LintProbe.tsx')).toEqual([
      'react-hooks/exhaustive-deps',
    ]);
    expect(await lint(source.replace('}, []);', '}, [title]);'),
      'components/ui/LintProbe.tsx')).toEqual([]);
  });

  it('rejects unawaited browser actions and assertions and accepts awaited equivalents', async () => {
    const invalid = await lint(`
      import { test, expect } from './fixtures';

      test('saves', async ({ page }) => {
        page.getByRole('button', { name: 'Save' }).click();
        expect(page.getByText('Saved')).toBeVisible();
      });
    `, 'e2e/lint-probe.e2e.ts');
    expect(invalid).toEqual([
      'playwright/missing-playwright-await',
      'playwright/missing-playwright-await',
    ]);
    expect(await lint(`
      import { test, expect } from './fixtures';

      test('saves', async ({ page }) => {
        await page.getByRole('button', { name: 'Save' }).click();
        await expect(page.getByText('Saved')).toBeVisible();
      });
    `, 'e2e/lint-probe.e2e.ts')).toEqual([]);
  });

  it('rejects focused browser tests and fixed sleeps while accepting observable waits', async () => {
    expect(await lint(`
      import { test, expect } from './fixtures';

      test.only('saves', async ({ page }) => {
        await page.waitForTimeout(100);
        await expect(page.getByText('Saved')).toBeVisible();
      });
    `, 'e2e/lint-probe.e2e.ts')).toEqual([
      'playwright/no-focused-test',
      'playwright/no-wait-for-timeout',
    ]);
    expect(await lint(`
      import { test, expect } from './fixtures';

      test('saves', async ({ page }) => {
        await expect(page.getByText('Saved')).toBeVisible();
      });
    `, 'e2e/lint-probe.e2e.ts')).toEqual([]);
  });

  it('requires component user events to finish before asserting the result', async () => {
    const source = `
      import { screen } from '@testing-library/react';
      import userEvent from '@testing-library/user-event';
      import { it, expect } from 'vitest';
      it('saves', async () => {
        const user = userEvent.setup();
        user.click(screen.getByRole('button', { name: 'Save' }));
        expect(screen.getByText('Saved')).toBeVisible();
      });
    `;
    expect(await lint(source, 'components/__tests__/LintProbe.test.tsx')).toEqual([
      'testing-library/await-async-events',
    ]);
    expect(await lint(source.replace('user.click(', 'await user.click('),
      'components/__tests__/LintProbe.test.tsx')).toEqual([]);
  });

  it('rejects validation that asserts a type and accepts validation that parses it', async () => {
    expect(await lint(`
      export function readAmount(value: unknown): number {
        return value as number;
      }
    `, 'lib/validation/manualEntry.ts')).toEqual([
      '@typescript-eslint/no-unsafe-type-assertion',
    ]);
    expect(await lint(`
      import { z } from 'zod';
      export function readAmount(value: unknown): number {
        return z.number().positive().parse(value);
      }
    `, 'lib/validation/manualEntry.ts')).toEqual([]);
  });

  it('rejects lost validation promises and accepts their awaited result', async () => {
    const source = `
      import { z } from 'zod';
      const amountSchema = z.number().positive();
      export async function readAmount(value: unknown) {
        amountSchema.parseAsync(value);
      }
    `;
    expect(await lint(source, 'lib/validation/manualEntry.ts')).toEqual([
      '@typescript-eslint/require-await',
      '@typescript-eslint/no-floating-promises',
    ]);
    expect(await lint(source.replace('amountSchema.parseAsync(value);',
      'return await amountSchema.parseAsync(value);'), 'lib/validation/manualEntry.ts')).toEqual([]);
  });

  it('requires every validation variant to be handled', async () => {
    const source = `
      type Kind = 'expense' | 'refund';
      export function sign(kind: Kind) {
        switch (kind) {
          case 'expense': return 1;
        }
      }
    `;
    expect(await lint(source, 'lib/validation/manualEntry.ts')).toEqual([
      '@typescript-eslint/switch-exhaustiveness-check',
    ]);
    expect(await lint(source.replace("case 'expense': return 1;",
      "case 'expense': return 1; case 'refund': return -1;"),
    'lib/validation/manualEntry.ts')).toEqual([]);
  });

  it('keeps reusable controls away from the database and accepts values through props', async () => {
    expect(await lint(`
      import { supabase } from '../../lib/supabase';
      export function readUser() { return supabase.auth.getUser(); }
    `, 'components/ui/LintProbe.tsx')).toEqual(['no-restricted-imports']);
    expect(await lint(`
      export default function SaveButton({ onSave }: { onSave: () => void }) {
        return <button type="button" onClick={onSave}>Save</button>;
      }
    `, 'components/ui/LintProbe.tsx')).toEqual([]);
  });

  it('rejects misspelled Tailwind classes and accepts registered app controls', async () => {
    const source = `
      export default function Control() {
        return <div className="bg-slate-900 made-up-control" />;
      }
    `;
    expect(await lint(source, 'components/ui/LintProbe.tsx')).toEqual([
      'tailwindcss/no-custom-classname',
    ]);
    expect(await lint(source.replace('made-up-control',
      'animate-in fade-in dialog-motion flex-shrink-0 no-scrollbar'),
    'components/ui/LintProbe.tsx')).toEqual([]);
  });

  it('rejects contradictory Tailwind display values and accepts responsive alternatives', async () => {
    const source = `
      export default function Control() {
        return <div className="flex hidden" />;
      }
    `;
    expect(await lint(source, 'components/ui/LintProbe.tsx')).toEqual([
      'tailwindcss/no-contradicting-classname',
      'tailwindcss/no-contradicting-classname',
    ]);
    expect(await lint(source.replace('flex hidden', 'flex md:hidden'),
      'components/ui/LintProbe.tsx')).toEqual([]);
  });

});
