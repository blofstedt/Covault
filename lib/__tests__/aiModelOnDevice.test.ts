import { describe, it, expect, vi } from 'vitest';
import {
  createModelCache,
  loadStoredRuntime,
  markModelReady,
  readModelReport,
  runtimeUrls,
  shouldDownloadNow,
  storeRuntime,
  formatBytes,
  AI_MODEL_ID,
  type ModelFileStore,
  type StoredFile,
} from '../aiModelStore';

/**
 * The reading model is ~70MB and used to be fetched at the exact moment a
 * purchase was waiting to be read — and then not reliably kept, so that moment
 * could come around again at any time. It is stored on the phone now.
 *
 * Two properties matter more than the storing itself, and both are here:
 *
 *   1. Nothing about it may ever be load-bearing. Every read and write can
 *      fail — no space, no IndexedDB, a store the system has reclaimed — and
 *      each failure has to land exactly where the app was before this existed:
 *      fetch it from the network. A throw on this path would take down the AI
 *      fallback, which is worse than a slow one.
 *   2. What the settings screen says has to be read from the store, not from a
 *      flag. The phone can reclaim the space, and a flag would go on claiming
 *      the model is here long after it went.
 *
 * The half that cannot be tested here is the phone: nothing in CI has an
 * Android WebView, an IndexedDB quota, or a metered connection.
 */

/** An in-memory stand-in for the IndexedDB store. */
function memoryStore(): ModelFileStore & { rows: Map<string, StoredFile> } {
  const rows = new Map<string, StoredFile>();
  return {
    rows,
    async get(key) {
      return rows.get(key) ?? null;
    },
    async put(key, file) {
      rows.set(key, file);
    },
    async list() {
      return [...rows.entries()].map(([key, file]) => ({
        key,
        bytes: file.body.byteLength,
        at: file.at,
      }));
    },
    async clear() {
      rows.clear();
    },
  };
}

/** A store where every operation fails, like a phone with no space left. */
function brokenStore(): ModelFileStore {
  return {
    async get() { throw new Error('no'); },
    async put() { throw new Error('no space'); },
    async list() { throw new Error('no'); },
    async clear() { throw new Error('no'); },
  };
}

const PREFIX = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/';
const WEIGHTS_URL = `https://huggingface.co/${AI_MODEL_ID}/resolve/main/onnx/encoder_model_quantized.onnx`;

function bytes(n: number): ArrayBuffer {
  return new Uint8Array(n).fill(7).buffer;
}

describe('keeping a model file', () => {
  it('gives back exactly what was put in', async () => {
    const store = memoryStore();
    const cache = createModelCache(store);
    await cache.put(WEIGHTS_URL, new Response(bytes(2048), { headers: { 'content-type': 'application/octet-stream' } }));

    const hit = await cache.match(WEIGHTS_URL);
    expect(hit).toBeDefined();
    expect((await hit!.arrayBuffer()).byteLength).toBe(2048);
    expect(hit!.headers.get('content-type')).toBe('application/octet-stream');
  });

  it('reports a miss rather than an empty file', async () => {
    const cache = createModelCache(memoryStore());
    expect(await cache.match(WEIGHTS_URL)).toBeUndefined();
  });

  it('takes over what the browser cache already downloaded', async () => {
    // A phone that has run this app before already has the model in the cache
    // transformers.js used. Re-downloading 70MB to move it would be absurd.
    const store = memoryStore();
    const previous = {
      match: vi.fn().mockResolvedValue(new Response(bytes(1024))),
    };
    const cache = createModelCache(store, previous);

    const hit = await cache.match(WEIGHTS_URL);
    expect(hit).toBeDefined();
    // Copied across, so the next launch reads it from the new store.
    await vi.waitFor(() => expect(store.rows.has(WEIGHTS_URL)).toBe(true));
  });
});

describe('when the store will not cooperate', () => {
  it('a failed write is not an error the model load can see', async () => {
    const cache = createModelCache(brokenStore());
    // No space on the phone. The file was still downloaded and is still usable
    // for this run; it simply is not kept.
    await expect(cache.put(WEIGHTS_URL, new Response(bytes(16)))).resolves.toBeUndefined();
  });

  it('a failed read reports a miss, so the file is fetched as before', async () => {
    const cache = createModelCache(brokenStore());
    expect(await cache.match(WEIGHTS_URL)).toBeUndefined();
  });

  it('a failed previous-cache read is a miss, not a crash', async () => {
    const previous = { match: vi.fn().mockRejectedValue(new Error('locked')) };
    const cache = createModelCache(memoryStore(), previous);
    expect(await cache.match(WEIGHTS_URL)).toBeUndefined();
  });

  it('a runtime that could not be fetched is reported, not thrown', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    vi.stubGlobal('fetch', fetchMock);
    expect(await storeRuntime(memoryStore(), PREFIX)).toBe(false);
    vi.unstubAllGlobals();
  });
});

