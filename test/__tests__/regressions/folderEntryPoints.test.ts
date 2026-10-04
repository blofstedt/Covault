import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const eslint = new ESLint({ cwd: fileURLToPath(new URL('../../../', import.meta.url)) });
const entryRule = 'folder-structure/feature-entrypoints';

async function entryMessages(source: string, filePath = 'app/App.tsx') {
  const [result] = await eslint.lintText(source, { filePath });
  return result.messages.filter(message => message.ruleId === entryRule).map(message => message.message);
}

describe('feature public entry points', () => {
  it("blocks another feature's supporting files through relative and alias imports", async () => {
    for (const specifier of ['../components/Review/FuelHoldPrompt', '@/components/Review/FuelHoldPrompt.tsx']) {
      expect(await entryMessages(`import Prompt from '${specifier}'; export default Prompt;`)).toEqual([
        'Use the public entry point for Review. Its supporting files belong to that feature.',
      ]);
    }
  });

  it('accepts the feature entry point and its explicit index spelling', async () => {
    expect(await entryMessages("import Review from '../components/Review/TransactionParsing'; export default Review;")).toHaveLength(1);
    for (const specifier of ['../components/Review', '@/components/Review/index.ts']) {
      expect(await entryMessages(`import Review from '${specifier}'; export default Review;`)).toEqual([]);
    }
  });

  it('permits a feature to import its own sibling helpers', async () => {
    expect(await entryMessages("import Prompt from '@/components/Review/FuelHoldPrompt'; export default Prompt;")).toHaveLength(1);
    expect(await entryMessages("import Prompt from './FuelHoldPrompt'; export default Prompt;",
      'components/Review/TransactionParsing.tsx')).toEqual([]);
  });

  it('preserves the chart as a narrow lazy import and rejects eager cross-feature imports', async () => {
    expect(await entryMessages("export const chart = () => import('../components/Dashboard/BudgetFlowChart');")).toEqual([]);
    expect(await entryMessages("import Chart from '../components/Dashboard/BudgetFlowChart'; export default Chart;")).toHaveLength(1);
    expect(await entryMessages("export const chart = () => import('../components/Dashboard/BudgetFlowChart/BudgetFlowChart');")).toHaveLength(1);
  });

  it('accepts narrow presentation entries shared with the intro', async () => {
    expect(await entryMessages("import Balance from '../../Dashboard/BalanceSection/DashboardBalanceSection'; export default Balance;",
      'components/Tour/TourDemoScreen/TourDemoScreen.tsx')).toHaveLength(1);
    for (const specifier of ['../../Dashboard/BalanceSection', '../../Dashboard/BudgetSections']) {
      expect(await entryMessages(`import Presentation from '${specifier}'; export default Presentation;`,
        'components/Tour/TourDemoScreen/TourDemoScreen.tsx')).toEqual([]);
    }
  });

  it('keeps the three legal pages independently importable', async () => {
    for (const page of ['PrivacyPolicy', 'Terms', 'DeleteAccountRequest']) {
      expect(await entryMessages(`export const page = () => import('../components/Legal/${page}');`)).toEqual([]);
      expect(await entryMessages(`export const page = () => import('../components/Legal/${page}/${page}');`)).toHaveLength(1);
    }
  });

  it('allows type-only defining-module imports without exposing private runtime modules', async () => {
    expect(await entryMessages("import { FirstCaptureData } from '../components/Notifications/FirstCaptureModal/FirstCaptureModal'; export { FirstCaptureData };")).toHaveLength(1);
    expect(await entryMessages("import type { FirstCaptureData } from '../components/Notifications/FirstCaptureModal/FirstCaptureModal'; export type Data = FirstCaptureData;")).toEqual([]);
    expect(await entryMessages("export type { FirstCaptureData } from '../components/Notifications/FirstCaptureModal/FirstCaptureModal';")).toEqual([]);
  });

  it('does not impose component entry points on shared libraries or controls', async () => {
    expect(await entryMessages("import Prompt from '../components/Review/FuelHoldPrompt'; export default Prompt;")).toHaveLength(1);
    expect(await entryMessages("import { parseManualAmount } from '../lib/money/manualAmount'; export { parseManualAmount };")).toEqual([]);
    expect(await entryMessages("import AmountInput from '../components/ui/AmountInput'; export default AmountInput;")).toEqual([]);
    expect(await entryMessages("import Icon from '../components/shared/CovaultIcon'; export default Icon;")).toEqual([]);
  });

  it('also blocks runtime re-exports that bypass a feature entry point', async () => {
    expect(await entryMessages("export { default as Prompt } from '../components/Review/FuelHoldPrompt';")).toHaveLength(1);
    expect(await entryMessages("export * from '../components/Review/FuelHoldPrompt';")).toHaveLength(1);
  });
});
