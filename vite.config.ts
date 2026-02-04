import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { viteStaticCopy } from 'vite-plugin-static-copy';

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
            src: 'manifest.json',
            dest: '.'
          }
        ]
      }),
      VitePWA({
        strategies: 'injectManifest',
        srcDir: '',
        filename: 'sw.js',
        manifest: false, // Don't auto-generate manifest, use the existing manifest.json
        injectManifest: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg,webp,woff,woff2}'],
          maximumFileSizeToCacheInBytes: 5000000,
        },
        devOptions: {
          enabled: false,
        },
      }),
    ],

    // 2. DEFINE ENV VARIABLES: This replaces process.env references at build time.
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
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
        input: {
          main: path.resolve(__dirname, 'index.html'),
        },
      },
    },
  };
});
