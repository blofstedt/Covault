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
      // The smoke suite must use Covault's unconfigured client and never a
      // developer's real Supabase project, even when a local .env exists.
      VITE_SUPABASE_URL: '',
      VITE_PUBLIC_SUPABASE_URL: '',
      VITE_SUPABASE_ANON_KEY: '',
    },
  },
});
