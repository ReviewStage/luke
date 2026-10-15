import { memberSeams, workspaceSeams } from "@luke/database/models/workspace-seams";
import { openMigratedPglite, sqlClientOverPglite } from "@luke/database/testing";
import { authDatabaseAdapter } from "@luke/service/auth/auth-database";
import {
  DISABLED_AUTH_PATHS,
  ORGANIZATION_OPTIONS,
  SESSION_BEARER,
} from "@luke/service/auth/auth-policy";
import { betterAuth } from "better-auth";
import { makeSignature } from "better-auth/crypto";
import { bearer, organization as organizationPlugin } from "better-auth/plugins";
import { drizzle } from "drizzle-orm/pglite";
import { Effect, Option } from "effect";

/**
 * workspace-plugin.ts -- Better Auth with the organization and bearer plugins over a migrated PGlite of its own.
 *
 * The plugin writes through its own adapter and the store reads through
 * `database`, the same PGlite, so a test sees the plugin's real rows: the
 * organization and owner a create makes, and the member an add makes. A
 * member write is the plugin's own call under a session, which
 * `sessionBearerOf` mints for an account and signs as the bearer plugin
 * hands one out, so the plugin reads it back exactly as it reads the Mac's.
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
    disabledPaths: [...DISABLED_AUTH_PATHS],
    plugins: [organizationPlugin(ORGANIZATION_OPTIONS), bearer(SESSION_BEARER)],
  });
  /** A fresh session for the account, as the signed bearer token the plugin would hand the Mac. */
  const sessionBearerOf = (userId: string) =>
    Effect.promise(async () => {
      const context = await plugin.$context;
      const session = await context.internalAdapter.createSession(userId);
      return `${session.token}.${await makeSignature(session.token, SECRET)}`;
    });
  /** The account a request's session names, read as the routes read it. */
  const resolveSessionUserId = (request: Request) =>
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
    database: sqlClientOverPglite(client),
  };
});
