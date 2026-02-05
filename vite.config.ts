import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import fs from 'fs';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Load env file from the current directory based on `mode`
  const env = loadEnv(mode, process.cwd(), '');

  return {
    // 1. SET BASE TO RELATIVE: This is the most common fix for the "White Screen" 
    // in PWA wrappers and Vercel. It ensures scripts load from ./assets instead of /assets.
    base: './',

    server: {
      port: 3000,
      host: '0.0.0.0',
    },

    plugins: [
      react(),
      viteStaticCopy({
        targets: [
          {
            src: 'sw.js',
            dest: '.'
          },
          {
            src: 'manifest.json',
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
              /href="\.\/assets\/manifest-[^"]+\.json"/,
              'href="./manifest.json"'
            );
            fs.writeFileSync(htmlPath, html);
            console.log('✓ Fixed manifest path to ./manifest.json');
          }
        }
      }
    ],

    // 2. DEFINE ENV VARIABLES: This replaces process.env and import.meta.env references at build time.
    // Critical for Android builds where env vars need to be embedded into the bundle.
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      // Explicitly define Supabase env vars for Android/Capacitor builds
      'import.meta.env.VITE_PUBLIC_SUPABASE_URL': JSON.stringify(env.VITE_PUBLIC_SUPABASE_URL),
      'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(env.VITE_SUPABASE_ANON_KEY),
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
