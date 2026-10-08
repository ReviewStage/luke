import assert from "node:assert/strict";
import { isRecord, type UnparsedWireValue, unparsedWire, valueFromJsonText } from "@sidecar/wire";
import { test } from "vitest";
import {
  applyNote,
  applyNotes,
  EMPTY_PLAN_CONTENT,
  NOTE_KIND,
  notesInProgress,
  PLAN_EMPTY_TEXT,
  PLAN_FIELD,
  type PlanContent,
  type PlanField,
  type PlanNote,
  planBody,
} from "./plan-template.js";

const HEADER = { name: "Teammate invitations" } as const;

const PROBLEM = "- Only an admin can add a member.\n- Admins are a bottleneck.";

/** A plan with a problem, one rule with an example, a question, and an assumption. */
const NOTED: PlanContent = {
  fields: {
    ...EMPTY_PLAN_CONTENT.fields,
    goal: { problem: PROBLEM, outcome: null },
    rules: [
      {
        statement: "Any member may invite by email.",
        examples: [
          // biome-ignore lint/suspicious/noThenProperty: `then` is the example's key in the fixed template's contract, and an example is data that is never awaited.
          { given: "A member", when: "they send an invite", then: "the teammate gets an email" }, // oxlint-disable-line unicorn/no-thenable -- the same key, for the same reason.
        ],
      },
    ],
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
  const noted = taken(applyNote(NOTED, add(PLAN_FIELD.PROBLEM, "- Invites are lost in email.")));
  assert.equal(noted.fields.goal.problem, `${PROBLEM}\n- Invites are lost in email.`);
  // Prose after prose is a new paragraph, and a first point is the answer itself.
  const outcome = taken(applyNote(noted, add(PLAN_FIELD.OUTCOME, "Members invite.")));
  assert.equal(
    taken(applyNote(outcome, add(PLAN_FIELD.OUTCOME, "Admins approve."))).fields.goal.outcome,
    "Members invite.\n\nAdmins approve.",
  );
});

test("a correction changes only its phrase, found exactly or across a line it was wrapped on", () => {
  const replace = (find: string, text: string): PlanNote => ({
    kind: NOTE_KIND.REPLACE,
    field: PLAN_FIELD.PROBLEM,
    find,
    text,
  });
  const exact = taken(applyNote(NOTED, replace("an admin", "an owner")));
  assert.equal(exact.fields.goal.problem, PROBLEM.replace("an admin", "an owner"));
  const wrapped = taken(applyNote(NOTED, replace("member.  - Admins", "member.\n- Owners")));
  assert.equal(wrapped.fields.goal.problem, PROBLEM.replace("Admins", "Owners"));
});

test("a note naming what the field does not hold changes nothing and is reported as missed", () => {
  const notes: PlanNote[] = [
    { kind: NOTE_KIND.REPLACE, field: PLAN_FIELD.PROBLEM, find: "a guest", text: "a visitor" },
    { kind: NOTE_KIND.REMOVE, field: PLAN_FIELD.OUTCOME, find: "anything" },
    {
      kind: NOTE_KIND.ADD_EXAMPLE,
      rule: 3,
      given: "A",
      when: "B",
      // biome-ignore lint/suspicious/noThenProperty: `then` is the example's key in the fixed template's contract, and an example is data that is never awaited.
      then: "C", // oxlint-disable-line unicorn/no-thenable -- the same key, for the same reason.
    },
    add(PLAN_FIELD.OPEN_QUESTIONS, "Do invites expire?"),
  ];
  const { content, missed } = applyNotes(NOTED, notes);
  assert.deepEqual(missed, notes.slice(0, 3));
  assert.deepEqual(content.fields.openQuestions, [
    "Who can withdraw an invite?",
    "Do invites expire?",
  ]);
  assert.deepEqual(
    { ...content.fields, openQuestions: [] },
    { ...NOTED.fields, openQuestions: [] },
  );
});

test("striking a line removes that line alone, and striking the last leaves the field unanswered", () => {
  const strike = (find: string): PlanNote => ({
    kind: NOTE_KIND.REMOVE,
    field: PLAN_FIELD.PROBLEM,
    find,
  });
  const once = taken(applyNote(NOTED, strike("bottleneck")));
  assert.equal(once.fields.goal.problem, "- Only an admin can add a member.");
  const twice = taken(applyNote(once, strike("Only an admin")));
  assert.equal(twice.fields.goal.problem, null);
  assert.ok(planBody(HEADER, twice.fields).includes("### Problem\n\n_Unanswered_"));
});

