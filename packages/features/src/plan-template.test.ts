import assert from "node:assert/strict";
import { unparsedWire } from "@luke/wire";
import { test } from "vitest";
import { planPicturesIn } from "./plan-attachment-link.js";
import { planSections } from "./plan-document.js";
import {
  applyNotesToText,
  NOTE_KIND,
  PLAN_HEADING,
  type PlanNote,
  readNotes,
  textNotesInProgress,
  withAgentEdit,
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

  assert.equal(missed, undefined);
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
    { kind: NOTE_KIND.REPLACE, find: "Only an admin", text: "" },
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
  assert.deepEqual(taken.missed, note);
});

test("a correction that drops a mention written as a page's address, a file's on GitHub or a plan's, is not taken", () => {
  for (const target of [
    "https://github.com/acme/checkout/blob/HEAD/src/a.ts",
    "https://tryluke.dev/acme/plan/3f6c1b2a-8d4e-4f10-9a7b-5c2d1e0fa21b#goal",
  ]) {
    const text = `## Rollout\n\n- Ship as [@a.ts](${target}) says, store first.\n`;
    const note: PlanNote = {
      kind: NOTE_KIND.REPLACE,
      find: `Ship as [@a.ts](${target}) says`,
      text: "Ship",
    };

    const taken = applyNotesToText(text, [note]);

    assert.equal(taken.text, text, target);
    assert.deepEqual(taken.missed, note, target);
  }
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
  assert.equal(taken.missed, undefined);
});

test("deleting the line a mention stands on is a retraction, and is taken", () => {
  const taken = applyNotesToText(MENTIONED, [
    {
      kind: NOTE_KIND.REPLACE,
      find: "- Ship as [@Goal](luke://plan/pl_1#Goal) says, store first.",
      text: "",
    },
  ]);

  assert.equal(taken.text.includes("[@Goal]"), false);
  assert.equal(taken.missed, undefined);
});

test("a deletion that leaves part of a line standing keeps every mention whole, or is not taken", () => {
  for (const find of ["pl_1#Goal", "as [@Goal](luke://plan/pl_1#Goal) says"]) {
    const cut: PlanNote = { kind: NOTE_KIND.REPLACE, find, text: "" };

    assert.deepEqual(applyNotesToText(MENTIONED, [cut]), { text: MENTIONED, missed: cut }, find);
  }
  const reworded: PlanNote = { kind: NOTE_KIND.REPLACE, find: ", store first", text: "" };
  assert.equal(
    applyNotesToText(MENTIONED, [reworded]).text,
    "## Rollout\n\n- Ship as [@Goal](luke://plan/pl_1#Goal) says.\n",
  );
});

test("a correction that drops one of two copies of a mention is not taken", () => {
  const text =
    "## Rollout\n\n- [@Goal](luke://plan/pl_1#Goal) first, then [@Goal](luke://plan/pl_1#Goal) again.\n";
  const note: PlanNote = {
    kind: NOTE_KIND.REPLACE,
    find: "then [@Goal](luke://plan/pl_1#Goal) again",
    text: "then ship",
  };

  assert.deepEqual(applyNotesToText(text, [note]).missed, note);
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

  assert.deepEqual(applyNotesToText(text, [note]).missed, note);
});

test("a heading is renamed by correcting its line, and a note's words open sections of their own", () => {
  const { text, missed } = applyNotesToText(DOCUMENT, [
    { kind: NOTE_KIND.REPLACE, find: "## Hard parts", text: "## Risks" },
    add(PLAN_HEADING.GOAL, "## Rollout\n\n- Desktop first."),
  ]);

  assert.equal(missed, undefined);
  assert.deepEqual(
    planSections(text).map((section) => section.heading),
    ["Context", "Goal", "Rollout", "Risks", "Assumptions"],
  );
  assert.equal(text.includes("\\#"), false);
});

/** A whole section of DOCUMENT as a find copies it, heading and all. */
const ASSUMPTIONS_SECTION = "## Assumptions\n\n- Invites expire after 7 days.";

test("an empty replacement deletes, taking out the lines it leaves empty, so a section is struck whole", () => {
  const struck = applyNotesToText(DOCUMENT, [
    { kind: NOTE_KIND.REPLACE, find: "## Hard parts", text: "" },
    { kind: NOTE_KIND.REPLACE, find: "Only an admin", text: "" },
  ]);

  assert.equal(struck.missed, undefined);
  assert.equal(
    struck.text,
    [
      "## Context",
      "",
      " can add someone.",
      "",
      "## Goal",
      "",
      "- Members invite by email.",
      "",
      "## Assumptions",
      "",
      "- Invites expire after 7 days.",
      "",
    ].join("\n"),
  );
});

