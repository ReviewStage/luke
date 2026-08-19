import assert from "node:assert/strict";
import test from "node:test";
import { SESSION_STATUS } from "@sidecar/core";
import { Effect, Layer } from "effect";
import { CLI_FAILURE, CliCommandError } from "../../src/cli-session-adapter";
import { CLOUD_FAILURE, CloudRequestError, HTTP_STATUS } from "../../src/cloud-session-adapter";
import { CodexCloudSessionAdapter } from "../../src/codex-cloud-adapter";
import {
  mapCloudFetchFailureToRequestError,
  runCliRun,
  runCloudFetch,
  runCloudFetchRaw,
  runWithCliRun,
  runWithCloudFetch,
} from "../../src/effect/adapter-runtime";
import { CliRunService, cliRun } from "../../src/effect/cli-run";
import { CloudFetchFailure, CloudFetchService, cloudFetch } from "../../src/effect/cloud-fetch";
import { JulesSessionAdapter } from "../../src/jules-adapter";
import { jsonResponse } from "../support/http-fake";

const RUN_OPTIONS = {
  timeoutMs: 1_000,
  maximumOutputBytes: 4_096,
} as const;

const TEST_TIME = Date.parse("2026-08-13T02:45:00.000Z");
const TEST_API_KEY = "jules-test-key";
const TEST_BASE_URL = "https://jules.test";

test("runWithCloudFetch builds a Layer that cloudFetch can use", async () => {
  const layer = runWithCloudFetch(async () => jsonResponse({ ok: true }));
  const response = await Effect.runPromise(
    cloudFetch(`${TEST_BASE_URL}/v1`, {}).pipe(Effect.provide(layer)),
  );
  assert.equal(response.status, 200);
});

test("runCloudFetch maps CloudFetchFailure to CloudRequestError", async () => {
  try {
    await runCloudFetch(
      async () => new Response("", { status: HTTP_STATUS.UNAUTHORIZED }),
      `${TEST_BASE_URL}/v1`,
      {},
      "Jules",
    );
    assert.fail("Expected CloudRequestError");
  } catch (error) {
    assert(error instanceof CloudRequestError);
    assert.equal(error.failure, CLOUD_FAILURE.UNAUTHORIZED);
    assert.match(error.message, /rejected the configured API key/);
  }
});

test("runCloudFetchRaw keeps non-ok responses for write handling", async () => {
  const response = await runCloudFetchRaw(
    async () => new Response("", { status: HTTP_STATUS.NOT_FOUND }),
    `${TEST_BASE_URL}/v1`,
    {},
  );
  assert.equal(response.status, HTTP_STATUS.NOT_FOUND);
});

test("mapCloudFetchFailureToRequestError preserves provider wording", () => {
  const mapped = mapCloudFetchFailureToRequestError(
    new CloudFetchFailure({
      failure: CLOUD_FAILURE.TRANSIENT,
      message: "Request to https://jules.test responded with status 503",
    }),
    "Jules",
  );
  assert.equal(mapped.message, "Jules responded with status 503");
});

test("runWithCliRun builds a Layer that cliRun can use", async () => {
  const layer = runWithCliRun(async () => ({ exitCode: 0, stdout: '{"tasks":[]}' }));
  const result = await Effect.runPromise(
    cliRun("codex", ["cloud", "list", "--json"], RUN_OPTIONS).pipe(Effect.provide(layer)),
  );
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, '{"tasks":[]}');
});

test("runCliRun maps CliRunFailure to CliCommandError", async () => {
  try {
    await runCliRun(
      async () => {
        throw new CliCommandError(CLI_FAILURE.UNAVAILABLE, "codex could not be run");
      },
      "codex",
      ["login", "status"],
      RUN_OPTIONS,
    );
    assert.fail("Expected CliCommandError");
  } catch (error) {
    assert(error instanceof CliCommandError);
    assert.equal(error.failure, CLI_FAILURE.UNAVAILABLE);
  }
});

test("JulesSessionAdapter observe() matches behavior through Effect-backed fetch", async () => {
  let requestCount = 0;
  const adapter = new JulesSessionAdapter({
    readApiKey: async () => TEST_API_KEY,
    baseUrl: TEST_BASE_URL,
    now: () => TEST_TIME,
    minimumRefreshIntervalMs: 0,
    fetch: async (url) => {
      requestCount += 1;
      assert.match(url, /\/v1alpha\/sessions/);
      return jsonResponse({
        sessions: [
          {
            id: "session-1",
            state: "IN_PROGRESS",
            sourceContext: { source: "sources/github/org/repo" },
            createTime: new Date(TEST_TIME).toISOString(),
            updateTime: new Date(TEST_TIME).toISOString(),
            url: "https://jules.google.com/task/session-1",
          },
        ],
      });
    },
  });

  const observations = await adapter.observe();
  assert.equal(requestCount, 1);
  assert.equal(observations.length, 1);
  assert.equal(observations[0]?.status, SESSION_STATUS.WORKING);
});

test("CodexCloudSessionAdapter observe() matches behavior through Effect-backed cli run", async () => {
  let invocationCount = 0;
  const adapter = new CodexCloudSessionAdapter({
    now: () => TEST_TIME,
    minimumRefreshIntervalMs: 0,
    run: async (_binary, argv) => {
      invocationCount += 1;
      if (argv[0] === "login") {
        return { exitCode: 0, stdout: "" };
      }
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          tasks: [
            {
              id: "task-1",
              status: "pending",
              updated_at: new Date(TEST_TIME).toISOString(),
              environment_label: "reviewstage/luke",
              summary: { files_changed: 1, lines_added: 2, lines_removed: 1 },
            },
          ],
        }),
      };
    },
  });

  const observations = await adapter.observe();
  assert.equal(invocationCount, 2);
  assert.equal(observations.length, 1);
  assert.equal(observations[0]?.status, SESSION_STATUS.WORKING);
});

test("adapter-runtime Layers accept test fakes directly", async () => {
  const cloudLayer = Layer.succeed(CloudFetchService, async () => jsonResponse({ sessions: [] }));
  const cliLayer = Layer.succeed(CliRunService, async () => ({
    exitCode: 0,
    stdout: '{"tasks":[]}',
  }));
  await Effect.runPromise(cloudFetch(`${TEST_BASE_URL}/v1`, {}).pipe(Effect.provide(cloudLayer)));
  await Effect.runPromise(
    Effect.gen(function* () {
      const run = yield* CliRunService;
      const result = yield* Effect.tryPromise(() => run("codex", ["login", "status"], RUN_OPTIONS));
      assert.equal(result.exitCode, 0);
    }).pipe(Effect.provide(cliLayer)),
  );
});
