import assert from "node:assert/strict";
import { MODEL_PROVIDER } from "@luke/features/models-wire";
import { PLAN_ACTOR, type PlanLastEdit, type PlanRevisionLine } from "@luke/features/task-wire";
import { WORKSPACE_ROLE } from "@luke/features/workspace-wire";
import { dayAndTimeText } from "@luke/panel/tasks/task-time";
import { DOCUMENT_TASK } from "@luke/panel/testing/document-task";
import { ACTOR_KIND, ACTOR_STATE, actorName, SOMEONE_REASON } from "@luke/ui/actor-model";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";
import { MARKDOWN_MARK, MarkdownMessage } from "../markdown-message";
import {
  changedSections,
  opensSections,
  REVISION_SOURCE,
  revisionAuthorOf,
  revisionOfSave,
  revisionSource,
  revisionSummary,
  sourceLabel,
  VERSION_CHANGE,
  versionDiff,
} from "./plan-history-model";

const HOUR = 3_600_000;
const AGENT_ID = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";
const NOW = Date.UTC(2026, 9, 11, 18, 0);
const DOCUMENT_TEXT = DOCUMENT_TASK.document.body.trimEnd();
const DEAN = { userId: "user-dean", name: "Dean Stratakos" };
const CHARLES = { userId: "user-charles", name: "Charles Pan" };

function line(overrides: Partial<PlanRevisionLine> = {}): PlanRevisionLine {
  return {
    seq: 3,
    lastEdit: { actor: PLAN_ACTOR.NOTETAKER, at: NOW - 2 * HOUR, duringCall: true },
    startedAt: NOW - 3 * HOUR,
    changes: 14,
    ...overrides,
  };
}

/** A revision's document, as the service answers one: its text of these sections, no list. */
function documentOf(sections: readonly string[]) {
  return { body: `${sections.join("\n\n")}\n`, assumptions: [] };
}

/** The words a unit marks as one kind, in order. */
function marked(diff: ReturnType<typeof versionDiff>, kind: string): string[] {
  return diff.units.flatMap((unit) =>
    unit.marks
      .filter((mark) => mark.kind === kind)
      .map((mark) => unit.words.slice(mark.from, mark.to)),
  );
}

test("a revision is drawn under its writer: the reader by their account's picture, and an agent by the harness of the agent the line names", () => {
  const reader = {
    id: DEAN.userId,
    name: "Dean",
    pictureUrl: "https://avatars.githubusercontent.com/u/1",
  };
  const agents = [{ id: AGENT_ID, model: "openai/gpt-6-astra" }];
  const agentEdit = { actor: PLAN_ACTOR.AGENT, label: "Invite emails", at: NOW, duringCall: false };
  const developerEdit = { actor: PLAN_ACTOR.DEVELOPER, at: NOW, duringCall: false, by: DEAN };

  assert.deepEqual(revisionAuthorOf({ lastEdit: developerEdit }, reader, agents), {
    kind: ACTOR_KIND.PERSON,
    userId: DEAN.userId,
    you: true,
    name: reader.name,
    pictureUrl: reader.pictureUrl,
  });
  assert.deepEqual(revisionAuthorOf({ lastEdit: agentEdit, agentId: AGENT_ID }, reader, agents), {
    kind: ACTOR_KIND.AGENT,
    name: "Invite emails",
    provider: MODEL_PROVIDER.OPENAI,
    state: ACTOR_STATE.REST,
  });
  // An agent the task no longer lists, or a line from a service that names none, wears no harness.
  assert.deepEqual(revisionAuthorOf({ lastEdit: agentEdit }, reader, agents), {
    kind: ACTOR_KIND.AGENT,
    name: "Invite emails",
    provider: undefined,
    state: ACTOR_STATE.REST,
  });
});

