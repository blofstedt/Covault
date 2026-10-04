import type { Plugin } from 'vite';
import { TEST_SUPABASE_URL } from './backend';

export function androidTestBuild(mode: string): Plugin[] {
  const optedIn = process.env.COVAULT_ANDROID_TEST === '1';
  if (mode !== 'android-e2e') {
    if (optedIn) throw new Error('COVAULT_ANDROID_TEST requires --mode android-e2e.');
    return [];
  }
  if (!optedIn) throw new Error('The Android test build requires COVAULT_ANDROID_TEST=1.');
  return [{
    name: 'covault-isolated-android-tests',
    config() {
      return { define: {
        'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(TEST_SUPABASE_URL),
        'import.meta.env.VITE_PUBLIC_SUPABASE_URL': JSON.stringify(''),
        'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify('synthetic-android-key'),
        'import.meta.env.VITE_SENTRY_DSN': JSON.stringify(''),
      } };
    },
    transform(code, id) {
      if (/\/(?:app\/)?index\.tsx$/.test(id)) {
        return { code: `import '/android-e2e/bootstrap.ts';\n${code}`, map: null };
      }
    },
    transformIndexHtml(html) {
      // Fonts are optional for these behavior checks and must not reach Google.
      return html.replace(/<link\b[^>]*href="https:\/\/fonts\.googleapis\.com[^>]*>/g, '')
        .replace('<title>Covault v1</title>', '<title>Covault CI</title>');
    },
  }];
}
