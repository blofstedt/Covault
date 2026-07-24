// lib/log.ts
//
// Lightweight logger. `debug`/`info` are silenced in production builds so the
// browser console isn't spammed and internal detail isn't leaked; `warn`/`error`
// always emit. In dev and in tests `import.meta.env.PROD` is false, so everything
// logs — the same behaviour the raw `console.*` calls had.
//
// This is the one module allowed to call `console.*` directly.

const isProd = (() => {
  try {
    return Boolean((import.meta as { env?: { PROD?: boolean } }).env?.PROD);
  } catch {
    return false;
  }
})();

type LogFn = (...args: unknown[]) => void;
const noop: LogFn = () => {};

export const log: { debug: LogFn; info: LogFn; warn: LogFn; error: LogFn } = {
  debug: isProd ? noop : (...args) => console.log(...args),
  info: isProd ? noop : (...args) => console.info(...args),
  warn: (...args) => console.warn(...args),
  error: (...args) => console.error(...args),
};
