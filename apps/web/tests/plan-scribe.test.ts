import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { NOTE_KIND, PLAN_EMPTY_TEXT, type PlanNote } from "@sidecar/hosted/plan-template";
import { PLAN_ACTOR, PLAN_FIELD } from "@sidecar/hosted/plan-wire";
import { LIVE_BRAIN_RUN_EVENT } from "@sidecar/voice/live-session";
import { Duration, Effect, Option } from "effect";
import { TestClock } from "effect/testing";
import { user } from "../server/db/auth-schema";
import { db } from "../server/db/query";
import { saveDeveloperEdit, saveNotes } from "../server/hosted/plan-notes";
import { listRevisions } from "../server/hosted/plan-revisions";
import { createPlan, type NewPlan, readPlan } from "../server/hosted/plan-store";
import { PLAN_SCRIBE, type PlanDraft, planScribe } from "../server/voice/plan-scribe";
import { heard, said } from "./support/live-events";
import { added, INVITATIONS_DRAFT, notesFor } from "./support/plan-contents";
import { INVITATIONS_TEXT, makeDocumentPlan } from "./support/plan-documents";
import { type ScribeAnswer, scriptedScribeModel } from "./support/scribe-model";
import { testSqlClient } from "./support/sql-client";

/**
 * The planning call's notetaker over a real plan row: a scripted model stands
 * in for OpenAI and answers each run with the notes the test names, and the
 * live events are synthetic. What a test reads is what the Plans tab would:
 * the plan's saved document.
 */

const RELAY_PLAN: NewPlan = {
  name: "Teammate invitations",
};

/** The call the scribe listens to, as the voice service names it. */
const CALL = "rtc-session-plan-scribe";

const PROBLEM = "Only an admin can add someone to a workspace.";
const OUTCOME = "A member invites a teammate by email.";

const openPlan = Effect.gen(function* () {
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
  const plan = yield* createPlan(userId, RELAY_PLAN);
  return { userId, planId: plan.id };
});

const savedBody = (userId: string, planId: string) =>
  Effect.map(readPlan(userId, planId), (stored) =>
    Option.match(stored, {
      onNone: () => assert.fail("the plan did not read"),
      onSome: (found) => found.plan.document.body,
    }),
  );

/** Lets the scribe's fiber run to its next wait, the store's and the model's promises included. */
const settle = Effect.repeat(Effect.andThen(Effect.yieldNow, TestClock.adjust(Duration.zero)), {
  times: 500,
});

/** The developer's quiet elapsing, and the run it starts left to finish. */
const quiet = Effect.andThen(TestClock.adjust(Duration.millis(PLAN_SCRIBE.QUIET_MS)), settle);

/**
 * What `read` answers once it reads as `expected`, settling again between reads
 * within a bound, since how many turns of the loop a run's store work takes
 * is the machine's; what it last read either way, so a failed assertion shows
 * the value.
 */
const settledRead = <A, E, R>(read: Effect.Effect<A, E, R>, expected: (value: A) => boolean) =>
  Effect.gen(function* () {
    let value = yield* read;
    for (let attempt = 0; attempt < 50 && !expected(value); attempt += 1) {
      yield* settle;
      value = yield* read;
    }
    return value;
  });

const savedBodyOnce = (userId: string, planId: string, expected: (body: string) => boolean) =>
  settledRead(savedBody(userId, planId), expected);

/** A plan already holding the invitations draft, as an earlier run of the call left it. */
const openDraftedPlan = Effect.gen(function* () {
  const opened = yield* openPlan;
  yield* saveNotes(opened, notesFor(INVITATIONS_DRAFT));
  return opened;
});

/** The prompt text one model call was handed, read back from what the scripted model kept. */
function promptText(asked: string | undefined): string {
  const messages: readonly { role: string; content: readonly { text?: string }[] }[] = JSON.parse(
    asked ?? assert.fail("the model was not asked"),
  );
  const ask = messages.find((message) => message.role === "user");
  return ask?.content.map((part) => part.text ?? "").join("") ?? assert.fail("no user message");
}

