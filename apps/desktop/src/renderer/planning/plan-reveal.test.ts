import assert from "node:assert/strict";
import { EMPTY_PLAN_UPDATE, planBody } from "@sidecar/hosted/plan-template";
import { test } from "vitest";
import {
  CHASE_CHARS_PER_SECOND,
  CHASE_PACE,
  type ChaseState,
  chaseBehind,
  chaseOpened,
  chaseRetargeted,
  chaseStepped,
  chaseView,
  planUnits,
  type UnitView,
} from "./plan-reveal";

const HEADER = {
  name: "Teammate invitations",
} as const;

const NO_ASSUMPTIONS = { before: [], after: [] } as const;

/** The problem field's unit, where every test below edits. */
const PROBLEM = 2;

/** A frame at sixty a second. */
const FRAME_MS = 16;

function body(problem: string | null, outcome: string | null = null): string {
  return planBody(HEADER, {
    ...EMPTY_PLAN_UPDATE,
    goal: { problem, outcome },
  });
}

/** What a unit's view puts on screen: its words without the stretch left undrawn. */
function visible(view: UnitView | undefined): string {
  const hidden = view?.edit?.hidden;
  const words = view?.words ?? "";
  return hidden === undefined ? words : words.slice(0, hidden.from) + words.slice(hidden.to);
}

/** The words each unit puts on screen. */
function drawn(state: ChaseState): readonly string[] {
  return chaseView(state, false).map(visible);
}

function retarget(state: ChaseState, words: string, settle = false): ChaseState {
  return chaseRetargeted(state, words, NO_ASSUMPTIONS, { reduced: false, settle });
}

/** Every frame's views until the caret has nothing left, and the state it ends in. */
function played(state: ChaseState) {
  const frames: Array<readonly UnitView[]> = [];
  let now = state;
  for (let frame = 0; frame < 10_000 && chaseBehind(now); frame += 1) {
    now = chaseStepped(now, FRAME_MS);
    frames.push(chaseView(now, false));
  }
  return { frames, end: now };
}

test("the body is cut before each section and field heading, and joined back it is the body", () => {
  const words = body("Only an admin can add a member.");
  const units = planUnits(words);
  assert.equal(units[0]?.startsWith("# Teammate invitations"), true);
  assert.equal(units[1], "## Goal");
  assert.equal(units[PROBLEM], "### Problem\n\nOnly an admin can add a member.");
  assert.equal(units.join("\n\n"), words.trimEnd());
});

test("a heading the model wrote is escaped by the formatter, and one inside a fence is code; neither cuts a unit", () => {
  const plain = planUnits(body("One line."));
  assert.equal(planUnits(body("## Not a section\n\nStill the problem.")).length, plain.length);
  const fenced = planUnits(body("```\n## also code\n```"));
  assert.equal(fenced.length, plain.length);
  assert.equal(fenced[PROBLEM], "### Problem\n\n```\n## also code\n```");
});

test("an opened plan is drawn whole, and a document that changed nothing types nothing", () => {
  const words = body("Only an admin can add a member.");
  const state = chaseOpened(words);
  assert.equal(chaseBehind(state), false);
  assert.equal(chaseBehind(retarget(state, words)), false);
  assert.deepEqual(drawn(state), planUnits(words));
});

test("added words type in after the caret travels to them, at the streaming pace however many there are", () => {
  const shown = "### Problem\n\nOnly an admin.";
  const typing = retarget(
    chaseOpened(body("Only an admin.")),
    body(`Only an admin.\n\n${"word ".repeat(80)}`),
  );
  assert.equal(drawn(typing)[PROBLEM], shown);
  // The travel's pause, the two line breaks' pauses, then a second of typing.
  const elapsed = CHASE_PACE.TRAVEL_MS + 2 * CHASE_PACE.LINE_PAUSE_MS + 1_000;
  const second = chaseStepped(typing, elapsed);
  assert.equal(drawn(second)[PROBLEM]?.length, shown.length + CHASE_CHARS_PER_SECOND);
  assert.equal(chaseBehind(second), true);
});

