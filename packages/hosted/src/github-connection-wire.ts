import { Schema as EffectSchema } from "effect";

/**
 * github-connection-wire.ts -- whether the account has GitHub connected, and the page in the browser that connects or disconnects it.
 *
 * GitHub is connected apart from signing in: the desktop asks the service
 * for a short-lived, single-use page that links the signed-in account's
 * GitHub, and opens it in the browser. Disconnecting happens on the same
 * page, asked for with the disconnect word. The status names the login at
 * most; no token leaves the service.
 */

/** Whether the account has a GitHub account linked, and its login where one is. */
export const githubConnectionSchema = EffectSchema.Struct({
  connected: EffectSchema.Boolean,
  login: EffectSchema.NullOr(EffectSchema.String),
});

export type GitHubConnection = typeof githubConnectionSchema.Type;

/** The page that links the account's GitHub, bound to the account for a few minutes and used once. */
export const githubConnectAnswerSchema = EffectSchema.Struct({
  url: EffectSchema.String,
});

/** The browser page that connects GitHub, and the word that asks it to disconnect instead. */
const GITHUB_CONNECT_PAGE = {
  PATH: "/connect-github.html",
  DISCONNECT_PARAM: "disconnect",
  DISCONNECT_VALUE: "1",
} as const;

/** The page that disconnects GitHub on the service at `serviceBaseUrl`. */
export function githubDisconnectUrl(serviceBaseUrl: string): string {
  const query = new URLSearchParams({
    [GITHUB_CONNECT_PAGE.DISCONNECT_PARAM]: GITHUB_CONNECT_PAGE.DISCONNECT_VALUE,
  });
  return `${serviceBaseUrl}${GITHUB_CONNECT_PAGE.PATH}?${query}`;
}
