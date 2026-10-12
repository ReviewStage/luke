import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import {
  EMPTY_PLAN_FIELDS,
  NOTE_KIND,
  type PlanNote,
  planBody,
} from "@sidecar/hosted/plan-template";
import {
  PLAN_BOUNDS,
  PLAN_FIELD,
  type PlanDocument,
  type PlanField,
} from "@sidecar/hosted/plan-wire";
import { eq, sql } from "drizzle-orm";
import { Effect, Option } from "effect";
import { TestClock } from "effect/testing";
import { user } from "../server/db/auth-schema";
import { plan } from "../server/db/plan-schema";
import { db } from "../server/db/query";
import { conversations } from "../server/db/storage-schema";
import { CONVERSATION_KIND } from "../server/db/storage-vocabulary";
import { deleteAccount } from "../server/hosted/account-store";
import {
  PLAN_SAVE_REFUSAL,
  PLAN_SAVE_STATUS,
  type PlanDocumentBinding,
  type PlanSaveResult,
  saveNotes,
} from "../server/hosted/plan-notes";
import {
  attachPlanConversation,
  createPlan,
  deletePlan,
  listPlans,
  readPlan,
  savePlanDocument,
  updatePlan,
} from "../server/hosted/plan-store";
import { noDatabase } from "./support/no-database";
import {
  added,
  BULK_IMPORT,
  BULK_IMPORT_AGREED,
  headingLinesOf,
  INVITATIONS_DRAFT,
  notesFor,
  SMALL_FEATURE,
  TEMPLATE_HEADINGS,
  TEMPLATE_UNANSWERED_FIELDS,
  templateHeadingsOf,
} from "./support/plan-contents";
import { testSqlClient } from "./support/sql-client";
import { openWorkspace, startPlan, type TestPlan } from "./support/workspaces";

/**
 * The named plans and their one document, through the store's public
 * functions and `saveNotes`, the plan's one write, against a real dialect.
 * Every plan is the fixed template: a new plan shows every section
 * unanswered, each note lands where it names and nowhere else, and what is
 * saved is the canonical Markdown the window and the planning model both
 * read (`readPlan`). Nothing but the binding the service built
 * names the account and the plan, so no note can move a save onto another
 * account's plan, bring a deleted plan back, or leave an oversized document
 * saved.
 *
 * Synthetic accounts, repositories, and plans throughout.
 */

const RELAY_PLAN: TestPlan = {
  name: "Teammate invitations",
};

const LEDGER_PLAN: TestPlan = {
  name: "Billing export",
};

const UNANSWERED = "_Unanswered_";

const openUser = Effect.gen(function* () {
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
  return userId;
});

const openConversation = (userId: string) =>
  Effect.map(
    db
      .insert(conversations)
      .values({ userId, kind: CONVERSATION_KIND.MAIN })
      .returning({ id: conversations.id }),
    (rows) => rows[0]?.id ?? assert.fail("the conversation insert returned no row"),
  );

/** The binding the service builds for a plan: its account and its id. */
function bound(userId: string, planId: string): PlanDocumentBinding {
  return { userId, planId };
}

/** A note correcting a phrase of a field. */
function replaced(field: PlanField, find: string, text: string): PlanNote {
  return { kind: NOTE_KIND.REPLACE, field, find, text };
}

/** A note striking the line of a field that holds a phrase. */
function removed(field: PlanField, find: string): PlanNote {
  return { kind: NOTE_KIND.REMOVE, field, find };
}

/** The document a saved result carries, failing the test on any other outcome. */
function savedDocument(result: PlanSaveResult): PlanDocument {
  if (result.status !== PLAN_SAVE_STATUS.SAVED) {
    return assert.fail(`expected a save, got: ${result.reason}`);
  }
  return result.document;
}

/** The document the window opens and the model resumes from, failing the test where the plan does not read. */
const resumedDocument = (userId: string, planId: string) =>
  Effect.map(readPlan(userId, planId), (stored) =>
    Option.match(stored, {
      onNone: () => assert.fail("the plan did not read"),
      onSome: (found) => found.plan.document,
    }),
  );

