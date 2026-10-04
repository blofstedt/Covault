import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { developmentAuthEnvironment } from '../../../scripts/dev.mjs';

const publicKey = `header.${Buffer.from(JSON.stringify({ role: 'anon' })).toString('base64url')}.signature`;
let directory: string;
let checkout: string;
let shared: string;

beforeEach(() => {
  directory = mkdtempSync(path.join(os.tmpdir(), 'covault-dev-auth-test-'));
  checkout = path.join(directory, 'checkout');
  shared = path.join(directory, 'shared');
  mkdirSync(checkout);
  mkdirSync(shared);
  for (const key of ['VITE_SUPABASE_URL', 'VITE_PUBLIC_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY']) vi.stubEnv(key, undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(directory, { recursive: true, force: true });
});

function configure(dir: string, url: string, key = publicKey) {
  writeFileSync(path.join(dir, '.env.development.local'), `VITE_SUPABASE_URL=${url}\nVITE_SUPABASE_ANON_KEY=${key}\nPRIVATE_SERVER_SECRET=must-stay-private\n`);
}

function resolve(inherited: NodeJS.ProcessEnv = {}) {
  return developmentAuthEnvironment({ cwd: checkout, inherited, sharedDirectory: shared });
}

describe('local development authentication configuration', () => {
  it('loads a worktree configuration without forwarding private server values', () => {
    configure(checkout, 'https://worktree.supabase.co');
    configure(shared, 'https://shared.supabase.co');
    expect(resolve()).toEqual({
      environment: { VITE_SUPABASE_URL: 'https://worktree.supabase.co', VITE_SUPABASE_ANON_KEY: publicKey },
      source: checkout,
    });
  });

  it('uses the main checkout when this worktree has no authentication configuration', () => {
    configure(shared, 'https://shared.supabase.co');
    expect(resolve()).toEqual({
      environment: { VITE_SUPABASE_URL: 'https://shared.supabase.co', VITE_SUPABASE_ANON_KEY: publicKey },
      source: shared,
    });
  });

  it('keeps explicitly supplied configuration instead of another checkout project', () => {
    configure(shared, 'https://shared.supabase.co');
    expect(resolve({ VITE_PUBLIC_SUPABASE_URL: 'https://explicit.supabase.co', VITE_SUPABASE_ANON_KEY: 'sb_publishable_local-test' })).toEqual({
      environment: { VITE_SUPABASE_URL: 'https://explicit.supabase.co', VITE_SUPABASE_ANON_KEY: 'sb_publishable_local-test' },
      source: checkout,
    });
  });

  it('respects a requested Vite mode instead of loading development credentials', () => {
    configure(checkout, 'https://development.supabase.co');
    writeFileSync(path.join(checkout, '.env.preview.local'), `VITE_SUPABASE_URL=https://preview.supabase.co\nVITE_SUPABASE_ANON_KEY=${publicKey}\n`);
    expect(developmentAuthEnvironment({ cwd: checkout, inherited: {}, sharedDirectory: shared, mode: 'preview' }).environment).toEqual({
      VITE_SUPABASE_URL: 'https://preview.supabase.co', VITE_SUPABASE_ANON_KEY: publicKey,
    });
  });

  it('refuses to mix a partial local project with the main checkout key', () => {
    writeFileSync(path.join(checkout, '.env.development.local'), 'VITE_SUPABASE_URL=https://partial.supabase.co\n');
    configure(shared, 'https://shared.supabase.co');
    expect(() => resolve()).toThrow('Local sign-in needs the Supabase project URL and public key.');
  });

  it('explains missing setup and accepts a complete local Supabase configuration', () => {
    expect(() => resolve()).toThrow('Local sign-in needs the Supabase project URL and public key.');
    configure(checkout, 'http://127.0.0.1:54321');
    expect(resolve().environment).toEqual({ VITE_SUPABASE_URL: 'http://127.0.0.1:54321', VITE_SUPABASE_ANON_KEY: publicKey });
  });

  it('rejects private client keys without including them in the error', () => {
    const serviceKey = `header.${Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url')}.private-signature`;
    configure(checkout, 'https://worktree.supabase.co', serviceKey);
    expect(() => resolve()).toThrow('Use the Supabase publishable or anon key for local sign-in.');
    configure(checkout, 'https://worktree.supabase.co', 'sb_publishable_local-test');
    expect(resolve().environment.VITE_SUPABASE_ANON_KEY).toBe('sb_publishable_local-test');
  });

  it('rejects malformed and non-web URLs before starting the server', () => {
    configure(checkout, 'broken-url');
    expect(() => resolve()).toThrow('The local Supabase project URL is invalid.');
    configure(checkout, 'file:///private/config');
    expect(() => resolve()).toThrow('The local Supabase project URL must use HTTP or HTTPS.');
    configure(checkout, 'https://worktree.supabase.co');
    expect(resolve().environment.VITE_SUPABASE_URL).toBe('https://worktree.supabase.co');
  });
});
