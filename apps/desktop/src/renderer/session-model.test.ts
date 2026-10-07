import assert from "node:assert/strict";
import {
  normalizeSession,
  PROVIDER_ID,
  SESSION_APPLICATION_ID,
  SESSION_STATUS,
  SESSION_URGENCY,
  type Session,
  type SessionProvider,
} from "@sidecar/session";
import { fixtureSnapshot } from "@sidecar/session/fixtures";
import { test } from "vitest";
import {
  fixtureSessions,
  matchRanges,
  observedSessions,
  type SessionView,
  sessionTally,
} from "./session-model";

const CLAUDE_PROVIDER = { id: PROVIDER_ID.CLAUDE_CODE, displayName: "Claude Code" };
const CODEX_PROVIDER = { id: PROVIDER_ID.CODEX, displayName: "Codex" };

/** The smoke fixture's own rows, which a fixture run counts instead of a roster. */
function fixtureRows(): readonly SessionView[] {
  return fixtureSessions(fixtureSnapshot("smoke"));
}

function liveSession(
  provider: SessionProvider,
  providerSessionId: string,
  status: (typeof SESSION_STATUS)[keyof typeof SESSION_STATUS],
  lastActivityAt = 1_000,
) {
  return normalizeSession(provider, {
    providerSessionId,
    title: `Session ${providerSessionId}`,
    status,
    lastActivityAt,
  });
}

/** The sessions a live launch would count. */
function liveRows(...sessions: readonly Session[]): readonly SessionView[] {
  return observedSessions(sessions);
}

test("the most urgent sessions are listed first in either data source", () => {
  const fixtureUrgencies = fixtureRows().map((session) => session.urgency);
  assert.deepEqual(fixtureUrgencies, [
    SESSION_URGENCY.ATTENTION,
    SESSION_URGENCY.WORKING,
    SESSION_URGENCY.WORKING,
    SESSION_URGENCY.WORKING,
    SESSION_URGENCY.COMPLETE,
    SESSION_URGENCY.UNKNOWN,
  ]);

  const live = liveRows(
    liveSession(CODEX_PROVIDER, "codex-1", SESSION_STATUS.COMPLETE),
    liveSession(CLAUDE_PROVIDER, "claude-1", SESSION_STATUS.WORKING),
    liveSession(CODEX_PROVIDER, "codex-2", SESSION_STATUS.WAITING),
  );
  assert.deepEqual(
    live.map((session) => session.id),
    ["codex-2", "claude-1", "codex-1"],
  );
  assert.equal(live[0]?.urgency, SESSION_URGENCY.ATTENTION);
  assert.equal(live[0]?.providerId, PROVIDER_ID.CODEX);
});

test("the tally counts per state and per app", () => {
  const tally = sessionTally(fixtureRows());

  assert.deepEqual(
    { ...tally, providers: undefined },
    {
      total: 6,
      attention: 1,
      // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
      // Named as well as counted: Luke's face reacts to a session that has just
      // started asking, which the count alone cannot report.
      attentionIds: ["claude-review"],
      working: 3,
      complete: 1,
      idle: 1,
      providers: undefined,
    },
  );
  // Apps follow the order their most urgent session takes, and a chat counts
  // under the app holding it: every Conductor chat lands under Conductor's
  // mark whatever agent runs them, the Codex chat under ChatGPT, its lead
  // app, and the local Claude Code session under the Claude app whose Code
  // tab holds it.
  assert.deepEqual(tally.providers, [
    { providerId: SESSION_APPLICATION_ID.CLAUDE, provider: "Claude", total: 1, attention: 1 },
    { providerId: SESSION_APPLICATION_ID.CHATGPT, provider: "ChatGPT", total: 1, attention: 0 },
    { providerId: SESSION_APPLICATION_ID.CONDUCTOR, provider: "Conductor", total: 4, attention: 0 },
  ]);
});

test("match ranges are found case-blind and merged where words overlap", () => {
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  // Two words landing on one stretch read as one mark, not nested ones.
  assert.deepEqual(matchRanges("Feat/LUKE-123-parser", ["luke", "ke-123"]), [
    { start: 5, end: 13 },
  ]);
  // Every occurrence is marked, not only the first.
  assert.deepEqual(matchRanges("alpha alpha", ["alpha"]), [
    { start: 0, end: 5 },
    { start: 6, end: 11 },
  ]);
  // A line the words did not land on yields nothing to mark.
  assert.deepEqual(matchRanges("nothing here", ["zeta"]), []);
});