test("a section is moved by deleting it where it stands and writing it in front of another", () => {
  const moved = applyNotesToText(DOCUMENT, [
    { kind: NOTE_KIND.REPLACE, find: ASSUMPTIONS_SECTION, text: "" },
    { kind: NOTE_KIND.REPLACE, find: "## Goal", text: `${ASSUMPTIONS_SECTION}\n\n## Goal` },
  ]);

  assert.equal(moved.missed, undefined);
  assert.deepEqual(
    planSections(moved.text).map((section) => section.heading),
    ["Context", "Assumptions", "Goal", "Hard parts"],
  );
  assert.equal(moved.text.endsWith("## Hard parts\n"), true);
});

test("a batch with one note naming what the text does not hold exactly once takes none of its notes", () => {
  const twice = `${DOCUMENT}\n## Goal\n\n- A second goal section.\n`;
  const cases: readonly { text: string; note: PlanNote }[] = [
    {
      text: DOCUMENT,
      note: { kind: NOTE_KIND.REPLACE, find: "a phrase the plan never held", text: "x" },
    },
    { text: DOCUMENT, note: { kind: NOTE_KIND.REPLACE, find: "## Rollout", text: "" } },
    { text: twice, note: add(PLAN_HEADING.GOAL, "- Lands nowhere.") },
    { text: twice, note: { kind: NOTE_KIND.REPLACE, find: "## Goal", text: "## Goals" } },
  ];
  for (const { text, note } of cases) {
    // The deletion before the miss is half of a move, and must not land without it.
    const taken = applyNotesToText(text, [
      { kind: NOTE_KIND.REPLACE, find: "Only an admin can add someone.", text: "" },
      note,
    ]);

    assert.equal(taken.text, text, note.kind);
    assert.deepEqual(taken.missed, note, note.kind);
  }
});

test("a draft takes the notes so far up to the first that cannot be taken", () => {
  const draft = textNotesInProgress(
    DOCUMENT,
    unparsedWire({
      notes: [
        add(PLAN_HEADING.GOAL, "- Admins can withdraw an invite."),
        { kind: NOTE_KIND.REPLACE, find: "## Rollout", text: "" },
        add(PLAN_HEADING.CONTEXT, "It came up in support."),
        { kind: NOTE_KIND.ADD, section: PLAN_HEADING.HARD_PARTS, text: "- A link" },
      ],
    }),
  );

  assert.equal(draft.includes("Admins can withdraw an invite."), true);
  assert.equal(draft.includes("It came up in support."), false);
  assert.equal(draft.includes("A link"), false);
});

test("a deletion across lines ending on a line break takes out those lines and not the one after", () => {
  const text = "## Goal\n\n- A\n- B\n- C\n";

  const taken = applyNotesToText(text, [{ kind: NOTE_KIND.REPLACE, find: "- A\n- B\n", text: "" }]);

  assert.equal(taken.text, "## Goal\n\n- C\n");
});

test("an agent's deletion is journaled as a strike, and a long replaced text is cut to what the earlier deployment reads", () => {
  const long = "x".repeat(800);

  const [edit] = withAgentEdit([], {
    agentId: "agent-1",
    at: 1,
    notes: [
      { kind: NOTE_KIND.REPLACE, find: "Only an admin", text: "" },
      { kind: NOTE_KIND.REPLACE, find: long, text: "y" },
    ],
  });

  assert.deepEqual(edit?.notes, [
    { kind: NOTE_KIND.REMOVE, find: "Only an admin" },
    { kind: NOTE_KIND.REPLACE, find: "x".repeat(500), text: "y" },
  ]);
});

/** A picture's address in a plan's text, under the plan's own address. */
const PICTURE_ADDRESS =
  "https://tryluke.dev/acme/plan/3f6c1b2a-8d4e-4f10-9a7b-5c2d1e0fa21b/files/9d2e4c61-7a3b-4f0e-8b1a-2c6d4e8f0a13";

/** A picture's line as the plan's text writes it: alt text, address, and caption. */
const PICTURE_LINE = `![Members page with two pending invites](${PICTURE_ADDRESS} "Pending invites sit in the list")`;

