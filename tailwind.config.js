import tailwindcssAnimate from 'tailwindcss-animate';

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./App.tsx",
    "./components/**/*.{js,ts,jsx,tsx}",
    "./lib/**/*.{js,ts,jsx,tsx}",
    "./*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      colors: {
        emerald: {
          950: '#022c22',
        }
      },
      padding: {
        'safe-top': 'env(safe-area-inset-top)',
        'safe-bottom': 'env(safe-area-inset-bottom)',
        'safe-left': 'env(safe-area-inset-left)',
        'safe-right': 'env(safe-area-inset-right)',
      },
      keyframes: {
        'softdup-pulse': {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(245, 158, 11, 0.0)' },
          '50%': { boxShadow: '0 0 0 4px rgba(245, 158, 11, 0.18)' },
        },
        // The one part of the entry form still waiting on the user. Same
        // shape as the soft-duplicate ring above and deliberately so — it is
        // the same idea, "look here" — but emerald, because in this app amber
        // means "something may be wrong" and nothing is wrong about a field
        // you have not filled in yet.
        'attention-pulse': {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(16, 185, 129, 0.0)' },
          '50%': { boxShadow: '0 0 0 4px rgba(16, 185, 129, 0.18)' },
        },
        // Count badge reacting to a new item. Deliberately asymmetric — a
        // quick overshoot out, a slower settle back.
        'badge-pop': {
          '0%': { transform: 'scale(1)' },
          '35%': { transform: 'scale(1.35)' },
          '100%': { transform: 'scale(1)' },
        },
      },
      animation: {
        'softdup-pulse': 'softdup-pulse 2.4s ease-in-out infinite',
        'attention-pulse': 'attention-pulse 2.4s cubic-bezier(0.32, 0.72, 0.24, 1) infinite',
        'badge-pop': 'badge-pop 420ms cubic-bezier(0.34, 1.56, 0.64, 1)',
      },
    },
  },
  // `animate-in`, `fade-in`, `zoom-in-95`, `slide-in-from-*` and friends come
  // from here. The codebase has used that class API in ~40 places for a long
  // time WITHOUT this plugin installed, so every one of them emitted no CSS and
  // every modal, sheet and toast appeared with no transition at all.
  //
  // The two hand-rolled `fade-in` / `slide-in-from-top-1` entries that used to
  // sit in `keyframes` above did not help: Tailwind's `animation` theme key
  // generates `animate-fade-in`, not `fade-in`, and nothing referenced that
  // name. They are gone now that the real implementations exist.
  //
  // lib/__tests__/tailwindAnimatePlugin.test.ts fails the build if these
  // classes are ever used again without the plugin registered here.
  plugins: [tailwindcssAnimate],
}
