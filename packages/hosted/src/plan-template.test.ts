import assert from "node:assert/strict";
import { isRecord, type UnparsedWireValue, unparsedWire, valueFromJsonText } from "@sidecar/wire";
import { test } from "vitest";
import {
  applyNote,
  applyNotes,
  applyNotesToText,
  EMPTY_PLAN_CONTENT,
  EMPTY_PLAN_FIELDS,
  NOTE_KIND,
  notesInProgress,
  PLAN_AGENT_EDITS_KEPT,
  PLAN_EMPTY_TEXT,
  type PlanContent,
  type PlanNote,
  planBody,
  planDocumentOf,
  textNotesInProgress,
  withAgentEdit,
} from "./plan-template.js";
import { PLAN_FIELD, type PlanField } from "./plan-wire.js";

const HEADER = { name: "Teammate invitations" } as const;

const CONTEXT = "- Only an admin can add a member.\n- Admins are a bottleneck.";

const HARD_PARTS = "- A member invites by email.\n- A withdrawn invite never grants access.";

/** A plan with its context, two hard parts, a question, and an assumption. */
const NOTED: PlanContent = {
  fields: {
    ...EMPTY_PLAN_CONTENT.fields,
    context: CONTEXT,
    hardParts: HARD_PARTS,
    openQuestions: ["Who can withdraw an invite?"],
  },
  assumptions: [{ text: "Invites reuse memberships." }],
};

function add(field: PlanField, text: string): PlanNote {
  return { kind: NOTE_KIND.ADD, field, text };
}