/** A plan's text holding a picture on its own line, between two points. */
const PICTURED = [
  "## Approach",
  "",
  "- The members page lists pending invites.",
  "",
  PICTURE_LINE,
  "",
  "- An invite expires after 7 days.",
  "",
].join("\n");

test("a correction that drops a picture the plan held is not taken", () => {
  const note: PlanNote = {
    kind: NOTE_KIND.REPLACE,
    find: `invites.\n\n${PICTURE_LINE}`,
    text: "invites, shown on the members page.",
  };

  const taken = applyNotesToText(PICTURED, [note]);

  assert.equal(taken.text, PICTURED);
  assert.deepEqual(taken.missed, note);
});

test("a correction that leaves a picture's address drawing no picture, as a link, a line left open, or behind an escaped !, is not taken", () => {
  for (const broken of [
    `[Members page with two pending invites](${PICTURE_ADDRESS})`,
    `![Members page with two pending invites](${PICTURE_ADDRESS}`,
    `\\![Members page with two pending invites](${PICTURE_ADDRESS})`,
  ]) {
    const note: PlanNote = { kind: NOTE_KIND.REPLACE, find: PICTURE_LINE, text: broken };

    assert.deepEqual(applyNotesToText(PICTURED, [note]).missed, note, broken);
  }
});

test("a picture whose alt text holds a bracketed phrase, or whose caption stands in single quotes or parentheses, is kept like any other", () => {
  for (const line of [
    `![Mock [v2]](${PICTURE_ADDRESS})`,
    `![Mock](${PICTURE_ADDRESS} 'Version two')`,
    `![Mock](${PICTURE_ADDRESS} (Version two))`,
  ]) {
    const note: PlanNote = { kind: NOTE_KIND.REPLACE, find: line, text: "No mock" };

    assert.deepEqual(applyNotesToText(`## Approach\n\n${line}\n`, [note]).missed, note, line);
  }
});

test("a correction that rewords a picture's alt text and caption, or moves it within the phrase it corrects, keeping its address, is taken", () => {
  const rewordedLine = `![Members page: one member, two pending invites](${PICTURE_ADDRESS})`;
  const reworded = applyNotesToText(PICTURED, [
    { kind: NOTE_KIND.REPLACE, find: PICTURE_LINE, text: rewordedLine },
  ]);
  const moved = applyNotesToText(PICTURED, [
    {
      kind: NOTE_KIND.REPLACE,
      find: `- The members page lists pending invites.\n\n${PICTURE_LINE}`,
      text: `${PICTURE_LINE}\n\n- The members page lists pending invites first.`,
    },
  ]);

  assert.equal(reworded.missed, undefined);
  assert.ok(reworded.text.split("\n").includes(rewordedLine));
  assert.equal(moved.missed, undefined);
  assert.ok(
    moved.text.startsWith(
      `## Approach\n\n${PICTURE_LINE}\n\n- The members page lists pending invites first.`,
    ),
  );
});

test("a correction that puts a picture in code, where it draws no picture, is not taken", () => {
  for (const text of ["```md\n" + PICTURE_LINE + "\n```", `\`${PICTURE_LINE}\``]) {
    const note: PlanNote = { kind: NOTE_KIND.REPLACE, find: PICTURE_LINE, text };

    assert.deepEqual(applyNotesToText(PICTURED, [note]), { text: PICTURED, missed: note }, text);
  }
});

test("a correction inside an indented code block at the text's start is no picture to keep", () => {
  const text = `    ![example](${PICTURE_ADDRESS})\n`;

  const taken = applyNotesToText(text, [
    { kind: NOTE_KIND.REPLACE, find: `![example](${PICTURE_ADDRESS})`, text: "example" },
  ]);

  assert.deepEqual(taken, { text: "    example\n" });
});

test("deleting the line a picture stands on is a retraction, and is taken, while a deletion within it is not", () => {
  const taken = applyNotesToText(PICTURED, [
    { kind: NOTE_KIND.REPLACE, find: PICTURE_LINE, text: "" },
  ]);
  const cut: PlanNote = { kind: NOTE_KIND.REPLACE, find: "![Members page", text: "" };

  assert.deepEqual(planPicturesIn(taken.text), []);
  assert.equal(taken.missed, undefined);
  assert.deepEqual(applyNotesToText(PICTURED, [cut]).missed, cut);
});
