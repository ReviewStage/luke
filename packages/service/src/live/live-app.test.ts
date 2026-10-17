import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import type { LiveStatement } from "@luke/database/core/live-statement";
import { Database } from "@luke/database/core/query";
import { createCodingAgent } from "@luke/database/models/coding-agent-store";
import { childConversationId } from "@luke/database/models/ids";
import { openTaskConversation } from "@luke/database/models/task-store";
import { user } from "@luke/database/schemas/auth";
import { getTestDB, startTask } from "@luke/database/testing";
import {
  accountInboxLiveAnswerSchema,
  agentTranscriptLiveAnswerSchema,
  scopeInboxLiveAnswerSchema,
} from "@luke/features/live-wire";
import type { WireBoundaryInput } from "@luke/wire";
import { Effect, Layer, Option, Schema } from "effect";
import { HttpRouter } from "effect/http";
import { SqlClient } from "effect/sql";
import { HOSTED_API_ERROR, HOSTED_HTTP_STATUS } from "../http/http.js";
import { liveApp } from "./live-app.js";
import { type LiveSealer, LiveSealing, SealRefused } from "./realtime.js";

/**
 * The reads the desktop follows over Neon Realtime, sealed by the route:
 * refused without a bearer, unavailable where the deployment has no
 * Realtime, and otherwise every part of the account inbox sealed for the
 * bearer's own account, with the address to subscribe at.
 *
 * Synthetic accounts and bearers throughout; the secret is a script that
 * seals a statement as the values it was bound to, so a test can read whose
 * rows each sealed statement reads.
 */

const ORIGIN = "https://luke.test";
const LIVE_INBOX = "/api/live/inbox";
const REALTIME_URL = "wss://realtime.example/v1";

/** A new account, as the store holds one. */
const openUser = Effect.gen(function* () {
  const db = yield* Database;
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
  return userId;
});

/** A sealer that seals a statement as its values, so whose read it is shows. */
const SCRIPTED: LiveSealer = {
  url: REALTIME_URL,
  seal: (statement: LiveStatement) =>
    Effect.succeed({
      capability: JSON.stringify(statement.params),
      queryFingerprint: statement.sql,
      expiresAt: 1_800_000_060_000,
    }),
};

/** The group answering one request as `bearer`, over the deployment's Realtime where it has one, at the path asked. */
const ask = (options: {
  readonly bearer?: string;
  readonly method?: string;
  readonly path?: string;
  readonly sealing: Option.Option<LiveSealer>;
}) =>
  Effect.gen(function* () {
    const services = Layer.mergeAll(
      Layer.succeed(LiveSealing, options.sealing),
      Layer.succeed(SqlClient.SqlClient, yield* SqlClient.SqlClient),
      Layer.succeed(Database, yield* Database),
    );
    const { handler, dispose } = HttpRouter.toWebHandler(
      liveApp({
        resolveUserId: (incoming) => {
          const bearer = incoming.headers.get("authorization") ?? "";
          return Effect.succeed(
            bearer.startsWith("Bearer ") ? Option.some(bearer.slice(7)) : Option.none(),
          );
        },
      }).pipe(HttpRouter.provideRequest(services)),
      { disableLogger: true },
    );
    const response = yield* Effect.promise(() =>
      handler(
        new Request(new URL(options.path ?? LIVE_INBOX, ORIGIN), {
          method: options.method ?? "GET",
          headers:
            options.bearer === undefined ? {} : { authorization: `Bearer ${options.bearer}` },
        }),
      ),
    );
    // SAFETY: the group answers JSON; the test compares it as the wire value it is.
    const body = (yield* Effect.promise(() => response.json())) as WireBoundaryInput;
    yield* Effect.promise(() => dispose());
    return { status: response.status, body };
  });

