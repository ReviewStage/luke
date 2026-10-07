import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { fakeCloudApi, HTTP_STATUS, recordedRoutes } from "@sidecar/wire/testing";
import { Effect } from "effect";
import { HostedNotebookClient } from "./notebook-client.js";
import { HOSTED_SERVICE_PATH } from "./service-paths.js";
import { HOSTED_API_ERROR } from "./service-wire.js";

function client() {
  return new HostedNotebookClient({
    serviceBaseUrl: "https://luke.test",
    readAccessToken: () => Effect.succeed("token-1"),
    refreshAccount: () => Effect.void,
    readAccountKey: () => Effect.succeed("person"),
  });
}

it.effect(
  "the notebook read asks its own path under the account's bearer, and answers nothing short of the contract",
  () =>
    Effect.gen(function* () {
      const notebook = {
        files: [
          {
            path: "MEMORY.md",
            content: "# Memory\n\n- shipped the notch",
            chars: 28,
            updatedAt: 1,
          },
          { path: "memory/2026-09-14.md", content: "today", chars: 5, updatedAt: 2 },
        ],
        omittedNotes: 3,
      };
      const api = fakeCloudApi({
        [`GET ${HOSTED_SERVICE_PATH.BRAIN_NOTEBOOK}`]: { answer: () => notebook },
      });
      const read = yield* Effect.provide(client().notebook(), api.layer);
      assert.deepEqual(read, notebook);
      assert.deepEqual(recordedRoutes(api.requests()), [
        `GET ${HOSTED_SERVICE_PATH.BRAIN_NOTEBOOK}`,
      ]);
      assert.deepEqual(api.credentials(), ["token-1"]);

      const refused = fakeCloudApi({
        [`GET ${HOSTED_SERVICE_PATH.BRAIN_NOTEBOOK}`]: {
          status: HTTP_STATUS.TOO_MANY_REQUESTS,
          answer: () => ({ error: HOSTED_API_ERROR.QUOTA_EXHAUSTED }),
        },
      });
      assert.equal(yield* Effect.provide(client().notebook(), refused.layer), undefined);

      const malformed = fakeCloudApi({
        [`GET ${HOSTED_SERVICE_PATH.BRAIN_NOTEBOOK}`]: {
          answer: () => ({ files: [{ path: "", content: "x" }], omittedNotes: -1 }),
        },
      });
      assert.equal(yield* Effect.provide(client().notebook(), malformed.layer), undefined);
    }),
);
