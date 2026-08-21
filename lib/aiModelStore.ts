// lib/aiModelStore.ts
//
// Where the on-device AI model actually lives.
//
// The model is 'Xenova/flan-t5-small', fetched from huggingface.co the first
// time something needs it — which is, by definition, the worst possible
// moment: a capture the parser was unsure about, with the user waiting. And it
// was never reliably kept, so "the first time" could be any time. The result
// was an AI fallback that needed a working connection to do anything at all,
// on an app whose whole point is catching purchases the moment they happen.
//
// Transformers.js has one hook for this — `env.customCache`, an object with
// the `match` and `put` of the Web Cache API — and this is that object, backed
// by IndexedDB. Three reasons for IndexedDB rather than the browser cache it
// would otherwise use:
//
//   1. It is the same store on every Android WebView, rather than whatever
//      that WebView's Cache Storage happens to do.
//   2. It can be counted, so the settings screen can say "ready, 74 MB on this
//      phone" instead of the app claiming something it cannot see.
//   3. It survives the app updating itself, since a web bundle swap does not
//      change the origin the data belongs to.
//
// The ONNX runtime is kept here too. It is fetched separately by the runtime
// loader rather than through the cache above, so a stored copy of the model
// with no stored runtime is still an app that cannot infer offline. See
// `loadStoredRuntime`.
//
// Every path in here is best-effort by construction: a failure to open, read
// or write the store degrades to exactly the behaviour that exists today —
// fetch it from the network — and never to a thrown error. Nothing about
// capture depends on any of it.

import { log } from './log';

/** The model this app runs. Mirrors MODEL_ID in aiExtractor.ts. */
export const AI_MODEL_ID = 'Xenova/flan-t5-small';

const DB_NAME = 'covault-ai-model';
const DB_VERSION = 1;
const STORE_NAME = 'files';

/** Set once a full load has completed, so "ready" means loadable, not "some bytes". */
const READY_KEY = '__covault_model_ready__';

export interface StoredFile {
  /** The file itself. */
  body: ArrayBuffer;
  /** Response headers, kept so a cache hit is indistinguishable from a fetch. */
  headers: Array<[string, string]>;
  /** When it was stored. */
  at: number;
}

/**
 * The storage the cache is built on. An interface so the cache logic can be
 * tested without an IndexedDB, and so a phone without one degrades cleanly.
 */
export interface ModelFileStore {
  get(key: string): Promise<StoredFile | null>;
  put(key: string, file: StoredFile): Promise<void>;
  list(): Promise<Array<{ key: string; bytes: number; at: number }>>;
  clear(): Promise<void>;
}

// ─── IndexedDB backing ───────────────────────────────────────────

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') {
        resolve(null);
        return;
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        log.warn('[aiModel] Could not open the model store:', request.error);
        resolve(null);
      };
      // A blocked upgrade would otherwise hang this promise for ever, and it is
      // awaited on the model's load path.
      request.onblocked = () => resolve(null);
    } catch (e) {
      log.warn('[aiModel] Could not open the model store:', e);
      resolve(null);
    }
  });
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function db(): Promise<IDBDatabase | null> {
  if (!dbPromise) dbPromise = openDb();
  return dbPromise;
}

/** Reset the memoised handle. Tests only. */
export function _resetModelStoreForTesting(): void {
  dbPromise = null;
}

function request<T>(op: IDBRequest<T>): Promise<T | null> {
  return new Promise((resolve) => {
    op.onsuccess = () => resolve(op.result);
    op.onerror = () => {
      log.warn('[aiModel] Model store operation failed:', op.error);
      resolve(null);
    };
  });
}

export function createIdbStore(): ModelFileStore {
  return {
    async get(key) {
      const handle = await db();
      if (!handle) return null;
      try {
        const tx = handle.transaction(STORE_NAME, 'readonly');
        const row = await request<StoredFile>(tx.objectStore(STORE_NAME).get(key));
        return row && row.body ? row : null;
      } catch (e) {
        log.warn('[aiModel] Could not read from the model store:', e);
        return null;
      }
    },
    async put(key, file) {
      const handle = await db();
      if (!handle) return;
      try {
        const tx = handle.transaction(STORE_NAME, 'readwrite');
        await request(tx.objectStore(STORE_NAME).put(file, key));
      } catch (e) {
        // Out of space is the expected failure here. The model simply is not
        // kept, and the next load fetches it again.
        log.warn('[aiModel] Could not write to the model store:', e);
      }
    },
    async list() {
      const handle = await db();
      if (!handle) return [];
      try {
        const tx = handle.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const keys = (await request<IDBValidKey[]>(store.getAllKeys())) || [];
        const values = (await request<StoredFile[]>(store.getAll())) || [];
        return keys.map((key, i) => ({
          key: String(key),
          bytes: values[i]?.body?.byteLength || 0,
          at: values[i]?.at || 0,
        }));
      } catch (e) {
        log.warn('[aiModel] Could not list the model store:', e);
        return [];
      }
    },
    async clear() {
      const handle = await db();
      if (!handle) return;
      try {
        const tx = handle.transaction(STORE_NAME, 'readwrite');
        await request(tx.objectStore(STORE_NAME).clear());
      } catch (e) {
        log.warn('[aiModel] Could not clear the model store:', e);
      }
    },
  };
}

