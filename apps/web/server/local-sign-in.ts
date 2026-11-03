/**
 * local-sign-in.ts -- the demo's sign-in, which the local server alone answers in the login page's place: a session minted for the seeded member with no provider between, and the browser sent on as a sign-in sends it.
 *
 * `run.sh --demo` signs the desktop in to the local server as a member the
 * demo seed wrote, who holds no Google or GitHub account, so that the
 * deployment's OAuth secrets never reach the Mac. The desktop's authorize
 * finds no session and sends the browser to the login page (`LOGIN_PAGE`),
 * which this answers instead: it mints a session for the member through
 * Better Auth's own adapter, records the way in on the account and sets the
 * cookie as Better Auth's sign-in would, and sends the browser back to
 * authorize, which now sees a session and goes on to the desktop's loopback
 * as it does once a provider returns. A request with no authorization to
 * resume is a browser's own, which lands on the web app signed in.
 *
 * A session for anyone, unasked, is what no deployment may ever answer, so
 * two guards hold this to one machine. It mounts among the local server's own
 * routes (`scripts/local-server.ts`), never under `server/routes/`, and no
 * function's bundle may reach this module: the deploy's bundle step and
 * `tests/vercel-functions.test.ts` both refuse one that does. And each request
 * reads the environment again and is refused wherever the local server would
 * have refused to start (`local-server-guard.ts`), so a copy mounted beside a
 * Vercel deployment's variables, or over a database off this machine, mints
 * nothing.
 */

import { verifyOAuthQueryParams } from "@better-auth/oauth-provider";
import {
  SOCIAL_PROVIDER,
  type SocialProvider,
  socialProviderFromState,
} from "@luke/features/sign-in-provider";
import { LOGIN_PAGE } from "@luke/service/auth/auth-policy";
import type { Route } from "@luke/service/route";
import type { AuthContext } from "better-auth";
import { makeSignature } from "better-auth/crypto";
import { localServerRefusal } from "./local-server-guard.js";

/** The path the sign-in answers: the login page the OAuth provider sends an authorization to. */
export const LOCAL_SIGN_IN_PATH = LOGIN_PAGE;

/** Better Auth's authorize endpoint, under the handler's mount, where a resumed authorization goes back to. */
const AUTHORIZE_PATH = "/api/auth/oauth2/authorize";

/** The web app's address, where a sign-in with no authorization to resume lands. */
const WEB_APP_PATH = "/app";

/**
 * What the OAuth provider adds to the query it signs for the login page,
 * which authorize never reads: the signature, its expiry, its issue time, a
 * post-login flag, and the names of the parameters signed.
 */
const SIGNING_PARAMETERS = ["sig", "exp", "ba_iat", "ba_pl", "ba_param"] as const;

const PROMPT = { PARAMETER: "prompt", LOGIN: "login" } as const;

/** The authorization's parameter the desktop names the provider its card chose in, ahead of the entropy. */
const STATE_PARAMETER = "state";

const STATUS = { FOUND: 302, BAD_REQUEST: 400, FORBIDDEN: 403, CONFLICT: 409 } as const;

/** What the sign-in reads of Better Auth's context: the secret, the session cookie, and the adapter it mints through. */
type SignInContext = Pick<
  AuthContext,
  "secret" | "authCookies" | "sessionConfig" | "internalAdapter"
>;

/** A Better Auth instance, as the sign-in asks of one: its context. */
export interface LocalSignInAuth {
  readonly $context: Promise<SignInContext>;
}

