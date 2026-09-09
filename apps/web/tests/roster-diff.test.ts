import assert from "node:assert/strict";
import test from "node:test";
import { type ProviderSessionObservation, SESSION_STATUS } from "@sidecar/session";
import {
  decodeObservedRoster,
  encodeObservedRoster,
  type ObservedRoster,
} from "../server/hosted/observed-roster";
import {
  decodeRosterDiff,
  encodeRosterDiff,
  rosterDiff,
  rosterDiffIsEmpty,
} from "../server/hosted/roster-diff";

/** Synthetic fixtures: no real title, branch, or error line anywhere. */

const NOW = Date.parse("2026-08-12T02:45:00.000Z");

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
    providers: [
      {
        providerId: "conductor",
        keyFingerprint: "fingerprint-1",
        observations,
        projects: [{ providerProjectId: "project-1", repository: "repo", taskSupport: "optional" }],
      },
    ],
  };
}

test("an unchanged roster is an empty diff, whatever moved that is not news", () => {
  const before = roster([observation("s-1")]);
  const after = roster([
    observation("s-1", { title: "Renamed", lastActivityAt: NOW + 5_000, advertises: [] }),
  ]);

  const diff = rosterDiff(before, after);

  assert.equal(rosterDiffIsEmpty(diff), true);
  assert.equal(rosterDiffIsEmpty(rosterDiff(before, before)), true);
});

test("a session appearing or vanishing is named with what the later snapshot showed of it", () => {
  const before = roster([observation("s-1"), observation("s-2")]);
  const after = roster([
    observation("s-1"),
    observation("s-3", {
      status: SESSION_STATUS.WAITING,
      workspace: { providerWorkspaceId: "workspace-b" },
    }),
  ]);

  const diff = rosterDiff(before, after);

  assert.deepEqual(diff.appeared, [
    {
      providerId: "conductor",
      providerSessionId: "s-3",
      title: "Chat s-3",
      status: SESSION_STATUS.WAITING,
      workspaceId: "workspace-b",
    },
  ]);
  assert.deepEqual(diff.vanished, [
    {
      providerId: "conductor",
      providerSessionId: "s-2",
      title: "Chat s-2",
      status: SESSION_STATUS.WORKING,
      workspaceId: "workspace-a",
      workspaceName: "workspace-a-name",
    },
  ]);
  assert.deepEqual(diff.workspacesAppeared, [
    { providerId: "conductor", providerWorkspaceId: "workspace-b" },
  ]);
  assert.deepEqual(diff.workspacesVanished, []);
  assert.deepEqual(diff.statusChanged, []);
});

test("a status transition, an error line moving, and lifecycle words moving are each their own change", () => {
  const before = roster([
    observation("s-1"),
    observation("s-2", { detail: { repository: "repo", activity: "Workspace initializing" } }),
    observation("s-3", { status: SESSION_STATUS.ERROR, detail: { error: "out of memory" } }),
  ]);
  const after = roster([
    observation("s-1", { status: SESSION_STATUS.ERROR, detail: { error: "container died" } }),
    observation("s-2", { detail: { repository: "repo" } }),
    observation("s-3", { status: SESSION_STATUS.ERROR, detail: { error: "out of memory" } }),
  ]);

  const diff = rosterDiff(before, after);

  assert.equal(diff.statusChanged.length, 1);
  assert.equal(diff.statusChanged[0]?.session.providerSessionId, "s-1");
  assert.equal(diff.statusChanged[0]?.from, SESSION_STATUS.WORKING);
  assert.equal(diff.statusChanged[0]?.to, SESSION_STATUS.ERROR);
  assert.deepEqual(
    diff.errorChanged.map((change) => [change.session.providerSessionId, change.from, change.to]),
    [["s-1", undefined, "container died"]],
  );
  assert.deepEqual(
    diff.activityChanged.map((change) => [
      change.session.providerSessionId,
      change.from,
      change.to,
    ]),
    [["s-2", "Workspace initializing", undefined]],
  );
  assert.deepEqual(diff.appeared, []);
  assert.deepEqual(diff.vanished, []);
});

test("a workspace vanishes only when no chat of it stands, and a provider gone whole vanishes every row", () => {
  const before = roster([
    observation("s-1"),
    observation("s-2"),
    observation("s-3", { workspace: { providerWorkspaceId: "workspace-b" } }),
  ]);
  const after = roster([observation("s-1")]);

  const diff = rosterDiff(before, after);
  assert.deepEqual(
    diff.vanished.map((session) => session.providerSessionId),
    ["s-2", "s-3"],
  );
  assert.deepEqual(diff.workspacesVanished, [
    { providerId: "conductor", providerWorkspaceId: "workspace-b" },
  ]);

  const gone = rosterDiff(before, { version: 1, providers: [] });
  assert.equal(gone.vanished.length, 3);
  assert.equal(gone.workspacesVanished.length, 2);
});

test("a diff and a roster round-trip through their stored encodings, and an unreadable body reads as nothing", () => {
  const before = roster([observation("s-1")]);
  const after = roster([observation("s-1", { status: SESSION_STATUS.WAITING })]);
  const diff = rosterDiff(before, after);

  assert.deepEqual(decodeRosterDiff(encodeRosterDiff(diff)), diff);
  assert.deepEqual(decodeObservedRoster(encodeObservedRoster(after)), after);

  assert.equal(decodeRosterDiff("not json"), undefined);
  assert.equal(decodeRosterDiff(JSON.stringify({ appeared: "no" })), undefined);
  assert.equal(decodeObservedRoster("not json"), undefined);
  assert.equal(decodeObservedRoster(JSON.stringify({ version: 2, providers: [] })), undefined);
  assert.equal(
    decodeObservedRoster(
      JSON.stringify({
        version: 1,
        providers: [
          {
            providerId: "conductor",
            keyFingerprint: "f",
            observations: [{ title: "no id" }],
            projects: [],
          },
        ],
      }),
    ),
    undefined,
  );
  assert.equal(
    decodeObservedRoster(
      JSON.stringify({
        version: 1,
        providers: [{ providerId: "linear", keyFingerprint: "f", observations: [], projects: [] }],
      }),
    ),
    undefined,
  );
});
