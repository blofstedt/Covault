const AUTH_PARAMETERS = ['code', 'error', 'error_code', 'error_description'];

export const OAUTH_CALLBACK_FAILURE = "We couldn't finish Google sign-in. Please try again.";

/** Capture before Supabase constructs its client and consumes a successful code. */
export function captureOAuthCallback(url: URL) {
  const query = new URLSearchParams();
  const fragment = new URLSearchParams();
  const sourceFragment = new URLSearchParams(url.hash.slice(1));
  for (const key of AUTH_PARAMETERS) {
    for (const value of url.searchParams.getAll(key)) query.append(key, value);
    for (const value of sourceFragment.getAll(key)) fragment.append(key, value);
  }
  if (!query.toString() && !fragment.toString()) return null;
  return { query, fragment };
}

type OAuthCallback = NonNullable<ReturnType<typeof captureOAuthCallback>>;

export function callbackRecoveryMessage(
  callback: OAuthCallback,
  result: { initializationFailed: boolean; sessionFailed: boolean; hasSession: boolean },
): string | null {
  const error = callback.query.get('error') ?? callback.fragment.get('error');
  if (error === 'access_denied') return 'Google sign-in was cancelled. You can try again.';
  const hasError = ['error', 'error_code', 'error_description'].some(
    key => callback.query.has(key) || callback.fragment.has(key),
  );
  if (hasError || result.initializationFailed || result.sessionFailed || !result.hasSession) {
    return OAUTH_CALLBACK_FAILURE;
  }
  return null;
}

/** Remove this callback's parameters only, retaining any later callback and other URL state. */
export function clearOAuthCallbackParameters(url: URL, callback: OAuthCallback): string {
  const cleaned = new URL(url);
  const fragment = new URLSearchParams(cleaned.hash.slice(1));
  const removeConsumed = (current: URLSearchParams, captured: URLSearchParams) => {
    let changed = false;
    for (const key of AUTH_PARAMETERS) {
      const before = captured.getAll(key);
      const now = current.getAll(key);
      if (before.length && before.length === now.length && before.every((value, i) => value === now[i])) {
        current.delete(key);
        changed = true;
      }
    }
    return changed;
  };
  removeConsumed(cleaned.searchParams, callback.query);
  if (removeConsumed(fragment, callback.fragment)) cleaned.hash = fragment.toString();
  return cleaned.href;
}
