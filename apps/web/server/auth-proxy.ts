import { APIError, createAuthMiddleware } from "better-auth/api";
import { symmetricDecrypt } from "better-auth/crypto";
import { oAuthProxy } from "better-auth/plugins";
import type { AuthDeployment } from "./auth-deployment.js";
import {
  isRecord,
  isWireString,
  recordFromJsonLine,
  unparsedWire,
  type WireBoundaryInput,
  type WireRecord,
} from "./core.js";

const PROXY_CALLBACK_PATH = "/api/auth/oauth-proxy-callback";
const SIGN_IN_PATHS = ["/sign-in/social", "/sign-in/oauth2"];
const AUTHORIZE_PATH = "/oauth2/authorize";
/** Better Auth's own default when `basePath` is not configured, as the proxy plugin spells it. */
const DEFAULT_BASE_PATH = "/api/auth";
/** The parameters the OAuth provider plugin signs the login page's query with, and the prompt that sent it there. */
const SIGNED_QUERY_PARAMS = ["sig", "exp", "ba_iat", "ba_param", "ba_pl", "prompt"];

/**
 * The authorize request a Preview's sign-in returns to once the proxied
 * profile has landed. On production the provider plugin resumes the desktop's
 * pending authorization itself, from the state it stored when the sign-in
 * began; on a Preview that state is consumed by the proxy callback, which
 * creates the session and redirects to the sign-in's `callbackURL`, and the
 * page sends none, so the proxy falls back to the auth base URL and the browser
 * lands on a 404. Naming the authorize request as the callback re-enters it
 * with the new session, and the plugin issues the code to the desktop's
 * loopback as it would have. The signature parameters go because the request
 * is re-validated whole, and `prompt=login` goes because the login it asked
 * for has just happened. The result is a path, not an absolute URL, because
 * a Preview answers on two hostnames (`VERCEL_URL` and `VERCEL_BRANCH_URL`)
 * and the session cookie was set on whichever one the browser is on; an
 * absolute URL on the base host would carry a sign-in begun on the other
 * host to a page where it is a stranger.
 */
export function resumeAuthorizeURL(basePath: string, oauthQuery: string): string {
  const params = new URLSearchParams(oauthQuery);
  for (const name of SIGNED_QUERY_PARAMS) params.delete(name);
  return `${basePath.replace(/\/$/, "")}${AUTHORIZE_PATH}?${params.toString()}`;
}

/** Read only proxy state; an ordinary provider state is not this guard's concern. */
export async function oauthProxyCallbackURL(
  state: string,
  secret: string,
): Promise<string | undefined> {
  let statePackage: WireRecord | undefined;
  try {
    statePackage = recordFromJsonLine(await symmetricDecrypt({ key: secret, data: state }));
  } catch {
    return undefined;
  }
  // Better Auth's relay hook treats every truthy marker as proxy state. The
  // guard must recognize exactly that set or a differently typed marker could
  // reach the relay without its destination being checked.
  if (!statePackage?.isOAuthProxy) return undefined;
  if (!isWireString(statePackage.stateCookie)) throw new Error("Invalid OAuth proxy state");

  const stateData = recordFromJsonLine(
    await symmetricDecrypt({ key: secret, data: statePackage.stateCookie }),
  );
  if (!isWireString(stateData?.callbackURL)) throw new Error("Invalid OAuth proxy callback");
  return stateData.callbackURL;
}

function originMatchesPattern(origin: string, pattern: string): boolean {
  const wildcard = "proxy-wildcard";
  const wildcardCount = pattern.match(/\*/g)?.length ?? 0;
  if (wildcardCount > 1) return false;

  let candidate: URL;
  let configured: URL;
  try {
    candidate = new URL(origin);
    configured = new URL(pattern.replaceAll("*", wildcard));
  } catch {
    return false;
  }

  if (
    configured.protocol !== "https:" ||
    configured.username !== "" ||
    configured.password !== "" ||
    configured.pathname !== "/" ||
    configured.search !== "" ||
    configured.hash !== "" ||
    candidate.origin !== origin
  ) {
    return false;
  }

  const hostnamePattern = configured.hostname
    .split(wildcard)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("[^.]+");

  return (
    candidate.protocol === configured.protocol &&
    candidate.port === configured.port &&
    new RegExp(`^${hostnamePattern}$`, "u").test(candidate.hostname)
  );
}

