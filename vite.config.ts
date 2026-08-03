import path from 'path';
import { execSync } from 'child_process';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Drop the ONNX Runtime WebAssembly binary that nothing loads.
 *
 * Transformers.js resolves that binary from a CDN — `lib/aiExtractor.ts` sets
 * the path explicitly so this is a guarantee rather than a default. But the
 * library also carries a `new URL(..., import.meta.url)` fallback for the case
 * where the path is unset, Vite reads that statically, and emits a 21MB file
 * that is never fetched: about a third of the APK, the same again on every
 * deploy, and dead weight in every background web update.
 *
 * Deliberately not an error when there is nothing to drop — a dependency that
 * stops emitting the file is fine. It is the pairing with aiExtractor that
 * matters, and `lib/__tests__/aiRuntimeSource.test.ts` holds that.
 */
function dropUnusedOrtWasm(): Plugin {
  return {
    name: 'covault-drop-unused-ort-wasm',
    apply: 'build',
    generateBundle(_options, bundle) {
      for (const fileName of Object.keys(bundle)) {
        if (/ort-wasm.*\.wasm$/.test(fileName)) {
          delete bundle[fileName];
          console.log(`Dropped unused ONNX runtime binary: ${fileName}`);
        }
      }
    },
  };
}

/**
 * Short commit SHA for the running build, for the in-app build marker.
 * Best-effort by design — a build must never fail because git is unavailable.
 */
function resolveBuildSha(): string {
  const fromCi = process.env.GITHUB_SHA || process.env.VERCEL_GIT_COMMIT_SHA;
  if (fromCi) return fromCi.slice(0, 7);
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim() || 'dev';
  } catch {
    return 'dev';
  }
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Load env file from the current directory based on `mode`
  const env = loadEnv(mode, process.cwd(), '');

  // Validate required Supabase environment variables for production builds
  // This prevents building Android APKs without proper configuration
  const isBuildCommand = process.argv.includes('build');
  
  // Check for Supabase URL (supports both naming conventions for compatibility)
  const hasSupabaseUrl = env.VITE_SUPABASE_URL || env.VITE_PUBLIC_SUPABASE_URL;
  
  if (isBuildCommand && !hasSupabaseUrl) {
    console.warn(
      '\n⚠️  WARNING: VITE_SUPABASE_URL (or VITE_PUBLIC_SUPABASE_URL) is not set!\n' +
      '   The app will not be able to connect to Supabase.\n' +
      '   Please create a .env file with your Supabase credentials.\n' +
      '   See .env.example for the required variables.\n'
    );
  }
  
  if (isBuildCommand && !env.VITE_SUPABASE_ANON_KEY) {
    console.warn(
      '\n⚠️  WARNING: VITE_SUPABASE_ANON_KEY is not set!\n' +
      '   The app will not be able to connect to Supabase.\n' +
      '   Please create a .env file with your Supabase credentials.\n' +
      '   See .env.example for the required variables.\n'
    );
  }

  return {
    plugins: [
      react(),
      dropUnusedOrtWasm(),
    ],

    // 2. DEFINE ENV VARIABLES: This replaces process.env and import.meta.env references at build time.
    // Critical for Android builds where env vars need to be embedded into the bundle.
    define: {
      // Explicitly define Supabase env vars for Android/Capacitor builds.
      // Support both VITE_SUPABASE_URL and VITE_PUBLIC_SUPABASE_URL for compatibility.
      //
      // IMPORTANT: do NOT use `JSON.stringify(undefined)` as a fallback value.
      // Vite treats `undefined` keys in `define` by emitting the identifier as-is,
      // but if a value sneaks through (e.g. the literal string "undefined") it gets
      // baked into the bundle and the runtime calls
      //   createClient("undefined", "undefined", ...)
      // which throws "Invalid supabaseUrl: Must be a valid HTTP or HTTPS URL".
      // We avoid that by only adding the slot when the env var is actually set.
      ...(env.VITE_SUPABASE_URL
        ? { 'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(env.VITE_SUPABASE_URL) }
        : {}),
      ...(env.VITE_PUBLIC_SUPABASE_URL
        ? { 'import.meta.env.VITE_PUBLIC_SUPABASE_URL': JSON.stringify(env.VITE_PUBLIC_SUPABASE_URL) }
        : {}),
      ...(env.VITE_SUPABASE_ANON_KEY
        ? { 'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(env.VITE_SUPABASE_ANON_KEY) }
        : {}),
      // (Removed: VITE_RESEND_API_KEY and VITE_SENDER_EMAIL were
      //  intended for a send-report Edge Function that has been
      //  removed from the repo. See SUPABASE_AUDIT.md.)

      // Short commit SHA of the build, shown next to the frame meter.
      //
      // "Is the new APK actually on the phone?" has already been an open
      // question once during a performance investigation, and it invalidates
      // whatever was measured. The APK filename carries only a timestamp, and
      // nothing inside the app identified the build at all.
      //
      // Resolved at config time from the CI-provided SHA, falling back to a
      // local git call, then to 'dev'. Never throws: a missing marker must not
      // be able to fail a build.
      'import.meta.env.VITE_BUILD_SHA': JSON.stringify(resolveBuildSha()),
    },

    resolve: {
      alias: {
        // Sets '@' to point to your project root
        '@': path.resolve(__dirname, '.'),
      },
    },

    build: {
      // 3. OPTIONAL: Ensures the build is compatible with older mobile WebViews
      target: 'es2015',
      // Useful for debugging if the white screen persists
      sourcemap: true,
      rollupOptions: {
        output: {
          // Split the heavy third-party deps out of the entry chunk so a cold
          // start doesn't parse them all. The AI stack in particular is larger
          // than the rest of the app combined and is only reached when a
          // notification actually needs the model; `aiExtractor` imports it
          // dynamically, and naming the chunk here keeps it from being merged
          // back into a shared chunk.
          // The function form (rather than an object) only emits a chunk when
          // the module is actually in the graph. That matters for supabase-js:
          // a build without credentials folds the "is configured" check to a
          // constant and tree-shakes the client away entirely, which would
          // leave an empty named chunk behind.
          manualChunks(id: string) {
            if (!id.includes('node_modules')) return;
            if (id.includes('/@supabase/')) return 'supabase';
            if (/\/node_modules\/d3(-|\/)/.test(id)) return 'd3';
            if (/\/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'react';
          },
        },
      },
    },
  };
});
