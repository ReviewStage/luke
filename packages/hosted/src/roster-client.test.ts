import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import {
  ACTION_KIND,
  CLOUD_AGENT_PROVIDER_ID,
  SESSION_CONTROL_KIND,
  SESSION_STATUS,
} from "@sidecar/session";
import { fakeCloudApi, recordedRoutes } from "@sidecar/wire/testing";
import { Effect } from "effect";
import { test } from "vitest";
import type { ObservedSession } from "./observe-wire.js";
import { HostedRosterClient, snapshotRoster } from "./roster-client.js";

const OBSERVED_AT = 1_800_000_000_000;

/** A row carrying every field the wire can, as the service writes it. */
const WORKING: ObservedSession = {
  providerId: CLOUD_AGENT_PROVIDER_ID.CONDUCTOR,
  sessionId: "chat-1",
  title: "Fix the roster test",
  status: SESSION_STATUS.WORKING,
  workspace: "luke",
  branch: "storage/e3",
  change: "https://github.com/deanstratakos/luke/pull/1",
  link: "conductor://session/chat-1",
  error: "the build failed",
  lastActivityAt: OBSERVED_AT - 5_000,
  canReceiveMessage: true,
  controls: [
    { id: "cancel-run", label: "Stop", kind: SESSION_CONTROL_KIND.STOP },
    { id: "archive", label: "Archive workspace", kind: SESSION_CONTROL_KIND.ARCHIVE },
    { id: "custom", label: "Custom" },
  ],
  spawnableAgents: ["claude-code", "codex"],
  canRename: true,
  canRenameWorkspace: true,
  canReadConversation: true,
};

/** A row the service dated only by the snapshot. */
const UNDATED: ObservedSession = {
  providerId: CLOUD_AGENT_PROVIDER_ID.CONDUCTOR,
  sessionId: "chat-2",
  title: "Write the release notes",
  status: SESSION_STATUS.COMPLETE,
};

function client(
  fetch: ReturnType<typeof fakeCloudApi>["fetch"],
  options: Partial<ConstructorParameters<typeof HostedRosterClient>[0]> = {},
) {
  return new HostedRosterClient({
    serviceBaseUrl: "https://tryluke.dev/",
    readAccessToken: async () => "token-1",
    refreshAccount: async () => undefined,
    fetch,
    ...options,
  });
}

it.effect("the roster is a bearer GET of the stored snapshot, never asked fresh", () =>
  Effect.gen(function* () {
    const api = fakeCloudApi({
      "GET /api/observe": {
        answer: () =>
          JSON.parse(JSON.stringify({ sessions: [WORKING, UNDATED], observedAt: OBSERVED_AT })),
      },
    });

    const answer = yield* Effect.promise(() => client(api.fetch).observe());

    assert.deepEqual(recordedRoutes(api.requests()), ["GET /api/observe"]);
    assert.deepEqual(api.credentials(), ["token-1"]);
    assert.equal(answer?.observedAt, OBSERVED_AT);
    assert.deepEqual(
      answer?.sessions.map((session) => session.sessionId),
      [WORKING.sessionId, UNDATED.sessionId],
    );
  }),
);

it.effect("a read that answers nothing is nothing, not an empty roster", () =>
  Effect.gen(function* () {
    const answer = yield* Effect.promise(() =>
      client(
        () => {
          throw new Error("must not travel without an account");
        },
        { readAccessToken: async () => undefined },
      ).observe(),
    );
    assert.equal(answer, undefined);
  }),
);

/** The one conductor observation a snapshot of one row comes to, or nothing where the row was left out. */
function observationOf(session: ObservedSession, observedAt: number | undefined) {
  const answer =
    observedAt === undefined ? { sessions: [session] } : { sessions: [session], observedAt };
  return snapshotRoster(answer).get(CLOUD_AGENT_PROVIDER_ID.CONDUCTOR)?.[0];
}

test("a wire row becomes the observation the roster holds, advertisements as presence", () => {
  assert.deepEqual(observationOf(WORKING, OBSERVED_AT), {
    providerSessionId: WORKING.sessionId,
    title: WORKING.title,
    status: SESSION_STATUS.WORKING,
    lastActivityAt: OBSERVED_AT - 5_000,
    detail: {
      repository: "luke",
      branch: "storage/e3",
      change: WORKING.change,
      link: WORKING.link,
      error: WORKING.error,
    },
    advertises: [
      { kind: ACTION_KIND.MESSAGE },
      {
        kind: ACTION_KIND.CONTROL,
        id: "cancel-run",
        label: "Stop",
        controlKind: SESSION_CONTROL_KIND.STOP,
      },
      {
        kind: ACTION_KIND.CONTROL,
        id: "archive",
        label: "Archive workspace",
        controlKind: SESSION_CONTROL_KIND.ARCHIVE,
      },
      { kind: ACTION_KIND.CONTROL, id: "custom", label: "Custom" },
      { kind: ACTION_KIND.ADD_AGENT, agents: ["claude-code", "codex"] },
      { kind: ACTION_KIND.RENAME_SESSION },
    ],
  });
});

test("a row without its own instant takes the snapshot's, and one with neither is left out", () => {
  assert.deepEqual(observationOf(UNDATED, OBSERVED_AT), {
    providerSessionId: UNDATED.sessionId,
    title: UNDATED.title,
    status: SESSION_STATUS.COMPLETE,
    lastActivityAt: OBSERVED_AT,
    detail: {},
    advertises: [],
  });
  assert.equal(observationOf(UNDATED, undefined), undefined);
  assert.equal(observationOf({ ...WORKING, status: "pondering" }, OBSERVED_AT), undefined);
});

test("the roster names every cloud provider, and a row under any other provider is dropped", () => {
  const roster = snapshotRoster({
    sessions: [WORKING, { ...UNDATED, providerId: "codex" }, UNDATED],
    observedAt: OBSERVED_AT,
  });
  assert.deepEqual([...roster.keys()], Object.values(CLOUD_AGENT_PROVIDER_ID));
  assert.deepEqual(
    roster.get(CLOUD_AGENT_PROVIDER_ID.CONDUCTOR)?.map((session) => session.providerSessionId),
    [WORKING.sessionId, UNDATED.sessionId],
  );

  const empty = snapshotRoster({ sessions: [] });
  assert.deepEqual(empty.get(CLOUD_AGENT_PROVIDER_ID.CONDUCTOR), []);
});
