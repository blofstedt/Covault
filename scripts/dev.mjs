import { execFileSync, spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadEnv } from 'vite';

const AUTH_KEYS = ['VITE_SUPABASE_URL', 'VITE_PUBLIC_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'];

function sharedCheckout(cwd) {
  try {
    const gitDirectory = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
      cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    return path.dirname(gitDirectory);
  } catch {
    return cwd;
  }
}

function publicClientKey(value) {
  if (value.startsWith('sb_publishable_')) return true;
  try {
    const parts = value.split('.');
    return parts.length === 3 && JSON.parse(Buffer.from(parts[1], 'base64url').toString()).role === 'anon';
  } catch {
    return false;
  }
}

/** Resolve only public app configuration, without copying any env files into a worktree. */
export function developmentAuthEnvironment({ cwd, inherited = process.env, sharedDirectory = sharedCheckout(cwd), mode = 'development' }) {
  const local = { ...loadEnv(mode, cwd, 'VITE_'), ...inherited };
  let source = cwd;
  let values = local;
  if (!AUTH_KEYS.some(key => values[key])) {
    source = sharedDirectory;
    values = loadEnv(mode, source, 'VITE_');
  }
  const url = values.VITE_SUPABASE_URL || values.VITE_PUBLIC_SUPABASE_URL;
  const key = values.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error('Local sign-in needs the Supabase project URL and public key. Fill in .env.development.local in this checkout, or in the main checkout so linked worktrees can use it. See README.md, Local sign-in.');
  }
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error('The local Supabase project URL is invalid. Check .env.development.local.');
  }
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error('The local Supabase project URL must use HTTP or HTTPS.');
  }
  if (!publicClientKey(key)) {
    throw new Error('Use the Supabase publishable or anon key for local sign-in. Secret and service-role keys must never be used in the app.');
  }
  return { environment: { VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: key }, source };
}

function start() {
  const cwd = process.cwd();
  const args = process.argv.slice(2);
  const help = args.includes('--help') || args.includes('-h');
  const modeIndex = args.findIndex(arg => arg === '--mode' || arg === '-m');
  const mode = args.find(arg => arg.startsWith('--mode='))?.slice('--mode='.length)
    || (modeIndex !== -1 ? args[modeIndex + 1] : undefined) || 'development';
  let environment = {};
  if (!help) {
    try {
      const configuration = developmentAuthEnvironment({ cwd, mode });
      environment = configuration.environment;
      console.info(`[dev] Using public sign-in configuration from ${configuration.source}`);
    } catch (error) {
      console.error(`[dev] ${error instanceof Error ? error.message : 'Local sign-in configuration could not be loaded.'}`);
      process.exitCode = 1;
      return;
    }
  }
  const vite = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url));
  const child = spawn(process.execPath, [vite, ...args], {
    cwd, env: { ...process.env, ...environment }, stdio: 'inherit',
  });
  child.once('error', () => {
    console.error('[dev] Could not start Vite. Install this checkout\'s dependencies first.');
    process.exitCode = 1;
  });
  child.once('exit', code => { process.exitCode = code ?? 1; });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) start();
