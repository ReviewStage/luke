import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { account, user } from "@luke/database/schemas/auth";
import { getTestDB } from "@luke/database/testing";
import { Effect } from "effect";
import { USER_ROLE } from "./admin-access.js";
import { readAdminUsersSource } from "./admin-queries.js";
import { ADMIN_METRICS_SCOPE, ADMIN_METRICS_WINDOW, type AdminMetricsScope } from "./http.js";

/**
 * admin-queries.test.ts -- the Users read carries the sign-in methods the
 * Overview used to: every account the scope keeps, by each method it linked,
 * whatever the search narrowed the rows to, and an admin's own left out
 * while admins are hidden. Synthetic accounts throughout.
 */

const NOW = Date.UTC(2026, 9, 21, 12);

const openAccount = (name: string, providers: readonly string[], role: string = USER_ROLE.USER) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const id = `user-${name}-${randomUUID()}`;
    yield* db.insert(user).values({ id, name, email: `${id}@luke.test`, role });
    for (const providerId of providers) {
      yield* db.insert(account).values({
        id: randomUUID(),
        accountId: randomUUID(),
        providerId,
        userId: id,
        updatedAt: new Date(NOW),
      });
    }
    return id;
  });

it.layer(getTestDB())("the Users read", (it) => {
  it.effect("counts every kept account's sign-in methods, whatever the search", () =>
    Effect.gen(function* () {
      const viewerId = yield* openAccount("root", ["github"], USER_ROLE.ADMIN);
      yield* openAccount("ada", ["github", "google"]);
      yield* openAccount("grace", ["google"]);
      yield* openAccount("linus", ["passkey"]);

      const read = (scope: AdminMetricsScope) =>
        readAdminUsersSource({
          now: NOW,
          scope,
          search: "ada",
          viewerId,
          windowDays: ADMIN_METRICS_WINDOW.MONTH,
        });

      const hidden = yield* read(ADMIN_METRICS_SCOPE.NON_ADMINS);
      assert.equal(hidden.total, 1);
      assert.deepEqual(hidden.signIn, {
        accounts: 3,
        methods: { github: 1, google: 2, other: 1 },
      });

      const everyone = yield* read(ADMIN_METRICS_SCOPE.ALL);
      assert.deepEqual(everyone.signIn, {
        accounts: 4,
        methods: { github: 2, google: 2, other: 1 },
      });
    }),
  );
});
