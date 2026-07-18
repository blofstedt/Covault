import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import fs from 'fs';

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
      viteStaticCopy({
        targets: [
          {
            src: 'manifest.json',
            dest: '.'
          },
          {
            src: 'sw.js',
            dest: '.'
          },
          {
            src: 'icons',
            dest: '.'
          }
        ]
      }),
      // Fix manifest path after build
      {
        name: 'fix-manifest-path',
        closeBundle() {
          const htmlPath = path.resolve(__dirname, 'dist/index.html');
          if (fs.existsSync(htmlPath)) {
            let html = fs.readFileSync(htmlPath, 'utf-8');
            html = html.replace(
              /href="\/assets\/manifest-[^"]+\.json"/,
              'href="/manifest.json"'
            );
            fs.writeFileSync(htmlPath, html);
            console.log('✓ Fixed manifest path to /manifest.json');
          }
        }
      }
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
    },
  };
});
