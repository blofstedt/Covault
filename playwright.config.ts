import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.COVAULT_E2E_PORT ?? 4179);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  fullyParallel: true,
  workers: 2,
  retries: 0,
  reporter: 'list',
  outputDir: 'test-results',
  use: {
    ...devices['Pixel 7'],
    baseURL,
    reducedMotion: 'reduce',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: `./node_modules/.bin/vite --mode e2e --host 127.0.0.1 --port ${port} --strictPort`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      // The local server owns every test account. No live Supabase is contacted.
      VITE_SUPABASE_URL: `${baseURL}/mock-supabase`,
      VITE_PUBLIC_SUPABASE_URL: '',
      VITE_SUPABASE_ANON_KEY: 'covault-local-e2e-key',
    },
  },
});
