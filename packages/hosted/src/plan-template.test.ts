import assert from "node:assert/strict";
import { unparsedWire } from "@sidecar/wire";
import { test } from "vitest";
import {
  applyNotesToText,
  NOTE_KIND,
  PLAN_HEADING,
  type PlanNote,
  textNotesInProgress,
} from "./plan-template.js";

function add(section: string, text: string): PlanNote {
  return { kind: NOTE_KIND.ADD, section, text };
}

const DOCUMENT = [
  "## Context",
  "",
  "Only an admin can add someone.",
  "",
  "## Goal",
  "",
  "- Members invite by email.",
  "",
  "## Hard parts",
  "",
  "## Assumptions",
  "",
  "- Invites expire after 7 days.",
  "",
].join("\n");

test("a note lands at the end of the section under its heading, as written: a bullet under a list, a paragraph under prose, a heading alone filled", () => {
  const { text, missed } = applyNotesToText(DOCUMENT, [
    add(PLAN_HEADING.GOAL, "- Admins can withdraw an invite."),
    add(PLAN_HEADING.CONTEXT, "It came up in support."),
    add(PLAN_HEADING.HARD_PARTS, "- A link opened twice grants once."),
    add(PLAN_HEADING.ASSUMPTIONS, "- Members and admins both invite."),
  ]);

  assert.deepEqual(missed, []);
  assert.equal(
    text,
    [
      "## Context",
      "",
      "Only an admin can add someone.",
      "",
      "It came up in support.",
      "",
      "## Goal",
      "",
      "- Members invite by email.",
      "- Admins can withdraw an invite.",
      "",
      "## Hard parts",
      "",
      "- A link opened twice grants once.",
      "",
      "## Assumptions",
      "",
      "- Invites expire after 7 days.",
      "- Members and admins both invite.",
      "",
    ].join("\n"),
  );
});

function replace(find: string, text: string): PlanNote {
  return { kind: NOTE_KIND.REPLACE, find, text };
}

const LISTED = [
  "## Goal",
  "",
  "- Members invite by email.",
  "",
  "## Hard parts",
  "",
  "- A link opened twice grants once.",
  "",
].join("\n");

test("a note's own list markers and nesting land at the one level of the list it joins", () => {
  const { text, missed } = applyNotesToText(LISTED, [
    add(PLAN_HEADING.GOAL, "- - Admins can withdraw an invite."),
    add(
      PLAN_HEADING.GOAL,
      "- Invites show who sent them.\n  - Resent invites keep their sender.\n    - - Expired invites say so.",
    ),
    add(PLAN_HEADING.HARD_PARTS, "  * A revoked link answers gone."),
  ]);

  assert.deepEqual(missed, []);
  assert.equal(
    text,
    [
      "## Goal",
      "",
      "- Members invite by email.",
      "- Admins can withdraw an invite.",
      "- Invites show who sent them.",
      "- Resent invites keep their sender.",
      "- Expired invites say so.",
      "",
      "## Hard parts",
      "",
      "- A link opened twice grants once.",
      "* A revoked link answers gone.",
      "",
    ].join("\n"),
  );
});

test("a correction of an item's words written as a bullet keeps the item at its level, however often it is corrected", () => {
  const once = applyNotesToText(LISTED, [
    replace("Members invite by email.", "- Members invite by email or link."),
  ]);
  const twice = applyNotesToText(once.text, [
    replace("Members invite by email or link.", "- - Members invite by link."),
  ]);

  assert.deepEqual([...once.missed, ...twice.missed], []);
  assert.equal(twice.text, LISTED.replace("Members invite by email.", "Members invite by link."));
});

test("a correction that names an item's marker with its words keeps the marker it writes", () => {
  const { text } = applyNotesToText(LISTED, [
    replace("- Members invite by email.", "1. Members invite by email."),
  ]);

  assert.equal(text, LISTED.replace("- Members invite by email.", "1. Members invite by email."));
});

test("a note's rule and fenced code are kept as written, not read as nested items", () => {
  const code = ["```md", "- - kept as code", "  - indented in code", "```"].join("\n");
  const { text } = applyNotesToText(LISTED, [
    add(PLAN_HEADING.HARD_PARTS, `Invites as stored:\n\n${code}\n\n- - -`),
  ]);

  assert.ok(text.includes(`${code}\n\n- - -\n`));
});

test("the streamed draft draws a note's list at the one level its save does", () => {
  const notes = [
    { kind: NOTE_KIND.ADD, section: PLAN_HEADING.GOAL, text: "- - Admins can withdraw an invite." },
    {
      kind: NOTE_KIND.REPLACE,
      find: "Members invite by email.",
      text: "- Members invite by link.",
    },
  ];

  const saved = applyNotesToText(LISTED, notes).text;
  const drafted = textNotesInProgress(LISTED, unparsedWire({ notes: [...notes, {}] }));

  assert.equal(drafted, saved);
  assert.ok(!saved.includes("- -"));
});
