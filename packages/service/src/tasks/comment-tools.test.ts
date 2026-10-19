import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { startPlanCommentThread } from "@luke/database/models/plan-comments";
import { createTask, savePlanText } from "@luke/database/models/task-store";
import { user } from "@luke/database/schemas/auth";
import { getTestDB, joinWorkspace, openWorkspace } from "@luke/database/testing";
import {
  PLAN_COMMENT_ACTOR,
  PLAN_COMMENT_SCOPE,
  PLAN_COMMENT_STATUS,
  type PlanCommentThread,
} from "@luke/features/plan-comment-wire";
import { unparsedWire } from "@luke/wire";
import { Effect } from "effect";
import { AGENT_TOOL } from "../agents/agent-runtime/tools.js";
import { ACTION_RESULT_STATUS } from "../core.js";
import { OPEN_THREADS_MARKER, openThreadsText, runCommentTool } from "./comment-tools.js";

/**
 * The comment tools Luke and the coding agents share, over a real dialect:
 * the open threads read with what they are on and every comment by its
 * writer, a reply written under Luke beside a teammate's, a resolved thread
 * read only when asked for and taking no reply until reopened, a thread of
 * another plan named as none, and the open threads handed to Luke as one
 * line each. Synthetic accounts and plans.
 */

const PLAN_TEXT = "## Approach\n\nAdmins can withdraw an invite from the members page.\n";
const WORDS = "withdraw an invite";

const openAccount = (name: string) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const id = `user-${randomUUID()}`;
    yield* db.insert(user).values({ id, name, email: `${id}@luke.test` });
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

/** A call made as Luke on the owner's turn. */
const asLuke = (owner: string, taskId: string) => ({
  taskId,
  writer: { actor: PLAN_COMMENT_ACTOR.LUKE, userId: owner } as const,
});

it.layer(getTestDB())("the comment tools", (it) => {
  it.effect(
    "the open threads read with their words and comments, Luke's reply written as his, and a resolved thread read only when asked for",
    () =>
      Effect.gen(function* () {
        const { owner, taskId, thread } = yield* openThreadedTask;
        const luke = asLuke(owner, taskId);

        const replied = yield* runCommentTool(
          AGENT_TOOL.REPLY_TO_COMMENT,
          luke,
          unparsedWire({ thread: thread.id, words: "Not in v1; the page does not exist yet." }),
        );
        const read = yield* runCommentTool(AGENT_TOOL.READ_COMMENTS, luke, unparsedWire({}));
        yield* runCommentTool(AGENT_TOOL.RESOLVE_THREAD, luke, unparsedWire({ thread: thread.id }));
        const openAfter = yield* runCommentTool(AGENT_TOOL.READ_COMMENTS, luke, unparsedWire({}));
        const resolved = yield* runCommentTool(
          AGENT_TOOL.READ_COMMENTS,
          luke,
          unparsedWire({ status: PLAN_COMMENT_STATUS.RESOLVED }),
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
                  by: "Luke",
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
    "a resolved thread takes no reply until it is reopened, and a thread of another plan reads as none",
    () =>
      Effect.gen(function* () {
        const { owner, taskId, thread } = yield* openThreadedTask;
        const other = yield* openThreadedTask;
        const luke = asLuke(owner, taskId);
        yield* runCommentTool(AGENT_TOOL.RESOLVE_THREAD, luke, unparsedWire({ thread: thread.id }));

        const refused = yield* runCommentTool(
          AGENT_TOOL.REPLY_TO_COMMENT,
          luke,
          unparsedWire({ thread: thread.id, words: "Still here." }),
        );
        yield* runCommentTool(AGENT_TOOL.REOPEN_THREAD, luke, unparsedWire({ thread: thread.id }));
        const taken = yield* runCommentTool(
          AGENT_TOOL.REPLY_TO_COMMENT,
          luke,
          unparsedWire({ thread: thread.id, words: "Still here." }),
        );
        const elsewhere = yield* runCommentTool(
          AGENT_TOOL.RESOLVE_THREAD,
          luke,
          unparsedWire({ thread: other.thread.id }),
        );

        assert.equal(refused.status, ACTION_RESULT_STATUS.REJECTED);
        assert.equal(taken.status, ACTION_RESULT_STATUS.ACCEPTED);
        assert.equal(elsewhere.status, ACTION_RESULT_STATUS.REJECTED);
      }),
  );
});

it("the open threads are handed to Luke as one line each behind their marker, and nothing where none is open", () => {
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
