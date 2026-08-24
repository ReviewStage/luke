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
