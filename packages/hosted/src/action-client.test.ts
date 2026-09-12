import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { CLOUD_AGENT_PROVIDER_ID } from "@sidecar/session";
import { ACTION_RESULT_STATUS, type CloudFetch } from "@sidecar/wire";
import { fakeCloudApi, HTTP_STATUS, recordedRoutes, recordingFetch } from "@sidecar/wire/testing";
import { Effect } from "effect";
import { HOSTED_ACTION_FAILURE, HostedActionClient } from "./action-client.js";

const TARGET = {
  providerId: CLOUD_AGENT_PROVIDER_ID.CONDUCTOR,
  providerSessionId: "chat-1",
} as const;

function client(
  fetch: CloudFetch,
  options: Partial<ConstructorParameters<typeof HostedActionClient>[0]> = {},
) {
  return new HostedActionClient({
    serviceBaseUrl: "https://tryluke.dev/",
    readAccessToken: async () => "token-1",
    refreshAccount: () => Effect.void,
    fetch,
    ...options,
  });
}

it.effect("a message is a bearer POST naming the session and carrying the words", () =>
  Effect.gen(function* () {
    const api = fakeCloudApi({
      "POST /api/actions/message": { answer: () => ({ result: ACTION_RESULT_STATUS.ACCEPTED }) },
    });

    const outcome = yield* Effect.promise(() => client(api.fetch).sendMessage(TARGET, "ship it"));

    assert.deepEqual(outcome, { answer: { result: ACTION_RESULT_STATUS.ACCEPTED } });
    assert.deepEqual(recordedRoutes(api.requests()), ["POST /api/actions/message"]);
    const [request] = api.requests();
    assert.equal(request?.contentType, "application/json");
    assert.deepEqual(api.credentials(), ["token-1"]);
    assert.deepEqual(JSON.parse(request?.body ?? "{}"), {
      providerId: TARGET.providerId,
      providerSessionId: TARGET.providerSessionId,
      text: "ship it",
    });
  }),
);

it.effect(
  "a control press names the control the row offered, and the refusal comes back as written",
  () =>
    Effect.gen(function* () {
      const api = fakeCloudApi({
        "POST /api/actions/control": {
          answer: () => ({
            result: ACTION_RESULT_STATUS.REJECTED,
            reason: "That run has ended.",
          }),
        },
      });

      const outcome = yield* Effect.promise(() =>
        client(api.fetch).executeControl(TARGET, "cancel-run"),
      );

      assert.deepEqual(outcome, {
        answer: { result: ACTION_RESULT_STATUS.REJECTED, reason: "That run has ended." },
      });
      assert.deepEqual(recordedRoutes(api.requests()), ["POST /api/actions/control"]);
      assert.deepEqual(JSON.parse(api.requests()[0]?.body ?? "{}"), {
        providerId: TARGET.providerId,
        providerSessionId: TARGET.providerSessionId,
        controlId: "cancel-run",
      });
    }),
);

it.effect("each way a call ends short of an answer says whether the action may have landed", () =>
  Effect.gen(function* () {
    const unsent = recordingFetch(() => {
      throw new Error("must not travel without an account");
    });
    assert.deepEqual(
      yield* Effect.promise(() =>
        client(unsent.fetch, { readAccessToken: async () => undefined }).sendMessage(
          TARGET,
          "hello",
        ),
      ),
      { failure: HOSTED_ACTION_FAILURE.NOT_SENT },
    );
    assert.equal(unsent.requests.length, 0);

    const lost = client(() => {
      throw new TypeError("fetch failed");
    });
    assert.deepEqual(yield* Effect.promise(() => lost.sendMessage(TARGET, "hello")), {
      failure: HOSTED_ACTION_FAILURE.LOST,
    });

    const refused = client(
      fakeCloudApi({
        "POST /api/actions/control": { answer: () => ({}), status: HTTP_STATUS.SERVER_ERROR },
      }).fetch,
    );
    assert.deepEqual(yield* Effect.promise(() => refused.executeControl(TARGET, "cancel-run")), {
      failure: HOSTED_ACTION_FAILURE.REFUSED,
    });

    const unreadable = client(
      fakeCloudApi({
        "POST /api/actions/control": { answer: () => ({ result: "maybe" }) },
      }).fetch,
    );
    assert.deepEqual(yield* Effect.promise(() => unreadable.executeControl(TARGET, "cancel-run")), {
      failure: HOSTED_ACTION_FAILURE.UNREADABLE,
    });
  }),
);