it.layer(getTestDB())("the live reads", (it) => {
  it.effect("a request without a bearer is refused, and one by another method is not taken", () =>
    Effect.gen(function* () {
      assert.deepEqual(yield* ask({ sealing: Option.some(SCRIPTED) }), {
        status: HOSTED_HTTP_STATUS.UNAUTHORIZED,
        body: { error: HOSTED_API_ERROR.INVALID_TOKEN },
      });
      assert.deepEqual(
        yield* ask({ bearer: "user-dana", method: "POST", sealing: Option.some(SCRIPTED) }),
        {
          status: HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED,
          body: { error: HOSTED_API_ERROR.METHOD_NOT_ALLOWED },
        },
      );
    }),
  );

  it.effect(
    "a deployment without Realtime answers unavailable, so the desktop holds its read",
    () =>
      Effect.gen(function* () {
        assert.deepEqual(yield* ask({ bearer: "user-dana", sealing: Option.none() }), {
          status: HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE,
          body: { error: HOSTED_API_ERROR.UNAVAILABLE },
        });
      }),
  );

  it.effect(
    "every part of the account inbox is sealed for the bearer's own account, with the address to subscribe at, and a seal refused answers unavailable",
    () =>
      Effect.gen(function* () {
        const dana = yield* ask({ bearer: "user-dana", sealing: Option.some(SCRIPTED) });
        const eli = yield* ask({ bearer: "user-eli", sealing: Option.some(SCRIPTED) });

        assert.equal(dana.status, HOSTED_HTTP_STATUS.OK);
        const answer = Schema.decodeUnknownSync(accountInboxLiveAnswerSchema)(dana.body);
        assert.equal(answer.url, REALTIME_URL);
        const parts = Object.entries(answer.queries);
        assert.deepEqual(parts.map(([part]) => part).toSorted(), [
          "automations",
          "failedRuns",
          "items",
          "planless",
          "plans",
        ]);
        for (const [part, sealed] of parts) {
          assert.ok(sealed.capability.includes('"user-dana"'), `${part} is read for the bearer`);
          assert.ok(!sealed.capability.includes("user-eli"), `${part} is read for no one else`);
        }
        const theirs = Schema.decodeUnknownSync(accountInboxLiveAnswerSchema)(eli.body);
        assert.ok(
          Object.values(theirs.queries).every((sealed) => sealed.capability.includes('"user-eli"')),
        );

        const refusing: LiveSealer = {
          url: REALTIME_URL,
          seal: () => Effect.fail(new SealRefused({ reason: "refused" })),
        };
        assert.deepEqual(yield* ask({ bearer: "user-dana", sealing: Option.some(refusing) }), {
          status: HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE,
          body: { error: HOSTED_API_ERROR.UNAVAILABLE },
        });
      }),
  );

  it.effect(
    "a plan's inbox, or an agent's, is sealed as its open and latest settled items for an account that reaches it, and not found for one that does not",
    () =>
      Effect.gen(function* () {
        const owner = yield* openUser;
        const stranger = yield* openUser;
        const task = yield* startTask(owner, { name: "Teammate invitations" });
        const started = yield* createCodingAgent(owner, {
          taskId: task.id,
          idempotencyKey: randomUUID(),
          model: "anthropic/claude-opus-5.5",
          effort: "high",
          repository: "acme/relay",
          planSnapshot: "# Teammate invitations\n",
          prompt: null,
        });
        assert.ok(Option.isSome(started));
        const agentId = started.value.agent.id;
        const planPath = `/api/live/plan-inbox?id=${task.id}`;
        const agentPath = `/api/live/agent-inbox?id=${agentId}`;

        for (const path of [planPath, agentPath]) {
          const sealed = yield* ask({ bearer: owner, path, sealing: Option.some(SCRIPTED) });
          assert.equal(sealed.status, HOSTED_HTTP_STATUS.OK);
          const answer = Schema.decodeUnknownSync(scopeInboxLiveAnswerSchema)(sealed.body);
          assert.equal(answer.url, REALTIME_URL);
          for (const query of Object.values(answer.queries)) {
            assert.ok(query.capability.includes(`"${owner}"`), "read for the bearer");
          }
          assert.deepEqual(yield* ask({ bearer: stranger, path, sealing: Option.some(SCRIPTED) }), {
            status: HOSTED_HTTP_STATUS.NOT_FOUND,
            body: { error: HOSTED_API_ERROR.NOT_FOUND },
          });
          assert.deepEqual(yield* ask({ bearer: owner, path, sealing: Option.none() }), {
            status: HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE,
            body: { error: HOSTED_API_ERROR.UNAVAILABLE },
          });
        }
      }),
  );

  it.effect(
    "an agent's transcript, or a worker's by its call, is sealed as what its pages are read from, for an account that reaches the agent and under the conversation the call opens, and not found otherwise",
    () =>
      Effect.gen(function* () {
        const owner = yield* openUser;
        const stranger = yield* openUser;
        const task = yield* startTask(owner, { name: "Teammate invitations" });
        const started = yield* createCodingAgent(owner, {
          taskId: task.id,
          idempotencyKey: randomUUID(),
          model: "anthropic/claude-opus-5.5",
          effort: "high",
          repository: "acme/relay",
          planSnapshot: "# Teammate invitations\n",
          prompt: null,
        });
        assert.ok(Option.isSome(started));
        const { agent } = started.value;
        const own = `/api/live/agent-transcript?id=${agent.id}`;
        const worker = `${own}&call=call-7`;

        const sealedOwn = yield* ask({ bearer: owner, path: own, sealing: Option.some(SCRIPTED) });
        assert.equal(sealedOwn.status, HOSTED_HTTP_STATUS.OK);
        const answer = Schema.decodeUnknownSync(agentTranscriptLiveAnswerSchema)(sealedOwn.body);
        assert.equal(answer.url, REALTIME_URL);
        assert.deepEqual(Object.keys(answer.queries).toSorted(), [
          "agent",
          "conversation",
          "messages",
          "turns",
          "workers",
        ]);
        for (const query of Object.values(answer.queries)) {
          assert.ok(query.capability.includes(`"${owner}"`), "read for the agent's owner");
        }
        assert.ok(answer.queries.messages.capability.includes(`"${agent.conversationId}"`));

        const sealedWorker = Schema.decodeUnknownSync(agentTranscriptLiveAnswerSchema)(
          (yield* ask({ bearer: owner, path: worker, sealing: Option.some(SCRIPTED) })).body,
        );
        const child = childConversationId(agent.conversationId, "call-7");
        assert.ok(sealedWorker.queries.messages.capability.includes(`"${child}"`));
        assert.ok(sealedWorker.queries.workers.capability.includes(`"${agent.conversationId}"`));

        for (const path of [own, worker]) {
          assert.deepEqual(yield* ask({ bearer: stranger, path, sealing: Option.some(SCRIPTED) }), {
            status: HOSTED_HTTP_STATUS.NOT_FOUND,
            body: { error: HOSTED_API_ERROR.NOT_FOUND },
          });
          assert.deepEqual(yield* ask({ bearer: owner, path, sealing: Option.none() }), {
            status: HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE,
            body: { error: HOSTED_API_ERROR.UNAVAILABLE },
          });
        }
      }),
  );

  it.effect(
    "a planning worker's transcript is sealed as its child conversation's statements for an account that reaches the plan, and not found for one that does not or for a plan never planned on",
    () =>
      Effect.gen(function* () {
        const owner = yield* openUser;
        const stranger = yield* openUser;
        const planned = yield* startTask(owner, { name: "Teammate invitations" });
        const opened = yield* openTaskConversation(owner, planned.id);
        assert.ok(Option.isSome(opened));
        const unplanned = yield* startTask(owner, { name: "Billing" });
        const pathOf = (taskId: string) =>
          `/api/live/plan-worker-transcript?id=${taskId}&call=call-0-0`;

        const sealed = yield* ask({
          bearer: owner,
          path: pathOf(planned.id),
          sealing: Option.some(SCRIPTED),
        });
        assert.equal(sealed.status, HOSTED_HTTP_STATUS.OK);
        const answer = Schema.decodeUnknownSync(agentTranscriptLiveAnswerSchema)(sealed.body);
        const child = childConversationId(opened.value.conversationId, "call-0-0");
        assert.ok(answer.queries.messages.capability.includes(`"${child}"`), "the worker's own");
        assert.ok(answer.queries.messages.capability.includes(`"${owner}"`), "read for the bearer");
        for (const [bearer, taskId] of [
          [stranger, planned.id],
          [owner, unplanned.id],
        ] as const) {
          assert.deepEqual(
            yield* ask({ bearer, path: pathOf(taskId), sealing: Option.some(SCRIPTED) }),
            { status: HOSTED_HTTP_STATUS.NOT_FOUND, body: { error: HOSTED_API_ERROR.NOT_FOUND } },
          );
        }
        assert.deepEqual(
          yield* ask({ bearer: owner, path: pathOf(planned.id), sealing: Option.none() }),
          {
            status: HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE,
            body: { error: HOSTED_API_ERROR.UNAVAILABLE },
          },
        );
      }),
  );
});