// ─── The cache transformers.js talks to ──────────────────────────

/**
 * A Web-Cache-shaped view of the store, which is the contract
 * `env.customCache` has to satisfy: `match(key)` returning a Response or
 * undefined, and `put(key, response)`.
 *
 * `previous` is the browser cache transformers.js used before this existed. A
 * miss falls back to it and copies what it finds across, so a phone that has
 * already downloaded the model once does not download it a second time.
 */
export function createModelCache(
  store: ModelFileStore,
  previous?: { match(key: string): Promise<Response | undefined> },
) {
  return {
    async match(key: string): Promise<Response | undefined> {
      // A read that fails has to look exactly like a file that was never kept,
      // because the caller's next move is then to fetch it — which is the
      // behaviour that existed before any of this. Throwing here would take
      // the whole model load down with it.
      let stored: StoredFile | null = null;
      try {
        stored = await store.get(key);
      } catch (e) {
        log.warn('[aiModel] Could not read a stored model file:', e);
      }
      if (stored) {
        return new Response(stored.body, { headers: stored.headers });
      }
      if (!previous) return undefined;
      try {
        const hit = await previous.match(key);
        if (!hit) return undefined;
        // Copy it over so the next launch reads it from here.
        const body = await hit.clone().arrayBuffer();
        void store.put(key, {
          body,
          headers: [...hit.headers.entries()],
          at: Date.now(),
        });
        return hit;
      } catch (e) {
        log.warn('[aiModel] Could not read the previous browser cache:', e);
        return undefined;
      }
    },
    async put(key: string, response: Response): Promise<void> {
      try {
        const body = await response.clone().arrayBuffer();
        await store.put(key, {
          body,
          headers: [...response.headers.entries()],
          at: Date.now(),
        });
      } catch (e) {
        // Never allowed to throw: transformers.js treats a failed put as fatal
        // for the load in some paths, and a file we could not keep is still a
        // file we successfully downloaded.
        log.warn('[aiModel] Could not keep a model file:', e);
      }
    },
  };
}

// ─── The ONNX runtime ────────────────────────────────────────────

/**
 * The two files the runtime loader fetches, given the CDN prefix aiExtractor
 * pins. The .wasm is the runtime itself; the .mjs is the small loader that
 * instantiates it, and both are needed before a single token can be generated.
 */
export function runtimeUrls(prefix: string): { wasm: string; mjs: string } {
  const base = prefix.endsWith('/') ? prefix : `${prefix}/`;
  return {
    wasm: `${base}ort-wasm-simd-threaded.jsep.wasm`,
    mjs: `${base}ort-wasm-simd-threaded.jsep.mjs`,
  };
}

/** Fetch the runtime and keep it, so later launches need no network for it. */
export async function storeRuntime(store: ModelFileStore, prefix: string): Promise<boolean> {
  const urls = runtimeUrls(prefix);
  try {
    const files = await Promise.all(
      [urls.wasm, urls.mjs].map(async (url) => {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`${res.status} for ${url}`);
        return { url, body: await res.arrayBuffer(), headers: [...res.headers.entries()] as Array<[string, string]> };
      }),
    );
    for (const file of files) {
      await store.put(file.url, { body: file.body, headers: file.headers, at: Date.now() });
    }
    return true;
  } catch (e) {
    log.warn('[aiModel] Could not keep the AI runtime on this phone:', e);
    return false;
  }
}

/**
 * The stored runtime, in the two forms the loader accepts.
 *
 * The .wasm goes in as raw bytes (`wasmBinary`), which the runtime prefers
 * over any path. The .mjs has to be a URL because the loader imports it as a
 * module, so it is handed back as a blob URL over the stored bytes.
 *
 * Returns null when either half is missing: half a stored runtime is not
 * usable offline, and mixing a stored .wasm with a fetched .mjs risks pairing
 * two different versions.
 */
export async function loadStoredRuntime(
  store: ModelFileStore,
  prefix: string,
): Promise<{ wasmBinary: ArrayBuffer; mjsUrl: string } | null> {
  try {
    const urls = runtimeUrls(prefix);
    const [wasm, mjs] = await Promise.all([store.get(urls.wasm), store.get(urls.mjs)]);
    if (!wasm || !mjs) return null;
    if (typeof URL === 'undefined' || !URL.createObjectURL) return null;
    const mjsUrl = URL.createObjectURL(
      new Blob([mjs.body], { type: 'text/javascript' }),
    );
    return { wasmBinary: wasm.body, mjsUrl };
  } catch (e) {
    log.warn('[aiModel] Could not read the stored AI runtime:', e);
    return null;
  }
}

