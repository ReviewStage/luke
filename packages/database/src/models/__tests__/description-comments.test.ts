import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { AGENT_ATTACHMENT_TYPE } from "@repo/features/agent-wire";
import {
  DESCRIPTION_COMMENT_ACTION,
  DESCRIPTION_COMMENT_ACTOR,
  DESCRIPTION_COMMENT_BOUNDS,
  DESCRIPTION_COMMENT_ENTRY,
  DESCRIPTION_COMMENT_REFUSAL,
  DESCRIPTION_COMMENT_SCOPE,
  DESCRIPTION_COMMENT_STATUS,
  type DescriptionCommentStartRequest,
  type DescriptionCommentThread,
} from "@repo/features/description-comment-wire";
import { PAGE_SHOWER, taskPageOwner } from "@repo/features/page-wire";
import { Effect, Option } from "effect";
import { Database } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import { CONVERSATION_RUNTIME } from "../../storage-vocabulary.js";
import { getTestDB, joinWorkspace, openWorkspace } from "../../testing/index.js";
import { createAgent } from "../agent-store.js";
import { readDescriptionAttachment } from "../description-attachments.js";
import {
  actOnDescriptionCommentThread,
  DESCRIPTION_COMMENT_OUTCOME,
  type DescriptionCommentOutcome,
  type DescriptionCommentWriterRef,
  moveDescriptionCommentAnchors,
  readDescriptionCommentFile,
  readDescriptionCommentThreads,
  startDescriptionCommentThread,
} from "../description-comments.js";
import { writePage } from "../task-pages.js";
import { createTask, saveDescriptionText } from "../task-store.js";

/**
 * A plan's comment threads over a real dialect: started and read by every
 * member of the plan's workspace and by nobody else, anchored to the words
 * they were started on, carried with those words through every save, left
 * with their quote where the words are deleted and anchored again where the
 * editor's undo reports them back, answered, resolved, and reopened by any
 * member, and a comment edited or deleted only by its writer. A comment's
 * files are kept with it, read by every member and nobody else, and go
 * with it. A thread on one of the task's pages is read with that page's
 * alone, never the plan's.
 *
 * Synthetic accounts and plans throughout.
 */

const DESCRIPTION_TEXT =
  "## Goal\n\nAn admin invites a teammate by email, and the invite lands as a single-use link that expires in seven days.\n\n## Approach\n\nAdmins can withdraw an invite from the members page. A withdrawn link never grants access again.\n";

const openAccount = (name: string) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const id = `user-${randomUUID()}`;
    yield* db.insert(user).values({ id, name, email: `${id}@app.test` });
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
  yield* saveDescriptionText(owner, taskId, DESCRIPTION_TEXT);
  return { owner, teammate, outsider, taskId };
});

/** How long the test that writes a thread up to its bound may take. */
const BOUND_TIMEOUT = 60_000;

const member = (userId: string): DescriptionCommentWriterRef => ({
  actor: DESCRIPTION_COMMENT_ACTOR.MEMBER,
  userId,
});

/** A thread started on the first place `words` stands in `text`. */
function startOn(text: string, words: string, comment: string): DescriptionCommentStartRequest {
  const from = text.indexOf(words);
  assert.ok(from >= 0);
  return {
    clientKey: randomUUID(),
    scope: DESCRIPTION_COMMENT_SCOPE.WORDS,
    quote: words,
    anchor: { from, to: from + words.length },
    text,
    words: comment,
  };
}

/** The thread an outcome answered, failing the test where it answered none. */
function threadOf(outcome: DescriptionCommentOutcome): DescriptionCommentThread {
  assert.equal(outcome.status, DESCRIPTION_COMMENT_OUTCOME.DONE);
  assert.ok("thread" in outcome.answer, JSON.stringify(outcome.answer));
  return outcome.answer.thread;
}

/** An outcome without the transaction its write committed in, which no two runs share. */
function withoutTxid(outcome: DescriptionCommentOutcome): DescriptionCommentOutcome {
  if (outcome.status !== DESCRIPTION_COMMENT_OUTCOME.DONE) return outcome;
  const { txid: _txid, ...said } = outcome;
  return said;
}

