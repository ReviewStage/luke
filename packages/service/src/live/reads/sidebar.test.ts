import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import { listRepositoryPins, setRepositoryPin } from "@repo/database/models/repository-pin-store";
import { listTaskSections, writeTaskSections } from "@repo/database/models/task-section-store";
import { createTask } from "@repo/database/models/task-store";
import { agentTable } from "@repo/database/schemas/agent";
import { user } from "@repo/database/schemas/auth";
import { conversations } from "@repo/database/schemas/storage";
import { CONVERSATION_KIND } from "@repo/database/storage-vocabulary";
import { getTestDB, joinWorkspace, openWorkspace } from "@repo/database/testing";
import { SIDEBAR_READ, type SidebarRows, sidebarRowsOfLive } from "@repo/features/sidebar-live";
import {
  TASK_SECTION_GLYPH,
  TASK_SECTION_ICON_KIND,
  TASK_SECTION_WRITE,
  type TaskSections,
  type TaskSectionWrite,
} from "@repo/features/task-section-wire";
import { Effect, Option, Schema } from "effect";
import { SqlClient } from "effect/sql";
import { TestClock } from "effect/testing";
import { sidebarRead } from "./sidebar.js";

const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const id = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@app.test` });
  return id;
});

/** Dean's workspace with Charles a member of it, and two tasks Dean started there. */
const openSharedWorkspace = Effect.gen(function* () {
  const dean = yield* openAccount;
  const charles = yield* openAccount;
  const workspace = yield* openWorkspace(dean);
  yield* joinWorkspace(workspace, charles);
  const { id: first } = yield* createTask(dean, { name: "Invites", organizationId: workspace });
  const { id: second } = yield* createTask(dean, { name: "Billing", organizationId: workspace });
  return { dean, charles, workspace, first, second };
});

/** An agent with no task the account started in the workspace. */
const openAgent = (userId: string, organizationId: string) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const id = randomUUID();
    const conversationId = randomUUID();
    yield* db
      .insert(conversations)
      .values({ id: conversationId, userId, kind: CONVERSATION_KIND.AGENT });
    yield* db.insert(agentTable).values({
      id,
      organizationId,
      userId,
      conversationId,
      model: "anthropic/claude-opus-5.5",
      effort: "high",
      prompt: "Sweep the flaky tests.",
      repository: "acme/api",
      idempotencyKey: randomUUID(),
    });
    return id;
  });

/** A write the test expects taken, answering the sections as they then stand. */
const written = (userId: string, write: TaskSectionWrite) =>
  Effect.map(writeTaskSections(userId, write), (answer) => {
    const { txid: _txid, ...sections } = Option.getOrElse(answer, () =>
      assert.fail("the write was refused"),
    );
    return sections satisfies TaskSections;
  });

const create = (workspaceId: string, title: string, id = randomUUID()): TaskSectionWrite => ({
  kind: TASK_SECTION_WRITE.CREATE,
  id,
  workspaceId,
  title,
});

const place = (taskId: string, sectionId: string | null, position?: string): TaskSectionWrite => ({
  kind: TASK_SECTION_WRITE.PLACE,
  taskId,
  sectionId,
  ...(position === undefined ? undefined : { position }),
});

const placeAgent = (agentId: string, sectionId: string, position: string): TaskSectionWrite => ({
  kind: TASK_SECTION_WRITE.PLACE_AGENT,
  agentId,
  sectionId,
  position,
});

/** Every part's rows in one order, by what keys each, since the host orders them as the held reads do. */
function byKey(rows: SidebarRows): SidebarRows {
  const sorted = <Row>(each: readonly Row[], key: (row: Row) => string) =>
    each.toSorted((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
  return {
    sections: sorted(rows.sections, (row) => row.id),
    entries: sorted(rows.entries, (row) => row.taskId),
    agentEntries: sorted(rows.agentEntries, (row) => row.agentId),
    pins: sorted(rows.pins, (row) => row.repository),
  };
}

/** The sidebar's rows as the host takes them from the live statements, run as the service runs them. */
const liveSidebarOf = (userId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const statements = Option.getOrThrow(sidebarRead.statements({ userId }));
    const rows = yield* Effect.all({
      sections: sql.unsafe(statements.sections.sql, [...statements.sections.params]),
      entries: sql.unsafe(statements.entries.sql, [...statements.entries.params]),
      agentEntries: sql.unsafe(statements.agentEntries.sql, [...statements.agentEntries.params]),
      pins: sql.unsafe(statements.pins.sql, [...statements.pins.params]),
    });
    return byKey(sidebarRowsOfLive(yield* Schema.decodeUnknownEffect(SIDEBAR_READ.rows)(rows)));
  });

it.layer(getTestDB())("the account's sidebar's live read", (it) => {
  it.effect(
    "the live statements deliver the sections, their tasks, and the pins the held reads answer, to their maker, and none of them to a teammate or an outsider",
    () =>
      Effect.gen(function* () {
        const { dean, charles, workspace, first, second } = yield* openSharedWorkspace;
        const outsider = yield* openAccount;
        yield* openWorkspace(outsider);
        const launch = randomUUID();
        const later = randomUUID();
        yield* written(dean, create(workspace, "Launch", launch));
        yield* TestClock.adjust("1 minute");
        yield* written(dean, create(workspace, "Later", later));
        const icon = { kind: TASK_SECTION_ICON_KIND.GLYPH, glyph: TASK_SECTION_GLYPH.ROCKET };
        yield* written(dean, { kind: TASK_SECTION_WRITE.EDIT, id: later, title: "Later", icon });
        yield* written(dean, { kind: TASK_SECTION_WRITE.MOVE, id: later, position: "a0" });
        yield* written(dean, place(first, launch));
        yield* TestClock.adjust("1 minute");
        yield* written(dean, place(second, launch, "a1"));
        yield* written(dean, placeAgent(yield* openAgent(dean, workspace), later, "a0"));
        yield* setRepositoryPin(dean, "acme/relay", true);
        yield* TestClock.adjust("1 minute");
        yield* setRepositoryPin(dean, "acme/web", true);

        for (const reader of [dean, charles, outsider]) {
          const held = yield* listTaskSections(reader);
          assert.deepEqual(
            yield* liveSidebarOf(reader),
            byKey({ ...held, pins: yield* listRepositoryPins(reader) }),
          );
        }
        const deans = yield* liveSidebarOf(dean);
        assert.deepEqual(
          [deans.sections.length, deans.entries.length, deans.agentEntries.length],
          [2, 2, 1],
        );
        assert.deepEqual(
          deans.pins.map((pin) => pin.repository),
          ["acme/relay", "acme/web"],
        );
        assert.deepEqual(yield* liveSidebarOf(outsider), {
          sections: [],
          entries: [],
          agentEntries: [],
          pins: [],
        });
      }),
  );
});
