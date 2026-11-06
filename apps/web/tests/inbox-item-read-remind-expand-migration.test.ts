import assert from "node:assert/strict";
import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { MIGRATIONS_FOLDER, runWebMigrations } from "@repo/database/core/migrator";
import {
  openInboxItem,
  openTaskAgent,
  openWorkspace,
  unmigratedPgliteSqlClient,
} from "@repo/database/testing";
import { remindInboxItem } from "@repo/service/inbox/inbox-store";
import { Effect, Layer } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";
import * as SqlClient from "effect/sql/SqlClient";

const MIGRATION = "20261105235359_inbox_item_read_remind_expand";

const DESCRIPTION_RENAME = "20261106055235_description_rename";

const foldersBefore = Effect.gen(function* () {
  const fileSystem = yield* FileSystem;
  const path = yield* Path;
  const folder = yield* fileSystem.makeTempDirectoryScoped({ prefix: "before-remind-expand-" });
  const names = (yield* fileSystem.readDirectory(MIGRATIONS_FOLDER)).filter(
    (name) => name.localeCompare(MIGRATION) < 0 || name === DESCRIPTION_RENAME,
  );
  for (const name of names) {
    yield* fileSystem.copy(path.join(MIGRATIONS_FOLDER, name), path.join(folder, name));
  }
  return folder;
});

it.effect(
  "the old columns' reminder is the new columns' too, and a write to either pair moves the other",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* runWebMigrations(yield* foldersBefore);
        yield* sql`insert into "user" (id, name, email) values ('dean', 'dean', 'dean@app.test')`;
        const workspaceId = yield* openWorkspace("dean");
        const agentId = yield* openTaskAgent("dean", workspaceId, null);
        const earlier = yield* openInboxItem("dean", workspaceId, null, agentId, true);
        const later = yield* openInboxItem("dean", workspaceId, null, agentId, true);
        yield* sql`insert into inbox_item_read (item_id, user_id, read_through, snoozed_until, snoozed_through)
          values (${earlier}, 'dean', '2026-11-05T09:00:00Z', '2099-01-01T09:00:00Z', '2026-11-05T09:00:00Z')`;

        yield* runWebMigrations();

        const markers = sql<{
          readonly itemId: string;
          readonly remindAt: string | null;
          readonly remindThrough: string | null;
          readonly mirrored: boolean;
        }>`select item_id as "itemId", remind_at::text as "remindAt", remind_through::text as "remindThrough",
          (remind_at, remind_through) is not distinct from (snoozed_until, snoozed_through) as mirrored
          from inbox_item_read where user_id = 'dean' order by item_id`;
        const marker = (itemId: string) =>
          Effect.map(markers, (rows) => rows.find((row) => row.itemId === itemId));
        assert.deepEqual(yield* marker(earlier), {
          itemId: earlier,
          remindAt: "2099-01-01 09:00:00+00",
          remindThrough: "2026-11-05 09:00:00+00",
          mirrored: true,
        });

        yield* remindInboxItem("dean", later, new Date("2099-02-01T09:00:00Z"));
        assert.equal((yield* marker(later))?.mirrored, true);
        yield* sql`insert into inbox_item_read (item_id, user_id, snoozed_until, snoozed_through)
          values (${later}, 'dean', '2099-03-01T09:00:00Z', '2026-11-05T10:00:00Z')
          on conflict (item_id, user_id) do update set snoozed_until = excluded.snoozed_until, snoozed_through = excluded.snoozed_through`;
        assert.deepEqual(yield* marker(later), {
          itemId: later,
          remindAt: "2099-03-01 09:00:00+00",
          remindThrough: "2026-11-05 10:00:00+00",
          mirrored: true,
        });

        yield* remindInboxItem("dean", earlier, null);
        const [canceled] = yield* sql<{
          readonly due: boolean;
        }>`select snoozed_until <= now() as due from inbox_item_read where item_id = ${earlier}`;
        assert.deepEqual(canceled, { due: true });
        assert.equal((yield* marker(earlier))?.mirrored, true);

        const fileSystem = yield* FileSystem;
        const path = yield* Path;
        const backfill = (yield* fileSystem.readFileString(
          path.join(MIGRATIONS_FOLDER, MIGRATION, "migration.sql"),
        ))
          .split("--> statement-breakpoint")
          .filter((statement) => statement.trim().startsWith("UPDATE"));
        assert.equal(backfill.length, 1);
        const before = yield* markers;
        for (const statement of backfill) yield* sql.unsafe(statement);
        assert.deepEqual(yield* markers, before);
      }),
    ).pipe(Effect.provide(Layer.provideMerge(unmigratedPgliteSqlClient, NodeServices.layer))),
);
