import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { db } from "@sidecar/database/core/query";
import { deleteAccount, writePlanTemplate } from "@sidecar/database/models/account-store";
import {
  attachPlanConversation,
  createPlan,
  deletePlan,
  listPlans,
  readPlan,
  savePlanText,
  updatePlan,
} from "@sidecar/database/models/plan-store";
import { user } from "@sidecar/database/schemas/auth";
import { conversations } from "@sidecar/database/schemas/storage";
import { CONVERSATION_KIND } from "@sidecar/database/storage-vocabulary";
import { getTestDB } from "@sidecar/database/testing";
import { planSections } from "@sidecar/hosted/plan-document";
import { DEFAULT_PLAN_TEMPLATE } from "@sidecar/hosted/plan-document-template";
import { NOTE_KIND, PLAN_HEADING, type PlanNote } from "@sidecar/hosted/plan-template";
import type { PlanDocument } from "@sidecar/hosted/plan-wire";
import { Duration, Effect, Option } from "effect";
import { TestClock } from "effect/testing";
import {
  PLAN_SAVE_REFUSAL,
  PLAN_SAVE_STATUS,
  type PlanDocumentBinding,
  type PlanSaveResult,
  saveDeveloperEdit,
  saveNotes,
} from "../server/hosted/plan-notes";
import { noDatabase } from "./support/no-database";
import { added } from "./support/plan-contents";
import { INVITATIONS_TEXT, makeDocumentPlan } from "./support/plan-documents";
import { joinWorkspace, openWorkspace, startPlan, type TestPlan } from "./support/workspaces";

/**
 * The named plans and their one document, through the store's public
 * functions and `saveNotes`, the plan's one write, against a real dialect.
 * Every plan is one Markdown text: each note lands in the section under the
 * heading it names and nowhere else, and what is saved is the text the window
 * and the planning model both read (`readPlan`). Nothing but the binding the
 * service built names the account and the plan, so no note can move a save
 * onto another account's plan, bring a deleted plan back, or leave an
 * oversized document saved.
 *
 * Synthetic accounts, repositories, and plans throughout.
 */

const RELAY_PLAN: TestPlan = {
  name: "Teammate invitations",
};

