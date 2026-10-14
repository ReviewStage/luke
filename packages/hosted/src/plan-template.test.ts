import assert from "node:assert/strict";
import { isRecord, type UnparsedWireValue, unparsedWire, valueFromJsonText } from "@sidecar/wire";
import { test } from "vitest";
import {
  applyNotesToText,
  applyRolloutNotes,
  NOTE_KIND,
  PLAN_HEADING,
  type PlanNote,
  ROLLOUT_NOTE_FIELD,
  readNotes,
  rolloutNotesInProgress,
} from "./plan-template.js";
import {
  PLAN_FIELD,
  ROLLOUT_BASE,
  ROLLOUT_BOUNDS,
  type Rollout,
  type RolloutItem,
} from "./plan-wire.js";

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

const TABLE: RolloutItem = {
  title: "Add the invite table",
  scope: "The `invite` table and its migration.",
  base: ROLLOUT_BASE.MAIN,
  acceptance: "A store test writes and reads an invite.",
};

const ROUTE: RolloutItem = {
  title: "Invite route",
  scope: "The `invite` route over the table.",
  base: 1,
  acceptance: null,
};

const SCREEN: RolloutItem = {
  title: "Invite screen",
  scope: "The form that sends an invite.",
  base: 1,
  acceptance: "The form posts and shows the sent invite.",
};

/** A rollout cut in three: a table on main, then a route and a screen that each need only the table. */
const ROLLOUT: Rollout = [TABLE, ROUTE, SCREEN];

/** A note adding one pull request after the rollout's last. */
function addPullRequest(item: RolloutItem): PlanNote {
  return { kind: NOTE_KIND.ADD, field: ROLLOUT_NOTE_FIELD, item };
}

/** A note striking the one pull request whose title holds a phrase. */
function strikePullRequest(find: string): PlanNote {
  return { kind: NOTE_KIND.REMOVE, field: ROLLOUT_NOTE_FIELD, find };
}

test("pull requests added under the rollout land after the last, and never in the plan's text", () => {
  const notes = [...ROLLOUT.map(addPullRequest), add(PLAN_HEADING.GOAL, "Members invite.")];

  assert.deepEqual(applyRolloutNotes([], notes), { rollout: ROLLOUT, missed: [] });
  const noted = applyNotesToText(DOCUMENT, notes);
  assert.deepEqual(noted.missed, []);
  assert.equal(
    noted.text,
    applyNotesToText(DOCUMENT, [add(PLAN_HEADING.GOAL, "Members invite.")]).text,
  );
  assert.ok(!noted.text.includes(TABLE.title));
});

test("a rollout strike read from an answer strikes a pull request and never the phrase in the plan's text", () => {
  const text = `${DOCUMENT}\n- Invite route shipped.\n`;
  const { notes } = readNotes(unparsedWire({ notes: [strikePullRequest("Invite route")] }));

  assert.deepEqual(notes, [strikePullRequest("Invite route")]);
  assert.deepEqual(applyNotesToText(text, notes), { text, missed: [] });
  assert.deepEqual(applyRolloutNotes([TABLE, ROUTE], notes).rollout, [TABLE]);
});

test("a pull request named by a phrase of its title is restated in its place, and a phrase in two titles or only in a scope names none", () => {
  const route = { ...ROUTE, title: "Invite route and its refusals", base: ROLLOUT_BASE.MAIN };
  const restate = (find: string): PlanNote => ({
    kind: NOTE_KIND.REPLACE,
    field: ROLLOUT_NOTE_FIELD,
    find,
    item: route,
  });

  assert.deepEqual(applyRolloutNotes(ROLLOUT, [restate("route")]).rollout, [TABLE, route, SCREEN]);
  const missed = [restate("Invite"), strikePullRequest("migration")];
  assert.deepEqual(applyRolloutNotes(ROLLOUT, missed), { rollout: ROLLOUT, missed });
});

test("a struck pull request counts later bases down past it, and one another bases on is not struck", () => {
  const emails: RolloutItem = {
    title: "Invite emails",
    scope: "The email the route sends.",
    base: 3,
    acceptance: null,
  };
  const screen = { ...SCREEN, base: ROLLOUT_BASE.MAIN };
  const rollout: Rollout = [TABLE, screen, ROUTE, emails];

  assert.deepEqual(applyRolloutNotes(rollout, [strikePullRequest("screen")]).rollout, [
    TABLE,
    ROUTE,
    { ...emails, base: 2 },
  ]);
  const missed = [strikePullRequest("invite table"), strikePullRequest("Invite route")];
  assert.deepEqual(applyRolloutNotes(rollout, missed), { rollout, missed });
});

test("a pull request based on itself, a later one, or past the list is missed, and so is one past the bound", () => {
  const restate = (base: number): PlanNote => ({
    kind: NOTE_KIND.REPLACE,
    field: ROLLOUT_NOTE_FIELD,
    find: "Invite route",
    item: { ...TABLE, base },
  });
  const notes = [
    addPullRequest({ ...TABLE, base: 4 }),
    addPullRequest({ ...TABLE, base: 5 }),
    restate(2),
    restate(3),
  ];

  assert.deepEqual(applyRolloutNotes(ROLLOUT, notes), { rollout: ROLLOUT, missed: notes });
  const full = Array.from({ length: ROLLOUT_BOUNDS.MAX_PULL_REQUESTS }, () => TABLE);
  const past = addPullRequest(TABLE);
  assert.deepEqual(applyRolloutNotes(full, [past]), { rollout: full, missed: [past] });
});

test("a rollout note reads only with a whole pull request, and a heading's words never name the rollout", () => {
  const { notes, unread } = readNotes(
    unparsedWire({
      notes: [
        { kind: NOTE_KIND.ADD, field: ROLLOUT_NOTE_FIELD, text: "Add the invite table" },
        { kind: NOTE_KIND.ADD, field: ROLLOUT_NOTE_FIELD, item: { title: "Invite table" } },
        { kind: NOTE_KIND.ADD, field: ROLLOUT_NOTE_FIELD, item: TABLE },
      ],
    }),
  );

  assert.equal(unread, 2);
  assert.deepEqual(notes, [addPullRequest(TABLE)]);
});

test("while the answer streams, a pull request is drawn once its note is whole, never half-written", () => {
  const notes = [...ROLLOUT.map(addPullRequest), add(PLAN_HEADING.GOAL, "- Members invite.")];
  const whole = JSON.stringify({ notes }).length;
  const drafts: Rollout[] = [];
  for (let chars = 1; chars <= whole; chars += 1) {
    drafts.push(rolloutNotesInProgress([], partialOf(notes, chars)));
  }

  // Every draft holds whole pull requests, the saved rollout's first so many.
  for (const draft of drafts) assert.deepEqual(draft, ROLLOUT.slice(0, draft.length));
  assert.deepEqual(drafts.at(-1), ROLLOUT);
});
