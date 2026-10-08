import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { fakeCloudApi, HTTP_STATUS } from "@sidecar/wire/testing";
import { Effect } from "effect";
import { HostedPlanClient } from "./plan-client.js";
import { PLAN_CALL_FAILURE } from "./planning-view.js";

const PLAN_ID = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";

const SUMMARY = {
  id: PLAN_ID,
  name: "Teammate invitations",
  createdAt: 1_800_000_000_000,
  updatedAt: 1_800_000_100_000,
  openedAt: 1_800_000_200_000,
};

const PLAN = {
  ...SUMMARY,
  document: {
    body: "# Teammate invitations",
    assumptions: [{ text: "Members and admins can both invite." }],
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

it.effect("deleting a plan answers whether the service deleted it", () =>
  Effect.gen(function* () {
    const api = fakeCloudApi({
      [`DELETE /api/plans/${PLAN_ID}`]: { answer: () => ({ deleted: true }) },
    });
    const gone = fakeCloudApi({
      [`DELETE /api/plans/${PLAN_ID}`]: {
        answer: () => ({ error: "not-found" }),
        status: HTTP_STATUS.NOT_FOUND,
      },
    });

    assert.equal(yield* Effect.provide(client().delete(PLAN_ID), api.layer), true);
    assert.equal(yield* Effect.provide(client().delete(PLAN_ID), gone.layer), false);
  }),
);

it.effect("starting a plan names its folder", () =>
  Effect.gen(function* () {
    const api = fakeCloudApi({
      "POST /api/plans": { answer: () => ({ plan: PLAN }) },
    });

    const started = yield* Effect.provide(
      client().create({
        name: "  Teammate invitations ",
      }),
      api.layer,
    );

    assert.deepEqual(started, { ok: true, answer: PLAN });
    assert.deepEqual(JSON.parse(api.requests()[0]?.body ?? "{}"), {
      name: "Teammate invitations",
    });
  }),
);

it.effect("a plan with no name never travels", () =>
  Effect.gen(function* () {
    const api = fakeCloudApi({});

    const started = yield* Effect.provide(client().create({ name: "   " }), api.layer);

    assert.deepEqual(started, { ok: false, failure: PLAN_CALL_FAILURE.UNANSWERED });
    assert.deepEqual(api.requests(), []);
  }),
);

it.effect("a service that fails answers unanswered, never an empty list or a plan", () =>
  Effect.gen(function* () {
    const api = fakeCloudApi({
      "GET /api/plans": { answer: () => ({ plans: [] }) },
      "POST /api/plans": { answer: () => ({ plan: PLAN }) },
    });
    api.fail();

    const plans = yield* Effect.provide(client().list(), api.layer);
    const started = yield* Effect.provide(client().create({ name: "Audit log" }), api.layer);

    assert.deepEqual(plans, { ok: false, failure: PLAN_CALL_FAILURE.UNANSWERED });
    assert.deepEqual(started, { ok: false, failure: PLAN_CALL_FAILURE.UNANSWERED });
  }),
);

it.effect("reads what was said on a plan's calls, and nothing from a service that refused it", () =>
  Effect.gen(function* () {
    const transcript = {
      calls: [
        {
          id: "5d2c8f61-3a7e-4b19-8c0d-2e9f4a6b7c81",
          startedAt: 1_800_000_300_000,
          lines: [
            { speaker: "user", text: "Invites should expire." },
            { speaker: "assistant", text: "After how many days?" },
          ],
        },
      ],
      earlierOmitted: false,
    };
    const api = fakeCloudApi({
      [`GET /api/plans/${PLAN_ID}/transcript`]: { answer: () => ({ transcript }) },
    });
    const gone = fakeCloudApi({
      [`GET /api/plans/${PLAN_ID}/transcript`]: {
        answer: () => ({ error: "not-found" }),
        status: HTTP_STATUS.NOT_FOUND,
      },
    });

    assert.deepEqual(
      yield* Effect.provide(client().readTranscript(PLAN_ID), api.layer),
      transcript,
    );
    assert.equal(yield* Effect.provide(client().readTranscript(PLAN_ID), gone.layer), undefined);
  }),
);
