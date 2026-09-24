// eslint.config.js
//
// Lint catches the class of mistake the type-checker cannot: a React hook
// called conditionally, an effect that reads a value it does not list and so
// keeps acting on a stale one, a promise nobody waits for. `npm run verify`
// and CI both run it, so an error here fails the build.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import react from 'eslint-plugin-react';
import reactRefresh from 'eslint-plugin-react-refresh';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import unicorn from 'eslint-plugin-unicorn';
import tanstackQuery from '@tanstack/eslint-plugin-query';
import vitest from '@vitest/eslint-plugin';
import tailwind from 'eslint-plugin-tailwindcss';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: ['dist/**', 'android/**', 'node_modules/**', 'supabase/functions/**', 'public/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  unicorn.configs.recommended,
  react.configs.flat.recommended,
  react.configs.flat['jsx-runtime'],
  jsxA11y.flatConfigs.recommended,
  ...tanstackQuery.configs['flat/recommended'],
  ...tailwind.configs['flat/recommended'],
  {
    files: ['**/*.{ts,tsx,js,mjs,cjs}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    settings: { react: { version: 'detect' } },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // `catch (err: any)` and raw PostgREST rows are this codebase's idiom;
      // flagging all ~200 of them would bury the findings that matter.
      '@typescript-eslint/no-explicit-any': 'off',
      // A leading underscore is how this code says "deliberately unused" —
      // a mocked argument, a column stripped out of an insert by destructuring.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          caughtErrors: 'none',
        },
      ],

      // ── unicorn: kept on, except where a rule is a naming or formatting
      // taste this codebase deliberately does not share, or would change
      // behaviour if "fixed". Each off below is one of those.
      //
      // Renames: every `tx`, `err`, `props` and every PascalCase component
      // file, across the whole app, for no change in behaviour — and the
      // file names are how CLAUDE.md and the tests find things.
      'unicorn/prevent-abbreviations': 'off',
      'unicorn/filename-case': 'off',
      'unicorn/catch-error-name': 'off',
      'unicorn/consistent-compound-words': 'off',
      // null is load-bearing here: "the read failed" (null) and "the answer
      // is nothing" ([]) are different, and conflating them is how a failed
      // load once emptied the dashboard. See lib/budgetFallback.ts.
      'unicorn/no-null': 'off',
      'unicorn/no-useless-undefined': 'off',
      // Changes the result: the hashes and the notification ids are defined
      // over UTF-16 code units, so switching to code points would re-key
      // every stored hash. Likewise global isNaN/parseFloat coerce, and the
      // Number.* versions do not.
      'unicorn/prefer-code-point': 'off',
      'unicorn/prefer-number-properties': 'off',
      // `x | 0` wraps to a 32-bit integer inside the hashes; Math.trunc does
      // not, so the "fix" would change every hash.
      'unicorn/prefer-math-trunc': 'off',
      // Needs Array#toSorted / #toReversed / #at, which older Android
      // WebViews the app still supports do not have, and Vite does not
      // polyfill. The sorts it flags are on copies.
      'unicorn/no-array-sort': 'off',
      'unicorn/no-array-reverse': 'off',
      'unicorn/prefer-at': 'off',
      // Formatting taste — no effect on what runs.
      'unicorn/prefer-string-raw': 'off',
      'unicorn/prefer-string-replace-all': 'off',
      'unicorn/prefer-global-this': 'off',
      'unicorn/no-zero-fractions': 'off',
      'unicorn/numeric-separators-style': 'off',
      'unicorn/text-encoding-identifier-case': 'off',
      'unicorn/switch-case-braces': 'off',
      'unicorn/no-negated-condition': 'off',
      'unicorn/prefer-switch': 'off',
      'unicorn/no-nested-ternary': 'off',
      'unicorn/import-style': 'off',
      'unicorn/prefer-spread': 'off',
      'unicorn/no-array-for-each': 'off',
      'unicorn/no-array-reduce': 'off',
      'unicorn/no-array-callback-reference': 'off',
      'unicorn/no-await-expression-member': 'off',
      'unicorn/consistent-function-scoping': 'off',
      'unicorn/prefer-query-selector': 'off',
      'unicorn/explicit-length-check': 'off',
      // IndexedDB requests are wired with onsuccess/onerror/onblocked as a
      // set; converting one of the three reads worse, not better.
      'unicorn/prefer-add-event-listener': 'off',
      // `x || 'exact'` also defaults null and '', which a default parameter
      // does not — the "fix" would let a null match type through.
      'unicorn/prefer-default-parameters': 'off',
      // More taste: each flags a single spot that reads fine as it is.
      'unicorn/prefer-single-call': 'off',
      'unicorn/prefer-array-some': 'off',
      'unicorn/prefer-includes-over-repeated-comparisons': 'off',
      'unicorn/no-object-as-default-parameter': 'off',
      'unicorn/no-unreadable-array-destructuring': 'off',
      'unicorn/prefer-string-slice': 'off',

      // ── React: TypeScript already checks props, and an apostrophe in JSX
      // text renders fine.
      'react/prop-types': 'off',
      'react/no-unescaped-entities': 'off',
      // Only affects hot reload during `npm run dev`, so a warning.
      // These four helpers live beside the component whose logic they are.
      'react-refresh/only-export-components': [
        'error',
        {
          allowConstantExport: true,
          allowExportNames: [
            'pickNearMatchName',
            'pickRuleToAdopt',
            'prefetchCaptureSources',
            'captureSourceCountFor',
          ],
        },
      ],

      // ── Accessibility: this is a touch-only phone app. Tap-to-dismiss
      // backdrops have no keyboard to serve, and the focused inputs are the
      // point of the forms that open them.
      'jsx-a11y/click-events-have-key-events': 'off',
      'jsx-a11y/no-static-element-interactions': 'off',
      'jsx-a11y/no-noninteractive-element-interactions': 'off',
      'jsx-a11y/no-autofocus': 'off',

      // ── Tailwind: class ORDER and shorthands are taste; contradicting
      // classes and made-up class names are bugs, and stay on.
      'tailwindcss/classnames-order': 'off',
      'tailwindcss/enforces-shorthand': 'off',
      'tailwindcss/no-unnecessary-arbitrary-value': 'off',
      'tailwindcss/no-custom-classname': 'error',
      'tailwindcss/no-contradicting-classname': 'error',
    },
  },
  {
    files: ['**/__tests__/**'],
    plugins: { vitest },
    rules: {
      ...vitest.configs.recommended.rules,
      // Vitest takes a failure message as expect's second argument.
      'vitest/valid-expect': ['error', { maxArgs: 2 }],
      'vitest/no-conditional-expect': 'off',
      // Some tests assert through a helper that calls expect itself.
      'vitest/expect-expect': ['error', { assertFunctionNames: ['expect*', 'dining', 'notDining'] }],
      // Tests load a real package inside a test body to check its runtime shape.
      '@typescript-eslint/no-require-imports': 'off',
      // Tests read source files next to them, and mock Supabase's query
      // builder, which is awaitable — so the mock has to be too.
      'unicorn/prefer-module': 'off',
      'unicorn/no-thenable': 'off',
    },
  },
  {
    // Start strict local rules at owned boundaries. Legacy app files still
    // have `any` values that need to be removed alongside their data parsing.
    files: ['components/ui/**/*.{ts,tsx}', 'components/shared/**/*.{ts,tsx}', 'components/capture_sources/**/*.{ts,tsx}', 'e2e/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      'react/button-has-type': 'error',
    },
  },
  {
    // Shared visual controls must work without a vault, database, or native
    // plugin. Keep data loading and phone effects in their owning features.
    files: ['components/ui/**/*.{ts,tsx}', 'components/shared/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['@supabase/*', '@capacitor/*', '**/lib/supabase', '**/lib/apiHelpers', '**/lib/covaultNotification', '**/lib/captureSources'],
          message: 'Shared controls cannot read household data or call native plugins. Pass values and actions through props.',
        }],
      }],
    },
  },
  {
    // Dashboard and review features use their existing data hooks and actions.
    // Settings sections in this tree do own native actions, so this rule only
    // blocks direct Supabase client imports.
    files: ['components/dashboard_components/**/*.{ts,tsx}', 'components/transaction_parsing/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['@supabase/*', '**/lib/supabase'],
          message: 'Use the feature data hooks or actions instead of opening a Supabase client in a component.',
        }],
      }],
    },
  },
  {
    // The entry point mounts the app; nothing hot-reloads it.
    files: ['index.tsx'],
    rules: { 'react-refresh/only-export-components': 'off' },
  },
  {
    // Component tests share the app providers and clear their query cache.
    files: ['**/__tests__/**/*.test.tsx'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [{
          name: '@testing-library/react',
          importNames: ['render'],
          message: 'Use test/renderWithProviders so component tests mount the app providers and clear shared state.',
        }],
      }],
    },
  },
  {
    // Build scripts run under Node, not in the WebView.
    files: ['scripts/**/*.{js,mjs,cjs}', '*.config.{js,ts}'],
    languageOptions: { globals: globals.node },
    rules: {
      // The scripts are both run directly and imported by tests.
      'unicorn/no-exports-in-scripts': 'off',
      'unicorn/prefer-module': 'off',
    },
  },
);
