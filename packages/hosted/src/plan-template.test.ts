import assert from "node:assert/strict";
import { isRecord, type UnparsedWireValue, unparsedWire, valueFromJsonText } from "@sidecar/wire";
import { test } from "vitest";
import {
  applyNotesToText,
  NOTE_KIND,
  PLAN_AGENT_EDITS_KEPT,
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

/** The JSON a model has emitted so far for an answer, cut at `chars`, closed the way a streaming parser closes it. */
function partialOf(notes: readonly PlanNote[], chars: number): UnparsedWireValue {
  const text = JSON.stringify({ notes }).slice(0, chars);
  // A cut inside a key, an escape, or a literal reads at the last place that parses.
  for (let cut = text.length; cut > 0; cut -= 1) {
    const read = valueFromJsonText(closed(text.slice(0, cut)));
    if (isRecord(read)) return read;
  }
  return unparsedWire({});
}

/** A cut-off JSON text with its open string, then its open arrays and objects, closed. */
function closed(head: string): string {
  const closers: string[] = [];
  let inString = false;
  for (let at = 0; at < head.length; at += 1) {
    const letter = head[at];
    if (inString) {
      if (letter === "\\") at += 1;
      else if (letter === '"') inString = false;
    } else if (letter === '"') inString = true;
    else if (letter === "{") closers.push("}");
    else if (letter === "[") closers.push("]");
    else if (letter === "}" || letter === "]") closers.pop();
  }
  return `${head}${inString ? '"' : ""}${closers.reverse().join("")}`;
}

test("the agents' journal keeps the newest saves and lets the oldest go past its bound", () => {
  const note = add(PLAN_HEADING.APPROACH, "x");
  let journal: ReturnType<typeof withAgentEdit> = [];
  for (let at = 1; at <= PLAN_AGENT_EDITS_KEPT + 2; at += 1) {
    journal = withAgentEdit(journal, { agentId: "agent", at, notes: [note] });
  }
  assert.equal(journal.length, PLAN_AGENT_EDITS_KEPT);
  assert.equal(journal[0]?.at, 3);
  assert.equal(journal.at(-1)?.at, PLAN_AGENT_EDITS_KEPT + 2);
});

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

/** A template whose sections each hold one line of guidance, as the default's do. */
const TEMPLATE = [
  "## Context",
  "",
  "Why this work exists.",
  "",
  "## Goal",
  "",
  "What is true once it ships.",
  "",
].join("\n");

test("a point added to a section still holding only its template's guidance takes the guidance's place, and the next point is added after it", () => {
  const notes = [
    add(PLAN_HEADING.CONTEXT, "- Only an admin can add someone."),
    add(PLAN_HEADING.CONTEXT, "- It came up in support."),
  ];
  const { text, missed } = applyNotesToText(TEMPLATE, notes, TEMPLATE);

  assert.deepEqual(missed, []);
  assert.equal(
    text,
    [
      "## Context",
      "",
      "- Only an admin can add someone.",
      "- It came up in support.",
      "",
      "## Goal",
      "",
      "What is true once it ships.",
      "",
    ].join("\n"),
  );
  // The draft drawn while the notes stream lands them as the save does.
  const partial = valueFromJsonText(JSON.stringify({ notes }));
  assert.equal(textNotesInProgress(TEMPLATE, partial, TEMPLATE), text);
});

test("a section whose guidance the developer wrote over keeps every word, the point added after them", () => {
  const edited = TEMPLATE.replace("Why this work exists.", "Why this work exists. Support asked.");
  const { text } = applyNotesToText(
    edited,
    [add(PLAN_HEADING.CONTEXT, "It came up twice.")],
    TEMPLATE,
  );

  assert.ok(
    text.startsWith("## Context\n\nWhy this work exists. Support asked.\n\nIt came up twice.\n"),
  );
});

test("a plan whose template is not known has a point added after the guidance", () => {
  const { text } = applyNotesToText(TEMPLATE, [add(PLAN_HEADING.GOAL, "Members invite by email.")]);

  assert.ok(text.endsWith("## Goal\n\nWhat is true once it ships.\n\nMembers invite by email.\n"));
});

test("a note under a heading the document does not hold opens that section at the end, and a heading in a note's words is written as words", () => {
  const { text } = applyNotesToText(DOCUMENT, [
    add(PLAN_HEADING.TESTING, "- When an invite expires, then its link says so.\n## Not a heading"),
  ]);

  assert.ok(
    text.endsWith(
      "- Invites expire after 7 days.\n\n## Testing\n\n- When an invite expires, then its link says so.\n\\## Not a heading\n",
    ),
  );
});

test("a correction or a strike names a phrase standing once in the whole document and touching no heading, or it is passed over", () => {
  const corrected = applyNotesToText(DOCUMENT, [
    { kind: NOTE_KIND.REPLACE, find: "an admin", text: "an owner" },
    { kind: NOTE_KIND.REMOVE, find: "invite by email" },
    { kind: NOTE_KIND.REPLACE, find: "Goal", text: "Outcome" },
    { kind: NOTE_KIND.REMOVE, find: "days" },
    { kind: NOTE_KIND.REMOVE, find: "an" },
  ]);

  assert.deepEqual(
    corrected.missed.map((note) => note.kind),
    [NOTE_KIND.REPLACE, NOTE_KIND.REMOVE],
  );
  assert.ok(corrected.text.includes("Only an owner can add someone."));
  assert.ok(corrected.text.includes("## Goal\n\n## Hard parts"));
  assert.ok(corrected.text.endsWith("## Assumptions\n"));
});

test("a document drawn while notes stream holds every whole note and the point still being written", () => {
  const partial = unparsedWire({
    notes: [
      add(PLAN_HEADING.GOAL, "- Admins can withdraw."),
      add(PLAN_HEADING.CONTEXT, "It came up"),
    ],
  });

  const drawn = textNotesInProgress(DOCUMENT, partial);

  assert.ok(drawn.includes("- Members invite by email.\n- Admins can withdraw.\n"));
  assert.ok(drawn.includes("Only an admin can add someone.\n\nIt came up\n"));
});

test("a correction inside a fence is written as code, and a point after an open fence closes it first", () => {
  const text = "## Interfaces\n\n```c\nOLD\n```\n\n## Approach\n\n```ts\ntype User = string;";

  const { text: noted, missed } = applyNotesToText(text, [
    { kind: NOTE_KIND.REPLACE, find: "OLD", text: "#define NEW" },
    add(PLAN_HEADING.APPROACH, "Users are strings."),
    add(PLAN_HEADING.TESTING, "- When a user signs in, then it works."),
  ]);

  assert.deepEqual(missed, []);
  assert.equal(
    noted,
    "## Interfaces\n\n```c\n#define NEW\n```\n\n## Approach\n\n```ts\ntype User = string;\n```\n\nUsers are strings.\n\n## Testing\n\n- When a user signs in, then it works.\n",
  );
});

test("a note under a heading the document holds twice lands in the first section under it", () => {
  const text = "## Notes\n\nFirst.\n\n## Goal\n\nShip.\n\n## Notes\n\nSecond.\n";

  const noted = applyNotesToText(text, [add("Notes", "Added.")]);

  assert.equal(
    noted.text,
    "## Notes\n\nFirst.\n\nAdded.\n\n## Goal\n\nShip.\n\n## Notes\n\nSecond.\n",
  );
});

test("while the answer streams, each draft differs from the last only where the newest note lands", () => {
  const notes: PlanNote[] = [
    add(PLAN_HEADING.GOAL, "- Invites are lost in email."),
    { kind: NOTE_KIND.REPLACE, find: "an admin", text: "an owner" },
    add(PLAN_HEADING.TESTING, "- When an invite expires, then its link says so."),
  ];
  const whole = JSON.stringify({ notes }).length;
  const drafts: string[] = [];
  for (let chars = 1; chars <= whole; chars += 1) {
    drafts.push(textNotesInProgress(DOCUMENT, partialOf(notes, chars)));
  }
  // Every draft is either the one before or the one before with one stretch changed.
  for (const [index, draft] of drafts.entries()) {
    const before = drafts[index - 1] ?? DOCUMENT;
    let head = 0;
    while (head < before.length && before[head] === draft[head]) head += 1;
    let tail = 0;
    while (
      tail < before.length - head &&
      tail < draft.length - head &&
      before[before.length - 1 - tail] === draft[draft.length - 1 - tail]
    ) {
      tail += 1;
    }
    const erased = before.slice(head, before.length - tail);
    // The only erasure a stream makes is the correction's own phrase, once it is whole.
    assert.ok(["", "admin"].includes(erased), `draft ${index} erased ${JSON.stringify(erased)}`);
  }
  // The added point grows letter by letter rather than landing whole.
  assert.ok(
    drafts.some((draft) => draft.includes("- Invites are lo") && !draft.includes("in email")),
  );
  // A correction is drawn only once it is whole, never half-typed.
  assert.ok(drafts.every((draft) => !/an (?:o|ow|own|owne) can/u.test(draft)));
  assert.equal(drafts.at(-1), applyNotesToText(DOCUMENT, notes).text);
});

test("while the answer streams, a note that does not read is passed over without holding back the notes after it", () => {
  const partial = unparsedWire({
    notes: [
      { kind: "rewrite", section: PLAN_HEADING.CONTEXT, text: "Everything." },
      { kind: NOTE_KIND.ADD, text: "Lost." },
      { kind: NOTE_KIND.ADD, section: PLAN_HEADING.GOAL, text: "- Members invite.", extra: true },
      { kind: NOTE_KIND.ADD, section: PLAN_HEADING.HARD_PARTS, text: "" },
    ],
  });

  const drawn = textNotesInProgress(DOCUMENT, partial);

  assert.equal(
    drawn,
    DOCUMENT.replace(
      "- Members invite by email.\n",
      "- Members invite by email.\n- Members invite.\n",
    ),
  );
});

test("while the answer streams, a line still being written as nothing but Markdown markers is held back, so its escaping never flickers", () => {
  const growing = (text: string) =>
    textNotesInProgress(
      DOCUMENT,
      unparsedWire({ notes: [{ kind: NOTE_KIND.ADD, section: PLAN_HEADING.GOAL, text }] }),
    );
  const goalHolding = (point: string) =>
    DOCUMENT.replace("- Members invite by email.\n", `- Members invite by email.\n${point}\n`);

  assert.equal(growing("- Signatures:\n#"), goalHolding("- Signatures:"));
  assert.equal(growing("- Signatures:\n- "), goalHolding("- Signatures:"));
  assert.equal(growing("- Signatures:\n#tag"), goalHolding("- Signatures:\n#tag"));
});

test("a note in the fixed template's shape reads as the note under its field's heading: a text field's as written, a list's item behind one marker, a correction within its section", () => {
  const { notes, unread } = readNotes(
    unparsedWire({
      notes: [
        { kind: NOTE_KIND.ADD, field: PLAN_FIELD.CONTEXT, text: "It came up in support." },
        { kind: NOTE_KIND.ADD, field: PLAN_FIELD.OPEN_QUESTIONS, text: "Who can resend?" },
        { kind: NOTE_KIND.ADD, field: PLAN_FIELD.ASSUMPTIONS, text: "1. Links are single use." },
        { kind: NOTE_KIND.REPLACE, field: PLAN_FIELD.CONTEXT, find: "an admin", text: "an owner" },
        { kind: NOTE_KIND.REMOVE, field: PLAN_FIELD.GOAL, find: "by email" },
      ],
    }),
  );

  assert.equal(unread, 0);
  assert.deepEqual(notes, [
    add(PLAN_HEADING.CONTEXT, "It came up in support."),
    add(PLAN_HEADING.OPEN_QUESTIONS, "- Who can resend?"),
    add(PLAN_HEADING.ASSUMPTIONS, "- Links are single use."),
    { kind: NOTE_KIND.REPLACE, find: "an admin", text: "an owner", within: PLAN_HEADING.CONTEXT },
    { kind: NOTE_KIND.REMOVE, find: "by email", within: PLAN_HEADING.GOAL },
  ]);
  assert.equal(
    applyNotesToText(DOCUMENT, notes).text,
    [
      "## Context",
      "",
      "Only an owner can add someone.",
      "",
      "It came up in support.",
      "",
      "## Goal",
      "",
      "## Hard parts",
      "",
      "## Assumptions",
      "",
      "- Invites expire after 7 days.",
      "- Links are single use.",
      "",
      "## Open questions",
      "",
      "- Who can resend?",
      "",
    ].join("\n"),
  );
});

test("a note that reads in neither shape is counted unread, and the notes beside it read", () => {
  const { notes, unread } = readNotes(
    unparsedWire({
      notes: [
        { kind: NOTE_KIND.ADD, field: "nowhere", text: "Lost." },
        { kind: NOTE_KIND.ADD, text: "Under no heading." },
        { kind: "rewrite", section: PLAN_HEADING.CONTEXT, text: "Everything." },
        { kind: NOTE_KIND.ADD, section: PLAN_HEADING.GOAL, text: "- Members invite." },
      ],
    }),
  );

  assert.equal(unread, 3);
  assert.deepEqual(notes, [add(PLAN_HEADING.GOAL, "- Members invite.")]);
});

test("a correction an older agent aimed at one field looks for its phrase in that field's section alone", () => {
  const { notes } = readNotes(
    unparsedWire({
      notes: [
        { kind: NOTE_KIND.REPLACE, field: PLAN_FIELD.GOAL, find: "an admin", text: "an owner" },
        { kind: NOTE_KIND.REMOVE, field: PLAN_FIELD.TESTING, find: "Invites expire" },
        { kind: NOTE_KIND.REPLACE, field: PLAN_FIELD.CONTEXT, find: "an admin", text: "an owner" },
      ],
    }),
  );

  const { text, missed } = applyNotesToText(DOCUMENT, notes);

  assert.deepEqual(
    missed.map((note) => note.kind),
    [NOTE_KIND.REPLACE, NOTE_KIND.REMOVE],
  );
  assert.ok(text.includes("Only an owner can add someone."));
  assert.ok(text.includes("- Invites expire after 7 days."));
});

test("an older agent's item of a list spanning lines stays one item, its later lines under its marker", () => {
  const { notes } = readNotes(
    unparsedWire({
      notes: [
        {
          kind: NOTE_KIND.ADD,
          field: PLAN_FIELD.OPEN_QUESTIONS,
          text: "Who approves?\nAsk the owner first.",
        },
      ],
    }),
  );

  assert.deepEqual(notes, [
    add(PLAN_HEADING.OPEN_QUESTIONS, "- Who approves?\n  Ask the owner first."),
  ]);
});
