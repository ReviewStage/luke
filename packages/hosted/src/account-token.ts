/**
 * Who a call to Luke's own service is on behalf of. Every client that speaks
 * to the service on the signed-in account — the brain's transports, the voice
 * mint, the key vault, the event sender — is handed the same pair rather than
 * the account itself: the token is read fresh for every attempt, so a client
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
}
