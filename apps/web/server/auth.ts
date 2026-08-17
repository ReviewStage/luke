import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { oauthProvider } from "@better-auth/oauth-provider";
import { betterAuth } from "better-auth";
import { jwt, lastLoginMethod } from "better-auth/plugins";
import { PostHog } from "posthog-node";
import { getDatabase } from "./db/index.js";
import * as schema from "./db/schema.js";
import { DESKTOP_OAUTH_CLIENT } from "./desktop-oauth-client.js";

export const DESKTOP_OAUTH_CLIENT_ID = DESKTOP_OAUTH_CLIENT.id;

const posthog = process.env.POSTHOG_API_KEY
  ? new PostHog(process.env.POSTHOG_API_KEY, {
      host: process.env.POSTHOG_HOST ?? "https://us.i.posthog.com",
    })
  : undefined;

export const auth = betterAuth({
  appName: "Luke",
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:5173",
  secret: process.env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(getDatabase(), { provider: "pg", schema }),
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
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          if (!posthog) return;
          await posthog
            .captureImmediate({
              distinctId: user.id,
              event: "user_signed_up",
              properties: {
                provider:
                  typeof user.lastLoginMethod === "string" ? user.lastLoginMethod : "unknown",
              },
            })
            .catch(() => undefined);
        },
      },
    },
  },
  plugins: [
    jwt(),
    lastLoginMethod({ storeInDatabase: true }),
    oauthProvider({
      loginPage: "/sign-in.html",
      consentPage: "/consent.html",
      allowDynamicClientRegistration: false,
      cachedTrustedClients: new Set([DESKTOP_OAUTH_CLIENT_ID]),
      accessTokenExpiresIn: 60 * 60,
      customUserInfoClaims: ({ user }) => ({
        provider: typeof user.lastLoginMethod === "string" ? user.lastLoginMethod : "unknown",
      }),
    }),
  ],
});
