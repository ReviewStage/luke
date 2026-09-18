import { oauthProvider } from "@better-auth/oauth-provider";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { jwt, lastLoginMethod } from "better-auth/plugins";
import { Redacted } from "effect";
import { USER_ROLE } from "./admin/admin-access.js";
import { authDatabase, authDatabaseAdapter } from "./auth-database.js";
import { authDeployment, authSecrets, socialProviderOptions } from "./auth-deployment.js";
import {
  ACCOUNT_TOKEN_STORAGE,
  denyOAuthClientPrivileges,
  JWT_KEY_STORAGE,
} from "./auth-policy.js";
import { authProxy } from "./auth-proxy.js";
import { DESKTOP_OAUTH_CLIENT, MOBILE_OAUTH_CLIENT } from "./oauth-clients.js";

const DESKTOP_OAUTH_CLIENT_ID = DESKTOP_OAUTH_CLIENT.id;
const MOBILE_OAUTH_CLIENT_ID = MOBILE_OAUTH_CLIENT.id;

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

export const auth = betterAuth({
  appName: "Luke",
  baseURL: deployment.baseURL,
  trustedOrigins: deployment.trustedOrigins,
  secret: secrets.sessionSecret === undefined ? undefined : Redacted.value(secrets.sessionSecret),
  hooks: { before: refuseWithoutSessionSecret },
  database: authDatabaseAdapter(authDatabase),
  account: ACCOUNT_TOKEN_STORAGE,
  // Admin access is a plain-text `role` on the user, managed by Better Auth:
  // the migrations declared it on the `user` table, and returned on
  // the session so the dashboard reads it without a query of its own. `input:
  // false` keeps a sign-up from asserting its own role — the role is set only by
  // a maintainer's own write to the database, never by anything Luke runs.
  user: {
    additionalFields: {
      role: { type: "string", required: false, defaultValue: USER_ROLE.USER, input: false },
    },
  },
  disabledPaths: ["/token"],
  socialProviders: {
    // The one place a social secret is revealed: handed to Better Auth, which puts it on the provider's token request.
    google: socialProviderOptions(secrets.google, ["email", "profile"], deployment),
    github: socialProviderOptions(secrets.github, ["read:user", "user:email"], deployment),
  },
  plugins: [
    // Ahead of the social sign-in it rewrites, and of the provider plugin whose
    // desktop authorization resumes on the session it lands.
    authProxy(deployment),
    jwt(JWT_KEY_STORAGE),
    lastLoginMethod({ storeInDatabase: true }),
    oauthProvider({
      loginPage: "/sign-in.html",
      consentPage: "/consent.html",
      allowDynamicClientRegistration: false,
      clientPrivileges: denyOAuthClientPrivileges,
      cachedTrustedClients: new Set([DESKTOP_OAUTH_CLIENT_ID, MOBILE_OAUTH_CLIENT_ID]),
      accessTokenExpiresIn: 60 * 60,
    }),
  ],
});
