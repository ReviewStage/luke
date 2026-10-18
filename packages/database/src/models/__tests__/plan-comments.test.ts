import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import {
  PLAN_COMMENT_ACTION,
  PLAN_COMMENT_ACTOR,
  PLAN_COMMENT_BOUNDS,
  PLAN_COMMENT_ENTRY,
  PLAN_COMMENT_REFUSAL,
  PLAN_COMMENT_SCOPE,
  PLAN_COMMENT_STATUS,
  type PlanCommentStartRequest,
  type PlanCommentThread,
} from "@luke/features/plan-comment-wire";
import { Effect, Option } from "effect";
import { Database } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import { getTestDB, joinWorkspace, openWorkspace } from "../../testing/index.js";
import {
  actOnPlanCommentThread,
  movePlanCommentAnchors,
  PLAN_COMMENT_OUTCOME,
  type PlanCommentOutcome,
  type PlanCommentWriterRef,
  readPlanCommentThreads,
  startPlanCommentThread,
} from "../plan-comments.js";
import { createTask, savePlanText } from "../task-store.js";

/**
 * A plan's comment threads over a real dialect: started and read by every
 * member of the plan's workspace and by nobody else, anchored to the words
 * they were started on, carried with those words through every save, left
 * with their quote where the words are deleted and anchored again where the
 * editor's undo reports them back, answered, resolved, and reopened by any
 * member, and a comment edited or deleted only by its writer.
 *
 * Synthetic accounts and plans throughout.
 */

const PLAN_TEXT =
  "## Goal\n\nAn admin invites a teammate by email, and the invite lands as a single-use link that expires in seven days.\n\n## Approach\n\nAdmins can withdraw an invite from the members page. A withdrawn link never grants access again.\n";

const openAccount = (name: string) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const id = `user-${randomUUID()}`;
    yield* db.insert(user).values({ id, name, email: `${id}@luke.test` });
    return id;
  });

/** A plan with the text above, in a workspace the owner made and the teammate joined, and an account in neither. */
const openSharedTask = Effect.gen(function* () {
  const owner = yield* openAccount("Dean Stratakos");
  const teammate = yield* openAccount("Charles Pan");
  const outsider = yield* openAccount("Someone Else");
  const workspace = yield* openWorkspace(owner);
  yield* joinWorkspace(workspace, teammate);
  const { id: taskId } = yield* createTask(owner, { organizationId: workspace, name: "Invites" });
  yield* savePlanText(owner, taskId, PLAN_TEXT);
  return { owner, teammate, outsider, taskId };
});

/** How long the test that writes a thread up to its bound may take. */
const BOUND_TIMEOUT = 60_000;

const member = (userId: string): PlanCommentWriterRef => ({
  actor: PLAN_COMMENT_ACTOR.MEMBER,
  userId,
});

/** A thread started on the first place `words` stands in `text`. */
function startOn(text: string, words: string, comment: string): PlanCommentStartRequest {
  const from = text.indexOf(words);
  assert.ok(from >= 0);
  return {
    clientKey: randomUUID(),
    scope: PLAN_COMMENT_SCOPE.WORDS,
    quote: words,
    anchor: { from, to: from + words.length },
    text,
    words: comment,
  };
}

/** The thread an outcome answered, failing the test where it answered none. */
function threadOf(outcome: PlanCommentOutcome): PlanCommentThread {
  assert.equal(outcome.status, PLAN_COMMENT_OUTCOME.DONE);
  assert.ok("thread" in outcome.answer, JSON.stringify(outcome.answer));
  return outcome.answer.thread;
}

/** The words a thread's anchor stands over in the text, or nothing where it stands nowhere. */
function anchoredIn(text: string, thread: PlanCommentThread | undefined): string | undefined {
  return thread?.anchor === undefined
    ? undefined
    : text.slice(thread.anchor.from, thread.anchor.to);
}

const readOne = (userId: string, taskId: string) =>
  Effect.map(readPlanCommentThreads(userId, taskId), (threads) => Option.getOrThrow(threads)[0]);

