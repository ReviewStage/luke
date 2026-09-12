import assert from "node:assert/strict";
import { SESSION_STATUS } from "@sidecar/session";
import { test } from "vitest";
import { APPEND_TOKEN_BOUND } from "./chunks.js";
import {
  ROSTER_SEED_BOUNDS,
  type RosterSeedSession,
  rosterSeedItem,
  rosterSeedText,
  rosterUpdateText,
} from "./roster-seed.js";
import { SEED_CONTENT_TYPE, SEED_ITEM_TYPE, SEED_ROLE } from "./seed.js";
import { estimatedTokens } from "./tokens.js";

const NOW = 1_800_000_000_000;
const MINUTE = 60_000;

function session(overrides: Partial<RosterSeedSession> & { id: string }): RosterSeedSession {
  const { id, ...rest } = overrides;
  return {
    identity: { providerId: "conductor", providerSessionId: id },
    title: `session ${id}`,
    provider: { displayName: "Conductor" },
    status: SESSION_STATUS.WORKING,
    lastActivityAt: NOW - MINUTE,
    ...rest,
  };
}

/** The one line a session renders, read out of a render of that session alone. */
function lineOf(one: RosterSeedSession, now: number = NOW): string {
  const text = rosterSeedText([one], now);
  assert.ok(text);
  const line = text.split("\n")[1];
  assert.ok(line);
  return line;
}

function lines(text: string | undefined): readonly string[] {
  assert.ok(text);
  return text.split("\n");
}

test("the seed is one developer message whose text is a preface, one line per session, and a closing line", () => {
  const roster = [session({ id: "a" }), session({ id: "b" })];
  const item = rosterSeedItem(roster, NOW);
  assert.deepEqual(item, {
    type: SEED_ITEM_TYPE,
    role: SEED_ROLE.DEVELOPER,
    content: [
      {
        type: SEED_CONTENT_TYPE.INPUT_TEXT,
        text: rosterSeedText(roster, NOW),
      },
    ],
  });
  assert.equal(lines(rosterSeedText(roster, NOW)).length, roster.length + 2);
});

test("an empty desk seeds nothing at all", () => {
  assert.equal(rosterSeedText([], NOW), undefined);
  assert.equal(rosterSeedItem([], NOW), undefined);
});

test("a hold leads, then a plain wait, then working, then the rest, newest write first inside each", () => {
  const holding = session({
    id: "holding",
    status: SESSION_STATUS.WAITING,
    holdingForDeveloper: true,
    lastActivityAt: NOW - 30 * MINUTE,
  });
  const waiting = session({
    id: "waiting",
    status: SESSION_STATUS.WAITING,
    lastActivityAt: NOW - MINUTE,
  });
  const workingOld = session({ id: "working-old", lastActivityAt: NOW - 10 * MINUTE });
  const workingNew = session({ id: "working-new", lastActivityAt: NOW - 2 * MINUTE });
  const complete = session({ id: "complete", status: SESSION_STATUS.COMPLETE });
  const failed = session({ id: "failed", status: SESSION_STATUS.ERROR });
  const text = rosterSeedText([complete, workingOld, failed, workingNew, waiting, holding], NOW);
  assert.deepEqual(lines(text).slice(1, -1), [
    lineOf(holding),
    lineOf(waiting),
    lineOf(workingNew),
    lineOf(workingOld),
    lineOf(failed),
    lineOf(complete),
  ]);
});

test("the cap never cuts a hold, however old it is beside the waits around it", () => {
  const holding = session({
    id: "holding",
    status: SESSION_STATUS.WAITING,
    holdingForDeveloper: true,
    lastActivityAt: NOW - 10 * 60 * MINUTE,
  });
  const newerWaits = Array.from({ length: ROSTER_SEED_BOUNDS.SESSIONS + 4 }, (_, index) =>
    session({
      id: `wait-${index}`,
      status: SESSION_STATUS.WAITING,
      lastActivityAt: NOW - index * MINUTE,
    }),
  );
  const body = lines(rosterSeedText([...newerWaits, holding], NOW)).slice(1, -1);
  assert.equal(body.length, ROSTER_SEED_BOUNDS.SESSIONS);
  assert.equal(body[0], lineOf(holding));
});