/** The words a thread's anchor stands over in the text, or nothing where it stands nowhere. */
function anchoredIn(
  text: string,
  thread: DescriptionCommentThread | undefined,
): string | undefined {
  return thread?.anchor === undefined
    ? undefined
    : text.slice(thread.anchor.from, thread.anchor.to);
}

const readOne = (userId: string, taskId: string) =>
  Effect.map(
    readDescriptionCommentThreads(userId, taskId),
    (threads) => Option.getOrThrow(threads)[0],
  );

it.layer(getTestDB())("a plan's comment threads", (it) => {
  it.effect(
    "a thread a teammate started reads for every member, naming its writer, and as no plan for anyone else",
    () =>
      Effect.gen(function* () {
        const { owner, teammate, outsider, taskId } = yield* openSharedTask;

        const started = threadOf(
          yield* startDescriptionCommentThread(
            member(teammate),
            taskId,
            startOn(DESCRIPTION_TEXT, "seven days", "Should this be a setting?"),
          ),
        );

        const read = yield* readOne(owner, taskId);
        assert.equal(read?.id, started.id);
        assert.equal(anchoredIn(DESCRIPTION_TEXT, read), "seven days");
        assert.equal(read?.section, "Goal");
        assert.equal(read?.status, DESCRIPTION_COMMENT_STATUS.OPEN);
        assert.deepEqual(
          read?.entries.map((entry) => [entry.kind, entry.writer.by?.name, entry.words]),
          [[DESCRIPTION_COMMENT_ENTRY.COMMENT, "Charles Pan", "Should this be a setting?"]],
        );
        assert.ok(Option.isNone(yield* readDescriptionCommentThreads(outsider, taskId)));
        assert.equal(
          (yield* startDescriptionCommentThread(
            member(outsider),
            taskId,
            startOn(DESCRIPTION_TEXT, "teammate", "Hi"),
          )).status,
          DESCRIPTION_COMMENT_OUTCOME.NO_TASK,
        );
      }),
  );

  it.effect(
    "a thread started over words not yet saved lands on the same words in the saved text",
    () =>
      Effect.gen(function* () {
        const { owner, taskId } = yield* openSharedTask;
        const unsaved = DESCRIPTION_TEXT.replace(
          "## Goal\n\n",
          "## Goal\n\nInvites replace the admin-only flow.\n\n",
        );

        const started = threadOf(
          yield* startDescriptionCommentThread(
            member(owner),
            taskId,
            startOn(unsaved, "single-use link", "Why single use?"),
          ),
        );

        assert.equal(anchoredIn(DESCRIPTION_TEXT, started), "single-use link");
      }),
  );

  it.effect("a thread sent again under its key is started once", () =>
    Effect.gen(function* () {
      const { owner, taskId } = yield* openSharedTask;
      const request = startOn(DESCRIPTION_TEXT, "teammate", "Or a guest?");

      const first = threadOf(yield* startDescriptionCommentThread(member(owner), taskId, request));
      const again = threadOf(yield* startDescriptionCommentThread(member(owner), taskId, request));

      assert.equal(again.id, first.id);
      assert.equal(
        Option.getOrThrow(yield* readDescriptionCommentThreads(owner, taskId)).length,
        1,
      );
    }),
  );

  it.effect(
    "a thread is made under the id its client chose, once however often it is sent under it, and an id another task's thread holds is taken",
    () =>
      Effect.gen(function* () {
        const { owner, outsider, taskId } = yield* openSharedTask;
        const { id: elsewhere } = yield* createTask(outsider, {
          organizationId: yield* openWorkspace(outsider),
          name: "Elsewhere",
        });
        yield* saveDescriptionText(outsider, elsewhere, DESCRIPTION_TEXT);
        const id = randomUUID();

        const made = yield* startDescriptionCommentThread(member(owner), taskId, {
          ...startOn(DESCRIPTION_TEXT, "teammate", "Or a guest?"),
          id,
        });
        const again = yield* startDescriptionCommentThread(member(owner), taskId, {
          ...startOn(DESCRIPTION_TEXT, "teammate", "Or a guest?"),
          id,
        });
        const taken = yield* startDescriptionCommentThread(member(outsider), elsewhere, {
          ...startOn(DESCRIPTION_TEXT, "teammate", "Mine now"),
          id,
        });

        assert.equal(threadOf(made).id, id);
        assert.ok(made.status === DESCRIPTION_COMMENT_OUTCOME.DONE && made.txid !== undefined);
        assert.equal(threadOf(again).id, id);
        assert.ok(again.status === DESCRIPTION_COMMENT_OUTCOME.DONE && again.txid === undefined);
        assert.deepEqual(taken, { status: DESCRIPTION_COMMENT_OUTCOME.ID_TAKEN });
        const threads = Option.getOrThrow(yield* readDescriptionCommentThreads(owner, taskId));
        assert.deepEqual(
          threads.map((thread) => thread.entries.map((entry) => entry.words)),
          [["Or a guest?"]],
        );
        assert.deepEqual(
          Option.getOrThrow(yield* readDescriptionCommentThreads(outsider, elsewhere)),
          [],
        );
      }),
  );

  it.effect("an anchor naming no words of the text it was measured in is refused", () =>
    Effect.gen(function* () {
      const { owner, taskId } = yield* openSharedTask;

      const outcome = yield* startDescriptionCommentThread(member(owner), taskId, {
        ...startOn(DESCRIPTION_TEXT, "teammate", "Hm"),
        anchor: { from: 5, to: 5 },
      });

      assert.deepEqual(outcome, {
        status: DESCRIPTION_COMMENT_OUTCOME.DONE,
        answer: { refused: DESCRIPTION_COMMENT_REFUSAL.NO_WORDS },
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
          yield* startDescriptionCommentThread(
            member(owner),
            taskId,
            startOn(DESCRIPTION_TEXT, words, "In v1?"),
          ),
        );

        const moved = DESCRIPTION_TEXT.replace(
          "## Goal\n\n",
          "## Context\n\nOnly admins add people.\n\n## Goal\n\n",
        );
        yield* moveDescriptionCommentAnchors(taskId, DESCRIPTION_TEXT, moved);
        assert.equal(anchoredIn(moved, yield* readOne(owner, taskId)), words);

        const deleted = moved.replace(`${words} `, "");
        yield* moveDescriptionCommentAnchors(taskId, moved, deleted, {
          text: deleted,
          anchors: { anchors: [], carried: [started.id] },
        });
        const gone = yield* readOne(owner, taskId);
        assert.equal(gone?.anchor, undefined);
        assert.equal(gone?.quote, words);
        assert.equal(gone?.section, "Approach");
        assert.equal(gone?.status, DESCRIPTION_COMMENT_STATUS.OPEN);

        // Note that a save carrying the text alone never finds the words again, however they come back.
        yield* moveDescriptionCommentAnchors(taskId, deleted, moved);
        assert.equal((yield* readOne(owner, taskId))?.anchor, undefined);

        const from = moved.indexOf(words);
        yield* moveDescriptionCommentAnchors(taskId, moved, moved, {
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
          yield* startDescriptionCommentThread(
            member(teammate),
            taskId,
            startOn(DESCRIPTION_TEXT, "email", "Or a link?"),
          ),
        );
        const [comment] = started.entries;
        assert.ok(comment);

        const replied = threadOf(
          yield* actOnDescriptionCommentThread(member(owner), taskId, started.id, {
            action: DESCRIPTION_COMMENT_ACTION.REPLY,
            clientKey: randomUUID(),
            words: "Email, for v1.",
          }),
        );
        const resolved = threadOf(
          yield* actOnDescriptionCommentThread(member(owner), taskId, started.id, {
            action: DESCRIPTION_COMMENT_ACTION.RESOLVE,
          }),
        );
        const reopened = threadOf(
          yield* actOnDescriptionCommentThread(member(teammate), taskId, started.id, {
            action: DESCRIPTION_COMMENT_ACTION.REOPEN,
          }),
        );

        assert.equal(replied.entries.length, 2);
        assert.equal(resolved.status, DESCRIPTION_COMMENT_STATUS.RESOLVED);
        assert.equal(reopened.status, DESCRIPTION_COMMENT_STATUS.OPEN);
        assert.deepEqual(
          reopened.entries.map((entry) => [entry.kind, entry.writer.by?.name]),
          [
            [DESCRIPTION_COMMENT_ENTRY.COMMENT, "Charles Pan"],
            [DESCRIPTION_COMMENT_ENTRY.COMMENT, "Dean Stratakos"],
            [DESCRIPTION_COMMENT_ENTRY.RESOLVED, "Dean Stratakos"],
            [DESCRIPTION_COMMENT_ENTRY.REOPENED, "Charles Pan"],
          ],
        );
        assert.deepEqual(
          yield* actOnDescriptionCommentThread(member(owner), taskId, started.id, {
            action: DESCRIPTION_COMMENT_ACTION.EDIT,
            entry: comment.id,
            words: "Mine now",
          }),
          {
            status: DESCRIPTION_COMMENT_OUTCOME.DONE,
            answer: { refused: DESCRIPTION_COMMENT_REFUSAL.NOT_YOURS },
          },
        );
        const edited = threadOf(
          yield* actOnDescriptionCommentThread(member(teammate), taskId, started.id, {
            action: DESCRIPTION_COMMENT_ACTION.EDIT,
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
        yield* startDescriptionCommentThread(
          member(owner),
          taskId,
          startOn(DESCRIPTION_TEXT, "seven days", "Why?"),
        );
        const renamed = DESCRIPTION_TEXT.replace("## Goal", "## Plan");

        yield* moveDescriptionCommentAnchors(taskId, DESCRIPTION_TEXT, renamed);

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
          yield* startDescriptionCommentThread(
            member(owner),
            taskId,
            startOn(DESCRIPTION_TEXT, "email", "One"),
          ),
        );
        const second = threadOf(
          yield* startDescriptionCommentThread(
            member(owner),
            taskId,
            startOn(DESCRIPTION_TEXT, "invite", "Two"),
          ),
        );
        const clientKey = randomUUID();
        const reply = {
          action: DESCRIPTION_COMMENT_ACTION.REPLY,
          clientKey,
          words: "Again",
        } as const;
        yield* actOnDescriptionCommentThread(member(owner), taskId, first.id, reply);

        assert.deepEqual(
          yield* actOnDescriptionCommentThread(member(owner), taskId, second.id, reply),
          {
            status: DESCRIPTION_COMMENT_OUTCOME.DONE,
            answer: { refused: DESCRIPTION_COMMENT_REFUSAL.KEY_TAKEN },
          },
        );
        assert.equal(
          threadOf(yield* actOnDescriptionCommentThread(member(owner), taskId, first.id, reply))
            .entries.length,
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
          yield* startDescriptionCommentThread(
            member(owner),
            taskId,
            startOn(DESCRIPTION_TEXT, "email", "Toggle"),
          ),
        );
        let last = started;
        for (
          let turn = 0;
          turn < DESCRIPTION_COMMENT_BOUNDS.MAX_ENTRIES_PER_THREAD + 2;
          turn += 1
        ) {
          const action =
            turn % 2 === 0 ? DESCRIPTION_COMMENT_ACTION.RESOLVE : DESCRIPTION_COMMENT_ACTION.REOPEN;
          last = threadOf(
            yield* actOnDescriptionCommentThread(member(owner), taskId, started.id, { action }),
          );
        }

        assert.equal(last.status, DESCRIPTION_COMMENT_STATUS.OPEN);
        assert.equal(last.entries.length, DESCRIPTION_COMMENT_BOUNDS.MAX_ENTRIES_PER_THREAD + 1);
        const replied = yield* actOnDescriptionCommentThread(member(owner), taskId, started.id, {
          action: DESCRIPTION_COMMENT_ACTION.REPLY,
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
        yield* startDescriptionCommentThread(
          member(teammate),
          taskId,
          startOn(DESCRIPTION_TEXT, "email", "One"),
        ),
      );
      const second = threadOf(
        yield* startDescriptionCommentThread(
          member(teammate),
          taskId,
          startOn(DESCRIPTION_TEXT, "invite", "Two"),
        ),
      );
      const [comment] = first.entries;
      assert.ok(comment);

      assert.deepEqual(
        withoutTxid(
          yield* actOnDescriptionCommentThread(member(teammate), taskId, first.id, {
            action: DESCRIPTION_COMMENT_ACTION.DELETE,
            entry: comment.id,
          }),
        ),
        { status: DESCRIPTION_COMMENT_OUTCOME.DONE, answer: { deleted: first.id } },
      );
      assert.deepEqual(
        withoutTxid(
          yield* actOnDescriptionCommentThread(member(teammate), taskId, second.id, {
            action: DESCRIPTION_COMMENT_ACTION.DELETE_THREAD,
          }),
        ),
        { status: DESCRIPTION_COMMENT_OUTCOME.DONE, answer: { deleted: second.id } },
      );
      assert.deepEqual(Option.getOrThrow(yield* readDescriptionCommentThreads(owner, taskId)), []);
      assert.equal(
        (yield* actOnDescriptionCommentThread(member(owner), taskId, second.id, {
          action: DESCRIPTION_COMMENT_ACTION.RESOLVE,
        })).status,
        DESCRIPTION_COMMENT_OUTCOME.NO_THREAD,
      );
    }),
  );

  it.effect(
    "only a thread's starter deletes it whole, and any member deletes one an agent started",
    () =>
      Effect.gen(function* () {
        const { owner, teammate, taskId } = yield* openSharedTask;
        const agentId = Option.getOrThrow(
          yield* createAgent(owner, {
            taskId,
            idempotencyKey: randomUUID(),
            model: "anthropic/claude-opus-5.5",
            effort: "high",
            descriptionSnapshot: DESCRIPTION_TEXT,
            prompt: null,
            repository: null,
            runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
          }),
        ).agent.id;
        const deleteWhole = (writer: DescriptionCommentWriterRef, threadId: string) =>
          actOnDescriptionCommentThread(writer, taskId, threadId, {
            action: DESCRIPTION_COMMENT_ACTION.DELETE_THREAD,
          });
        const theirs = threadOf(
          yield* startDescriptionCommentThread(
            member(teammate),
            taskId,
            startOn(DESCRIPTION_TEXT, "email", "Mine"),
          ),
        );
        const agents = threadOf(
          yield* startDescriptionCommentThread(
            { actor: DESCRIPTION_COMMENT_ACTOR.AGENT, userId: owner, agentId },
            taskId,
            startOn(DESCRIPTION_TEXT, "invite", "From the agent"),
          ),
        );

        assert.deepEqual(yield* deleteWhole(member(owner), theirs.id), {
          status: DESCRIPTION_COMMENT_OUTCOME.DONE,
          answer: { refused: DESCRIPTION_COMMENT_REFUSAL.NOT_YOURS },
        });
        assert.deepEqual(
          Option.getOrThrow(yield* readDescriptionCommentThreads(owner, taskId))
            .map((each) => each.id)
            .sort(),
          [theirs.id, agents.id].sort(),
          "the refused delete left the thread standing",
        );
        assert.deepEqual(withoutTxid(yield* deleteWhole(member(teammate), theirs.id)), {
          status: DESCRIPTION_COMMENT_OUTCOME.DONE,
          answer: { deleted: theirs.id },
        });
        assert.deepEqual(withoutTxid(yield* deleteWhole(member(owner), agents.id)), {
          status: DESCRIPTION_COMMENT_OUTCOME.DONE,
          answer: { deleted: agents.id },
        });
      }),
  );

  it.effect(
    "a thread on a page is read with that page's alone, on the element and version it was left on, and a version the task does not hold is no page",
    () =>
      Effect.gen(function* () {
        const { owner, teammate, taskId } = yield* openSharedTask;
        const shown = Option.getOrThrow(
          yield* writePage(
            owner,
            taskPageOwner(taskId),
            { title: "Invite funnel", html: "<h1>Invites</h1><p>12 sent</p>" },
            { kind: PAGE_SHOWER.APP },
          ),
        );
        yield* startDescriptionCommentThread(
          member(owner),
          taskId,
          startOn(DESCRIPTION_TEXT, "seven days", "On the plan."),
        );
        const onElement = {
          clientKey: randomUUID(),
          page: { id: shown.id, version: 1 },
          element: { path: "body > p:nth-of-type(1)", quote: "12 sent", section: "Invites" },
          words: "Is this a week's worth?",
        };

        const started = threadOf(
          yield* startDescriptionCommentThread(member(teammate), taskId, onElement),
        );
        const whole = threadOf(
          yield* startDescriptionCommentThread(member(teammate), taskId, {
            clientKey: randomUUID(),
            page: { id: shown.id, version: 1 },
            words: "Add a chart.",
          }),
        );

        const onPage = Option.getOrThrow(
          yield* readDescriptionCommentThreads(owner, taskId, shown.id),
        );
        // Note that the two may be started in one millisecond, which orders them by their ids, so they are compared in the order of their scopes.
        const byScope = [...onPage].sort((a, b) => a.scope.localeCompare(b.scope));
        assert.deepEqual(
          byScope.map((thread) => [
            thread.id,
            thread.scope,
            thread.quote,
            thread.section,
            thread.page,
          ]),
          [
            [
              started.id,
              DESCRIPTION_COMMENT_SCOPE.ELEMENT,
              "12 sent",
              "Invites",
              { id: shown.id, version: 1, element: "body > p:nth-of-type(1)" },
            ],
            [
              whole.id,
              DESCRIPTION_COMMENT_SCOPE.PAGE,
              "Invite funnel",
              "",
              { id: shown.id, version: 1 },
            ],
          ],
        );
        const onPlan = Option.getOrThrow(yield* readDescriptionCommentThreads(owner, taskId));
        assert.deepEqual(
          onPlan.map((thread) => thread.quote),
          ["seven days"],
        );
        assert.deepEqual(
          yield* startDescriptionCommentThread(member(teammate), taskId, {
            ...onElement,
            clientKey: randomUUID(),
            page: { id: shown.id, version: 2 },
          }),
          { status: DESCRIPTION_COMMENT_OUTCOME.NO_PAGE },
        );
      }),
  );

  it.effect(
    "a comment's files are named on its entry in order, read by every member and nobody else, and go with the comment",
    () =>
      Effect.gen(function* () {
        const { owner, teammate, outsider, taskId } = yield* openSharedTask;
        const notes = new TextEncoder().encode("expiry: 7 days\n");
        const started = threadOf(
          yield* startDescriptionCommentThread(member(teammate), taskId, {
            ...startOn(DESCRIPTION_TEXT, "seven days", "See the attached."),
            attachments: [
              {
                name: "expiry.txt",
                mediaType: AGENT_ATTACHMENT_TYPE.TEXT,
                data: Buffer.from(notes).toString("base64"),
              },
              {
                name: "flow.pdf",
                mediaType: AGENT_ATTACHMENT_TYPE.PDF,
                data: Buffer.from("%PDF-1.4\n").toString("base64"),
              },
            ],
          }),
        );
        const reply = threadOf(
          yield* actOnDescriptionCommentThread(member(owner), taskId, started.id, {
            action: DESCRIPTION_COMMENT_ACTION.REPLY,
            clientKey: randomUUID(),
            words: "No files here.",
          }),
        );

        const read = yield* readOne(owner, taskId);
        const [first, second] = read?.entries ?? [];
        assert.deepEqual(
          first?.files?.map((file) => [file.name, file.mediaType]),
          [
            ["expiry.txt", AGENT_ATTACHMENT_TYPE.TEXT],
            ["flow.pdf", AGENT_ATTACHMENT_TYPE.PDF],
          ],
        );
        assert.equal(second?.files, undefined);
        const fileId = first?.files?.[0]?.attachmentId;
        assert.ok(fileId !== undefined);

        const kept = Option.getOrThrow(yield* readDescriptionCommentFile(owner, taskId, fileId));
        assert.equal(kept.contentType, AGENT_ATTACHMENT_TYPE.TEXT);
        assert.deepEqual([...kept.bytes], [...notes]);
        assert.ok(Option.isNone(yield* readDescriptionCommentFile(outsider, taskId, fileId)));
        // A comment's file is no picture of the plan's.
        assert.ok(Option.isNone(yield* readDescriptionAttachment(owner, taskId, fileId)));

        assert.deepEqual(
          withoutTxid(
            yield* actOnDescriptionCommentThread(member(teammate), taskId, reply.id, {
              action: DESCRIPTION_COMMENT_ACTION.DELETE_THREAD,
            }),
          ),
          { status: DESCRIPTION_COMMENT_OUTCOME.DONE, answer: { deleted: reply.id } },
        );
        assert.ok(Option.isNone(yield* readDescriptionCommentFile(owner, taskId, fileId)));
      }),
  );
});
