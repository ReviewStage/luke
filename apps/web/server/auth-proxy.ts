import { APIError, createAuthMiddleware } from "better-auth/api";
import { symmetricDecrypt } from "better-auth/crypto";
import { oAuthProxy } from "better-auth/plugins";
import type { AuthDeployment } from "./auth-deployment.js";

const PROXY_CALLBACK_PATH = "/api/auth/oauth-proxy-callback";

type ProxyWirePrimitive = string | number | boolean | null;
type ProxyWireRecord = { readonly [key: string]: ProxyWireValue };
type ProxyWireValue = ProxyWirePrimitive | ProxyWireRecord | readonly ProxyWireValue[];
type UnparsedProxyWireValue = ProxyWireValue | undefined;

function runtimeTag(value: UnparsedProxyWireValue): string {
  return Object.prototype.toString.call(value);
}

function isProxyWireRecord(value: UnparsedProxyWireValue): value is ProxyWireRecord {
  if (value === null || value === undefined || runtimeTag(value) !== "[object Object]")
    return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isProxyWireString(value: UnparsedProxyWireValue): value is string {
  return runtimeTag(value) === "[object String]";
}

function parsedJSON(value: string): ProxyWireRecord | undefined {
  try {
    // SAFETY: JSON.parse returns a runtime value; isProxyWireRecord validates the object contract.
    const parsed = JSON.parse(value) as UnparsedProxyWireValue;
    return isProxyWireRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** Read only proxy state; an ordinary provider state is not this guard's concern. */
export async function oauthProxyCallbackURL(
  state: string,
  secret: string,
): Promise<string | undefined> {
  let statePackage: ProxyWireRecord | undefined;
  try {
    statePackage = parsedJSON(await symmetricDecrypt({ key: secret, data: state }));
  } catch {
    return undefined;
  }
  if (statePackage?.isOAuthProxy !== true) return undefined;
  if (!isProxyWireString(statePackage.stateCookie)) throw new Error("Invalid OAuth proxy state");

  const stateData = parsedJSON(
    await symmetricDecrypt({ key: secret, data: statePackage.stateCookie }),
  );
  if (!isProxyWireString(stateData?.callbackURL)) throw new Error("Invalid OAuth proxy callback");
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

  if (wildcardCount === 0) return candidate.origin === configured.origin;

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

  if (
    callback.pathname !== PROXY_CALLBACK_PATH ||
    callback.searchParams.getAll("callbackURL").length !== 1 ||
    [...callback.searchParams.keys()].some((key) => key !== "callbackURL")
  ) {
    return false;
  }

  const finalCallback = callback.searchParams.get("callbackURL");
  if (finalCallback === null) return false;

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

  if (deployment.acceptsProxyProfiles) return proxy;

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
      // SAFETY: Better Auth owns these parsed request values; the wire readers below validate the selected field.
      const query = ctx.query as UnparsedProxyWireValue;
      // SAFETY: Better Auth owns these parsed request values; the wire readers below validate the selected field.
      const body = ctx.body as UnparsedProxyWireValue;
      const queryState = isProxyWireRecord(query) ? query.state : undefined;
      const bodyState = isProxyWireRecord(body) ? body.state : undefined;
      const state = isProxyWireString(queryState) ? queryState : bodyState;
      if (!isProxyWireString(state)) return;

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