/** A body's lines that carry words, leaving out the placeholders that give way to an answer's first words. */
function wordLinesOf(body: string): readonly string[] {
  const placeholders = Object.values(PLAN_EMPTY_TEXT);
  return body
    .split("\n")
    .filter(
      (line) =>
        line.trim().length > 0 && !placeholders.some((placeholder) => line.includes(placeholder)),
    );
}

/** The lines of an earlier body a later one no longer shows, where a line still growing counts as shown. */
function linesLost(earlier: string, later: string): readonly string[] {
  const kept = wordLinesOf(later);
  return wordLinesOf(earlier).filter((line) => !kept.some((standing) => standing.startsWith(line)));
}

const scribeFor = (userId: string, planId: string, answers: readonly ScribeAnswer[]) =>
  Effect.gen(function* () {
    const { model, asked, pace } = scriptedScribeModel(answers);
    const reports: string[] = [];
    const drafts: PlanDraft[] = [];
    const writing: boolean[] = [];
    const scribe = yield* planScribe({
      userId,
      planId,
      liveSessionId: CALL,
      model,
      onDraft: (draft) => drafts.push(draft),
      onWriting: (value) => writing.push(value),
      createId: randomUUID,
      report: (message) => reports.push(message),
    });
    return { scribe, asked, pace, reports, drafts, writing };
  });

