import { Schema as EffectSchema } from "effect";
import { githubConnectionSchema } from "./tasks-view.js";

/**
 * github-connection-wire.ts -- whether the signed-in account has connected its GitHub, and the browser page that connects it.
 *
 * Workspaces come from GitHub App installations, and reading them needs the
 * account's GitHub user token, which an account that signed in some other
 * way does not hold. Better Auth links a provider to an account only for a
 * browser session (`linkSocial`), and the Mac holds an OAuth access token
 * rather than one, so connecting happens on the web: the Mac asks for a
 * connect intent, a ten-minute, single-use ticket bound to its account, and
 * opens the page the answer names. The page claims the intent on the
 * browser's own session, which must be the same account's, and only then
 * asks Better Auth to link GitHub. Disconnecting needs no page: the Mac asks
 * `POST /api/github/disconnect` under its own Better Auth session, which the
 * service hands to Better Auth's `unlinkAccount`, and the answer is the
 * connection as it then stands. No answer carries a token.
 */

/** A connect intent (POST): the page the Mac opens to connect the account's GitHub. */
export const githubConnectAnswerSchema = EffectSchema.Struct({ url: EffectSchema.String });

export type GitHubConnectAnswer = typeof githubConnectAnswerSchema.Type;

/** Whether the account has a GitHub account linked (GET), and its login where the service holds one. */
export const githubConnectionAnswerSchema = githubConnectionSchema;

export type GitHubConnection = typeof githubConnectionAnswerSchema.Type;

/** The page that connects GitHub, and the query it reads. */
export const GITHUB_CONNECT_PAGE = {
  PATH: "/connect-github.html",
  /** The opaque id of the intent the Mac asked for. */
  INTENT_PARAM: "intent",
  /** Better Auth returned the browser here with GitHub linked. */
  DONE_PARAM: "done",
  /** Better Auth returned the browser here with the link refused, its own word for why under `error`. */
  ERROR_PARAM: "error",
  /** The value a flag parameter carries. */
  FLAG: "1",
} as const;

/** Claiming an intent on the browser's session (POST), by its opaque id. */
export const githubConnectClaimRequestSchema = EffectSchema.Struct({
  intent: EffectSchema.String.check(EffectSchema.isNonEmpty()),
});

/** How a claim settled: the session's own intent is claimed, as often as asked inside its ten minutes; another account's, or one past its ten minutes, is not. */
export const GITHUB_CONNECT_CLAIM = {
  CLAIMED: "claimed",
  /** The intent is another account's; it was left standing for that account's own session. */
  OTHER_ACCOUNT: "other-account",
  /** No such intent stands: it was never made, was already claimed, or expired. */
  EXPIRED: "expired",
} as const;

export type GitHubConnectClaim = (typeof GITHUB_CONNECT_CLAIM)[keyof typeof GITHUB_CONNECT_CLAIM];

export const githubConnectClaimAnswerSchema = EffectSchema.Struct({
  claim: EffectSchema.Literals(Object.values(GITHUB_CONNECT_CLAIM)),
});
