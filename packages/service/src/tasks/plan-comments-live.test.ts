import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import type { LiveStatement } from "@repo/database/core/live-statement";
import { Database } from "@repo/database/core/query";
import { createAgent } from "@repo/database/models/agent-store";
import {
  actOnPlanCommentThread,
  PLAN_COMMENT_OUTCOME,
  type PlanCommentOutcome,
  type PlanCommentWriterRef,
  readPlanCommentThreads,
  startPlanCommentThread,
} from "@repo/database/models/plan-comments";
import { writePage } from "@repo/database/models/plan-pages";
import { createTask, savePlanText } from "@repo/database/models/task-store";
import { user } from "@repo/database/schemas/auth";
import { CONVERSATION_RUNTIME } from "@repo/database/storage-vocabulary";
import { getTestDB, joinWorkspace, openWorkspace } from "@repo/database/testing";
import { AGENT_ATTACHMENT_TYPE } from "@repo/features/agent-wire";
import { PAGE_SHOWER, taskPageOwner } from "@repo/features/page-wire";
import { taskCommentsLiveRowsSchema, threadsOfLiveRows } from "@repo/features/plan-comment-live";
import {
  PLAN_COMMENT_ACTION,
  PLAN_COMMENT_ACTOR,
  PLAN_COMMENT_SCOPE,
  type PlanCommentThread,
} from "@repo/features/plan-comment-wire";
import { Duration, Effect, Option, Schema } from "effect";
import { SqlClient } from "effect/sql";
import { TestClock } from "effect/testing";
import { type TaskCommentsSubject, taskCommentsLiveStatements } from "./plan-comments-live.js";

/**
 * One subject of a task's comments as Realtime would deliver it, over the
 * real migrations on PGlite: the statements run as Realtime runs them,
 * their rows decoded and joined as the desktop does, beside
 * `readPlanCommentThreads`, the held read a surface read them with. The two
 * agree for the plan's own threads and for a page's, as threads are
 * started, answered by a member and an agent, sent to the app, edited,
 * resolved, reopened, and deleted, files among them, and for an account
 * that does not reach the task.
 *
 * Synthetic accounts, tasks, and words throughout.
 */

const PLAN_TEXT =
  "## Goal\n\nAn admin invites a teammate by email, and the invite lands as a single-use link that expires in seven days.\n";

/** A new account under `name`, as the store holds one. */
const openAccount = (name: string) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const id = `user-${randomUUID()}`;
    yield* db.insert(user).values({ id, name, email: `${id}@app.test` });
    return id;
  });

const member = (userId: string): PlanCommentWriterRef => ({
  actor: PLAN_COMMENT_ACTOR.MEMBER,
  userId,
});

/** The thread an outcome answered, failing the test where it answered none. */
function threadOf(outcome: PlanCommentOutcome): PlanCommentThread {
  assert.ok(
    outcome.status === PLAN_COMMENT_OUTCOME.DONE && "thread" in outcome.answer,
    JSON.stringify(outcome),
  );
  return outcome.answer.thread;
}

/** The statement run as Realtime runs it. */
const runLive = (statement: LiveStatement) =>
  Effect.flatMap(SqlClient.SqlClient, (sql) => sql.unsafe(statement.sql, [...statement.params]));

/** One subject's threads as Realtime would deliver them to `reader`, as the desktop reads them. */
const liveThreadsOf = (reader: string, subject: TaskCommentsSubject) =>
  Effect.gen(function* () {
    const statements = Option.getOrThrow(taskCommentsLiveStatements(reader, subject));
    const rows = yield* Schema.decodeUnknownEffect(taskCommentsLiveRowsSchema)({
      threads: yield* runLive(statements.threads),
      entries: yield* runLive(statements.entries),
      files: yield* runLive(statements.files),
    });
    return threadsOfLiveRows(rows);
  });

