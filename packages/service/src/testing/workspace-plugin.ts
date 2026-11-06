import { memberSeams, workspaceSeams } from "@repo/database/models/workspace-seams";
import {
  openMigratedPglite,
  sqlClientOverPglite,
  syncListenerOverPglite,
} from "@repo/database/testing";
import { betterAuth } from "better-auth";
import { makeSignature } from "better-auth/crypto";
import { admin, bearer, organization as organizationPlugin } from "better-auth/plugins";
import { drizzle } from "drizzle-orm/pglite";
import { Effect, Layer, Option } from "effect";
import { authDatabaseAdapter } from "../auth/auth-database.js";
import {
  ADMIN_OPTIONS,
  DISABLED_AUTH_PATHS,
  ORGANIZATION_OPTIONS,
  SESSION_BEARER,
  SESSION_COOKIE_CACHE,
} from "../auth/auth-policy.js";
import { supportAccess } from "../auth/support-access.js";

const SECRET = "workspace-plugin-test-secret-with-enough-length";

export const openWorkspacePlugin = Effect.gen(function* () {
  const client = yield* Effect.acquireRelease(Effect.promise(openMigratedPglite), (opened) =>
    Effect.promise(() => opened.close()),
  );
  const plugin = betterAuth({
    database: authDatabaseAdapter(drizzle({ client })),
    baseURL: "http://127.0.0.1",
    secret: SECRET,
    session: SESSION_COOKIE_CACHE,
    disabledPaths: [...DISABLED_AUTH_PATHS],
    plugins: [
      organizationPlugin(ORGANIZATION_OPTIONS),
      bearer(SESSION_BEARER),
      admin(ADMIN_OPTIONS),
      supportAccess(),
    ],
  });
  const signedSessionOf = async (userId: string) => {
    const context = await plugin.$context;
    const session = await context.internalAdapter.createSession(userId);
    return { context, signed: `${session.token}.${await makeSignature(session.token, SECRET)}` };
  };
  const sessionBearerOf = (userId: string) =>
    Effect.promise(async () => (await signedSessionOf(userId)).signed);
  const sessionCookieOf = (userId: string) =>
    Effect.promise(async () => {
      const { context, signed } = await signedSessionOf(userId);
      return `${context.authCookies.sessionToken.name}=${encodeURIComponent(signed)}`;
    });
  const resolveSessionUserId = (request: { headers: Headers }) =>
    Effect.tryPromise(async () => {
      const session = await plugin.api.getSession({ headers: request.headers });
      return Option.fromNullishOr(session?.user.id);
    });
  return {
    api: plugin.api,
    seams: workspaceSeams(plugin.api),
    members: memberSeams(plugin.api),
    resolveSessionUserId,
    sessionBearerOf,
    sessionCookieOf,
    database: Layer.provideMerge(syncListenerOverPglite, sqlClientOverPglite(client)),
  };
});
