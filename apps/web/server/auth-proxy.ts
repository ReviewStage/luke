import { type GenericEndpointContext, parseGenericState } from "better-auth";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { symmetricDecrypt } from "better-auth/crypto";
import { applyUpdateUserInfoOnLink, setTokenUtil } from "better-auth/oauth2";
import { oAuthProxy } from "better-auth/plugins";
import { Option, Schema } from "effect";
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
const LINK_PATH = "/link-social";
const PROXY_PROFILE_PATH = "/oauth-proxy-callback";
/** Better Auth's own default when `basePath` is not configured, as the proxy plugin spells it. */
const DEFAULT_BASE_PATH = "/api/auth";
/** The parameters the OAuth provider plugin signs the login page's query with, and the prompt that sent it there. */
const SIGNED_QUERY_PARAMS = ["sig", "exp", "ba_iat", "ba_param", "ba_pl", "prompt"];

/** The proxy plugin's own default age for a returned profile, which this deployment leaves unset. */
const PROXY_PROFILE_MAX_AGE_MS = 60_000;
/** The plugin's allowance for a relay whose clock runs ahead of this one. */
const PROXY_PROFILE_CLOCK_SKEW_MS = 10_000;

/** Why a proxied link was refused, as the `error` the Connect GitHub page is returned with. */
const PROXY_LINK_REFUSAL = {
  EXPIRED: "payload_expired",
  STATE_MISMATCH: "state_mismatch",
  SESSION_MISMATCH: "session_mismatch",
  UNABLE_TO_LINK: "unable_to_link_account",
  EMAIL_MISMATCH: "email_doesn't_match",
  LINKED_ELSEWHERE: "account_already_linked_to_different_user",
} as const;
type ProxyLinkRefusal = (typeof PROXY_LINK_REFUSAL)[keyof typeof PROXY_LINK_REFUSAL];

/**
 * The profile production's relay returns to a Preview, as the proxy plugin
 * builds it: the provider's answer, the tokens it granted, and the nonce of
 * the state the Preview stored when the flow began.
 */
const ProxiedProfile = Schema.fromJsonString(
  Schema.Struct({
    state: Schema.String,
    timestamp: Schema.Number,
    callbackURL: Schema.String,
    errorURL: Schema.optional(Schema.String),
    userInfo: Schema.Struct({
      id: Schema.String,
      email: Schema.String,
      name: Schema.String,
      image: Schema.optional(Schema.NullOr(Schema.String)),
      emailVerified: Schema.Boolean,
    }),
    account: Schema.Struct({
      providerId: Schema.String,
      accountId: Schema.String,
      accessToken: Schema.optional(Schema.String),
      refreshToken: Schema.optional(Schema.String),
      idToken: Schema.optional(Schema.String),
      accessTokenExpiresAt: Schema.optional(Schema.String),
      refreshTokenExpiresAt: Schema.optional(Schema.String),
      scope: Schema.optional(Schema.String),
    }),
  }),
);
type ProxiedProfile = typeof ProxiedProfile.Type;

/** The half of a stored OAuth state that makes it a link: the Luke user the flow began signed in as. */
const LinkState = Schema.fromJsonString(
  Schema.Struct({ link: Schema.Struct({ userId: Schema.String, email: Schema.String }) }),
);

const decodeProxiedProfile = Schema.decodeUnknownOption(ProxiedProfile);
const decodeLinkState = Schema.decodeUnknownOption(LinkState);

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

/** Better Auth's own refusal shape: the page it returns to, with the reason as `error`. */
function refusalURL(errorURL: string, reason: ProxyLinkRefusal): string {
  const separator = errorURL.includes("?") ? "&" : "?";
  return `${errorURL}${separator}${new URLSearchParams({ error: reason }).toString()}`;
}

function instant(value: string | undefined): Date | undefined {
  return value === undefined ? undefined : new Date(value);
}

/**
 * Store a proxied link on the account the flow began signed in as, on
 * Better Auth's own terms for a link it made on its own callback: the
 * provider must be trusted or the email verified, a provider account
 * already on another user is refused, and the tokens are sealed by the same
 * `setTokenUtil` that seals every row. It answers a refusal, or nothing
 * once the row is written.
 */
async function storeProxiedLink(
  ctx: GenericEndpointContext,
  userId: string,
  linkEmail: string,
  profile: ProxiedProfile,
): Promise<ProxyLinkRefusal | undefined> {
  const { account, userInfo } = profile;
  const options = ctx.context.options.account;
  if (
    (!ctx.context.trustedProviders.includes(account.providerId) && !userInfo.emailVerified) ||
    options?.accountLinking?.enabled === false
  ) {
    return PROXY_LINK_REFUSAL.UNABLE_TO_LINK;
  }
  if (
    userInfo.email.toLowerCase() !== linkEmail.toLowerCase() &&
    options?.accountLinking?.allowDifferentEmails !== true
  ) {
    return PROXY_LINK_REFUSAL.EMAIL_MISMATCH;
  }

  const tokens = {
    accessToken: await setTokenUtil(account.accessToken, ctx.context),
    refreshToken: await setTokenUtil(account.refreshToken, ctx.context),
    idToken: account.idToken,
    accessTokenExpiresAt: instant(account.accessTokenExpiresAt),
    refreshTokenExpiresAt: instant(account.refreshTokenExpiresAt),
    scope: account.scope,
  };
  const existing = await ctx.context.internalAdapter.findAccountByProviderId(
    account.accountId,
    account.providerId,
  );
  if (existing) {
    if (existing.userId !== userId) return PROXY_LINK_REFUSAL.LINKED_ELSEWHERE;
    await ctx.context.internalAdapter.updateAccount(
      existing.id,
      Object.fromEntries(Object.entries(tokens).filter(([, value]) => value !== undefined)),
    );
  } else {
    const created = await ctx.context.internalAdapter.createAccount({
      userId,
      providerId: account.providerId,
      accountId: account.accountId,
      ...tokens,
    });
    if (!created) return PROXY_LINK_REFUSAL.UNABLE_TO_LINK;
  }
  await applyUpdateUserInfoOnLink(ctx, userId, userInfo);
  return undefined;
}

