import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { RUNNER_END, RUNNER_EVENT, type RunnerEvent } from "@luke/agent-runner/protocol";
import { Database } from "@luke/database/core/query";
import {
  createCodingAgent,
  dispatchMentioningServers,
  recordCodingAgentRunnerToken,
  updateCodingAgentServers,
} from "@luke/database/models/coding-agent-store";
import { user } from "@luke/database/schemas/auth";
import { CONVERSATION_RUNTIME } from "@luke/database/storage-vocabulary";
import { getTestDB, startTask } from "@luke/database/testing";
import { CODING_AGENT_PAYER } from "@luke/features/coding-agent-wire";
import { INTEGRATION_PROVIDER } from "@luke/features/integration-wire";
import { isRecord, type WireRecord } from "@luke/wire";
import { fakeHttpClientLayer } from "@luke/wire/testing";
import {
  Clock,
  DateTime,
  Duration,
  Effect,
  Fiber,
  Layer,
  Logger,
  Option,
  Redacted,
  Result,
} from "effect";
import { HttpRouter } from "effect/http";
import { SqlClient } from "effect/sql";
import { TestClock } from "effect/testing";
import { admitRunnerBearer, runnerTokenDigest } from "../agents/luke-mcp/bearer.js";
import { RUNNER_EVENTS_PATH, runnerEventsApp } from "../agents/native-events/runner-events-app.js";
import { NO_GITHUB } from "../testing/github-app-fake.js";
import {
  CONNECTOR_ASKED_NOTHING,
  firstIntegrationAccount,
  integrationConnectOf,
} from "../testing/integration-connect.js";
import {
  type Heard,
  LINEAR_AND_NOTION_CONNECT,
  linearServer,
  linearTokenOf,
  REJECTED_TEAM,
} from "../testing/integration-mcp-fake.js";
import {
  callConnectionTool,
  connectionInstructions,
  listConnectionTools,
  nativeAgentConnections,
} from "./connection-door.js";
import type { ConnectorService } from "./integration-connect.js";
import {
  beginIntegrationSignIn,
  completeIntegrationSignIn,
  renameIntegrationConnection,
} from "./integration-store.js";
import { INTEGRATION_GRANT_HOLDER, integrationUnavailable } from "./integration-token.js";
import { storeTools } from "./integration-tool-store.js";
import { INTEGRATION } from "./integrations.js";

/**
 * A native agent's integration servers, listed and called through their
 * door over the real store on PGlite, against Linear's MCP server as a
 * fake standing at its own address (`../testing/integration-mcp-fake.ts`),
 * which admits only the bearer Connect issued the member. Linear and Notion
 * are set up on this deployment, the rest are not, and GitHub is offered as
 * the App is.
 * The member connected Linear and not Notion. Every line the door logs is
 * kept, so a test can say no token was written anywhere it should not be.
 */

const LINEAR = INTEGRATION_PROVIDER.LINEAR;
const NOTION = INTEGRATION_PROVIDER.NOTION;

/** A Claude Code agent on a task of a member who connected Linear, admitted on its runner's bearer. */
const memberWithLinear = Effect.gen(function* () {
  const db = yield* Database;
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
  const task = yield* startTask(userId, { name: "Teammate invitations" });
  const started = yield* createCodingAgent(userId, {
    taskId: task.id,
    idempotencyKey: randomUUID(),
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    repository: "acme/relay",
    planSnapshot: "# Teammate invitations\n",
    prompt: null,
    runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
    payer: CODING_AGENT_PAYER.CLAUDE_SUBSCRIPTION,
  });
  const agent = Option.getOrThrow(started).agent;
  const bearer = randomBytes(32).toString("base64url");
  yield* recordCodingAgentRunnerToken(userId, agent.id, runnerTokenDigest(bearer));
  yield* beginIntegrationSignIn(userId, firstIntegrationAccount(userId, LINEAR), `state-${userId}`);
  assert.equal(yield* completeIntegrationSignIn(userId, LINEAR, `state-${userId}`), true);
  const admitted = Option.getOrThrow(yield* admitRunnerBearer(bearer));
  return { userId, agentId: agent.id, admitted, bearer };
});

