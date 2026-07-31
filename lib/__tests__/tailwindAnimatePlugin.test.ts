import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

/**
 * `animate-in`, `fade-in`, `zoom-in-95`, `slide-in-from-*` and friends are
 * tailwindcss-animate's class API. Without that plugin registered they are not
 * errors — they are simply unknown classes, so Tailwind emits nothing and the
 * markup renders with no animation at all.
 *
 * That is exactly what happened here: ~40 usages across modals, action sheets,
 * confirm dialogs and toasts, none of which had ever produced a single frame of
 * motion, because the plugin was never installed. Nothing failed, nothing
 * warned, and the only symptom was that the app felt abrupt.
 *
 * This test is the missing alarm. It fails if the classes are used while the
 * plugin is absent, in either direction.
 */

const ROOT = resolve(__dirname, '../..');

/** Classes that only exist when tailwindcss-animate is registered. */
const PLUGIN_CLASS = /\b(animate-in|animate-out|fade-in|fade-out|zoom-in|zoom-out|slide-in-from|slide-out-to)\b/;

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

describe('tailwindcss-animate', () => {
  const config = readFileSync(join(ROOT, 'tailwind.config.js'), 'utf8');
  const pluginRegistered = /plugins:\s*\[[^\]]*tailwindcssAnimate/.test(config);

  it('is registered in tailwind.config.js', () => {
    expect(
      pluginRegistered,
      'tailwindcss-animate must be in the `plugins` array — without it every ' +
      'animate-in / zoom-in / slide-in class in the codebase emits no CSS.',
    ).toBe(true);
  });

  it('is a declared dependency', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    expect(deps['tailwindcss-animate']).toBeTruthy();
  });

  it('backs every usage of its classes in the codebase', () => {
    const users = sourceFiles(join(ROOT, 'components'))
      .concat(sourceFiles(join(ROOT, 'lib')))
      .filter((f) => PLUGIN_CLASS.test(readFileSync(f, 'utf8')))
      .map((f) => f.slice(ROOT.length + 1));

    // Sanity: if this ever hits zero the assertion below becomes vacuous.
    expect(users.length).toBeGreaterThan(0);

    expect(
      pluginRegistered,
      `${users.length} file(s) use tailwindcss-animate classes, e.g. ` +
      `${users.slice(0, 3).join(', ')} — the plugin must stay registered.`,
    ).toBe(true);
  });
});
