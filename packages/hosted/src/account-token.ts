/**
 * Who a call to Luke's own service is on behalf of. Every client that speaks
 * to the service on the signed-in account — the brain's transports, the voice
 * mint, the key vault, the event sender — is handed these rather than the
 * account itself: the token is read fresh for every attempt, so a client
 * holds none, and the account lifecycle stays the one thing that knows how a
 * session is kept.
 */
export interface AccountToken {
  /** The signed-in account's current access token, read fresh for every attempt. */
  readAccessToken: () => Promise<string | undefined>;
  /**
   * Asks the account lifecycle to refresh its tokens. Access tokens outlive a
   * call by an hour at most while the app runs for days, so a 401 is routine:
   * the call retries once with whatever the refresh produced, and only a
   * second refusal is reported.
   */
  refreshAccount: () => Promise<void>;
  /**
   * Who the token answers for, as an opaque identity, for the one comparison
   * a refreshed token needs: a sign-out and sign-in between an attempt and
   * its retry must read as the caller's account gone rather than as a fresh
   * bearer to carry the old account's payload under. An account lifecycle
   * with no identity to name omits it, and then the comparison does not
   * exist.
   */
  readAccountKey?: (() => Promise<string | undefined>) | undefined;
}
