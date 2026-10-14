import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { fakeCloudApi, HTTP_STATUS, recordedRoutes } from "@sidecar/wire/testing";
import { Effect } from "effect";
import { CODING_AGENT_BOUNDS } from "./coding-agent-wire.js";
import { HostedPlanClient } from "./plan-client.js";
import { PLAN_BOUNDS } from "./plan-wire.js";
import { PLAN_CALL_FAILURE } from "./planning-view.js";
import { HOSTED_API_ERROR } from "./service-wire.js";

const PLAN_ID = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";

const SUMMARY = {
  id: PLAN_ID,
  workspaceId: "workspace-personal",
  name: "Teammate invitations",
  createdAt: 1_800_000_000_000,
  updatedAt: 1_800_000_100_000,
  repository: null,
  openedAt: 1_800_000_200_000,
};

const PLAN = {
  ...SUMMARY,
  document: {
    body: "# Teammate invitations",
    assumptions: [{ text: "Members and admins can both invite." }],
  },
  rollout: [],
};

function client(): HostedPlanClient {
  return new HostedPlanClient({
    serviceBaseUrl: "https://tryluke.dev",
    readAccessToken: () => Effect.succeed("token-1"),
    refreshAccount: () => Effect.void,
  });
}

it.effect("opens one plan with its saved document", () =>
  Effect.gen(function* () {
    const api = fakeCloudApi({ [`GET /api/plans/${PLAN_ID}`]: { answer: () => ({ plan: PLAN }) } });

    const opened = yield* Effect.provide(client().open(PLAN_ID), api.layer);

    assert.deepEqual(opened, { ok: true, answer: PLAN });
  }),
);

it.effect(
  "an edit sends the text it was written from and the text written, exactly, and answers the plan as saved or the text as it stands; one past the bound is never sent",
  () =>
    Effect.gen(function* () {
      const saved = { ...PLAN, updatedAt: 1_800_000_400_000 };
      const conflict = { conflict: { current: "- Luke's words." } };
      let sent = 0;
      const api = fakeCloudApi({
        [`POST /api/plans/${PLAN_ID}/edit`]: {
          answer: () => {
            sent += 1;
            return sent === 1 ? { plan: saved } : conflict;
          },
        },
      });
      const edit = { document: { base: "## Goal\n", value: "## Goal\n\n - Mine. \n" } };

      const first = yield* Effect.provide(client().edit(PLAN_ID, edit), api.layer);
      const second = yield* Effect.provide(client().edit(PLAN_ID, edit), api.layer);
      const blank = yield* Effect.provide(
        client().edit(PLAN_ID, {
          document: { base: "", value: "x".repeat(PLAN_BOUNDS.MAX_BODY_CHARS + 1) },
        }),
        api.layer,
      );

      assert.deepEqual(first, { ok: true, answer: { plan: saved } });
      assert.deepEqual(second, { ok: true, answer: conflict });
      assert.deepEqual(blank, { ok: false, failure: PLAN_CALL_FAILURE.UNANSWERED });
      assert.deepEqual(
        api.requests().map((request) => JSON.parse(request.body ?? "{}")),
        [edit, edit],
      );
    }),
);

it.effect("the repositories of one workspace are asked by its id, and every one by none", () =>
  Effect.gen(function* () {
    const listed = {
      installed: true,
      repositories: [],
      installationUrl: "https://github.com/apps/luke/installations/new",
    };
    const api = fakeCloudApi({ "GET /api/github/repositories": { answer: () => listed } });

    yield* Effect.provide(client().repositories("workspace-acme"), api.layer);
    yield* Effect.provide(client().repositories(), api.layer);

    assert.deepEqual(recordedRoutes(api.requests()), [
      "GET /api/github/repositories?workspaceId=workspace-acme",
      "GET /api/github/repositories",
    ]);
  }),
);

/** The ask the service takes a typed line as, and the key the window made for the line. */
const ASK = { id: "5e2d8c1a-3f4b-4a6e-9d7c-1b8a2f6e4c30", queuedAt: 1_800_000_500_000 };
const CLIENT_KEY = "3f6c1a2e-9b4d-4e7f-8a1c-5d2e7f9b3a64";

it.effect(
  "a typed line sends its trimmed words and the window's key to the plan's messages, and answers the ask Luke took it as",
  () =>
    Effect.gen(function* () {
      const api = fakeCloudApi({
        [`POST /api/plans/${PLAN_ID}/messages`]: {
          answer: () => ({ ask: ASK }),
          status: HTTP_STATUS.ACCEPTED,
        },
      });

      const sent = yield* Effect.provide(
        client().send(PLAN_ID, "  Roll out the plan. ", CLIENT_KEY),
        api.layer,
      );

      assert.deepEqual(sent, { ok: true, answer: { ask: ASK } });
      assert.deepEqual(
        api.requests().map((request) => JSON.parse(request.body ?? "{}")),
        [{ text: "Roll out the plan.", clientKey: CLIENT_KEY }],
      );
      assert.deepEqual(api.credentials(), ["token-1"]);
    }),
);

it.effect(
  "a typed line to a plan gone or archived reads as that refusal, and any other refusal as unanswered",
  () =>
    Effect.gen(function* () {
      const refusals = [
        [HOSTED_API_ERROR.NOT_FOUND, HTTP_STATUS.NOT_FOUND, PLAN_CALL_FAILURE.NOT_FOUND],
        [HOSTED_API_ERROR.PLAN_ARCHIVED, HTTP_STATUS.CONFLICT, PLAN_CALL_FAILURE.PLAN_ARCHIVED],
        [HOSTED_API_ERROR.UNAVAILABLE, HTTP_STATUS.SERVER_ERROR, PLAN_CALL_FAILURE.UNANSWERED],
      ] as const;

      for (const [error, status, failure] of refusals) {
        const api = fakeCloudApi({
          [`POST /api/plans/${PLAN_ID}/messages`]: { answer: () => ({ error }), status },
        });
        const sent = yield* Effect.provide(
          client().send(PLAN_ID, "Roll out the plan.", CLIENT_KEY),
          api.layer,
        );
        assert.deepEqual(sent, { ok: false, failure }, error);
      }
    }),
);

it.effect("a blank typed line, one past the bound, or one with no key never travels", () =>
  Effect.gen(function* () {
    const api = fakeCloudApi({});
    const unsent = [
      client().send(PLAN_ID, "   ", CLIENT_KEY),
      client().send(PLAN_ID, "x".repeat(CODING_AGENT_BOUNDS.MAX_MESSAGE_CHARS + 1), CLIENT_KEY),
      client().send(PLAN_ID, "Roll out the plan.", ""),
    ];

    for (const send of unsent) {
      assert.deepEqual(yield* Effect.provide(send, api.layer), {
        ok: false,
        failure: PLAN_CALL_FAILURE.UNANSWERED,
      });
    }
    assert.deepEqual(api.requests(), []);
  }),
);
