import { memberSeams, workspaceSeams } from "@luke/database/models/workspace-seams";
import { openMigratedPglite, sqlClientOverPglite } from "@luke/database/testing";
import { betterAuth } from "better-auth";
import { makeSignature } from "better-auth/crypto";
import { bearer, organization as organizationPlugin } from "better-auth/plugins";
import { drizzle } from "drizzle-orm/pglite";
import { Effect, Option } from "effect";
import { authDatabaseAdapter } from "../auth/auth-database.js";
import {
  DISABLED_AUTH_PATHS,
  ORGANIZATION_OPTIONS,
  SESSION_BEARER,
  USER_FIELDS,
} from "../auth/auth-policy.js";

/**
 * workspace-plugin.ts -- Better Auth with the organization and bearer plugins, and the user's fields `auth.ts` declares, over a migrated PGlite of its own.
 *
 * The plugin writes through its own adapter and the store reads through
 * `database`, the same PGlite, so a test sees the plugin's real rows: the
 * organization and owner a create makes, and the member an add makes, and a
 * session answers its user's `role` as the deployment's does. A
 * member write is the plugin's own call under a session, which
 * `sessionBearerOf` mints for an account and signs as the bearer plugin
 * hands one out, so the plugin reads it back exactly as it reads the Mac's.
 * `sessionCookieOf` mints one as the cookie a signed-in browser carries,
 * spelled as the bearer plugin spells the cookie it reads a bearer as.
 * The database is closed with the scope that opened it.
 */

const SECRET = "workspace-plugin-test-secret-with-enough-length";

export const openWorkspacePlugin = Effect.gen(function* () {
  const client = yield* Effect.acquireRelease(Effect.promise(openMigratedPglite), (opened) =>
    Effect.promise(() => opened.close()),
  );
  const plugin = betterAuth({
    database: authDatabaseAdapter(drizzle({ client })),
    baseURL: "http://127.0.0.1",
    secret: SECRET,
    user: USER_FIELDS,
    disabledPaths: [...DISABLED_AUTH_PATHS],
    plugins: [organizationPlugin(ORGANIZATION_OPTIONS), bearer(SESSION_BEARER)],
  });
  /** A fresh session for the account, its token signed under the plugin's secret. */
  const signedSessionOf = async (userId: string) => {
    const context = await plugin.$context;
    const session = await context.internalAdapter.createSession(userId);
    return { context, signed: `${session.token}.${await makeSignature(session.token, SECRET)}` };
  };
  /** A fresh session for the account, as the signed bearer token the plugin would hand the Mac. */
  const sessionBearerOf = (userId: string) =>
    Effect.promise(async () => (await signedSessionOf(userId)).signed);
  /** A fresh session for the account, as the `Cookie` header a browser signed in to it sends. */
  const sessionCookieOf = (userId: string) =>
    Effect.promise(async () => {
      const { context, signed } = await signedSessionOf(userId);
      return `${context.authCookies.sessionToken.name}=${encodeURIComponent(signed)}`;
    });
  /** The account a request's session names, read as the routes read it, from a request or its headers alone. */
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
    database: sqlClientOverPglite(client),
  };
});