it.layer(getTestDB())("a task's comments followed live", (it) => {
  it.effect(
    "answers what readPlanCommentThreads answers for a plan and for a page as threads are started, replied to, resolved, edited and deleted, files among them, and nothing to a stranger",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount("Dean Stratakos");
        const teammate = yield* openAccount("Charles Pan");
        const stranger = yield* openAccount("Someone Else");
        const workspace = yield* openWorkspace(owner);
        yield* joinWorkspace(workspace, teammate);
        const { id: taskId } = yield* createTask(owner, {
          organizationId: workspace,
          name: "Invites",
        });
        yield* savePlanText(owner, taskId, PLAN_TEXT);
        const page = (write: { readonly pageId?: string; readonly html: string }) =>
          Effect.map(
            writePage(
              owner,
              taskPageOwner(taskId),
              { title: "Invite funnel", ...write },
              { kind: PAGE_SHOWER.APP },
            ),
            Option.getOrThrow,
          );
        const shown = yield* page({ html: "<h1>Invites</h1><p>12 sent</p>" });
        const onPlan = { taskId };
        const onPage = { taskId, pageId: shown.id };
        const agrees = (subject: TaskCommentsSubject) =>
          Effect.gen(function* () {
            const held = Option.getOrThrow(
              yield* readPlanCommentThreads(owner, taskId, subject.pageId),
            );
            assert.deepEqual(yield* liveThreadsOf(owner, subject), held);
            return held;
          });
        const later = TestClock.adjust(Duration.minutes(1));

        assert.deepEqual(yield* agrees(onPlan), []);
        assert.deepEqual(yield* agrees(onPage), []);

        const from = PLAN_TEXT.indexOf("seven days");
        const started = threadOf(
          yield* startPlanCommentThread(member(teammate), taskId, {
            clientKey: randomUUID(),
            scope: PLAN_COMMENT_SCOPE.WORDS,
            quote: "seven days",
            anchor: { from, to: from + "seven days".length },
            text: PLAN_TEXT,
            words: "See the attached.",
            attachments: [
              {
                name: "expiry.txt",
                mediaType: AGENT_ATTACHMENT_TYPE.TEXT,
                data: Buffer.from("expiry: 7 days\n").toString("base64"),
              },
              {
                name: "flow.pdf",
                mediaType: AGENT_ATTACHMENT_TYPE.PDF,
                data: Buffer.from("%PDF-1.4\n").toString("base64"),
              },
            ],
          }),
        );
        // Note that these start in the millisecond the plan's thread did, so the threads are ordered by their ids.
        const onElement = threadOf(
          yield* startPlanCommentThread(member(teammate), taskId, {
            clientKey: randomUUID(),
            page: { id: shown.id, version: 1 },
            element: { path: "body > p:nth-of-type(1)", quote: "12 sent", section: "Invites" },
            words: "Is this a week's worth?",
          }),
        );
        yield* startPlanCommentThread(member(owner), taskId, {
          clientKey: randomUUID(),
          page: { id: shown.id, version: 1 },
          words: "Add a chart.",
        });
        yield* later;
        yield* page({ pageId: shown.id, html: "<h1>Invites</h1><p>14 sent</p>" });
        yield* startPlanCommentThread(member(owner), taskId, {
          clientKey: randomUUID(),
          page: { id: shown.id, version: 2 },
          words: "Better.",
        });
        const agent = yield* createAgent(owner, {
          taskId,
          idempotencyKey: randomUUID(),
          model: "anthropic/claude-opus-5.5",
          effort: "high",
          planSnapshot: "# Invites",
          prompt: null,
          repository: "acme/relay",
          runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
        });
        yield* later;
        const reply = threadOf(
          yield* actOnPlanCommentThread(member(owner), taskId, started.id, {
            action: PLAN_COMMENT_ACTION.REPLY,
            clientKey: randomUUID(),
            words: "No files here.",
          }),
        ).entries.at(-1);
        yield* actOnPlanCommentThread(
          {
            actor: PLAN_COMMENT_ACTOR.AGENT,
            userId: owner,
            agentId: Option.getOrThrow(agent).agent.id,
          },
          taskId,
          started.id,
          { action: PLAN_COMMENT_ACTION.REPLY, clientKey: randomUUID(), words: "Seven it is." },
        );
        yield* actOnPlanCommentThread(member(owner), taskId, started.id, {
          action: PLAN_COMMENT_ACTION.ASK,
          clientKey: randomUUID(),
          to: { actor: PLAN_COMMENT_ACTOR.APP },
        });
        yield* actOnPlanCommentThread(member(teammate), taskId, onElement.id, {
          action: PLAN_COMMENT_ACTION.RESOLVE,
        });
        const written = yield* agrees(onPlan);
        assert.equal(written.length, 1);
        assert.equal(written[0]?.entries[0]?.files?.length, 2);
        assert.equal((yield* agrees(onPage)).length, 3);

        yield* later;
        assert.ok(reply !== undefined);
        yield* actOnPlanCommentThread(member(owner), taskId, started.id, {
          action: PLAN_COMMENT_ACTION.EDIT,
          entry: reply.id,
          words: "Still no files.",
        });
        yield* actOnPlanCommentThread(member(owner), taskId, started.id, {
          action: PLAN_COMMENT_ACTION.RESOLVE,
        });
        yield* actOnPlanCommentThread(member(owner), taskId, started.id, {
          action: PLAN_COMMENT_ACTION.REOPEN,
        });
        yield* actOnPlanCommentThread(member(owner), taskId, started.id, {
          action: PLAN_COMMENT_ACTION.DELETE,
          entry: reply.id,
        });
        yield* actOnPlanCommentThread(member(teammate), taskId, onElement.id, {
          action: PLAN_COMMENT_ACTION.DELETE_THREAD,
        });
        assert.equal((yield* agrees(onPlan))[0]?.entries.length, 5);
        assert.equal((yield* agrees(onPage)).length, 2);

        assert.deepEqual(yield* liveThreadsOf(stranger, onPlan), []);
        assert.deepEqual(yield* liveThreadsOf(stranger, onPage), []);
      }),
  );
});