function taken(content: PlanContent | undefined): PlanContent {
  assert.ok(content !== undefined, "the note was taken");
  return content;
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

test("a point added under a text field lands after what it holds, on the next line of its list", () => {
  const noted = taken(applyNote(NOTED, add(PLAN_FIELD.CONTEXT, "- Invites are lost in email.")));
  assert.equal(noted.fields.context, `${CONTEXT}\n- Invites are lost in email.`);
  // Prose after prose is a new paragraph, and a first point is the answer itself.
  const outcome = taken(applyNote(noted, add(PLAN_FIELD.GOAL, "Members invite.")));
  assert.equal(
    taken(applyNote(outcome, add(PLAN_FIELD.GOAL, "Admins approve."))).fields.goal,
    "Members invite.\n\nAdmins approve.",
  );
});

test("a correction changes only its phrase, found exactly or across a line it was wrapped on", () => {
  const replace = (find: string, text: string): PlanNote => ({
    kind: NOTE_KIND.REPLACE,
    field: PLAN_FIELD.CONTEXT,
    find,
    text,
  });
  const exact = taken(applyNote(NOTED, replace("an admin", "an owner")));
  assert.equal(exact.fields.context, CONTEXT.replace("an admin", "an owner"));
  const wrapped = taken(applyNote(NOTED, replace("member.  - Admins", "member.\n- Owners")));
  assert.equal(wrapped.fields.context, CONTEXT.replace("Admins", "Owners"));
});

test("a note naming what the field does not hold changes nothing and is reported as missed", () => {
  const notes: PlanNote[] = [
    { kind: NOTE_KIND.REPLACE, field: PLAN_FIELD.CONTEXT, find: "a guest", text: "a visitor" },
    { kind: NOTE_KIND.REMOVE, field: PLAN_FIELD.GOAL, find: "anything" },
    add(PLAN_FIELD.OPEN_QUESTIONS, "Do invites expire?"),
  ];
  const { content, missed } = applyNotes(NOTED, notes);
  assert.deepEqual(missed, notes.slice(0, 2));
  assert.deepEqual(content.fields.openQuestions, [
    "Who can withdraw an invite?",
    "Do invites expire?",
  ]);
  assert.deepEqual(
    { ...content.fields, openQuestions: [] },
    { ...NOTED.fields, openQuestions: [] },
  );
});

test("an item written as a bullet is drawn under the list's one marker, not nested under a second", () => {
  const { content } = applyNotes(EMPTY_PLAN_CONTENT, [
    add(PLAN_FIELD.OPEN_QUESTIONS, "- Do invites expire?"),
    add(PLAN_FIELD.OPEN_QUESTIONS, "1. Who can resend an invite?"),
    add(PLAN_FIELD.ASSUMPTIONS, "* Invites reuse memberships."),
  ]);
  const body = planBody(HEADER, content.fields);
  assert.ok(
    body.includes("## Open questions\n\n- Do invites expire?\n- Who can resend an invite?\n"),
    body,
  );
  assert.deepEqual(content.assumptions, [{ text: "Invites reuse memberships." }]);
  // A correction that rewrites a whole question as a bullet is drawn the same way.
  const corrected = taken(
    applyNote(content, {
      kind: NOTE_KIND.REPLACE,
      field: PLAN_FIELD.OPEN_QUESTIONS,
      find: "Do invites expire?",
      text: "- Do invites expire after a week?",
    }),
  );
  assert.equal(corrected.fields.openQuestions[0], "Do invites expire after a week?");
});

test("striking a line removes that line alone, and striking the last leaves the field unanswered", () => {
  const strike = (find: string): PlanNote => ({
    kind: NOTE_KIND.REMOVE,
    field: PLAN_FIELD.CONTEXT,
    find,
  });
  const once = taken(applyNote(NOTED, strike("bottleneck")));
  assert.equal(once.fields.context, "- Only an admin can add a member.");
  const twice = taken(applyNote(once, strike("Only an admin")));
  assert.equal(twice.fields.context, null);
  assert.ok(planBody(HEADER, twice.fields).includes("## Context\n\n_Unanswered_"));
});

test("the lists take an item, correct one, and strike one", () => {
  const notes: PlanNote[] = [
    add(PLAN_FIELD.ASSUMPTIONS, "Links expire in a week."),
    { kind: NOTE_KIND.REPLACE, field: PLAN_FIELD.ASSUMPTIONS, find: "a week", text: "a day" },
    { kind: NOTE_KIND.REMOVE, field: PLAN_FIELD.OPEN_QUESTIONS, find: "withdraw" },
  ];
  const { content } = applyNotes(NOTED, notes);
  assert.deepEqual(content.assumptions, [
    { text: "Invites reuse memberships." },
    { text: "Links expire in a day." },
  ]);
  assert.deepEqual(content.fields.openQuestions, []);
});

test("while the answer streams, each draft differs from the last only where the newest note lands", () => {
  const notes: PlanNote[] = [
    add(PLAN_FIELD.CONTEXT, "- Invites are lost in email."),
    { kind: NOTE_KIND.REPLACE, field: PLAN_FIELD.CONTEXT, find: "an admin", text: "an owner" },
    add(PLAN_FIELD.GOAL, "- Members invite teammates themselves."),
  ];
  const whole = JSON.stringify({ notes }).length;
  const bodies: string[] = [];
  for (let chars = 1; chars <= whole; chars += 1) {
    bodies.push(planBody(HEADER, notesInProgress(NOTED, partialOf(notes, chars)).fields));
  }
  const saved = planBody(HEADER, applyNotes(NOTED, notes).content.fields);
  // Every draft is either the one before or the one before with one stretch changed.
  for (const [index, body] of bodies.entries()) {
    const before = bodies[index - 1] ?? planBody(HEADER, NOTED.fields);
    let head = 0;
    while (head < before.length && before[head] === body[head]) head += 1;
    let tail = 0;
    while (
      tail < before.length - head &&
      tail < body.length - head &&
      before[before.length - 1 - tail] === body[body.length - 1 - tail]
    ) {
      tail += 1;
    }
    const erased = before.slice(head, before.length - tail);
    // The only erasures a stream makes are the correction's own phrase, once it is whole, and a placeholder giving way to the first words.
    assert.ok(
      ["", "admin", PLAN_EMPTY_TEXT.UNANSWERED].includes(erased),
      `draft ${index} erased ${JSON.stringify(erased)}`,
    );
  }
  // The added point grows letter by letter rather than landing whole.
  assert.ok(bodies.some((body) => body.includes("- Invites are lo") && !body.includes("in email")));
  // A correction is drawn only once it is whole, never half-typed.
  assert.ok(bodies.every((body) => !/an (?:o|ow|own|owne) can/u.test(body)));
  assert.equal(bodies.at(-1), saved);
});

test("a note that does not read is passed over without holding back the notes after it", () => {
  const partial = unparsedWire({
    notes: [
      { kind: "rewrite", field: "context", text: "Everything." },
      { kind: NOTE_KIND.ADD, field: "nowhere", text: "Lost." },
      { kind: NOTE_KIND.ADD, field: PLAN_FIELD.GOAL, text: "Members invite.", extra: true },
      { kind: NOTE_KIND.ADD, field: PLAN_FIELD.APPROACH, text: "" },
    ],
  });
  const drafted = notesInProgress(NOTED, partial);
  assert.equal(drafted.fields.context, CONTEXT);
  assert.equal(drafted.fields.goal, "Members invite.");
  assert.equal(drafted.fields.approach, null);
});

test("a line still being written as nothing but Markdown markers is held back, so its escaping never flickers", () => {
  const growing = (text: string) =>
    notesInProgress(
      NOTED,
      unparsedWire({ notes: [{ kind: NOTE_KIND.ADD, field: PLAN_FIELD.INTERFACES, text }] }),
    ).fields.interfaces;
  assert.equal(growing("Signatures:\n#"), "Signatures:");
  assert.equal(growing("Signatures:\n- "), "Signatures:");
  assert.equal(growing("Signatures:\n#tag"), "Signatures:\n#tag");
});

test("a phrase standing in more than one place names no place, so the note is missed rather than landing on the first", () => {
  const notes: PlanNote[] = [
    // "dmin" stands in both lines of the context, and "invite" in both hard parts.
    { kind: NOTE_KIND.REPLACE, field: PLAN_FIELD.CONTEXT, find: "dmin", text: "owner" },
    { kind: NOTE_KIND.REMOVE, field: PLAN_FIELD.HARD_PARTS, find: "invite" },
    add(PLAN_FIELD.OPEN_QUESTIONS, "Who can resend an invite?"),
    { kind: NOTE_KIND.REMOVE, field: PLAN_FIELD.OPEN_QUESTIONS, find: "an invite?" },
  ];
  const { content, missed } = applyNotes(NOTED, notes);
  assert.deepEqual(missed, [notes[0], notes[1], notes[3]]);
  assert.equal(content.fields.context, CONTEXT);
  assert.equal(content.fields.hardParts, HARD_PARTS);
  assert.deepEqual(content.fields.openQuestions, [
    "Who can withdraw an invite?",
    "Who can resend an invite?",
  ]);
  // Quoted long enough to name one place, the same correction lands.
  const named = applyNote(content, {
    kind: NOTE_KIND.REPLACE,
    field: PLAN_FIELD.CONTEXT,
    find: "an admin",
    text: "an owner",
  });
  assert.equal(named?.fields.context, CONTEXT.replace("an admin", "an owner"));
});

test("the agents' journal keeps the newest saves and lets the oldest go past its bound", () => {
  const note: PlanNote = { kind: NOTE_KIND.ADD, field: PLAN_FIELD.APPROACH, text: "x" };
  let journal: ReturnType<typeof withAgentEdit> = [];
  for (let at = 1; at <= PLAN_AGENT_EDITS_KEPT + 2; at += 1) {
    journal = withAgentEdit(journal, { agentId: "agent", at, notes: [note] });
  }
  assert.equal(journal.length, PLAN_AGENT_EDITS_KEPT);
  assert.equal(journal[0]?.at, 3);
  assert.equal(journal.at(-1)?.at, PLAN_AGENT_EDITS_KEPT + 2);
});

test("a plan of fields becomes one document of its sections, no title, an unanswered section its heading alone, and the assumptions last", () => {
  const document = planDocumentOf({
    fields: {
      ...EMPTY_PLAN_FIELDS,
      context: "Only an admin can add someone.\n## Not a section",
      planOfAttack: "- Ship the table, then the route.",
      openQuestions: ["Who can withdraw an invite?"],
    },
    assumptions: [{ text: "Invites expire after 7 days." }],
  });

  assert.equal(
    document,
    [
      "## Context",
      "",
      "Only an admin can add someone.",
      "\\## Not a section",
      "",
      "## Goal",
      "",
      "## Approach",
      "",
      "## Interfaces",
      "",
      "## Hard parts",
      "",
      "## Not doing",
      "",
      "## Plan of attack",
      "",
      "- Ship the table, then the route.",
      "",
      "## Testing",
      "",
      "## Open questions",
      "",
      "- Who can withdraw an invite?",
      "",
      "## Assumptions",
      "",
      "- Invites expire after 7 days.",
      "",
    ].join("\n"),
  );
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

test("a field's note lands in the document's section under that field's heading: a bullet under a list, a paragraph under prose, a heading alone filled", () => {
  const { text, missed } = applyNotesToText(DOCUMENT, [
    { kind: NOTE_KIND.ADD, field: PLAN_FIELD.GOAL, text: "- Admins can withdraw an invite." },
    { kind: NOTE_KIND.ADD, field: PLAN_FIELD.CONTEXT, text: "It came up in support." },
    {
      kind: NOTE_KIND.ADD,
      field: PLAN_FIELD.HARD_PARTS,
      text: "- A link opened twice grants once.",
    },
    { kind: NOTE_KIND.ADD, field: PLAN_FIELD.ASSUMPTIONS, text: "Members and admins both invite." },
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

test("a note under a heading the document does not hold opens that section at the end, and a heading in a note's words is written as words", () => {
  const { text } = applyNotesToText(DOCUMENT, [
    {
      kind: NOTE_KIND.ADD,
      field: PLAN_FIELD.TESTING,
      text: "- When an invite expires, then its link says so.\n## Not a heading",
    },
  ]);

  assert.ok(
    text.endsWith(
      "- Invites expire after 7 days.\n\n## Testing\n\n- When an invite expires, then its link says so.\n\\## Not a heading\n",
    ),
  );
});

test("a correction or a strike names a phrase standing once in the whole document and touching no heading, or it is passed over", () => {
  const corrected = applyNotesToText(DOCUMENT, [
    { kind: NOTE_KIND.REPLACE, field: PLAN_FIELD.CONTEXT, find: "an admin", text: "an owner" },
    { kind: NOTE_KIND.REMOVE, field: PLAN_FIELD.GOAL, find: "invite by email" },
    { kind: NOTE_KIND.REPLACE, field: PLAN_FIELD.GOAL, find: "Goal", text: "Outcome" },
    { kind: NOTE_KIND.REMOVE, field: PLAN_FIELD.ASSUMPTIONS, find: "days" },
    { kind: NOTE_KIND.REMOVE, field: PLAN_FIELD.ASSUMPTIONS, find: "an" },
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
      { kind: NOTE_KIND.ADD, field: PLAN_FIELD.GOAL, text: "- Admins can withdraw." },
      { kind: NOTE_KIND.ADD, field: PLAN_FIELD.CONTEXT, text: "It came up" },
    ],
  });

  const drawn = textNotesInProgress(DOCUMENT, partial);

  assert.ok(drawn.includes("- Members invite by email.\n- Admins can withdraw.\n"));
  assert.ok(drawn.includes("Only an admin can add someone.\n\nIt came up\n"));
});
