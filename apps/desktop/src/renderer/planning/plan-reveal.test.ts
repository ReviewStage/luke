import assert from "node:assert/strict";
import { EMPTY_PLAN_UPDATE, planBody } from "@sidecar/hosted/plan-template";
import { test } from "vitest";
import {
  CHASE_BASE_CHARS_PER_SECOND,
  CHASE_CATCH_UP_MS,
  type ChaseState,
  chaseBehind,
  chaseOpened,
  chaseRetargeted,
  chaseStepped,
  chaseView,
  planUnits,
} from "./plan-reveal";

const HEADER = {
  name: "Teammate invitations",
  repository: { owner: "acme", name: "relay", branch: "main", commit: "4f2c9e1" },
} as const;

const NO_ASSUMPTIONS = { before: [], after: [] } as const;

function body(problem: string | null, users: string | null = null): string {
  return planBody(HEADER, {
    ...EMPTY_PLAN_UPDATE,
    purpose: { ...EMPTY_PLAN_UPDATE.purpose, problem, users },
  });
}

/** The words each unit draws, cut where its reveal stops. */
function drawn(state: ChaseState): readonly string[] {
  return chaseView(state).map((view) =>
    view.reveal === undefined ? view.words : view.words.slice(0, view.reveal.upTo),
  );
}

function retarget(state: ChaseState, words: string): ChaseState {
  return chaseRetargeted(state, words, NO_ASSUMPTIONS, false);
}

test("the body is cut before each section and field heading, and joined back it is the body", () => {
  const words = body("Only an admin can add a member.");
  const units = planUnits(words);
  assert.equal(units[0]?.startsWith("# Teammate invitations"), true);
  assert.equal(units[1], "## Purpose and users");
  assert.equal(units[2], "### Problem\n\nOnly an admin can add a member.");
  assert.equal(units.join("\n\n"), words.trimEnd());
});

test("a heading the model wrote is escaped by the formatter, and one inside a fence is code; neither cuts a unit", () => {
  const plain = planUnits(body("One line."));
  assert.equal(planUnits(body("## Not a section\n\nStill the problem.")).length, plain.length);
  const fenced = planUnits(body("```\n## also code\n```"));
  assert.equal(fenced.length, plain.length);
  assert.equal(fenced[2], "### Problem\n\n```\n## also code\n```");
});

test("an opened plan is drawn whole, and a document that changed nothing types nothing", () => {
  const words = body("Only an admin can add a member.");
  const state = chaseOpened(words);
  assert.equal(chaseBehind(state), false);
  assert.equal(chaseBehind(retarget(state, words)), false);
  assert.deepEqual(drawn(state), planUnits(words));
});

test("added words type in from where the shown words end, at the base pace plus the backlog's share", () => {
  const before = body("Only an admin.");
  const after = body("Only an admin.\n\nBy hand, from the settings page.");
  const added = "\n\nBy hand, from the settings page.".length;
  const typing = retarget(chaseOpened(before), after);
  assert.equal(drawn(typing)[2], "### Problem\n\nOnly an admin.");

  const perSecond = CHASE_BASE_CHARS_PER_SECOND + (added * 1_000) / CHASE_CATCH_UP_MS;
  const tenth = chaseStepped(typing, 100);
  assert.equal(
    drawn(tenth)[2]?.length,
    "### Problem\n\nOnly an admin.".length + Math.floor(perSecond / 10),
  );
  assert.equal(chaseBehind(chaseStepped(typing, CHASE_CATCH_UP_MS)), false);
});

test("however long the backlog, it clears inside the catch-up window", () => {
  const long = "A sentence the scribe wrote. ".repeat(200);
  const typing = retarget(chaseOpened(body(null)), body(long));
  assert.equal(chaseBehind(chaseStepped(typing, CHASE_CATCH_UP_MS - 50)), true);
  assert.equal(chaseBehind(chaseStepped(typing, CHASE_CATCH_UP_MS)), false);
});

test("a newer document mid-typing carries on from what is shown rather than restarting", () => {
  const opened = chaseOpened(body(null));
  const first = chaseStepped(retarget(opened, body("Only an admin can")), 100);
  const shown = drawn(first)[2] ?? "";
  const second = retarget(first, body("Only an admin can add a member."));
  assert.equal(drawn(second)[2], shown);
});

test("a rewrite cuts back to the start of the line that changed and types forward", () => {
  const typing = retarget(chaseOpened(body("Only an admin.")), body("Any member."));
  assert.equal(drawn(typing)[2], "### Problem\n\n");
});

test("units behind type in document order, with the caret and the writing mark on the first", () => {
  const typing = retarget(chaseOpened(body(null)), body("Only an admin.", "Members."));
  const views = chaseView(typing);
  assert.deepEqual(
    views.map((view) => [view.reveal?.caret, view.writing]),
    views.map((_, index) =>
      index === 2 ? [true, true] : index === 3 ? [false, false] : [undefined, false],
    ),
  );
  // Spent in order: the first field finishes before the second moves.
  const partway = chaseStepped(typing, 50);
  assert.equal(drawn(partway)[3], "### Users\n\n");
});

test("a unit is lit as it catches up, and reduced motion shows and lights a change at once", () => {
  const before = chaseOpened(body(null));
  const settled = chaseStepped(retarget(before, body("Only an admin.")), CHASE_CATCH_UP_MS);
  assert.equal(chaseView(settled)[2]?.fresh, true);
  assert.equal(chaseView(settled)[3]?.fresh, false);

  const reduced = chaseRetargeted(before, body("Only an admin."), NO_ASSUMPTIONS, true);
  assert.equal(chaseBehind(reduced), false);
  assert.equal(chaseView(reduced)[2]?.fresh, true);
});

test("only an assumption the newer document added is lit", () => {
  const state = chaseRetargeted(
    chaseOpened(body(null)),
    body(null),
    { before: ["Members can invite."], after: ["Members can invite.", "Invites expire."] },
    false,
  );
  assert.deepEqual([...state.freshAssumptions], [1]);
});