test("a revision names its writer as the developer knows them, and says what it did", () => {
  const reader = {
    id: DEAN.userId,
    name: "Dean",
    pictureUrl: "https://avatars.githubusercontent.com/u/1",
  };
  const agents = [{ id: AGENT_ID, model: "openai/gpt-6-astra" }];
  const named = (edit: Partial<PlanLastEdit>, agentId?: string) =>
    actorName(
      revisionAuthorOf(
        { lastEdit: { ...line().lastEdit, ...edit }, ...(agentId ? { agentId } : undefined) },
        reader,
        agents,
      ),
    );
  assert.equal(named({}), "Luke");
  assert.equal(named({ actor: PLAN_ACTOR.DEVELOPER, by: DEAN }), "You");
  assert.equal(
    named({ actor: PLAN_ACTOR.AGENT, label: "Invite emails" }, AGENT_ID),
    "Invite emails",
  );
  assert.equal(named({ actor: PLAN_ACTOR.EARLIER }), "Earlier");
  // Someone other than the reader, as a shared task will hold, is named rather than called You.
  assert.equal(named({ actor: PLAN_ACTOR.DEVELOPER, by: CHARLES }), "Charles Pan");

  assert.equal(revisionSummary(line()), "14 changes");
  assert.equal(revisionSummary(line({ changes: 1 })), "1 change");
  assert.equal(
    revisionSummary(
      line({
        lastEdit: { actor: PLAN_ACTOR.EARLIER, at: NOW, duringCall: false },
        changes: 0,
      }),
    ),
    "The plan before its history began",
  );
  const restoredAt = NOW - 5 * HOUR;
  assert.equal(
    revisionSummary(line({ restoredFrom: { seq: 1, at: restoredAt } })),
    `Restored the version from ${dayAndTimeText(restoredAt)}`,
  );
});

/**
 * A plan's revisions, newest first, as the service lists them: Luke's on a
 * call, moved on by saves from three hours ago to two, an agent's five hours
 * ago, and the plan before its history began.
 */
const REVISIONS = [
  line({ seq: 3, startedAt: NOW - 3 * HOUR }),
  line({
    seq: 2,
    lastEdit: {
      actor: PLAN_ACTOR.AGENT,
      label: "Invite emails",
      at: NOW - 5 * HOUR,
      duringCall: false,
    },
    startedAt: NOW - 5 * HOUR,
  }),
  line({
    seq: 1,
    lastEdit: { actor: PLAN_ACTOR.EARLIER, at: NOW - 26 * HOUR, duringCall: false },
    startedAt: NOW - 26 * HOUR,
  }),
];

test("a save is found as the revision it moved on, a moment before or at the revision's own", () => {
  // The section's save is stamped just before the revision it began is.
  assert.equal(revisionOfSave(REVISIONS, NOW - 5 * HOUR - 4, true), 2);
  assert.equal(revisionOfSave(REVISIONS, NOW - 5 * HOUR, true), 2);
  // A save that moved a revision on is that revision's, wherever it fell within it.
  assert.equal(revisionOfSave(REVISIONS, NOW - 3 * HOUR - 4, true), 3);
  assert.equal(revisionOfSave(REVISIONS, NOW - 2.5 * HOUR, true), 3);
  assert.equal(revisionOfSave(REVISIONS, NOW - 2 * HOUR, true), 3);
  assert.equal(revisionOfSave(REVISIONS, NOW - 26 * HOUR, true), 1);
});

test("a save older than every revision read is sought on the older pages, and is the oldest's where there are none", () => {
  const page = REVISIONS.slice(0, 2);

  assert.equal(revisionOfSave(page, NOW - 26 * HOUR, false), undefined);
  assert.equal(revisionOfSave(page, NOW - 5 * HOUR, false), undefined, "its revision may be older");
  assert.equal(revisionOfSave(page, NOW - 4 * HOUR, false), 3, "an older revision read bounds it");
  assert.equal(revisionOfSave(page, NOW - 26 * HOUR, true), 2);
  assert.equal(revisionOfSave([], NOW, true), undefined);
  assert.equal(revisionOfSave(REVISIONS, NOW, true), 3, "a save past the newest is the newest's");
});

