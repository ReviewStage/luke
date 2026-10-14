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

/** A plan's text holding a mention the developer placed. */
const MENTIONED = "## Rollout\n\n- Ship as [@Goal](luke://plan/pl_1#Goal) says, store first.\n";

test("a correction that drops a mention the developer placed is not taken", () => {
  const note: PlanNote = {
    kind: NOTE_KIND.REPLACE,
    find: "Ship as [@Goal](luke://plan/pl_1#Goal) says",
    text: "Ship",
  };

  const taken = applyNotesToText(MENTIONED, [note]);

  assert.equal(taken.text, MENTIONED);
  assert.deepEqual(taken.missed, [note]);
});

test("a correction that rewords around a mention, keeping it, is taken", () => {
  const taken = applyNotesToText(MENTIONED, [
    {
      kind: NOTE_KIND.REPLACE,
      find: "Ship as [@Goal](luke://plan/pl_1#Goal) says, store first",
      text: "Ship in the order [@Goal](luke://plan/pl_1#Goal) gives, desktop first",
    },
  ]);

  assert.equal(
    taken.text,
    "## Rollout\n\n- Ship in the order [@Goal](luke://plan/pl_1#Goal) gives, desktop first.\n",
  );
  assert.deepEqual(taken.missed, []);
});

test("striking the line a mention stands on is a retraction, and is taken", () => {
  const taken = applyNotesToText(MENTIONED, [{ kind: NOTE_KIND.REMOVE, find: "Ship as" }]);

  assert.equal(taken.text.includes("[@Goal]"), false);
  assert.deepEqual(taken.missed, []);
});

test("a correction that drops one of two copies of a mention is not taken", () => {
  const text =
    "## Rollout\n\n- [@Goal](luke://plan/pl_1#Goal) first, then [@Goal](luke://plan/pl_1#Goal) again.\n";
  const note: PlanNote = {
    kind: NOTE_KIND.REPLACE,
    find: "then [@Goal](luke://plan/pl_1#Goal) again",
    text: "then ship",
  };

  assert.deepEqual(applyNotesToText(text, [note]).missed, [note]);
});

test("a correction that drops a mention past the plan's twentieth is not taken", () => {
  const many = Array.from({ length: 21 }, (_, at) => `- see [@f${at}](luke://file/f${at}.ts)`).join(
    "\n",
  );
  const text = `## Files\n\n${many}\n`;
  const note: PlanNote = {
    kind: NOTE_KIND.REPLACE,
    find: "see [@f20](luke://file/f20.ts)",
    text: "see nothing",
  };

  assert.deepEqual(applyNotesToText(text, [note]).missed, [note]);
});