test("rules take a new rule, an example by number, a correction, and a strike", () => {
  const notes: PlanNote[] = [
    add(PLAN_FIELD.RULES, "A withdrawn invite never grants access."),
    {
      kind: NOTE_KIND.ADD_EXAMPLE,
      rule: 2,
      given: "A withdrawn invite",
      when: "it is opened",
      // biome-ignore lint/suspicious/noThenProperty: `then` is the example's key in the fixed template's contract, and an example is data that is never awaited.
      then: null, // oxlint-disable-line unicorn/no-thenable -- the same key, for the same reason.
    },
    {
      kind: NOTE_KIND.REPLACE,
      field: PLAN_FIELD.RULES,
      find: "by email",
      text: "by email or link",
    },
    { kind: NOTE_KIND.REMOVE, field: PLAN_FIELD.RULES, find: "the teammate gets an email" },
  ];
  const { content, missed } = applyNotes(NOTED, notes);
  assert.deepEqual(missed, []);
  const [first, second] = content.fields.rules ?? [];
  assert.equal(first?.statement, "Any member may invite by email or link.");
  assert.equal(first?.examples, null);
  assert.equal(second?.statement, "A withdrawn invite never grants access.");
  assert.equal(second?.examples?.[0]?.when, "it is opened");
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
    add(PLAN_FIELD.PROBLEM, "- Invites are lost in email."),
    { kind: NOTE_KIND.REPLACE, field: PLAN_FIELD.PROBLEM, find: "an admin", text: "an owner" },
    add(PLAN_FIELD.OUTCOME, "- Members invite teammates themselves."),
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
      { kind: "rewrite", field: "problem", text: "Everything." },
      { kind: NOTE_KIND.ADD, field: "nowhere", text: "Lost." },
      { kind: NOTE_KIND.ADD, field: PLAN_FIELD.OUTCOME, text: "Members invite.", extra: true },
      { kind: NOTE_KIND.ADD, field: PLAN_FIELD.DECISIONS, text: "" },
    ],
  });
  const drafted = notesInProgress(NOTED, partial);
  assert.equal(drafted.fields.goal.problem, PROBLEM);
  assert.equal(drafted.fields.goal.outcome, "Members invite.");
  assert.equal(drafted.fields.decisions, null);
});

test("a line still being written as nothing but Markdown markers is held back, so its escaping never flickers", () => {
  const growing = (text: string) =>
    notesInProgress(
      NOTED,
      unparsedWire({ notes: [{ kind: NOTE_KIND.ADD, field: PLAN_FIELD.CONTRACTS, text }] }),
    ).fields.implementation.contracts;
  assert.equal(growing("Signatures:\n#"), "Signatures:");
  assert.equal(growing("Signatures:\n- "), "Signatures:");
  assert.equal(growing("Signatures:\n#tag"), "Signatures:\n#tag");
});

test("a phrase standing in more than one place names no place, so the note is missed rather than landing on the first", () => {
  const notes: PlanNote[] = [
    // "dmin" stands in both lines of the problem, and "invite" in the rule and its example.
    { kind: NOTE_KIND.REPLACE, field: PLAN_FIELD.PROBLEM, find: "dmin", text: "owner" },
    { kind: NOTE_KIND.REMOVE, field: PLAN_FIELD.RULES, find: "invite" },
    add(PLAN_FIELD.OPEN_QUESTIONS, "Who can resend an invite?"),
    { kind: NOTE_KIND.REMOVE, field: PLAN_FIELD.OPEN_QUESTIONS, find: "an invite?" },
  ];
  const { content, missed } = applyNotes(NOTED, notes);
  assert.deepEqual(missed, [notes[0], notes[1], notes[3]]);
  assert.equal(content.fields.goal.problem, PROBLEM);
  assert.deepEqual(content.fields.rules, NOTED.fields.rules);
  assert.deepEqual(content.fields.openQuestions, [
    "Who can withdraw an invite?",
    "Who can resend an invite?",
  ]);
  // Quoted long enough to name one place, the same correction lands.
  const named = applyNote(content, {
    kind: NOTE_KIND.REPLACE,
    field: PLAN_FIELD.PROBLEM,
    find: "an admin",
    text: "an owner",
  });
  assert.equal(named?.fields.goal.problem, PROBLEM.replace("an admin", "an owner"));
});
