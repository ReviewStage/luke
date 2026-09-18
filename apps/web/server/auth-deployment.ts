/**
 * Where this deployment answers, which on Vercel is not one fixed address.
 *
 * A Preview deployment is served from hostnames minted for the branch, so an
 * auth service that still called itself the production URL there refuses the
 * first thing the browser asks of it: Better Auth trusts the origin of its own
 * base URL, and a page on a preview sends the preview's, which is how a
 * sign-in press on a preview becomes "Sign-in could not start". Naming the
 * preview as its own base URL is what makes the deployment honest about where
 * it is.
 *
 * That leaves the round trip through Google and GitHub, which answer only the
 * one redirect URI each has registered, and no provider can register a
 * hostname that does not exist until a branch is pushed. Better Auth's OAuth
 * proxy is the documented way through: the preview sends the provider the
 * production callback, production exchanges the code and hands the profile
 * back to the preview encrypted, and the preview creates its own session in
 * its own branch database. Both ends must be running this plugin under the
 * same encryption secret, which is why production carries it too even though
 * the proxy is inert there.
 */

import { Redacted } from "effect";
import { text } from "./core.js";

/** The Vercel environment a deployment runs as, as its own `VERCEL_ENV` names it. */
const DEPLOYMENT_ENVIRONMENT = {
  PRODUCTION: "production",
  PREVIEW: "preview",
  DEVELOPMENT: "development",
} as const;

/** The variables the deployment's shape is read from; a blank value is absent. */
const AUTH_DEPLOYMENT_ENVIRONMENT = {
  ENVIRONMENT: "VERCEL_ENV",
  DEPLOYMENT_HOST: "VERCEL_URL",
  BRANCH_HOST: "VERCEL_BRANCH_URL",
  PRODUCTION_URL: "BETTER_AUTH_URL",
  PROXY_SECRET: "BETTER_AUTH_PROXY_SECRET",
  PROXY_TRUSTED_ORIGINS: "BETTER_AUTH_PROXY_TRUSTED_ORIGINS",
} as const;

/** The variables the auth service's own secrets are read from; a blank value is absent. */
const AUTH_SECRET_ENVIRONMENT = {
  SESSION_SECRET: "BETTER_AUTH_SECRET",
  GOOGLE_CLIENT_ID: "GOOGLE_CLIENT_ID",
  GOOGLE_CLIENT_SECRET: "GOOGLE_CLIENT_SECRET",
  GITHUB_CLIENT_ID: "GITHUB_CLIENT_ID",
  GITHUB_CLIENT_SECRET: "GITHUB_CLIENT_SECRET",
} as const;

/** Where the site answers when nothing names a deployment: the Vite dev server. */
export const LOCAL_AUTH_URL = "http://localhost:5173";

export interface AuthDeployment {
  /** The address this deployment calls itself, and the origin it trusts by default. */
  baseURL: string;
  /** The deployment's remaining hostnames, which the base URL cannot also be. */
  trustedOrigins: string[];
  /**
   * The address whose callback the OAuth clients have registered. Every
   * deployment carries it, because production is the end that decrypts a
   * preview's state and exchanges its code; the proxy stays inert wherever
   * this is the address the request already arrived on.
   */
  productionURL: string | undefined;
  /**
   * An encryption secret for the proxy alone, so previews never hold the
   * secret that signs production's sessions. Without it, every proxy role is
   * disabled rather than falling back to `BETTER_AUTH_SECRET`.
   */
  proxySecret: string | undefined;
  /** Origins production may return an encrypted provider profile to. */
  proxyTrustedOrigins: string[];
  /**
   * Whether this deployment may turn a proxied profile into a local session.
   * Only a positively identified Preview gets that endpoint; production is
   * the OAuth relay and must never accept the shared proxy key as session
   * authority for its own database.
   */
  acceptsProxyProfiles: boolean;
}

/** One social provider's registration; a provider with no registration is configured with nothing, and Better Auth refuses its sign-in. */
export interface SocialClient {
  clientId: string;
  clientSecret: Redacted.Redacted | undefined;
}

export interface AuthSecrets {
  /** The secret that signs this deployment's sessions; absent, Better Auth refuses to sign any, and `auth.ts` says so as it loads. */
  sessionSecret: Redacted.Redacted | undefined;
  google: SocialClient;
  github: SocialClient;
}

