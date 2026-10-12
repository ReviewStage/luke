import { betterAuth } from "better-auth";
import { organization as organizationPlugin } from "better-auth/plugins";
import { drizzle } from "drizzle-orm/pglite";
import { Effect } from "effect";
import { authDatabaseAdapter } from "../../server/auth-database";
import { DISABLED_AUTH_PATHS, ORGANIZATION_OPTIONS } from "../../server/auth-policy";
import * as authSchema from "../../server/db/auth-schema";
import { workspaceSeams } from "../../server/hosted/workspace-seams";
import { openMigratedPglite, sqlClientOverPglite } from "./sql-client";

/**
 * workspace-plugin.ts -- Better Auth with the organization plugin over a migrated PGlite of its own.
 *
 * The plugin writes through its own adapter and the store reads through
 * `database`, the same PGlite, so a test sees the plugin's real rows: the
 * organization and owner a create makes, and the member an add makes. The
 * database is closed with the scope that opened it.
 */

export const openWorkspacePlugin = Effect.gen(function* () {
  const client = yield* Effect.acquireRelease(Effect.promise(openMigratedPglite), (opened) =>
    Effect.promise(() => opened.close()),
  );
  const plugin = betterAuth({
    database: authDatabaseAdapter(drizzle(client, { schema: authSchema })),
    baseURL: "http://127.0.0.1",
    secret: "workspace-plugin-test-secret-with-enough-length",
    disabledPaths: [...DISABLED_AUTH_PATHS],
    plugins: [organizationPlugin(ORGANIZATION_OPTIONS)],
  });
  return {
    api: plugin.api,
    seams: workspaceSeams(plugin.api),
    database: sqlClientOverPglite(client),
  };
});
