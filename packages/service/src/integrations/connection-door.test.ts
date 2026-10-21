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
import { Clock, Effect, Layer, Logger, Option, Redacted } from "effect";
import { HttpRouter } from "effect/http";
import { SqlClient } from "effect/sql";
import { admitRunnerBearer, runnerTokenDigest } from "../agents/luke-mcp/bearer.js";
import { RUNNER_EVENTS_PATH, runnerEventsApp } from "../agents/native-events/runner-events-app.js";
import { NO_GITHUB } from "../testing/github-app-fake.js";
import { firstIntegrationAccount } from "../testing/integration-connect.js";
import {
  type Heard,
  LINEAR_AND_NOTION_CONNECT,
  linearServer,
  linearTokenOf,
} from "../testing/integration-mcp-fake.js";
import { runConnectionExecute, runConnectionSearch } from "./connection-door.js";
import { beginIntegrationSignIn, completeIntegrationSignIn } from "./integration-store.js";
import { integrationUnavailable } from "./integration-token.js";

/**
 * A native agent's `connection_search` and `connection_execute`, run through
 * their door over the real store on PGlite, against Linear's MCP server as a
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
  yield* beginIntegrationSignIn(
    userId,
    firstIntegrationAccount(userId, LINEAR),
    `state-${userId}`,
    Redacted.make("connect-verifier"),
  );
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

it.layer(getTestDB())("the integrations' door", (it) => {
  it.effect(
    "a search lists the connected integration's tools with their signatures, and the ones the member has not connected as requiring sign-in",
    () =>
      Effect.gen(function* () {
        const member = yield* memberWithLinear;
        const heard = hearing();
        const logged: string[] = [];

        const found = yield* runConnectionSearch(member.admitted, {}).pipe(
          Effect.provide(doorServices(linearTokenOf(member.userId), heard, logged)),
        );

        assert.ok("tools" in found);
        assert.equal(found.total, 5);
        assert.deepEqual(
          found.tools.find((tool) => tool.tool === "list_issues"),
          {
            connection: "linear",
            description: "List issues in the workspace.",
            signature:
              "list_issues(input: { team: string /* The team's key */; limit?: number /* How many; minimum: 1 */ }): Promise<unknown>",
            tool: "list_issues",
          },
        );
        assert.equal(
          found.tools.find((tool) => tool.tool === "create_issue")?.signature,
          "create_issue(input: { title: string; priority?: 1 | 2 | 3 }): Promise<{ id?: string }>",
        );
        assert.deepEqual(
          found.unavailable?.find((each) => each.connection === NOTION),
          {
            connection: NOTION,
            error: integrationUnavailable(NOTION).NOT_CONNECTED,
            requiresSignIn: true,
          },
        );
        assert.equal(
          found.unavailable?.find((each) => each.connection === INTEGRATION_PROVIDER.GITHUB)
            ?.requiresSignIn,
          true,
        );
        assert.deepEqual(heard.bearers.length > 0, true);
      }),
  );

  it.effect("a search's words rank the tools that match them first, and page them", () =>
    Effect.gen(function* () {
      const member = yield* memberWithLinear;
      const services = doorServices(linearTokenOf(member.userId), hearing(), []);

      const ranked = yield* runConnectionSearch(member.admitted, {
        query: "create issue",
        connection: LINEAR,
      }).pipe(Effect.provide(services));
      const paged = yield* runConnectionSearch(member.admitted, {
        connection: LINEAR,
        limit: 1,
        offset: 1,
      }).pipe(Effect.provide(services));

      assert.ok("tools" in ranked && "tools" in paged);
      // Every Linear tool matches the connection's own words; the tools named by them come first.
      assert.deepEqual(
        ranked.tools.slice(0, 2).map((tool) => tool.tool),
        ["create_issue", "list_issues"],
      );
      assert.equal(ranked.unavailable, undefined);
      assert.deepEqual(
        paged.tools.map((tool) => tool.tool),
        ["create_issue"],
      );
      assert.equal(paged.total, 5);
    }),
  );

  it.effect(
    "an execute calls the tool on the member's own grant with its input and answers its result",
    () =>
      Effect.gen(function* () {
        const member = yield* memberWithLinear;
        const heard = hearing();
        const services = doorServices(linearTokenOf(member.userId), heard, []);

        const listed = yield* runConnectionExecute(member.admitted, {
          connection: LINEAR,
          tool: "list_issues",
          input: { team: "ENG" },
        }).pipe(Effect.provide(services));
        const created = yield* runConnectionExecute(member.admitted, {
          connection: LINEAR,
          tool: "create_issue",
          input: { title: "Invite emails bounce" },
        }).pipe(Effect.provide(services));
        const drawn = yield* runConnectionExecute(member.admitted, {
          connection: LINEAR,
          tool: "draw",
        }).pipe(Effect.provide(services));

        assert.deepEqual(listed, { status: "accepted", output: { issues: [{ id: "LIN-1" }] } });
        assert.deepEqual(created, { status: "accepted", output: { id: "LIN-2" } });
        assert.deepEqual(drawn, {
          status: "accepted",
          output: [
            { type: "text", text: "A chart:" },
            { type: "image", data: "iVBORw0KGgo=", mimeType: "image/png" },
          ],
        });
        assert.deepEqual(heard.calls, [
          { name: "list_issues", arguments: { team: "ENG" } },
          { name: "create_issue", arguments: { title: "Invite emails bounce" } },
          { name: "draw", arguments: {} },
        ]);
      }),
  );

  it.effect(
    "a connection the member has not connected is refused as requiring sign-in, and a search that asks to sign in starts none",
    () =>
      Effect.gen(function* () {
        const member = yield* memberWithLinear;
        const heard = hearing();
        const services = doorServices(linearTokenOf(member.userId), heard, []);

        const executed = yield* runConnectionExecute(member.admitted, {
          connection: NOTION,
          tool: "notion-search",
        }).pipe(Effect.provide(services));
        const signIn = yield* runConnectionSearch(member.admitted, {
          connection: NOTION,
          signIn: true,
        }).pipe(Effect.provide(services));

        const refusal = {
          status: "rejected",
          error: integrationUnavailable(NOTION).NOT_CONNECTED,
          connection: NOTION,
          requiresSignIn: true,
        };
        assert.deepEqual(executed, refusal);
        assert.deepEqual(signIn, refusal);
        assert.deepEqual(heard.bearers, []);
      }),
  );

  it.effect(
    "a connection switched off for the agent, a tool the server lists none of, and the tool's own error are each refused",
    () =>
      Effect.gen(function* () {
        const member = yield* memberWithLinear;
        const services = doorServices(linearTokenOf(member.userId), hearing(), []);

        const unknown = yield* runConnectionExecute(member.admitted, {
          connection: LINEAR,
          tool: "list_issue",
        }).pipe(Effect.provide(services));
        const failed = yield* runConnectionExecute(member.admitted, {
          connection: LINEAR,
          tool: "fail",
        }).pipe(Effect.provide(services));
        yield* updateCodingAgentServers(member.userId, member.agentId, [LINEAR]);
        const switchedOff = yield* runConnectionExecute(member.admitted, {
          connection: LINEAR,
          tool: "list_issues",
          input: { team: "ENG" },
        }).pipe(Effect.provide(services));

        assert.deepEqual(unknown, {
          status: "rejected",
          error:
            'Connection "linear" has no tool named "list_issue". Closest tools: list_issues, create_issue.',
        });
        assert.deepEqual(failed, { status: "rejected", error: "Team not found." });
        assert.equal(switchedOff.status, "rejected");
        assert.ok(
          "error" in switchedOff &&
            switchedOff.error.startsWith('Connection "linear" is not available.'),
        );
      }),
  );

  it.effect(
    "a connection switched off but mentioned to the agent is handed to the native turn that starts next, and to that turn alone, as an eve turn takes its mentions",
    () =>
      Effect.gen(function* () {
        const member = yield* memberWithLinear;
        const services = doorServices(linearTokenOf(member.userId), hearing(), []);
        const listIssues = runConnectionExecute(member.admitted, {
          connection: LINEAR,
          tool: "list_issues",
          input: { team: "ENG" },
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

        assert.equal(beforeTheTurn.status, "rejected");
        assert.notEqual(inTheTurn.status, "rejected");
        assert.equal(inTheNextTurn.status, "rejected");
        assert.equal(afterABatchedTurn.status, "rejected");
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

        const found = yield* runConnectionSearch(member.admitted, { connection: LINEAR }).pipe(
          Effect.provide(services),
        );
        const executed = yield* runConnectionExecute(member.admitted, {
          connection: LINEAR,
          tool: "list_issues",
        }).pipe(Effect.provide(services));

        assert.deepEqual(found, {
          status: "rejected",
          error:
            'Authorization failed for "linear": the service refused the connection\'s credential.',
        });
        assert.equal(executed.status, "rejected");
        for (const said of [JSON.stringify(found), JSON.stringify(executed), ...logged]) {
          assert.ok(!said.includes(token), said);
          assert.ok(!said.includes(token.slice(0, 16)), said);
        }
      }),
  );
});
