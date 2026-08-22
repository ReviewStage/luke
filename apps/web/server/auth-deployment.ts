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

/** The Vercel environment a deployment runs as, as its own `VERCEL_ENV` names it. */
export const DEPLOYMENT_ENVIRONMENT = {
  PRODUCTION: "production",
  PREVIEW: "preview",
  DEVELOPMENT: "development",
} as const;

/** The variables the deployment's shape is read from; a blank value is absent. */
export const AUTH_DEPLOYMENT_ENVIRONMENT = {
  ENVIRONMENT: "VERCEL_ENV",
  DEPLOYMENT_HOST: "VERCEL_URL",
  BRANCH_HOST: "VERCEL_BRANCH_URL",
  PRODUCTION_URL: "BETTER_AUTH_URL",
  PROXY_SECRET: "BETTER_AUTH_PROXY_SECRET",
  PROXY_TRUSTED_ORIGINS: "BETTER_AUTH_PROXY_TRUSTED_ORIGINS",
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

function present(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
}

/** Vercel reports a bare hostname; a value that already names a scheme keeps it. */
function deploymentOrigin(host: string | undefined): string | undefined {
  const named = present(host);
  if (named === undefined) return undefined;
  try {
    return new URL(named.includes("://") ? named : `https://${named}`).origin;
  } catch {
    return undefined;
  }
}

export function authDeployment(variables: Record<string, string | undefined>): AuthDeployment {
  const productionURL = present(variables[AUTH_DEPLOYMENT_ENVIRONMENT.PRODUCTION_URL]);
  const proxySecret = present(variables[AUTH_DEPLOYMENT_ENVIRONMENT.PROXY_SECRET]);
  const proxyTrustedOrigins =
    present(variables[AUTH_DEPLOYMENT_ENVIRONMENT.PROXY_TRUSTED_ORIGINS])
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
