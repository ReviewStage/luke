import assert from "node:assert/strict";
import { planSections } from "@sidecar/hosted/plan-document";
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
  type UnitView,
} from "./plan-reveal";

/** The words before the text's first heading, a unit of their own. */
const INTRO = "Started from the team's template.";

/** The context section's unit, where every test below edits. */
const CONTEXT = 1;

/** A frame at sixty a second. */
const FRAME_MS = 16;

/** A section: its heading alone while it holds nothing. */
function section(heading: string, words: string): string {
  return words === "" ? heading : `${heading}\n\n${words}`;
}

/** A plan's text: the words before its first heading, then a context and a goal. */
function body(context = "", goal = ""): string {
  return `${[INTRO, section("## Context", context), section("## Goal", goal)].join("\n\n")}\n`;
}

/** A text holding a context, an approach, and a testing section, with `between` after the approach. */
function sectioned(between = ""): string {
  const sections = [
    "## Context\n\nOnly an admin can invite.",
    "## Approach\n\n- `invites.ts` sends it.",
    ...(between === "" ? [] : [between]),
    "## Testing",
  ];
  return `${sections.join("\n\n")}\n`;
}

/** The words of each unit a body is cut into, a unit to each section. */
function planUnits(words: string): readonly string[] {
  return planSections(words).map((section) => section.text);
}