/** The relay may return tokens only to the configured Preview callback and page. */
export function isTrustedProxyCallback(callbackURL: string, trustedOrigins: string[]): boolean {
  let callback: URL;
  try {
    callback = new URL(callbackURL);
  } catch {
    return false;
  }

  const [finalCallback, ...surplusCallbacks] = callback.searchParams.getAll("callbackURL");
  if (
    callback.pathname !== PROXY_CALLBACK_PATH ||
    finalCallback === undefined ||
    surplusCallbacks.length > 0 ||
    [...callback.searchParams.keys()].some((key) => key !== "callbackURL")
  ) {
    return false;
  }

  let finalOrigin: string;
  try {
    finalOrigin = new URL(finalCallback, callback.origin).origin;
  } catch {
    return false;
  }

  return trustedOrigins.some(
    (pattern) =>
      originMatchesPattern(callback.origin, pattern) && originMatchesPattern(finalOrigin, pattern),
  );
}

/**
 * Keep production as the OAuth relay without making the shared proxy key a
 * credential for production sessions.
 *
 * Better Auth's plugin combines two different roles: hooks that exchange the
 * provider's code on the registered production callback, and an endpoint that
 * decrypts the resulting profile and creates a session. Production needs the
 * first role for Preview sign-in, but the second role belongs only on the
 * Preview that initiated it.
 */
export function authProxy(deployment: AuthDeployment) {
  const proxy = oAuthProxy({
    productionURL: deployment.productionURL,
    secret: deployment.proxySecret,
  });

  if (deployment.acceptsProxyProfiles) {
    // Ahead of the proxy's own sign-in hook, which reads the callback this sets.
    const resumeDesktopAuthorization = {
      matcher(context: { path?: string }) {
        return context.path !== undefined && SIGN_IN_PATHS.includes(context.path);
      },
      handler: createAuthMiddleware(async (ctx) => {
        // SAFETY: Better Auth hands over its parsed body as structured-clone data; the wire guards below validate the selected fields.
        const body = unparsedWire(ctx.body as WireBoundaryInput);
        if (!isRecord(body) || body.callbackURL !== undefined) return;
        if (!isWireString(body.oauth_query)) return;
        // Note that the body is written in place rather than returned as a
        // context patch, because Better Auth applies a returned patch to the
        // endpoint alone after every before hook has run, and the proxy's own
        // hook right behind this one reads the callback from the same body.
        ctx.body.callbackURL = resumeAuthorizeURL(
          ctx.context.options.basePath ?? DEFAULT_BASE_PATH,
          body.oauth_query,
        );
      }),
    };
    return {
      ...proxy,
      hooks: { ...proxy.hooks, before: [resumeDesktopAuthorization, ...proxy.hooks.before] },
    };
  }

  const proxySecret = deployment.proxySecret;
  if (proxySecret === undefined) {
    return {
      ...proxy,
      endpoints: {},
      hooks: { before: [], after: [] },
    };
  }

  const guardRelayDestination = {
    matcher(context: { path?: string }) {
      return context.path === "/callback/:id";
    },
    handler: createAuthMiddleware(async (ctx) => {
      // SAFETY: Better Auth hands over its parsed query as structured-clone data; the wire guards below validate the selected field.
      const query = unparsedWire(ctx.query as WireBoundaryInput);
      // SAFETY: Better Auth hands over its parsed body as structured-clone data; the wire guards below validate the selected field.
      const body = unparsedWire(ctx.body as WireBoundaryInput);
      const queryState = isRecord(query) ? query.state : undefined;
      const bodyState = isRecord(body) ? body.state : undefined;
      const state = [queryState, bodyState].find(isWireString);
      if (state === undefined) return;

      let callbackURL: string | undefined;
      try {
        callbackURL = await oauthProxyCallbackURL(state, proxySecret);
      } catch {
        throw new APIError("BAD_REQUEST", { message: "Invalid OAuth proxy state" });
      }
      if (callbackURL === undefined) return;
      if (!isTrustedProxyCallback(callbackURL, deployment.proxyTrustedOrigins)) {
        throw new APIError("BAD_REQUEST", { message: "Untrusted OAuth proxy callback" });
      }
    }),
  };

  return {
    ...proxy,
    endpoints: {},
    hooks: {
      ...proxy.hooks,
      before: [guardRelayDestination, ...proxy.hooks.before],
    },
  };
}
