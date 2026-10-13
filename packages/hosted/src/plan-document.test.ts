import assert from "node:assert/strict";
import { test } from "vitest";
import { changedSections, planSections, sectionWritersOf } from "./plan-document.js";
import { PLAN_ACTOR, PLAN_SECTION_BOUNDS } from "./plan-wire.js";

const TEXT = [
  "A note before any heading.",
  "",
  "## Context",
  "",
  "Only an admin can add someone.",
  "",
  "### Today",
  "",
  "Admins add people by hand.",
  "",
  "# Goal ##",
  "",
  "```md",
  "## Not a heading",
  "```",
  "",
  "##Not a heading either",
].join("\n");

test("a section is a # or ## heading and what stands under it, a deeper heading or a fenced one inside it", () => {
  const sections = planSections(TEXT);

  assert.deepEqual(
    sections.map(({ from, to, text }) => TEXT.slice(from, to) === text),
    [true, true, true],
  );
  assert.deepEqual(
    sections.map(({ heading, text }) => ({ heading, text })),
    [
      { heading: "", text: "A note before any heading." },
      {
        heading: "Context",
        text: "## Context\n\nOnly an admin can add someone.\n\n### Today\n\nAdmins add people by hand.",
      },
      {
        heading: "Goal",
        text: "# Goal ##\n\n```md\n## Not a heading\n```\n\n##Not a heading either",
      },
    ],
  );
});

test("a fence is closed only by a run of its own character at least as long", () => {
  const text = "## Approach\n\n````\n```\n## Still code\n````\n\n## Testing\n";

  assert.deepEqual(
    planSections(text).map((section) => section.heading),
    ["Approach", "Testing"],
  );
});

test("a heading past the bound is known by its first words, and an empty text has no section", () => {
  const long = "x".repeat(PLAN_SECTION_BOUNDS.MAX_HEADING_CHARS + 10);

  assert.equal(
    planSections(`## ${long}\n`)[0]?.heading.length,
    PLAN_SECTION_BOUNDS.MAX_HEADING_CHARS,
  );
  assert.deepEqual(planSections(""), []);
  assert.deepEqual(planSections("\n\n"), []);
});

test("the sections a change moved are its changed, added, and second-of-a-name sections, never one it left alone", () => {
  const before =
    "## Context\n\nAdmins only.\n\n## Goal\n\nInvite by email.\n\n## Notes\n\nOne.\n\n## Notes\n\nTwo.\n";
  const after =
    "## Context\n\nAdmins only.\n\n## Goal\n\nInvite by email or link.\n\n## Notes\n\nOne.\n\n## Notes\n\nTwo, again.\n\n## Risks\n\nSpam.\n";

  assert.deepEqual(changedSections(before, after), ["Goal", "Notes", "Risks"]);
  assert.deepEqual(changedSections(after, before), ["Goal", "Notes", "Risks"]);
  assert.deepEqual(changedSections(before, before), []);
});

test("each section names the newest revision that changed it, and a section none changed or the text no longer holds names nobody", () => {
  const base = "## Context\n\n## Goal\n\n## Risks\n";
  const noted =
    "## Context\n\nAdmins only.\n\n## Goal\n\nInvite by email.\n\n## Old\n\nGone soon.\n\n## Risks\n";
  const edited = "## Context\n\nAdmins only.\n\n## Goal\n\nInvite by link.\n\n## Risks\n";

  assert.deepEqual(
    sectionWritersOf(base, [
      { text: noted, who: { actor: PLAN_ACTOR.NOTETAKER, duringCall: true }, at: 1 },
      { text: edited, who: { actor: PLAN_ACTOR.DEVELOPER }, at: 5 },
    ]),
    [
      { section: "Context", actor: PLAN_ACTOR.NOTETAKER, duringCall: true, at: 1 },
      { section: "Goal", actor: PLAN_ACTOR.DEVELOPER, at: 5 },
    ],
  );
  assert.deepEqual(sectionWritersOf(base, []), []);
});

test("a heading renamed with nothing beneath it changed keeps its writer, and one renamed with its words changed names the renamer", () => {
  const base = "## Goal\n\n## Risks\n";
  const noted = "## Goal\n\nInvite by email.\n\n## Risks\n\nSpam.\n";
  const renamed = "## Goals\n\nInvite by email.\n\n## Dangers\n\nSpam and abuse.\n";
  const agentWrote = "## Goals\n\nInvite by email or link.\n\n## Dangers\n\nSpam and abuse.\n";
  const noter = { text: noted, who: { actor: PLAN_ACTOR.NOTETAKER }, at: 1 };
  const renamer = { text: renamed, who: { actor: PLAN_ACTOR.DEVELOPER }, at: 5 };

  assert.deepEqual(sectionWritersOf(base, [noter, renamer]), [
    { section: "Goals", actor: PLAN_ACTOR.NOTETAKER, at: 1 },
    { section: "Dangers", actor: PLAN_ACTOR.DEVELOPER, at: 5 },
  ]);
  assert.deepEqual(
    sectionWritersOf(base, [
      noter,
      renamer,
      { text: agentWrote, who: { actor: PLAN_ACTOR.AGENT, agentId: "agent-1" }, at: 9 },
    ]),
    [
      { section: "Dangers", actor: PLAN_ACTOR.DEVELOPER, at: 5 },
      { section: "Goals", actor: PLAN_ACTOR.AGENT, agentId: "agent-1", at: 9 },
    ],
  );
});

test("a heading's closing hashes are no part of its words, and a long run of tabs or hashes reads at once", () => {
  const tabs = "\t".repeat(50_000);

  assert.deepEqual(
    planSections("## Goal ##\n\n## C# ##\n\n## # #\n").map((section) => section.heading),
    ["Goal", "C#", "#"],
  );
  const { MAX_HEADING_CHARS } = PLAN_SECTION_BOUNDS;
  assert.equal(
    planSections(`##${tabs}x${tabs}#${tabs}y`)[0]?.heading,
    `x${tabs}`.slice(0, MAX_HEADING_CHARS),
  );
  assert.equal(planSections(`## x ${"#".repeat(50_000)}`)[0]?.heading, "x");
});

test("a fence line labelled like an opening is code inside a fence, not its close", () => {
  const text = "## Approach\n\n```md\n```js\n## Still code\n```\n\n## Testing\n";

  assert.deepEqual(
    planSections(text).map((section) => section.heading),
    ["Approach", "Testing"],
  );
});
