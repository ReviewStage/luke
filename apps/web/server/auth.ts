import { oauthProvider } from "@better-auth/oauth-provider";
import { betterAuth } from "better-auth";
import { jwt, lastLoginMethod } from "better-auth/plugins";
import { CamelCasePlugin, Kysely, PostgresDialect } from "kysely";
import { USER_ROLE } from "./admin/admin-access.js";
import { authDeployment } from "./auth-deployment.js";
import {
  ACCOUNT_TOKEN_STORAGE,
  denyOAuthClientPrivileges,
  JWT_KEY_STORAGE,
} from "./auth-policy.js";
import { authProxy } from "./auth-proxy.js";
import { getPool } from "./db/index.js";
import { DESKTOP_OAUTH_CLIENT, MOBILE_OAUTH_CLIENT } from "./oauth-clients.js";

const DESKTOP_OAUTH_CLIENT_ID = DESKTOP_OAUTH_CLIENT.id;
const MOBILE_OAUTH_CLIENT_ID = MOBILE_OAUTH_CLIENT.id;

const deployment = authDeployment(process.env);

/**
 * The Kysely instance Better Auth's own db-adapter path builds a `kyselyAdapter`
 * over: `CamelCasePlugin` is what maps the camelCase fields Better Auth reads
 * and writes (`emailVerified`, `createdAt`, ...) onto the snake_case columns
 * the migrations declared, the same mapping `drizzleAdapter`'s schema object
 * gave it before. Table names need no plugin, because Better Auth's own
 * defaults (`user`, `session`, `oauthClient`, ...) are already what
 * `CamelCasePlugin` turns them into (`oauth_client`, ...).
 */
const authDatabase = new Kysely<unknown>({
  dialect: new PostgresDialect({ pool: getPool() }),
  plugins: [new CamelCasePlugin()],
});

export const auth = betterAuth({
  appName: "Luke",
  baseURL: deployment.baseURL,
  trustedOrigins: deployment.trustedOrigins,
  secret: process.env.BETTER_AUTH_SECRET,
  database: { db: authDatabase, type: "postgres" },
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
