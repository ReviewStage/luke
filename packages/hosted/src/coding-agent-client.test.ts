import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { fakeCloudApi, HTTP_STATUS } from "@sidecar/wire/testing";
import { Effect } from "effect";
import { HostedCodingAgentClient } from "./coding-agent-client.js";
import { CODING_AGENT_CALL_FAILURE } from "./coding-agent-view.js";
import { CODING_AGENT_STATUS } from "./coding-agent-wire.js";
import {
  PROVIDER_KEY_PROVIDER,
  PROVIDER_KEY_REJECTION,
  PROVIDER_KEY_STATUS,
} from "./provider-key-wire.js";
import { HOSTED_API_ERROR } from "./service-wire.js";

const PLAN_ID = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
const AGENT_ID = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";

const AGENT = {
  id: AGENT_ID,
  planId: PLAN_ID,
  model: "anthropic/claude-opus-5.5",
  effort: "high",
  title: null,
  createdAt: 1_800_000_000_000,
  status: CODING_AGENT_STATUS.RUNNING,
  turnId: "9d2b7b5a-4e3f-4e9c-9c77-7a5d8b3f4c32",
};

const CHOICE = { model: "openai/gpt-6.1-sol", effort: "xhigh" };

function client(): HostedCodingAgentClient {
  return new HostedCodingAgentClient({
    serviceBaseUrl: "https://tryluke.dev",
    readAccessToken: () => Effect.succeed("token-1"),
    refreshAccount: () => Effect.void,
  });
}

it.effect(
  "starts an agent with the request as sent, and reads each refusal as its own failure",
  () =>
    Effect.gen(function* () {
      const request = { idempotencyKey: "press-1", ...CHOICE };
      const api = fakeCloudApi({
        [`POST /api/plans/${PLAN_ID}/agents`]: {
          answer: () => ({ agent: AGENT }),
          status: 201,
        },
      });
      const refusals = [
        [HOSTED_API_ERROR.NO_REPOSITORY, CODING_AGENT_CALL_FAILURE.NO_REPOSITORY],
        [
          HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE,
          CODING_AGENT_CALL_FAILURE.REPOSITORY_NOT_REACHABLE,
        ],
        [HOSTED_API_ERROR.INVALID_REQUEST, CODING_AGENT_CALL_FAILURE.INVALID_CHOICE],
        [HOSTED_API_ERROR.PLAN_ARCHIVED, CODING_AGENT_CALL_FAILURE.PLAN_ARCHIVED],
        [HOSTED_API_ERROR.UNAVAILABLE, CODING_AGENT_CALL_FAILURE.UNANSWERED],
      ] as const;

      const started = yield* Effect.provide(client().start(PLAN_ID, request), api.layer);
      assert.deepEqual(started, { agent: AGENT });
      assert.deepEqual(JSON.parse(api.requests()[0]?.body ?? "{}"), request);

      for (const [error, failure] of refusals) {
        const refusing = fakeCloudApi({
          [`POST /api/plans/${PLAN_ID}/agents`]: {
            answer: () => ({ error }),
            status: HTTP_STATUS.CONFLICT,
          },
        });
        const refused = yield* Effect.provide(client().start(PLAN_ID, request), refusing.layer);
        assert.deepEqual(refused, { failure }, error);
      }
    }),
);

it.effect(
  "reads, saves, and removes the account's own provider keys, a save carrying the key once in its body and every answer its hint alone",
  () =>
    Effect.gen(function* () {
      const key = "sk-ant-api03-synthetic-0000000000000000wxyz";
      const kept = {
        provider: PROVIDER_KEY_PROVIDER.ANTHROPIC,
        hint: "sk-ant-…wxyz",
        addedAt: 1,
        status: PROVIDER_KEY_STATUS.VERIFIED,
        statusAt: 1,
      };
      const api = fakeCloudApi({
        "GET /api/account/provider-keys": { answer: () => ({ keys: [kept] }) },
        "PUT /api/account/provider-keys": {
          answer: () => ({ keys: [], rejected: PROVIDER_KEY_REJECTION.INVALID }),
        },
        "DELETE /api/account/provider-keys": { answer: () => ({ keys: [] }) },
      });

      const read = yield* Effect.provide(client().readProviderKeys(), api.layer);
      const saved = yield* Effect.provide(
        client().saveProviderKey({ provider: PROVIDER_KEY_PROVIDER.ANTHROPIC, key }),
        api.layer,
      );
      const removed = yield* Effect.provide(
        client().removeProviderKey({ provider: PROVIDER_KEY_PROVIDER.ANTHROPIC }),
        api.layer,
      );

      assert.deepEqual(read, { keys: [kept] });
      assert.deepEqual(saved, { keys: [], rejected: PROVIDER_KEY_REJECTION.INVALID });
      assert.deepEqual(removed, { keys: [] });
      const [, save, removal] = api.requests();
      assert.deepEqual(JSON.parse(save?.body ?? "{}"), {
        provider: PROVIDER_KEY_PROVIDER.ANTHROPIC,
        key,
      });
      assert.equal(
        removal?.url,
        `https://tryluke.dev/api/account/provider-keys?provider=${PROVIDER_KEY_PROVIDER.ANTHROPIC}`,
      );
    }),
);
