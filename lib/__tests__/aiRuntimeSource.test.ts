import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Two edits hold each other up, in different files, and the failure mode of
 * separating them is a white screen on the phone rather than a build error.
 *
 * `vite.config.ts` deletes the ONNX Runtime binary out of the build. The
 * library supplies version-matched CDN URLs before the model loads, so the
 * bundled copy is not needed. These checks keep that relationship in place.
 */

const root = resolve(__dirname, '../..');
const aiExtractor = readFileSync(resolve(root, 'lib/aiExtractor.ts'), 'utf8');
const viteConfig = readFileSync(resolve(root, 'vite.config.ts'), 'utf8');

describe('the ONNX runtime binary', () => {
  it('uses the exact URLs supplied by the matching ONNX Runtime', () => {
    expect(aiExtractor).toContain('runtimeUrls(runtime?.wasmPaths, env.version)');
    expect(aiExtractor).toContain('env.useWasmCache = true');
    expect(aiExtractor).not.toMatch(/wasmPaths\s*=\s*prefix/);
  });

  it('configures the runtime cache before the model is requested', () => {
    const runtimeConfig = aiExtractor.indexOf('runtimeUrls(runtime?.wasmPaths, env.version)');
    const load = aiExtractor.indexOf('loadPipeline(');
    expect(runtimeConfig).toBeGreaterThan(-1);
    expect(load).toBeGreaterThan(-1);
    expect(runtimeConfig).toBeLessThan(load);
  });

  it('is dropped from the build by vite.config.ts', () => {
    expect(viteConfig).toContain('dropUnusedOrtWasm');
    expect(viteConfig).toMatch(/ort-wasm.*\\\.wasm\$/);
  });
});
