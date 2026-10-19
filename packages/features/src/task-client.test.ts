import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { fakeCloudApi, type JsonValue, recordedRoutes } from "@luke/wire/testing";
import { Effect } from "effect";
import { accountBearer } from "./account-call.js";
import { CODING_AGENT_CALL_FAILURE } from "./coding-agent-view.js";
import { CODING_AGENT_STATUS } from "./coding-agent-wire.js";
import { PLAN_ATTACHMENT_REFUSAL } from "./plan-attachment-wire.js";
import { REPOSITORY_UNREACHED } from "./repository-reach-wire.js";
import { HOSTED_API_ERROR } from "./service-wire.js";
import { HostedTaskClient } from "./task-client.js";
import { TASK_BOUNDS, TASK_FILE_REFUSAL } from "./task-wire.js";
import {
  PICTURE_KEEP_FAILURE,
  PLAN_COMMENT_CALL_FAILURE,
  TASK_CALL_FAILURE,
} from "./tasks-view.js";

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

/** A task the account does not reach. */
const OTHER_TASK = "9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a";

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
    credential: accountBearer({
      readAccessToken: () => Effect.succeed("token-1"),
      refreshAccount: () => Effect.void,
    }),
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

it.effect(
  "a start naming an agent answers the task with the agent started on it, or with why it was refused as a Start reads it; one asking for planning beside it is never sent",
  () =>
    Effect.gen(function* () {
      const task = { ...TASK, repository: "acme/relay", document: { body: "", assumptions: [] } };
      const agent = {
        id: "3c9e1d2a-6b7f-4e8a-9c0d-1e2f3a4b5c6d",
        planId: TASK_ID,
        model: "anthropic/claude-opus-5.5",
        effort: "high",
        title: null,
        createdAt: 1_800_000_300_000,
        status: CODING_AGENT_STATUS.STARTING,
        turnId: null,
      };
      let sent = 0;
      const api = fakeCloudApi({
        "POST /api/plans": {
          answer: () => {
            sent += 1;
            return sent === 1
              ? { plan: task, agent }
              : { plan: task, agentRefusal: { error: HOSTED_API_ERROR.INVALID_REQUEST } };
          },
        },
      });
      const request = {
        repository: "acme/relay",
        agent: { idempotencyKey: "start-1", prompt: " Expire invitations. " },
      };

      const started = yield* Effect.provide(client().create(request), api.layer);
      const refused = yield* Effect.provide(client().create(request), api.layer);
      const planned = yield* Effect.provide(
        client().create({ ...request, planning: true }),
        api.layer,
      );

      assert.deepEqual(started, { ok: true, answer: { task, agent: { agent } } });
      assert.deepEqual(refused, {
        ok: true,
        answer: { task, agent: { failure: CODING_AGENT_CALL_FAILURE.INVALID_CHOICE } },
      });
      assert.deepEqual(planned, { ok: false, failure: TASK_CALL_FAILURE.UNANSWERED });
      assert.deepEqual(
        api.requests().map((each) => JSON.parse(each.body ?? "{}")),
        [
          {
            repository: "acme/relay",
            agent: { idempotencyKey: "start-1", prompt: "Expire invitations." },
          },
          {
            repository: "acme/relay",
            agent: { idempotencyKey: "start-1", prompt: "Expire invitations." },
          },
        ],
      );
    }),
);

