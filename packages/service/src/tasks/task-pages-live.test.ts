import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import type { LiveStatement } from "@luke/database/core/live-statement";
import { Database } from "@luke/database/core/query";
import { listPages, writePage } from "@luke/database/models/plan-pages";
import { user } from "@luke/database/schemas/auth";
import { getTestDB, startTask } from "@luke/database/testing";
import { pagesOfLiveRows, taskPagesLiveRowsSchema } from "@luke/features/live-wire";
import { PAGE_SHOWER } from "@luke/features/page-wire";
import { Effect, Option, Schema } from "effect";
import { SqlClient } from "effect/sql";
import { taskPagesLiveStatements } from "./task-pages-live.js";

/**
 * A task's pages as Realtime would deliver them, over the real migrations on
 * PGlite: the statement run as Realtime runs it, its rows decoded and ordered
 * as the desktop does, beside `listPages`, the held read the Inbox read them
 * with. The two agree as pages are shown, as a page's next version lands,
 * and for an account that does not reach the task.
 *
 * Synthetic accounts, pages, and words throughout.
 */

/** A new account, as the store holds one. */
const openUser = Effect.gen(function* () {
  const db = yield* Database;
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
  return userId;
});

/** The statement run as Realtime runs it. */
const runLive = (statement: LiveStatement) =>
  Effect.flatMap(SqlClient.SqlClient, (sql) => sql.unsafe(statement.sql, [...statement.params]));

/** The task's pages as Realtime would deliver them to `reader`, as the desktop orders them. */
const livePagesOf = (reader: string, taskId: string) =>
  Effect.gen(function* () {
    const statements = Option.getOrThrow(taskPagesLiveStatements(reader, taskId));
    const rows = yield* Schema.decodeUnknownEffect(taskPagesLiveRowsSchema)({
      pages: yield* runLive(statements.pages),
    });
    return pagesOfLiveRows(rows);
  });

it.layer(getTestDB())("a task's pages followed live", (it) => {
  it.effect(
    "answer what listPages answers as pages are shown and moved on, and nothing to a stranger",
    () =>
      Effect.gen(function* () {
        const owner = yield* openUser;
        const stranger = yield* openUser;
        const task = yield* startTask(owner, { name: "Teammate invitations" });
        const other = yield* startTask(owner, { name: "Billing" });
        const agrees = Effect.gen(function* () {
          const held = yield* listPages(owner, task.id);
          assert.deepEqual(yield* livePagesOf(owner, task.id), held);
          return held;
        });

        assert.deepEqual(yield* agrees, []);
        const funnel = Option.getOrThrow(
          yield* writePage(
            owner,
            task.id,
            { title: "Invite funnel", html: "<p>One</p>" },
            { kind: PAGE_SHOWER.LUKE },
          ),
        );
        yield* writePage(
          owner,
          task.id,
          { title: "Seat pricing", html: "<p>Seats</p>" },
          { kind: PAGE_SHOWER.AGENT, agentId: randomUUID() },
        );
        yield* writePage(
          owner,
          other.id,
          { title: "Another task's page", html: "<p>Elsewhere</p>" },
          { kind: PAGE_SHOWER.LUKE },
        );
        assert.equal((yield* agrees).length, 2);
        yield* writePage(
          owner,
          task.id,
          { pageId: funnel.id, title: "Invite funnel, revised", html: "<p>Two</p>" },
          { kind: PAGE_SHOWER.LUKE },
        );
        const pages = yield* agrees;
        assert.deepEqual(
          pages.find((page) => page.id === funnel.id)?.title,
          "Invite funnel, revised",
        );
        assert.deepEqual(yield* livePagesOf(stranger, task.id), []);
      }),
  );
});