function refused(status: number, reason: string): Response {
  return new Response(reason, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

/**
 * The authorization the login page was sent to resume, as authorize takes it
 * back once a session stands; undefined where the query is not one the
 * provider signed, or its signature has expired.
 *
 * Note that we drop `login` from `prompt`, and the signing parameters with
 * it, as the provider's own hook does once a sign-in on the login page sets a
 * session, because authorize answers `prompt=login`, which the desktop always
 * sends, with the login page again whatever session stands, and the session
 * just minted is the login it asked for. It is done only once the signature
 * verifies, so what goes back to authorize is a query authorize itself
 * issued, within its lifetime, and never one a link made up.
 */
async function resumedAuthorization(
  query: URLSearchParams,
  secret: string,
): Promise<URLSearchParams | undefined> {
  if (!(await verifyOAuthQueryParams(query.toString(), secret))) return undefined;
  const resumed = new URLSearchParams(query);
  for (const name of SIGNING_PARAMETERS) resumed.delete(name);
  const prompts = (resumed.get(PROMPT.PARAMETER) ?? "")
    .split(" ")
    .filter((prompt) => prompt !== "" && prompt !== PROMPT.LOGIN);
  if (prompts.length === 0) resumed.delete(PROMPT.PARAMETER);
  else resumed.set(PROMPT.PARAMETER, prompts.join(" "));
  return resumed;
}

/**
 * The way in the sign-in records on the account, as Better Auth's
 * `lastLoginMethod` plugin records a real one's: the provider the desktop's
 * card chose, read from its authorization's `state` as the real login page
 * reads it, or GitHub for a browser's own. The web app counts a session
 * signed in only where its account names one (`@luke/host`'s cookie account
 * source), so a sign-in that left none would land on the sign-in card.
 */
function loginMethod(resumed: URLSearchParams | undefined): SocialProvider {
  return socialProviderFromState(resumed?.get(STATE_PARAMETER) ?? null) ?? SOCIAL_PROVIDER.GITHUB;
}

/** The session's cookie as Better Auth's sign-in sets it: the token signed under the secret, with the cookie's own attributes and the session's lifetime. */
async function sessionCookie(context: SignInContext, token: string): Promise<string> {
  const { name, attributes } = context.authCookies.sessionToken;
  const signed = `${token}.${await makeSignature(token, context.secret)}`;
  return [
    `${name}=${encodeURIComponent(signed)}`,
    `Max-Age=${context.sessionConfig.expiresIn}`,
    `Path=${attributes.path ?? "/"}`,
    ...(attributes.domain === undefined ? [] : [`Domain=${attributes.domain}`]),
    ...(attributes.httpOnly ? ["HttpOnly"] : []),
    ...(attributes.secure ? ["Secure"] : []),
    ...(attributes.sameSite === undefined ? [] : [`SameSite=${attributes.sameSite}`]),
  ].join("; ");
}

async function signIn(auth: LocalSignInAuth, userId: string, request: Request): Promise<Response> {
  // Note that the environment is read on every request rather than trusted from the start, so this path holds the guard however it came to be mounted.
  const refusal = localServerRefusal(process.env);
  if (refusal !== undefined) return refused(STATUS.FORBIDDEN, refusal);
  const context = await auth.$context;
  const query = new URL(request.url).searchParams;
  const resumed = query.size === 0 ? undefined : await resumedAuthorization(query, context.secret);
  if (query.size > 0 && resumed === undefined) {
    return refused(
      STATUS.BAD_REQUEST,
      "This sign-in link is not one the service issued, or it expired: start the sign-in again.",
    );
  }
  if ((await context.internalAdapter.findUserById(userId)) === null) {
    return refused(
      STATUS.CONFLICT,
      "The demo's member is not in this database: run the demo seed first.",
    );
  }
  const session = await context.internalAdapter.createSession(userId);
  await context.internalAdapter.updateUser(userId, { lastLoginMethod: loginMethod(resumed) });
  return new Response(null, {
    status: STATUS.FOUND,
    headers: {
      location: resumed === undefined ? WEB_APP_PATH : `${AUTHORIZE_PATH}?${resumed}`,
      "set-cookie": await sessionCookie(context, session.token),
    },
  });
}

/** The sign-in, answering every request as the member whose id it is handed, under the auth instance's own secret and adapter. */
export function localSignIn(auth: LocalSignInAuth, userId: string): Route {
  return { fetch: (request) => signIn(auth, userId, request) };
}