it.effect(
  "a task's comments are read past the cursor, a thread's write answers it as it stands or its refusal, and a task not the account's reads as not found",
  () =>
    Effect.gen(function* () {
      const thread = "0f9b5f6e-6a8e-4c51-9a0e-2c1f2f0b7a11";
      const api = fakeCloudApi({
        [`GET /api/plans/${TASK_ID}/comments`]: {
          answer: () => ({ threads: [], cursor: "c1" }),
        },
        [`POST /api/plans/${TASK_ID}/comments/${thread}`]: {
          answer: () => ({ refused: "not-yours" }),
        },
        [`GET /api/plans/${OTHER_TASK}/comments`]: {
          status: 404,
          answer: () => ({ error: HOSTED_API_ERROR.NOT_FOUND }),
        },
      });
      const action = { action: "edit", entry: thread, words: "Mine now" } as const;

      const read = yield* Effect.provide(client().comments(TASK_ID, "0"), api.layer);
      const refused = yield* Effect.provide(
        client().actOnComment(TASK_ID, thread, action),
        api.layer,
      );
      const elsewhere = yield* Effect.provide(client().comments(OTHER_TASK, "0"), api.layer);
      const blank = yield* Effect.provide(
        client().actOnComment(TASK_ID, thread, { action: "reply", clientKey: "k", words: " " }),
        api.layer,
      );

      assert.deepEqual(read, { threads: [], cursor: "c1" });
      assert.deepEqual(refused, { refused: "not-yours" });
      assert.deepEqual(elsewhere, { failure: PLAN_COMMENT_CALL_FAILURE.NOT_FOUND });
      assert.deepEqual(blank, { failure: PLAN_COMMENT_CALL_FAILURE.UNANSWERED });
      assert.equal(api.requests().length, 3);
      assert.equal(api.requests()[0]?.searchParams.get("after"), "0");
    }),
);

it.effect(
  "a change the service refuses answers why as the window names it: a repository out of reach, its reason beside it, and a move onto an archived plan; anything else, a deleted plan's delete among it, as unanswered",
  () =>
    Effect.gen(function* () {
      const unreached = {
        reason: REPOSITORY_UNREACHED.OTHER_OWNER,
        repository: "acme/relay",
        connectedTo: "someone-else",
      };
      const api = fakeCloudApi({
        [`PATCH /api/plans/${TASK_ID}`]: {
          status: 403,
          answer: () => ({ error: HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE, unreached }),
        },
        [`PATCH /api/plans/${OTHER_TASK}`]: {
          status: 409,
          answer: () => ({ error: HOSTED_API_ERROR.TASK_ARCHIVED }),
        },
        [`DELETE /api/plans/${OTHER_TASK}`]: {
          status: 404,
          answer: () => ({ error: HOSTED_API_ERROR.NOT_FOUND }),
        },
      });

      const repository = yield* Effect.provide(
        client().setRepository(TASK_ID, "acme/relay"),
        api.layer,
      );
      const moved = yield* Effect.provide(client().move(OTHER_TASK, "workspace-acme"), api.layer);
      const renamed = yield* Effect.provide(
        client().rename(OTHER_TASK, { name: "Invitation expiry" }),
        api.layer,
      );
      const deleted = yield* Effect.provide(client().delete(OTHER_TASK), api.layer);

      assert.deepEqual(repository, {
        ok: false,
        failure: TASK_CALL_FAILURE.REPOSITORY_NOT_REACHABLE,
      });
      assert.deepEqual(moved, { ok: false, failure: TASK_CALL_FAILURE.TASK_ARCHIVED });
      assert.equal(renamed, undefined);
      assert.equal(deleted, false);
      assert.deepEqual(
        api.requests().map((request) => JSON.parse(request.body ?? "null")),
        [
          { repository: "acme/relay" },
          { workspaceId: "workspace-acme" },
          { name: "Invitation expiry" },
          null,
        ],
      );
    }),
);

it.effect("the list asks for the archived plans too, and a revision is asked by its number", () =>
  Effect.gen(function* () {
    const api = fakeCloudApi({
      "GET /api/plans": { answer: () => ({ plans: [SUMMARY] }) },
      [`GET /api/plans/${TASK_ID}/revisions/3`]: {
        status: 404,
        answer: () => ({ error: HOSTED_API_ERROR.NOT_FOUND }),
      },
    });

    const listed = yield* Effect.provide(client().list(), api.layer);
    const revision = yield* Effect.provide(client().readRevision(TASK_ID, 3), api.layer);

    assert.deepEqual(listed, { ok: true, answer: { plans: [SUMMARY] } });
    assert.equal(revision, undefined);
    assert.deepEqual(recordedRoutes(api.requests()), [
      "GET /api/plans?archived=include",
      `GET /api/plans/${TASK_ID}/revisions/3`,
    ]);
  }),
);