/** The door's services: the store, the fake Connect, GitHub as the App, and Linear's server; every line logged is kept. */
function doorServices(bearer: string, heard: Heard, logged: string[]) {
  return Layer.mergeAll(
    NO_GITHUB,
    LINEAR_AND_NOTION_CONNECT,
    linearServer(bearer, heard),
    Logger.layer([Logger.make(({ message }) => logged.push(JSON.stringify(message)))]),
  );
}

/** The runner's events posted under its bearer to the events route, as a function answers them. */
const postEvents = (bearer: string, events: readonly RunnerEvent[]) =>
  Effect.gen(function* () {
    const services = Layer.mergeAll(
      Layer.succeed(SqlClient.SqlClient, yield* SqlClient.SqlClient),
      Layer.succeed(Database, yield* Database),
      Layer.succeed(Clock.Clock, yield* Clock.Clock),
    );
    const web = HttpRouter.toWebHandler(
      runnerEventsApp({}).pipe(HttpRouter.provideRequest(services)),
      { disableLogger: true },
    );
    const response = yield* Effect.promise(() =>
      web.handler(
        new Request(`https://luke.test${RUNNER_EVENTS_PATH}`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${bearer}` },
          body: JSON.stringify({ events }),
        }),
      ),
    );
    yield* Effect.promise(() => web.dispose());
    assert.equal(response.status, 200);
  });

function hearing(): Heard {
  return { calls: [], bearers: [] };
}

/** What a Connect below was asked: each token read's subject, and each eviction's. */
interface ConnectAsked {
  readonly reads: string[];
  readonly evicted: string[];
}

/**
 * Connect as its SDK answers Linear and Notion: a token read is served from
 * the in-process cache, which holds `cached` until it is evicted, and asks
 * Connect afterwards, which issues `issued`. Every read and eviction is
 * recorded.
 */
function cachingConnect(cached: string, issued: string, asked: ConnectAsked) {
  let held: string | undefined = cached;
  const connector: ConnectorService = {
    ...CONNECTOR_ASKED_NOTHING,
    token: (subject) =>
      Effect.sync(() => {
        asked.reads.push(subject);
        held ??= issued;
        return { token: Redacted.make(held), expiresAt: Infinity };
      }),
    evict: (subject) =>
      Effect.sync(() => {
        asked.evicted.push(subject);
        held = undefined;
      }),
  };
  return integrationConnectOf((provider) =>
    provider === LINEAR || provider === NOTION
      ? connector
      : { ...CONNECTOR_ASKED_NOTHING, configured: false },
  );
}

/** Every integration server a native launch is handed, initialized and listed as the harness does at its start. */
const launch = (admitted: Parameters<typeof nativeAgentConnections>[0]) =>
  Effect.gen(function* () {
    const listed: Record<string, readonly string[]> = {};
    for (const name of yield* nativeAgentConnections(admitted)) {
      yield* connectionInstructions(admitted, name);
      listed[name] = (yield* listConnectionTools(admitted, name)).map((tool) => tool.name);
    }
    return listed;
  });

/** Linear's server as one that never answers, so only a bound ends a read of it. */
const SILENT_LINEAR = fakeHttpClientLayer(() => new Promise<Response>(() => {}));

/** The text of a forwarded MCP result's first block. */
function firstText(result: Result.Result<WireRecord, unknown>): unknown {
  if (Result.isFailure(result)) return undefined;
  const content = result.success.content;
  return Array.isArray(content) && isRecord(content[0]) ? content[0].text : undefined;
}

it.layer(getTestDB())("the integrations' door", (it) => {
  it.effect(
    "a native agent is handed a server for each integration offered it, but one switched off",
    () =>
      Effect.gen(function* () {
        const member = yield* memberWithLinear;
        const services = doorServices(linearTokenOf(member.userId), hearing(), []);

        const before = yield* nativeAgentConnections(member.admitted).pipe(
          Effect.provide(services),
        );
        yield* updateCodingAgentServers(member.userId, member.agentId, [LINEAR]);
        const after = yield* nativeAgentConnections(member.admitted).pipe(Effect.provide(services));

        assert.ok(before.includes(LINEAR) && before.includes(NOTION));
        assert.deepEqual(
          after,
          before.filter((name) => name !== LINEAR),
        );
      }),
  );

  it.effect(
    "each connection's server tells the model what the integration is and, past one account, which account it is by label",
    () =>
      Effect.gen(function* () {
        const member = yield* memberWithLinear;
        const services = doorServices(linearTokenOf(member.userId), hearing(), []);
        const account = (connectionName: string, connectSubject: string) =>
          Effect.andThen(
            beginIntegrationSignIn(
              member.userId,
              { provider: NOTION, connectionName, connectSubject },
              `state-${connectionName}-${member.userId}`,
            ),
            completeIntegrationSignIn(
              member.userId,
              connectionName,
              `state-${connectionName}-${member.userId}`,
            ),
          );
        yield* account(NOTION, member.userId);
        yield* account("notion-2", `second-${member.userId}`);
        yield* renameIntegrationConnection(member.userId, NOTION, "Work");
        yield* renameIntegrationConnection(member.userId, "notion-2", "Personal");
        const told = (name: string) =>
          connectionInstructions(member.admitted, name).pipe(Effect.provide(services));

        assert.deepEqual(yield* told(LINEAR), Option.some(INTEGRATION[LINEAR].DESCRIPTION));
        const second = Option.getOrThrow(yield* told("notion-2"));
        assert.ok(second.startsWith(INTEGRATION[NOTION].DESCRIPTION));
        assert.ok(second.includes('the developer\'s "Personal" Notion account'));
        assert.deepEqual(yield* told("slack"), Option.none());
      }),
  );

  it.effect(
    "a connected integration lists its provider's tools as the provider listed them, and one the member has not connected lists none",
    () =>
      Effect.gen(function* () {
        const member = yield* memberWithLinear;
        const heard = hearing();
        const logged: string[] = [];
        const services = doorServices(linearTokenOf(member.userId), heard, logged);

        const linear = yield* listConnectionTools(member.admitted, LINEAR).pipe(
          Effect.provide(services),
        );
        const bearersForLinear = heard.bearers.length;
        const notion = yield* listConnectionTools(member.admitted, NOTION).pipe(
          Effect.provide(services),
        );

        assert.deepEqual(
          linear.map((tool) => tool.name),
          ["list_issues", "create_issue", "fail", "draw", "attach"],
        );
        assert.deepEqual(linear.find((tool) => tool.name === "create_issue")?.outputSchema, {
          type: "object",
          properties: { id: { type: "string" } },
        });
        assert.deepEqual(notion, []);
        assert.equal(heard.bearers.length, bearersForLinear);
        assert.deepEqual(
          logged.filter((line) => line.includes("notion")),
          [
            JSON.stringify([
              `integration server notion lists no tools: ${integrationUnavailable(NOTION).NOT_CONNECTED}`,
            ]),
          ],
        );
      }),
  );

  it.effect(
    "a call forwards its input on the member's own grant and answers the provider's result as it sent it",
    () =>
      Effect.gen(function* () {
        const member = yield* memberWithLinear;
        const heard = hearing();
        const services = doorServices(linearTokenOf(member.userId), heard, []);
        const call = (tool: string, input: WireRecord = {}) =>
          callConnectionTool(member.admitted, LINEAR, tool, input).pipe(Effect.provide(services));

        const listed = yield* call("list_issues", { team: "ENG" });
        const created = yield* call("create_issue", { title: "Invite emails bounce" });
        const failed = yield* call("fail");

        assert.equal(firstText(listed), JSON.stringify({ issues: [{ id: "LIN-1" }] }));
        assert.ok(Result.isSuccess(created));
        assert.deepEqual(created.success.structuredContent, { id: "LIN-2" });
        assert.ok(Result.isSuccess(failed));
        assert.equal(failed.success.isError, true);
        assert.equal(firstText(failed), "Team not found.");
        assert.deepEqual(heard.calls, [
          { name: "list_issues", arguments: { team: "ENG" } },
          { name: "create_issue", arguments: { title: "Invite emails bounce" } },
          { name: "fail", arguments: {} },
        ]);
        assert.ok(heard.bearers.every((each) => each === `Bearer ${linearTokenOf(member.userId)}`));
      }),
  );

  it.effect(
    "a call of a connection the member has not connected is refused as requiring sign-in, and reaches no provider",
    () =>
      Effect.gen(function* () {
        const member = yield* memberWithLinear;
        const heard = hearing();
        const services = doorServices(linearTokenOf(member.userId), heard, []);

        const called = yield* callConnectionTool(member.admitted, NOTION, "notion-search", {}).pipe(
          Effect.provide(services),
        );

        assert.deepEqual(
          called,
          Result.fail({
            status: "rejected",
            error: integrationUnavailable(NOTION).NOT_CONNECTED,
            connection: NOTION,
            requiresSignIn: true,
          }),
        );
        assert.deepEqual(heard.bearers, []);
      }),
  );

  it.effect(
    "a connection switched off for the agent lists no tools and refuses a call, and a tool the server lists none of is refused",
    () =>
      Effect.gen(function* () {
        const member = yield* memberWithLinear;
        const heard = hearing();
        const services = doorServices(linearTokenOf(member.userId), heard, []);

        const unknown = yield* callConnectionTool(member.admitted, LINEAR, "list_issue", {}).pipe(
          Effect.provide(services),
        );
        yield* updateCodingAgentServers(member.userId, member.agentId, [LINEAR]);
        const bearersBefore = heard.bearers.length;
        const listed = yield* listConnectionTools(member.admitted, LINEAR).pipe(
          Effect.provide(services),
        );
        const switchedOff = yield* callConnectionTool(member.admitted, LINEAR, "list_issues", {
          team: "ENG",
        }).pipe(Effect.provide(services));

        assert.deepEqual(
          unknown,
          Result.fail({
            status: "rejected",
            error: 'Connection "linear" has no tool named "list_issue".',
          }),
        );
        assert.deepEqual(listed, []);
        assert.deepEqual(
          switchedOff,
          Result.fail({
            status: "rejected",
            error: 'Connection "linear" is not available to this agent.',
          }),
        );
        assert.equal(heard.bearers.length, bearersBefore);
      }),
  );

  it.effect(
    "a connection switched off but mentioned to the agent is handed to the native turn that starts next, and to that turn alone, as an eve turn takes its mentions",
    () =>
      Effect.gen(function* () {
        const member = yield* memberWithLinear;
        const services = doorServices(linearTokenOf(member.userId), hearing(), []);
        const listIssues = callConnectionTool(member.admitted, LINEAR, "list_issues", {
          team: "ENG",
        }).pipe(Effect.provide(services));
        yield* updateCodingAgentServers(member.userId, member.agentId, [LINEAR]);
        // The developer's message mentions @Linear, which its hand-over writes on the agent's row.
        yield* dispatchMentioningServers(
          member.userId,
          member.agentId,
          [LINEAR],
          Effect.succeed(true),
        );

        const beforeTheTurn = yield* listIssues;
        yield* postEvents(member.bearer, [
          { sequence: 0, message: { type: RUNNER_EVENT.ACCEPTED, uuid: randomUUID() } },
        ]);
        const inTheTurn = yield* listIssues;
        yield* postEvents(member.bearer, [
          { sequence: 1, message: { type: RUNNER_EVENT.END, reason: RUNNER_END.TURN_ENDED } },
          { sequence: 2, message: { type: RUNNER_EVENT.ACCEPTED, uuid: randomUUID() } },
        ]);
        const inTheNextTurn = yield* listIssues;
        // A turn that starts and ends within one batch takes its own mentions, never the next turn's.
        yield* dispatchMentioningServers(
          member.userId,
          member.agentId,
          [LINEAR],
          Effect.succeed(true),
        );
        yield* postEvents(member.bearer, [
          { sequence: 3, message: { type: RUNNER_EVENT.END, reason: RUNNER_END.TURN_ENDED } },
          { sequence: 4, message: { type: RUNNER_EVENT.ACCEPTED, uuid: randomUUID() } },
          { sequence: 5, message: { type: RUNNER_EVENT.END, reason: RUNNER_END.TURN_ENDED } },
          { sequence: 6, message: { type: RUNNER_EVENT.ACCEPTED, uuid: randomUUID() } },
        ]);
        const afterABatchedTurn = yield* listIssues;

        assert.ok(Result.isFailure(beforeTheTurn));
        assert.ok(Result.isSuccess(inTheTurn));
        assert.ok(Result.isFailure(inTheNextTurn));
        assert.ok(Result.isFailure(afterABatchedTurn));
      }),
  );

  it.effect(
    "a provider that never answers costs its server its tools once the bound passes, with one log line",
    () =>
      Effect.gen(function* () {
        const member = yield* memberWithLinear;
        const logged: string[] = [];
        const services = Layer.mergeAll(
          NO_GITHUB,
          LINEAR_AND_NOTION_CONNECT,
          SILENT_LINEAR,
          Logger.layer([Logger.make(({ message }) => logged.push(JSON.stringify(message)))]),
        );

        const listing = yield* Effect.forkChild(
          listConnectionTools(member.admitted, LINEAR).pipe(Effect.provide(services)),
        );
        yield* TestClock.adjust(Duration.seconds(10));
        const listed = yield* Fiber.join(listing);

        assert.deepEqual(listed, []);
        assert.equal(
          logged.filter((line) => line.includes("integration server linear lists no tools")).length,
          1,
        );
      }),
  );

  it.effect(
    "a provider that refuses the grant, echoing it, is refused in words and log lines that carry no token",
    () =>
      Effect.gen(function* () {
        const member = yield* memberWithLinear;
        const token = linearTokenOf(member.userId);
        const logged: string[] = [];
        // Linear's server here admits another bearer, so it refuses the member's, echoing it.
        const services = doorServices("another-bearer", hearing(), logged);

        const listed = yield* listConnectionTools(member.admitted, LINEAR).pipe(
          Effect.provide(services),
        );
        const called = yield* callConnectionTool(member.admitted, LINEAR, "list_issues", {}).pipe(
          Effect.provide(services),
        );

        assert.deepEqual(listed, []);
        assert.deepEqual(
          called,
          Result.fail({
            status: "rejected",
            error:
              'Authorization failed for "linear": the service refused the connection\'s credential.',
          }),
        );
        for (const said of [JSON.stringify(called), ...logged]) {
          assert.ok(!said.includes(token), said);
          assert.ok(!said.includes(token.slice(0, 16)), said);
        }
      }),
  );
  it.effect(
    "a launch lists every connected integration's kept tools without reading a token, and a call reads one and keeps what the provider lists now",
    () =>
      Effect.gen(function* () {
        const member = yield* memberWithLinear;
        yield* beginIntegrationSignIn(
          member.userId,
          firstIntegrationAccount(member.userId, NOTION),
          `state-notion-${member.userId}`,
        );
        yield* completeIntegrationSignIn(member.userId, NOTION, `state-notion-${member.userId}`);
        const listedAt = yield* DateTime.nowAsDate;
        const kept = (provider: typeof LINEAR | typeof NOTION, names: readonly string[]) =>
          storeTools(
            {
              holder: INTEGRATION_GRANT_HOLDER.ACCOUNT,
              provider,
              userId: member.userId,
              connectionName: provider,
              connectSubject: member.userId,
            },
            names.map((name) => ({ name })),
            listedAt,
          );
        yield* kept(LINEAR, ["list_issues"]);
        yield* kept(NOTION, ["notion-search"]);
        const asked: ConnectAsked = { reads: [], evicted: [] };
        const token = linearTokenOf(member.userId);
        const services = Layer.mergeAll(
          NO_GITHUB,
          cachingConnect(token, token, asked),
          linearServer(token, hearing()),
        );

        const launched = yield* launch(member.admitted).pipe(Effect.provide(services));
        const readsAtLaunch = asked.reads.length;
        const called = yield* callConnectionTool(member.admitted, LINEAR, "list_issues", {
          team: "ENG",
        }).pipe(Effect.provide(services));
        const relaunched = yield* launch(member.admitted).pipe(Effect.provide(services));

        assert.deepEqual([launched.linear, launched.notion], [["list_issues"], ["notion-search"]]);
        assert.equal(readsAtLaunch, 0);
        assert.ok(Result.isSuccess(called));
        assert.deepEqual(asked.reads, [member.userId]);
        assert.deepEqual(
          [relaunched.linear, relaunched.notion],
          [["list_issues", "create_issue", "fail", "draw", "attach"], ["notion-search"]],
        );
      }),
  );

  it.effect(
    "an integration with no kept list is listed live and kept, and listed live again once the list is a week old",
    () =>
      Effect.gen(function* () {
        const member = yield* memberWithLinear;
        const asked: ConnectAsked = { reads: [], evicted: [] };
        const token = linearTokenOf(member.userId);
        const services = Layer.mergeAll(
          NO_GITHUB,
          cachingConnect(token, token, asked),
          linearServer(token, hearing()),
        );
        const list = listConnectionTools(member.admitted, LINEAR).pipe(Effect.provide(services));

        const first = yield* list;
        const again = yield* list;
        const readsWithinTheWeek = asked.reads.length;
        yield* TestClock.adjust(Duration.days(7));
        yield* list;

        assert.equal(first.length, 5);
        assert.deepEqual(again, first);
        assert.equal(readsWithinTheWeek, 1);
        assert.equal(asked.reads.length, 2);
      }),
  );

  it.effect(
    "a token the provider refuses is evicted from Connect's cache and the call made once more, and a second refusal is the answer",
    () =>
      Effect.gen(function* () {
        const member = yield* memberWithLinear;
        const token = linearTokenOf(member.userId);
        const callOn = (connect: ReturnType<typeof cachingConnect>) =>
          callConnectionTool(member.admitted, LINEAR, "list_issues", { team: "ENG" }).pipe(
            Effect.provide(Layer.mergeAll(NO_GITHUB, connect, linearServer(token, hearing()))),
          );
        const stale: ConnectAsked = { reads: [], evicted: [] };
        const revoked: ConnectAsked = { reads: [], evicted: [] };

        const recovered = yield* callOn(cachingConnect("lin_oauth_stale", token, stale));
        const refused = yield* callOn(
          cachingConnect("lin_oauth_stale", "lin_oauth_revoked", revoked),
        );

        assert.equal(firstText(recovered), JSON.stringify({ issues: [{ id: "LIN-1" }] }));
        assert.deepEqual(stale, {
          reads: [member.userId, member.userId],
          evicted: [member.userId],
        });
        assert.deepEqual(
          refused,
          Result.fail({
            status: "rejected",
            error:
              'Authorization failed for "linear": the service refused the connection\'s credential.',
          }),
        );
        assert.deepEqual(revoked, {
          reads: [member.userId, member.userId],
          evicted: [member.userId],
        });
      }),
  );

  it.effect(
    "a call the provider refuses still keeps the tools its session listed, and is refused as before",
    () =>
      Effect.gen(function* () {
        const member = yield* memberWithLinear;
        const services = doorServices(linearTokenOf(member.userId), hearing(), []);
        yield* storeTools(
          {
            holder: INTEGRATION_GRANT_HOLDER.ACCOUNT,
            provider: LINEAR,
            userId: member.userId,
            connectionName: LINEAR,
            connectSubject: member.userId,
          },
          [{ name: "list_issues" }],
          yield* DateTime.nowAsDate,
        );

        const refused = yield* callConnectionTool(member.admitted, LINEAR, "list_issues", {
          team: REJECTED_TEAM,
        }).pipe(Effect.provide(services));
        const listed = yield* listConnectionTools(member.admitted, LINEAR).pipe(
          Effect.provide(services),
        );

        assert.ok(Result.isFailure(refused));
        assert.ok(refused.failure.error.startsWith('Failed to call a tool of "linear"'));
        assert.deepEqual(
          listed.map((tool) => tool.name),
          ["list_issues", "create_issue", "fail", "draw", "attach"],
        );
      }),
  );

  it.effect(
    "a provider that lists no tools for a moment is listed live again at the next listing, never kept empty",
    () =>
      Effect.gen(function* () {
        const member = yield* memberWithLinear;
        const asked: ConnectAsked = { reads: [], evicted: [] };
        const token = linearTokenOf(member.userId);
        const list = listConnectionTools(member.admitted, LINEAR).pipe(
          Effect.provide(
            Layer.mergeAll(
              NO_GITHUB,
              cachingConnect(token, token, asked),
              linearServer(token, hearing(), []),
            ),
          ),
        );

        const first = yield* list;
        const again = yield* list;

        assert.deepEqual([first, again], [[], []]);
        assert.equal(asked.reads.length, 2);
      }),
  );
});
