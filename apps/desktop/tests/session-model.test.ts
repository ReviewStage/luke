import assert from "node:assert/strict";
import test from "node:test";
import {
  ATTENTION_DISPOSITION,
  fixtureSnapshot,
  normalizeSession,
  PROVIDER_ID,
  SESSION_STATE,
  SESSION_STATUS,
} from "@sidecar/core";
import {
  displaySessions,
  sessionTally,
  tallyCaption,
  tallySummary,
} from "../src/renderer/session-model";
import type { AppBootstrap } from "../src/shared/contracts";

const CLAUDE_PROVIDER = { id: PROVIDER_ID.CLAUDE_CODE, displayName: "Claude Code" };
const CODEX_PROVIDER = { id: PROVIDER_ID.CODEX, displayName: "Codex" };

function bootstrap(fixtureMode: boolean): AppBootstrap {
  return {
    fixtureMode,
    fixture: fixtureSnapshot("smoke"),
  } as AppBootstrap;
}

function liveSession(
  provider: typeof CLAUDE_PROVIDER,
  providerSessionId: string,
  status: (typeof SESSION_STATUS)[keyof typeof SESSION_STATUS],
) {
  return normalizeSession(provider, {
    providerSessionId,
    title: `Session ${providerSessionId}`,
    status,
    observedAt: 1_000,
  });
}

test("the most urgent sessions are listed first in either data source", () => {
  const fixtureStates = displaySessions(bootstrap(true), []).map((session) => session.state);
  assert.deepEqual(fixtureStates, [
    SESSION_STATE.ATTENTION,
    SESSION_STATE.WORKING,
    SESSION_STATE.WORKING,
    SESSION_STATE.COMPLETE,
    SESSION_STATE.UNKNOWN,
  ]);

  const live = displaySessions(bootstrap(false), [
    liveSession(CODEX_PROVIDER, "codex-1", SESSION_STATUS.COMPLETE),
    liveSession(CLAUDE_PROVIDER, "claude-1", SESSION_STATUS.WORKING),
    liveSession(CODEX_PROVIDER, "codex-2", SESSION_STATUS.WAITING),
  ]);
  assert.deepEqual(
    live.map((session) => session.id),
    ["codex-2", "claude-1", "codex-1"],
  );
  assert.equal(live[0]?.state, SESSION_STATE.ATTENTION);
  assert.equal(live[0]?.providerId, PROVIDER_ID.CODEX);
});

test("a speaking disposition needs a person even while the session works", () => {
  const speaking = normalizeSession(
    CLAUDE_PROVIDER,
    {
      providerSessionId: "claude-speaking",
      title: "Speaking session",
      status: SESSION_STATUS.WORKING,
      observedAt: 1_000,
    },
    { disposition: ATTENTION_DISPOSITION.SPEAK_AT_TURN_END, decidedAt: 1_000 },
  );

  const [session] = displaySessions(bootstrap(false), [speaking]);
  assert.equal(session?.state, SESSION_STATE.ATTENTION);
});

test("the tally counts per state and per provider", () => {
  const tally = sessionTally(displaySessions(bootstrap(true), []));

  assert.deepEqual(
    { ...tally, providers: undefined },
    {
      total: 5,
      attention: 1,
      working: 2,
      complete: 1,
      idle: 1,
      state: SESSION_STATE.ATTENTION,
      providers: undefined,
    },
  );
  // Providers follow the order their most urgent session takes, so Cursor's
  // working agent is listed ahead of Conductor's completed session.
  assert.deepEqual(tally.providers, [
    { providerId: PROVIDER_ID.CLAUDE_CODE, provider: "Claude Code", total: 2, attention: 1 },
    { providerId: PROVIDER_ID.CODEX, provider: "Codex", total: 1, attention: 0 },
    { providerId: PROVIDER_ID.CURSOR, provider: "Cursor", total: 1, attention: 0 },
    { providerId: PROVIDER_ID.CONDUCTOR, provider: "Conductor", total: 1, attention: 0 },
  ]);
});

test("the badge state follows the most urgent session", () => {
  const working = sessionTally(
    displaySessions(bootstrap(false), [liveSession(CODEX_PROVIDER, "a", SESSION_STATUS.WORKING)]),
  );
  const complete = sessionTally(
    displaySessions(bootstrap(false), [liveSession(CODEX_PROVIDER, "a", SESSION_STATUS.COMPLETE)]),
  );
  const empty = sessionTally([]);

  assert.equal(working.state, SESSION_STATE.WORKING);
  assert.equal(complete.state, SESSION_STATE.COMPLETE);
  assert.equal(empty.state, SESSION_STATE.UNKNOWN);
});

test("the caption names its own number so the count is never misread", () => {
  const tally = sessionTally(displaySessions(bootstrap(true), []));

  assert.equal(tallyCaption(tally), "1 needs you");
  assert.equal(tallySummary(tally), "5 sessions tracked, 1 needing you");
  assert.equal(tallyCaption({ ...tally, attention: 2 }), "2 need you");
  assert.equal(tallyCaption({ ...tally, attention: 0, working: 3 }), "3 working");
  assert.equal(tallyCaption({ ...tally, attention: 0, working: 0 }), "1 complete");
  assert.equal(tallyCaption({ ...tally, attention: 0, working: 0, complete: 0 }), "tracked");
  assert.equal(tallyCaption(sessionTally([])), "none tracked");
  assert.equal(tallySummary(sessionTally([])), "No sessions tracked");
});