/** A secret as the environment holds it, sealed; a blank one is absent. */
function secret(value: string | undefined): Redacted.Redacted | undefined {
  const named = text(value);
  return named === undefined ? undefined : Redacted.make(named);
}

/** Vercel reports a bare hostname; a value that already names a scheme keeps it. */
function deploymentOrigin(host: string | undefined): string | undefined {
  const named = text(host);
  if (named === undefined) return undefined;
  try {
    return new URL(named.includes("://") ? named : `https://${named}`).origin;
  } catch {
    return undefined;
  }
}

/**
 * The auth service's own secrets, sealed. Read from the record rather than
 * through `Config`, because `betterAuth` is built at module scope with no
 * runtime to run a `Config` on; the record is the same `process.env` a
 * `Config` would read. A missing or blank session secret is absent rather
 * than the empty string, and nothing throws here: every function bundle
 * loads the auth service, and a bundle must load with nothing configured.
 */
export function authSecrets(variables: Record<string, string | undefined>): AuthSecrets {
  return {
    sessionSecret: secret(variables[AUTH_SECRET_ENVIRONMENT.SESSION_SECRET]),
    google: {
      clientId: text(variables[AUTH_SECRET_ENVIRONMENT.GOOGLE_CLIENT_ID]) ?? "",
      clientSecret: secret(variables[AUTH_SECRET_ENVIRONMENT.GOOGLE_CLIENT_SECRET]),
    },
    github: {
      clientId: text(variables[AUTH_SECRET_ENVIRONMENT.GITHUB_CLIENT_ID]) ?? "",
      clientSecret: secret(variables[AUTH_SECRET_ENVIRONMENT.GITHUB_CLIENT_SECRET]),
    },
  };
}

/**
 * What Better Auth is handed for one social provider. A Preview holds no
 * client secret, because production is the end that exchanges the code; but
 * Google's provider refuses to build an authorization URL at all without one,
 * which is a 500 on the preview's sign-in start before the browser ever leaves
 * for Google. So a deployment that relays through production stands a
 * placeholder where the secret would go, and only there: the placeholder is
 * never sent, since the proxy hands the code to production, and it would
 * satisfy no token endpoint if it were. A deployment that exchanges its own
 * codes keeps the empty string and Better Auth's own refusal.
 */
export const RELAYED_CLIENT_SECRET_PLACEHOLDER = "relayed-through-production";

export function socialProviderOptions(
  client: SocialClient,
  scope: readonly string[],
  deployment: Pick<AuthDeployment, "acceptsProxyProfiles">,
) {
  const clientSecret =
    client.clientSecret !== undefined
      ? Redacted.value(client.clientSecret)
      : deployment.acceptsProxyProfiles
        ? RELAYED_CLIENT_SECRET_PLACEHOLDER
        : "";
  return { clientId: client.clientId, clientSecret, scope: [...scope] };
}

export function authDeployment(variables: Record<string, string | undefined>): AuthDeployment {
  const productionURL = text(variables[AUTH_DEPLOYMENT_ENVIRONMENT.PRODUCTION_URL]);
  const proxySecret = text(variables[AUTH_DEPLOYMENT_ENVIRONMENT.PROXY_SECRET]);
  const proxyTrustedOrigins =
    text(variables[AUTH_DEPLOYMENT_ENVIRONMENT.PROXY_TRUSTED_ORIGINS])
      ?.split(",")
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0) ?? [];
  const previewOrigins =
    variables[AUTH_DEPLOYMENT_ENVIRONMENT.ENVIRONMENT] === DEPLOYMENT_ENVIRONMENT.PREVIEW
      ? [
          ...new Set(
            [
              deploymentOrigin(variables[AUTH_DEPLOYMENT_ENVIRONMENT.DEPLOYMENT_HOST]),
              deploymentOrigin(variables[AUTH_DEPLOYMENT_ENVIRONMENT.BRANCH_HOST]),
            ].filter((origin): origin is string => origin !== undefined),
          ),
        ]
      : [];
  const [previewBaseURL, ...previewAliases] = previewOrigins;

  return {
    baseURL: previewBaseURL ?? productionURL ?? LOCAL_AUTH_URL,
    trustedOrigins: previewAliases,
    productionURL,
    proxySecret,
    proxyTrustedOrigins,
    acceptsProxyProfiles:
      previewBaseURL !== undefined &&
      productionURL !== undefined &&
      proxySecret !== undefined &&
      previewBaseURL !== productionURL,
  };
}
