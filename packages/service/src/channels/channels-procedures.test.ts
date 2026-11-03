import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import { createAgent } from "@repo/database/models/agent-store";
import {
  archiveChannel,
  createChannel,
  ensureGeneralChannel,
  listChannelLooks,
} from "@repo/database/models/channel-store";
import { user } from "@repo/database/schemas/auth";
import { CONVERSATION_RUNTIME } from "@repo/database/storage-vocabulary";
import { getTestDB, joinWorkspace, openWorkspace, startTask } from "@repo/database/testing";
import type { WireBoundaryInput } from "@repo/wire";
import { type Context, Effect, Option, Result } from "effect";
import {
  recordingProductAnalytics,
  SERVER_CHANNEL_ACTION,
  SERVER_EVENT,
} from "../events/server-events.js";
import { HOSTED_API_ERROR, HOSTED_HTTP_STATUS } from "../http/http.js";
import { postInboxThread } from "../inbox/inbox-store.js";
import { hostedFetch } from "../orpc/handler.js";
import type { WebServices } from "../runtime.js";
import { channelsProcedures } from "./channels-procedures.js";

/**
 * A workspace's channels, answered by the hosted oRPC router the way the web
 * route answers them, over a real dialect: a channel is reached only within
 * a workspace the bearer is a member of, so a look never lands on a channel
 * of another workspace than the one named, and another workspace's channel
 * is not found rather than read as empty.
 *
 * Synthetic accounts, bearers, workspaces, and channels throughout.
 */

const ORIGIN = "https://app.test";

/** What the route counted, across the file; a test reads its own account's. */
const ANALYTICS = recordingProductAnalytics();

/** An account behind a bearer of its own name. */
const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const id = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@app.test` });
  return id;
});

/** The resource's answer to one request by the account the bearer names: its status and its JSON. */
const ask = (userId: string, path: string, body?: WireBoundaryInput) =>
  Effect.gen(function* () {
    // SAFETY: the procedures yield the database, the clock and the analytics alone, which the test's own context holds.
    const services = (yield* Effect.context<never>().pipe(
      Effect.provide(ANALYTICS.layer),
    )) as Context.Context<WebServices>;
    const handle = hostedFetch({
      channels: channelsProcedures({
        resolveUserId: (incoming) =>
          Effect.succeed(
            Option.fromNullishOr(incoming.headers.get("authorization")?.replace("Bearer ", "")),
          ),
      }),
    });
    const request = new Request(new URL(path, ORIGIN), {
      method: body === undefined ? "GET" : "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${userId}` },
      ...(body === undefined ? undefined : { body: JSON.stringify(body) }),
    });
    const response = yield* Effect.promise(() => handle(request, services));
    // SAFETY: the route answers JSON; the test compares it as the wire value it is.
    const answered = (yield* Effect.promise(() => response.json())) as WireBoundaryInput;
    return { status: response.status, body: answered };
  });

const NOT_FOUND = {
  status: HOSTED_HTTP_STATUS.NOT_FOUND,
  body: { error: HOSTED_API_ERROR.NOT_FOUND },
};

