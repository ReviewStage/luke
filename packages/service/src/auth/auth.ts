import { electron } from "@better-auth/electron";
import { oauthProvider } from "@better-auth/oauth-provider";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { bearer, jwt, lastLoginMethod, oAuthProxy, organization } from "better-auth/plugins";
import { Redacted } from "effect";
import { authDatabase, authDatabaseAdapter } from "./auth-database.js";
import {
  type AuthSecrets,
  authDeployment,
  authSecrets,
  type SocialClient,
} from "./auth-deployment.js";
import {
  ACCOUNT_TOKEN_STORAGE,
  DESKTOP_SESSION,
  DISABLED_AUTH_PATHS,
  denyOAuthClientPrivileges,
  GITHUB_SIGN_IN,
  JWT_KEY_STORAGE,
  ORGANIZATION_OPTIONS,
  SESSION_BEARER,
  USER_FIELDS,
} from "./auth-policy.js";
import { DESKTOP_OAUTH_CLIENT } from "./oauth-clients.js";

const DESKTOP_OAUTH_CLIENT_ID = DESKTOP_OAUTH_CLIENT.id;

const deployment = authDeployment(process.env);
const secrets = authSecrets(process.env);
// Note that a missing session secret is reported once, as the module loads,
// and refused on every request below, because Better Auth left to itself
// would sign sessions under its built-in default secret outside production.
if (secrets.sessionSecret === undefined) {
  console.error("BETTER_AUTH_SECRET is not set; the auth service will refuse every request.");
}

/**
 * Runs ahead of every endpoint, whether reached through the HTTP handler or
 * `auth.api`, and refuses them all while the deployment holds no session
 * secret: nothing is signed, verified, or handed out under a secret that is
 * not this deployment's own. The module still loads, as every function
 * bundle must with nothing configured.
 */
const refuseWithoutSessionSecret = createAuthMiddleware(async () => {
  if (secrets.sessionSecret !== undefined) return;
  throw new APIError("SERVICE_UNAVAILABLE", {
    message: "The auth service is not configured on this deployment.",
  });
});

/** The one place a social secret is revealed: handed to Better Auth, which puts it on the provider's token request. */
function socialProvider(client: SocialClient) {
  return {
    clientId: client.clientId,
    clientSecret: client.clientSecret === undefined ? "" : Redacted.value(client.clientSecret),
  };
}

/**
 * The ways in, Google and GitHub, as the deployment's secrets register them.
 * A function of the secrets rather than inline, so a test can stand the same
 * providers up over a database of its own.
 */
export function socialProviders(registered: Pick<AuthSecrets, "google" | "github">) {
  return {
    google: { ...socialProvider(registered.google), scope: ["email", "profile"] },
    // The Luke GitHub App's client: signing in is the user's authorization
    // of the App, and the token it leaves on the account row is the App's
    // expiring user token, refreshed by `github/github-app.ts`.
    github: { ...socialProvider(registered.github), ...GITHUB_SIGN_IN },
  };
}

export const auth = betterAuth({
  appName: "Luke",
  baseURL: deployment.baseURL,
  trustedOrigins: deployment.trustedOrigins,
  secret: secrets.sessionSecret === undefined ? undefined : Redacted.value(secrets.sessionSecret),
  hooks: { before: refuseWithoutSessionSecret },
  database: authDatabaseAdapter(authDatabase),
  account: ACCOUNT_TOKEN_STORAGE,
  user: USER_FIELDS,
  disabledPaths: [...DISABLED_AUTH_PATHS],
  socialProviders: socialProviders(secrets),
  plugins: [
    // Better Auth's OAuth proxy as its docs configure it: a Preview signs in
    // through production's registered callback, and the provider plugin resumes
    // the desktop's authorization on the session the proxy lands.
    oAuthProxy({ productionURL: deployment.productionURL, secret: deployment.proxySecret }),
    jwt(JWT_KEY_STORAGE),
    lastLoginMethod({ storeInDatabase: true }),
    oauthProvider({
      loginPage: "/sign-in.html",
      consentPage: "/consent.html",
      allowDynamicClientRegistration: false,
      clientPrivileges: denyOAuthClientPrivileges,
      cachedTrustedClients: new Set([DESKTOP_OAUTH_CLIENT_ID]),
      accessTokenExpiresIn: 60 * 60,
    }),
    // A workspace is an organization: its members plan together.
    organization(ORGANIZATION_OPTIONS),
    // The Mac's own session beside its OAuth token, so the organization
    // endpoints that take a session answer it: minted from the signed-in
    // browser by the Electron plugin, carried as a signed bearer token.
    electron(DESKTOP_SESSION),
    bearer(SESSION_BEARER),
  ],
});
