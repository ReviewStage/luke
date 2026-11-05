import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import { startPlanCommentThread } from "@repo/database/models/plan-comments";
import { writePage } from "@repo/database/models/plan-pages";
import { createTask, savePlanText } from "@repo/database/models/task-store";
import { user } from "@repo/database/schemas/auth";
import { getTestDB, joinWorkspace, openWorkspace } from "@repo/database/testing";
import { PAGE_SHOWER, taskPageOwner } from "@repo/features/page-wire";
import {
  PLAN_COMMENT_ACTOR,
  PLAN_COMMENT_SCOPE,
  PLAN_COMMENT_STATUS,
  type PlanCommentThread,
} from "@repo/features/plan-comment-wire";
import { unparsedWire } from "@repo/wire";
import { Effect, Option } from "effect";
import { AGENT_TOOL } from "../agents/agent-runtime/tools.js";
import { ACTION_RESULT_STATUS } from "../core.js";
import {
  COMMENT_TOOL_REFUSAL,
  OPEN_THREADS_MARKER,
  openThreadsText,
  runCommentTool,
} from "./comment-tools.js";

/**
 * The coding agents' comment tools, over a real dialect: the open threads
 * read with what they are on and every comment by its writer, a reply
 * written under its writer beside a teammate's, a resolved thread read only
 * when asked for and taking no reply until reopened, a thread of another
 * plan named as none, a page's threads read by naming the page, and the
 * open threads handed to an agent as one line each. Synthetic accounts and
 * plans.
 */

const PLAN_TEXT = "## Approach\n\nAdmins can withdraw an invite from the members page.\n";
const WORDS = "withdraw an invite";

const openAccount = (name: string) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const id = `user-${randomUUID()}`;
    yield* db.insert(user).values({ id, name, email: `${id}@app.test` });
    return id;
  });

/** A plan with one thread a teammate started, in a workspace the owner made and the teammate joined. */
const openThreadedTask = Effect.gen(function* () {
  const owner = yield* openAccount("Dean Stratakos");
  const teammate = yield* openAccount("Charles Pan");
  const workspace = yield* openWorkspace(owner);
  yield* joinWorkspace(workspace, teammate);
  const { id: taskId } = yield* createTask(owner, { organizationId: workspace, name: "Invites" });
  yield* savePlanText(owner, taskId, PLAN_TEXT);
  const from = PLAN_TEXT.indexOf(WORDS);
  const started = yield* startPlanCommentThread(
    { actor: PLAN_COMMENT_ACTOR.MEMBER, userId: teammate },
    taskId,
    {
      clientKey: randomUUID(),
      scope: PLAN_COMMENT_SCOPE.WORDS,
      quote: WORDS,
      anchor: { from, to: from + WORDS.length },
      text: PLAN_TEXT,
      words: "Is this in v1?",
    },
  );
  assert.ok("answer" in started && "thread" in started.answer);
  return { owner, taskId, thread: started.answer.thread };
});

/** A call made as the owner, with Plans on unless said. */
const asOwner = (owner: string, taskId: string, plansOn = true) => ({
  taskId,
  writer: { actor: PLAN_COMMENT_ACTOR.MEMBER, userId: owner } as const,
  plansOn,
});

