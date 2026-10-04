import path from 'node:path';

const publicEntries = new Set([
  'components/Auth',
  'components/CalendarPicker',
  'components/Dashboard',
  'components/Dashboard/BalanceSection',
  'components/Dashboard/BudgetSections',
  'components/Legal/PrivacyPolicy',
  'components/Legal/Terms',
  'components/Legal/DeleteAccountRequest',
  'components/Notifications',
  'components/Notifications/NotificationAccessGuide',
  'components/Notifications/FirstCaptureModal',
  'components/Notifications/CaptureSourcePicker',
  'components/Onboarding',
  'components/Review',
  'components/Settings',
  'components/Subscription',
  'components/Subscription/PremiumGate',
  'components/Tour',
  'components/Tour/TourDemoScreen',
  'components/Transactions',
  'components/Transactions/TransactionActionModal',
  'components/Transactions/TransactionItem',
  'components/Updates',
]);
const features = new Set([...publicEntries].map(entry => entry.split('/', 2)[1]));

/** Prevent runtime consumers from reaching into another feature's private files. */
const rule = {
  meta: {
    type: 'problem',
    docs: { description: 'Import another feature through its public component entry point.' },
    schema: [],
    messages: {
      privateImport: 'Use the public entry point for {{feature}}. Its supporting files belong to that feature.',
    },
  },
  create(context) {
    const root = context.cwd;
    const importer = path.relative(root, context.filename).split(path.sep).join('/');

    function check(node, source, typeOnly = false, lazy = false) {
      if (typeOnly || typeof source?.value !== 'string') return;
      const specifier = source.value;
      let target;
      if (specifier.startsWith('@/')) target = specifier.slice(2);
      else if (specifier.startsWith('.')) target = path.posix.normalize(path.posix.join(path.posix.dirname(importer), specifier));
      else return;
      target = target.replace(/\.(?:tsx?|jsx?)$/, '').replace(/\/index$/, '');
      const [folder, feature] = target.split('/', 2);
      if (folder !== 'components' || !features.has(feature)) return;
      if (importer.startsWith(`components/${feature}/`)) return;
      if (publicEntries.has(target)) return;
      // The chart retains its own lazy chunk instead of entering the Dashboard barrel.
      if (lazy && target === 'components/Dashboard/BudgetFlowChart') return;
      context.report({ node, messageId: 'privateImport', data: { feature } });
    }

    return {
      ImportDeclaration(node) {
        const typeOnly = node.importKind === 'type' || node.specifiers.length > 0 && node.specifiers.every(specifier => specifier.importKind === 'type');
        check(node, node.source, typeOnly);
      },
      ImportExpression(node) { check(node, node.source, false, true); },
      ExportNamedDeclaration(node) { check(node, node.source, node.exportKind === 'type'); },
      ExportAllDeclaration(node) { check(node, node.source, node.exportKind === 'type'); },
    };
  },
};

export default { rules: { 'feature-entrypoints': rule } };
