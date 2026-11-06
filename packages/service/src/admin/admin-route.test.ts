import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database, type DatabaseServices } from "@repo/database/core/query";
import { user } from "@repo/database/schemas/auth";
import { noDatabase } from "@repo/database/testing/no-database";
import type { AdminMetrics } from "@repo/features/admin-answer-wire";
import { ADMIN_ERROR } from "@repo/features/admin-wire";
import { type Context, Effect } from "effect";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import { hostedFetch } from "../orpc/handler.js";
import type { WebServices } from "../runtime.js";
import { openWorkspacePlugin } from "../testing/workspace-plugin.js";
import { USER_ROLE } from "./admin-access.js";
import { adminProcedures } from "./admin-procedures.js";
import { type AdminSessionApi, hostedAdminSeams } from "./admin-route.js";

const ORIGIN = "https://app.test";
const METRICS_PATH = "/api/admin/metrics";

const METRICS = { generatedAt: 1 } as unknown as AdminMetrics;

const openAdmin = Effect.gen(function* () {
  const plugin = yield* openWorkspacePlugin;
  const admin = `user-${randomUUID()}`;
  yield* Database.use((db) =>
    db.insert(user).values({
      id: admin,
      name: "Test Admin",
      email: `${admin}@app.test`,
      role: USER_ROLE.ADMIN,
    }),
  ).pipe(Effect.provide(plugin.database));
  return { api: plugin.api, cookie: yield* plugin.sessionCookieOf(admin) };
});

const metrics = (api: AdminSessionApi, headers: Record<string, string>) =>
  Effect.gen(function* () {
    const services = yield* Effect.context<DatabaseServices>().pipe(Effect.provide(noDatabase));
    const seams = { ...hostedAdminSeams(api), readMetrics: () => Effect.succeed(METRICS) };
    const response = yield* Effect.promise(() =>
      hostedFetch({ admin: adminProcedures(seams) })(
        new Request(new URL(METRICS_PATH, ORIGIN), { headers }),
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
