import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { oauthProvider } from "@better-auth/oauth-provider";
import { betterAuth } from "better-auth";
import { jwt, lastLoginMethod, oAuthProxy } from "better-auth/plugins";
import { USER_ROLE } from "./admin/admin-access.js";
import { authDeployment } from "./auth-deployment.js";
import {
  ACCOUNT_TOKEN_STORAGE,
  denyOAuthClientPrivileges,
  JWT_KEY_STORAGE,
} from "./auth-policy.js";
import { getDatabase } from "./db/index.js";
import * as schema from "./db/schema.js";
import { DESKTOP_OAUTH_CLIENT } from "./desktop-oauth-client.js";

export const DESKTOP_OAUTH_CLIENT_ID = DESKTOP_OAUTH_CLIENT.id;

const deployment = authDeployment(process.env);

export const auth = betterAuth({
  appName: "Luke",
  baseURL: deployment.baseURL,
  trustedOrigins: deployment.trustedOrigins,
  secret: process.env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(getDatabase(), { provider: "pg", schema }),
  account: ACCOUNT_TOKEN_STORAGE,
  // Admin access is a plain-text `role` on the user, managed by Better Auth:
  // declared here, generated into the schema by `auth:generate`, and returned on
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
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      scope: ["email", "profile"],
    },
    github: {
      clientId: process.env.GITHUB_CLIENT_ID ?? "",
      clientSecret: process.env.GITHUB_CLIENT_SECRET ?? "",
      scope: ["read:user", "user:email"],
    },
  },
  plugins: [
    // Ahead of the social sign-in it rewrites, and of the provider plugin whose
    // desktop authorization resumes on the session it lands.
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
  ],
});
