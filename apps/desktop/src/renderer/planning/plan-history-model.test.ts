import assert from "node:assert/strict";
import { PLAN_ACTOR, type PlanRevisionLine } from "@sidecar/hosted/plan-wire";
import { test } from "vitest";
import { MARKDOWN_MARK } from "../markdown-message";
import {
  revisionAuthor,
  revisionSummary,
  VERSION_CHANGE,
  versionDiff,
  versionMoment,
} from "./plan-history-model";

const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 9, 11, 18, 0);

function line(overrides: Partial<PlanRevisionLine> = {}): PlanRevisionLine {
  return {
    seq: 3,
    lastEdit: { actor: PLAN_ACTOR.NOTETAKER, at: NOW - 2 * HOUR, duringCall: true },
    startedAt: NOW - 3 * HOUR,
    changes: 14,
    ...overrides,
  };
}

/** A plan's document with the body's sections given after its title. */
function documentOf(sections: readonly string[], assumptions: readonly string[] = []) {
  return {
    body: ["# Teammate invitations", ...sections].join("\n\n"),
    assumptions: assumptions.map((text) => ({ text })),
  };
}

/** The words a unit marks as one kind, in order. */
function marked(diff: ReturnType<typeof versionDiff>, kind: string): string[] {
  return diff.units.flatMap((unit) =>
    unit.marks
      .filter((mark) => mark.kind === kind)
      .map((mark) => unit.words.slice(mark.from, mark.to)),
  );
}

test("a revision names its writer as the developer knows them, and says what it did", () => {
  assert.equal(revisionAuthor(line().lastEdit), "Luke");
  assert.equal(revisionAuthor({ actor: PLAN_ACTOR.DEVELOPER, at: NOW, duringCall: false }), "You");
  assert.equal(
    revisionAuthor({ actor: PLAN_ACTOR.AGENT, label: "Invite emails", at: NOW, duringCall: false }),
    "Invite emails",
  );
  assert.equal(
    revisionAuthor({ actor: PLAN_ACTOR.EARLIER, at: NOW, duringCall: false }),
    "Earlier",
  );

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
    `Restored the version from ${versionMoment(restoredAt)}`,
  );
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
    [VERSION_CHANGE.SAME, VERSION_CHANGE.CHANGED, VERSION_CHANGE.SAME],
  );
  assert.deepEqual(marked(diff, MARKDOWN_MARK.DELETED), ["Only admins"]);
  assert.deepEqual(marked(diff, MARKDOWN_MARK.INSERTED), ["Any member"]);
  assert.equal(diff.units[1]?.words, "## Goal\n\nOnly adminsAny member can invite.");
});

test("a section only one side holds is drawn whole, added or struck, and a reworded rule reads as one rule changed", () => {
  const before = documentOf([
    "## Rules",
    "### Rule 1: Admins invite.",
    "## Open questions\n\n- Who withdraws?",
  ]);
  const after = documentOf([
    "## Rules",
    "### Rule 1: Any member invites.",
    "## Decisions\n\nInvites expire.",
  ]);

  const diff = versionDiff(before, after);

  assert.deepEqual(
    diff.units.map((unit) => [unit.key, unit.change]),
    [
      ["# Teammate invitations", VERSION_CHANGE.SAME],
      ["## Rules", VERSION_CHANGE.SAME],
      ["### Rule: Any member invites.", VERSION_CHANGE.CHANGED],
      ["## Decisions", VERSION_CHANGE.CHANGED],
    ],
  );
  assert.deepEqual(marked(diff, MARKDOWN_MARK.INSERTED).slice(0, 1), ["Any member invites"]);
});

test("a unit struck with nothing written in its place is drawn struck whole, and one new is drawn added", () => {
  const before = documentOf([
    "## Goal\n\nInvite by email.",
    "## Open questions\n\n- Who withdraws?",
  ]);
  const after = documentOf(["## Goal\n\nInvite by email."]);

  assert.deepEqual(
    versionDiff(before, after).units.map((unit) => unit.change),
    [VERSION_CHANGE.SAME, VERSION_CHANGE.SAME, VERSION_CHANGE.REMOVED],
  );
  assert.deepEqual(
    versionDiff(after, before).units.map((unit) => unit.change),
    [VERSION_CHANGE.SAME, VERSION_CHANGE.SAME, VERSION_CHANGE.ADDED],
  );
});

test("the assumptions are compared as a list, a reworded one struck and written again", () => {
  const before = documentOf([], ["Invites reuse memberships.", "Admins approve invites."]);
  const after = documentOf([], ["Invites create memberships.", "Admins approve invites."]);

  assert.deepEqual(
    versionDiff(before, after).assumptions.map((assumption) => [
      assumption.text,
      assumption.change,
    ]),
    [
      ["Invites reuse memberships.", VERSION_CHANGE.REMOVED],
      ["Invites create memberships.", VERSION_CHANGE.ADDED],
      ["Admins approve invites.", VERSION_CHANGE.SAME],
    ],
  );
});

test("the first version is drawn as it is against nothing, and a version like its base says it changed nothing", () => {
  const document = documentOf(["## Goal\n\nInvite by email."], ["Invites expire."]);

  const first = versionDiff(null, document);
  const same = versionDiff(document, document);

  assert.equal(first.changed, false);
  assert.ok(first.units.every((unit) => unit.change === VERSION_CHANGE.SAME));
  assert.deepEqual(
    first.assumptions.map((assumption) => assumption.change),
    [VERSION_CHANGE.SAME],
  );
  assert.equal(same.changed, false);
});

test("a rule struck before others strikes that rule, and the rules after it read as renumbered rather than rewritten", () => {
  const before = documentOf([
    "## Rules",
    "### Rule 1: Admins invite.",
    "### Rule 2: Invites expire.",
    "### Rule 3: Invites resend.",
  ]);
  const after = documentOf([
    "## Rules",
    "### Rule 1: Invites expire.",
    "### Rule 2: Invites resend.",
  ]);

  const diff = versionDiff(before, after);

  assert.deepEqual(
    diff.units.map((unit) => [unit.key, unit.change]),
    [
      ["# Teammate invitations", VERSION_CHANGE.SAME],
      ["## Rules", VERSION_CHANGE.SAME],
      ["### Rule: Admins invite.", VERSION_CHANGE.REMOVED],
      ["### Rule: Invites expire.", VERSION_CHANGE.CHANGED],
      ["### Rule: Invites resend.", VERSION_CHANGE.CHANGED],
    ],
  );
  assert.deepEqual(marked(diff, MARKDOWN_MARK.DELETED), ["2", "3"]);
  assert.deepEqual(marked(diff, MARKDOWN_MARK.INSERTED), ["1", "2"]);
});