test("a version against the one before it marks the words written in and struck out where a unit changed", () => {
  const before = documentOf([
    "## Goal\n\nOnly admins can invite.",
    "## Decisions\n\nInvites expire.",
  ]);
  const after = documentOf([
    "## Goal\n\nAny member can invite.",
    "## Decisions\n\nInvites expire.",
  ]);

  const diff = versionDiff(before, after);

  assert.ok(diff.changed);
  assert.deepEqual(
    diff.units.map((unit) => unit.change),
    [VERSION_CHANGE.CHANGED, VERSION_CHANGE.SAME],
  );
  assert.deepEqual(marked(diff, MARKDOWN_MARK.DELETED), ["Only admins"]);
  assert.deepEqual(marked(diff, MARKDOWN_MARK.INSERTED), ["Any member"]);
  assert.equal(diff.units[0]?.words, "## Goal\n\nOnly adminsAny member can invite.");
});

test("a picture replaced in a version reads as the old one struck and the new one written in, each whole", () => {
  const before = documentOf(["## Approach\n\n![Old mock](https://example.com/mock_(v1).png)"]);
  const after = documentOf([
    '## Approach\n\n![New mock](https://example.com/mock_(v2).png "Second pass")',
  ]);
  const diff = versionDiff(before, after);
  const unit = diff.units[0];
  assert.ok(unit);

  const drawn = renderToStaticMarkup(
    createElement(MarkdownMessage, { words: unit.words, edit: { marks: unit.marks } }),
  );

  assert.deepEqual(marked(diff, MARKDOWN_MARK.DELETED), [
    "![Old mock](https://example.com/mock_(v1).png)",
  ]);
  assert.deepEqual(marked(diff, MARKDOWN_MARK.INSERTED), [
    '![New mock](https://example.com/mock_(v2).png "Second pass")',
  ]);
  assert.ok(
    drawn.includes(
      '<del class="markdown-deleted">Old mock</del><ins class="markdown-inserted">New mock</ins>',
    ),
    drawn,
  );
});

test("a section struck and another written in its place read as one unit changed, its words marked", () => {
  const before = documentOf([
    "## Context\n\nOnly admins invite.",
    "## Open questions\n\n- Who withdraws?",
  ]);
  const after = documentOf([
    "## Context\n\nOnly admins invite.",
    "## Plan of attack\n\n1. Schema.",
  ]);

  const diff = versionDiff(before, after);

  assert.deepEqual(
    diff.units.map((unit) => [unit.key, unit.change]),
    [
      ["Context", VERSION_CHANGE.SAME],
      ["Plan of attack", VERSION_CHANGE.CHANGED],
    ],
  );
  assert.ok(marked(diff, MARKDOWN_MARK.INSERTED).some((words) => words.includes("Plan of attack")));
});

test("a unit struck with nothing written in its place is drawn struck whole, and one new is drawn added", () => {
  const before = documentOf([
    "## Goal\n\nInvite by email.",
    "## Open questions\n\n- Who withdraws?",
  ]);
  const after = documentOf(["## Goal\n\nInvite by email."]);

  assert.deepEqual(
    versionDiff(before, after).units.map((unit) => unit.change),
    [VERSION_CHANGE.SAME, VERSION_CHANGE.REMOVED],
  );
  assert.deepEqual(
    versionDiff(after, before).units.map((unit) => unit.change),
    [VERSION_CHANGE.SAME, VERSION_CHANGE.ADDED],
  );
});

test("the first version is drawn as it is against nothing, and a version like its base says it changed nothing", () => {
  const document = documentOf(["## Goal\n\nInvite by email."]);

  const first = versionDiff(null, document);
  const same = versionDiff(document, document);

  assert.equal(first.changed, false);
  assert.ok(first.units.every((unit) => unit.change === VERSION_CHANGE.SAME));
  assert.equal(same.changed, false);
});

