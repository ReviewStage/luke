import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { listTasks, readTask } from "@luke/database/models/task-store";
import { user } from "@luke/database/schemas/auth";
import { getTestDB, openWorkspace } from "@luke/database/testing";
import type { WireBoundaryInput } from "@luke/wire";
import { fakeHttpClientLayer } from "@luke/wire/testing";
import { Clock, Effect, Layer, Option, Redacted, Schema } from "effect";
import { HttpRouter } from "effect/http";
import { SqlClient } from "effect/sql";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import { LinearAgentConfig, type LinearAgentSettings, linearAgentApp } from "./linear-agent-app.js";

/**
 * Luke's Linear agent's webhook, answered by its group the way a function
 * answers it, over the real store on PGlite, with Linear's token endpoint and
 * GraphQL API as the one network double, which records every call: nothing
 * of a delivery is read before its signature over the body's own bytes holds
 * under the app's secret, a stale delivery is refused, and a session created
 * on an issue starts a task from it in the configured workspace as the
 * configured member, then hands Linear the task's address as the session's
 * link and a response naming it. Synthetic accounts, secrets, and issues
 * throughout.
 */

const ORIGIN = "https://luke.test";
const WEBHOOK = "/api/linear/agent";
const WEBHOOK_SECRET = "linear-webhook-fixture";
const SESSION_ID = "session-1";

const ISSUE = {
  id: "issue-1",
  identifier: "ENG-7",
  title: "Retry the relay's webhook",
  url: "https://linear.app/acme/issue/ENG-7/retry-the-relays-webhook",
  description: "Retry three times before giving up.",
  teamId: "team-1",
  team: { id: "team-1", key: "ENG", name: "Engineering" },
};

/** One call the app made to Linear: where, under which authorization, and what it sent. */
interface LinearCall {
  readonly url: string;
  readonly authorization: string;
  readonly body: string;
}

/** Linear's token endpoint and GraphQL API, minting a token unless it `refuses`, and every call it heard. */
function linearApi(refuses = false) {
  const calls: LinearCall[] = [];
  const layer = fakeHttpClientLayer(async (url, init) => {
    calls.push({
      url: String(url),
      authorization: new Headers(init.headers).get("authorization") ?? "",
      body: await new Response(init.body).text(),
    });
    if (String(url).endsWith("/oauth/token")) {
      return refuses
        ? Response.json({ error: "invalid_client" }, { status: 401 })
        : Response.json({ access_token: "app-token-fixture", token_type: "Bearer" });
    }
    return Response.json({ data: { result: { success: true } } });
  });
  return { layer, calls };
}

/** An account with a user row; its id. */
const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
  return userId;
});

/** The group over the test's database, the settings given, and Linear's API. */
const standing = (settings: LinearAgentSettings | undefined, refuses = false) =>
  Effect.gen(function* () {
    const linear = linearApi(refuses);
    const services = Layer.mergeAll(
      Layer.succeed(SqlClient.SqlClient, yield* SqlClient.SqlClient),
      Layer.succeed(Database, yield* Database),
      Layer.succeed(Clock.Clock, yield* Clock.Clock),
      Layer.succeed(LinearAgentConfig, { settings }),
      linear.layer,
    );
    const app = HttpRouter.toWebHandler(
      linearAgentApp().pipe(HttpRouter.provideRequest(services)),
      { disableLogger: true },
    );
    yield* Effect.addFinalizer(() => Effect.promise(() => app.dispose()));
    /** One delivery of the payload, signed under `secret`. */
    const deliver = (payload: WireBoundaryInput, secret = WEBHOOK_SECRET) =>
      Effect.gen(function* () {
        const body = JSON.stringify(payload);
        const signature = createHmac("sha256", secret).update(body).digest("hex");
        const response = yield* Effect.promise(() =>
          app.handler(
            new Request(new URL(WEBHOOK, ORIGIN), {
              method: "POST",
              headers: { "linear-signature": signature, "content-type": "application/json" },
              body,
            }),
          ),
        );
        return response.status;
      });
    return { linear, deliver };
  });

/** A session created on the issue, as Linear sends it, stamped now. */
const createdOn = (issue: typeof ISSUE | null) =>
  Effect.map(Clock.currentTimeMillis, (now) => ({
    type: "AgentSessionEvent",
    action: "created",
    organizationId: "linear-org-1",
    oauthClientId: "client-1",
    appUserId: "app-user-1",
    createdAt: new Date(now).toISOString(),
    webhookId: "webhook-1",
    webhookTimestamp: now,
    promptContext: '<issue identifier="ENG-7"></issue>',
    agentSession: { id: SESSION_ID, status: "pending", issue },
  }));

/** A workspace and its owner, and the settings that start tasks there as them. */
const configured = Effect.gen(function* () {
  const owner = yield* openAccount;
  const workspaceId = yield* openWorkspace(owner);
  const settings: LinearAgentSettings = {
    clientId: "client-1",
    clientSecret: Redacted.make("client-secret-fixture"),
    webhookSecret: Redacted.make(WEBHOOK_SECRET),
    workspaceId,
    userId: owner,
  };
  return { owner, workspaceId, settings };
});

