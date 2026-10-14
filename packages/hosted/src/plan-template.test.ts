import assert from "node:assert/strict";
import { unparsedWire } from "@sidecar/wire";
import { test } from "vitest";
import {
  applyNotesToText,
  NOTE_KIND,
  PLAN_HEADING,
  type PlanNote,
  readNotes,
} from "./plan-template.js";
import { PLAN_FIELD } from "./plan-wire.js";

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

test("a note naming a field rather than a heading is passed over, and a correction's field is dropped like any key a note does not name, while heading notes read as written", () => {
  const headingNotes = [
    add(PLAN_HEADING.GOAL, "- Admins can withdraw an invite."),
    { kind: NOTE_KIND.REMOVE, find: "Only an admin" },
  ];
  const read = readNotes(
    unparsedWire({
      notes: [
        { kind: NOTE_KIND.ADD, field: PLAN_FIELD.OPEN_QUESTIONS, text: "Who may withdraw?" },
        headingNotes[0],
        { kind: NOTE_KIND.REPLACE, field: PLAN_FIELD.CONTEXT, find: "an admin", text: "a member" },
        headingNotes[1],
      ],
    }),
  );

  assert.deepEqual(read, {
    notes: [
      headingNotes[0],
      { kind: NOTE_KIND.REPLACE, find: "an admin", text: "a member" },
      headingNotes[1],
    ],
    unread: 1,
  });
});