const LEDGER_PLAN: TestPlan = {
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

/** A note correcting a phrase of the plan. */
function replaced(find: string, text: string): PlanNote {
  return { kind: NOTE_KIND.REPLACE, find, text };
}

/** A note striking the line of the plan that holds a phrase. */
function removed(find: string): PlanNote {
  return { kind: NOTE_KIND.REMOVE, find };
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

  it.effect("two named plans keep independent documents", () =>
    Effect.gen(function* () {
      const userId = yield* openUser;
      const relay = yield* startPlan(userId, RELAY_PLAN);
      const ledger = yield* startPlan(userId, LEDGER_PLAN);

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
        const { id: planId } = yield* startPlan(userId, RELAY_PLAN);

        const saved = savedDocument(yield* saveNotes(bound(userId, planId), INVITATIONS_NOTES));

        assert.deepEqual(yield* resumedDocument(userId, planId), saved);
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
    "a note fills a section still holding the account's template's guidance in place of it, and the next is added after it",
    () =>
      Effect.gen(function* () {
        const userId = yield* openUser;
        yield* writePlanTemplate(userId, "## Why\n\nSay why.\n\n## How\n\nSay how.\n");
        yield* TestClock.adjust(Duration.minutes(1));
        const { id: planId } = yield* createPlan(userId, RELAY_PLAN);
        yield* TestClock.adjust(Duration.hours(1));
        // The template changing after the plan started leaves the guidance the plan holds its template's.
        yield* writePlanTemplate(userId, "## Why\n\nSay why, briefly.\n");

        yield* saveNotes(bound(userId, planId), [added("Why", "- Invites are manual.")]);
        const { body } = savedDocument(
          yield* saveNotes(bound(userId, planId), [added("Why", "- Support asked twice.")]),
        );

        assert.equal(
          body,
          "## Why\n\n- Invites are manual.\n- Support asked twice.\n\n## How\n\nSay how.\n",
        );
      }),
  );

  it.effect(
    "a note on a default plan replaces a section's guidance nobody wrote over, and is added after the developer's words",
    () =>
      Effect.gen(function* () {
        const userId = yield* openUser;
        const { id: planId } = yield* createPlan(userId, RELAY_PLAN);
        const binding = bound(userId, planId);
        const base = DEFAULT_PLAN_TEMPLATE;
        const guidance = sectionText(base, "Context").split("\n").at(-1) ?? "";
        yield* saveDeveloperEdit(binding, {
          document: { base, value: base.replace(guidance, `${guidance} Invites are manual.`) },
        });

        const { body } = savedDocument(
          yield* saveNotes(binding, [
            added(PLAN_HEADING.CONTEXT, INVITATIONS_CONTEXT),
            added(PLAN_HEADING.GOAL, "- Members invite by email."),
          ]),
        );

        assert.equal(
          sectionText(body, "Context"),
          `## Context\n\n${guidance} Invites are manual.\n\n${INVITATIONS_CONTEXT}`,
        );
        assert.equal(sectionText(body, "Goal"), "## Goal\n\n- Members invite by email.");
      }),
  );

  it.effect("a note under a heading the text does not hold opens that section at its end", () =>
    Effect.gen(function* () {
      const userId = yield* openUser;
      const { id: planId } = yield* startPlan(userId, RELAY_PLAN);
      yield* makeDocumentPlan(planId, "## Why\n\nInvites are manual.\n");

      const { body } = savedDocument(
        yield* saveNotes(bound(userId, planId), [
          added(PLAN_HEADING.OPEN_QUESTIONS, "- Who can withdraw an invite?"),
        ]),
      );

      assert.equal(
        body,
        "## Why\n\nInvites are manual.\n\n## Open questions\n\n- Who can withdraw an invite?\n",
      );
    }),
  );

  it.effect("a proposal, a correction, and a strike each save in the section they name", () =>
    Effect.gen(function* () {
      const userId = yield* openUser;
      const { id: planId } = yield* startPlan(userId, RELAY_PLAN);
      const binding = bound(userId, planId);
      const everyMember = "Any member may invite by email.";
      const adminsOnly = "Only admins may invite, by email.";
      const noContract = "Not applicable: no contract outside the app changes.";

      yield* saveNotes(binding, [
        added(PLAN_HEADING.HARD_PARTS, everyMember),
        added(PLAN_HEADING.ASSUMPTIONS, "- Invites expire after a day."),
      ]);
      const proposed = yield* resumedDocument(userId, planId);
      // Corrected: the hard part is rewritten, the assumption struck, and the interfaces said not to apply.
      yield* saveNotes(binding, [
        replaced(everyMember, adminsOnly),
        removed("expire after a day"),
        added(PLAN_HEADING.INTERFACES, noContract),
      ]);
      const settled = yield* resumedDocument(userId, planId);

      assert.ok(sectionText(proposed.body, "Hard parts").endsWith(`\n\n${everyMember}`));
      assert.ok(
        sectionText(proposed.body, "Assumptions").endsWith("\n\n- Invites expire after a day."),
      );
      assert.ok(sectionText(settled.body, "Hard parts").endsWith(`\n\n${adminsOnly}`));
      assert.ok(!settled.body.includes(everyMember));
      // The assumption took the guidance's place, so striking it leaves the section empty.
      assert.equal(sectionText(settled.body, "Assumptions"), "## Assumptions");
      assert.ok(sectionText(settled.body, "Interfaces").endsWith(`\n\n${noContract}`));
    }),
  );

  it.effect(
    "a note adds after what its section holds, and every section it does not name keeps what stood",
    () =>
      Effect.gen(function* () {
        const userId = yield* openUser;
        const { id: planId } = yield* startPlan(userId, RELAY_PLAN);
        yield* makeDocumentPlan(planId, INVITATIONS_TEXT);

        const result = yield* saveNotes(bound(userId, planId), [
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
        assert.deepEqual(yield* resumedDocument(userId, planId), { body, assumptions });
      }),
  );

  it.effect(
    "a note naming a phrase the plan does not hold is passed over, and the notes beside it save",
    () =>
      Effect.gen(function* () {
        const userId = yield* openUser;
        const { id: planId } = yield* startPlan(userId, RELAY_PLAN);
        yield* makeDocumentPlan(planId, INVITATIONS_TEXT);
        const outcome = "A member invites a teammate by email.";
        const unheld = [
          replaced("a phrase nobody said", "Everything."),
          removed("Invites expire in a day."),
          removed("a hard part nobody named"),
        ];

        const result = yield* saveNotes(bound(userId, planId), [
          ...unheld,
          added(PLAN_HEADING.GOAL, outcome),
        ]);

        const { body } = savedDocument(result);
        assert.deepEqual(result.status === PLAN_SAVE_STATUS.SAVED && result.missed, unheld);
        assert.ok(sectionText(body, "Goal").endsWith(`\n\n${outcome}`));
        assert.equal(body.replace(`\n\n${outcome}`, ""), INVITATIONS_TEXT);
      }),
  );

  it.effect("notes that would carry the text past the plan's bound are refused whole", () =>
    Effect.gen(function* () {
      const userId = yield* openUser;
      const { id: planId } = yield* startPlan(userId, RELAY_PLAN);
      yield* saveNotes(bound(userId, planId), INVITATIONS_NOTES);
      const before = yield* resumedDocument(userId, planId);
      const long = "x".repeat(40_000);
      const oversized = [
        PLAN_HEADING.GOAL,
        PLAN_HEADING.APPROACH,
        PLAN_HEADING.INTERFACES,
        PLAN_HEADING.NOT_DOING,
        PLAN_HEADING.TESTING,
      ].map((heading) => added(heading, long));

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
        yield* saveNotes(bound(userId, relay.id), INVITATIONS_NOTES);

        const listed = yield* listPlans(userId);
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
        const started = yield* startPlan(starter, RELAY_PLAN);
        yield* joinWorkspace(started.workspaceId, teammate);

        assert.deepEqual(
          (yield* listPlans(teammate)).map((plan) => plan.id),
          [started.id],
        );
        assert.deepEqual(yield* resumedDocument(teammate, started.id), started.document);
        const renamed = yield* updatePlan(teammate, started.id, { name: "Shared invitations" });
        assert.deepEqual(
          Option.map(renamed, (plan) => plan.name),
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

        assert.deepEqual(yield* listPlans(stranger), []);
        assert.equal(Option.isNone(yield* readPlan(stranger, started.id)), true);
        assert.equal(yield* deletePlan(stranger, started.id), false);

        assert.equal(yield* deletePlan(teammate, started.id), true);
        assert.equal(Option.isNone(yield* readPlan(starter, started.id)), true);
      }),
  );

  it.effect("a second account cannot read, write, or delete another's plan", () =>
    Effect.gen(function* () {
      const owner = yield* openUser;
      const intruder = yield* openUser;
      const { id: planId } = yield* startPlan(owner, RELAY_PLAN);
      yield* saveNotes(bound(owner, planId), INVITATIONS_NOTES);
      const saved = yield* resumedDocument(owner, planId);

      const result = yield* saveNotes(bound(intruder, planId), EMPTY_STATE_NOTES);

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

  it.effect("a renamed plan lists and opens under its new name, its text as it stood", () =>
    Effect.gen(function* () {
      const userId = yield* openUser;
      const relay = yield* startPlan(userId, RELAY_PLAN);
      const ledger = yield* startPlan(userId, LEDGER_PLAN);
      yield* saveNotes(bound(userId, relay.id), INVITATIONS_NOTES);
      const saved = yield* resumedDocument(userId, relay.id);

      const renamed = yield* updatePlan(userId, relay.id, { name: "Team invites" });
      yield* updatePlan(userId, ledger.id, { name: "Billing exports" });

      const plan = Option.getOrThrow(renamed);
      assert.equal(plan.name, "Team invites");
      assert.deepEqual(plan.document, saved);
      assert.deepEqual(yield* resumedDocument(userId, relay.id), saved);
      assert.deepEqual(
        new Map((yield* listPlans(userId)).map(({ id, name }) => [id, name])),
        new Map([
          [ledger.id, "Billing exports"],
          [relay.id, "Team invites"],
        ]),
      );
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
      yield* saveNotes(bound(userId, planId), INVITATIONS_NOTES);
      const before = yield* resumedDocument(userId, planId);

      const result = yield* saveNotes(bound(userId, planId), EMPTY_STATE_NOTES).pipe(
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
      yield* saveNotes(bound(userId, planId), INVITATIONS_NOTES);

      assert.equal(yield* deletePlan(userId, planId), true);
      const result = yield* saveNotes(bound(userId, planId), INVITATIONS_NOTES);

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