/** A GraphQL call the app sent, as far as the test reads it. */
const SentSchema = Schema.Struct({
  query: Schema.String,
  variables: Schema.Struct({
    id: Schema.optionalKey(Schema.String),
    input: Schema.Struct({
      agentSessionId: Schema.optionalKey(Schema.String),
      content: Schema.optionalKey(Schema.Struct({ type: Schema.String, body: Schema.String })),
      externalUrls: Schema.optionalKey(
        Schema.Array(Schema.Struct({ label: Schema.String, url: Schema.String })),
      ),
    }),
  }),
});

/** The GraphQL calls the app made, each read from its sent JSON. */
const graphqlCalls = (calls: readonly LinearCall[]) =>
  calls
    .filter((call) => call.url.endsWith("/graphql"))
    .map((call) => Schema.decodeUnknownSync(SentSchema)(JSON.parse(call.body)));

it.layer(getTestDB())("Luke's Linear agent webhook", (it) => {
  it.effect(
    "a session created on an issue starts a task from it as the configured member, and Linear is handed the task's address as the session's link and a response",
    () =>
      Effect.gen(function* () {
        const { owner, workspaceId, settings } = yield* configured;
        const { linear, deliver } = yield* standing(settings);

        const status = yield* deliver(yield* createdOn(ISSUE));

        assert.equal(status, HOSTED_HTTP_STATUS.OK);
        const [token] = linear.calls;
        assert.ok(token !== undefined && token.url.endsWith("/oauth/token"));
        assert.ok(token.authorization.startsWith("Basic "));
        assert.equal(new URLSearchParams(token.body).get("grant_type"), "client_credentials");
        const [session, response] = graphqlCalls(linear.calls);
        assert.ok(session !== undefined && response !== undefined);
        const link = session.variables.input.externalUrls?.[0]?.url;
        assert.ok(link !== undefined);
        const taskId = link.split("/").at(-1) ?? "";
        const task = Option.getOrThrow(yield* readTask(owner, taskId));
        assert.deepEqual(
          [task.task.name, task.task.workspaceId, task.linearIssue],
          [
            ISSUE.title,
            workspaceId,
            {
              identifier: ISSUE.identifier,
              title: ISSUE.title,
              url: ISSUE.url,
              description: ISSUE.description,
            },
          ],
        );
        assert.equal(session.variables.id, SESSION_ID);
        assert.deepEqual(response.variables.input, {
          agentSessionId: SESSION_ID,
          content: { type: "response", body: `I started a task in Luke for ENG-7: ${link}` },
        });
        for (const call of linear.calls.slice(1)) {
          assert.equal(call.authorization, "Bearer app-token-fixture");
        }
      }),
  );

  it.effect(
    "a delivery signed under another secret, or stale, is refused before anything is read or asked of Linear",
    () =>
      Effect.gen(function* () {
        const { settings } = yield* configured;
        const { linear, deliver } = yield* standing(settings);
        const created = yield* createdOn(ISSUE);

        const forged = yield* deliver(created, "another-secret");
        const stale = yield* deliver({
          ...created,
          webhookTimestamp: created.webhookTimestamp - 120_000,
        });

        assert.deepEqual(
          [forged, stale],
          [HOSTED_HTTP_STATUS.UNAUTHORIZED, HOSTED_HTTP_STATUS.UNAUTHORIZED],
        );
        assert.deepEqual(linear.calls, []);
      }),
  );

  it.effect("a deployment missing the trial's settings refuses every delivery", () =>
    Effect.gen(function* () {
      const { linear, deliver } = yield* standing(undefined);

      assert.equal(yield* deliver(yield* createdOn(ISSUE)), HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE);
      assert.deepEqual(linear.calls, []);
    }),
  );

  it.effect(
    "where the configured member is no member of the workspace, no task is started and the session is told so as an error",
    () =>
      Effect.gen(function* () {
        const { owner, settings } = yield* configured;
        const stranger = yield* openAccount;
        const { linear, deliver } = yield* standing({ ...settings, userId: stranger });

        assert.equal(yield* deliver(yield* createdOn(ISSUE)), HOSTED_HTTP_STATUS.OK);

        assert.deepEqual(yield* listTasks(owner), []);
        assert.deepEqual(yield* listTasks(stranger), []);
        const [only, ...rest] = graphqlCalls(linear.calls);
        assert.deepEqual(rest, []);
        assert.ok(only !== undefined);
        assert.equal(only.variables.input.content?.type, "error");
      }),
  );

  it.effect(
    "where Linear mints no token, no task is started and nothing else is asked of Linear",
    () =>
      Effect.gen(function* () {
        const { owner, settings } = yield* configured;
        const { linear, deliver } = yield* standing(settings, true);

        assert.equal(yield* deliver(yield* createdOn(ISSUE)), HOSTED_HTTP_STATUS.OK);

        assert.deepEqual(yield* listTasks(owner), []);
        assert.deepEqual(graphqlCalls(linear.calls), []);
      }),
  );
});
