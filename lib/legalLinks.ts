import { Capacitor } from '@capacitor/core';

export const DEPLOYED_ORIGIN = 'https://covaultbudgeting.vercel.app';

/**
 * Returns the href for an internal site path (e.g. '/privacy', '/terms', '/delete').
 *
 * Root-relative on the web (including local dev) so navigation stays on the
 * current host and port.
 *
 * Absolute deployed URL inside the native Capacitor Android app, because the
 * WebView origin is an internal localhost address and external target="_blank"
 * links are opened by the system browser, which cannot resolve app-relative paths.
 */
export function getLegalLinkHref(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  if (Capacitor.isNativePlatform()) {
    return `${DEPLOYED_ORIGIN}${normalizedPath}`;
  }
  return normalizedPath;
}