test("the desk is capped, and the whole summary stays inside one append's bound", () => {
  const many = Array.from({ length: ROSTER_SEED_BOUNDS.SESSIONS + 4 }, (_, index) =>
    session({ id: `s${index}`, title: "x".repeat(500) }),
  );
  const text = rosterSeedText(many, NOW);
  assert.equal(lines(text).length, ROSTER_SEED_BOUNDS.SESSIONS + 2);
  assert.ok(text);
  assert.ok(estimatedTokens(text) <= APPEND_TOKEN_BOUND);
});

test("an observed value is flattened and cut before it enters a line", () => {
  const long = session({
    id: "long",
    title: `  first\nsecond   third ${"y".repeat(500)}`,
    status: SESSION_STATUS.WAITING,
    holdingForDeveloper: true,
    activity: `read\nfile ${"z".repeat(500)}`,
  });
  const cut = session({
    id: "long",
    title: `first second third ${"y".repeat(500)}`.slice(0, ROSTER_SEED_BOUNDS.TITLE_CHARS),
    status: SESSION_STATUS.WAITING,
    holdingForDeveloper: true,
    activity: `read file ${"z".repeat(500)}`.slice(0, ROSTER_SEED_BOUNDS.ACTIVITY_CHARS),
  });
  assert.equal(lineOf(long), lineOf(cut));
  assert.equal(lines(rosterSeedText([long], NOW)).length, 3);
});

test("the held tool rides only on a wait the provider reported as holding for the developer", () => {
  const held = { id: "held", status: SESSION_STATUS.WAITING, holdingForDeveloper: true } as const;
  const idle = { id: "held", status: SESSION_STATUS.WAITING } as const;
  const working = { id: "held" } as const;
  assert.notEqual(lineOf(session({ ...held, activity: "bash" })), lineOf(session({ ...held })));
  assert.equal(lineOf(session({ ...idle, activity: "bash" })), lineOf(session({ ...idle })));
  assert.equal(lineOf(session({ ...working, activity: "bash" })), lineOf(session({ ...working })));
});

test("the age reads in coarse buckets, so a line moves only at an edge a session crossed", () => {
  const one = session({ id: "age" });
  assert.equal(lineOf(one, one.lastActivityAt + 1), lineOf(one, one.lastActivityAt + 59_000));
  assert.notEqual(
    lineOf(one, one.lastActivityAt + 1),
    lineOf(one, one.lastActivityAt + 5 * MINUTE),
  );
  assert.equal(
    lineOf(one, one.lastActivityAt + 2 * 60 * MINUTE),
    lineOf(one, one.lastActivityAt + 9 * 60 * MINUTE),
  );
});

test("an unchanged roster is no update at all", () => {
  const roster = [session({ id: "a" }), session({ id: "b", status: SESSION_STATUS.COMPLETE })];
  assert.equal(rosterUpdateText(roster, [...roster], NOW), undefined);
});

test("an update carries the lines that changed and nothing else", () => {
  const still = session({ id: "still" });
  const moved = session({ id: "moved" });
  const after = { ...moved, status: SESSION_STATUS.COMPLETE };
  const text = rosterUpdateText([still, moved], [still, after], NOW);
  assert.deepEqual(lines(text).slice(1), [lineOf(after)]);
});

test("a session that has left the desk is withdrawn by name, and an added one arrives as its own line", () => {
  const stays = session({ id: "stays" });
  const leaves = session({ id: "leaves", title: "gone agent" });
  const arrives = session({ id: "arrives" });
  const text = rosterUpdateText([stays, leaves], [stays, arrives], NOW);
  const body = lines(text).slice(1);
  assert.equal(body.length, 2);
  assert.deepEqual(body[0], lineOf(arrives));
  assert.notEqual(body[1], lineOf(leaves));
});

test("a session never told a roster is told the whole summary rather than a diff against nothing", () => {
  const roster = [session({ id: "a" })];
  assert.equal(rosterUpdateText(undefined, roster, NOW), rosterSeedText(roster, NOW));
});

test("an update stays inside one append's bound too", () => {
  const many = Array.from({ length: ROSTER_SEED_BOUNDS.SESSIONS + 4 }, (_, index) =>
    session({ id: `s${index}`, title: "x".repeat(500) }),
  );
  const text = rosterUpdateText([], many, NOW);
  assert.ok(text);
  assert.ok(estimatedTokens(text) <= APPEND_TOKEN_BOUND);
});
