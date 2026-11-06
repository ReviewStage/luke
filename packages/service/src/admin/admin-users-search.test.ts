import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import { user } from "@repo/database/schemas/auth";
import { getTestDB } from "@repo/database/testing";
import { ADMIN_METRICS_SCOPE, ADMIN_METRICS_WINDOW } from "@repo/features/admin-wire";
import { Effect } from "effect";
import { USER_ROLE } from "./admin-access.js";
import { readAdminUsersSource } from "./admin-queries.js";

const NOW = Date.UTC(2026, 9, 21, 12);

it.layer(getTestDB())("the Users read's search", (it) => {
  it.effect("keeps the accounts that hold every word, across the name and the email", () =>
    Effect.gen(function* () {
      const db = yield* Database;
      yield* db.insert(user).values([
        { id: "u-root", name: "Root", email: "root@app.test", role: USER_ROLE.ADMIN },
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
