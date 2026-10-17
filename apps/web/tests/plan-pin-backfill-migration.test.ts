import assert from "node:assert/strict";
import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { MIGRATIONS_FOLDER, runWebMigrations } from "@luke/database/core/migrator";
import { unmigratedPgliteSqlClient } from "@luke/database/testing";
import { Effect, Layer } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";
import * as SqlClient from "effect/sql/SqlClient";

/**
 * The plan pin backfill over a database whose pins still stand on the shared
 * plan row: each pinned plan becomes a pin of the account that started it, at
 * the instant it was pinned, and of no other member of its workspace, and a
 * plan never pinned becomes nobody's. Synthetic accounts throughout.
 */

const BACKFILL = "20261015211326_plan_pin_per_account";

const PINNED_AT = "2026-10-01T09:30:00.000Z";

const PINNED_PLAN = "00000000-0000-4000-8000-000000000001";

/** A migrations folder holding every migration named before the backfill, and none after. */
const foldersBeforeBackfill = Effect.gen(function* () {
  const fileSystem = yield* FileSystem;
  const path = yield* Path;
  const folder = yield* fileSystem.makeTempDirectoryScoped({ prefix: "luke-before-plan-pin-" });
  const names = (yield* fileSystem.readDirectory(MIGRATIONS_FOLDER)).filter(
    (name) => name.localeCompare(BACKFILL) < 0,
  );
  for (const name of names) {
    yield* fileSystem.copy(path.join(MIGRATIONS_FOLDER, name), path.join(folder, name));
  }
  return folder;
});

it.effect(
  "a plan pinned on its shared row is pinned for the account that started it, and for no other member",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* runWebMigrations(yield* foldersBeforeBackfill);
        yield* sql`insert into "user" (id, name, email, created_at, updated_at)
          values ('dean', 'Dean', 'dean@luke.test', now(), now()),
                 ('charles', 'Charles', 'charles@luke.test', now(), now())`;
        yield* sql`insert into organization (id, name, slug, created_at)
          values ('team', 'Team', 'team', now())`;
        yield* sql`insert into member (id, organization_id, user_id, role, created_at)
          values ('dean-member', 'team', 'dean', 'owner', now()),
                 ('charles-member', 'team', 'charles', 'member', now())`;
        yield* sql`insert into plan (id, user_id, organization_id, name, document, pinned_at)
          values (${PINNED_PLAN}, 'charles', 'team', 'Pinned', '', ${PINNED_AT}),
                 ('00000000-0000-4000-8000-000000000002', 'dean', 'team', 'Unpinned', '', null)`;

        yield* runWebMigrations();

        const pins = yield* sql<{
          readonly user_id: string;
          readonly task_id: string;
          readonly pinned_at: string;
        }>`
          select user_id, task_id, pinned_at::text as pinned_at from task_pin
        `;
        assert.deepEqual(
          pins.map((pin) => ({
            userId: pin.user_id,
            planId: pin.task_id,
            pinnedAt: new Date(pin.pinned_at).toISOString(),
          })),
          [
            {
              userId: "charles",
              planId: PINNED_PLAN,
              pinnedAt: PINNED_AT,
            },
          ],
        );
      }),
    ).pipe(Effect.provide(Layer.provideMerge(unmigratedPgliteSqlClient, NodeServices.layer))),
);