it.effect(
  "a File tab's window is asked at the plan's own path, its file's path a query, and a tree's folder the same; an answer that never came is nothing",
  () =>
    Effect.gen(function* () {
      const file = {
        file: {
          path: "src/a b+c.ts",
          repository: "Acme/Relay",
          branch: "main",
          firstLine: 2,
          lineCount: 4,
          lines: ["two"],
        },
      };
      const api = fakeCloudApi({
        [`GET /api/plans/${TASK_ID}/file`]: { answer: () => file },
        [`GET /api/plans/${TASK_ID}/tree`]: {
          answer: () => ({ refusal: TASK_FILE_REFUSAL.NO_REPOSITORY }),
        },
      });
      const sha = "0123456789abcdef0123456789abcdef01234567";

      const read = yield* Effect.provide(
        client().readFile(TASK_ID, { path: "src/a b+c.ts", firstLine: 2, lastLine: 3 }),
        api.layer,
      );
      yield* Effect.provide(
        client().readFile(TASK_ID, {
          path: "src/a b+c.ts",
          firstLine: 1,
          lastLine: 1,
          raw: true,
          ref: sha,
        }),
        api.layer,
      );
      const folder = yield* Effect.provide(
        client().readTree(TASK_ID, { path: "", recursive: true }),
        api.layer,
      );
      api.fail();
      const failed = yield* Effect.provide(
        client().readFile(TASK_ID, { path: "src/a b+c.ts", firstLine: 2, lastLine: 3 }),
        api.layer,
      );

      assert.deepEqual(read, file);
      assert.deepEqual(folder, { refusal: TASK_FILE_REFUSAL.NO_REPOSITORY });
      assert.equal(failed, undefined);
      assert.deepEqual(recordedRoutes(api.requests()), [
        `GET /api/plans/${TASK_ID}/file?first=2&last=3&path=src/a b+c.ts`,
        `GET /api/plans/${TASK_ID}/file?first=1&last=1&path=src/a b+c.ts&raw=1&ref=${sha}`,
        `GET /api/plans/${TASK_ID}/tree?recursive=1`,
        `GET /api/plans/${TASK_ID}/file?first=2&last=3&path=src/a b+c.ts`,
      ]);
    }),
);

it.effect(
  "a picture kept answers its id, a plan at its bound answers too many, and one the account may not write answers not found",
  () =>
    Effect.gen(function* () {
      const picture = "data:image/png;base64,iVBORw0KGgo=";
      const keptId = "3c1f0e2a-7b6d-4e5f-9a8b-0c1d2e3f4a5b";
      const keep = (status: number, answer: () => JsonValue) =>
        Effect.provide(
          client().keepPicture(TASK_ID, picture),
          fakeCloudApi({ [`POST /api/plans/${TASK_ID}/attachments`]: { answer, status } }).layer,
        );
      const api = fakeCloudApi({
        [`POST /api/plans/${TASK_ID}/attachments`]: { answer: () => ({ id: keptId }), status: 201 },
      });

      assert.deepEqual(yield* Effect.provide(client().keepPicture(TASK_ID, picture), api.layer), {
        id: keptId,
      });
      assert.deepEqual(yield* keep(200, () => ({ refused: PLAN_ATTACHMENT_REFUSAL.TOO_MANY })), {
        failure: PICTURE_KEEP_FAILURE.TOO_MANY,
      });
      assert.deepEqual(yield* keep(404, () => ({ error: HOSTED_API_ERROR.NOT_FOUND })), {
        failure: TASK_CALL_FAILURE.NOT_FOUND,
      });
      assert.deepEqual(yield* keep(503, () => ({ error: HOSTED_API_ERROR.UNAVAILABLE })), {
        failure: PICTURE_KEEP_FAILURE.UNANSWERED,
      });
      assert.deepEqual(
        api.requests().map((request) => request.body),
        [JSON.stringify({ picture })],
      );
    }),
);
