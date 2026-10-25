import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { user } from "@luke/database/schemas/auth";
import { getTestDB } from "@luke/database/testing";
import { ADMIN_METRICS_SCOPE, ADMIN_METRICS_WINDOW } from "@luke/features/admin-wire";
import { Effect } from "effect";
import { USER_ROLE } from "./admin-access.js";
import { readAdminUsersSource } from "./admin-queries.js";

/**
 * admin-users-search.test.ts -- the Users read's search keeps the accounts
 * that hold every word of it, each in the name or the email, as the panel's
 * word search does for the rows it already holds. Synthetic accounts.
 */

const NOW = Date.UTC(2026, 9, 21, 12);

it.layer(getTestDB())("the Users read's search", (it) => {
  it.effect("keeps the accounts that hold every word, across the name and the email", () =>
    Effect.gen(function* () {
      const db = yield* Database;
      yield* db.insert(user).values([
        { id: "u-root", name: "Root", email: "root@luke.test", role: USER_ROLE.ADMIN },
        { id: "u-jane", name: "Jane Doe", email: "jane@acme.test", role: USER_ROLE.USER },
        { id: "u-bob", name: "Bob Ross", email: "bob@acme.test", role: USER_ROLE.USER },
      ]);

      const found = (search: string) =>
        Effect.map(
          readAdminUsersSource({
            now: NOW,
            scope: ADMIN_METRICS_SCOPE.NON_ADMINS,
            search,
            viewerId: "u-root",
            windowDays: ADMIN_METRICS_WINDOW.MONTH,
          }),
          (list) => list.rows.map((row) => row.name),
        );

      assert.deepEqual(yield* found("jane acme"), ["Jane Doe"]);
      assert.deepEqual(yield* found("ACME  doe"), ["Jane Doe"]);
      assert.deepEqual((yield* found("acme")).toSorted(), ["Bob Ross", "Jane Doe"]);
      assert.deepEqual(yield* found("jane initech"), []);
    }),
  );
});