it.layer(getTestDB())("the channels route", (it) => {
  it.effect(
    "a channel outside the workspace named, or the bearer's, is not found, its look stamped nowhere",
    () =>
      Effect.gen(function* () {
        const [dean, outsider] = [yield* openAccount, yield* openAccount];
        const acme = yield* openWorkspace(dean);
        const beta = yield* openWorkspace(dean);
        const draft = { name: "app", purpose: "Desktop and panel.", project: false };
        const betaApp = Result.getOrThrow(yield* createChannel(dean, beta, draft, new Date(1)));

        const crossed = yield* ask(dean, "/api/channels/look", {
          workspaceId: acme,
          channelId: betaApp.id,
        });
        const foreign = yield* ask(outsider, `/api/channels/threads?channelId=${betaApp.id}`);
        const unknown = yield* ask(dean, `/api/channels/threads?channelId=${randomUUID()}`);
        const own = yield* ask(dean, `/api/channels/threads?channelId=${betaApp.id}`);

        assert.deepEqual([crossed, foreign, unknown], [NOT_FOUND, NOT_FOUND, NOT_FOUND]);
        assert.deepEqual(yield* listChannelLooks(dean, beta), []);
        assert.deepEqual(own, { status: HOSTED_HTTP_STATUS.OK, body: { threads: [] } });
      }),
  );

  it.effect(
    "a member's make, edit, archive, and move of a channel's thread are counted under them in the workspace, a refused one is not",
    () =>
      Effect.gen(function* () {
        const dean = yield* openAccount;
        const task = yield* startTask(dean, { name: "Teammate invitations" });
        const acme = task.workspaceId;
        const started = yield* createAgent(dean, {
          taskId: task.id,
          idempotencyKey: randomUUID(),
          model: "anthropic/claude-opus-5.5",
          effort: "high",
          repository: "acme/relay",
          planSnapshot: "# Teammate invitations\n",
          prompt: null,
          runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
        });
        assert.ok(Option.isSome(started));
        const thread = Result.getOrThrow(
          yield* postInboxThread(
            { userId: dean, taskId: task.id, agentId: started.value.agent.id },
            { key: "heads-up", title: "Main is protected now", body: "Pushes need a review." },
          ),
        );
        const infra = Result.getOrThrow(
          yield* createChannel(
            dean,
            acme,
            { name: "web", purpose: "Web.", project: false },
            new Date(1),
          ),
        );
        const madeId = randomUUID();
        const made = yield* ask(dean, "/api/channels", {
          workspaceId: acme,
          name: "infra",
          purpose: "CI and releases.",
          id: madeId,
        });
        assert.equal(made.status, HOSTED_HTTP_STATUS.CREATED);

        yield* ask(dean, "/api/channels/edit", {
          workspaceId: acme,
          channelId: madeId,
          purpose: "CI, releases, and deploys.",
        });
        yield* ask(dean, "/api/channels/move", { threadId: thread.id, channelId: infra.id });
        yield* ask(dean, "/api/channels/archive", { workspaceId: acme, channelId: madeId });
        const refused = yield* ask(dean, "/api/channels/archive", {
          workspaceId: acme,
          channelId: randomUUID(),
        });

        assert.deepEqual(refused, NOT_FOUND);
        assert.deepEqual(
          ANALYTICS.recorded
            .filter((event) => event.userId === dean && event.name === SERVER_EVENT.CHANNEL_CHANGE)
            .map((event) => ({ workspaceId: event.workspaceId, ...event.properties })),
          [
            { workspaceId: acme, action: SERVER_CHANNEL_ACTION.CREATE },
            { workspaceId: acme, action: SERVER_CHANNEL_ACTION.EDIT },
            { workspaceId: acme, action: SERVER_CHANNEL_ACTION.THREAD_MOVE },
            { workspaceId: acme, action: SERVER_CHANNEL_ACTION.ARCHIVE },
          ],
        );
      }),
  );

  it.effect(
    "an edit keeps #general's name and takes its purpose, an archived channel is listed and opened again, and an outsider, a move, or a page naming nothing reached is not found",
    () =>
      Effect.gen(function* () {
        const [dean, charles, outsider] = [
          yield* openAccount,
          yield* openAccount,
          yield* openAccount,
        ];
        const acme = yield* openWorkspace(dean);
        yield* joinWorkspace(acme, charles);
        const general = yield* ensureGeneralChannel(acme, new Date(1));
        const draft = { name: "infra", purpose: "CI and releases.", project: false };
        const infra = Result.getOrThrow(yield* createChannel(dean, acme, draft, new Date(2)));
        yield* archiveChannel(dean, acme, infra.id, new Date(3));

        const renamed = yield* ask(charles, "/api/channels/edit", {
          workspaceId: acme,
          channelId: general,
          name: "lobby",
        });
        const purposed = yield* ask(charles, "/api/channels/edit", {
          workspaceId: acme,
          channelId: general,
          purpose: "Whatever fits nowhere else.",
        });
        const archived = yield* ask(charles, `/api/channels/archived?workspaceId=${acme}`);
        const theirs = yield* ask(outsider, `/api/channels/archived?workspaceId=${acme}`);
        const opened = yield* ask(charles, "/api/channels/unarchive", {
          workspaceId: acme,
          channelId: infra.id,
        });
        const moved = yield* ask(charles, "/api/channels/move", {
          threadId: randomUUID(),
          channelId: infra.id,
        });
        const paged = yield* ask(
          charles,
          `/api/channels/threads?channelId=${infra.id}&before=${randomUUID()}`,
        );

        assert.deepEqual(renamed.body, { error: HOSTED_API_ERROR.NOT_PERMITTED });
        assert.equal(purposed.status, HOSTED_HTTP_STATUS.OK);
        assert.deepEqual(
          // SAFETY: an answer the route gave OK is the channels answer.
          (purposed.body as { channels: { name: string; purpose: string }[] }).channels.map(
            (channel) => [channel.name, channel.purpose],
          ),
          [["general", "Whatever fits nowhere else."]],
        );
        assert.deepEqual(archived, {
          status: HOSTED_HTTP_STATUS.OK,
          body: {
            channels: [
              {
                id: infra.id,
                name: "infra",
                purpose: "CI and releases.",
                project: false,
                createdBy: dean,
                createdAt: 2,
                archivedAt: 3,
                waiting: 0,
                threads: 0,
              },
            ],
          },
        });
        assert.deepEqual([theirs, moved, paged], [NOT_FOUND, NOT_FOUND, NOT_FOUND]);
        assert.deepEqual(
          // SAFETY: an answer the route gave OK is the channels answer.
          (opened.body as { channels: { name: string }[] }).channels.map((channel) => channel.name),
          ["general", "infra"],
        );
      }),
  );
});
