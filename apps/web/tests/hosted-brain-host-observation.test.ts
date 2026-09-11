import assert from "node:assert/strict";
import { test } from "vitest";
import {
  ACTION_RESULT_STATUS,
  BRAIN_INPUT_MARKER,
  BRAIN_WAKE_KIND,
  type ProviderSessionObservation,
  SESSION_STATUS,
} from "../server/core";
import { observationTurnWords } from "../server/hosted/brain-host/observation";
import { hostedRosterFrom } from "../server/hosted/brain-host/roster";
import type { ObservedRoster } from "../server/hosted/observed-roster";
import { encodeRosterDiff, rosterDiff } from "../server/hosted/roster-diff";
import { memoryObservationStore } from "./support/observation-store";

/**
 * What an observation turn opens with: the pending diffs as wakes, each live
 * chat's transcript delta read from its cursor, and the diffs consumed only
 * when the caller says the turn was accepted. Synthetic fixtures throughout.
 */

const NOW = Date.parse("2026-08-12T02:45:00.000Z");
const USER = "user-observed";

function observation(
  id: string,
  overrides: Partial<ProviderSessionObservation> = {},
): ProviderSessionObservation {
  return {
    providerSessionId: id,
    title: `Chat ${id}`,
    status: SESSION_STATUS.WORKING,
    lastActivityAt: NOW,
    workspace: { providerWorkspaceId: "workspace-a", name: "workspace-a-name" },
    detail: { repository: "repo" },
    advertises: [{ kind: "message" }],
    ...overrides,
  };
}

function roster(observations: readonly ProviderSessionObservation[]): ObservedRoster {
  return {
    version: 1,
    providers: [{ providerId: "conductor", keyFingerprint: "f", observations, projects: [] }],
  };
}

test("pending diffs become one wake per session named, live chats carry their delta, and consuming marks the diffs", async () => {
  const before = roster([observation("s-1")]);
  const after = roster([
    observation("s-1", { status: SESSION_STATUS.WAITING }),
    observation("s-2", { status: SESSION_STATUS.COMPLETE }),
  ]);
  const store = memoryObservationStore();
  const later = roster([
    observation("s-1", { status: SESSION_STATUS.WORKING }),
    observation("s-2", { status: SESSION_STATUS.COMPLETE }),
  ]);
  store.diffs.set(USER, [
    {
      id: "diff-1",
      observedAt: NOW,
      previousObservedAt: NOW - 60_000,
      payload: encodeRosterDiff(rosterDiff(before, after)),
    },
    {
      id: "diff-2",
      observedAt: NOW + 60_000,
      previousObservedAt: NOW,
      payload: encodeRosterDiff(rosterDiff(after, later)),
    },
  ]);
  const asked: string[] = [];
  const kept: string[] = [];

  const words = await observationTurnWords({
    store,
    userId: USER,
    roster: hostedRosterFrom(after, NOW),
    transcripts: {
      since: async (identity) => {
        asked.push(identity.providerSessionId);
        return identity.providerSessionId === "s-1"
          ? {
              delta: {
                text: "Developer: go on",
                truncated: false,
                status: ACTION_RESULT_STATUS.ACCEPTED,
              },
              cursor: "cursor-1",
            }
          : undefined;
      },
      keep: async (identity, cursor) => {
        kept.push(`${identity.providerSessionId}:${cursor}`);
      },
    },
    now: () => NOW,
  });

  assert.ok(words);
  assert.equal(words.events.length, 3);
  assert.deepEqual(
    words.events.map((event) => event.kind),
    [BRAIN_WAKE_KIND.ROSTER, BRAIN_WAKE_KIND.ROSTER, BRAIN_WAKE_KIND.ROSTER],
  );
  assert.deepEqual(asked.sort(), ["s-1", "s-2"]);
  const withDelta = words.events.filter((event) => event.transcriptDelta !== undefined);
  assert.equal(withDelta.length, 1);
  assert.equal(withDelta[0]?.identity.providerSessionId, "s-1");
  assert.equal(withDelta[0]?.transcriptDelta?.text, "Developer: go on");
  assert.equal(words.words.startsWith(BRAIN_INPUT_MARKER.OBSERVED_EVENTS), true);
  assert.equal((await store.roster.pendingDiffs(USER)).length, 2);
  assert.deepEqual(kept, []);
  const consumeDiff = store.roster.consumeDiff;
  store.roster.consumeDiff = (userId, id, now) => {
    // The bookmark stands before any diff is consumed.
    assert.deepEqual(kept, ["s-1:cursor-1"]);
    return consumeDiff(userId, id, now);
  };
  await words.consume();
  assert.equal((await store.roster.pendingDiffs(USER)).length, 0);
  assert.deepEqual(kept, ["s-1:cursor-1"]);
});

test("no pending diff opens no turn", async () => {
  const store = memoryObservationStore();
  const words = await observationTurnWords({
    store,
    userId: USER,
    roster: hostedRosterFrom(undefined, undefined),
    transcripts: { since: async () => undefined, keep: async () => undefined },
    now: () => NOW,
  });
  assert.equal(words, undefined);
});
