/**
 * admin-route.test.ts -- the dashboard's viewer as the deployment's seams read it, from the request's one credential.
 *
 * The deployment's own seams (`hostedAdminSeams`) behind the dashboard's
 * resource, built over Better Auth with the bearer plugin on a PGlite of its
 * own, handed in where a deployment hands its own `auth.api`: an admin's
 * browser cookie is the admin, and a junk or blank `Authorization` beside it
 * is signed out rather than read past to the cookie. The read behind the gate
 * is a fake; nothing reads the deployment's database.
 *
 * Synthetic accounts and sessions throughout.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database, type DatabaseServices } from "@luke/database/core/query";
import { user } from "@luke/database/schemas/auth";
import { noDatabase } from "@luke/database/testing/no-database";
import { ADMIN_ERROR } from "@luke/features/admin-wire";
import { type Context, Effect } from "effect";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import { hostedFetch } from "../orpc/handler.js";
import type { WebServices } from "../runtime.js";
import { openWorkspacePlugin } from "../testing/workspace-plugin.js";
import { USER_ROLE } from "./admin-access.js";
import type { AdminMetrics } from "./admin-metrics.js";
import { adminProcedures } from "./admin-procedures.js";
import { type AdminSessionApi, hostedAdminSeams } from "./admin-route.js";

const ORIGIN = "https://luke.test";
const METRICS_PATH = "/api/admin/metrics";

// SAFETY: the resource writes the metrics read's answer as it came, so a marker object stands in for the whole answer.
const METRICS = { generatedAt: 1 } as unknown as AdminMetrics;

/** An admin signed in on a browser of their own, on Better Auth over its own PGlite. */
const openAdmin = Effect.gen(function* () {
  const plugin = yield* openWorkspacePlugin;
  const admin = `user-${randomUUID()}`;
  yield* Database.use((db) =>
    db.insert(user).values({
      id: admin,
      name: "Test Admin",
      email: `${admin}@luke.test`,
      role: USER_ROLE.ADMIN,
    }),
  ).pipe(Effect.provide(plugin.database));
  return { api: plugin.api, cookie: yield* plugin.sessionCookieOf(admin) };
});

/** The dashboard's metrics, asked with the headers given, through its resource over the deployment's own seams on the auth service given, the read itself a fake. */
const metrics = (api: AdminSessionApi, headers: Record<string, string>) =>
  Effect.gen(function* () {
    const services = yield* Effect.context<DatabaseServices>().pipe(Effect.provide(noDatabase));
    const seams = { ...hostedAdminSeams(api), readMetrics: () => Effect.succeed(METRICS) };
    const response = yield* Effect.promise(() =>
      hostedFetch({ admin: adminProcedures(seams) })(
        new Request(new URL(METRICS_PATH, ORIGIN), { headers }),
        // SAFETY: the dashboard's resource yields the database alone, which is all a test provides of the web runtime's services.
        services as Context.Context<WebServices>,
      ),
    );
    return { status: response.status, text: yield* Effect.promise(() => response.text()) };
  });

it.effect(
  "an admin's browser cookie is the admin, and a junk or blank Authorization beside it is signed out rather than read past to it",
  () =>
    Effect.gen(function* () {
      const { api, cookie } = yield* openAdmin;

      assert.deepEqual(yield* metrics(api, { cookie }), {
        status: HOSTED_HTTP_STATUS.OK,
        text: JSON.stringify(METRICS),
      });
      for (const authorization of ["Bearer not-a-token", "Basic YWRhOmxvdmVsYWNl", ""]) {
        assert.deepEqual(
          yield* metrics(api, { authorization, cookie }),
          {
            status: HOSTED_HTTP_STATUS.UNAUTHORIZED,
            text: JSON.stringify({ error: ADMIN_ERROR.NOT_SIGNED_IN }),
          },
          JSON.stringify(authorization),
        );
      }
    }),
);