/**
 * Land a proxied link on the Preview's signed-in user rather than signing
 * anyone in.
 *
 * The proxy plugin's profile endpoint knows one outcome: it turns the
 * returned profile into a session, which for a link would sign the browser
 * in as whoever owns the GitHub account instead of attaching GitHub to the
 * Luke account that asked. Production's relay neither knows nor cares which
 * the flow was, since the link half of the state lives in the Preview's own
 * verification row, so the difference is decided here: a profile whose
 * stored state names a link is consumed and linked by this hook, and every
 * other profile passes through to the plugin's endpoint unchanged. The
 * state is looked at before it is consumed so that a sign-in's is left for
 * the endpoint to consume. The proxy plugin skips its browser-bound state
 * cookie, so the browser landing the profile must hold a session for the
 * very user the link began as; any other browser is refused and nothing is
 * written.
 */
function landProxiedLink(proxySecret: string) {
  return {
    matcher(context: { path?: string }) {
      return context.path === PROXY_PROFILE_PATH;
    },
    handler: createAuthMiddleware(async (ctx) => {
      // SAFETY: Better Auth hands over its parsed query as structured-clone data; the wire guards below validate the selected field.
      const query = unparsedWire(ctx.query as WireBoundaryInput);
      if (!isRecord(query) || !isWireString(query.profile)) return;
      let decrypted: string;
      try {
        decrypted = await symmetricDecrypt({ key: proxySecret, data: query.profile });
      } catch {
        return;
      }
      const profile = Option.getOrUndefined(decodeProxiedProfile(decrypted));
      if (profile === undefined) return;
      const pending = await ctx.context.internalAdapter.findVerificationValue(profile.state);
      if (pending === null || Option.isNone(decodeLinkState(pending.value))) return;

      const errorURL = profile.errorURL ?? `${ctx.context.baseURL}/error`;
      const age = Date.now() - profile.timestamp;
      if (age > PROXY_PROFILE_MAX_AGE_MS || age < -PROXY_PROFILE_CLOCK_SKEW_MS) {
        throw ctx.redirect(refusalURL(errorURL, PROXY_LINK_REFUSAL.EXPIRED));
      }
      let link: { userId: string; email: string } | undefined;
      try {
        link = (await parseGenericState(ctx, profile.state, { skipStateCookieCheck: true })).link;
      } catch {
        link = undefined;
      }
      if (link === undefined) {
        throw ctx.redirect(refusalURL(errorURL, PROXY_LINK_REFUSAL.STATE_MISMATCH));
      }
      const session = await getSessionFromCtx(ctx);
      if (session?.user.id !== link.userId) {
        throw ctx.redirect(refusalURL(errorURL, PROXY_LINK_REFUSAL.SESSION_MISMATCH));
      }
      const refusal = await storeProxiedLink(ctx, link.userId, link.email, profile);
      throw ctx.redirect(
        refusal === undefined ? profile.callbackURL : refusalURL(errorURL, refusal),
      );
    }),
  };
}

/**
 * Start a link through production's registered callback, the way the proxy
 * plugin starts a sign-in. The plugin matches only the sign-in paths, so a
 * Preview's `linkSocial` would send the provider its own callback, which no
 * OAuth App has registered; its two sign-in hooks (the one that points the
 * flow at production and returns it to this deployment's profile endpoint,
 * and the one that seals the stored state into what production can read)
 * are the same work for a link, and run on it unchanged. The error page is
 * made absolute on this deployment, because production is where a refusal
 * from the provider is answered, and a path would send the browser to
 * production's page of that name.
 */
function proxiedLinkStart(proxy: ReturnType<typeof oAuthProxy>) {
  const [relayCallback] = proxy.hooks.before;
  const [wrapState] = proxy.hooks.after;
  if (relayCallback === undefined || wrapState === undefined) {
    throw new Error("The OAuth proxy plugin no longer carries its sign-in hooks");
  }
  const matcher = (context: { path?: string }) => context.path === LINK_PATH;
  return {
    relayCallback: { matcher, handler: relayCallback.handler },
    anchorErrorURL: {
      matcher,
      handler: createAuthMiddleware(async (ctx) => {
        // SAFETY: Better Auth hands over its parsed body as structured-clone data; the wire guards below validate the selected fields.
        const body = unparsedWire(ctx.body as WireBoundaryInput);
        if (!isRecord(body) || !isWireString(body.errorCallbackURL)) return;
        // The relay hook right ahead of this one made the callback absolute on this deployment.
        if (!isWireString(body.callbackURL)) return;
        ctx.body.errorCallbackURL = new URL(body.errorCallbackURL, body.callbackURL).toString();
      }),
    },
    wrapState: { matcher, handler: wrapState.handler },
  };
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

  const proxySecret = deployment.proxySecret;
  if (deployment.acceptsProxyProfiles && proxySecret !== undefined) {
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
    const link = proxiedLinkStart(proxy);
    return {
      ...proxy,
      hooks: {
        before: [
          resumeDesktopAuthorization,
          ...proxy.hooks.before,
          link.relayCallback,
          link.anchorErrorURL,
          landProxiedLink(proxySecret),
        ],
        after: [...proxy.hooks.after, link.wrapState],
      },
    };
  }

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
