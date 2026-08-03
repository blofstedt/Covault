import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Two edits hold each other up, in different files, and the failure mode of
 * separating them is a white screen on the phone rather than a build error.
 *
 * `vite.config.ts` deletes the 21MB ONNX Runtime binary out of the build. That
 * is only safe because `lib/aiExtractor.ts` pins the runtime to a CDN before
 * the model is ever loaded, which makes the bundled copy unreachable. Remove
 * the pin and the deletion starts throwing away a file the app needs; nothing
 * else in the repo would notice.
 */

const root = resolve(__dirname, '../..');
const aiExtractor = readFileSync(resolve(root, 'lib/aiExtractor.ts'), 'utf8');
const viteConfig = readFileSync(resolve(root, 'vite.config.ts'), 'utf8');

describe('the ONNX runtime binary', () => {
  it('is pinned to a CDN by aiExtractor before the pipeline is built', () => {
    expect(aiExtractor).toContain('wasmPaths');
    expect(aiExtractor).toMatch(/https:\/\/cdn\.jsdelivr\.net\/npm\/@huggingface\/transformers@/);
  });

  it('is pinned before the model is requested, not after', () => {
    // Setting it after `pipeline()` has already created a session would be a
    // no-op — the runtime is located as the session is built.
    const pin = aiExtractor.indexOf('wasmPaths');
    const load = aiExtractor.indexOf('loadPipeline(');
    expect(pin).toBeGreaterThan(-1);
    expect(load).toBeGreaterThan(-1);
    expect(pin).toBeLessThan(load);
  });

  it('is dropped from the build by vite.config.ts', () => {
    expect(viteConfig).toContain('dropUnusedOrtWasm');
    expect(viteConfig).toMatch(/ort-wasm.*\\\.wasm\$/);
  });
});
