import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { fakeHttpClientLayer } from "@sidecar/wire/testing";
import { Effect, type Layer, Redacted } from "effect";
import type * as HttpClient from "effect/unstable/http/HttpClient";
import type { JsonObject } from "../../../packages/wire/src/testing/json.js";
import {
  ACTION_KIND,
  ACTION_REFUSAL,
  type WireRecord,
  type WorkspaceAgentSelection,
} from "../server/core";
import {
  type ActionRoster,
  actionRosterFor,
  actionUnsupportedReason,
  executeSessionAction,
  type HostedSessionActionKind,
} from "../server/hosted/action-execute";
import { handleSessionAction, type SessionActionOptions } from "../server/hosted/action-session";
import { encryptProviderKey } from "../server/hosted/encryption";
import { observeAndSnapshot, rosterForAction } from "../server/hosted/observation-pass";
import type { VaultKeyRow } from "../server/hosted/vault-route";
import { noDatabase } from "./support/no-database";
import { memoryObservationStore } from "./support/observation-store";

const SECRET = Redacted.make("a".repeat(64));
const NOW = Date.parse("2026-08-12T02:45:00.000Z");

const EMPTY_ROSTER: ActionRoster = {
  observations: [],
  projects: [],
  unauthorized: false,
  unreachable: false,
};

function actionRequest(path: string, fields: Record<string, string>): Request {
  return new Request(`https://luke.test${path}`, {
    method: "POST",
    headers: { authorization: "Bearer token-1", "content-type": "application/json" },
    body: JSON.stringify(fields),
  });
}

function messageOptions(overrides: Partial<SessionActionOptions> = {}): SessionActionOptions {
  return {
    request: actionRequest("/api/actions/message", {
      providerId: "conductor",
      providerSessionId: "session-1",
      text: "hello",
    }),
    kind: ACTION_KIND.MESSAGE,
    encryptionSecret: SECRET,
    resolveUserId: () => Effect.succeedSome("user-1"),
    readKey: () => Effect.succeed({ ciphertext: encryptProviderKey("key-1", SECRET) }),
    roster: () => Effect.succeed(EMPTY_ROSTER),
    unsupportedReason: () => undefined,
    // No pairing synced unless a test stores one: the route's production read
    // reaches the account's rows, and these tests open no database.
    agentDefault: () => Effect.succeed(undefined),
    execute: () => Effect.succeed({ result: "accepted" }),
    ...overrides,
  };
}

function agentOptions(overrides: Partial<SessionActionOptions> = {}): SessionActionOptions {
  return messageOptions({
    request: actionRequest("/api/actions/agent", {
      providerId: "conductor",
      providerSessionId: "session-1",
      agent: "claude",
      task: "add tests",
    }),
    kind: ACTION_KIND.ADD_AGENT,
    ...overrides,
  });
}

function workspaceOptions(overrides: Partial<SessionActionOptions> = {}): SessionActionOptions {
  return messageOptions({
    request: actionRequest("/api/actions/workspace", {
      providerId: "conductor",
      providerProjectId: "project-1",
      task: "build the thing",
    }),
    kind: ACTION_KIND.CREATE_WORKSPACE,
    ...overrides,
  });
}

// --- Unsupported providers answer before the key requirement ---

