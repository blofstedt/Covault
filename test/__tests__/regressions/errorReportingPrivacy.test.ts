// @vitest-environment happy-dom
// The real browser SDK creates the reports. Only transport delivery is
// intercepted, so no Sentry account, production DSN or SDK mock is needed.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { z } from 'zod';

const emittedError = z.object({
  exception: z.object({
    values: z.array(z.object({ type: z.string(), value: z.string() }).passthrough()),
  }).passthrough(),
}).passthrough();

const envelopes: string[] = [];
const errors: z.infer<typeof emittedError>[] = [];
let testDsn = '';
let activeSdk: typeof import('@sentry/react') | undefined;
const server = createServer((request, response) => {
  request.resume();
  response.writeHead(200, { 'Access-Control-Allow-Origin': '*' });
  response.end('{}');
});

async function startReporting(dsn = testDsn) {
  vi.stubEnv('VITE_SENTRY_DSN', dsn);
  vi.stubEnv('VITE_BUILD_NUMBER', '2468');
  const reporting = await import('../../../app/lib/observability/errorReporting');
  const sdk = await import('@sentry/react');
  activeSdk = sdk;
  const previousClient = sdk.getClient();
  reporting.initErrorReporting();
  if (dsn) {
    await vi.waitFor(() => expect(sdk.getClient()).not.toBe(previousClient));
    const transport = sdk.getClient()?.getTransport();
    if (!transport) throw new Error('The real SDK must create a report transport.');
    vi.spyOn(transport, 'send').mockImplementation(envelope => {
      envelopes.push(JSON.stringify(envelope));
      for (const [, payload] of envelope[1]) {
        const parsed = emittedError.safeParse(payload);
        if (parsed.success) errors.push(parsed.data);
      }
      return Promise.resolve({ statusCode: 200 });
    });
  }
  return { reporting, sdk };
}

beforeAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    // Port zero uses the OS ephemeral range, outside the developer's ports.
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('The local report server needs a TCP port.');
  testDsn = `http://public@127.0.0.1:${address.port}/1`;
});

beforeEach(() => {
  vi.resetModules();
  envelopes.length = 0;
  errors.length = 0;
});

afterEach(async () => {
  await activeSdk?.close(1000);
  activeSdk?.getIsolationScope().setUser(null).clearBreadcrumbs();
  activeSdk?.getCurrentScope().setUser(null).clearBreadcrumbs();
  activeSdk?.getGlobalScope().setUser(null).clearBreadcrumbs();
  activeSdk = undefined;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

describe('crash reports keep household data on the device', () => {
  it('stays quiet without a DSN and reports a real error when configured', async () => {
    const { reporting: unconfigured } = await startReporting('');
    unconfigured.reportError(new Error('Unconfigured synthetic error'));
    expect(errors).toEqual([]);

    vi.resetModules();
    const { reporting: configured, sdk } = await startReporting();
    configured.reportError(new Error('Configured synthetic error'));
    expect(await sdk.flush(1000)).toBe(true);
    expect(errors).toEqual([expect.objectContaining({
      exception: expect.objectContaining({
        values: [expect.objectContaining({ type: 'Error', value: 'Configured synthetic error' })],
      }),
      release: 'covault@2468',
      request: { url: 'http://localhost:3000/' },
      sdk: expect.objectContaining({ settings: { infer_ip: 'never' } }),
    })]);
  });

  it('keeps the anonymous account id and build while removing personal and request data', async () => {
    const { reporting, sdk } = await startReporting();
    reporting.setReportingUser('synthetic-account-id');
    reporting.setReportingBuild(2468);
    sdk.captureEvent({
      exception: { values: [{ type: 'Error', value: 'Synthetic request failure' }] },
      user: {
        id: 'synthetic-account-id',
        email: 'private-email@example.test',
        username: 'private-person-name',
        ip_address: '198.51.100.17',
      },
      request: {
        url: 'https://example.test/rest/v1/transactions?vendor=PRIVATE_SHOP&amount=98.76',
        query_string: 'vendor=PRIVATE_SHOP&amount=98.76',
        cookies: { session: 'private-session-cookie' },
        data: { amount: 98.76, vendor: 'PRIVATE_BODY_SHOP' },
      },
    });
    await sdk.flush(1000);

    expect(errors).toEqual([expect.objectContaining({
      user: { id: 'synthetic-account-id' },
      tags: { versionCode: '2468' },
      request: { url: 'https://example.test/rest/v1/transactions?[redacted]' },
      exception: { values: [{ type: 'Error', value: 'Synthetic request failure' }] },
    })]);
    expect(envelopes.join('\n')).not.toMatch(/private-email|private-person-name|198\.51\.100\.17|PRIVATE_SHOP|PRIVATE_BODY_SHOP|98\.76|private-session-cookie/);
  });

  it('drops console details and keeps only the path of a useful network breadcrumb', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { reporting, sdk } = await startReporting();
    console.warn('PRIVATE_CONSOLE_SHOP 98.76');
    sdk.addBreadcrumb({ category: 'console', message: 'PRIVATE_MANUAL_CONSOLE_SHOP 98.76' });
    sdk.addBreadcrumb({
      category: 'fetch',
      data: { method: 'GET', url: 'https://example.test/rest/v1/budgets?income=PRIVATE_INCOME' },
    });
    reporting.reportError(new Error('Synthetic budget read failure'));
    await sdk.flush(1000);

    expect(errors).toEqual([expect.objectContaining({
      exception: expect.objectContaining({
        values: [expect.objectContaining({ type: 'Error', value: 'Synthetic budget read failure' })],
      }),
      breadcrumbs: [expect.objectContaining({
        category: 'fetch',
        data: { method: 'GET', url: 'https://example.test/rest/v1/budgets?[redacted]' },
      })],
    })]);
    expect(envelopes.join('\n')).not.toMatch(/PRIVATE_CONSOLE_SHOP|PRIVATE_MANUAL_CONSOLE_SHOP|PRIVATE_INCOME/);
    expect(sdk.getClient()?.getIntegrationByName('Console')).toBeUndefined();
    expect(sdk.getClient()?.getIntegrationByName('Breadcrumbs')?.name).toBe('Breadcrumbs');
    expect(sdk.getClient()?.getIntegrationByName('Replay')).toBeUndefined();
  });
});
