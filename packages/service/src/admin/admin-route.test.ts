/**
 * admin-route.test.ts -- the dashboard's viewer as the deployment reads it, from the request's one credential.
 *
 * The deployment's own seams (`hostedAdminSeams`) behind the dashboard's
 * resource, their session read answered by Better Auth with the bearer
 * plugin over a PGlite of its own, as the deployment's session store would
 * answer it: an admin's browser cookie is the admin, and a junk or blank
 * `Authorization` beside it is signed out rather than read past to the
 * cookie. The read behind the gate is a fake; nothing reads the deployment's
 * database.
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
import { afterEach, vi } from "vitest";
import { auth } from "../auth/auth.js";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import { hostedFetch } from "../orpc/handler.js";
import type { WebServices } from "../runtime.js";
import { openWorkspacePlugin } from "../testing/workspace-plugin.js";
import { USER_ROLE } from "./admin-access.js";
import type { AdminMetrics } from "./admin-metrics.js";
import { adminProcedures } from "./admin-procedures.js";
import { hostedAdminSeams } from "./admin-route.js";

const ORIGIN = "https://luke.test";
const METRICS_PATH = "/api/admin/metrics";

// SAFETY: the resource writes the metrics read's answer as it came, so a marker object stands in for the whole answer.
const METRICS = { generatedAt: 1 } as unknown as AdminMetrics;

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * An admin signed in on a browser of their own, the deployment's session
 * read answered by Better Auth over the plugin's PGlite, since the
 * deployment's own keeps its sessions in a database this suite never reaches.
 */
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
  vi.spyOn(auth.api, "getSession").mockImplementation(
    // SAFETY: the viewer read takes the session's user id and role alone, which both instances answer from the same row.
    async (context) =>
      (await plugin.api.getSession({ headers: context?.headers ?? new Headers() })) as Awaited<
        ReturnType<typeof auth.api.getSession>
      >,
  );
  return { cookie: yield* plugin.sessionCookieOf(admin) };
});

/** The dashboard's metrics, asked with the headers given, through its resource over the deployment's own seams, the read itself a fake. */
const metrics = (headers: Record<string, string>) =>
  Effect.gen(function* () {
    const services = yield* Effect.context<DatabaseServices>().pipe(Effect.provide(noDatabase));
    const seams = { ...hostedAdminSeams(), readMetrics: () => Effect.succeed(METRICS) };
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
      const { cookie } = yield* openAdmin;

      assert.deepEqual(yield* metrics({ cookie }), {
        status: HOSTED_HTTP_STATUS.OK,
        text: JSON.stringify(METRICS),
      });
      for (const authorization of ["Bearer not-a-token", "Basic YWRhOmxvdmVsYWNl", ""]) {
        assert.deepEqual(
          yield* metrics({ authorization, cookie }),
          {
            status: HOSTED_HTTP_STATUS.UNAUTHORIZED,
            text: JSON.stringify({ error: ADMIN_ERROR.NOT_SIGNED_IN }),
          },
          JSON.stringify(authorization),
        );
      }
    }),
);
