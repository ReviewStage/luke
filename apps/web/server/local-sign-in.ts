import { verifyOAuthQueryParams } from "@better-auth/oauth-provider";
import {
  SOCIAL_PROVIDER,
  type SocialProvider,
  socialProviderFromState,
} from "@repo/features/sign-in-provider";
import { LOGIN_PAGE } from "@repo/service/auth/auth-policy";
import { localServerRefusal } from "@repo/service/local/local-server-guard";
import type { Route } from "@repo/service/route";
import type { AuthContext } from "better-auth";
import { makeSignature } from "better-auth/crypto";

export const LOCAL_SIGN_IN_PATH = LOGIN_PAGE;

const AUTHORIZE_PATH = "/api/auth/oauth2/authorize";

const WEB_APP_PATH = "/app";

const SIGNING_PARAMETERS = ["sig", "exp", "ba_iat", "ba_pl", "ba_param"] as const;

const PROMPT = { PARAMETER: "prompt", LOGIN: "login" } as const;

const STATE_PARAMETER = "state";

const STATUS = { FOUND: 302, BAD_REQUEST: 400, FORBIDDEN: 403, CONFLICT: 409 } as const;

type SignInContext = Pick<
  AuthContext,
  "secret" | "authCookies" | "sessionConfig" | "internalAdapter"
>;

export interface LocalSignInAuth {
  readonly $context: Promise<SignInContext>;
}

function refused(status: number, reason: string): Response {
  return new Response(reason, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

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

function loginMethod(resumed: URLSearchParams | undefined): SocialProvider {
  return socialProviderFromState(resumed?.get(STATE_PARAMETER) ?? null) ?? SOCIAL_PROVIDER.GITHUB;
}

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

export function localSignIn(auth: LocalSignInAuth, userId: string): Route {
  return { fetch: (request) => signIn(auth, userId, request) };
}
