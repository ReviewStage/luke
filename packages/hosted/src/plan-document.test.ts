import assert from "node:assert/strict";
import { test } from "vitest";
import { changedSections, planSections, withSectionWriters } from "./plan-document.js";
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
  assert.deepEqual(planSections(TEXT), [
    { heading: "", text: "A note before any heading." },
    {
      heading: "Context",
      text: "## Context\n\nOnly an admin can add someone.\n\n### Today\n\nAdmins add people by hand.",
    },
    {
      heading: "Goal",
      text: "# Goal ##\n\n```md\n## Not a heading\n```\n\n##Not a heading either",
    },
  ]);
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
  assert.deepEqual(changedSections(before, before), []);
});

test("a save names its writer on each section it moved, keeps the rest, and forgets a section the text no longer holds", () => {
  const before =
    "## Context\n\nAdmins only.\n\n## Goal\n\nInvite by email.\n\n## Old\n\nGone soon.\n";
  const after = "## Context\n\nAdmins only.\n\n## Goal\n\nInvite by link.\n";
  const writers = [
    { section: "Context", actor: PLAN_ACTOR.NOTETAKER, at: 1 },
    { section: "Goal", actor: PLAN_ACTOR.NOTETAKER, at: 1 },
    { section: "Old", actor: PLAN_ACTOR.NOTETAKER, at: 1 },
  ];

  assert.deepEqual(
    withSectionWriters(writers, { before, after }, { actor: PLAN_ACTOR.DEVELOPER }, 5),
    [
      { section: "Context", actor: PLAN_ACTOR.NOTETAKER, at: 1 },
      { section: "Goal", actor: PLAN_ACTOR.DEVELOPER, at: 5 },
    ],
  );
});
