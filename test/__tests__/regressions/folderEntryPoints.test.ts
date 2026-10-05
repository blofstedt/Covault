import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { beforeAll, describe, expect, it } from 'vitest';

const eslint = new ESLint({ cwd: fileURLToPath(new URL('../../../', import.meta.url)) });
const entryRule = 'folder-structure/feature-entrypoints';
const implementationRule = 'folder-structure/component-implementation-entrypoints';
const restrictedImportRule = 'no-restricted-imports';
const privateDashboardMessage = 'Use the public entry point for Dashboard. Its supporting files belong to that feature.';
const privateReviewMessage = 'Use the public entry point for review. Its supporting files belong to that feature.';

async function ruleMessages(source: string, filePath: string, ruleId: string) {
  const [result] = await eslint.lintText(source, { filePath });
  return result.messages.filter(message => message.ruleId === ruleId).map(message => message.message);
}

describe('active import boundaries', () => {
  beforeAll(async () => {
    await eslint.lintFiles(['app/lib/transactions/validation/manualEntry.ts']);
  }, 30_000);

  it('uses explicit cross-feature entries and keeps supporting review files private', async () => {
    expect(await ruleMessages(
      "import Card from '../review/TransactionParsing/AITransactionsEnteredCard'; export default Card;",
      'app/components/tour/TourDemoScreen.tsx',
      entryRule,
    )).toEqual([privateReviewMessage]);

    expect(await ruleMessages(
      "import Picker from '@/app/components/common/CalendarPicker'; export default Picker;",
      'app/components/review/CategoryPickerSheet.tsx',
      entryRule,
    )).toEqual([]);

    expect(await ruleMessages(
      "import Sections from '../Dashboard/DashboardBudgetSectionsList'; export default Sections;",
      'app/components/tour/TourDemoScreen.tsx',
      entryRule,
    )).toEqual([]);

    expect(await ruleMessages(
      "import List from '../Dashboard/DashboardBudgetSectionsList/DashboardBudgetSectionsList'; export default List;",
      'app/components/tour/TourDemoScreen.tsx',
      entryRule,
    )).toEqual([privateDashboardMessage]);

    expect(await ruleMessages(
      "import type { FirstCaptureData } from '../notifications/FirstCaptureModal'; export type Data = FirstCaptureData;",
      'app/components/review/CategoryPickerSheet.tsx',
      entryRule,
    )).toEqual([]);
  });

  it('blocks component implementation imports outside the owner folder but allows its entry and types', async () => {
    expect(await ruleMessages(
      "import Modal from '../transactions/TransactionActionModal/TransactionActionModal'; export default Modal;",
      'app/components/tour/TourDemoScreen.tsx',
      implementationRule,
    )).toEqual([
      'Import through the component folder entry; implementation files stay within their component folder.',
    ]);

    expect(await ruleMessages(
      "import Modal from '../transactions/TransactionActionModal'; export default Modal;",
      'app/components/tour/TourDemoScreen.tsx',
      implementationRule,
    )).toEqual([]);

    expect(await ruleMessages(
      "import type { ModalProps } from '../transactions/TransactionActionModal/TransactionActionModal'; export type Props = ModalProps;",
      'app/components/tour/TourDemoScreen.tsx',
      implementationRule,
    )).toEqual([]);
  });

  it('allows only narrow lazy chart imports and rejects eager imports from Dashboard itself', async () => {
    expect(await ruleMessages(
      "export const loadChart = () => import('./BudgetFlowChart');",
      'app/components/Dashboard/Dashboard.tsx',
      entryRule,
    )).toEqual([]);

    expect(await ruleMessages(
      "export const loadChart = () => import('../Dashboard/BudgetFlowChart');",
      'app/components/tour/TourDemoScreen.tsx',
      entryRule,
    )).toEqual([]);

    expect(await ruleMessages(
      "import Chart from './BudgetFlowChart'; export default Chart;",
      'app/components/Dashboard/Dashboard.tsx',
      entryRule,
    )).toEqual([privateDashboardMessage]);

    expect(await ruleMessages(
      "export const loadChart = () => import('../Dashboard/BudgetFlowChart');",
      'app/components/review/CategoryPickerSheet.tsx',
      entryRule,
    )).toEqual([privateDashboardMessage]);

    expect(await ruleMessages(
      "export const loadChart = () => import('./BudgetFlowChart/BudgetFlowChart');",
      'app/components/Dashboard/Dashboard.tsx',
      entryRule,
    )).toEqual([privateDashboardMessage]);
  });

  it('keeps legal pages lazy from the bootstrap and rejects eager or deep imports', async () => {
    expect(await ruleMessages(
      "export const page = () => import('./components/legal/PrivacyPolicy');",
      'app/index.tsx',
      entryRule,
    )).toEqual([]);

    expect(await ruleMessages(
      "import PrivacyPolicy from './app/components/legal/PrivacyPolicy'; export default PrivacyPolicy;",
      'App.tsx',
      entryRule,
    )).toEqual(['Use the public entry point for legal. Its supporting files belong to that feature.']);

    expect(await ruleMessages(
      "export const page = () => import('./components/legal/Terms/Terms');",
      'app/index.tsx',
      entryRule,
    )).toEqual(['Use the public entry point for legal. Its supporting files belong to that feature.']);
  });

  it('keeps the Common boundary active for native and data modules while allowing pure UI helpers', async () => {
    for (const specifier of [
      '@/app/lib/native/haptics',
      '@/app/lib/native/appNotifications',
      '@/app/data/useUserData',
    ]) {
      const messages = await ruleMessages(
        `import * as boundary from '${specifier}'; export { boundary };`,
        'app/components/common/NoticeModal.tsx',
        restrictedImportRule,
      );
      expect(messages).toHaveLength(1);
      expect(messages[0]).toContain('Shared controls cannot read household data or call native plugins. Pass values and actions through props.');
    }

    expect(await ruleMessages(
      "import { cardSurface } from '@/app/components/common/cardSurface'; export { cardSurface };",
      'app/components/common/NoticeModal.tsx',
      restrictedImportRule,
    )).toEqual([]);
  });

  it('rejects legacy component roots from the active root App config', async () => {
    expect(await ruleMessages(
      "import Dashboard from '@/components/Dashboard'; export default Dashboard;",
      'App.tsx',
      entryRule,
    )).toEqual([privateDashboardMessage]);
  });
});