/** What stands under one heading of a body, up to the heading named after it. */
function between(body: string, from: string, to: string): string {
  const start = body.indexOf(`\n${from}\n`);
  const end = body.indexOf(`\n${to}\n`, start + 1);
  assert.ok(start !== -1 && end !== -1, `the body holds ${from} before ${to}`);
  return body.slice(start + from.length + 2, end).trim();
}

const countOf = (text: string, part: string) => text.split(part).length - 1;

it.layer(testSqlClient)("named plans and the notes that write them", (it) => {
  it.effect("a plan starts in the workspace it was handed, and its summary names it", () =>
    Effect.gen(function* () {
      const userId = yield* openUser;
      const personal = yield* openWorkspace(userId);
      const shared = yield* openWorkspace(userId);

      const relay = yield* createPlan(userId, { ...RELAY_PLAN, organizationId: shared });
      yield* TestClock.adjust("1 minute");
      const ledger = yield* createPlan(userId, { ...LEDGER_PLAN, organizationId: personal });

      assert.equal(relay.workspaceId, shared);
      assert.deepEqual(
        (yield* listPlans(userId, { includeArchived: false })).map((plan) => [
          plan.id,
          plan.workspaceId,
        ]),
        [
          [ledger.id, personal],
          [relay.id, shared],
        ],
      );
    }),
  );

  it.effect(
    "a started plan shows every fixed section, every field unanswered, and no assumption",
    () =>
      Effect.gen(function* () {
        const userId = yield* openUser;
        const started = yield* startPlan(userId, RELAY_PLAN);
        const { body, assumptions } = started.document;

        assert.equal(started.name, RELAY_PLAN.name);
        assert.ok(body.startsWith("# Teammate invitations\n"));
        assert.deepEqual(templateHeadingsOf(body), TEMPLATE_HEADINGS);
        assert.equal(countOf(body, UNANSWERED), TEMPLATE_UNANSWERED_FIELDS);
        assert.ok(body.endsWith("## Open questions\n\n_No additional questions recorded_\n"));
        assert.deepEqual(assumptions, []);
        assert.deepEqual(yield* resumedDocument(userId, started.id), started.document);
      }),
  );

  it.effect("two named plans keep independent documents under their own headers", () =>
    Effect.gen(function* () {
      const userId = yield* openUser;
      const relay = yield* startPlan(userId, RELAY_PLAN);
      const ledger = yield* startPlan(userId, LEDGER_PLAN);

      yield* saveNotes(bound(userId, relay.id), notesFor(INVITATIONS_DRAFT));
      yield* saveNotes(bound(userId, ledger.id), notesFor(SMALL_FEATURE));

      const relayBody = (yield* resumedDocument(userId, relay.id)).body;
      const ledgerBody = (yield* resumedDocument(userId, ledger.id)).body;
      const relayContext = INVITATIONS_DRAFT.fields.context ?? "?";
      assert.ok(relayBody.startsWith("# Teammate invitations\n"));
      assert.ok(relayBody.includes(relayContext));
      assert.ok(ledgerBody.startsWith("# Billing export\n"));
      assert.ok(ledgerBody.includes(SMALL_FEATURE.fields.context ?? "?"));
      assert.ok(!ledgerBody.includes(relayContext));
    }),
  );

  it.effect(
    "incomplete notes save, and the window and the resumed model read each answer in its section",
    () =>
      Effect.gen(function* () {
        const userId = yield* openUser;
        const { id: planId } = yield* startPlan(userId, RELAY_PLAN);

        const saved = savedDocument(
          yield* saveNotes(bound(userId, planId), notesFor(INVITATIONS_DRAFT)),
        );

        assert.deepEqual(yield* resumedDocument(userId, planId), saved);
        assert.deepEqual(yield* resumedDocument(userId, planId), saved);
        assert.deepEqual(saved.assumptions, INVITATIONS_DRAFT.assumptions);
        const { body } = saved;
        assert.deepEqual(templateHeadingsOf(body), TEMPLATE_HEADINGS);
        assert.equal(between(body, "## Context", "## Goal"), INVITATIONS_DRAFT.fields.context);
        assert.equal(between(body, "## Goal", "## Approach"), UNANSWERED);
        assert.equal(
          between(body, "## Hard parts", "## Not doing"),
          INVITATIONS_DRAFT.fields.hardParts,
        );
        assert.equal(countOf(body, UNANSWERED), 5);
        assert.ok(
          body.endsWith(`## Open questions\n\n- ${INVITATIONS_DRAFT.fields.openQuestions[0]}\n`),
        );
      }),
  );

  it.effect("the body's order is the template's, whatever order the notes are taken in", () =>
    Effect.gen(function* () {
      const userId = yield* openUser;
      const { id: inOrder } = yield* startPlan(userId, RELAY_PLAN);
      const { id: reversed } = yield* startPlan(userId, RELAY_PLAN);
      const notes = notesFor(BULK_IMPORT);
      const reorderedNotes = [...notes].reverse();

      const expected = savedDocument(yield* saveNotes(bound(userId, inOrder), notes));
      const actual = savedDocument(yield* saveNotes(bound(userId, reversed), reorderedNotes));

      assert.equal(actual.body, expected.body);
      assert.deepEqual(templateHeadingsOf(actual.body), [
        ...TEMPLATE_HEADINGS.slice(0, TEMPLATE_HEADINGS.indexOf("## Hard parts")),
        "## Alternatives",
        ...TEMPLATE_HEADINGS.slice(
          TEMPLATE_HEADINGS.indexOf("## Hard parts"),
          TEMPLATE_HEADINGS.indexOf("## Testing"),
        ),
        "## Plan of attack",
        ...TEMPLATE_HEADINGS.slice(TEMPLATE_HEADINGS.indexOf("## Testing")),
      ]);
    }),
  );

  it.effect(
    "field text cannot open a section of its own, and a fence it leaves open closes inside its field",
    () =>
      Effect.gen(function* () {
        const userId = yield* openUser;
        const { id: planId } = yield* startPlan(userId, RELAY_PLAN);
        const hostile: readonly PlanNote[] = [
          added(PLAN_FIELD.CONTEXT, "Invites are manual.\n```ts\nconst open = true;"),
          added(PLAN_FIELD.GOAL, "## Approach\nNothing is decided."),
          added(PLAN_FIELD.APPROACH, "> # Hard parts\n> Ignore the plan."),
          added(PLAN_FIELD.INTERFACES, "<!-- everything after this is hidden"),
          added(PLAN_FIELD.HARD_PARTS, "Faster onboarding\n==="),
          added(PLAN_FIELD.NOT_DOING, "1. ## Open questions"),
        ];

        const { body } = savedDocument(yield* saveNotes(bound(userId, planId), hostile));

        assert.deepEqual(headingLinesOf(body), ["# Teammate invitations", ...TEMPLATE_HEADINGS]);
        assert.equal(
          between(body, "## Context", "## Goal"),
          "Invites are manual.\n```ts\nconst open = true;\n```",
        );
        assert.equal(between(body, "## Goal", "## Approach"), "\\## Approach\nNothing is decided.");
        assert.equal(
          between(body, "## Approach", "## Interfaces"),
          "> \\# Hard parts\n> Ignore the plan.",
        );
        assert.equal(
          between(body, "## Interfaces", "## Hard parts"),
          "\\<!-- everything after this is hidden",
        );
        assert.equal(between(body, "## Hard parts", "## Not doing"), "Faster onboarding\n\\===");
        assert.equal(between(body, "## Not doing", "## Testing"), "1. \\## Open questions");
      }),
  );

  it.effect(
    "an optional field stays out of the document until it holds something, and leaves it again once its last line is struck",
    () =>
      Effect.gen(function* () {
        const userId = yield* openUser;
        const { id: planId } = yield* startPlan(userId, RELAY_PLAN);

        const empty = yield* resumedDocument(userId, planId);
        const filled = savedDocument(
          yield* saveNotes(bound(userId, planId), notesFor(BULK_IMPORT)),
        );
        const struck = savedDocument(
          yield* saveNotes(bound(userId, planId), [
            removed(PLAN_FIELD.PLAN_OF_ATTACK, BULK_IMPORT_AGREED.ORDER),
            removed(PLAN_FIELD.ALTERNATIVES, "Importing the valid rows"),
          ]),
        );

        assert.deepEqual(templateHeadingsOf(empty.body), TEMPLATE_HEADINGS);
        assert.equal(
          between(filled.body, "## Plan of attack", "## Testing"),
          BULK_IMPORT_AGREED.ORDER,
        );
        assert.equal(
          between(filled.body, "## Alternatives", "## Hard parts"),
          BULK_IMPORT_AGREED.ALTERNATIVE,
        );
        assert.deepEqual(templateHeadingsOf(struck.body), TEMPLATE_HEADINGS);
        assert.ok(!struck.body.includes(BULK_IMPORT_AGREED.ORDER));
        assert.ok(!struck.body.includes(BULK_IMPORT_AGREED.ALTERNATIVE));
        assert.equal(countOf(struck.body, UNANSWERED), 0);
      }),
  );

  it.effect("a core field whose last line is struck reads Unanswered again", () =>
    Effect.gen(function* () {
      const userId = yield* openUser;
      const { id: planId } = yield* startPlan(userId, RELAY_PLAN);
      yield* saveNotes(bound(userId, planId), notesFor(SMALL_FEATURE));

      const { body } = savedDocument(
        yield* saveNotes(bound(userId, planId), [
          removed(PLAN_FIELD.TESTING, "existing layout test"),
        ]),
      );

      assert.equal(between(body, "## Testing", "## Open questions"), UNANSWERED);
      assert.equal(countOf(body, UNANSWERED), 1);
      assert.equal(between(body, "## Not doing", "## Testing"), SMALL_FEATURE.fields.notDoing);
    }),
  );

  it.effect(
    "a proposal, a correction, and a non-applicable field each save, while an unanswered field stays visible",
    () =>
      Effect.gen(function* () {
        const userId = yield* openUser;
        const { id: planId } = yield* startPlan(userId, RELAY_PLAN);
        const binding = bound(userId, planId);
        const everyMember = "Any member may invite by email.";
        const adminsOnly = "Only admins may invite, by email.";
        const noContract = "Not applicable: no contract outside the app changes.";

        yield* saveNotes(binding, [
          added(PLAN_FIELD.HARD_PARTS, everyMember),
          added(PLAN_FIELD.ASSUMPTIONS, everyMember),
        ]);
        const proposed = yield* resumedDocument(userId, planId);
        // Corrected: the hard part is rewritten, and the non-applicable field set aside.
        yield* saveNotes(binding, [
          replaced(PLAN_FIELD.HARD_PARTS, everyMember, adminsOnly),
          replaced(PLAN_FIELD.ASSUMPTIONS, everyMember, adminsOnly),
          added(PLAN_FIELD.INTERFACES, noContract),
          added(PLAN_FIELD.ASSUMPTIONS, noContract),
        ]);
        const settled = yield* resumedDocument(userId, planId);

        assert.deepEqual(proposed.assumptions, [{ text: everyMember }]);
        assert.equal(between(proposed.body, "## Hard parts", "## Not doing"), everyMember);
        assert.equal(between(settled.body, "## Hard parts", "## Not doing"), adminsOnly);
        assert.ok(!settled.body.includes(everyMember));
        assert.deepEqual(settled.assumptions, [{ text: adminsOnly }, { text: noContract }]);
        assert.equal(between(settled.body, "## Interfaces", "## Hard parts"), noContract);
        assert.equal(between(settled.body, "## Testing", "## Open questions"), UNANSWERED);
      }),
  );

  it.effect("a small feature saves its non-applicable fields as the sentences that say why", () =>
    Effect.gen(function* () {
      const userId = yield* openUser;
      const { id: planId } = yield* startPlan(userId, RELAY_PLAN);

      const { body } = savedDocument(
        yield* saveNotes(bound(userId, planId), notesFor(SMALL_FEATURE)),
      );

      assert.equal(countOf(body, UNANSWERED), 0);
      assert.equal(
        between(body, "## Interfaces", "## Hard parts"),
        SMALL_FEATURE.fields.interfaces,
      );
      assert.equal(between(body, "## Approach", "## Interfaces"), SMALL_FEATURE.fields.approach);
      assert.ok(
        between(body, "## Testing", "## Open questions").includes(
          'the tab reads "No plans yet. Start one with New plan."',
        ),
      );
    }),
  );

  it.effect(
    "a note adds after what its field holds, and every field it does not name keeps what stood",
    () =>
      Effect.gen(function* () {
        const userId = yield* openUser;
        const { id: planId } = yield* startPlan(userId, RELAY_PLAN);
        const before = savedDocument(
          yield* saveNotes(bound(userId, planId), notesFor(BULK_IMPORT)),
        );
        const decision = "Rows are validated before any is written.";

        const result = yield* saveNotes(bound(userId, planId), [
          added(PLAN_FIELD.APPROACH, decision),
        ]);

        const { body, assumptions } = savedDocument(result);
        assert.equal(
          between(body, "## Approach", "## Interfaces"),
          `${BULK_IMPORT_AGREED.APPROACH}\n\n${decision}`,
        );
        assert.equal(
          body.replace(`\n\n${decision}`, ""),
          before.body,
          "nothing but the approach moved",
        );
        assert.deepEqual(assumptions, BULK_IMPORT.assumptions);
        assert.deepEqual(yield* resumedDocument(userId, planId), { body, assumptions });
      }),
  );

  it.effect(
    "a note naming a phrase the plan does not hold is passed over, and the notes beside it save",
    () =>
      Effect.gen(function* () {
        const userId = yield* openUser;
        const { id: planId } = yield* startPlan(userId, RELAY_PLAN);
        yield* saveNotes(bound(userId, planId), notesFor(INVITATIONS_DRAFT));
        const before = yield* resumedDocument(userId, planId);
        const outcome = "A member invites a teammate by email.";

        const { body, assumptions } = savedDocument(
          yield* saveNotes(bound(userId, planId), [
            replaced(PLAN_FIELD.CONTEXT, "a phrase nobody said", "Everything."),
            removed(PLAN_FIELD.ASSUMPTIONS, "Invites expire in a day."),
            removed(PLAN_FIELD.HARD_PARTS, "a hard part nobody named"),
            added(PLAN_FIELD.GOAL, outcome),
          ]),
        );

        assert.equal(between(body, "## Goal", "## Approach"), outcome);
        assert.equal(body.replace(outcome, UNANSWERED), before.body);
        assert.deepEqual(assumptions, before.assumptions);
      }),
  );

  it.effect("notes that fit every field but format past the body's bound are refused whole", () =>
    Effect.gen(function* () {
      const userId = yield* openUser;
      const { id: planId } = yield* startPlan(userId, RELAY_PLAN);
      yield* saveNotes(bound(userId, planId), notesFor(INVITATIONS_DRAFT));
      const before = yield* resumedDocument(userId, planId);
      const long = "x".repeat(40_000);
      const oversized = [
        PLAN_FIELD.GOAL,
        PLAN_FIELD.APPROACH,
        PLAN_FIELD.INTERFACES,
        PLAN_FIELD.NOT_DOING,
        PLAN_FIELD.TESTING,
      ].map((field) => added(field, long));

      const result = yield* saveNotes(bound(userId, planId), oversized);

      assert.deepEqual(result, {
        status: PLAN_SAVE_STATUS.NOT_SAVED,
        reason: PLAN_SAVE_REFUSAL.TOO_LONG,
      });
      assert.deepEqual(yield* resumedDocument(userId, planId), before);
    }),
  );

  it.effect(
    "the list holds only the account's plans, newest started first, and reading or saving one moves none",
    () =>
      Effect.gen(function* () {
        const userId = yield* openUser;
        const other = yield* openUser;
        const relay = yield* startPlan(userId, RELAY_PLAN);
        yield* TestClock.adjust("1 minute");
        const ledger = yield* startPlan(userId, LEDGER_PLAN);
        yield* startPlan(other, RELAY_PLAN);
        yield* TestClock.adjust("1 minute");

        yield* readPlan(userId, relay.id);
        yield* saveNotes(bound(userId, relay.id), notesFor(INVITATIONS_DRAFT));

        const listed = yield* listPlans(userId);
        assert.deepEqual(
          listed.map((summary) => summary.id),
          [ledger.id, relay.id],
        );
      }),
  );

  it.effect(
    "a plan whose saved fields are in a shape this build does not read still lists beside the rest",
    () =>
      Effect.gen(function* () {
        const userId = yield* openUser;
        const relay = yield* startPlan(userId, RELAY_PLAN);
        yield* TestClock.adjust("1 minute");
        const ledger = yield* startPlan(userId, LEDGER_PLAN);
        // The fields as the template before 0082 kept them, as a migration
        // landing ahead of the build that reads its shape leaves a row.
        yield* db
          .update(plan)
          .set({
            fields: sql`'{"goal":{"problem":null,"outcome":null},"implementation":{"order":null}}'::jsonb`,
          })
          .where(eq(plan.id, relay.id));

        const listed = yield* listPlans(userId);

        assert.deepEqual(
          listed.map(({ id, name }) => [id, name]),
          [
            [ledger.id, LEDGER_PLAN.name],
            [relay.id, RELAY_PLAN.name],
          ],
        );
      }),
  );

  it.effect("a second account cannot read, write, or delete another's plan", () =>
    Effect.gen(function* () {
      const owner = yield* openUser;
      const intruder = yield* openUser;
      const { id: planId } = yield* startPlan(owner, RELAY_PLAN);
      yield* saveNotes(bound(owner, planId), notesFor(INVITATIONS_DRAFT));
      const saved = yield* resumedDocument(owner, planId);

      const result = yield* saveNotes(bound(intruder, planId), notesFor(SMALL_FEATURE));

      assert.deepEqual(result, {
        status: PLAN_SAVE_STATUS.NOT_SAVED,
        reason: PLAN_SAVE_REFUSAL.NO_PLAN,
      });
      assert.equal(Option.isNone(yield* readPlan(intruder, planId)), true);
      assert.equal(yield* deletePlan(intruder, planId), false);
      assert.deepEqual(yield* listPlans(intruder), []);
      assert.deepEqual(yield* resumedDocument(owner, planId), saved);
    }),
  );

  it.effect(
    "a renamed plan lists and opens under its new name, its document's heading with it",
    () =>
      Effect.gen(function* () {
        const userId = yield* openUser;
        const relay = yield* startPlan(userId, RELAY_PLAN);
        const ledger = yield* startPlan(userId, LEDGER_PLAN);
        yield* saveNotes(bound(userId, relay.id), notesFor(INVITATIONS_DRAFT));
        const saved = yield* resumedDocument(userId, relay.id);

        const renamed = yield* updatePlan(userId, relay.id, { name: "Team invites" });
        const untouched = yield* updatePlan(userId, ledger.id, { name: "Billing exports" });

        const plan = Option.getOrThrow(renamed);
        assert.equal(plan.name, "Team invites");
        assert.equal(
          plan.document.body,
          saved.body.replace(/^# Teammate invitations\n/u, "# Team invites\n"),
        );
        assert.deepEqual(yield* resumedDocument(userId, relay.id), plan.document);
        assert.ok(Option.getOrThrow(untouched).document.body.startsWith("# Billing exports\n"));
        assert.deepEqual(
          new Map((yield* listPlans(userId)).map(({ id, name }) => [id, name])),
          new Map([
            [ledger.id, "Billing exports"],
            [relay.id, "Team invites"],
          ]),
        );
      }),
  );

  it.effect(
    "notes saved after a rename keep the new name's heading, whatever name the call began under",
    () =>
      Effect.gen(function* () {
        const userId = yield* openUser;
        const { id: planId } = yield* startPlan(userId, RELAY_PLAN);
        yield* saveNotes(bound(userId, planId), notesFor(INVITATIONS_DRAFT));

        yield* updatePlan(userId, planId, { name: "Team invites" });
        const saved = savedDocument(
          yield* saveNotes(bound(userId, planId), notesFor(SMALL_FEATURE)),
        );

        assert.ok(saved.body.startsWith("# Team invites\n"));
        assert.ok(!saved.body.includes("Teammate invitations"));
      }),
  );

  it.effect(
    "a rename whose heading would carry a full body past its bound keeps the body as saved, and the plan still reads",
    () =>
      Effect.gen(function* () {
        const userId = yield* openUser;
        const { id: planId } = yield* startPlan(userId, RELAY_PLAN);
        const withContext = (context: string) => ({ ...EMPTY_PLAN_FIELDS, context });
        const room = PLAN_BOUNDS.MAX_BODY_CHARS - planBody(RELAY_PLAN, withContext("x")).length;
        const fields = withContext("x".repeat(room - 9));
        const body = planBody(RELAY_PLAN, fields);
        yield* savePlanDocument(userId, planId, { body, assumptions: [] }, { fields });

        const renamed = yield* updatePlan(userId, planId, {
          name: "y".repeat(PLAN_BOUNDS.MAX_NAME_CHARS),
        });

        assert.equal(Option.getOrThrow(renamed).document.body, body);
        assert.equal((yield* resumedDocument(userId, planId)).body, body);
      }),
  );

  it.effect("a second account cannot rename another's plan", () =>
    Effect.gen(function* () {
      const owner = yield* openUser;
      const intruder = yield* openUser;
      const { id: planId } = yield* startPlan(owner, RELAY_PLAN);
      const before = yield* readPlan(owner, planId);

      assert.equal(Option.isNone(yield* updatePlan(intruder, planId, { name: "Mine now" })), true);
      assert.equal(
        Option.isNone(yield* updatePlan(owner, randomUUID(), { name: "Nothing" })),
        true,
      );
      assert.deepEqual(yield* readPlan(owner, planId), before);
    }),
  );

  it.effect(
    "a pin carries the instant it was made, a second pin keeps it, an unpin takes it away, and the list's order stands",
    () =>
      Effect.gen(function* () {
        const userId = yield* openUser;
        const relay = yield* startPlan(userId, RELAY_PLAN);
        yield* TestClock.adjust("1 minute");
        const ledger = yield* startPlan(userId, LEDGER_PLAN);
        yield* TestClock.adjust("1 minute");

        const pinned = Option.getOrThrow(yield* updatePlan(userId, relay.id, { pinned: true }));
        yield* TestClock.adjust("1 minute");
        const again = Option.getOrThrow(yield* updatePlan(userId, relay.id, { pinned: true }));
        const listed = yield* listPlans(userId);
        const unpinned = Option.getOrThrow(yield* updatePlan(userId, relay.id, { pinned: false }));

        assert.equal(pinned.pinnedAt, pinned.createdAt + 120_000);
        assert.equal(again.pinnedAt, pinned.pinnedAt);
        assert.equal(pinned.updatedAt, relay.updatedAt);
        assert.deepEqual(
          listed.map(({ id, pinnedAt }) => [id, pinnedAt]),
          [
            [ledger.id, undefined],
            [relay.id, pinned.pinnedAt],
          ],
        );
        assert.equal("pinnedAt" in unpinned, false);
        assert.equal(
          "pinnedAt" in Option.getOrThrow(yield* readPlan(userId, relay.id)).plan,
          false,
        );
      }),
  );

  it.effect(
    "an archived plan leaves the list unless it is asked for, and comes back where it stood, its pin with it",
    () =>
      Effect.gen(function* () {
        const userId = yield* openUser;
        const relay = yield* startPlan(userId, RELAY_PLAN);
        yield* TestClock.adjust("1 minute");
        const ledger = yield* startPlan(userId, LEDGER_PLAN);
        yield* updatePlan(userId, relay.id, { pinned: true });
        yield* TestClock.adjust("1 minute");

        const archived = Option.getOrThrow(yield* updatePlan(userId, relay.id, { archived: true }));
        const listed = yield* listPlans(userId);
        const everything = yield* listPlans(userId, { includeArchived: true });
        const opened = Option.getOrThrow(yield* readPlan(userId, relay.id)).plan;
        yield* updatePlan(userId, relay.id, { archived: false });
        const restored = yield* listPlans(userId);

        assert.equal(archived.archivedAt, relay.createdAt + 120_000);
        assert.deepEqual(
          listed.map(({ id }) => id),
          [ledger.id],
        );
        assert.deepEqual(
          everything.map(({ id, archivedAt }) => [id, archivedAt]),
          [
            [ledger.id, undefined],
            [relay.id, archived.archivedAt],
          ],
        );
        assert.equal(opened.archivedAt, archived.archivedAt);
        assert.deepEqual(
          restored.map(({ id, pinnedAt, archivedAt }) => [id, pinnedAt, archivedAt]),
          [
            [ledger.id, undefined, undefined],
            [relay.id, archived.pinnedAt, undefined],
          ],
        );
      }),
  );

  it.effect("a second account cannot pin or archive another's plan", () =>
    Effect.gen(function* () {
      const owner = yield* openUser;
      const intruder = yield* openUser;
      const { id: planId } = yield* startPlan(owner, RELAY_PLAN);
      const before = yield* readPlan(owner, planId);

      assert.equal(Option.isNone(yield* updatePlan(intruder, planId, { pinned: true })), true);
      assert.equal(Option.isNone(yield* updatePlan(intruder, planId, { archived: true })), true);
      assert.deepEqual(yield* readPlan(owner, planId), before);
      assert.deepEqual(
        (yield* listPlans(owner)).map(({ id }) => id),
        [planId],
      );
    }),
  );

  it.effect("a save the store refuses is reported as not saved and the prior document stands", () =>
    Effect.gen(function* () {
      const userId = yield* openUser;
      const { id: planId } = yield* startPlan(userId, RELAY_PLAN);
      yield* saveNotes(bound(userId, planId), notesFor(INVITATIONS_DRAFT));
      const before = yield* resumedDocument(userId, planId);

      const result = yield* saveNotes(bound(userId, planId), notesFor(SMALL_FEATURE)).pipe(
        Effect.provide(noDatabase),
      );

      assert.deepEqual(result, {
        status: PLAN_SAVE_STATUS.NOT_SAVED,
        reason: PLAN_SAVE_REFUSAL.UNAVAILABLE,
      });
      assert.deepEqual(yield* resumedDocument(userId, planId), before);
    }),
  );

  it.effect("a deleted plan stays deleted: its notes answer it gone and recreate nothing", () =>
    Effect.gen(function* () {
      const userId = yield* openUser;
      const { id: planId } = yield* startPlan(userId, RELAY_PLAN);
      yield* saveNotes(bound(userId, planId), notesFor(INVITATIONS_DRAFT));

      assert.equal(yield* deletePlan(userId, planId), true);
      const result = yield* saveNotes(bound(userId, planId), notesFor(INVITATIONS_DRAFT));

      assert.deepEqual(result, {
        status: PLAN_SAVE_STATUS.NOT_SAVED,
        reason: PLAN_SAVE_REFUSAL.NO_PLAN,
      });
      assert.equal(Option.isNone(yield* readPlan(userId, planId)), true);
      assert.deepEqual(yield* listPlans(userId), []);
    }),
  );

  it.effect("the model resumes in the conversation attached to the plan", () =>
    Effect.gen(function* () {
      const userId = yield* openUser;
      const { id: planId } = yield* startPlan(userId, RELAY_PLAN);
      const conversationId = yield* openConversation(userId);

      const unattached = yield* readPlan(userId, planId);
      const attached = yield* attachPlanConversation(userId, planId, conversationId);
      const resumed = yield* readPlan(userId, planId);

      assert.deepEqual(
        Option.map(unattached, (stored) => stored.conversationId),
        Option.some(undefined),
      );
      assert.equal(attached, true);
      assert.deepEqual(
        Option.map(resumed, (stored) => stored.conversationId),
        Option.some(conversationId),
      );
    }),
  );

  it.effect(
    "a plan takes no other account's conversation, and no one attaches to another's plan",
    () =>
      Effect.gen(function* () {
        const owner = yield* openUser;
        const other = yield* openUser;
        const { id: planId } = yield* startPlan(owner, RELAY_PLAN);
        const othersConversation = yield* openConversation(other);
        const ownConversation = yield* openConversation(owner);

        assert.equal(yield* attachPlanConversation(owner, planId, othersConversation), false);
        assert.equal(yield* attachPlanConversation(other, planId, othersConversation), false);
        assert.equal(yield* attachPlanConversation(other, planId, ownConversation), false);
        assert.deepEqual(
          Option.map(yield* readPlan(owner, planId), (stored) => stored.conversationId),
          Option.some(undefined),
        );
      }),
  );

  it.effect("deleting the account deletes its plans", () =>
    Effect.gen(function* () {
      const userId = yield* openUser;
      const { id: planId } = yield* startPlan(userId, RELAY_PLAN);

      yield* deleteAccount(userId);

      assert.equal(Option.isNone(yield* readPlan(userId, planId)), true);
    }),
  );
});