/** What the unit opening with a heading puts on screen, if one does. */
function drawnUnder(views: readonly UnitView[], heading: string): string | undefined {
  const view = views.find((candidate) => visible(candidate).startsWith(heading));
  return view === undefined ? undefined : visible(view);
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

function retarget(state: ChaseState, words: string): ChaseState {
  return chaseRetargeted(state, words, { reduced: false });
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

test("the body is cut before each section heading, and joined back it is the body", () => {
  const words = body("Only an admin can add a member.");
  const units = drawn(chaseOpened(words));
  assert.equal(units[0], INTRO);
  assert.equal(units[CONTEXT], "## Context\n\nOnly an admin can add a member.");
  assert.equal(units[CONTEXT + 1], "## Goal");
  assert.equal(units.join("\n\n"), words.trimEnd());
});

test("an opened plan is drawn whole, and a document that changed nothing types nothing", () => {
  const words = body("Only an admin can add a member.");
  const state = chaseOpened(words);
  assert.equal(chaseBehind(state), false);
  assert.equal(chaseBehind(retarget(state, words)), false);
  assert.deepEqual(drawn(state), planUnits(words));
});

test("added words type in after the caret travels to them, at the streaming pace however many there are", () => {
  const shown = "## Context\n\nOnly an admin.";
  const typing = retarget(
    chaseOpened(body("Only an admin.")),
    body(`Only an admin.\n\n${"word ".repeat(80)}`),
  );
  assert.equal(drawn(typing)[CONTEXT], shown);
  // The travel's pause, the two line breaks' pauses, then a second of typing.
  const elapsed = CHASE_PACE.TRAVEL_MS + 2 * CHASE_PACE.LINE_PAUSE_MS + 1_000;
  const second = chaseStepped(typing, elapsed);
  assert.equal(drawn(second)[CONTEXT]?.length, shown.length + CHASE_CHARS_PER_SECOND);
  assert.equal(chaseBehind(second), true);
});

test("a newer document mid-typing carries on from what is shown, with no jump and no restart", () => {
  const first = chaseStepped(
    retarget(chaseOpened(body()), body("Only an admin can")),
    CHASE_PACE.TRAVEL_MS + 1_000,
  );
  const shown = drawn(first)[CONTEXT] ?? "";
  const second = retarget(first, body("Only an admin can add a member."));
  assert.equal(drawn(second)[CONTEXT], shown);
  const typing = chaseStepped(second, 20);
  assert.equal(typing.jumps, first.jumps);
  assert.equal(drawn(typing)[CONTEXT], `${shown} add`);
});

test("a word changed mid-sentence is reached, erased, and typed over, and the words around it are never retyped", () => {
  const before = body("Only an admin can invite members.");
  const { frames, end } = played(
    retarget(chaseOpened(before), body("Only an owner can invite members.")),
  );
  const context = frames.map((views) => visible(views[CONTEXT]));
  assert.ok(context.includes("## Context\n\nOnly an ad can invite members."));
  assert.ok(context.some((words) => /Only an (o|ow|own|owne) can invite/u.test(words)));
  assert.ok(context.every((words) => words.endsWith(" can invite members.")));
  assert.equal(drawn(end)[CONTEXT], "## Context\n\nOnly an owner can invite members.");
});

test("a longer stretch is selected, held a beat, and erased at once", () => {
  const before = body("Members invite by email or by a shared link.");
  const { frames, end } = played(retarget(chaseOpened(before), body("Members invite by email.")));
  const selections = frames
    .map((views) => views[CONTEXT]?.edit?.selection)
    .filter((selection) => selection !== undefined);
  const words = frames[0]?.[CONTEXT]?.words ?? "";
  const widest = selections.at(-1);
  assert.equal(words.slice(widest?.from, widest?.to), " or by a shared link");
  assert.ok(frames.every((views) => views[CONTEXT]?.edit?.hidden === undefined));
  assert.equal(drawn(end)[CONTEXT], "## Context\n\nMembers invite by email.");
});

test("a section growing mid-stream is typed as it arrives", () => {
  const before = body("- Only an admin can invite.");
  const streaming = retarget(
    chaseOpened(before),
    body("- Only an admin can invite.\n- Invites go"),
  );
  const typed = chaseStepped(streaming, 1_000);
  assert.equal(drawn(typed)[CONTEXT], "## Context\n\n- Only an admin can invite.\n- Invites go");
});

test("one caret works through the document in order, and only one unit is written at a time", () => {
  const typing = retarget(chaseOpened(body()), body("Only an admin.", "Members."));
  const { frames, end } = played(typing);
  for (const views of frames) {
    assert.ok(views.filter((view) => view.writing).length <= 1);
    assert.ok(views.filter((view) => view.edit?.caret !== undefined).length <= 1);
  }
  const goalFirst = frames.findIndex((views) => visible(views[CONTEXT + 1]).includes("Members"));
  const contextDone = frames.findIndex((views) =>
    visible(views[CONTEXT]).endsWith("Only an admin."),
  );
  assert.ok(contextDone !== -1 && contextDone < goalFirst);
  assert.deepEqual(drawn(end), planUnits(body("Only an admin.", "Members.")));
});

test("a hand pauses at the end of a sentence", () => {
  const typing = retarget(chaseOpened(body("One")), body("One. Two."));
  // The travel, six letters, and a sentence's pause after each full stop.
  const total =
    CHASE_PACE.TRAVEL_MS + (6 * 1_000) / CHASE_CHARS_PER_SECOND + 2 * CHASE_PACE.SENTENCE_PAUSE_MS;
  assert.equal(chaseBehind(chaseStepped(typing, total - 1)), true);
  assert.equal(chaseBehind(chaseStepped(typing, total + 1)), false);
});

test("far behind, the pace speeds up so a long document lands in seconds", () => {
  const long = "word ".repeat(2_000).trim();
  const typing = retarget(chaseOpened(body()), body(long));
  let state = typing;
  let elapsed = 0;
  while (chaseBehind(state) && elapsed < 60_000) {
    state = chaseStepped(state, FRAME_MS);
    elapsed += FRAME_MS;
  }
  assert.equal(drawn(state)[CONTEXT], `## Context\n\n${long}`);
  // Typed flat, ten thousand letters would take fifty seconds.
  assert.ok(elapsed < 15_000);
});

test("a unit is lit as it catches up, and reduced motion shows and lights a change at once", () => {
  const before = chaseOpened(body());
  const settled = played(retarget(before, body("Only an admin."))).end;
  assert.equal(chaseView(settled, false)[CONTEXT]?.fresh, true);
  assert.equal(chaseView(settled, false)[CONTEXT + 1]?.fresh, false);

  const reduced = chaseRetargeted(before, body("Only an admin."), { reduced: true });
  assert.equal(chaseBehind(reduced), false);
  assert.equal(chaseView(reduced, false)[CONTEXT]?.fresh, true);
  assert.equal(drawn(reduced)[CONTEXT], "## Context\n\nOnly an admin.");
});

test("once the work catches up on a live call, the caret waits where the last edit ended", () => {
  const caught = played(retarget(chaseOpened(body()), body("Only an admin.", "Members."))).end;
  const waiting = chaseView(caught, true);
  assert.deepEqual(
    waiting.map((view) => view.resting),
    waiting.map((_, index) => index === CONTEXT + 1),
  );
  const goal = waiting[CONTEXT + 1];
  assert.equal(goal?.edit?.caret, goal?.words.length);
  // Off the call, or before anything has been edited, no caret waits anywhere.
  assert.ok(chaseView(caught, false).every((view) => view.edit === undefined));
  assert.ok(chaseView(chaseOpened(body("Only an admin.")), true).every((view) => !view.resting));
});

test("an empty section takes the first words of a note", () => {
  const streaming = retarget(chaseOpened(body()), body("- Members"));
  assert.equal(drawn(chaseStepped(streaming, 1_000))[CONTEXT], "## Context\n\n- Members");
});

test("a section that leaves is erased where it stands, and the sections after it keep their words", () => {
  const before = sectioned("## Plan of attack\n\n1. The schema first.");
  const after = sectioned();
  const { frames, end } = played(retarget(chaseOpened(before), after));
  // The leaving section is selected before it goes, rather than vanishing.
  assert.ok(
    frames.some((views) =>
      views.some(
        (view) => view.words.startsWith("## Plan of attack") && view.edit?.selection !== undefined,
      ),
    ),
  );
  for (const views of frames) {
    assert.equal(drawnUnder(views, "## Testing"), "## Testing");
  }
  assert.deepEqual(drawn(end), planUnits(after));
});

test("only a section's heading cuts a unit: a deeper heading stays inside the section it stands in", () => {
  const words = "# Teammate invitations\n\n## Approach\n\n### Data\n\nA pending row.";
  assert.deepEqual(drawn(chaseOpened(words)), [
    "# Teammate invitations",
    "## Approach\n\n### Data\n\nA pending row.",
  ]);
});

/** A plan's text: words before its first heading, a `#` section, and a fence holding heading-shaped lines. */
const DOCUMENT_TEXT = [
  "Started from the team's template.",
  "# Goal",
  "Invites land by email.",
  "## Approach",
  "~~~sh\n# not a heading\n## nor this\n~~~",
  "## Assumptions",
  "- Links are single use.",
].join("\n\n");

test("a plan's text is cut at each `#` or `##` heading outside a fence, each unit known by its heading", () => {
  const views = chaseView(chaseOpened(DOCUMENT_TEXT), false);

  assert.deepEqual(
    views.map((view) => [view.heading, view.words]),
    [
      ["", "Started from the team's template."],
      ["Goal", "# Goal\n\nInvites land by email."],
      ["Approach", "## Approach\n\n~~~sh\n# not a heading\n## nor this\n~~~"],
      ["Assumptions", "## Assumptions\n\n- Links are single use."],
    ],
  );
});

test("a `#` section of a document joining it types in where it stands, and no other unit is touched", () => {
  const after = DOCUMENT_TEXT.replace("## Approach", "# Rollout\n\nBehind a flag.\n\n## Approach");
  const { frames, end } = played(retarget(chaseOpened(DOCUMENT_TEXT), after));

  for (const views of frames) {
    assert.equal(drawnUnder(views, "# Goal"), "# Goal\n\nInvites land by email.");
    assert.equal(drawnUnder(views, "## Assumptions"), "## Assumptions\n\n- Links are single use.");
  }
  assert.ok(
    frames.some((views) => views.some((view) => view.writing && view.heading === "Rollout")),
  );
  assert.deepEqual(
    chaseView(end, false).map((view) => view.heading),
    ["", "Goal", "Rollout", "Approach", "Assumptions"],
  );
});

test("a selection the newer words no longer erase is dropped rather than finished", () => {
  const words = "Members invite by email or by a shared link.";
  let state = retarget(chaseOpened(body(words)), body("Members invite by email."));
  while (chaseView(state, false)[CONTEXT]?.edit?.selection === undefined) {
    state = chaseStepped(state, FRAME_MS);
  }
  const { frames, end } = played(retarget(state, body(words)));
  assert.ok(frames.every((views) => visible(views[CONTEXT]).endsWith(words)));
  assert.equal(drawn(end)[CONTEXT], `## Context\n\n${words}`);
});
