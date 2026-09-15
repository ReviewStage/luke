import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { CLOUD_AGENT_PROVIDER_ID } from "@sidecar/session";
import { ACTION_RESULT_STATUS } from "@sidecar/wire";
import {
  fakeCloudApi,
  fakeHttpClientLayer,
  HTTP_STATUS,
  recordedRoutes,
  recordingHttpClient,
} from "@sidecar/wire/testing";
import { Effect } from "effect";
import { HOSTED_ACTION_FAILURE, HostedActionClient } from "./action-client.js";

const TARGET = {
  providerId: CLOUD_AGENT_PROVIDER_ID.CONDUCTOR,
  providerSessionId: "chat-1",
} as const;

function client(
  httpClient: ReturnType<typeof fakeCloudApi>["layer"],
  options: Partial<ConstructorParameters<typeof HostedActionClient>[0]> = {},
) {
  return new HostedActionClient({
    serviceBaseUrl: "https://tryluke.dev/",
    readAccessToken: () => Effect.succeed("token-1"),
    refreshAccount: () => Effect.void,
    httpClient,
    ...options,
  });
}

it.effect("a message is a bearer POST naming the session and carrying the words", () =>
  Effect.gen(function* () {
    const api = fakeCloudApi({
      "POST /api/actions/message": { answer: () => ({ result: ACTION_RESULT_STATUS.ACCEPTED }) },
    });

    const outcome = yield* client(api.layer).sendMessage(TARGET, "ship it");

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

      const outcome = yield* client(api.layer).executeControl(TARGET, "cancel-run");

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
    const unsent = recordingHttpClient(() => {
      throw new Error("must not travel without an account");
    });
    assert.deepEqual(
      yield* client(unsent.layer, { readAccessToken: () => Effect.succeed(undefined) }).sendMessage(
        TARGET,
        "hello",
      ),
      { failure: HOSTED_ACTION_FAILURE.NOT_SENT },
    );
    assert.equal(unsent.requests.length, 0);

    const lost = client(
      fakeHttpClientLayer(() => {
        throw new TypeError("fetch failed");
      }),
    );
    assert.deepEqual(yield* lost.sendMessage(TARGET, "hello"), {
      failure: HOSTED_ACTION_FAILURE.LOST,
    });

    const refused = client(
      fakeCloudApi({
        "POST /api/actions/control": { answer: () => ({}), status: HTTP_STATUS.SERVER_ERROR },
      }).layer,
    );
    assert.deepEqual(yield* refused.executeControl(TARGET, "cancel-run"), {
      failure: HOSTED_ACTION_FAILURE.REFUSED,
    });

    const unreadable = client(
      fakeCloudApi({
        "POST /api/actions/control": { answer: () => ({ result: "maybe" }) },
      }).layer,
    );
    assert.deepEqual(yield* unreadable.executeControl(TARGET, "cancel-run"), {
      failure: HOSTED_ACTION_FAILURE.UNREADABLE,
    });
  }),
);