describe('the runtime', () => {
  it('is only offered when both of its halves are here', async () => {
    const store = memoryStore();
    const urls = runtimeUrls(PREFIX);
    // The .wasm alone is not a usable runtime, and pairing a stored half with
    // a fetched half risks two different versions.
    await store.put(urls.wasm, { body: bytes(64), headers: [], at: Date.now() });
    expect(await loadStoredRuntime(store, PREFIX)).toBeNull();

    await store.put(urls.mjs, { body: bytes(32), headers: [], at: Date.now() });
    const loaded = await loadStoredRuntime(store, PREFIX);
    expect(loaded?.wasmBinary.byteLength).toBe(64);
    expect(loaded?.mjsUrl).toMatch(/^blob:/);
  });

  it('asks for the file names the loader actually looks for', () => {
    const urls = runtimeUrls(PREFIX);
    expect(urls.wasm).toBe(`${PREFIX}ort-wasm-simd-threaded.jsep.wasm`);
    expect(urls.mjs).toBe(`${PREFIX}ort-wasm-simd-threaded.jsep.mjs`);
  });
});

describe('what the settings screen is told', () => {
  it('says nothing is here when nothing is here', async () => {
    const report = await readModelReport(memoryStore(), PREFIX);
    expect(report.state).toBe('absent');
    expect(report.bytes).toBe(0);
  });

  it('does not claim ready on the weights alone', async () => {
    const store = memoryStore();
    await store.put(WEIGHTS_URL, { body: bytes(4096), headers: [], at: Date.now() });
    const report = await readModelReport(store, PREFIX);
    expect(report.state).toBe('partial');
    expect(report.weights).toBe(true);
    expect(report.runtime).toBe(false);
  });

  it('claims ready only after a load has actually succeeded', async () => {
    const store = memoryStore();
    const urls = runtimeUrls(PREFIX);
    await store.put(WEIGHTS_URL, { body: bytes(4096), headers: [], at: Date.now() });
    await store.put(urls.wasm, { body: bytes(2048), headers: [], at: Date.now() });
    await store.put(urls.mjs, { body: bytes(128), headers: [], at: Date.now() });

    // Everything is here, but nothing has proved it can be loaded yet.
    expect((await readModelReport(store, PREFIX)).state).toBe('partial');

    await markModelReady(store);
    const report = await readModelReport(store, PREFIX);
    expect(report.state).toBe('ready');
    expect(report.bytes).toBeGreaterThan(6000);
  });

  it('counts sizes the way a person reads them', () => {
    expect(formatBytes(0)).toBe('0 MB');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(5.5 * 1024 * 1024)).toBe('5.5 MB');
    expect(formatBytes(72 * 1024 * 1024)).toBe('72 MB');
  });
});

describe('when it is fetched', () => {
  const online = { online: true };

  it('not at all once it is here', () => {
    expect(shouldDownloadNow(online, 'ready')).toBe(false);
  });

  it('not on a device that cannot keep it', () => {
    expect(shouldDownloadNow(online, 'unsupported')).toBe(false);
  });

  it('not while offline', () => {
    expect(shouldDownloadNow({ online: false }, 'absent')).toBe(false);
  });

  it('not on mobile data — this is 70MB of it', () => {
    expect(shouldDownloadNow({ online: true, type: 'cellular' }, 'absent')).toBe(false);
  });

  it('not when the user has asked apps to use less data', () => {
    expect(shouldDownloadNow({ online: true, type: 'wifi', saveData: true }, 'absent')).toBe(false);
  });

  it('on wi-fi, and on a connection the phone will not describe', () => {
    expect(shouldDownloadNow({ online: true, type: 'wifi' }, 'absent')).toBe(true);
    // Most desktop browsers report nothing at all; treating that as metered
    // would mean the model never downloads on its own anywhere.
    expect(shouldDownloadNow(online, 'absent')).toBe(true);
  });

  it('to finish a half-finished download', () => {
    expect(shouldDownloadNow({ online: true, type: 'wifi' }, 'partial')).toBe(true);
  });
});
