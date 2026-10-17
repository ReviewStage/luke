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
 * the proxy is inert there. And production trusts every preview's origin and
 * the dev server's, as the plugin's docs prescribe: "Since preview and
 * development servers redirect through production, you need to add them as
 * `trustedOrigins`". That widens production's origin checks to any host the
 * preview pattern matches, which is the security model the docs set out.
 */

import { Redacted } from "effect";
import { text } from "../core.js";

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
} as const;

/**
 * The variables the Luke GitHub App is read from. Dean registered the App
 * under the ReviewStage org, and Vercel holds these five for every
 * environment. "Sign in with GitHub" is the App's own user authorization,
 * so its client id and secret are the sign-in's social client below, and
 * the App id, slug, and private key are what `github/github-app.ts` speaks
 * to GitHub as the App itself with.
 */
export const GITHUB_APP_ENVIRONMENT = {
  APP_ID: "GITHUB_APP_ID",
  SLUG: "GITHUB_APP_SLUG",
  CLIENT_ID: "GITHUB_APP_CLIENT_ID",
  CLIENT_SECRET: "GITHUB_APP_CLIENT_SECRET",
  /** The App's private key, PEM; a value whose newlines arrived as `\\n` is read all the same. */
  PRIVATE_KEY: "GITHUB_APP_PRIVATE_KEY",
  /** The secret GitHub signs the App's webhook deliveries with; absent refuses every delivery. */
  WEBHOOK_SECRET: "GITHUB_APP_WEBHOOK_SECRET",
} as const;

/** The variables the auth service's own secrets are read from; a blank value is absent. */
export const AUTH_SECRET_ENVIRONMENT = {
  SESSION_SECRET: "BETTER_AUTH_SECRET",
  GOOGLE_CLIENT_ID: "GOOGLE_CLIENT_ID",
  GOOGLE_CLIENT_SECRET: "GOOGLE_CLIENT_SECRET",
  GITHUB_CLIENT_ID: GITHUB_APP_ENVIRONMENT.CLIENT_ID,
  GITHUB_CLIENT_SECRET: GITHUB_APP_ENVIRONMENT.CLIENT_SECRET,
} as const;

/** Where the site answers when nothing names a deployment: the Vite dev server. */
const LOCAL_AUTH_URL = "http://localhost:5173";

/** The schemes a web page is served under; any other address's origin, the opaque `null` among them, is no page's. */
const WEB_ORIGIN_SCHEMES = ["https://", "http://"] as const;

/**
 * The origins production trusts beyond its own: every Vercel preview of this
 * project, by deployment (`luke-<hash>-stage-review.vercel.app`) or by branch
 * (`luke-web-git-<branch>-stage-review.vercel.app`), and the dev server.
 */
const PROXIED_ORIGINS = ["https://luke-*-stage-review.vercel.app", LOCAL_AUTH_URL] as const;

export interface AuthDeployment {
  /** The address this deployment calls itself, and the origin it trusts by default. */
  baseURL: string;
  /**
   * The origins this deployment's own pages are served from: production's
   * registered address, a preview's two hostnames, or the dev server's where
   * no Vercel environment is named. Unlike `trustedOrigins`, never another
   * deployment's, so this is what a check that a request came from one of
   * this deployment's own pages reads; a production or a preview that names
   * no address of its own has none.
   */
  ownOrigins: string[];
  /**
   * The origins trusted beyond the base URL: on a preview, its remaining
   * hostnames; on production, every preview's and the dev server's, which
   * sign in through it.
   */
  trustedOrigins: string[];
  /**
   * The address whose callback the OAuth clients have registered. Every
   * deployment carries it, because production is the end that decrypts a
   * preview's state and exchanges its code; the proxy stays inert wherever
   * this is the address the request already arrived on.
   */
  productionURL: string | undefined;
  /**
   * The OAuth proxy's shared secret, so previews never hold the secret that
   * signs production's sessions. Without it Better Auth derives the proxy's
   * keys from `BETTER_AUTH_SECRET`, which differs per deployment, so a
   * proxied sign-in cannot complete.
   */
  proxySecret: string | undefined;
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
  /** The Luke GitHub App's client, since a GitHub sign-in is that App's user authorization. */
  github: SocialClient;
}

/** A secret as the environment holds it, sealed; a blank one is absent. */
function secret(value: string | undefined): Redacted.Redacted | undefined {
  const named = text(value);
  return named === undefined ? undefined : Redacted.make(named);
}

/** One provider's registration as two variables hold it; a blank id is the empty one Better Auth refuses. */
function socialClient(
  variables: Record<string, string | undefined>,
  idName: string,
  secretName: string,
): SocialClient {
  return {
    clientId: text(variables[idName]) ?? "",
    clientSecret: secret(variables[secretName]),
  };
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

/** Whether an origin is a web page's: one under `https:` or `http:`, never the opaque `null`. */
function webOrigin(origin: string | undefined): origin is string {
  return origin !== undefined && WEB_ORIGIN_SCHEMES.some((scheme) => origin.startsWith(scheme));
}

/**
 * The origins a deployment's own pages are served from. Note that the dev
 * server stands in only where no Vercel environment is named, because a
 * production or a preview that names no address of its own is misconfigured,
 * and it then owns no origin rather than a page on whatever machine answers
 * at `localhost`.
 */
function ownOriginsOf(
  environment: string | undefined,
  previewOrigins: readonly string[],
  productionURL: string | undefined,
): string[] {
  if (environment === DEPLOYMENT_ENVIRONMENT.PREVIEW) return previewOrigins.filter(webOrigin);
  const address =
    environment === DEPLOYMENT_ENVIRONMENT.PRODUCTION
      ? productionURL
      : (productionURL ?? LOCAL_AUTH_URL);
  return [deploymentOrigin(address)].filter(webOrigin);
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
    google: socialClient(
      variables,
      AUTH_SECRET_ENVIRONMENT.GOOGLE_CLIENT_ID,
      AUTH_SECRET_ENVIRONMENT.GOOGLE_CLIENT_SECRET,
    ),
    github: socialClient(
      variables,
      AUTH_SECRET_ENVIRONMENT.GITHUB_CLIENT_ID,
      AUTH_SECRET_ENVIRONMENT.GITHUB_CLIENT_SECRET,
    ),
  };
}

/** Whether a social client is whole: an id and a secret, which is what a sign-in through it needs. */
export function socialClientConfigured(client: SocialClient): boolean {
  return client.clientId !== "" && client.clientSecret !== undefined;
}

export function authDeployment(variables: Record<string, string | undefined>): AuthDeployment {
  const productionURL = text(variables[AUTH_DEPLOYMENT_ENVIRONMENT.PRODUCTION_URL]);
  const proxySecret = text(variables[AUTH_DEPLOYMENT_ENVIRONMENT.PROXY_SECRET]);
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
    ownOrigins: ownOriginsOf(
      variables[AUTH_DEPLOYMENT_ENVIRONMENT.ENVIRONMENT],
      previewOrigins,
      productionURL,
    ),
    trustedOrigins:
      variables[AUTH_DEPLOYMENT_ENVIRONMENT.ENVIRONMENT] === DEPLOYMENT_ENVIRONMENT.PRODUCTION
        ? [...PROXIED_ORIGINS]
        : previewAliases,
    productionURL,
    proxySecret,
  };
}