test("a revision is compared by section, its assumptions among them, and a heading inside a fence cuts nothing", () => {
  const before = documentOf([DOCUMENT_TEXT]);
  const after = documentOf([
    DOCUMENT_TEXT.replace("Invites land by email.", "Invites land by email or by link.").concat(
      "\n\n# Rollout\n\nBehind a flag.",
    ),
  ]);

  const diff = versionDiff(before, after);

  assert.deepEqual(
    diff.units.map((unit) => [unit.key, unit.change]),
    [
      ["Context", VERSION_CHANGE.SAME],
      ["Goal", VERSION_CHANGE.CHANGED],
      ["Approach", VERSION_CHANGE.SAME],
      ["Assumptions", VERSION_CHANGE.SAME],
      ["Rollout", VERSION_CHANGE.ADDED],
    ],
  );
  assert.deepEqual(marked(diff, MARKDOWN_MARK.INSERTED), [" or by link"]);
  assert.ok(diff.changed);
});

test("a revision's changed sections are the units its diff marks, in reading order, and the plan's first revision wrote every one", () => {
  const before = {
    body: "## Goal\n\nOnly admins.\n\n## Risks\n\nSpam.\n\n## Notes\n\nNone.",
    assumptions: [],
  };
  const after = {
    body: "## Goal\n\nAny member.\n\n## Notes\n\nNone.\n\n## Decisions\n\nExpire.",
    assumptions: [],
  };

  assert.deepEqual(changedSections(versionDiff(before, after), false), [
    { unit: 0, heading: "Goal", change: VERSION_CHANGE.CHANGED },
    { unit: 1, heading: "Risks", change: VERSION_CHANGE.REMOVED },
    { unit: 3, heading: "Decisions", change: VERSION_CHANGE.ADDED },
  ]);
  assert.deepEqual(
    changedSections(versionDiff(null, after), true).map((section) => section.change),
    [VERSION_CHANGE.ADDED, VERSION_CHANGE.ADDED, VERSION_CHANGE.ADDED],
  );
});

test("only a revision of several changes opens its sections: not one change, a restore, or the plan before history", () => {
  assert.equal(opensSections(line()), true);
  assert.equal(opensSections(line({ changes: 1 })), false);
  assert.equal(opensSections(line({ restoredFrom: { seq: 1, at: NOW } })), false);
  assert.equal(
    opensSections(line({ lastEdit: { actor: PLAN_ACTOR.EARLIER, at: NOW, duringCall: false } })),
    false,
  );
});

test("a revision's Open goes to its agent's tab, Luke's call, or Luke's moment in Work, and nowhere for anyone else", () => {
  const callId = "1c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b22";
  const agentEdit = { actor: PLAN_ACTOR.AGENT, label: "Invite emails", at: NOW, duringCall: false };

  assert.deepEqual(revisionSource({ ...line(), callId }), { kind: REVISION_SOURCE.CALL, callId });
  assert.deepEqual(revisionSource(line()), {
    kind: REVISION_SOURCE.WORK,
    at: line().lastEdit.at,
  });
  assert.deepEqual(revisionSource({ lastEdit: agentEdit, agentId: AGENT_ID }), {
    kind: REVISION_SOURCE.AGENT,
    agentId: AGENT_ID,
  });
  // An agent the line no longer names, the developer, and the plan before history open nothing.
  assert.equal(revisionSource({ lastEdit: agentEdit }), undefined);
  assert.equal(
    revisionSource({ lastEdit: { ...agentEdit, actor: PLAN_ACTOR.DEVELOPER } }),
    undefined,
  );
  assert.equal(
    revisionSource({ lastEdit: { ...agentEdit, actor: PLAN_ACTOR.EARLIER } }),
    undefined,
  );

  const agent = {
    kind: ACTOR_KIND.AGENT,
    name: "Invite emails",
    provider: undefined,
    state: ACTOR_STATE.REST,
  } as const;
  assert.equal(
    sourceLabel({ kind: REVISION_SOURCE.AGENT, agentId: AGENT_ID }, agent),
    "Open Invite emails",
  );
  assert.equal(sourceLabel({ kind: REVISION_SOURCE.CALL, callId }, agent), "Open in Transcript");
  assert.equal(sourceLabel({ kind: REVISION_SOURCE.WORK, at: NOW }, agent), "Open in Work");
});

