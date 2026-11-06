import { cimd } from "@better-auth/cimd";
import { fetchClientMetadataResource } from "@better-auth/cimd/node";
import { electron } from "@better-auth/electron";
import { oauthProvider } from "@better-auth/oauth-provider";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { admin, bearer, jwt, lastLoginMethod, oAuthProxy, organization } from "better-auth/plugins";
import { Redacted } from "effect";
import { authDatabaseHooks, authOrganizationHooks } from "./auth-counts.js";
import { authDatabase, authDatabaseAdapter } from "./auth-database.js";
import {
  type AuthSecrets,
  authDeployment,
  authSecrets,
  type SocialClient,
} from "./auth-deployment.js";
import {
  ACCOUNT_TOKEN_STORAGE,
  ADMIN_OPTIONS,
  AUTH_BASE_PATH,
  AUTH_RATE_LIMIT,
  CLIENT_ADDRESS_HEADERS,
  DESKTOP_SESSION,
  DISABLED_AUTH_PATHS,
  denyOAuthClientPrivileges,
  denyOAuthResourcePrivileges,
  GITHUB_SIGN_IN,
  JWT_KEY_STORAGE,
  LOGIN_PAGE,
  memberMcpClientDiscovery,
  OAUTH_PROVIDER_SCOPES,
  ORGANIZATION_OPTIONS,
  oauthClientRegistration,
  SESSION_BEARER,
  SESSION_COOKIE_CACHE,
} from "./auth-policy.js";
import { CLI_OAUTH_CLIENT, DESKTOP_OAUTH_CLIENT } from "./oauth-clients.js";
import { supportAccess } from "./support-access.js";

const deployment = authDeployment(process.env);
const secrets = authSecrets(process.env);
if (secrets.sessionSecret === undefined) {
  console.error("BETTER_AUTH_SECRET is not set; the auth service will refuse every request.");
}

const refuseWithoutSessionSecret = createAuthMiddleware(async () => {
  if (secrets.sessionSecret !== undefined) return;
  throw new APIError("SERVICE_UNAVAILABLE", {
    message: "The auth service is not configured on this deployment.",
  });
});

function socialProvider(client: SocialClient) {
  return {
    clientId: client.clientId,
    clientSecret: client.clientSecret === undefined ? "" : Redacted.value(client.clientSecret),
  };
}

export function socialProviders(registered: Pick<AuthSecrets, "google" | "github">) {
  return {
    google: { ...socialProvider(registered.google), scope: ["email", "profile"] },
    github: { ...socialProvider(registered.github), ...GITHUB_SIGN_IN },
  };
}

export const auth = betterAuth({
  appName: PRODUCT_NAME,
  baseURL: deployment.baseURL,
  basePath: AUTH_BASE_PATH,
  trustedOrigins: deployment.trustedOrigins,
  secret: secrets.sessionSecret === undefined ? undefined : Redacted.value(secrets.sessionSecret),
  hooks: { before: refuseWithoutSessionSecret },
  database: authDatabaseAdapter(authDatabase),
  databaseHooks: authDatabaseHooks,
  account: ACCOUNT_TOKEN_STORAGE,
  session: SESSION_COOKIE_CACHE,
  rateLimit: AUTH_RATE_LIMIT,
  advanced: { ipAddress: { ipAddressHeaders: [...CLIENT_ADDRESS_HEADERS] } },
  disabledPaths: [...DISABLED_AUTH_PATHS],
  socialProviders: socialProviders(secrets),
  plugins: [
    oAuthProxy({ productionURL: deployment.productionURL, secret: deployment.proxySecret }),
    jwt(JWT_KEY_STORAGE),
    lastLoginMethod({ storeInDatabase: true }),
    oauthProvider({
      loginPage: LOGIN_PAGE,
      consentPage: "/consent",
      ...oauthClientRegistration(),
      clientPrivileges: denyOAuthClientPrivileges,
      cachedTrustedClients: new Set([DESKTOP_OAUTH_CLIENT.id, CLI_OAUTH_CLIENT.id]),
      accessTokenExpiresIn: 60 * 60,
      scopes: [...OAUTH_PROVIDER_SCOPES],
      resourcePrivileges: denyOAuthResourcePrivileges,
    }),
    cimd(memberMcpClientDiscovery(fetchClientMetadataResource)),
    organization({ ...ORGANIZATION_OPTIONS, organizationHooks: authOrganizationHooks }),
    electron(DESKTOP_SESSION),
    bearer(SESSION_BEARER),
    admin(ADMIN_OPTIONS),
    supportAccess(),
  ],
});
