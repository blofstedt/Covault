import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const port = Number(process.env.COVAULT_ANDROID_WEB_PORT ?? 4187);
export default defineConfig({
  testDir: './__tests__', testMatch: '*.e2e.ts', workers: 1,
  reporter: 'list', outputDir: '../../test-results/android-bootstrap',
  use: { ...devices['Pixel 7'], baseURL: `http://127.0.0.1:${port}`, trace: 'retain-on-failure' },
  webServer: {
    cwd: fileURLToPath(new URL('../..', import.meta.url)),
    command: `./node_modules/.bin/vite --mode android-e2e --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`, reuseExistingServer: false,
    env: { COVAULT_ANDROID_TEST: '1' },
  },
});
