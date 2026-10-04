import { defineConfig, devices } from '@playwright/test';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const absolutePath = z.string().min(1).refine(isAbsolute, 'Use an absolute directory path.');
const environment = z.object({
  COVAULT_SCREENSHOT_DIR: absolutePath,
  COVAULT_SCREENSHOT_APP_DIR: absolutePath.optional(),
  COVAULT_SCREENSHOT_PORT: z.coerce.number().int().min(1024).max(65535)
    .refine(port => ![3000, 3001, 3002, 4001, 4002, 8080, 9222].includes(port), 'This port is reserved.')
    .default(4231),
}).parse(process.env);
const harnessDirectory = fileURLToPath(new URL('.', import.meta.url));
const appDirectory = environment.COVAULT_SCREENSHOT_APP_DIR ?? process.cwd();
const baseURL = `http://127.0.0.1:${environment.COVAULT_SCREENSHOT_PORT}`;
const quote = (value: string) => `'${value.replace(/'/g, "'\\''")}'`;

export default defineConfig({
  testDir: resolve(harnessDirectory, 'e2e'),
  testMatch: '**/pr-screenshots.visual.ts',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: 'list',
  outputDir: resolve(harnessDirectory, 'test-results/pr-screenshots'),
  use: {
    ...devices['Pixel 7'],
    viewport: { width: 393, height: 852 },
    deviceScaleFactor: 1,
    baseURL,
    locale: 'en-CA',
    timezoneId: 'UTC',
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
  },
  webServer: {
    cwd: appDirectory,
    command: `${quote(resolve(appDirectory, 'node_modules/.bin/vite'))} --mode e2e --host 127.0.0.1 --port ${environment.COVAULT_SCREENSHOT_PORT} --strictPort`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      VITE_SUPABASE_URL: `${baseURL}/mock-supabase`,
      VITE_PUBLIC_SUPABASE_URL: '',
      VITE_SUPABASE_ANON_KEY: 'covault-local-e2e-key',
      VITE_SENTRY_DSN: '',
    },
  },
});
