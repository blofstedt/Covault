// eslint.config.js
//
// Lint catches the class of mistake the type-checker cannot: a React hook
// called conditionally, an effect that reads a value it does not list and so
// keeps acting on a stale one, a promise nobody waits for. `npm run verify`
// and CI both run it, so an error here fails the build.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: ['dist/**', 'android/**', 'node_modules/**', 'supabase/functions/**', 'public/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: { 'react-hooks': reactHooks },
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
    },
  },
  {
    // Tests load a real package inside a test body to check its runtime shape.
    files: ['**/__tests__/**'],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    // Build scripts run under Node, not in the WebView.
    files: ['scripts/**/*.{js,mjs,cjs}', '*.config.{js,ts}'],
    languageOptions: { globals: globals.node },
  },
);
