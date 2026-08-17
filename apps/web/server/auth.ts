import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { oauthProvider } from "@better-auth/oauth-provider";
import { betterAuth } from "better-auth";
import { jwt, lastLoginMethod } from "better-auth/plugins";
import {
  ACCOUNT_TOKEN_STORAGE,
  denyOAuthClientPrivileges,
  JWT_KEY_STORAGE,
} from "./auth-policy.js";
import { getDatabase } from "./db/index.js";
import * as schema from "./db/schema.js";
import { DESKTOP_OAUTH_CLIENT } from "./desktop-oauth-client.js";

export const DESKTOP_OAUTH_CLIENT_ID = DESKTOP_OAUTH_CLIENT.id;

export const auth = betterAuth({
  appName: "Luke",
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:5173",
  secret: process.env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(getDatabase(), { provider: "pg", schema }),
  account: ACCOUNT_TOKEN_STORAGE,
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
