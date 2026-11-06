import { LINK_HOST_ALIASES } from "@repo/features/link-home";
import { Redacted } from "effect";
import { text } from "../core.js";

export const DEPLOYMENT_ENVIRONMENT = {
  PRODUCTION: "production",
  PREVIEW: "preview",
  DEVELOPMENT: "development",
} as const;

export const AUTH_DEPLOYMENT_ENVIRONMENT = {
  ENVIRONMENT: "VERCEL_ENV",
  DEPLOYMENT_HOST: "VERCEL_URL",
  BRANCH_HOST: "VERCEL_BRANCH_URL",
  PRODUCTION_URL: "BETTER_AUTH_URL",
  PROXY_SECRET: "BETTER_AUTH_PROXY_SECRET",
} as const;

export const GITHUB_APP_ENVIRONMENT = {
  APP_ID: "GITHUB_APP_ID",
  SLUG: "GITHUB_APP_SLUG",
  CLIENT_ID: "GITHUB_APP_CLIENT_ID",
  CLIENT_SECRET: "GITHUB_APP_CLIENT_SECRET",
  PRIVATE_KEY: "GITHUB_APP_PRIVATE_KEY",
  WEBHOOK_SECRET: "GITHUB_APP_WEBHOOK_SECRET",
} as const;

export const AUTH_SECRET_ENVIRONMENT = {
  SESSION_SECRET: "BETTER_AUTH_SECRET",
  GOOGLE_CLIENT_ID: "GOOGLE_CLIENT_ID",
  GOOGLE_CLIENT_SECRET: "GOOGLE_CLIENT_SECRET",
  GITHUB_CLIENT_ID: GITHUB_APP_ENVIRONMENT.CLIENT_ID,
  GITHUB_CLIENT_SECRET: GITHUB_APP_ENVIRONMENT.CLIENT_SECRET,
} as const;

const LOCAL_AUTH_URL = "http://localhost:5173";

const WEB_ORIGIN_SCHEMES = ["https://", "http://"] as const;

const PROXIED_ORIGINS = ["https://vespin-*-stage-review.vercel.app", LOCAL_AUTH_URL] as const;

export interface AuthDeployment {
  baseURL: string;
  ownOrigins: string[];
  trustedOrigins: string[];
  productionURL: string | undefined;
  proxySecret: string | undefined;
}

export interface SocialClient {
  clientId: string;
  clientSecret: Redacted.Redacted | undefined;
}

export interface AuthSecrets {
  sessionSecret: Redacted.Redacted | undefined;
  google: SocialClient;
  github: SocialClient;
}

function secret(value: string | undefined): Redacted.Redacted | undefined {
  const named = text(value);
  return named === undefined ? undefined : Redacted.make(named);
}

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

function deploymentOrigin(host: string | undefined): string | undefined {
  const named = text(host);
  if (named === undefined) return undefined;
  try {
    return new URL(named.includes("://") ? named : `https://${named}`).origin;
  } catch {
    return undefined;
  }
}

function webOrigin(origin: string | undefined): origin is string {
  return origin !== undefined && WEB_ORIGIN_SCHEMES.some((scheme) => origin.startsWith(scheme));
}

function ownOriginsOf(
  environment: string | undefined,
  previewOrigins: readonly string[],
  productionURL: string | undefined,
): string[] {
  if (environment === DEPLOYMENT_ENVIRONMENT.PREVIEW) return previewOrigins.filter(webOrigin);
  if (environment !== DEPLOYMENT_ENVIRONMENT.PRODUCTION) {
    return [deploymentOrigin(productionURL ?? LOCAL_AUTH_URL)].filter(webOrigin);
  }
  const own = deploymentOrigin(productionURL);
  if (!webOrigin(own)) return [];
  const aliases = LINK_HOST_ALIASES.map((host) => deploymentOrigin(host)).filter(webOrigin);
  return [...new Set([own, ...aliases])];
}

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
