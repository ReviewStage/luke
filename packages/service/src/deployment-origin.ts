const DEPLOYMENT_ORIGIN_VARIABLE = "APP_DEPLOYMENT_ORIGIN";

const VERCEL_ENVIRONMENT = {
  ENVIRONMENT: "VERCEL_ENV",
  URL: "VERCEL_URL",
  PRODUCTION_URL: "VERCEL_PROJECT_PRODUCTION_URL",
} as const;

const DEPLOYMENT_ENVIRONMENT = { PRODUCTION: "production" } as const;

export function deploymentOrigin(): string | undefined {
  const named = process.env[DEPLOYMENT_ORIGIN_VARIABLE]?.trim();
  if (named) return named;
  const production =
    process.env[VERCEL_ENVIRONMENT.ENVIRONMENT]?.trim() === DEPLOYMENT_ENVIRONMENT.PRODUCTION
      ? process.env[VERCEL_ENVIRONMENT.PRODUCTION_URL]?.trim()
      : undefined;
  const own = production || process.env[VERCEL_ENVIRONMENT.URL]?.trim();
  return own ? `https://${own}` : undefined;
}
