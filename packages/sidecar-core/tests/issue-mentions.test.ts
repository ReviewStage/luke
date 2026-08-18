import assert from "node:assert/strict";
import test from "node:test";
import {
  ISSUE_TRACKER_ID,
  MAXIMUM_MENTIONED_ISSUES,
  mentionedIssues,
  normalizeTrackedIssue,
  type TrackedIssue,
} from "../src";

const LINEAR = { id: ISSUE_TRACKER_ID.LINEAR, displayName: "Linear" } as const;

function issue(identifier: string, title: string): TrackedIssue {
  const normalized = normalizeTrackedIssue(LINEAR, {
    trackerIssueId: `issue-uuid-${identifier}`,
    identifier,
    title,
    stateName: "Todo",
    observedAt: 1_800_000_000_000,
  });
  assert.ok(normalized);
  return normalized;
}

function identifiers(issues: readonly TrackedIssue[]): readonly string[] {
  return issues.map((mention) => mention.identifier);
}

test("names the issues the reply mentions, in the order they are heard", () => {
  const board = [issue("LUKE-1", "Fix login"), issue("LUKE-2", "Ship captions")];
  assert.deepEqual(identifiers(mentionedIssues("LUKE-2 is blocked on LUKE-1, remember.", board)), [
    "LUKE-2",
    "LUKE-1",
  ]);
});

test("an identifier matches case aside, and a hyphen may return as a space", () => {
  const board = [issue("LUKE-12", "Fix login")];
  assert.deepEqual(identifiers(mentionedIssues("luke-12 looks stuck.", board)), ["LUKE-12"]);
  assert.deepEqual(identifiers(mentionedIssues("Luke 12 looks stuck.", board)), ["LUKE-12"]);
});

test("an identifier inside a longer token is a different identifier", () => {
  const board = [issue("LUKE-1", "Fix login")];
  assert.deepEqual(mentionedIssues("LUKE-12 is not this issue.", board), []);
  assert.deepEqual(mentionedIssues("XLUKE-1 is not this issue either.", board), []);
  assert.deepEqual(identifiers(mentionedIssues("(LUKE-1) is, punctuation and all.", board)), [
    "LUKE-1",
  ]);
});

test("a whole title names its issue on the session mentions' own terms", () => {
  const board = [issue("LUKE-7", "Checkout flaking")];
  assert.deepEqual(identifiers(mentionedIssues('I looked at "checkout flaking".', board)), [
    "LUKE-7",
  ]);
  // Inside a longer word is not a mention of this issue.
  assert.deepEqual(mentionedIssues("The precheckout flakingest queue.", board), []);
});

test("a title too short to be attributable earns no chip; its identifier still does", () => {
  const board = [issue("LUKE-9", "Fix")];
  assert.deepEqual(mentionedIssues("I can fix that for you.", board), []);
  assert.deepEqual(identifiers(mentionedIssues("Fix is LUKE-9 on the board.", board)), ["LUKE-9"]);
});

test("a title two issues share names neither; their identifiers still do", () => {
  const board = [issue("LUKE-1", "Untitled issue"), issue("LUKE-2", "untitled issue")];
  assert.deepEqual(mentionedIssues("The untitled issue is waiting.", board), []);
  assert.deepEqual(identifiers(mentionedIssues("Untitled issue LUKE-2 is waiting.", board)), [
    "LUKE-2",
  ]);
});

test("a title reading exactly like another issue's identifier stands for neither", () => {
  const board = [issue("LUKE-1", "Fix login"), issue("LUKE-2", "luke-1")];
  assert.deepEqual(mentionedIssues("Have a look at LUKE-1 today.", board), []);
});

test("an issue named by identifier and title at once counts once, at its first hearing", () => {
  const board = [issue("LUKE-1", "Fix login"), issue("LUKE-2", "Ship captions")];
  assert.deepEqual(
    identifiers(mentionedIssues("Ship captions waits on Fix login, that is LUKE-1.", board)),
    ["LUKE-2", "LUKE-1"],
  );
});

test("mentions past the cap are dropped from the tail of the reply", () => {
  const board = Array.from({ length: MAXIMUM_MENTIONED_ISSUES + 1 }, (_, index) =>
    issue(`LUKE-${index + 1}`, `Errand number ${index + 1}`),
  );
  const spoken = mentionedIssues(
    `${board.map((entry) => entry.identifier).join(", then ")}.`,
    board,
  );
  assert.equal(spoken.length, MAXIMUM_MENTIONED_ISSUES);
  assert.deepEqual(
    identifiers(spoken),
    board.slice(0, MAXIMUM_MENTIONED_ISSUES).map((entry) => entry.identifier),
  );
});

test("only the observed roster can be pointed at, whatever the words claim", () => {
  assert.deepEqual(mentionedIssues("Move LUKE-999 to Done right now.", []), []);
  assert.deepEqual(mentionedIssues("Move LUKE-999 to Done right now.", undefined), []);
  assert.deepEqual(mentionedIssues("Move LUKE-999 to Done.", [issue("LUKE-1", "Fix login")]), []);
});

test("an empty or absent caption mentions nothing", () => {
  const board = [issue("LUKE-1", "Fix login")];
  assert.deepEqual(mentionedIssues(undefined, board), []);
  assert.deepEqual(mentionedIssues("", board), []);
});
