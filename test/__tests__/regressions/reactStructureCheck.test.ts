import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const checkerPath = path.join(repositoryRoot, 'scripts/check-react-structure.mjs');
const requiredDirectories = ['app/components', 'app/hooks', 'app/lib', 'app/data', 'test', 'e2e', 'visualTests'];

function createFixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'covault-react-structure-'));
  for (const directory of requiredDirectories) {
    mkdirSync(path.join(root, directory), { recursive: true });
  }
  writeFixtureFile(root, 'App.tsx', 'export default function App() { return <main />; }');
  writeFixtureFile(root, 'app/index.tsx', "import App from '../App'; export default App;");
  return root;
}

function writeFixtureFile(root: string, relativePath: string, contents: string) {
  const absolutePath = path.join(root, relativePath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, contents);
}

function runChecker(root: string) {
  return spawnSync(process.execPath, [checkerPath, root], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
}

function withFixture(run: (root: string) => void) {
  const root = createFixture();
  try {
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('React structure check', () => {
  it('accepts flat components and owner folders with sibling child components', () => {
    withFixture(root => {
      writeFixtureFile(root, 'app/components/common/AmountInput.tsx', `
        export default function AmountInput() {
          const labels = ['Amount'];
          return <input aria-label={labels.map(label => label).join('')} />;
        }
      `);
      writeFixtureFile(root, 'app/components/Dashboard/Dashboard.tsx', `
        export default function Dashboard() { return <main />; }
      `);
      writeFixtureFile(root, 'app/components/Dashboard/MonthViewBanner.tsx', `
        export function MonthViewBanner() { return <aside />; }
      `);
      writeFixtureFile(root, 'app/components/Dashboard/index.ts', `
        export { default } from './Dashboard';
      `);
      writeFixtureFile(root, 'test/TestProviders.tsx', `
        export function TestProviders({ children }: { children: React.ReactNode }) {
          return <div>{children}</div>;
        }
      `);
      writeFixtureFile(root, 'visualTests/PreviewCard.tsx', 'export default function PreviewCard() { return <article />; }');
      writeFixtureFile(root, 'e2e/android/__tests__/smoke.e2e.ts', 'export {};');
      writeFixtureFile(root, 'test/android/__tests__/preflight.test.py', 'print("ready")');
      writeFixtureFile(root, 'android/generated/generated.test.ts', 'export {};');
      writeFixtureFile(root, 'android-test/fake-bank/.gradle/cache/generated.test.ts', 'export {};');

      const result = runChecker(root);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('React structure check passed.');
      expect(result.stderr).toBe('');
    });
  });

  it('requires a folder only when the component owns child components and its index defaults to the owner', () => {
    withFixture(root => {
      writeFixtureFile(root, 'app/components/common/CalendarPicker/CalendarPicker.tsx', `
        export default function CalendarPicker() { return <input />; }
      `);
      writeFixtureFile(root, 'app/components/common/CalendarPicker/index.ts', `
        export { default } from './CalendarPicker';
      `);
      writeFixtureFile(root, 'app/components/common/CalendarPicker/__tests__/CalendarPicker.test.tsx', 'export {};');

      const result = runChecker(root);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('Flatten CalendarPicker; a component folder is for a component with child components.');
    });

    withFixture(root => {
      writeFixtureFile(root, 'app/components/common/NoticeModal/NoticeModal.tsx', `
        export function NoticeModal() { return <dialog />; }
      `);
      writeFixtureFile(root, 'app/components/common/NoticeModal/CloseMark.tsx', `
        export function CloseMark() { return <svg />; }
      `);
      writeFixtureFile(root, 'app/components/common/NoticeModal/index.ts', `
        export { CloseMark as default } from './NoticeModal';
      `);

      const result = runChecker(root);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('The component index must export NoticeModal from its implementation as the default.');
    });
  });

  it('nests a component only when one parent is its sole runtime consumer', () => {
    withFixture(root => {
      writeFixtureFile(root, 'app/components/settings/SettingsModal.tsx', `
        import PrivateSection from './PrivateSection';
        export default function SettingsModal() { return <main><PrivateSection /></main>; }
      `);
      writeFixtureFile(root, 'app/components/settings/PrivateSection.tsx', `
        export default function PrivateSection() { return <section />; }
      `);
      writeFixtureFile(root, 'app/components/settings/SettingsHelp.tsx', `
        import type { SectionProps } from './PrivateSection';
        export function SettingsHelp() { return <aside />; }
      `);
      writeFixtureFile(root, 'app/components/settings/__tests__/SettingsModal.test.tsx', `
        import PrivateSection from '../PrivateSection';
        export {};
      `);

      const result = runChecker(root);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('Private component PrivateSection has one runtime component consumer (SettingsModal); place it under app/components/settings/SettingsModal.');
    });

    withFixture(root => {
      writeFixtureFile(root, 'app/components/settings/SettingsModal/SettingsModal.tsx', `
        import PrivateSection from './PrivateSection';
        export default function SettingsModal() { return <main><PrivateSection /></main>; }
      `);
      writeFixtureFile(root, 'app/components/settings/SettingsModal/PrivateSection.tsx', `
        export default function PrivateSection() { return <section />; }
      `);
      writeFixtureFile(root, 'app/components/settings/SettingsModal/index.ts', `
        export { default } from './SettingsModal';
      `);

      const result = runChecker(root);

      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
    });
  });

  it('does not assign shared controls or components with multiple runtime consumers to one owner', () => {
    withFixture(root => {
      writeFixtureFile(root, 'app/components/settings/SettingsModal.tsx', `
        import NoticeModal from '../common/NoticeModal';
        import SharedChip from '../review/SharedChip';
        export default function SettingsModal() { return <main><NoticeModal /><SharedChip /></main>; }
      `);
      writeFixtureFile(root, 'app/components/common/NoticeModal.tsx', 'export default function NoticeModal() { return <dialog />; }');
      writeFixtureFile(root, 'app/components/review/ReviewPanel.tsx', `
        import SharedChip from './SharedChip';
        export default function ReviewPanel() { return <section><SharedChip /></section>; }
      `);
      writeFixtureFile(root, 'app/components/review/ReviewHeader.tsx', `
        import SharedChip from './SharedChip';
        export function ReviewHeader() { return <header><SharedChip /></header>; }
      `);
      writeFixtureFile(root, 'app/components/review/SharedChip.tsx', 'export default function SharedChip() { return <span />; }');

      const result = runChecker(root);

      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
    });
  });

  it('keeps structural groups lowercase or camelCase and component owner folders PascalCase', () => {
    withFixture(root => {
      writeFixtureFile(root, 'app/components/Common/AmountInput.tsx', 'export default function AmountInput() { return <input />; }');
      writeFixtureFile(root, 'app/components/lowercase/dashboard/Dashboard.tsx', 'export default function Dashboard() { return <main />; }');
      writeFixtureFile(root, 'app/components/lowercase/dashboard/index.ts', "export { default } from './Dashboard';");
      writeFixtureFile(root, 'app/components/lowercase/dashboard/MonthViewBanner.tsx', 'export function MonthViewBanner() { return <aside />; }');

      const result = runChecker(root);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('Structural folders use lowercase or camelCase names; PascalCase folders own components with child components.');
      expect(result.stderr).toContain('A component owner folder must use the PascalCase component name Dashboard.');
    });
  });

  it('requires the root App component to default export and keeps the bootstrap in app/index.tsx', () => {
    withFixture(root => {
      writeFixtureFile(root, 'App.tsx', 'export function App() { return <main />; }');
      const result = runChecker(root);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('The repository-root App component must be the default export.');
    });

    withFixture(root => {
      rmSync(path.join(root, 'app/index.tsx'));
      const result = runChecker(root);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('app/index.tsx: The browser bootstrap belongs in app/index.tsx.');
    });

    withFixture(root => {
      rmSync(path.join(root, 'App.tsx'));
      writeFixtureFile(root, 'App.jsx', 'export default function App() { return <main />; }');
      const result = runChecker(root);
      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
    });
  });

  it('requires test and spec files under __tests__ across app, test, browser, visual, and scripts trees', () => {
    withFixture(root => {
      writeFixtureFile(root, 'app/components/common/NoticeModal.test.tsx', 'export {};');
      writeFixtureFile(root, 'test/android/Preflight.test.py', 'print("ready")');
      writeFixtureFile(root, 'e2e/android/bootstrap.e2e.ts', 'export {};');
      writeFixtureFile(root, 'e2e/android/Preflight.test.ts', 'export {};');
      writeFixtureFile(root, 'visualTests/preview.visual.tsx', 'export {};');
      writeFixtureFile(root, 'scripts/tests/test_capture.py', 'print("capture")');
      writeFixtureFile(root, 'native/android/NotificationListenerTest.java', 'class NotificationListenerTest {}');

      const result = runChecker(root);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('app/components/common/NoticeModal.test.tsx: Test and spec files must live under a __tests__ directory.');
      expect(result.stderr).toContain('test/android/Preflight.test.py: Test and spec files must live under a __tests__ directory.');
      expect(result.stderr).toContain('e2e/android/bootstrap.e2e.ts: Test and spec files must live under a __tests__ directory.');
      expect(result.stderr).toContain('e2e/android/Preflight.test.ts: Test and spec files must live under a __tests__ directory.');
      expect(result.stderr).toContain('visualTests/preview.visual.tsx: Test and spec files must live under a __tests__ directory.');
      expect(result.stderr).toContain('scripts/tests/test_capture.py: Test and spec files must live under a __tests__ directory.');
      expect(result.stderr).toContain('native/android/NotificationListenerTest.java: Test and spec files must live under a __tests__ directory.');
    });
  });

  it('rejects parallel root trees and moved root files while allowing root App.tsx', () => {
    withFixture(root => {
      for (const directory of ['Tests', 'components', 'lib', 'hooks', 'data']) {
        mkdirSync(path.join(root, directory));
      }
      mkdirSync(path.join(root, 'app/app'));
      for (const file of ['constants.ts', 'index.css', 'index.tsx', 'types.ts']) {
        writeFixtureFile(root, file, '');
      }

      const result = runChecker(root);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('Tests: Move authored source into the canonical test directory.');
      expect(result.stderr).toContain('components: Move authored source into the canonical app/components directory.');
      expect(result.stderr).toContain('lib: Move authored source into the canonical app/lib directory.');
      expect(result.stderr).toContain('hooks: Move authored source into the canonical app/hooks directory.');
      expect(result.stderr).toContain('data: Move authored source into the canonical app/data directory.');
      expect(result.stderr).toContain('app/app: Do not nest the app inside app/app.');
      expect(result.stderr).toContain('constants.ts: Move this app source file to app/constants.ts.');
      expect(result.stderr).toContain('index.css: Move this app source file to app/index.css.');
      expect(result.stderr).toContain('index.tsx: Move this app source file to app/index.tsx.');
      expect(result.stderr).toContain('types.ts: Move this app source file to app/types.ts.');
    });

    withFixture(root => {
      rmSync(path.join(root, 'App.tsx'));
      writeFixtureFile(root, 'app.tsx', '');
      const result = runChecker(root);
      expect(result.stderr).toContain('app.tsx: Move this app source file to App.tsx.');
    });
  });

  it('counts only top-level React components and catches duplicate default and named exports', () => {
    withFixture(root => {
      writeFixtureFile(root, 'app/components/common/Badges.tsx', `
        import type { FC } from 'react';
        const EmptyState: FC = () => null;
        import { memo } from 'react';
        const MemoBadge = memo(() => null);
        export function BadgeList() { return <ul>{['a'].map(item => <li key={item}>{item}</li>)}</ul>; }
      `);
      writeFixtureFile(root, 'app/lib/NamedAndDefault.tsx', `
        export const BudgetTotal = () => <strong />;
        export default BudgetTotal;
      `);

      const result = runChecker(root);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('A component file may define only one top-level React component; found 3: EmptyState, MemoBadge, BadgeList.');
      expect(result.stderr).toContain('Do not export BudgetTotal as both a named and default export.');
      expect(result.stderr).not.toContain('found 4:');
    });
  });
});
