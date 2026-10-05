/** The authenticated owner and generation for account-owned in-memory data. */
export interface AccountDataScope {
  userId: string | null;
  generation: number;
}

export interface AccountDataScopeRef {
  current: AccountDataScope;
}

/**
 * Start a new generation whenever the authenticated owner changes. The
 * generation distinguishes an A → B → A sequence from the first A session,
 * so a response from that earlier session cannot be mistaken for current.
 */
export function transitionAccountDataScope(
  scopeRef: AccountDataScopeRef,
  userId: string | null,
): AccountDataScope {
  if (scopeRef.current.userId === userId) return scopeRef.current;

  const next = {
    userId,
    generation: scopeRef.current.generation + 1,
  };
  scopeRef.current = next;
  return next;
}

export function isCurrentAccountDataScope(
  scopeRef: AccountDataScopeRef,
  scope: AccountDataScope,
): boolean {
  return scopeRef.current.userId === scope.userId
    && scopeRef.current.generation === scope.generation;
}

export function captureAccountDataScope(
  scopeRef: AccountDataScopeRef,
  userId: string,
): AccountDataScope | null {
  return scopeRef.current.userId === userId ? scopeRef.current : null;
}