it.layer(getTestDB())("the comment tools", (it) => {
  it.effect(
    "the open threads read with their words and comments, a reply written as its writer's, and a resolved thread read only when asked for",
    () =>
      Effect.gen(function* () {
        const { owner, taskId, thread } = yield* openThreadedTask;
        const writer = asOwner(owner, taskId);

        const replied = yield* runCommentTool(
          AGENT_TOOL.REPLY_TO_COMMENT,
          writer,
          unparsedWire({
            taskId,
            thread: thread.id,
            words: "Not in v1; the page does not exist yet.",
          }),
        );
        const read = yield* runCommentTool(
          AGENT_TOOL.READ_COMMENTS,
          writer,
          unparsedWire({ taskId }),
        );
        yield* runCommentTool(
          AGENT_TOOL.UPDATE_COMMENT,
          writer,
          unparsedWire({ taskId, thread: thread.id, resolved: true }),
        );
        const openAfter = yield* runCommentTool(
          AGENT_TOOL.READ_COMMENTS,
          writer,
          unparsedWire({ taskId }),
        );
        const resolved = yield* runCommentTool(
          AGENT_TOOL.READ_COMMENTS,
          writer,
          unparsedWire({ taskId, status: PLAN_COMMENT_STATUS.RESOLVED }),
        );

        assert.equal(replied.status, ACTION_RESULT_STATUS.ACCEPTED);
        assert.deepEqual(read, {
          status: ACTION_RESULT_STATUS.ACCEPTED,
          threads: [
            {
              thread: thread.id,
              state: PLAN_COMMENT_STATUS.OPEN,
              section: "Approach",
              on: WORDS,
              comments: [
                { by: "Charles Pan", at: new Date(0).toISOString(), words: "Is this in v1?" },
                {
                  by: "Dean Stratakos",
                  at: new Date(0).toISOString(),
                  words: "Not in v1; the page does not exist yet.",
                },
              ],
            },
          ],
        });
        assert.deepEqual(openAfter, { status: ACTION_RESULT_STATUS.ACCEPTED, threads: [] });
        assert.ok(
          "threads" in resolved && Array.isArray(resolved.threads) && resolved.threads.length === 1,
        );
      }),
  );

  it.effect(
    "a page's threads are read by naming the page, each with its version and element, and a resolved one takes no reply; with Plans off the page's alone are reached",
    () =>
      Effect.gen(function* () {
        const { owner, taskId, thread } = yield* openThreadedTask;
        const writer = asOwner(owner, taskId);
        const page = Option.getOrThrow(
          yield* writePage(
            owner,
            taskPageOwner(taskId),
            { title: "Invite funnel", html: "<p>12 sent</p>" },
            { kind: PAGE_SHOWER.APP },
          ),
        );
        const started = yield* startPlanCommentThread(writer.writer, taskId, {
          clientKey: randomUUID(),
          page: { id: page.id, version: 1 },
          element: { path: "body > p", quote: "12 sent", section: "" },
          words: "Per week?",
        });
        assert.ok("answer" in started && "thread" in started.answer);

        const onPage = yield* runCommentTool(
          AGENT_TOOL.READ_COMMENTS,
          writer,
          unparsedWire({ taskId, page: page.id }),
        );
        const onPlan = yield* runCommentTool(
          AGENT_TOOL.READ_COMMENTS,
          writer,
          unparsedWire({ taskId }),
        );

        assert.deepEqual(
          "threads" in onPage && Array.isArray(onPage.threads)
            ? onPage.threads.map((each) => [each.thread, each.on, each.page])
            : onPage,
          [[started.answer.thread.id, "12 sent", { id: page.id, version: 1, element: "body > p" }]],
        );
        assert.deepEqual(
          "threads" in onPlan && Array.isArray(onPlan.threads)
            ? onPlan.threads.map((each) => each.thread)
            : onPlan,
          [thread.id],
        );

        const plansOff = asOwner(owner, taskId, false);
        const offRefused = {
          status: ACTION_RESULT_STATUS.REJECTED,
          reason: COMMENT_TOOL_REFUSAL.PLANS_OFF,
        };
        assert.deepEqual(
          yield* runCommentTool(AGENT_TOOL.READ_COMMENTS, plansOff, unparsedWire({ taskId })),
          offRefused,
        );
        assert.deepEqual(
          yield* runCommentTool(
            AGENT_TOOL.REPLY_TO_COMMENT,
            plansOff,
            unparsedWire({ taskId, thread: thread.id, words: "Not in v1." }),
          ),
          offRefused,
        );
        assert.deepEqual(
          yield* runCommentTool(
            AGENT_TOOL.UPDATE_COMMENT,
            plansOff,
            unparsedWire({ taskId, thread: thread.id, resolved: true }),
          ),
          offRefused,
        );
        assert.deepEqual(
          yield* runCommentTool(
            AGENT_TOOL.READ_COMMENTS,
            plansOff,
            unparsedWire({ taskId, page: page.id }),
          ),
          onPage,
        );

        const onThread = { taskId, thread: started.answer.thread.id };
        const resolvedOff = yield* runCommentTool(
          AGENT_TOOL.UPDATE_COMMENT,
          plansOff,
          unparsedWire({ ...onThread, resolved: true }),
        );
        assert.equal(resolvedOff.status, ACTION_RESULT_STATUS.ACCEPTED);
        assert.deepEqual(
          yield* runCommentTool(
            AGENT_TOOL.REPLY_TO_COMMENT,
            writer,
            unparsedWire({ ...onThread, words: "Per week." }),
          ),
          { status: ACTION_RESULT_STATUS.REJECTED, reason: COMMENT_TOOL_REFUSAL.RESOLVED },
        );
      }),
  );

  it.effect(
    "a resolved thread takes no reply until it is reopened, and a thread of another plan reads as none",
    () =>
      Effect.gen(function* () {
        const { owner, taskId, thread } = yield* openThreadedTask;
        const other = yield* openThreadedTask;
        const writer = asOwner(owner, taskId);
        yield* runCommentTool(
          AGENT_TOOL.UPDATE_COMMENT,
          writer,
          unparsedWire({ taskId, thread: thread.id, resolved: true }),
        );

        const refused = yield* runCommentTool(
          AGENT_TOOL.REPLY_TO_COMMENT,
          writer,
          unparsedWire({ taskId, thread: thread.id, words: "Still here." }),
        );
        yield* runCommentTool(
          AGENT_TOOL.UPDATE_COMMENT,
          writer,
          unparsedWire({ taskId, thread: thread.id, resolved: false }),
        );
        const taken = yield* runCommentTool(
          AGENT_TOOL.REPLY_TO_COMMENT,
          writer,
          unparsedWire({ taskId, thread: thread.id, words: "Still here." }),
        );
        const elsewhere = yield* runCommentTool(
          AGENT_TOOL.UPDATE_COMMENT,
          writer,
          unparsedWire({ taskId, thread: other.thread.id, resolved: true }),
        );

        assert.equal(refused.status, ACTION_RESULT_STATUS.REJECTED);
        assert.equal(taken.status, ACTION_RESULT_STATUS.ACCEPTED);
        assert.equal(elsewhere.status, ACTION_RESULT_STATUS.REJECTED);
      }),
  );
});

it("the open threads are handed to an agent as one line each behind their marker, and nothing where none is open", () => {
  const thread: PlanCommentThread = {
    id: "0f9b5f6e-6a8e-4c51-9a0e-2c1f2f0b7a11",
    scope: PLAN_COMMENT_SCOPE.WORDS,
    quote: WORDS,
    section: "Approach",
    status: PLAN_COMMENT_STATUS.OPEN,
    entries: [],
    createdAt: 1,
    updatedAt: 1,
    revision: 1,
  };

  const [marker, line] = openThreadsText([
    thread,
    { ...thread, id: "x", status: PLAN_COMMENT_STATUS.RESOLVED },
  ]);

  assert.equal(marker, OPEN_THREADS_MARKER);
  assert.deepEqual(JSON.parse(line ?? ""), {
    thread: thread.id,
    state: PLAN_COMMENT_STATUS.OPEN,
    section: "Approach",
    on: WORDS,
    onWordsDeleted: true,
    comments: [],
  });
  assert.deepEqual(openThreadsText([{ ...thread, status: PLAN_COMMENT_STATUS.RESOLVED }]), []);
});
