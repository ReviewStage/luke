import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { fakeCloudApi, recordedRoutes } from "@luke/wire/testing";
import { Effect } from "effect";
import { HostedTaskClient } from "./task-client.js";
import { TASK_BOUNDS } from "./task-wire.js";
import { TASK_CALL_FAILURE } from "./tasks-view.js";

const TASK_ID = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";

const SUMMARY = {
  id: TASK_ID,
  workspaceId: "workspace-personal",
  name: "Teammate invitations",
  createdAt: 1_800_000_000_000,
  updatedAt: 1_800_000_100_000,
  repository: null,
  openedAt: 1_800_000_200_000,
};

const TASK = {
  ...SUMMARY,
  document: {
    body: "# Teammate invitations",
    assumptions: [{ text: "Members and admins can both invite." }],
  },
};

function client(): HostedTaskClient {
  return new HostedTaskClient({
    serviceBaseUrl: "https://tryluke.dev",
    readAccessToken: () => Effect.succeed("token-1"),
    refreshAccount: () => Effect.void,
  });
}

it.effect("opens one plan with its saved document", () =>
  Effect.gen(function* () {
    const api = fakeCloudApi({ [`GET /api/plans/${TASK_ID}`]: { answer: () => ({ plan: TASK }) } });

    const opened = yield* Effect.provide(client().open(TASK_ID), api.layer);

    assert.deepEqual(opened, { ok: true, answer: TASK });
  }),
);

it.effect(
  "an edit sends the text it was written from and the text written, exactly, and answers the plan as saved or the text as it stands; one past the bound is never sent",
  () =>
    Effect.gen(function* () {
      const saved = { ...TASK, updatedAt: 1_800_000_400_000 };
      const conflict = { conflict: { current: "- Luke's words." } };
      let sent = 0;
      const api = fakeCloudApi({
        [`POST /api/plans/${TASK_ID}/edit`]: {
          answer: () => {
            sent += 1;
            return sent === 1 ? { plan: saved } : conflict;
          },
        },
      });
      const edit = { document: { base: "## Goal\n", value: "## Goal\n\n - Mine. \n" } };

      const first = yield* Effect.provide(client().edit(TASK_ID, edit), api.layer);
      const second = yield* Effect.provide(client().edit(TASK_ID, edit), api.layer);
      const blank = yield* Effect.provide(
        client().edit(TASK_ID, {
          document: { base: "", value: "x".repeat(TASK_BOUNDS.MAX_BODY_CHARS + 1) },
        }),
        api.layer,
      );

      assert.deepEqual(first, { ok: true, answer: { plan: saved } });
      assert.deepEqual(second, { ok: true, answer: conflict });
      assert.deepEqual(blank, { ok: false, failure: TASK_CALL_FAILURE.UNANSWERED });
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