test("a newer document mid-typing carries on from what is shown, with no jump and no restart", () => {
  const first = chaseStepped(
    retarget(chaseOpened(body(null)), body("Only an admin can")),
    CHASE_PACE.TRAVEL_MS + 1_000,
  );
  const shown = drawn(first)[PROBLEM] ?? "";
  const second = retarget(first, body("Only an admin can add a member."));
  assert.equal(drawn(second)[PROBLEM], shown);
  const typing = chaseStepped(second, 20);
  assert.equal(typing.jumps, first.jumps);
  assert.equal(drawn(typing)[PROBLEM], `${shown} add`);
});

test("a word changed mid-sentence is reached, erased, and typed over, and the words around it are never retyped", () => {
  const before = body("Only an admin can invite members.");
  const { frames, end } = played(
    retarget(chaseOpened(before), body("Only an owner can invite members."), true),
  );
  const problem = frames.map((views) => visible(views[PROBLEM]));
  assert.ok(problem.includes("### Problem\n\nOnly an ad can invite members."));
  assert.ok(problem.some((words) => /Only an (o|ow|own|owne) can invite/u.test(words)));
  assert.ok(problem.every((words) => words.endsWith(" can invite members.")));
  assert.equal(drawn(end)[PROBLEM], "### Problem\n\nOnly an owner can invite members.");
});

test("a longer stretch is selected, held a beat, and erased at once", () => {
  const before = body("Members invite by email or by a shared link.");
  const { frames, end } = played(
    retarget(chaseOpened(before), body("Members invite by email."), true),
  );
  const selections = frames
    .map((views) => views[PROBLEM]?.edit?.selection)
    .filter((selection) => selection !== undefined);
  const words = frames[0]?.[PROBLEM]?.words ?? "";
  const widest = selections.at(-1);
  assert.equal(words.slice(widest?.from, widest?.to), " or by a shared link");
  assert.ok(frames.every((views) => views[PROBLEM]?.edit?.hidden === undefined));
  assert.equal(drawn(end)[PROBLEM], "### Problem\n\nMembers invite by email.");
});

test("a bullet moved elsewhere is cut and pasted, never typed again", () => {
  const before = body(
    "- Only an admin can invite.\n- Invites go by email.\n- Links expire in a week.",
  );
  const after = body(
    "- Invites go by email.\n- Links expire in a week.\n- Only an admin can invite.",
  );
  const { frames, end } = played(retarget(chaseOpened(before), after, true));
  assert.ok(frames.some((views) => views[PROBLEM]?.edit?.selection !== undefined));
  assert.ok(frames.every((views) => views[PROBLEM]?.edit?.hidden === undefined));
  assert.deepEqual(drawn(end), planUnits(after));
});

test("a field rewritten mid-stream is held as shown until it settles, then edited in place", () => {
  const before = body("- Only an admin can invite.\n- Invites go by email.");
  const streaming = retarget(chaseOpened(before), body("- Only an owner"));
  const partway = chaseStepped(streaming, CHASE_PACE.SETTLE_MS - FRAME_MS);
  assert.equal(drawn(partway)[PROBLEM], planUnits(before)[PROBLEM]);
  // Nothing newer for the settling time: the change is read whole and made.
  assert.equal(drawn(played(partway).end)[PROBLEM], "### Problem\n\n- Only an owner");
  // A later document leaving the unit unchanged, as when the notetaker moves to the next field, settles it at once.
  const movedOn = retarget(partway, body("- Only an owner", "Members"));
  assert.equal(drawn(chaseStepped(movedOn, 1_000))[PROBLEM], "### Problem\n\n- Only an owner");
  // So does a save or the call ending.
  const saved = retarget(partway, body("- Only an owner"), true);
  assert.equal(drawn(chaseStepped(saved, 1_000))[PROBLEM], "### Problem\n\n- Only an owner");
});

test("a field growing mid-stream is typed as it arrives", () => {
  const before = body("- Only an admin can invite.");
  const streaming = retarget(
    chaseOpened(before),
    body("- Only an admin can invite.\n- Invites go"),
  );
  const typed = chaseStepped(streaming, 1_000);
  assert.equal(drawn(typed)[PROBLEM], "### Problem\n\n- Only an admin can invite.\n- Invites go");
});