it.layer(testSqlClient)("the plan's notetaker", (it) => {
  it.effect(
    "what the developer said is written into the plan once they have been quiet a beat",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { userId, planId } = yield* openPlan;
          const { scribe } = yield* scribeFor(userId, planId, [
            { notes: [added(PLAN_FIELD.CONTEXT, PROBLEM)] },
          ]);

          scribe.observe(said("What's the problem today?", 0, 1_200));
          scribe.observe(heard("Only admins can add people.", 1_500, 3_000));
          yield* settle;
          assert.equal((yield* savedBody(userId, planId)).includes(PROBLEM), false);

          yield* quiet;
          const body = yield* savedBodyOnce(userId, planId, (saved) => saved.includes(PROBLEM));
          assert.ok(body.includes(PROBLEM));
        }),
      ),
  );

  it.effect(
    "a call's saves are one revision of the plan, written by the notetaker on the call",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { userId, planId } = yield* openPlan;
          const { scribe } = yield* scribeFor(userId, planId, [
            { notes: [added(PLAN_FIELD.CONTEXT, PROBLEM)] },
            { notes: [added(PLAN_FIELD.GOAL, OUTCOME)] },
          ]);

          scribe.observe(heard("Only admins can add people.", 0, 1_500));
          yield* quiet;
          yield* savedBodyOnce(userId, planId, (saved) => saved.includes(PROBLEM));
          scribe.observe(heard("Members should invite by email.", 2_000, 3_500));
          yield* quiet;
          yield* savedBodyOnce(userId, planId, (saved) => saved.includes(OUTCOME));

          const { revisions } = yield* listRevisions(userId, planId);
          assert.deepEqual(
            revisions.map(({ seq, lastEdit, changes }) => ({
              seq,
              actor: lastEdit.actor,
              duringCall: lastEdit.duringCall,
              changes,
            })),
            [{ seq: 1, actor: PLAN_ACTOR.NOTETAKER, duringCall: true, changes: 2 }],
          );
        }),
      ),
  );

  it.effect(
    "a run whose notes all miss, the plan written meanwhile, sends the document back unsaved and names no edit of Luke's",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { userId, planId } = yield* openDraftedPlan;
          const find = "an admin";
          const { scribe, asked, pace, drafts } = yield* scribeFor(userId, planId, [
            {
              paced: {
                notes: [
                  { kind: NOTE_KIND.REPLACE, field: PLAN_FIELD.CONTEXT, find, text: "an owner" },
                ],
              },
            },
          ]);

          scribe.observe(heard("Owners add people, not admins.", 0, 1_000));
          yield* TestClock.adjust(Duration.millis(PLAN_SCRIBE.QUIET_MS));
          yield* settledRead(
            Effect.sync(() => asked.length),
            (count) => count > 0,
          );
          // The plan is written while the notetaker's answer is still streaming.
          yield* saveNotes({ userId, planId }, [
            { kind: NOTE_KIND.REPLACE, field: PLAN_FIELD.CONTEXT, find, text: "a manager" },
          ]);
          const written = yield* readPlan(userId, planId);
          while (pace()) yield* settle;
          const last = yield* settledRead(
            Effect.sync(() => drafts.at(-1)),
            (draft) => draft !== undefined && !draft.document.body.includes(find),
          );

          assert.equal(last?.savedAt, undefined);
          assert.equal(last?.document.body, Option.getOrThrow(written).plan.document.body);
        }),
      ),
  );

  it.effect(
    "each draft names the save the run read, and the saved one carries the fields it was formatted from and who last changed each",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { userId, planId } = yield* openDraftedPlan;
          const read = Option.getOrThrow(yield* readPlan(userId, planId));
          const { scribe, drafts } = yield* scribeFor(userId, planId, [
            { notes: [added(PLAN_FIELD.GOAL, `- ${OUTCOME}`)] },
          ]);

          scribe.observe(heard("Members should invite by email.", 0, 1_500));
          yield* quiet;
          const saved = yield* settledRead(
            Effect.sync(() => drafts.at(-1)),
            (draft) => draft?.savedAt !== undefined,
          );

          const stored = Option.getOrThrow(yield* readPlan(userId, planId));
          assert.ok(drafts.every((draft) => draft.readAt === read.plan.updatedAt));
          assert.deepEqual(saved?.fields, stored.fields);
          assert.deepEqual(saved?.fieldEdits, stored.plan.fieldEdits);
          assert.deepEqual(
            saved?.fieldEdits?.find((edit) => edit.field === PLAN_FIELD.GOAL),
            {
              field: PLAN_FIELD.GOAL,
              actor: PLAN_ACTOR.NOTETAKER,
              at: saved?.savedAt,
              duringCall: true,
            },
          );
        }),
      ),
  );

  it.effect("what Luke says is written into the plan without waiting on the developer", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { userId, planId } = yield* openPlan;
        const { scribe } = yield* scribeFor(userId, planId, [
          { notes: [added(PLAN_FIELD.CONTEXT, PROBLEM)] },
        ]);

        scribe.observe(said("So the problem is that only an admin can add someone.", 0, 2_000));
        yield* quiet;

        const body = yield* savedBodyOnce(userId, planId, (saved) => saved.includes(PROBLEM));
        assert.ok(body.includes(PROBLEM));
      }),
    ),
  );

  it.effect("the model is handed both speakers' lines and the brain's research notes", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { userId, planId } = yield* openPlan;
        const { scribe, asked } = yield* scribeFor(userId, planId, [{ notes: [] }]);

        scribe.observeRun({
          kind: LIVE_BRAIN_RUN_EVENT.REPLY_SENTENCE,
          runId: "ask-1",
          sentence: "Memberships live in src/db/schema/memberships.ts.",
        });
        scribe.observe(said("Invites could reuse memberships.", 0, 1_000));
        scribe.observe(heard("Yes, reuse them.", 1_200, 2_000));
        yield* quiet;

        const handed = yield* settledRead(
          Effect.sync(() => asked.join("\n")),
          (text) => text.length > 0,
        );
        assert.ok(handed.includes("Invites could reuse memberships."));
        assert.ok(handed.includes("Yes, reuse them."));
        assert.ok(handed.includes("src/db/schema/memberships.ts"));
      }),
    ),
  );

  it.effect("lines the developer adds while a run is out are written by the run after it", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { userId, planId } = yield* openPlan;
        const { scribe } = yield* scribeFor(userId, planId, [
          { notes: [added(PLAN_FIELD.CONTEXT, PROBLEM)] },
          { notes: [added(PLAN_FIELD.GOAL, OUTCOME)] },
        ]);

        scribe.observe(heard("Only admins can add people.", 0, 1_000));
        yield* quiet;
        scribe.observe(heard("It's for workspace members.", 5_000, 6_000));
        yield* quiet;

        const body = yield* savedBodyOnce(
          userId,
          planId,
          (saved) => saved.includes(PROBLEM) && saved.includes(OUTCOME),
        );
        assert.ok(body.includes(PROBLEM));
        assert.ok(body.includes(OUTCOME));
      }),
    ),
  );

  it.effect(
    "a run that corrects a phrase changes only that phrase, and what the run before wrote stands",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { userId, planId } = yield* openPlan;
          const corrected = "Only an owner can add someone to a workspace.";
          const { scribe } = yield* scribeFor(userId, planId, [
            { notes: [added(PLAN_FIELD.CONTEXT, PROBLEM)] },
            {
              notes: [
                {
                  kind: NOTE_KIND.REPLACE,
                  field: PLAN_FIELD.CONTEXT,
                  find: "an admin",
                  text: "an owner",
                },
                added(PLAN_FIELD.GOAL, OUTCOME),
              ],
            },
          ]);

          scribe.observe(heard("Only admins can add people.", 0, 1_000));
          yield* quiet;
          const first = yield* savedBodyOnce(userId, planId, (body) => body.includes(PROBLEM));
          assert.ok(first.includes(PROBLEM));

          scribe.observe(heard("Sorry, owners, not admins. Members should invite.", 5_000, 6_000));
          yield* quiet;

          const body = yield* savedBodyOnce(userId, planId, (saved) => saved.includes(OUTCOME));
          assert.ok(body.includes(OUTCOME));
          assert.ok(body.includes(`## Context\n\n${corrected}\n`));
        }),
      ),
  );

  it.effect(
    "a run whose call fails saves nothing, and the next run is handed those lines again",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { userId, planId } = yield* openPlan;
          const { scribe, asked, reports } = yield* scribeFor(userId, planId, [
            new Error("the provider is unavailable"),
            { notes: [added(PLAN_FIELD.CONTEXT, PROBLEM)] },
          ]);

          scribe.observe(heard("Only admins can add people.", 0, 1_000));
          yield* quiet;
          yield* settledRead(
            Effect.sync(() => reports.length),
            (count) => count > 0,
          );
          assert.equal((yield* savedBody(userId, planId)).includes(PROBLEM), false);
          assert.equal(reports.length, 1);

          scribe.observe(heard("By hand, in settings.", 5_000, 6_000));
          yield* quiet;
          assert.ok(
            (yield* savedBodyOnce(userId, planId, (body) => body.includes(PROBLEM))).includes(
              PROBLEM,
            ),
          );
          assert.ok(asked[1]?.includes("Only admins can add people."));
        }),
      ),
  );

  it.effect(
    "the plan is drafted to the device as the model writes, and the last draft is the saved plan",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { userId, planId } = yield* openPlan;
          const { scribe, drafts, writing } = yield* scribeFor(userId, planId, [
            { notes: [added(PLAN_FIELD.CONTEXT, PROBLEM), added(PLAN_FIELD.GOAL, OUTCOME)] },
          ]);

          scribe.observe(heard("Only admins can add people, and it hits members.", 0, 1_000));
          yield* TestClock.adjust(Duration.millis(PLAN_SCRIBE.QUIET_MS));
          yield* settledRead(
            Effect.sync(() => writing.length),
            (count) => count > 0,
          );
          // The model streams its answer across drafts spaced a beat apart.
          for (let beat = 0; beat < 20; beat += 1) {
            yield* Effect.andThen(
              TestClock.adjust(Duration.millis(PLAN_SCRIBE.DRAFT_EVERY_MS)),
              settle,
            );
          }

          const last = yield* settledRead(
            Effect.sync(() => drafts.at(-1)),
            (draft) => draft?.savedAt !== undefined,
          );
          assert.ok(last?.savedAt !== undefined);
          assert.equal(last.document.body, yield* savedBody(userId, planId));
          assert.ok(drafts.length >= 2);
          assert.ok(drafts.slice(0, -1).every((draft) => draft.savedAt === undefined));
        }),
      ),
  );

  it.effect("a run that breaks off mid-answer drafts the stored plan back and saves nothing", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { userId, planId } = yield* openPlan;
        const before = yield* savedBody(userId, planId);
        const { scribe, drafts, reports } = yield* scribeFor(userId, planId, [
          {
            brokenAfter: {
              notes: [added(PLAN_FIELD.CONTEXT, PROBLEM), added(PLAN_FIELD.GOAL, OUTCOME)],
            },
          },
        ]);

        scribe.observe(heard("Only admins can add people.", 0, 1_000));
        yield* quiet;
        yield* settledRead(
          Effect.sync(() => reports.length),
          (count) => count > 0,
        );

        assert.equal(yield* savedBody(userId, planId), before);
        assert.equal(drafts.at(-1)?.document.body, before);
        assert.equal(drafts.at(-1)?.savedAt, undefined);
      }),
    ),
  );

  it.effect("the notetaker is told as writing for its model call, and no longer once it ends", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { userId, planId } = yield* openPlan;
        const { scribe, writing } = yield* scribeFor(userId, planId, [
          { notes: [added(PLAN_FIELD.CONTEXT, PROBLEM)] },
        ]);

        scribe.observe(heard("Only admins can add people.", 0, 1_000));
        yield* settle;
        assert.deepEqual(writing, []);
        yield* quiet;
        yield* settledRead(
          Effect.sync(() => writing.length),
          (count) => count > 0,
        );
        // The model streams its answer across drafts spaced a beat apart.
        for (let beat = 0; beat < 20; beat += 1) {
          yield* Effect.andThen(
            TestClock.adjust(Duration.millis(PLAN_SCRIBE.DRAFT_EVERY_MS)),
            settle,
          );
        }

        const body = yield* savedBodyOnce(userId, planId, (saved) => saved.includes(PROBLEM));
        assert.ok(body.includes(PROBLEM));
        assert.deepEqual(writing, [true, false]);
      }),
    ),
  );

  it.effect("a model call that times out is told as writing until it is given up", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { userId, planId } = yield* openPlan;
        const { scribe, writing, reports } = yield* scribeFor(userId, planId, [{ stalls: true }]);

        scribe.observe(heard("Only admins can add people.", 0, 1_000));
        yield* quiet;
        yield* settledRead(
          Effect.sync(() => writing.length),
          (count) => count > 0,
        );
        // The timeout's own wait is armed just after; let the run reach it before time moves.
        yield* settle;
        assert.deepEqual(writing, [true]);

        yield* Effect.andThen(TestClock.adjust(Duration.millis(PLAN_SCRIBE.TIMEOUT_MS)), settle);
        yield* settledRead(
          Effect.sync(() => reports.length),
          (count) => count > 0,
        );
        assert.deepEqual(writing, [true, false]);
        assert.equal(reports.length, 1);
      }),
    ),
  );

  it.effect(
    "while the notes stream, no draft loses words an earlier draft showed but the phrase a correction names",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { userId, planId } = yield* openDraftedPlan;
          const stored = yield* savedBody(userId, planId);
          const find = "an admin";
          const notes: readonly PlanNote[] = [
            added(PLAN_FIELD.CONTEXT, "- Invites sent by hand are lost in email threads."),
            { kind: NOTE_KIND.REPLACE, field: PLAN_FIELD.CONTEXT, find, text: "an owner" },
            added(
              PLAN_FIELD.GOAL,
              "Members invite teammates themselves, and each invite is tracked until accepted.",
            ),
            added(
              PLAN_FIELD.TESTING,
              "- When the teammate opens the link of an invite its sender withdrew, then the link says the invite is no longer valid.",
            ),
            added(PLAN_FIELD.OPEN_QUESTIONS, "How long does an invite link stay valid?"),
          ];
          const { scribe, asked, pace, drafts } = yield* scribeFor(userId, planId, [
            { paced: { notes } },
          ]);

          scribe.observe(heard("Invites get lost, and owners add people, not admins.", 0, 1_000));
          yield* TestClock.adjust(Duration.millis(PLAN_SCRIBE.QUIET_MS));
          yield* settledRead(
            Effect.sync(() => asked.length),
            (count) => count > 0,
          );
          // Note that each chunk lands a draft's beat after the last, so a draft
          // is drawn for every one rather than for however many a machine's
          // timers happened to let through between two moves of the clock.
          while (pace()) {
            yield* settle;
            yield* Effect.andThen(
              TestClock.adjust(Duration.millis(PLAN_SCRIBE.DRAFT_EVERY_MS)),
              settle,
            );
          }
          yield* settledRead(
            Effect.sync(() => drafts.at(-1)),
            (draft) => draft?.savedAt !== undefined,
          );

          const bodies = [stored, ...drafts.map((draft) => draft.document.body)];
          const saved = yield* savedBody(userId, planId);
          assert.equal(bodies.at(-1), saved);
          assert.ok(
            bodies.some((body) => body !== stored && body !== saved),
            "a draft was drawn mid-answer",
          );
          for (const [index, body] of bodies.slice(1).entries()) {
            const lost = linesLost(bodies[index] ?? stored, body).filter(
              (line) => !line.includes(find),
            );
            assert.deepEqual(lost, [], `draft ${index + 1} lost words`);
          }
        }),
      ),
  );

  it.effect(
    "a note naming what the plan does not hold is reported, and the notes beside it save",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { userId, planId } = yield* openDraftedPlan;
          const { scribe, reports } = yield* scribeFor(userId, planId, [
            {
              notes: [
                {
                  kind: NOTE_KIND.REPLACE,
                  field: PLAN_FIELD.CONTEXT,
                  find: "a phrase nobody said",
                  text: "Everything.",
                },
                added(PLAN_FIELD.GOAL, OUTCOME),
              ],
            },
          ]);

          scribe.observe(heard("A member should invite by email.", 0, 1_000));
          yield* quiet;

          const body = yield* savedBodyOnce(userId, planId, (saved) => saved.includes(OUTCOME));
          assert.ok(body.includes(OUTCOME));
          assert.ok(body.includes(INVITATIONS_DRAFT.fields.context ?? "?"));
          assert.ok(!body.includes("Everything."));
          assert.deepEqual(reports, [
            "The plan's notetaker named what the plan does not hold: replace context",
          ]);
        }),
      ),
  );

  it.effect("the model is handed the saved plan's fields and assumptions as JSON", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { userId, planId } = yield* openDraftedPlan;
        const { scribe, asked } = yield* scribeFor(userId, planId, [{ notes: [] }]);

        scribe.observe(heard("Let's keep going.", 0, 1_000));
        yield* quiet;
        yield* settledRead(
          Effect.sync(() => asked.length),
          (count) => count > 0,
        );

        const lines = promptText(asked[0]).split("\n");
        const plan = lines[lines.indexOf("[saved plan]") + 1];
        assert.deepEqual(JSON.parse(plan ?? assert.fail("no plan after its marker")), {
          fields: INVITATIONS_DRAFT.fields,
          assumptions: INVITATIONS_DRAFT.assumptions,
        });
        assert.ok(!lines.includes("[fields the developer wrote]"));
      }),
    ),
  );

  it.effect("the model is told which fields hold the developer's own words", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { userId, planId } = yield* openDraftedPlan;
        yield* saveDeveloperEdit(
          { userId, planId },
          { field: PLAN_FIELD.APPROACH, base: null, value: "Invites expire after 7 days." },
        );
        yield* saveDeveloperEdit(
          { userId, planId },
          { field: PLAN_FIELD.INTERFACES, base: null, value: "None: no signature changes." },
        );
        const { scribe, asked } = yield* scribeFor(userId, planId, [{ notes: [] }]);

        scribe.observe(heard("Let's keep going.", 0, 1_000));
        yield* quiet;
        yield* settledRead(
          Effect.sync(() => asked.length),
          (count) => count > 0,
        );

        const lines = promptText(asked[0]).split("\n");
        assert.equal(
          lines[lines.indexOf("[fields the developer wrote]") + 1],
          `${PLAN_FIELD.APPROACH}, ${PLAN_FIELD.INTERFACES}`,
        );
      }),
    ),
  );

  it.effect(
    "a plan that is one document is not written on its template's fields: no model call, no draft, and its text stands",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { userId, planId } = yield* openPlan;
          yield* makeDocumentPlan(planId, INVITATIONS_TEXT);
          const { scribe, asked, drafts } = yield* scribeFor(userId, planId, [
            { notes: [added(PLAN_FIELD.CONTEXT, PROBLEM)] },
          ]);

          scribe.observe(heard("Only admins can add people.", 0, 1_500));
          yield* quiet;

          assert.deepEqual(asked, []);
          assert.deepEqual(drafts, []);
          assert.equal(yield* savedBody(userId, planId), INVITATIONS_TEXT);
        }),
      ),
  );
});