it.layer(noDatabase)("the hosted action route over a store that is a memory fake", (it) => {
  it.effect("an unsupported provider gets 'unsupported' even with no key stored", () =>
    Effect.gen(function* () {
      const response = yield* handleSessionAction(
        messageOptions({
          unsupportedReason: () => "Not available.",
          readKey: () => Effect.succeed(undefined),
          execute: () => Effect.die(new Error("execute must not run for an unsupported provider")),
        }),
      );

      assert.equal(response.status, 200);
      const body = yield* Effect.promise(() => response.json());
      assert.equal(body.result, "unsupported");
      assert.equal(body.reason, "Not available.");
    }),
  );

  it.effect("an unsupported workspace provider gets 'unsupported' even with no key stored", () =>
    Effect.gen(function* () {
      const response = yield* handleSessionAction(
        workspaceOptions({
          unsupportedReason: () => "Not available.",
          readKey: () => Effect.succeed(undefined),
          execute: () => Effect.die(new Error("execute must not run for an unsupported provider")),
        }),
      );

      assert.equal(response.status, 200);
      const body = yield* Effect.promise(() => response.json());
      assert.equal(body.result, "unsupported");
      assert.equal(body.reason, "Not available.");
    }),
  );

  // --- Supported provider with no key is still a rejection ---

  it.effect("a supported provider with no key stored gets 'rejected'", () =>
    Effect.gen(function* () {
      const response = yield* handleSessionAction(
        messageOptions({ readKey: () => Effect.succeed(undefined) }),
      );

      assert.equal(response.status, 200);
      const body = yield* Effect.promise(() => response.json());
      assert.equal(body.result, "rejected");
    }),
  );

  // --- The one bound the route still keeps: a session id becomes a URL segment ---

  it.effect("a session id that could not be a URL segment is an invalid request", () =>
    Effect.gen(function* () {
      const response = yield* handleSessionAction(
        messageOptions({
          request: actionRequest("/api/actions/message", {
            providerId: "conductor",
            providerSessionId: "sessions/../session-1",
            text: "hello",
          }),
          execute: () => Effect.die(new Error("execute must not run for an unbounded session id")),
        }),
      );

      assert.equal(response.status, 400);
    }),
  );

  it.effect("an action aimed at no session at all is an invalid request", () =>
    Effect.gen(function* () {
      const response = yield* handleSessionAction(
        messageOptions({
          request: actionRequest("/api/actions/message", {
            providerId: "conductor",
            text: "hello",
          }),
          execute: () => Effect.die(new Error("execute must not run without a session")),
        }),
      );

      assert.equal(response.status, 400);
    }),
  );

  // --- The ask reaches admission renamed and unparsed ---

  it.effect("the ask arrives at the executor as admission's own field names", () =>
    Effect.gen(function* () {
      let received: WireRecord | undefined;
      yield* handleSessionAction(
        messageOptions({
          execute: (options) =>
            Effect.sync(() => {
              received = options.fields;
              return { result: "accepted" };
            }),
        }),
      );

      assert.deepEqual(received, {
        provider_id: "conductor",
        provider_session_id: "session-1",
        text: "hello",
      });
    }),
  );

  it.effect("a creation names a project rather than a session, and carries none", () =>
    Effect.gen(function* () {
      let received: WireRecord | undefined;
      yield* handleSessionAction(
        workspaceOptions({
          execute: (options) =>
            Effect.sync(() => {
              received = options.fields;
              return { result: "accepted" };
            }),
        }),
      );

      assert.deepEqual(received, {
        provider_id: "conductor",
        project_id: "project-1",
        task: "build the thing",
      });
    }),
  );

  it.effect(
    "an agent addition carries the model and effort beside the agent, renamed and unparsed",
    () =>
      Effect.gen(function* () {
        let received: WireRecord | undefined;
        yield* handleSessionAction(
          messageOptions({
            request: actionRequest("/api/actions/agent", {
              providerId: "conductor",
              providerSessionId: "session-1",
              agent: "claude",
              model: "fable-5",
              effort: "high",
              task: "add tests",
            }),
            kind: ACTION_KIND.ADD_AGENT,
            execute: (options) =>
              Effect.sync(() => {
                received = options.fields;
                return { result: "accepted" };
              }),
          }),
        );

        assert.deepEqual(received, {
          provider_id: "conductor",
          provider_session_id: "session-1",
          agent: "claude",
          model: "fable-5",
          effort: "high",
          task: "add tests",
        });
      }),
  );

  // --- The account's stored agent pairing reaches the execution for the two actions that start an agent ---

  const SYNCED_PAIRING: WorkspaceAgentSelection = {
    agent: "claude",
    model: "fable-5-1",
    effort: "high",
  };

  /** What one execution was handed: the ask's fields, and the pairing beside them when one rode. */
  interface HandedToExecution {
    fields: WireRecord;
    agentSelection?: WorkspaceAgentSelection;
  }

  /** An `execute` that records what it was handed, answering accepted. */
  function recordingExecute(
    handed: HandedToExecution[],
  ): NonNullable<SessionActionOptions["execute"]> {
    return (options) =>
      Effect.sync(() => {
        handed.push({
          fields: options.fields,
          ...(options.agentSelection === undefined
            ? undefined
            : { agentSelection: options.agentSelection }),
        });
        return { result: "accepted" };
      });
  }

  /** An `agentDefault` that must never be read: a read is the test's failure. */
  const unreadAgentDefault: NonNullable<SessionActionOptions["agentDefault"]> = () =>
    Effect.die(new Error("the stored pairing must not be read for this ask"));

  it.effect(
    "a creation that named no model hands the account's stored pairing to the execution",
    () =>
      Effect.gen(function* () {
        const handed: HandedToExecution[] = [];
        const asked: { userId: string; providerId: string }[] = [];
        yield* handleSessionAction(
          workspaceOptions({
            agentDefault: (userId, providerId) => {
              asked.push({ userId, providerId });
              return Effect.succeed(SYNCED_PAIRING);
            },
            execute: recordingExecute(handed),
          }),
        );

        // Read once, for the signed-in account and the provider the ask named, and
        // handed on whole — effort included — beside fields that still name no model.
        assert.deepEqual(asked, [{ userId: "user-1", providerId: "conductor" }]);
        assert.deepEqual(handed, [
          {
            fields: { provider_id: "conductor", project_id: "project-1", task: "build the thing" },
            agentSelection: SYNCED_PAIRING,
          },
        ]);
      }),
  );

  it.effect("an agent addition is handed the stored pairing on the same terms", () =>
    Effect.gen(function* () {
      const handed: HandedToExecution[] = [];
      yield* handleSessionAction(
        agentOptions({
          agentDefault: () => Effect.succeed(SYNCED_PAIRING),
          execute: recordingExecute(handed),
        }),
      );

      assert.deepEqual(handed, [
        {
          fields: {
            provider_id: "conductor",
            provider_session_id: "session-1",
            agent: "claude",
            task: "add tests",
          },
          agentSelection: SYNCED_PAIRING,
        },
      ]);
    }),
  );

  it.effect("an account that synced no pairing hands the execution none, not a guess", () =>
    Effect.gen(function* () {
      const handed: HandedToExecution[] = [];
      yield* handleSessionAction(
        workspaceOptions({
          agentDefault: () => Effect.succeed(undefined),
          execute: recordingExecute(handed),
        }),
      );

      assert.equal(handed.length, 1);
      assert.equal("agentSelection" in (handed[0] ?? {}), false);
    }),
  );

  it.effect("the stored pairing is read for no action that starts no agent", () =>
    Effect.gen(function* () {
      const handed: HandedToExecution[] = [];
      yield* handleSessionAction(
        messageOptions({ agentDefault: unreadAgentDefault, execute: recordingExecute(handed) }),
      );

      assert.deepEqual(handed, [
        { fields: { provider_id: "conductor", provider_session_id: "session-1", text: "hello" } },
      ]);
    }),
  );

  it.effect("the stored pairing is read for no creation a gate refused first", () =>
    Effect.gen(function* () {
      const unsupported = yield* handleSessionAction(
        workspaceOptions({
          unsupportedReason: () => "Not available.",
          agentDefault: unreadAgentDefault,
          execute: () => Effect.die(new Error("execute must not run for an unsupported provider")),
        }),
      );
      assert.equal((yield* Effect.promise(() => unsupported.json())).result, "unsupported");

      const keyless = yield* handleSessionAction(
        workspaceOptions({
          readKey: () => Effect.succeed(undefined),
          agentDefault: unreadAgentDefault,
          execute: () => Effect.die(new Error("execute must not run without a key")),
        }),
      );
      assert.equal((yield* Effect.promise(() => keyless.json())).result, "rejected");
    }),
  );

  // --- The execute result travels to the wire unchanged ---

  it.effect("a rejected execute result carries its reason and session id to the wire", () =>
    Effect.gen(function* () {
      const response = yield* handleSessionAction(
        workspaceOptions({
          execute: () =>
            Effect.succeed({
              result: "rejected",
              providerSessionId: "session-9",
              reason: "Workspace was created, but the opening task could not be delivered.",
            }),
        }),
      );

      assert.equal(response.status, 200);
      const body = yield* Effect.promise(() => response.json());
      assert.equal(body.result, "rejected");
      assert.equal(body.providerSessionId, "session-9");
    }),
  );

  it.effect("an accepted execute result carries the created session id to the wire", () =>
    Effect.gen(function* () {
      const response = yield* handleSessionAction(
        workspaceOptions({
          execute: () => Effect.succeed({ result: "accepted", providerSessionId: "session-9" }),
        }),
      );

      assert.equal(response.status, 200);
      const body = yield* Effect.promise(() => response.json());
      assert.equal(body.result, "accepted");
      assert.equal(body.providerSessionId, "session-9");
    }),
  );

  // --- The capability map mirrors the adapters exactly ---

  it("the capability map matches each desktop adapter's implemented writes", () => {
    const actions: readonly HostedSessionActionKind[] = [
      ACTION_KIND.MESSAGE,
      ACTION_KIND.CONTROL,
      ACTION_KIND.ADD_AGENT,
      ACTION_KIND.RENAME_SESSION,
      ACTION_KIND.RENAME_WORKSPACE,
      ACTION_KIND.CREATE_WORKSPACE,
    ];

    for (const action of actions) {
      assert.deepEqual(
        (["conductor"] as const).filter(
          (providerId) => actionUnsupportedReason(action, providerId) === undefined,
        ),
        ["conductor"],
        action,
      );
    }
  });

  it.effect(
    "the roster an action stands on is read once the key is, and reaches the executor",
    () =>
      Effect.gen(function* () {
        const asked: string[] = [];
        let received: ActionRoster | undefined;
        yield* handleSessionAction(
          messageOptions({
            roster: (userId, providerId, secret) =>
              Effect.sync(() => {
                asked.push(userId, providerId, Redacted.value(secret));
                return EMPTY_ROSTER;
              }),
            execute: (options) =>
              Effect.sync(() => {
                received = options.roster;
                return { result: "accepted" };
              }),
          }),
        );

        assert.deepEqual(asked, ["user-1", "conductor", Redacted.value(SECRET)]);
        assert.equal(received, EMPTY_ROSTER);
      }),
  );

  // --- One executor admits every action, over the snapshot the user was shown ---

  const CONDUCTOR_PROJECT_ID = "project-1";
  const CONDUCTOR_WORKSPACE_ID = "workspace-1";
  const CONDUCTOR_SESSION_ID = "session-1";

  /**
   * The read-only subset of Conductor's API one action pass walks — identity,
   * projects, the caller's workspaces, each workspace's sessions and lifecycle,
   * each session's status — with the session in the given state, plus a
   * recorder for whatever the action itself posts.
   */
  function conductorApi(status: string) {
    const posts: Array<{ url: string; body: string }> = [];
    const reads: string[] = [];
    const json = (value: JsonObject) => new Response(JSON.stringify(value), { status: 200 });
    const layer = fakeHttpClientLayer((url, init) => {
      const { pathname } = new URL(url);
      if (init.method === "POST") {
        if (pathname.endsWith("/v0/sql")) {
          reads.push(pathname);
          return json({ rows: [], rowCount: 0, truncated: false });
        }
        posts.push({ url, body: String(init.body) });
        if (pathname.endsWith("/v0/workspaces")) {
          return new Response(
            JSON.stringify({ workspaceId: "workspace-new", sessionId: "session-new" }),
            { status: 201 },
          );
        }
        return new Response(JSON.stringify({ messageId: "message-1", state: "queued" }), {
          status: 201,
        });
      }
      reads.push(pathname);
      if (pathname.endsWith("/me")) return json({ userId: "user-1" });
      if (pathname.endsWith("/v0/projects")) {
        return json({
          data: [
            { id: CONDUCTOR_PROJECT_ID, gitRemote: "https://github.com/owner/repo", name: "repo" },
          ],
          offset: 0,
          hasMore: false,
        });
      }
      if (pathname.endsWith("/v0/workspaces")) {
        return json({
          data: [
            {
              id: CONDUCTOR_WORKSPACE_ID,
              name: "amber-shoal",
              state: "ready",
              repoUrl: "https://github.com/owner/repo",
              creatorId: "user-1",
              createdAt: "2026-08-12T02:00:00.000Z",
              lastActivityAt: "2026-08-12T02:40:00.000Z",
              deepLink: `conductor://workspace?id=${CONDUCTOR_WORKSPACE_ID}`,
            },
          ],
          offset: 0,
          hasMore: false,
        });
      }
      if (pathname.endsWith(`/v0/workspaces/${CONDUCTOR_WORKSPACE_ID}/sessions`)) {
        return json({
          data: [
            {
              id: CONDUCTOR_SESSION_ID,
              name: "Revamp the panel",
              deepLink: `conductor://workspace?session=${CONDUCTOR_SESSION_ID}`,
            },
          ],
          offset: 0,
          hasMore: false,
        });
      }
      if (pathname.endsWith(`/v0/workspaces/${CONDUCTOR_WORKSPACE_ID}/status`)) {
        return json({
          workspaceId: CONDUCTOR_WORKSPACE_ID,
          status: "ready",
          updatedAt: "2026-08-12T02:40:00.000Z",
        });
      }
      if (pathname.endsWith(`/v0/sessions/${CONDUCTOR_SESSION_ID}/status`)) {
        const statusPayload: JsonObject = {
          workspaceId: CONDUCTOR_WORKSPACE_ID,
          sessionId: CONDUCTOR_SESSION_ID,
          status,
          updatedAt: "2026-08-12T02:40:00.000Z",
        };
        if (status === "error")
          statusPayload.errorMessage = "The agent container ran out of memory";
        return json(statusPayload);
      }
      return new Response("{}", { status: 500 });
    });
    return { layer, posts, reads };
  }

  /** The fake API one case runs against: its client, and what the action posted through it. */
  type ConductorApi = ReturnType<typeof conductorApi>;

  const KEY_ROWS: VaultKeyRow[] = [
    { providerId: "conductor", ciphertext: encryptProviderKey("key-1", SECRET) },
  ];

  /**
   * The roster the action stands on: the snapshot one pass over the fake API
   * stored, read back the way the deployed route reads it — through the store
   * — so the action never sees the pass, only what it wrote down.
   */
  function snapshotRoster(api: ConductorApi) {
    return Effect.gen(function* () {
      const store = memoryObservationStore();
      const outcome = yield* observeAndSnapshot({
        userId: "user-1",
        rows: KEY_ROWS,
        secret: SECRET,
        store,
        seams: { httpClient: api.layer },
        now: NOW,
      });
      assert.equal(outcome.complete, true);
      return yield* rosterForAction({
        userId: "user-1",
        providerId: "conductor",
        secret: SECRET,
        store,
        // The key rows are read to check the snapshot was observed under them;
        // the provider itself is never asked while a matching snapshot stands.
        readVaultKeys: () => Effect.succeed(KEY_ROWS),
        seams: {
          httpClient: fakeHttpClientLayer(async () => {
            throw new Error("no pass runs for a user with a snapshot");
          }),
        },
        now: NOW + 1,
      });
    });
  }

  /** One action asked against the snapshot of the fake API, admitted and carried by the one executor. */
  function ask(
    api: ConductorApi,
    kind: HostedSessionActionKind,
    fields: Record<string, string>,
    agentSelection?: WorkspaceAgentSelection,
  ) {
    return Effect.gen(function* () {
      const roster = yield* snapshotRoster(api);
      const readsBefore = api.reads.length;
      const answer = yield* executeSessionAction({
        kind,
        providerId: "conductor",
        fields: { provider_id: "conductor", ...fields },
        apiKey: Redacted.make("key-1"),
        roster,
        ...(agentSelection === undefined ? undefined : { agentSelection }),
        seams: { httpClient: api.layer },
      });
      // No read runs on an action: the snapshot is the roster, and the provider
      // sees only the write itself.
      assert.equal(api.reads.length, readsBefore);
      return answer;
    });
  }

  it.effect("a message to a messageable Conductor session lands on its sendMessage method", () =>
    Effect.gen(function* () {
      const api = conductorApi("idle");
      const answer = yield* ask(api, ACTION_KIND.MESSAGE, {
        provider_session_id: CONDUCTOR_SESSION_ID,
        text: "please continue",
      });

      assert.equal(answer.result, "accepted");
      assert.equal(api.posts.length, 1);
      assert.deepEqual(JSON.parse(api.posts[0]?.body ?? ""), { message: "please continue" });
    }),
  );

  it.effect("a message to an errored Conductor session is rejected without a write", () =>
    Effect.gen(function* () {
      const api = conductorApi("error");
      const answer = yield* ask(api, ACTION_KIND.MESSAGE, {
        provider_session_id: CONDUCTOR_SESSION_ID,
        text: "hello",
      });

      assert.equal(answer.result, "rejected");
      assert.equal(answer.reason, ACTION_REFUSAL.NO_MESSAGES);
      assert.deepEqual(api.posts, []);
    }),
  );

  it.effect("a message outside its bound is refused without a write", () =>
    Effect.gen(function* () {
      const api = conductorApi("idle");
      const answer = yield* ask(api, ACTION_KIND.MESSAGE, {
        provider_session_id: CONDUCTOR_SESSION_ID,
        text: "  ",
      });

      assert.equal(answer.result, "rejected");
      assert.equal(answer.reason, ACTION_REFUSAL.MESSAGE_BOUND);
      assert.deepEqual(api.posts, []);
    }),
  );

  it.effect("a message to a session the snapshot does not hold is rejected", () =>
    Effect.gen(function* () {
      const api = conductorApi("idle");
      const answer = yield* ask(api, ACTION_KIND.MESSAGE, {
        provider_session_id: "session-9",
        text: "hello",
      });

      assert.equal(answer.result, "rejected");
      assert.equal(answer.reason, "Session not found.");
      assert.deepEqual(api.posts, []);
    }),
  );

  /**
   * A user no pass has reached yet: the action's roster is the pass that seeds
   * the snapshot, and when that pass fails the roster is empty and says why.
   */
  function seededRoster(httpClient: Layer.Layer<HttpClient.HttpClient>) {
    return Effect.gen(function* () {
      const store = memoryObservationStore();
      const roster = yield* rosterForAction({
        userId: "user-1",
        providerId: "conductor",
        secret: SECRET,
        store,
        readVaultKeys: () => Effect.succeed(KEY_ROWS),
        seams: { httpClient },
        now: NOW,
      });
      return { roster, store };
    });
  }

  it.effect(
    "a key the provider refuses is named as the reason, not a missing session, and seeds no snapshot",
    () =>
      Effect.gen(function* () {
        const refusedKey = fakeHttpClientLayer(() => new Response("{}", { status: 401 }));
        const { roster, store } = yield* seededRoster(refusedKey);
        const answer = yield* executeSessionAction({
          kind: ACTION_KIND.MESSAGE,
          providerId: "conductor",
          fields: {
            provider_id: "conductor",
            provider_session_id: CONDUCTOR_SESSION_ID,
            text: "hello",
          },
          apiKey: Redacted.make("key-1"),
          roster,
          seams: {
            httpClient: fakeHttpClientLayer(async () => new Response("{}", { status: 401 })),
          },
        });

        assert.equal(answer.result, "rejected");
        assert.equal(store.snapshots.size, 0);
        assert.equal(store.passes.get("user-1")?.failure, "unauthorized");
      }),
  );

  it.effect("a provider that cannot be reached is named as the reason", () =>
    Effect.gen(function* () {
      const unreachable = fakeHttpClientLayer(() => {
        throw new Error("connection refused");
      });
      const { roster } = yield* seededRoster(unreachable);
      const answer = yield* executeSessionAction({
        kind: ACTION_KIND.MESSAGE,
        providerId: "conductor",
        fields: {
          provider_id: "conductor",
          provider_session_id: CONDUCTOR_SESSION_ID,
          text: "hello",
        },
        apiKey: Redacted.make("key-1"),
        roster,
        seams: { httpClient: unreachable },
      });

      assert.equal(answer.result, "rejected");
    }),
  );

  it.effect("a user with no snapshot yet is seeded by the action's own pass, once", () =>
    Effect.gen(function* () {
      const api = conductorApi("idle");
      const store = memoryObservationStore();
      const first = yield* rosterForAction({
        userId: "user-1",
        providerId: "conductor",
        secret: SECRET,
        store,
        readVaultKeys: () => Effect.succeed(KEY_ROWS),
        seams: { httpClient: api.layer },
        now: NOW,
      });
      assert.equal(first.observations.length, 1);
      assert.equal(store.snapshots.has("user-1"), true);
      const readsAfterSeeding = api.reads.length;

      const second = yield* rosterForAction({
        userId: "user-1",
        providerId: "conductor",
        secret: SECRET,
        store,
        readVaultKeys: () => Effect.succeed(KEY_ROWS),
        seams: { httpClient: api.layer },
        now: NOW + 1,
      });
      assert.deepEqual(second.observations, first.observations);
      assert.equal(api.reads.length, readsAfterSeeding);
    }),
  );

  it.effect(
    "an action under a replaced key is admitted against a fresh pass, not the old key's snapshot",
    () =>
      Effect.gen(function* () {
        const api = conductorApi("idle");
        const store = memoryObservationStore();
        yield* rosterForAction({
          userId: "user-1",
          providerId: "conductor",
          secret: SECRET,
          store,
          readVaultKeys: () => Effect.succeed(KEY_ROWS),
          seams: { httpClient: api.layer },
          now: NOW,
        });
        const readsAfterSeeding = api.reads.length;
        const replaced: VaultKeyRow[] = [
          { providerId: "conductor", ciphertext: encryptProviderKey("key-2", SECRET) },
        ];

        const roster = yield* rosterForAction({
          userId: "user-1",
          providerId: "conductor",
          secret: SECRET,
          store,
          readVaultKeys: () => Effect.succeed(replaced),
          seams: { httpClient: api.layer },
          now: NOW + 1,
        });

        assert.ok(api.reads.length > readsAfterSeeding);
        assert.equal(roster.observations.length, 1);
        assert.equal(store.snapshots.get("user-1")?.observedAt, NOW + 1);
      }),
  );

  it("a snapshot with no slice for the provider is no session, not a failure", () => {
    const roster = actionRosterFor("conductor", { roster: { version: 1, providers: [] } });
    assert.deepEqual(roster, {
      observations: [],
      projects: [],
      unauthorized: false,
      unreachable: false,
    });
    assert.equal(actionRosterFor("conductor", { failure: "transient" }).unreachable, true);
    assert.equal(actionRosterFor("conductor", { failure: "rate-limited" }).unreachable, true);
  });

  it.effect("an advertised control runs through the provider's documented endpoint", () =>
    Effect.gen(function* () {
      const api = conductorApi("working");
      const answer = yield* ask(api, ACTION_KIND.CONTROL, {
        provider_session_id: CONDUCTOR_SESSION_ID,
        control_id: "cancel-turn",
      });

      assert.equal(answer.result, "accepted");
    }),
  );

  it.effect("a control the snapshot did not advertise is rejected without a write", () =>
    Effect.gen(function* () {
      const api = conductorApi("idle");
      const answer = yield* ask(api, ACTION_KIND.CONTROL, {
        provider_session_id: CONDUCTOR_SESSION_ID,
        control_id: "cancel-turn",
      });

      assert.equal(answer.result, "rejected");
      assert.equal(answer.reason, ACTION_REFUSAL.NO_CONTROL);
      assert.deepEqual(api.posts, []);
    }),
  );

  it.effect("a Conductor workspace creation lands in a reported project with the task inline", () =>
    Effect.gen(function* () {
      const api = conductorApi("idle");
      const answer = yield* ask(api, ACTION_KIND.CREATE_WORKSPACE, {
        project_id: CONDUCTOR_PROJECT_ID,
        name: "Fix the flaky test",
        task: "Fix the flaky test in CI",
      });

      assert.equal(answer.result, "accepted");
      assert.equal(answer.providerSessionId, "session-new");
      // Conductor's creation endpoint documents no prompt field, so the task
      // follows as a message to the session the creation response named.
      assert.deepEqual(
        api.posts.map((post) => new URL(post.url).pathname),
        ["/v0/workspaces", "/v0/sessions/session-new/messages"],
      );
      const creation = JSON.parse(api.posts[0]?.body ?? "");
      assert.equal(creation.projectId, CONDUCTOR_PROJECT_ID);
      assert.equal(creation.name, "Fix the flaky test");
      assert.equal(creation.prompt, undefined);
    }),
  );

  it.effect("a workspace creation naming an unreported project is rejected without a write", () =>
    Effect.gen(function* () {
      const api = conductorApi("idle");
      const answer = yield* ask(api, ACTION_KIND.CREATE_WORKSPACE, {
        project_id: "project-other",
        task: "Do the thing",
      });

      assert.equal(answer.result, "rejected");
      assert.equal(answer.reason, "Project not found.");
      assert.deepEqual(api.posts, []);
    }),
  );

  // --- The creation's agent selection is held to the build's own table ---

  it.effect("a listed model resolves to the pairing the build documents", () =>
    Effect.gen(function* () {
      const api = conductorApi("idle");
      const answer = yield* ask(api, ACTION_KIND.CREATE_WORKSPACE, {
        project_id: CONDUCTOR_PROJECT_ID,
        task: "build the thing",
        model: "fable-5",
        effort: "high",
      });

      assert.equal(answer.result, "accepted");
      const creation = JSON.parse(api.posts[0]?.body ?? "");
      assert.equal(creation.agent, "claude");
      assert.equal(creation.model, "fable-5");
      assert.equal(creation.effort, "high");
    }),
  );

  it.effect("a model outside the build's table is refused without a write", () =>
    Effect.gen(function* () {
      const api = conductorApi("idle");
      const answer = yield* ask(api, ACTION_KIND.CREATE_WORKSPACE, {
        project_id: CONDUCTOR_PROJECT_ID,
        task: "build the thing",
        model: "not-a-listed-model",
      });

      assert.equal(answer.result, "rejected");
      assert.equal(answer.reason, ACTION_REFUSAL.NO_MODEL);
      assert.deepEqual(api.posts, []);
    }),
  );

  it.effect("no model named is no selection, never a guess", () =>
    Effect.gen(function* () {
      const api = conductorApi("idle");
      const answer = yield* ask(api, ACTION_KIND.CREATE_WORKSPACE, {
        project_id: CONDUCTOR_PROJECT_ID,
        task: "build the thing",
      });

      assert.equal(answer.result, "accepted");
      const creation = JSON.parse(api.posts[0]?.body ?? "");
      assert.equal(creation.agent, undefined);
      assert.equal(creation.model, undefined);
    }),
  );

  // --- The developer's stored pairing rides only where the ask left the choice open ---

  const STORED_SELECTION: WorkspaceAgentSelection = {
    agent: "claude",
    model: "fable-5-1",
    effort: "high",
  };

  it.effect("a creation that named no model rides the stored pairing, effort included", () =>
    Effect.gen(function* () {
      const api = conductorApi("idle");
      const answer = yield* ask(
        api,
        ACTION_KIND.CREATE_WORKSPACE,
        { project_id: CONDUCTOR_PROJECT_ID, task: "build the thing" },
        STORED_SELECTION,
      );

      assert.equal(answer.result, "accepted");
      const creation = JSON.parse(api.posts[0]?.body ?? "");
      assert.equal(creation.agent, "claude");
      assert.equal(creation.model, "fable-5-1");
      assert.equal(creation.effort, "high");
    }),
  );

  it.effect(
    "a model the creation named outranks the stored pairing, and brings its own effort or none",
    () =>
      Effect.gen(function* () {
        const api = conductorApi("idle");
        const answer = yield* ask(
          api,
          ACTION_KIND.CREATE_WORKSPACE,
          { project_id: CONDUCTOR_PROJECT_ID, task: "build the thing", model: "gpt-5.6-sol" },
          STORED_SELECTION,
        );

        assert.equal(answer.result, "accepted");
        const creation = JSON.parse(api.posts[0]?.body ?? "");
        assert.equal(creation.agent, "codex");
        assert.equal(creation.model, "gpt-5.6-sol");
        assert.equal(creation.effort, undefined);
      }),
  );

  it.effect(
    "a spawn rides the stored pairing only when it names the very agent kind asked for",
    () =>
      Effect.gen(function* () {
        const same = conductorApi("idle");
        const rode = yield* ask(
          same,
          ACTION_KIND.ADD_AGENT,
          { provider_session_id: CONDUCTOR_SESSION_ID, agent: "claude" },
          STORED_SELECTION,
        );
        assert.equal(rode.result, "accepted");
        const spawned = JSON.parse(same.posts[0]?.body ?? "");
        assert.equal(spawned.model, "fable-5-1");
        assert.equal(spawned.effort, "high");

        const other = conductorApi("idle");
        const stayed = yield* ask(
          other,
          ACTION_KIND.ADD_AGENT,
          { provider_session_id: CONDUCTOR_SESSION_ID, agent: "codex" },
          STORED_SELECTION,
        );
        assert.equal(stayed.result, "accepted");
        const bare = JSON.parse(other.posts[0]?.body ?? "");
        assert.equal(bare.model, undefined);
        assert.equal(bare.effort, undefined);
      }),
  );
});