test("a placeholder is never held: the first streamed words replace it", () => {
  const streaming = retarget(chaseOpened(body(null)), body("- Members"));
  assert.equal(drawn(chaseStepped(streaming, 1_000))[PROBLEM], "### Problem\n\n- Members");
});

test("one caret works through the document in order, and only one unit is written at a time", () => {
  const typing = retarget(chaseOpened(body(null)), body("Only an admin.", "Members."), true);
  const { frames, end } = played(typing);
  for (const views of frames) {
    assert.ok(views.filter((view) => view.writing).length <= 1);
    assert.ok(views.filter((view) => view.edit?.caret !== undefined).length <= 1);
  }
  const outcomeFirst = frames.findIndex((views) => visible(views[PROBLEM + 1]).includes("Members"));
  const problemDone = frames.findIndex((views) =>
    visible(views[PROBLEM]).endsWith("Only an admin."),
  );
  assert.ok(problemDone !== -1 && problemDone < outcomeFirst);
  assert.deepEqual(drawn(end), planUnits(body("Only an admin.", "Members.")));
});

test("a hand pauses at the end of a sentence", () => {
  const typing = retarget(chaseOpened(body("One")), body("One. Two."), true);
  // The travel, six letters, and a sentence's pause after each full stop.
  const total =
    CHASE_PACE.TRAVEL_MS + (6 * 1_000) / CHASE_CHARS_PER_SECOND + 2 * CHASE_PACE.SENTENCE_PAUSE_MS;
  assert.equal(chaseBehind(chaseStepped(typing, total - 1)), true);
  assert.equal(chaseBehind(chaseStepped(typing, total + 1)), false);
});

test("far behind, the pace speeds up so a long document lands in seconds", () => {
  const long = "word ".repeat(2_000).trim();
  const typing = retarget(chaseOpened(body(null)), body(long), true);
  let state = typing;
  let elapsed = 0;
  while (chaseBehind(state) && elapsed < 60_000) {
    state = chaseStepped(state, FRAME_MS);
    elapsed += FRAME_MS;
  }
  assert.equal(drawn(state)[PROBLEM], `### Problem\n\n${long}`);
  // Typed flat, ten thousand letters would take fifty seconds.
  assert.ok(elapsed < 15_000);
});

test("a unit is lit as it catches up, and reduced motion shows and lights a change at once", () => {
  const before = chaseOpened(body(null));
  const settled = played(retarget(before, body("Only an admin."), true)).end;
  assert.equal(chaseView(settled, false)[PROBLEM]?.fresh, true);
  assert.equal(chaseView(settled, false)[PROBLEM + 1]?.fresh, false);

  const reduced = chaseRetargeted(before, body("Only an admin."), NO_ASSUMPTIONS, {
    reduced: true,
    settle: false,
  });
  assert.equal(chaseBehind(reduced), false);
  assert.equal(chaseView(reduced, false)[PROBLEM]?.fresh, true);
  assert.equal(drawn(reduced)[PROBLEM], "### Problem\n\nOnly an admin.");
});

test("only an assumption the newer document added is lit", () => {
  const state = chaseRetargeted(
    chaseOpened(body(null)),
    body(null),
    { before: ["Members can invite."], after: ["Members can invite.", "Invites expire."] },
    { reduced: false, settle: false },
  );
  assert.deepEqual([...state.freshAssumptions], [1]);
});

test("once the work catches up on a live call, the caret waits where the last edit ended", () => {
  const caught = played(
    retarget(chaseOpened(body(null)), body("Only an admin.", "Members."), true),
  ).end;
  const waiting = chaseView(caught, true);
  assert.deepEqual(
    waiting.map((view) => view.resting),
    waiting.map((_, index) => index === PROBLEM + 1),
  );
  const outcome = waiting[PROBLEM + 1];
  assert.equal(outcome?.edit?.caret, outcome?.words.length);
  // Off the call, or before anything has been edited, no caret waits anywhere.
  assert.ok(chaseView(caught, false).every((view) => view.edit === undefined));
  assert.ok(chaseView(chaseOpened(body("Only an admin.")), true).every((view) => !view.resting));
});