// ─── What the settings screen reports ────────────────────────────

export type AIModelState = 'unsupported' | 'absent' | 'partial' | 'ready';

export interface AIModelReport {
  state: AIModelState;
  /** Total bytes kept on the phone. */
  bytes: number;
  /** Whether the model weights are here. */
  weights: boolean;
  /** Whether the runtime is here. */
  runtime: boolean;
  /** When the last file was stored, epoch millis, or 0. */
  at: number;
}

/** Whether this device can keep the model at all. */
export function storageSupported(): boolean {
  return typeof indexedDB !== 'undefined';
}

export async function markModelReady(store: ModelFileStore): Promise<void> {
  await store.put(READY_KEY, { body: new ArrayBuffer(0), headers: [], at: Date.now() });
}

/**
 * What is actually on the phone, read from the store rather than from a flag.
 *
 * A flag saying "downloaded" is worth nothing here: storage can be reclaimed
 * by the system at any time, and the screen that reports this exists precisely
 * so the user is not told something the app has not checked.
 *
 * Reports only what the given store holds. Whether this device can keep
 * anything at all is a separate question with a separate answer —
 * `storageSupported` — asked by the caller that builds the real store.
 */
export async function readModelReport(
  store: ModelFileStore,
  prefix: string,
): Promise<AIModelReport> {
  let rows: Array<{ key: string; bytes: number; at: number }> = [];
  try {
    rows = await store.list();
  } catch (e) {
    log.warn('[aiModel] Could not read what is stored:', e);
  }
  const urls = runtimeUrls(prefix);
  let bytes = 0;
  let at = 0;
  let weights = false;
  let runtimeWasm = false;
  let runtimeMjs = false;
  let markedReady = false;
  for (const row of rows) {
    bytes += row.bytes;
    at = Math.max(at, row.at);
    if (row.key === READY_KEY) markedReady = true;
    else if (row.key === urls.wasm) runtimeWasm = true;
    else if (row.key === urls.mjs) runtimeMjs = true;
    else if (row.key.includes(AI_MODEL_ID) && row.bytes > 0) weights = true;
  }
  const runtime = runtimeWasm && runtimeMjs;
  let state: AIModelState = 'absent';
  if (weights && runtime && markedReady) state = 'ready';
  else if (weights || runtime) state = 'partial';
  return { state, bytes, weights, runtime, at };
}

// ─── When to fetch it ────────────────────────────────────────────

export interface ConnectionFacts {
  online: boolean;
  /** navigator.connection.type, when the WebView reports one. */
  type?: string;
  /** navigator.connection.saveData — the user asking apps to use less data. */
  saveData?: boolean;
}

/**
 * Whether now is a reasonable moment to pull down ~70MB.
 *
 * Deliberately conservative about metered connections: an unknown connection
 * type is treated as fine (most desktop browsers report nothing), but a known
 * cellular one is not, and Data Saver is always respected. Missing the moment
 * costs nothing — this is asked again on the next launch.
 */
export function shouldDownloadNow(facts: ConnectionFacts, state: AIModelState): boolean {
  if (state === 'ready' || state === 'unsupported') return false;
  if (!facts.online) return false;
  if (facts.saveData) return false;
  const metered = ['cellular', 'wimax'];
  if (facts.type && metered.includes(facts.type)) return false;
  return true;
}

/** What the browser will tell us about the connection, if anything. */
export function readConnection(): ConnectionFacts {
  const nav = typeof navigator === 'undefined' ? undefined : (navigator as any);
  const connection = nav?.connection || nav?.mozConnection || nav?.webkitConnection;
  return {
    online: nav?.onLine !== false,
    type: typeof connection?.type === 'string' ? connection.type : undefined,
    saveData: connection?.saveData === true,
  };
}

/**
 * Ask the system not to reclaim this data.
 *
 * Both IndexedDB and the browser cache are evictable by default, which for a
 * 70MB download means it can quietly disappear and be fetched again. Android's
 * WebView usually grants this without prompting; a refusal costs nothing.
 */
export async function requestDurableStorage(): Promise<boolean> {
  try {
    const storage = (navigator as any)?.storage;
    if (!storage?.persist) return false;
    if (storage.persisted && (await storage.persisted())) return true;
    return (await storage.persist()) === true;
  } catch {
    return false;
  }
}

/** Human-readable size for the settings screen. */
export function formatBytes(bytes: number): string {
  if (!bytes || bytes < 0) return '0 MB';
  const mb = bytes / (1024 * 1024);
  if (mb < 1) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}
