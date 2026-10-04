# Development dependency update

Verified on 2026-10-04 against each package's official npm registry latest tag
and published license metadata. The table records the final lockfile. No
prerelease or paid-license package was selected. TypeScript 7 is deferred at
the user's request. The runtime and React type updates from production PR 313
are now included in this branch.

| Package | Resolved version | Current stable | License |
| --- | --- | --- | --- |
| [@eslint/compat](https://registry.npmjs.org/%40eslint%2Fcompat/latest) | 2.1.1 | 2.1.1 | Apache-2.0 |
| [@eslint/js](https://registry.npmjs.org/%40eslint%2Fjs/latest) | 10.0.1 | 10.0.1 | MIT |
| [@playwright/test](https://registry.npmjs.org/%40playwright%2Ftest/latest) | 1.63.0 | 1.63.0 | Apache-2.0 |
| [@tailwindcss/node](https://registry.npmjs.org/%40tailwindcss%2Fnode/latest) | 4.3.3 | 4.3.3 | MIT |
| [@tailwindcss/vite](https://registry.npmjs.org/%40tailwindcss%2Fvite/latest) | 4.3.3 | 4.3.3 | MIT |
| [@tanstack/eslint-plugin-query](https://registry.npmjs.org/%40tanstack%2Feslint-plugin-query/latest) | 5.104.1 | 5.104.1 | MIT |
| [@testing-library/dom](https://registry.npmjs.org/%40testing-library%2Fdom/latest) | 10.4.2 | 10.4.2 | MIT |
| [@testing-library/jest-dom](https://registry.npmjs.org/%40testing-library%2Fjest-dom/latest) | 7.0.1 | 7.0.1 | MIT |
| [@testing-library/react](https://registry.npmjs.org/%40testing-library%2Freact/latest) | 16.3.3 | 16.3.3 | MIT |
| [@testing-library/user-event](https://registry.npmjs.org/%40testing-library%2Fuser-event/latest) | 14.6.7 | 14.6.7 | MIT |
| [@types/jest-axe](https://registry.npmjs.org/%40types%2Fjest-axe/latest) | 3.5.9 | 3.5.9 | MIT |
| [@types/node](https://registry.npmjs.org/%40types%2Fnode/latest) | 26.6.4 | 26.6.4 | MIT |
| [@types/react](https://registry.npmjs.org/%40types%2Freact/latest) | 19.3.0 | 19.3.0 | MIT |
| [@types/react-dom](https://registry.npmjs.org/%40types%2Freact-dom/latest) | 19.3.0 | 19.3.0 | MIT |
| [@vitejs/plugin-react](https://registry.npmjs.org/%40vitejs%2Fplugin-react/latest) | 6.1.1 | 6.1.1 | MIT |
| [@vitest/eslint-plugin](https://registry.npmjs.org/%40vitest%2Feslint-plugin/latest) | 1.6.27 | 1.6.27 | MIT |
| [autoprefixer](https://registry.npmjs.org/autoprefixer/latest) | 10.6.1 | 10.6.1 | MIT |
| [eslint](https://registry.npmjs.org/eslint/latest) | 10.12.0 | 10.12.0 | MIT |
| [eslint-plugin-jsx-a11y](https://registry.npmjs.org/eslint-plugin-jsx-a11y/latest) | 6.10.2 | 6.10.2 | MIT |
| [eslint-plugin-playwright](https://registry.npmjs.org/eslint-plugin-playwright/latest) | 2.12.0 | 2.12.0 | MIT |
| [eslint-plugin-react](https://registry.npmjs.org/eslint-plugin-react/latest) | 7.37.5 | 7.37.5 | MIT |
| [eslint-plugin-react-hooks](https://registry.npmjs.org/eslint-plugin-react-hooks/latest) | 7.1.1 | 7.1.1 | MIT |
| [eslint-plugin-react-refresh](https://registry.npmjs.org/eslint-plugin-react-refresh/latest) | 0.5.7 | 0.5.7 | MIT |
| [eslint-plugin-tailwindcss](https://registry.npmjs.org/eslint-plugin-tailwindcss/latest) | 4.4.0 | 4.4.0 | MIT |
| [eslint-plugin-testing-library](https://registry.npmjs.org/eslint-plugin-testing-library/latest) | 7.16.2 | 7.16.2 | MIT |
| [eslint-plugin-unicorn](https://registry.npmjs.org/eslint-plugin-unicorn/latest) | 77.0.0 | 77.0.0 | MIT |
| [globals](https://registry.npmjs.org/globals/latest) | 17.13.0 | 17.13.0 | MIT |
| [happy-dom](https://registry.npmjs.org/happy-dom/latest) | 20.14.5 | 20.14.5 | MIT |
| [jest-axe](https://registry.npmjs.org/jest-axe/latest) | 11.0.0 | 11.0.0 | MIT |
| [postcss](https://registry.npmjs.org/postcss/latest) | 8.5.28 | 8.5.28 | MIT |
| [tailwindcss](https://registry.npmjs.org/tailwindcss/latest) | 4.3.3 | 4.3.3 | MIT |
| [tailwindcss-animate](https://registry.npmjs.org/tailwindcss-animate/latest) | 1.0.7 | 1.0.7 | MIT |
| [typescript](https://registry.npmjs.org/typescript/latest) | 5.8.3 | 7.0.2 | Apache-2.0 |
| [typescript-eslint](https://registry.npmjs.org/typescript-eslint/latest) | 8.71.0 | 8.71.0 | MIT |
| [vite](https://registry.npmjs.org/vite/latest) | 8.3.2 | 8.3.2 | MIT |
| [vitest](https://registry.npmjs.org/vitest/latest) | 5.0.3 | 5.0.3 | MIT |

## Compatibility and checks

ESLint 10 uses the official Apache-2.0 compatibility adapter for React and JSX
accessibility rules. Their declared peer ranges still stop at ESLint 9. The
project's peer-resolution setting makes clean CI installations reproducible.
Thirteen real rule probes reject invalid examples and accept corrected ones.
Passing installation alone is not treated as proof of compatibility.

The installed Unicorn plugin is current. Its configuration retains the
previously reviewed rule selection, so a tool upgrade does not quietly rename
or reformat the whole app. React hook ordering and effect dependencies remain
enforced. React Compiler migration diagnostics require a separate compiler
migration. See [Lint checks](LINTING.md) for the specific retained policies.

Vite 8 uses its current build-options name and explicit native-loadable config
imports. Existing chunk separation, browser targets and unused-ONNX-WASM
removal remain in effect. The older es2015 target still produces tolerated
BigInt-transform warnings in ONNX code. The app already requires a modern
WebView with BigInt support. This update does not change device support.

React, D3 and Supabase remain separate build chunks; the unused ONNX WASM
file is absent from the combined production build.

Local checks used Node 26. Hosted Node 22/24 checks, Android APK and AI runtime,
physical-phone performance and the live database need their own evidence.
The audit covers npm packages, not every native or upstream CI dependency.

## Combined runtime and development checks

The merged lock retains every approved runtime version and the current tools,
with TypeScript staying on 5.8. Capacitor core now declares 8.5.2 as its minimum
to preserve the approved runtime version when the lock is regenerated.

A normal clean install, full and runtime npm audits, app and unused-code type
checks, explicit build-config and Android test-build type checks, zero-warning
lint, all 2,347 unit tests and the production build passed with this combined
lock. The focused checks passed all three real-SDK crash-report privacy tests
and all thirteen lint probes. The full and runtime audits both report zero
known vulnerabilities.

The previous separate PR heads passed installed Android emulator checks and
browser checks. Those results do not verify this new combined head. Its hosted
and browser checks still need to run after delivery; physical phones and the
live database remain unverified.