it.layer(getTestDB())("a plan's comment threads", (it) => {
  it.effect(
    "a thread a teammate started reads for every member, naming its writer, and as no plan for anyone else",
    () =>
      Effect.gen(function* () {
        const { owner, teammate, outsider, taskId } = yield* openSharedTask;

        const started = threadOf(
          yield* startPlanCommentThread(
            member(teammate),
            taskId,
            startOn(PLAN_TEXT, "seven days", "Should this be a setting?"),
          ),
        );

        const read = yield* readOne(owner, taskId);
        assert.equal(read?.id, started.id);
        assert.equal(anchoredIn(PLAN_TEXT, read), "seven days");
        assert.equal(read?.section, "Goal");
        assert.equal(read?.status, PLAN_COMMENT_STATUS.OPEN);
        assert.deepEqual(
          read?.entries.map((entry) => [entry.kind, entry.writer.by?.name, entry.words]),
          [[PLAN_COMMENT_ENTRY.COMMENT, "Charles Pan", "Should this be a setting?"]],
        );
        assert.ok(Option.isNone(yield* readPlanCommentThreads(outsider, taskId)));
        assert.equal(
          (yield* startPlanCommentThread(
            member(outsider),
            taskId,
            startOn(PLAN_TEXT, "teammate", "Hi"),
          )).status,
          PLAN_COMMENT_OUTCOME.NO_TASK,
        );
      }),
  );

  it.effect(
    "a thread started over words not yet saved lands on the same words in the saved text",
    () =>
      Effect.gen(function* () {
        const { owner, taskId } = yield* openSharedTask;
        const unsaved = PLAN_TEXT.replace(
          "## Goal\n\n",
          "## Goal\n\nInvites replace the admin-only flow.\n\n",
        );

        const started = threadOf(
          yield* startPlanCommentThread(
            member(owner),
            taskId,
            startOn(unsaved, "single-use link", "Why single use?"),
          ),
        );

        assert.equal(anchoredIn(PLAN_TEXT, started), "single-use link");
      }),
  );

  it.effect("a thread sent again under its key is started once", () =>
    Effect.gen(function* () {
      const { owner, taskId } = yield* openSharedTask;
      const request = startOn(PLAN_TEXT, "teammate", "Or a guest?");

      const first = threadOf(yield* startPlanCommentThread(member(owner), taskId, request));
      const again = threadOf(yield* startPlanCommentThread(member(owner), taskId, request));

      assert.equal(again.id, first.id);
      assert.equal(Option.getOrThrow(yield* readPlanCommentThreads(owner, taskId)).length, 1);
    }),
  );

  it.effect("an anchor naming no words of the text it was measured in is refused", () =>
    Effect.gen(function* () {
      const { owner, taskId } = yield* openSharedTask;

      const outcome = yield* startPlanCommentThread(member(owner), taskId, {
        ...startOn(PLAN_TEXT, "teammate", "Hm"),
        anchor: { from: 5, to: 5 },
      });

      assert.deepEqual(outcome, {
        status: PLAN_COMMENT_OUTCOME.DONE,
        answer: { refused: PLAN_COMMENT_REFUSAL.NO_WORDS },
      });
    }),
  );

  it.effect(
    "a save carries the anchor with its words, a save deleting them leaves the thread its quote, and the editor's undo anchors it again",
    () =>
      Effect.gen(function* () {
        const { owner, taskId } = yield* openSharedTask;
        const words = "Admins can withdraw an invite from the members page.";
        const started = threadOf(
          yield* startPlanCommentThread(member(owner), taskId, startOn(PLAN_TEXT, words, "In v1?")),
        );

        const moved = PLAN_TEXT.replace(
          "## Goal\n\n",
          "## Context\n\nOnly admins add people.\n\n## Goal\n\n",
        );
        yield* movePlanCommentAnchors(taskId, PLAN_TEXT, moved);
        assert.equal(anchoredIn(moved, yield* readOne(owner, taskId)), words);

        const deleted = moved.replace(`${words} `, "");
        yield* movePlanCommentAnchors(taskId, moved, deleted, {
          text: deleted,
          anchors: { anchors: [], carried: [started.id] },
        });
        const gone = yield* readOne(owner, taskId);
        assert.equal(gone?.anchor, undefined);
        assert.equal(gone?.quote, words);
        assert.equal(gone?.section, "Approach");
        assert.equal(gone?.status, PLAN_COMMENT_STATUS.OPEN);

        // Note that a save carrying the text alone never finds the words again, however they come back.
        yield* movePlanCommentAnchors(taskId, deleted, moved);
        assert.equal((yield* readOne(owner, taskId))?.anchor, undefined);

        const from = moved.indexOf(words);
        yield* movePlanCommentAnchors(taskId, moved, moved, {
          text: moved,
          anchors: {
            anchors: [{ thread: started.id, from, to: from + words.length }],
            carried: [started.id],
          },
        });
        assert.equal(anchoredIn(moved, yield* readOne(owner, taskId)), words);
      }),
  );

  it.effect(
    "any member resolves and reopens a thread, each said in it, and only a comment's writer edits or deletes it",
    () =>
      Effect.gen(function* () {
        const { owner, teammate, taskId } = yield* openSharedTask;
        const started = threadOf(
          yield* startPlanCommentThread(
            member(teammate),
            taskId,
            startOn(PLAN_TEXT, "email", "Or a link?"),
          ),
        );
        const [comment] = started.entries;
        assert.ok(comment);

        const replied = threadOf(
          yield* actOnPlanCommentThread(member(owner), taskId, started.id, {
            action: PLAN_COMMENT_ACTION.REPLY,
            clientKey: randomUUID(),
            words: "Email, for v1.",
          }),
        );
        const resolved = threadOf(
          yield* actOnPlanCommentThread(member(owner), taskId, started.id, {
            action: PLAN_COMMENT_ACTION.RESOLVE,
          }),
        );
        const reopened = threadOf(
          yield* actOnPlanCommentThread(member(teammate), taskId, started.id, {
            action: PLAN_COMMENT_ACTION.REOPEN,
          }),
        );

        assert.equal(replied.entries.length, 2);
        assert.equal(resolved.status, PLAN_COMMENT_STATUS.RESOLVED);
        assert.equal(reopened.status, PLAN_COMMENT_STATUS.OPEN);
        assert.deepEqual(
          reopened.entries.map((entry) => [entry.kind, entry.writer.by?.name]),
          [
            [PLAN_COMMENT_ENTRY.COMMENT, "Charles Pan"],
            [PLAN_COMMENT_ENTRY.COMMENT, "Dean Stratakos"],
            [PLAN_COMMENT_ENTRY.RESOLVED, "Dean Stratakos"],
            [PLAN_COMMENT_ENTRY.REOPENED, "Charles Pan"],
          ],
        );
        assert.deepEqual(
          yield* actOnPlanCommentThread(member(owner), taskId, started.id, {
            action: PLAN_COMMENT_ACTION.EDIT,
            entry: comment.id,
            words: "Mine now",
          }),
          {
            status: PLAN_COMMENT_OUTCOME.DONE,
            answer: { refused: PLAN_COMMENT_REFUSAL.NOT_YOURS },
          },
        );
        const edited = threadOf(
          yield* actOnPlanCommentThread(member(teammate), taskId, started.id, {
            action: PLAN_COMMENT_ACTION.EDIT,
            entry: comment.id,
            words: "Or a link, too?",
          }),
        );
        assert.equal(edited.entries[0]?.words, "Or a link, too?");
        assert.ok(edited.entries[0]?.editedAt !== undefined);
      }),
  );

  it.effect(
    "a heading renamed over an anchor that did not move names the thread's new section",
    () =>
      Effect.gen(function* () {
        const { owner, taskId } = yield* openSharedTask;
        yield* startPlanCommentThread(
          member(owner),
          taskId,
          startOn(PLAN_TEXT, "seven days", "Why?"),
        );
        const renamed = PLAN_TEXT.replace("## Goal", "## Plan");

        yield* movePlanCommentAnchors(taskId, PLAN_TEXT, renamed);

        const read = yield* readOne(owner, taskId);
        assert.equal(read?.section, "Plan");
        assert.equal(anchoredIn(renamed, read), "seven days");
      }),
  );

  it.effect(
    "a reply under a key another thread was written under is refused, and the thread is unchanged",
    () =>
      Effect.gen(function* () {
        const { owner, taskId } = yield* openSharedTask;
        const first = threadOf(
          yield* startPlanCommentThread(member(owner), taskId, startOn(PLAN_TEXT, "email", "One")),
        );
        const second = threadOf(
          yield* startPlanCommentThread(member(owner), taskId, startOn(PLAN_TEXT, "invite", "Two")),
        );
        const clientKey = randomUUID();
        const reply = { action: PLAN_COMMENT_ACTION.REPLY, clientKey, words: "Again" } as const;
        yield* actOnPlanCommentThread(member(owner), taskId, first.id, reply);

        assert.deepEqual(yield* actOnPlanCommentThread(member(owner), taskId, second.id, reply), {
          status: PLAN_COMMENT_OUTCOME.DONE,
          answer: { refused: PLAN_COMMENT_REFUSAL.KEY_TAKEN },
        });
        assert.equal(
          threadOf(yield* actOnPlanCommentThread(member(owner), taskId, first.id, reply)).entries
            .length,
          2,
        );
      }),
  );

  it.effect(
    "resolving and reopening past the bound still settles the thread, and says no more lines of it",
    () =>
      Effect.gen(function* () {
        const { owner, taskId } = yield* openSharedTask;
        const started = threadOf(
          yield* startPlanCommentThread(
            member(owner),
            taskId,
            startOn(PLAN_TEXT, "email", "Toggle"),
          ),
        );
        let last = started;
        for (let turn = 0; turn < PLAN_COMMENT_BOUNDS.MAX_ENTRIES_PER_THREAD + 2; turn += 1) {
          const action = turn % 2 === 0 ? PLAN_COMMENT_ACTION.RESOLVE : PLAN_COMMENT_ACTION.REOPEN;
          last = threadOf(
            yield* actOnPlanCommentThread(member(owner), taskId, started.id, { action }),
          );
        }

        assert.equal(last.status, PLAN_COMMENT_STATUS.OPEN);
        assert.equal(last.entries.length, PLAN_COMMENT_BOUNDS.MAX_ENTRIES_PER_THREAD + 1);
        const replied = yield* actOnPlanCommentThread(member(owner), taskId, started.id, {
          action: PLAN_COMMENT_ACTION.REPLY,
          clientKey: randomUUID(),
          words: "Still taken",
        });
        assert.equal(threadOf(replied).entries.at(-1)?.words, "Still taken");
      }),
    // Note that the bound is two hundred writes, which outlasts the default timeout on a loaded machine.
    BOUND_TIMEOUT,
  );

  it.effect("deleting a thread's first comment, or the thread, deletes the thread", () =>
    Effect.gen(function* () {
      const { owner, teammate, taskId } = yield* openSharedTask;
      const first = threadOf(
        yield* startPlanCommentThread(member(teammate), taskId, startOn(PLAN_TEXT, "email", "One")),
      );
      const second = threadOf(
        yield* startPlanCommentThread(
          member(teammate),
          taskId,
          startOn(PLAN_TEXT, "invite", "Two"),
        ),
      );
      const [comment] = first.entries;
      assert.ok(comment);

      assert.deepEqual(
        yield* actOnPlanCommentThread(member(teammate), taskId, first.id, {
          action: PLAN_COMMENT_ACTION.DELETE,
          entry: comment.id,
        }),
        { status: PLAN_COMMENT_OUTCOME.DONE, answer: { deleted: first.id } },
      );
      assert.deepEqual(
        yield* actOnPlanCommentThread(member(owner), taskId, second.id, {
          action: PLAN_COMMENT_ACTION.DELETE_THREAD,
        }),
        { status: PLAN_COMMENT_OUTCOME.DONE, answer: { deleted: second.id } },
      );
      assert.deepEqual(Option.getOrThrow(yield* readPlanCommentThreads(owner, taskId)), []);
      assert.equal(
        (yield* actOnPlanCommentThread(member(owner), taskId, second.id, {
          action: PLAN_COMMENT_ACTION.RESOLVE,
        })).status,
        PLAN_COMMENT_OUTCOME.NO_THREAD,
      );
    }),
  );
});
