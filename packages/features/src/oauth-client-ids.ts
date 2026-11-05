/**
 * oauth-client-ids.ts -- the ids our own OAuth clients sign in under, spelled once for the service that seeds them and the clients that sign in as them.
 *
 * The service seeds each client's row under its id at every deployment build
 * (`@repo/service/auth/oauth-clients`), and a client names the same id on
 * its authorization and token requests, so the two read it from here and
 * cannot disagree. It imports nothing, so a client of any platform may read
 * it without resolving the service.
 */

/** Each first-party client's OAuth `client_id`: the Mac's, and the command-line tool's. */
export const FIRST_PARTY_OAUTH_CLIENT_ID = {
  DESKTOP: "desktop",
  CLI: "vespin-cli",
} as const;
