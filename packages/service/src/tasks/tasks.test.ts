import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import {
  attachTaskConversation,
  createTask,
  deleteTask,
  listTasks,
  readTask,
  savePlanText,
  updateTask,
} from "@luke/database/models/task-store";
import { user } from "@luke/database/schemas/auth";
import { conversations } from "@luke/database/schemas/storage";
import { CONVERSATION_KIND } from "@luke/database/storage-vocabulary";
import {
  getTestDB,
  joinWorkspace,
  openWorkspace,
  startTask,
  type TestTask,
} from "@luke/database/testing";
import { noDatabase } from "@luke/database/testing/no-database";
import { planSections } from "@luke/features/plan-document";
import { DEFAULT_PLAN_TEMPLATE } from "@luke/features/plan-document-template";
import { PLAN_HEADING, type PlanNote } from "@luke/features/plan-template";
import type { PlanDocument } from "@luke/features/task-wire";
import { Effect, Option } from "effect";
import { TestClock } from "effect/testing";
import { INVITATIONS_TEXT, makeDocumentTask } from "../testing/plan-documents.js";
import { added } from "../testing/task-contents.js";
import {
  PLAN_SAVE_REFUSAL,
  PLAN_SAVE_STATUS,
  type PlanDocumentBinding,
  type PlanSaveResult,
  saveNotes,
} from "./plan-notes.js";

/**
 * The named tasks and their one document, through the store's public
 * functions and `saveNotes`, the plan's one write, against a real dialect.
 * Every plan is one Markdown text: each note lands in the section under the
 * heading it names and nowhere else, and what is saved is the text the window
 * and the brain both read (`readTask`). Nothing but the binding the
 * service built names the account and the task, so no note can move a save
 * onto another account's task, bring a deleted task back, or leave an
 * oversized document saved.
 *
 * Synthetic accounts, repositories, and tasks throughout.
 */

const RELAY_TASK: TestTask = {
  name: "Teammate invitations",
};

const LEDGER_TASK: TestTask = {
  name: "Billing export",
};

const INVITATIONS_CONTEXT =
  "A workspace member cannot bring a teammate in without an admin creating the account.";

const INVITATIONS_HARD_PART = "- A withdrawn invite's link never grants access.";

/** Notes that write an invitations draft into a plan: its context, a hard part, an open question, and an assumption. */
const INVITATIONS_NOTES: readonly PlanNote[] = [
  added(PLAN_HEADING.CONTEXT, INVITATIONS_CONTEXT),
  added(PLAN_HEADING.HARD_PARTS, INVITATIONS_HARD_PART),
  added(PLAN_HEADING.OPEN_QUESTIONS, "- Who can withdraw an invite?"),
  added(PLAN_HEADING.ASSUMPTIONS, "- Invites reuse `memberships` with a `pending` state."),
];

const EMPTY_STATE_CONTEXT =
  "Developers opening the Plans tab for the first time see an empty list that says nothing about how to start.";

/** Notes that write a small copy change into a plan: its context and its goal. */
const EMPTY_STATE_NOTES: readonly PlanNote[] = [
  added(PLAN_HEADING.CONTEXT, EMPTY_STATE_CONTEXT),
  added(PLAN_HEADING.GOAL, 'The empty list reads "No plans yet. Start one with New plan."'),
];

const openUser = Effect.gen(function* () {
  const db = yield* Database;
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
  return userId;
});

const openConversation = (userId: string) =>
  Effect.map(
    Database.use((db) =>
      db
        .insert(conversations)
        .values({ userId, kind: CONVERSATION_KIND.MAIN })
        .returning({ id: conversations.id }),
    ),
    (rows) => rows[0]?.id ?? assert.fail("the conversation insert returned no row"),
  );

/** The binding the service builds for a task: its account and its id. */
function bound(userId: string, taskId: string): PlanDocumentBinding {
  return { userId, taskId };
}

/** The document a saved result carries, failing the test on any other outcome. */
function savedDocument(result: PlanSaveResult): PlanDocument {
  if (result.status !== PLAN_SAVE_STATUS.SAVED) {
    return assert.fail(`expected a save, got: ${JSON.stringify(result)}`);
  }
  return result.document;
}

/** The document the window opens and the model resumes from, failing the test where the task does not read. */
const resumedDocument = (userId: string, taskId: string) =>
  Effect.map(readTask(userId, taskId), (stored) =>
    Option.match(stored, {
      onNone: () => assert.fail("the plan did not read"),
      onSome: (found) => found.task.document,
    }),
  );

