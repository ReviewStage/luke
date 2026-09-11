import assert from "node:assert/strict";
import { CLOUD_AGENT_PROVIDER_ID } from "@sidecar/session";
import { ACTION_RESULT_STATUS } from "@sidecar/wire";
import { test } from "vitest";
import { HOSTED_ACTION_FAILURE, HostedActionClient } from "./action-client.js";

const TARGET = {
  providerId: CLOUD_AGENT_PROVIDER_ID.CONDUCTOR,
  providerSessionId: "chat-1",
} as const;

interface RecordedRequest {
  url: string;
  init: RequestInit;
}

function service(answer: () => Response) {
  const requests: RecordedRequest[] = [];
  const fetchLike = async (url: string, init: RequestInit): Promise<Response> => {
    requests.push({ url, init });
    return answer();
  };
  return { requests, fetchLike };
}

function client(options: Partial<ConstructorParameters<typeof HostedActionClient>[0]> = {}) {
  return new HostedActionClient({
    serviceBaseUrl: "https://tryluke.dev/",
    readAccessToken: async () => "token-1",
    refreshAccount: async () => undefined,
    ...options,
  });
}

test("a message is a bearer POST naming the session and carrying the words", async () => {
  const { requests, fetchLike } = service(
    () => new Response(JSON.stringify({ result: ACTION_RESULT_STATUS.ACCEPTED }), { status: 200 }),
  );

  const outcome = await client({ fetch: fetchLike }).sendMessage(TARGET, "ship it");

  assert.deepEqual(outcome, { answer: { result: ACTION_RESULT_STATUS.ACCEPTED } });
  const [request] = requests;
  assert.equal(request?.url, "https://tryluke.dev/api/actions/message");
  assert.equal(request?.init.method, "POST");
  const headers = new Headers(request?.init.headers);
  assert.equal(headers.get("authorization"), "Bearer token-1");
  assert.equal(headers.get("content-type"), "application/json");
  assert.deepEqual(JSON.parse(String(request?.init.body)), {
    providerId: TARGET.providerId,
    providerSessionId: TARGET.providerSessionId,
    text: "ship it",
  });
});

test("a control press names the control the row offered, and the refusal comes back as written", async () => {
  const { requests, fetchLike } = service(
    () =>
      new Response(
        JSON.stringify({ result: ACTION_RESULT_STATUS.REJECTED, reason: "That run has ended." }),
        { status: 200 },
      ),
  );

  const outcome = await client({ fetch: fetchLike }).executeControl(TARGET, "cancel-run");

  assert.deepEqual(outcome, {
    answer: { result: ACTION_RESULT_STATUS.REJECTED, reason: "That run has ended." },
  });
  const [request] = requests;
  assert.equal(request?.url, "https://tryluke.dev/api/actions/control");
  assert.deepEqual(JSON.parse(String(request?.init.body)), {
    providerId: TARGET.providerId,
    providerSessionId: TARGET.providerSessionId,
    controlId: "cancel-run",
  });
});

test("each way a call ends short of an answer says whether the action may have landed", async () => {
  const { requests: unsent, fetchLike: mustNotTravel } = service(() => {
    throw new Error("must not travel without an account");
  });
  assert.deepEqual(
    await client({ readAccessToken: async () => undefined, fetch: mustNotTravel }).sendMessage(
      TARGET,
      "hello",
    ),
    { failure: HOSTED_ACTION_FAILURE.NOT_SENT },
  );
  assert.equal(unsent.length, 0);

  const lost = client({
    fetch: async () => {
      throw new TypeError("fetch failed");
    },
  });
  assert.deepEqual(await lost.sendMessage(TARGET, "hello"), {
    failure: HOSTED_ACTION_FAILURE.LOST,
  });

  const refused = client({ fetch: service(() => new Response("", { status: 503 })).fetchLike });
  assert.deepEqual(await refused.executeControl(TARGET, "cancel-run"), {
    failure: HOSTED_ACTION_FAILURE.REFUSED,
  });

  const unreadable = client({
    fetch: service(() => new Response(JSON.stringify({ result: "maybe" }), { status: 200 }))
      .fetchLike,
  });
  assert.deepEqual(await unreadable.executeControl(TARGET, "cancel-run"), {
    failure: HOSTED_ACTION_FAILURE.UNREADABLE,
  });
});