test("two members of a plan each see the other's revisions under the other's name, and only their own as You", () => {
  const edit = (by: typeof DEAN) => ({
    lastEdit: { actor: PLAN_ACTOR.DEVELOPER, at: NOW, duringCall: false, by },
  });
  const asDean = { id: DEAN.userId, name: "Dean Stratakos", pictureUrl: undefined };
  const asCharles = { id: CHARLES.userId, name: "Charles Pan", pictureUrl: undefined };

  assert.equal(actorName(revisionAuthorOf(edit(DEAN), asDean, [])), "You");
  assert.equal(actorName(revisionAuthorOf(edit(CHARLES), asDean, [])), "Charles Pan");
  assert.equal(actorName(revisionAuthorOf(edit(CHARLES), asCharles, [])), "You");
  assert.equal(actorName(revisionAuthorOf(edit(DEAN), asCharles, [])), "Dean Stratakos");
});

test("a teammate's revision wears their face as the workspace's members list them, and one by a member who has left says so", () => {
  const edit = (by: typeof DEAN) => ({
    lastEdit: { actor: PLAN_ACTOR.DEVELOPER, at: NOW, duringCall: false, by },
  });
  const charlesPicture = "https://avatars.githubusercontent.com/u/2";
  const member = (who: typeof DEAN) => ({
    ...who,
    email: `${who.userId}@example.com`,
    role: WORKSPACE_ROLE.MEMBER,
  });
  const reader = {
    id: DEAN.userId,
    name: "Dean Stratakos",
    pictureUrl: "https://avatars.githubusercontent.com/u/1",
  };
  const read = {
    ...reader,
    members: [member(DEAN), { ...member(CHARLES), pictureUrl: charlesPicture }],
  };

  assert.deepEqual(revisionAuthorOf(edit(CHARLES), read, []), {
    kind: ACTOR_KIND.PERSON,
    userId: CHARLES.userId,
    name: "Charles Pan",
    email: "user-charles@example.com",
    role: WORKSPACE_ROLE.MEMBER,
    pictureUrl: charlesPicture,
    you: false,
  });
  // Before the members are read, a teammate stands by their name alone, drawn by their letter.
  assert.deepEqual(revisionAuthorOf(edit(CHARLES), reader, []), {
    kind: ACTOR_KIND.PERSON,
    userId: CHARLES.userId,
    name: "Charles Pan",
    you: false,
  });
  // Once read, a member the workspace no longer lists has left, and keeps the name the service holds.
  assert.deepEqual(revisionAuthorOf(edit(CHARLES), { ...reader, members: [member(DEAN)] }, []), {
    kind: ACTOR_KIND.SOMEONE,
    reason: SOMEONE_REASON.FORMER,
    name: "Charles Pan",
    userId: CHARLES.userId,
  });
  // And keeps their picture, and the name their account holds now, from the read of who left.
  const left = {
    ...CHARLES,
    name: "Charles Pan-Ito",
    pictureUrl: "https://avatars.githubusercontent.com/u/9",
  };
  assert.deepEqual(
    revisionAuthorOf(edit(CHARLES), { ...reader, members: [member(DEAN)], former: [left] }, []),
    {
      kind: ACTOR_KIND.SOMEONE,
      reason: SOMEONE_REASON.FORMER,
      name: "Charles Pan-Ito",
      userId: CHARLES.userId,
      pictureUrl: left.pictureUrl,
    },
  );
});

test("a person's revision the service names nobody for, or read with no account id, is never You", () => {
  const unnamed = { lastEdit: { actor: PLAN_ACTOR.DEVELOPER, at: NOW, duringCall: false } };
  const named = { lastEdit: { ...unnamed.lastEdit, by: DEAN } };
  const reader = { id: DEAN.userId, name: "Dean Stratakos", pictureUrl: undefined };

  assert.equal(actorName(revisionAuthorOf(unnamed, reader, [])), "Someone");
  assert.equal(
    actorName(revisionAuthorOf(named, { ...reader, id: undefined }, [])),
    "Dean Stratakos",
  );
  // The account's own template is theirs alone, so its every revision is the reader's.
  assert.equal(actorName(revisionAuthorOf(unnamed, reader, [], true)), "You");
});
