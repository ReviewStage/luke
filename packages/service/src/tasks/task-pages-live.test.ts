import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import type { LiveStatement } from "@luke/database/core/live-statement";
import { Database } from "@luke/database/core/query";
import { createCodingAgent } from "@luke/database/models/coding-agent-store";
import { listPages, writePage } from "@luke/database/models/plan-pages";
import { user } from "@luke/database/schemas/auth";
import { getTestDB, startTask } from "@luke/database/testing";
import { pagesOfLiveRows, taskPagesLiveRowsSchema } from "@luke/features/live-wire";
import { PAGE_OWNER, PAGE_SHOWER, taskPageOwner } from "@luke/features/page-wire";
import { Effect, Option, Schema } from "effect";
import { SqlClient } from "effect/sql";
import { agentPagesLiveStatements, taskPagesLiveStatements } from "./task-pages-live.js";

/**
 * A task's pages as Realtime would deliver them, over the real migrations on
 * PGlite: the statement run as Realtime runs it, its rows decoded and ordered
 * as the desktop does, beside `listPages`, the held read the Inbox read them
 * with. The two agree as pages are shown, as a page's next version lands,
 * and for an account that does not reach the task; and so for the pages a
 * coding agent on no task showed on itself, which hold none of a task's.
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

/** A coding agent of the account's, on the task named or, in the workspace, on none. */
const openAgent = (userId: string, place: { taskId: string } | { organizationId: string }) =>
  Effect.map(
    createCodingAgent(userId, {
      ...("taskId" in place
        ? { taskId: place.taskId, planSnapshot: null, prompt: null }
        : { taskId: null, organizationId: place.organizationId, planSnapshot: null, prompt: "Go" }),
      idempotencyKey: randomUUID(),
      model: "anthropic/claude-opus-5.5",
      effort: "high",
      repository: null,
    }),
    (started) => Option.getOrThrow(started).agent.id,
  );

/** The pages as Realtime would deliver them to `reader`, as the desktop orders them. */
const liveRowsOf = (statement: LiveStatement) =>
  Effect.gen(function* () {
    const rows = yield* Schema.decodeUnknownEffect(taskPagesLiveRowsSchema)({
      pages: yield* runLive(statement),
    });
    return pagesOfLiveRows(rows);
  });

/** The task's pages as Realtime would deliver them to `reader`, as the desktop orders them. */
const livePagesOf = (reader: string, taskId: string) =>
  liveRowsOf(Option.getOrThrow(taskPagesLiveStatements(reader, taskId)).pages);

/** The agent's own pages as Realtime would deliver them to `reader`. */
const liveAgentPagesOf = (reader: string, agentId: string) =>
  liveRowsOf(Option.getOrThrow(agentPagesLiveStatements(reader, agentId)).pages);

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
          const held = yield* listPages(owner, taskPageOwner(task.id));
          assert.deepEqual(yield* livePagesOf(owner, task.id), held);
          return held;
        });

        assert.deepEqual(yield* agrees, []);
        const funnel = Option.getOrThrow(
          yield* writePage(
            owner,
            taskPageOwner(task.id),
            { title: "Invite funnel", html: "<p>One</p>" },
            { kind: PAGE_SHOWER.LUKE },
          ),
        );
        yield* writePage(
          owner,
          taskPageOwner(task.id),
          { title: "Seat pricing", html: "<p>Seats</p>" },
          { kind: PAGE_SHOWER.AGENT, agentId: yield* openAgent(owner, { taskId: task.id }) },
        );
        yield* writePage(
          owner,
          taskPageOwner(other.id),
          { title: "Another task's page", html: "<p>Elsewhere</p>" },
          { kind: PAGE_SHOWER.LUKE },
        );
        assert.equal((yield* agrees).length, 2);
        yield* writePage(
          owner,
          taskPageOwner(task.id),
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

  it.effect(
    "an agent's own pages answer what listPages answers, hold none of a task's, and answer nothing to a stranger",
    () =>
      Effect.gen(function* () {
        const owner = yield* openUser;
        const stranger = yield* openUser;
        const task = yield* startTask(owner, { name: "Teammate invitations" });
        const agentId = yield* openAgent(owner, { organizationId: task.workspaceId });
        const owned = { kind: PAGE_OWNER.AGENT, agentId } as const;
        const shower = { kind: PAGE_SHOWER.AGENT, agentId } as const;
        const chart = Option.getOrThrow(
          yield* writePage(owner, owned, { title: "Chart", html: "<p>1</p>" }, shower),
        );
        yield* writePage(
          owner,
          owned,
          { pageId: chart.id, title: "Chart, revised", html: "<p>2</p>" },
          shower,
        );
        yield* writePage(
          owner,
          taskPageOwner(task.id),
          { title: "The task's", html: "<p>t</p>" },
          { kind: PAGE_SHOWER.LUKE },
        );

        const held = yield* listPages(owner, owned);
        assert.deepEqual(yield* liveAgentPagesOf(owner, agentId), held);
        assert.deepEqual(
          held.map(({ id, title, version }) => ({ id, title, version })),
          [{ id: chart.id, title: "Chart, revised", version: 2 }],
        );
        assert.deepEqual(yield* liveAgentPagesOf(stranger, agentId), []);
      }),
  );
});