/** One section of a text as it stands, its heading line among its lines, failing the test where the text has none under that heading. */
function sectionText(text: string, heading: string): string {
  const section = planSections(text).find((each) => each.heading === heading);
  return section?.text ?? assert.fail(`the text holds no section under ${heading}`);
}

it.layer(getTestDB())("named plans and the notes that write them", (it) => {
  it.effect("a plan starts in the workspace it was handed, and its summary names it", () =>
    Effect.gen(function* () {
      const userId = yield* openUser;
      const personal = yield* openWorkspace(userId);
      const shared = yield* openWorkspace(userId);

      const relay = yield* createTask(userId, { ...RELAY_TASK, organizationId: shared });
      yield* TestClock.adjust("1 minute");
      const ledger = yield* createTask(userId, { ...LEDGER_TASK, organizationId: personal });

      assert.equal(relay.workspaceId, shared);
      assert.deepEqual(
        (yield* listTasks(userId, { includeArchived: false })).map((task) => [
          task.id,
          task.workspaceId,
        ]),
        [
          [ledger.id, personal],
          [relay.id, shared],
        ],
      );
    }),
  );

  it.effect("two named plans keep independent documents", () =>
    Effect.gen(function* () {
      const userId = yield* openUser;
      const relay = yield* startTask(userId, RELAY_TASK);
      const ledger = yield* startTask(userId, LEDGER_TASK);

      yield* saveNotes(bound(userId, relay.id), INVITATIONS_NOTES);
      yield* saveNotes(bound(userId, ledger.id), EMPTY_STATE_NOTES);

      const relayBody = (yield* resumedDocument(userId, relay.id)).body;
      const ledgerBody = (yield* resumedDocument(userId, ledger.id)).body;
      assert.ok(relayBody.includes(INVITATIONS_CONTEXT));
      assert.ok(ledgerBody.includes(EMPTY_STATE_CONTEXT));
      assert.ok(!ledgerBody.includes(INVITATIONS_CONTEXT));
      assert.ok(!relayBody.includes(EMPTY_STATE_CONTEXT));
    }),
  );

  it.effect(
    "notes save, and the window and the resumed model read each at the end of the section its heading names",
    () =>
      Effect.gen(function* () {
        const userId = yield* openUser;
        const { id: taskId } = yield* startTask(userId, RELAY_TASK);

        const saved = savedDocument(yield* saveNotes(bound(userId, taskId), INVITATIONS_NOTES));

        assert.deepEqual(yield* resumedDocument(userId, taskId), saved);
        assert.deepEqual(saved.assumptions, []);
        const { body } = saved;
        assert.ok(sectionText(body, "Context").endsWith(`\n\n${INVITATIONS_CONTEXT}`));
        assert.ok(sectionText(body, "Hard parts").endsWith(`\n\n${INVITATIONS_HARD_PART}`));
        assert.ok(
          sectionText(body, "Open questions").endsWith("\n\n- Who can withdraw an invite?"),
        );
        assert.ok(
          sectionText(body, "Assumptions").endsWith(
            "\n\n- Invites reuse `memberships` with a `pending` state.",
          ),
        );
        assert.equal(sectionText(body, "Goal"), sectionText(DEFAULT_PLAN_TEMPLATE, "Goal"));
      }),
  );

  it.effect(
    "a note adds after what its section holds, and every section it does not name keeps what stood",
    () =>
      Effect.gen(function* () {
        const userId = yield* openUser;
        const { id: taskId } = yield* startTask(userId, RELAY_TASK);
        yield* makeDocumentTask(taskId, INVITATIONS_TEXT);

        const result = yield* saveNotes(bound(userId, taskId), [
          added(PLAN_HEADING.GOAL, "- Pending invites show in settings."),
        ]);

        const { body, assumptions } = savedDocument(result);
        assert.equal(
          body,
          [
            "## Context",
            "",
            "Only an admin can add someone to a workspace today.",
            "",
            "## Goal",
            "",
            "- Any member can invite a teammate by email.",
            "- Pending invites show in settings.",
            "",
            "## Assumptions",
            "",
            "- An invite expires after 7 days.",
            "",
          ].join("\n"),
        );
        assert.deepEqual(assumptions, []);
        assert.deepEqual(yield* resumedDocument(userId, taskId), { body, assumptions });
      }),
  );

  it.effect(
    "the list holds only the account's plans, newest started first, and reading or saving one moves none",
    () =>
      Effect.gen(function* () {
        const userId = yield* openUser;
        const other = yield* openUser;
        const relay = yield* startTask(userId, RELAY_TASK);
        yield* TestClock.adjust("1 minute");
        const ledger = yield* startTask(userId, LEDGER_TASK);
        yield* startTask(other, RELAY_TASK);
        yield* TestClock.adjust("1 minute");

        yield* readTask(userId, relay.id);
        yield* saveNotes(bound(userId, relay.id), INVITATIONS_NOTES);

        const listed = yield* listTasks(userId);
        assert.deepEqual(
          listed.map((summary) => summary.id),
          [ledger.id, relay.id],
        );
      }),
  );

  it.effect(
    "a member lists, opens, renames, saves notes and text on, and deletes a teammate's plan",
    () =>
      Effect.gen(function* () {
        const starter = yield* openUser;
        const teammate = yield* openUser;
        const stranger = yield* openUser;
        const started = yield* startTask(starter, RELAY_TASK);
        yield* joinWorkspace(started.workspaceId, teammate);

        assert.deepEqual(
          (yield* listTasks(teammate)).map((task) => task.id),
          [started.id],
        );
        assert.deepEqual(yield* resumedDocument(teammate, started.id), started.document);
        const renamed = yield* updateTask(teammate, started.id, { name: "Shared invitations" });
        assert.deepEqual(
          Option.map(renamed, (task) => task.name),
          Option.some("Shared invitations"),
        );
        const saved = savedDocument(
          yield* saveNotes(bound(teammate, started.id), INVITATIONS_NOTES),
        );
        assert.deepEqual(yield* resumedDocument(starter, started.id), saved);
        const edited = `${saved.body}\n## Rollout\n\nBehind a flag first.\n`;
        assert.equal(Option.isNone(yield* savePlanText(stranger, started.id, edited)), true);
        assert.equal(Option.isSome(yield* savePlanText(teammate, started.id, edited)), true);
        assert.equal((yield* resumedDocument(starter, started.id)).body, edited);

        assert.deepEqual(yield* listTasks(stranger), []);
        assert.equal(Option.isNone(yield* readTask(stranger, started.id)), true);
        assert.equal(yield* deleteTask(stranger, started.id), false);

        assert.equal(yield* deleteTask(teammate, started.id), true);
        assert.equal(Option.isNone(yield* readTask(starter, started.id)), true);
      }),
  );

  it.effect("a second account cannot read, write, or delete another's plan", () =>
    Effect.gen(function* () {
      const owner = yield* openUser;
      const intruder = yield* openUser;
      const { id: taskId } = yield* startTask(owner, RELAY_TASK);
      yield* saveNotes(bound(owner, taskId), INVITATIONS_NOTES);
      const saved = yield* resumedDocument(owner, taskId);

      const result = yield* saveNotes(bound(intruder, taskId), EMPTY_STATE_NOTES);

      assert.deepEqual(result, {
        status: PLAN_SAVE_STATUS.NOT_SAVED,
        reason: PLAN_SAVE_REFUSAL.NO_TASK,
      });
      assert.equal(Option.isNone(yield* readTask(intruder, taskId)), true);
      assert.equal(yield* deleteTask(intruder, taskId), false);
      assert.deepEqual(yield* listTasks(intruder), []);
      assert.deepEqual(yield* resumedDocument(owner, taskId), saved);
    }),
  );

  it.effect("a renamed plan lists and opens under its new name, its text as it stood", () =>
    Effect.gen(function* () {
      const userId = yield* openUser;
      const relay = yield* startTask(userId, RELAY_TASK);
      const ledger = yield* startTask(userId, LEDGER_TASK);
      yield* saveNotes(bound(userId, relay.id), INVITATIONS_NOTES);
      const saved = yield* resumedDocument(userId, relay.id);

      const renamed = yield* updateTask(userId, relay.id, { name: "Team invites" });
      yield* updateTask(userId, ledger.id, { name: "Billing exports" });

      const task = Option.getOrThrow(renamed);
      assert.equal(task.name, "Team invites");
      assert.deepEqual(task.document, saved);
      assert.deepEqual(yield* resumedDocument(userId, relay.id), saved);
      assert.deepEqual(
        new Map((yield* listTasks(userId)).map(({ id, name }) => [id, name])),
        new Map([
          [ledger.id, "Billing exports"],
          [relay.id, "Team invites"],
        ]),
      );
    }),
  );

  it.effect(
    "a move's guard is handed the repository the plan names as the move lands, and one that refuses leaves the plan where it was",
    () =>
      Effect.gen(function* () {
        const userId = yield* openUser;
        const started = yield* startTask(userId, { name: "Relay", repository: "acme/relay" });
        const team = yield* openWorkspace(userId);
        // A change of repository lands while the move is asked for.
        yield* updateTask(userId, started.id, { repository: "octocat/dotfiles" });
        const seen: (string | null)[] = [];

        const refused = yield* updateTask(userId, started.id, { organizationId: team }, (named) => {
          seen.push(named);
          return Effect.fail("not reached" as const);
        }).pipe(Effect.flip);
        const stood = Option.getOrThrow(yield* readTask(userId, started.id)).task.workspaceId;
        const moved = yield* updateTask(userId, started.id, { organizationId: team }, (named) =>
          Effect.sync(() => seen.push(named)),
        );

        assert.equal(refused, "not reached");
        assert.equal(stood, started.workspaceId);
        assert.equal(Option.getOrThrow(moved).workspaceId, team);
        assert.deepEqual(seen, ["octocat/dotfiles", "octocat/dotfiles"]);
      }),
  );

  it.effect("a second account cannot rename another's plan", () =>
    Effect.gen(function* () {
      const owner = yield* openUser;
      const intruder = yield* openUser;
      const { id: taskId } = yield* startTask(owner, RELAY_TASK);
      const before = yield* readTask(owner, taskId);

      assert.equal(Option.isNone(yield* updateTask(intruder, taskId, { name: "Mine now" })), true);
      assert.equal(
        Option.isNone(yield* updateTask(owner, randomUUID(), { name: "Nothing" })),
        true,
      );
      assert.deepEqual(yield* readTask(owner, taskId), before);
    }),
  );

  it.effect("a second account cannot pin or archive another's plan", () =>
    Effect.gen(function* () {
      const owner = yield* openUser;
      const intruder = yield* openUser;
      const { id: taskId } = yield* startTask(owner, RELAY_TASK);
      const before = yield* readTask(owner, taskId);

      assert.equal(Option.isNone(yield* updateTask(intruder, taskId, { pinned: true })), true);
      assert.equal(Option.isNone(yield* updateTask(intruder, taskId, { archived: true })), true);
      assert.deepEqual(yield* readTask(owner, taskId), before);
      assert.deepEqual(
        (yield* listTasks(owner)).map(({ id }) => id),
        [taskId],
      );
    }),
  );

  it.effect("a save the store refuses is reported as not saved and the prior document stands", () =>
    Effect.gen(function* () {
      const userId = yield* openUser;
      const { id: taskId } = yield* startTask(userId, RELAY_TASK);
      yield* saveNotes(bound(userId, taskId), INVITATIONS_NOTES);
      const before = yield* resumedDocument(userId, taskId);

      const result = yield* saveNotes(bound(userId, taskId), EMPTY_STATE_NOTES).pipe(
        Effect.provide(noDatabase),
      );

      assert.deepEqual(result, {
        status: PLAN_SAVE_STATUS.NOT_SAVED,
        reason: PLAN_SAVE_REFUSAL.UNAVAILABLE,
      });
      assert.deepEqual(yield* resumedDocument(userId, taskId), before);
    }),
  );

  it.effect(
    "a plan takes no other account's conversation, and no one attaches to another's plan",
    () =>
      Effect.gen(function* () {
        const owner = yield* openUser;
        const other = yield* openUser;
        const { id: taskId } = yield* startTask(owner, RELAY_TASK);
        const othersConversation = yield* openConversation(other);
        const ownConversation = yield* openConversation(owner);

        assert.equal(yield* attachTaskConversation(owner, taskId, othersConversation), false);
        assert.equal(yield* attachTaskConversation(other, taskId, othersConversation), false);
        assert.equal(yield* attachTaskConversation(other, taskId, ownConversation), false);
        assert.deepEqual(
          Option.map(yield* readTask(owner, taskId), (stored) => stored.conversationId),
          Option.some(undefined),
        );
      }),
  );
});