it.effect(
  "a creation names the project and carries the selection whole, and reads the session the provider made",
  () =>
    Effect.gen(function* () {
      const api = fakeCloudApi({
        "POST /api/actions/workspace": {
          answer: () => ({
            result: ACTION_RESULT_STATUS.ACCEPTED,
            providerSessionId: "session-new",
          }),
        },
      });

      const outcome = yield* Effect.promise(() =>
        client(api.fetch).createWorkspace(TARGET.providerId, {
          providerProjectId: "project-1",
          agent: "claude",
          model: "fable-5",
          task: "add tests",
        }),
      );

      assert.deepEqual(outcome, {
        answer: { result: ACTION_RESULT_STATUS.ACCEPTED, providerSessionId: "session-new" },
      });
      assert.deepEqual(recordedRoutes(api.requests()), ["POST /api/actions/workspace"]);
      // An unset field is left off the wire rather than sent as a key holding nothing.
      assert.deepEqual(JSON.parse(api.requests()[0]?.body ?? "{}"), {
        providerId: TARGET.providerId,
        providerProjectId: "project-1",
        agent: "claude",
        model: "fable-5",
        task: "add tests",
      });
    }),
);

it.effect("an agent addition and the two renames each name the session and carry the ask", () =>
  Effect.gen(function* () {
    const api = fakeCloudApi({
      "POST /api/actions/agent": { answer: () => ({ result: ACTION_RESULT_STATUS.ACCEPTED }) },
      "POST /api/actions/rename-session": {
        answer: () => ({ result: ACTION_RESULT_STATUS.ACCEPTED }),
      },
      "POST /api/actions/rename-workspace": {
        answer: () => ({ result: ACTION_RESULT_STATUS.REJECTED, reason: "Name too long." }),
      },
    });
    const carrier = client(api.fetch);

    const added = yield* Effect.promise(() =>
      carrier.addAgent(TARGET, { agent: "codex", model: "gpt-5", effort: "high" }),
    );
    const renamed = yield* Effect.promise(() => carrier.renameSession(TARGET, "Flaky test"));
    const refused = yield* Effect.promise(() => carrier.renameWorkspace(TARGET, "x".repeat(300)));

    assert.deepEqual(added, { answer: { result: ACTION_RESULT_STATUS.ACCEPTED } });
    assert.deepEqual(renamed, { answer: { result: ACTION_RESULT_STATUS.ACCEPTED } });
    assert.deepEqual(refused, {
      answer: { result: ACTION_RESULT_STATUS.REJECTED, reason: "Name too long." },
    });
    assert.deepEqual(recordedRoutes(api.requests()), [
      "POST /api/actions/agent",
      "POST /api/actions/rename-session",
      "POST /api/actions/rename-workspace",
    ]);
    assert.deepEqual(JSON.parse(api.requests()[0]?.body ?? "{}"), {
      providerId: TARGET.providerId,
      providerSessionId: TARGET.providerSessionId,
      agent: "codex",
      model: "gpt-5",
      effort: "high",
    });
    assert.deepEqual(JSON.parse(api.requests()[1]?.body ?? "{}"), {
      providerId: TARGET.providerId,
      providerSessionId: TARGET.providerSessionId,
      name: "Flaky test",
    });
  }),
);
