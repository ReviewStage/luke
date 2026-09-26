import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { fakeCloudApi, HTTP_STATUS, recordedRoutes } from "@sidecar/wire/testing";
import { Effect } from "effect";
import { GITHUB_FAILURE } from "./github-wire.js";
import { HostedPlanClient } from "./plan-client.js";
import { PLAN_CALL_FAILURE } from "./planning-view.js";

const PLAN_ID = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
const COMMIT = "4f2c9e1a0b3d5c7e9f1a2b3c4d5e6f708192a3b4";

const SUMMARY = {
  id: PLAN_ID,
  name: "Teammate invitations",
  repository: { owner: "acme", name: "relay", branch: "main", commit: COMMIT },
  createdAt: 1_800_000_000_000,
  updatedAt: 1_800_000_100_000,
  openedAt: 1_800_000_200_000,
};

const PLAN = {
  ...SUMMARY,
  document: {
    body: "# Teammate invitations",
    assumptions: [{ text: "Members and admins can both invite.", confirmed: true }],
  },
};

function client(): HostedPlanClient {
  return new HostedPlanClient({
    serviceBaseUrl: "https://tryluke.dev",
    readAccessToken: () => Effect.succeed("token-1"),
    refreshAccount: () => Effect.void,
  });
}

it.effect("lists the account's plans under its bearer", () =>
  Effect.gen(function* () {
    const api = fakeCloudApi({ "GET /api/plans": { answer: () => ({ plans: [SUMMARY] }) } });

    const listed = yield* Effect.provide(client().list(), api.layer);

    assert.deepEqual(listed, { ok: true, answer: [SUMMARY] });
    assert.deepEqual(api.credentials(), ["token-1"]);
  }),
);

it.effect("opens one plan with its saved document", () =>
  Effect.gen(function* () {
    const api = fakeCloudApi({ [`GET /api/plans/${PLAN_ID}`]: { answer: () => ({ plan: PLAN }) } });

    const opened = yield* Effect.provide(client().open(PLAN_ID), api.layer);

    assert.deepEqual(opened, { ok: true, answer: PLAN });
  }),
);

it.effect("a plan the service does not find reads as not found, not as unanswered", () =>
  Effect.gen(function* () {
    const api = fakeCloudApi({
      [`GET /api/plans/${PLAN_ID}`]: {
        answer: () => ({ error: "not-found" }),
        status: HTTP_STATUS.NOT_FOUND,
      },
    });

    const opened = yield* Effect.provide(client().open(PLAN_ID), api.layer);

    assert.deepEqual(opened, { ok: false, failure: PLAN_CALL_FAILURE.NOT_FOUND });
  }),
);

it.effect("starting a plan names the repository and nothing the service resolves itself", () =>
  Effect.gen(function* () {
    const api = fakeCloudApi({
      "POST /api/plans": { answer: () => ({ plan: PLAN }) },
    });

    const started = yield* Effect.provide(
      client().create({
        name: "  Teammate invitations ",
        repository: { owner: "acme", name: "relay" },
      }),
      api.layer,
    );

    assert.deepEqual(started, { ok: true, answer: PLAN });
    assert.deepEqual(JSON.parse(api.requests()[0]?.body ?? "{}"), {
      name: "Teammate invitations",
      repository: { owner: "acme", name: "relay" },
    });
  }),
);

it.effect("a plan with no name never travels", () =>
  Effect.gen(function* () {
    const api = fakeCloudApi({});

    const started = yield* Effect.provide(
      client().create({ name: "   ", repository: { owner: "acme", name: "relay" } }),
      api.layer,
    );

    assert.deepEqual(started, { ok: false, failure: PLAN_CALL_FAILURE.UNANSWERED });
    assert.deepEqual(api.requests(), []);
  }),
);

it.effect("GitHub's refusal reaches the caller as the reason the service named", () =>
  Effect.gen(function* () {
    const refusal = (reason: string) => ({
      answer: () => ({ error: "github-unavailable", reason }),
      status: HTTP_STATUS.CONFLICT,
    });
    const api = fakeCloudApi({
      "POST /api/plans": refusal(GITHUB_FAILURE.EMPTY_REPOSITORY),
      "GET /api/github/repositories": refusal(GITHUB_FAILURE.NOT_CONNECTED),
    });

    const started = yield* Effect.provide(
      client().create({ name: "Audit log", repository: { owner: "acme", name: "empty" } }),
      api.layer,
    );
    const listed = yield* Effect.provide(client().repositories(), api.layer);

    assert.deepEqual(started, { ok: false, failure: GITHUB_FAILURE.EMPTY_REPOSITORY });
    assert.deepEqual(listed, { ok: false, failure: GITHUB_FAILURE.NOT_CONNECTED });
    assert.deepEqual(recordedRoutes(api.requests()), [
      "POST /api/plans",
      "GET /api/github/repositories",
    ]);
  }),
);

it.effect("reads the repository list the connection can read", () =>
  Effect.gen(function* () {
    const answer = {
      repositories: [{ owner: "acme", name: "relay", private: true }],
      truncated: false,
    };
    const api = fakeCloudApi({ "GET /api/github/repositories": { answer: () => answer } });

    const listed = yield* Effect.provide(client().repositories(), api.layer);

    assert.deepEqual(listed, { ok: true, answer });
  }),
);

it.effect("a service that fails answers unanswered, never an empty list", () =>
  Effect.gen(function* () {
    const api = fakeCloudApi({
      "GET /api/plans": { answer: () => ({ plans: [] }) },
      "GET /api/github/repositories": { answer: () => ({ repositories: [], truncated: false }) },
    });
    api.fail();

    const plans = yield* Effect.provide(client().list(), api.layer);
    const repositories = yield* Effect.provide(client().repositories(), api.layer);

    assert.deepEqual(plans, { ok: false, failure: PLAN_CALL_FAILURE.UNANSWERED });
    assert.deepEqual(repositories, { ok: false, failure: PLAN_CALL_FAILURE.UNANSWERED });
  }),
);
