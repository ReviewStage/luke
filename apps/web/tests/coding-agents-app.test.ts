import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { HOSTED_API_ERROR } from "@sidecar/hosted";
import {
  awaitedDeliveryOf,
  CODING_AGENT_BOUNDS,
  CODING_AGENT_DELIVERY,
  CODING_AGENT_STATUS,
  type CodingAgentMessage,
  codingAgentAnswerSchema,
  codingAgentListAnswerSchema,
  codingAgentMessagesAnswerSchema,
} from "@sidecar/hosted/coding-agent-wire";
import { type CatalogModel, MODEL_PROVIDER } from "@sidecar/hosted/models-wire";
import { planMarkdown } from "@sidecar/hosted/plan-markdown";
import { unparsedWire, type WireBoundaryInput } from "@sidecar/wire";
import { readEither } from "@sidecar/wire/effect";
import {
  Clock,
  Duration,
  Effect,
  Fiber,
  Layer,
  Option,
  Redacted,
  Result,
  type Schema,
} from "effect";
import { TestClock } from "effect/testing";
import { HttpRouter } from "effect/unstable/http";
import { SqlClient } from "effect/unstable/sql";
import { codingAgentsApp } from "../server/coding-agents-app";
import {
  BRAIN_REQUEST_STATUS,
  BRAIN_RUN_EVENT,
  BRAIN_TURN_ORIGIN,
  BRAIN_TURN_TRIGGER,
  MESSAGE_ROLE,
  sessionKey,
  TURN_ORIGIN,
  userMessage,
  userMetadataOf,
} from "../server/core";
import { readAccountPreferences, writeAccountPreferences } from "../server/hosted/account-store";
import { BRAIN_HOST_TURN } from "../server/hosted/brain-host/bounds";
import {
  EVE_CANCEL_OUTCOME,
  EVE_SEND_OUTCOME,
  type EveMessage,
  type EveSessions,
  EveUnreachable,
} from "../server/hosted/brain-host/eve-sessions";
import { claimRuntimeSession } from "../server/hosted/brain-host/recorded-session";
import { CODER } from "../server/hosted/coder-host/bounds";
import { CODER_TOOL_SET } from "../server/hosted/coder-host/tool-set";
import {
  createCodingAgent,
  listCodingAgents,
  readCodingAgent,
} from "../server/hosted/coding-agent-store";
import { HOSTED_HTTP_STATUS } from "../server/hosted/http";
import { CODING_AGENT_DEFAULT_CHOICE, modelCatalogOf } from "../server/hosted/model-catalog";
import { createPlan, savePlanDocument } from "../server/hosted/plan-store";
import { storeWriter } from "../server/hosted/store";
import { type FakeGitHub, githubReaching, openGithubUser } from "./support/github-app-fake";
import { testSqlClient } from "./support/sql-client";

/**
 * The coding-agent routes, answered by the group the way a function answers
 * them, over a real dialect: a Start is one agent whose eve session opens
 * with the plan as its first message, a retry under the same key is that
 * agent and opens nothing again, the list reads each agent's status from its
 * newest turn, the transcript answers the conversation's rows past a cursor,
 * and a Stop is eve's cancel of the turn under way and the row's stamp. eve
 * is a fake at the client's boundary, GitHub a script, the catalog fixed,
 * and the store PGlite. Synthetic accounts, bearers, plans, and words
 * throughout.
 */

const ORIGIN = "https://luke.test";
const PLAN_AGENTS = "/api/plans/agents";
const AGENT_MESSAGES = "/api/agents/messages";
const AGENT_STOP = "/api/agents/stop";

const RELAY = { owner: "Acme", name: "Relay" } as const;
const RELAY_FULL_NAME = `${RELAY.owner}/${RELAY.name}`;
const INSTALLATION = { id: 7, login: RELAY.owner, repositories: [RELAY] } as const;

const SAVED = {
  body: "# Teammate invitations\n\n## Goal\n\nInvite a teammate by email.\n",
  assumptions: [{ text: "Invites expire after 7 days." }],
};

const CATALOG: readonly CatalogModel[] = [
  {
    id: CODING_AGENT_DEFAULT_CHOICE.model,
    name: "Claude Opus 5.5",
    provider: MODEL_PROVIDER.ANTHROPIC,
    efforts: ["low", "medium", "high", "max"],
  },
  {
    id: "openai/gpt-6.1-sol",
    name: "GPT-6.1 Sol",
    provider: MODEL_PROVIDER.OPENAI,
    efforts: ["low", "high"],
  },
];

interface Answer {
  readonly status: number;
  readonly body: WireBoundaryInput;
}

/** One session opened, as the fake eve saw it. */
interface Opened {
  readonly authorization: string;
  readonly message: EveMessage;
  readonly sessionId: string;
}

/** One follow-up handed to a session, as the fake eve saw it. */
interface Sent {
  readonly authorization: string;
  readonly sessionId: string;
  readonly message: EveMessage;
}

/** How the fake eve answers a follow-up: accepted with a delivery of its own, or one of the refusals the client reads. */
type SendAnswer =
  | typeof EVE_SEND_OUTCOME.ACCEPTED
  | typeof EVE_SEND_OUTCOME.NOT_READY
  | typeof EVE_SEND_OUTCOME.RETIRED
  | typeof EVE_SEND_OUTCOME.FAILED;

/** eve as the group reaches it, answering from a script and writing down every open, send, and cancel. */
function fakeEve(
  options: {
    readonly reachable?: boolean;
    readonly cancels?: boolean;
    readonly sends?: SendAnswer;
  } = {},
) {
  const opened: Opened[] = [];
  const sent: Sent[] = [];
  const cancelled: (readonly [string, string])[] = [];
  let sessions = 0;
  let deliveries = 0;
  const eve = (authorization: string): EveSessions => ({
    open: (message) =>
      Effect.suspend(() => {
        if (options.reachable === false) {
          return Effect.fail(
            new EveUnreachable({
              // SAFETY: the client's own error shape, built by the fake at the transport it stands for.
              cause: {
                _tag: "RequestError",
                reason: { _tag: "TransportError" },
                message: "refused",
              } as never,
            }),
          );
        }
        sessions += 1;
        const sessionId = `wrun_01M${String(sessions).padStart(22, "0")}`;
        opened.push({ authorization, message, sessionId });
        return Effect.succeed({ outcome: EVE_SEND_OUTCOME.ACCEPTED, sessionId });
      }),
    send: (sessionId, message) =>
      Effect.sync(() => {
        sent.push({ authorization, sessionId, message });
        switch (options.sends ?? EVE_SEND_OUTCOME.ACCEPTED) {
          case EVE_SEND_OUTCOME.ACCEPTED:
            deliveries += 1;
            return {
              outcome: EVE_SEND_OUTCOME.ACCEPTED,
              sessionId,
              deliveryId: `delivery-${deliveries}`,
            };
          case EVE_SEND_OUTCOME.NOT_READY:
            return { outcome: EVE_SEND_OUTCOME.NOT_READY };
          case EVE_SEND_OUTCOME.RETIRED:
            return { outcome: EVE_SEND_OUTCOME.RETIRED };
          case EVE_SEND_OUTCOME.FAILED:
            return { outcome: EVE_SEND_OUTCOME.FAILED, status: 500 };
        }
      }),
    cancel: (sessionId, eveTurnId) =>
      Effect.sync(() => {
        cancelled.push([sessionId, eveTurnId]);
        return options.cancels === false
          ? { outcome: EVE_CANCEL_OUTCOME.FAILED, status: 403 }
          : { outcome: EVE_CANCEL_OUTCOME.ACCEPTED };
      }),
  });
  return { eve, opened, sent, cancelled };
}

/** The group over the test's own database, GitHub, and eve, answering one request. */
const answer = (
  bearers: ReadonlyMap<string, string>,
  github: FakeGitHub,
  eve: ReturnType<typeof fakeEve>,
  request: Request,
) =>
  Effect.gen(function* () {
    const client = yield* SqlClient.SqlClient;
    const services = Layer.mergeAll(
      Layer.succeed(SqlClient.SqlClient, client),
      Layer.succeed(Clock.Clock, yield* Clock.Clock),
      github.layer,
      modelCatalogOf(CATALOG),
    );
    const { handler, dispose } = HttpRouter.toWebHandler(
      codingAgentsApp({
        resolveUserId: (incoming) =>
          Effect.succeed(
            Option.fromNullishOr(bearers.get(incoming.headers.get("authorization") ?? "")),
          ),
        eveOrigin: () => ORIGIN,
        eve: (authorization) => eve.eve(Redacted.value(authorization)),
      }).pipe(HttpRouter.provideRequest(services)),
      { disableLogger: true },
    );
    const response = yield* Effect.promise(() => handler(request));
    const text = yield* Effect.promise(() => response.text());
    yield* Effect.promise(() => dispose());
    // SAFETY: the group answers JSON; the test compares it as the wire value it is, and an answer
    // with no body is compared as its text so a failure names what came back.
    const body = (text.length === 0 ? text : JSON.parse(text)) as WireBoundaryInput;
    return { status: response.status, body } satisfies Answer;
  });

function request(
  path: string,
  bearer: string | undefined,
  init: { method?: string; body?: WireBoundaryInput; id?: string; after?: string } = {},
): Request {
  const url = new URL(path, ORIGIN);
  if (init.id !== undefined) url.searchParams.set("id", init.id);
  if (init.after !== undefined) url.searchParams.set("after", init.after);
  return new Request(url, {
    method: init.method ?? "GET",
    headers: bearer === undefined ? {} : { authorization: `Bearer ${bearer}` },
    ...(init.body === undefined ? undefined : { body: JSON.stringify(init.body) }),
  });
}

/** An answer read as the wire declares it, failing the test where it is not one. */
function readAnswer<S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  status: number,
  answered: Answer,
): S["Type"] {
  assert.equal(answered.status, status, JSON.stringify(answered.body));
  const read = readEither(schema)(unparsedWire(answered.body));
  if (Result.isFailure(read))
    return assert.fail(`the answer is not the wire's: ${read.failure.refusal}`);
  return read.success;
}

const refusal = (status: number, error: string): Answer => ({ status, body: { error } });

/** A forked ask driven to its answer, the clock moved a step at a time so each wait it holds elapses. */
const driven = <A, E>(fiber: Fiber.Fiber<A, E>, step: Duration.Duration) =>
  Effect.gen(function* () {
    for (let attempt = 0; attempt < 1_000; attempt += 1) {
      if (fiber.pollUnsafe() !== undefined) return yield* Fiber.join(fiber);
      yield* TestClock.adjust(step);
      yield* Effect.yieldNow;
    }
    return yield* Fiber.join(fiber);
  });

/**
 * An owner who signed in with GitHub and holds one plan on the repository,
 * another account beside them, and the group over a GitHub reaching the
 * repository and the eve given.
 */
const openPlan = (
  options: { readonly repository?: string | null; readonly eve?: ReturnType<typeof fakeEve> } = {},
) =>
  Effect.gen(function* () {
    const owner = yield* openGithubUser();
    const other = yield* openGithubUser();
    const plan = yield* createPlan(owner, {
      name: "Teammate invitations",
      repository: options.repository === undefined ? RELAY_FULL_NAME : options.repository,
    });
    yield* savePlanDocument(owner, plan.id, SAVED);
    const bearers = new Map([
      [`Bearer ${owner}`, owner],
      [`Bearer ${other}`, other],
    ]);
    const github = githubReaching([INSTALLATION]);
    const eve = options.eve ?? fakeEve();
    const ask = (incoming: Request) => answer(bearers, github, eve, incoming);
    return { owner, other, plan, eve, ask };
  });

it.layer(testSqlClient)("the coding-agent routes", (it) => {
  it.effect(
    "a Start with no choice runs on the account's default, snapshots the plan as Copy would, and opens the session as the developer with the snapshot first",
    () =>
      Effect.gen(function* () {
        const { owner, plan, eve, ask } = yield* openPlan();
        const key = randomUUID();

        const started = yield* ask(
          request(PLAN_AGENTS, owner, {
            method: "POST",
            id: plan.id,
            body: { idempotencyKey: key },
          }),
        );

        const { agent } = readAnswer(codingAgentAnswerSchema, HOSTED_HTTP_STATUS.CREATED, started);
        assert.equal(agent.planId, plan.id);
        assert.equal(agent.model, CODING_AGENT_DEFAULT_CHOICE.model);
        assert.equal(agent.effort, CODING_AGENT_DEFAULT_CHOICE.effort);
        assert.equal(agent.status, CODING_AGENT_STATUS.STARTING);
        const stored = yield* readCodingAgent(owner, agent.id);
        assert.ok(Option.isSome(stored));
        assert.equal(stored.value.planSnapshot, planMarkdown(SAVED));
        assert.equal(stored.value.repository, RELAY_FULL_NAME);
        assert.deepEqual(eve.opened, [
          {
            authorization: `Bearer ${owner}`,
            message: {
              conversationId: stored.value.conversationId,
              turn: BRAIN_HOST_TURN.TYPED,
              message: planMarkdown(SAVED),
            },
            sessionId: eve.opened[0]?.sessionId ?? "",
          },
        ]);
        // The default stands: nothing was chosen.
        assert.equal(yield* readAccountPreferences(owner), undefined);
      }),
  );

  it.effect(
    "a Start naming a model and effort runs on them and makes them the account's default",
    () =>
      Effect.gen(function* () {
        const { owner, plan, ask } = yield* openPlan();
        const started = yield* ask(
          request(PLAN_AGENTS, owner, {
            method: "POST",
            id: plan.id,
            body: { idempotencyKey: randomUUID(), model: "openai/gpt-6.1-sol", effort: "low" },
          }),
        );
        const { agent } = readAnswer(codingAgentAnswerSchema, HOSTED_HTTP_STATUS.CREATED, started);
        assert.equal(agent.model, "openai/gpt-6.1-sol");
        assert.equal(agent.effort, "low");
        assert.deepEqual((yield* readAccountPreferences(owner))?.codingAgent, {
          model: "openai/gpt-6.1-sol",
          effort: "low",
        });
      }),
  );

  it.effect("a retry under the same key is the same agent, and opens no second session", () =>
    Effect.gen(function* () {
      const { owner, plan, eve, ask } = yield* openPlan();
      const key = randomUUID();
      const first = yield* ask(startAs(owner, plan.id, { idempotencyKey: key }));
      const again = yield* ask(
        startAs(owner, plan.id, {
          idempotencyKey: key,
          model: "openai/gpt-6.1-sol",
          effort: "high",
        }),
      );
      const one = readAnswer(codingAgentAnswerSchema, HOSTED_HTTP_STATUS.CREATED, first);
      const same = readAnswer(codingAgentAnswerSchema, HOSTED_HTTP_STATUS.OK, again);
      assert.equal(same.agent.id, one.agent.id);
      assert.equal(same.agent.model, one.agent.model);
      assert.equal(eve.opened.length, 1);
      assert.equal((yield* listCodingAgents(owner, plan.id)).length, 1);
    }),
  );

  it.effect(
    "a Start is refused by name: a model outside the catalog or a stored default that left it, a model without its effort, a plan with no repository, one the developer no longer reaches, another account's plan, and no bearer",
    () =>
      Effect.gen(function* () {
        const { owner, other, plan, eve, ask } = yield* openPlan();
        const invalid = refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);
        assert.deepEqual(
          yield* ask(
            startAs(owner, plan.id, {
              idempotencyKey: randomUUID(),
              model: "google/gemini-3",
              effort: "high",
            }),
          ),
          invalid,
        );
        assert.deepEqual(
          yield* ask(
            startAs(owner, plan.id, {
              idempotencyKey: randomUUID(),
              model: CODING_AGENT_DEFAULT_CHOICE.model,
              effort: "none",
            }),
          ),
          invalid,
        );
        assert.deepEqual(
          yield* ask(
            startAs(owner, plan.id, {
              idempotencyKey: randomUUID(),
              model: CODING_AGENT_DEFAULT_CHOICE.model,
            }),
          ),
          invalid,
        );
        // A default the account stored while the catalog offered it, which the catalog no longer does.
        yield* writeAccountPreferences(owner, {
          codingAgent: { model: "openai/gpt-5", effort: "high" },
        });
        assert.deepEqual(
          yield* ask(startAs(owner, plan.id, { idempotencyKey: randomUUID() })),
          invalid,
        );
        yield* writeAccountPreferences(owner, { codingAgent: CODING_AGENT_DEFAULT_CHOICE });

        assert.deepEqual(
          yield* ask(startAs(other, plan.id, { idempotencyKey: randomUUID() })),
          refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND),
        );
        assert.deepEqual(
          yield* ask(startAs(undefined, plan.id, { idempotencyKey: randomUUID() })),
          refusal(HOSTED_HTTP_STATUS.UNAUTHORIZED, HOSTED_API_ERROR.INVALID_TOKEN),
        );
        const unreachable = yield* createPlan(owner, { name: "Ledger", repository: "Acme/Ledger" });
        assert.deepEqual(
          yield* ask(startAs(owner, unreachable.id, { idempotencyKey: randomUUID() })),
          refusal(HOSTED_HTTP_STATUS.FORBIDDEN, HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE),
        );
        const bare = yield* createPlan(owner, { name: "Bare" });
        assert.deepEqual(
          yield* ask(startAs(owner, bare.id, { idempotencyKey: randomUUID() })),
          refusal(HOSTED_HTTP_STATUS.CONFLICT, HOSTED_API_ERROR.NO_REPOSITORY),
        );
        assert.deepEqual(eve.opened, []);
        assert.deepEqual(yield* listCodingAgents(owner, plan.id), []);
      }),
  );

  it.effect(
    "an eve that could not be reached leaves no agent behind, so the retry starts afresh",
    () =>
      Effect.gen(function* () {
        const { owner, plan, ask } = yield* openPlan({ eve: fakeEve({ reachable: false }) });
        const key = randomUUID();
        assert.deepEqual(
          yield* ask(startAs(owner, plan.id, { idempotencyKey: key })),
          refusal(HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE, HOSTED_API_ERROR.UNAVAILABLE),
        );
        assert.deepEqual(yield* listCodingAgents(owner, plan.id), []);
      }),
  );

  it.effect(
    "the list reads each agent's status from its newest turn, in the order started, and is the owner's alone",
    () =>
      Effect.gen(function* () {
        const { owner, other, plan, ask } = yield* openPlan();
        const first = readAnswer(
          codingAgentAnswerSchema,
          HOSTED_HTTP_STATUS.CREATED,
          yield* ask(startAs(owner, plan.id, { idempotencyKey: randomUUID() })),
        ).agent;
        yield* TestClock.adjust(Duration.minutes(1));
        const second = readAnswer(
          codingAgentAnswerSchema,
          HOSTED_HTTP_STATUS.CREATED,
          yield* ask(startAs(owner, plan.id, { idempotencyKey: randomUUID() })),
        ).agent;
        const stored = yield* readCodingAgent(owner, second.id);
        assert.ok(Option.isSome(stored));
        const writer = yield* storeWriter({ tools: CODER_TOOL_SET });
        const target = { userId: owner, conversationId: stored.value.conversationId };
        yield* writer.enqueueTurn(target, { origin: TURN_ORIGIN.TYPED, eveTurnId: "turn_0" });

        const listed = readAnswer(
          codingAgentListAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(PLAN_AGENTS, owner, { id: plan.id })),
        );
        assert.deepEqual(
          listed.agents.map((agent) => [agent.id, agent.status]),
          [
            [first.id, CODING_AGENT_STATUS.STARTING],
            [second.id, CODING_AGENT_STATUS.RUNNING],
          ],
        );
        assert.deepEqual(
          yield* ask(request(PLAN_AGENTS, other, { id: plan.id })),
          refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND),
        );
      }),
  );

  it.effect(
    "the transcript answers the conversation's rows past the cursor, with the cursor to read on from, and a cursor outside its shape is refused",
    () =>
      Effect.gen(function* () {
        const { owner, other, plan, ask } = yield* openPlan();
        const agent = readAnswer(
          codingAgentAnswerSchema,
          HOSTED_HTTP_STATUS.CREATED,
          yield* ask(startAs(owner, plan.id, { idempotencyKey: randomUUID() })),
        ).agent;
        const stored = yield* readCodingAgent(owner, agent.id);
        assert.ok(Option.isSome(stored));
        const target = { userId: owner, conversationId: stored.value.conversationId };
        const writer = yield* storeWriter({ tools: CODER_TOOL_SET });
        const turnId = randomUUID();
        // Before any turn the agent is starting: an empty read is held rather than spinning, and
        // lets go at the hold with the status the page was read at.
        const starting = yield* Effect.forkChild(
          ask(request(AGENT_MESSAGES, owner, { id: agent.id, after: "0:0" })),
        );
        yield* TestClock.adjust(CODER.MESSAGES_POLL);
        assert.equal(starting.pollUnsafe(), undefined);
        yield* TestClock.adjust(CODER.MESSAGES_HOLD);
        const empty = readAnswer(
          codingAgentMessagesAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* driven(starting, CODER.MESSAGES_POLL),
        );
        assert.deepEqual(empty.messages, []);
        assert.equal(empty.status, CODING_AGENT_STATUS.STARTING);
        yield* writer.enqueueTurn(target, {
          turnId,
          origin: TURN_ORIGIN.TYPED,
          eveTurnId: "turn_0",
        });
        yield* writer.consume(target, {
          kind: BRAIN_RUN_EVENT.TURN_STARTED,
          conversationId: sessionKey(target.conversationId),
          turnId,
          sequence: 1,
          origin: BRAIN_TURN_ORIGIN.TYPED,
          trigger: BRAIN_TURN_TRIGGER.ASK,
          at: 0,
        });

        yield* writer.consume(target, {
          kind: BRAIN_RUN_EVENT.MESSAGE_COMPLETED,
          conversationId: sessionKey(target.conversationId),
          turnId,
          sequence: 2,
          message: userMessage(
            randomUUID(),
            planMarkdown(SAVED),
            userMetadataOf(BRAIN_TURN_TRIGGER.ASK, undefined),
          ),
        });

        const page = readAnswer(
          codingAgentMessagesAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(AGENT_MESSAGES, owner, { id: agent.id })),
        );
        assert.equal(page.messages.length, 1);
        assert.equal(page.messages[0]?.role, MESSAGE_ROLE.USER);
        assert.notEqual(page.cursor, "0:0");
        assert.equal(page.status, CODING_AGENT_STATUS.RUNNING);

        assert.deepEqual(
          yield* ask(request(AGENT_MESSAGES, owner, { id: agent.id, after: "later" })),
          refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST),
        );
        assert.deepEqual(
          yield* ask(request(AGENT_MESSAGES, other, { id: agent.id })),
          refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND),
        );
      }),
  );

  it.effect(
    "a Stop cancels the turn under way at eve by its own id and stamps the row, so the agent reads cancelled; an agent with no turn running is answered as it stands, and an eve that refuses leaves no stamp",
    () =>
      Effect.gen(function* () {
        const { owner, other, plan, eve, ask } = yield* openPlan();
        const agent = readAnswer(
          codingAgentAnswerSchema,
          HOSTED_HTTP_STATUS.CREATED,
          yield* ask(startAs(owner, plan.id, { idempotencyKey: randomUUID() })),
        ).agent;
        // Nothing runs yet: the Stop has nothing to stop.
        const starting = readAnswer(
          codingAgentAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(AGENT_STOP, owner, { method: "POST", id: agent.id })),
        );
        assert.equal(starting.agent.status, CODING_AGENT_STATUS.STARTING);
        assert.deepEqual(eve.cancelled, []);

        // The session claimed the conversation and its first turn runs.
        const stored = yield* readCodingAgent(owner, agent.id);
        assert.ok(Option.isSome(stored));
        const target = { userId: owner, conversationId: stored.value.conversationId };
        const sessionId = eve.opened[0]?.sessionId ?? "";
        assert.equal(yield* claimRuntimeSession(target, sessionId, new Date()), true);
        const writer = yield* storeWriter({ tools: CODER_TOOL_SET });
        const turnId = randomUUID();
        yield* writer.enqueueTurn(target, {
          turnId,
          origin: TURN_ORIGIN.TYPED,
          eveTurnId: "turn_0",
        });

        assert.deepEqual(
          yield* ask(request(AGENT_STOP, other, { method: "POST", id: agent.id })),
          refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND),
        );
        const stopped = readAnswer(
          codingAgentAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(AGENT_STOP, owner, { method: "POST", id: agent.id })),
        );
        assert.equal(stopped.agent.status, CODING_AGENT_STATUS.CANCELLED);
        assert.deepEqual(eve.cancelled, [[sessionId, "turn_0"]]);
        // A second Stop finds the stamp standing and asks eve nothing more.
        yield* ask(request(AGENT_STOP, owner, { method: "POST", id: agent.id }));
        assert.equal(eve.cancelled.length, 1);
        const listed = readAnswer(
          codingAgentListAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(PLAN_AGENTS, owner, { id: plan.id })),
        );
        assert.equal(listed.agents[0]?.status, CODING_AGENT_STATUS.CANCELLED);
      }),
  );

  it.effect("a Stop eve refuses is unavailable, and the turn reads as it was", () =>
    Effect.gen(function* () {
      const refusing = fakeEve({ cancels: false });
      const { owner, plan, ask } = yield* openPlan({ eve: refusing });
      const agent = readAnswer(
        codingAgentAnswerSchema,
        HOSTED_HTTP_STATUS.CREATED,
        yield* ask(startAs(owner, plan.id, { idempotencyKey: randomUUID() })),
      ).agent;
      const stored = yield* readCodingAgent(owner, agent.id);
      assert.ok(Option.isSome(stored));
      const target = { userId: owner, conversationId: stored.value.conversationId };
      yield* claimRuntimeSession(target, refusing.opened[0]?.sessionId ?? "", new Date());
      const writer = yield* storeWriter({ tools: CODER_TOOL_SET });
      yield* writer.enqueueTurn(target, { origin: TURN_ORIGIN.TYPED, eveTurnId: "turn_0" });

      assert.deepEqual(
        yield* ask(request(AGENT_STOP, owner, { method: "POST", id: agent.id })),
        refusal(HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE, HOSTED_API_ERROR.UNAVAILABLE),
      );
      const listed = readAnswer(
        codingAgentListAnswerSchema,
        HOSTED_HTTP_STATUS.OK,
        yield* ask(request(PLAN_AGENTS, owner, { id: plan.id })),
      );
      assert.equal(listed.agents[0]?.status, CODING_AGENT_STATUS.RUNNING);
    }),
  );
});

/** A message to the agent as the bearer given, with the body given. */
function messageAs(bearer: string | undefined, agentId: string, body: WireBoundaryInput): Request {
  return request(AGENT_MESSAGES, bearer, { method: "POST", id: agentId, body });
}

/** The user rows of a transcript page, each with the delivery it still awaits, if any. */
function userLines(page: {
  readonly messages: readonly CodingAgentMessage[];
}): readonly (string | undefined)[] {
  return page.messages
    .filter((message) => message.role === MESSAGE_ROLE.USER)
    .map((message) => awaitedDeliveryOf(message));
}

it.layer(testSqlClient)("messaging a coding agent", (it) => {
  /** An agent started on the owner's plan, its session claimed, and its first turn where asked. */
  const startedAgent = (
    eve: ReturnType<typeof fakeEve>,
    turn: { readonly running: boolean } | undefined,
  ) =>
    Effect.gen(function* () {
      const opened = yield* openPlan({ eve });
      const agent = readAnswer(
        codingAgentAnswerSchema,
        HOSTED_HTTP_STATUS.CREATED,
        yield* opened.ask(startAs(opened.owner, opened.plan.id, { idempotencyKey: randomUUID() })),
      ).agent;
      const stored = yield* readCodingAgent(opened.owner, agent.id);
      assert.ok(Option.isSome(stored));
      const target = { userId: opened.owner, conversationId: stored.value.conversationId };
      const sessionId = eve.opened[0]?.sessionId ?? "";
      assert.equal(yield* claimRuntimeSession(target, sessionId, new Date()), true);
      const writer = yield* storeWriter({ tools: CODER_TOOL_SET });
      const turnId = randomUUID();
      if (turn !== undefined) {
        yield* writer.enqueueTurn(target, {
          turnId,
          origin: TURN_ORIGIN.TYPED,
          eveTurnId: "turn_0",
        });
        yield* writer.consume(target, {
          kind: BRAIN_RUN_EVENT.TURN_STARTED,
          conversationId: sessionKey(target.conversationId),
          turnId,
          sequence: 1,
          origin: BRAIN_TURN_ORIGIN.TYPED,
          trigger: BRAIN_TURN_TRIGGER.ASK,
          at: 0,
        });
        yield* writer.consume(target, {
          kind: BRAIN_RUN_EVENT.MESSAGE_COMPLETED,
          conversationId: sessionKey(target.conversationId),
          turnId,
          sequence: 2,
          message: userMessage(
            randomUUID(),
            planMarkdown(SAVED),
            userMetadataOf(BRAIN_TURN_TRIGGER.ASK, undefined),
          ),
        });
        if (!turn.running) {
          yield* writer.consume(target, {
            kind: BRAIN_RUN_EVENT.TURN_ENDED,
            conversationId: sessionKey(target.conversationId),
            turnId,
            sequence: 3,
            status: BRAIN_REQUEST_STATUS.SUCCEEDED,
            responseIds: [],
            at: 0,
          });
        }
      }
      return { ...opened, agent, target, sessionId, writer, turnId };
    });

  it.effect(
    "a message while a turn runs reaches eve under the developer's bearer with the delivery named, shows in the transcript at once as a user line awaiting that delivery, and leaves the agent running",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const { owner, agent, ask, sessionId } = yield* startedAgent(eve, { running: true });
        for (const delivery of [CODING_AGENT_DELIVERY.STEER, CODING_AGENT_DELIVERY.QUEUE]) {
          const answered = readAnswer(
            codingAgentAnswerSchema,
            HOSTED_HTTP_STATUS.ACCEPTED,
            yield* ask(messageAs(owner, agent.id, { text: `  Use ${delivery} here.  `, delivery })),
          );
          assert.equal(answered.agent.status, CODING_AGENT_STATUS.RUNNING);
        }
        assert.deepEqual(
          eve.sent.map((sent) => [sent.authorization, sent.sessionId, sent.message]),
          [
            [
              `Bearer ${owner}`,
              sessionId,
              {
                conversationId: eve.opened[0]?.message.conversationId,
                turn: BRAIN_HOST_TURN.TYPED,
                message: "Use steer here.",
                delivery: CODING_AGENT_DELIVERY.STEER,
              },
            ],
            [
              `Bearer ${owner}`,
              sessionId,
              {
                conversationId: eve.opened[0]?.message.conversationId,
                turn: BRAIN_HOST_TURN.TYPED,
                message: "Use queue here.",
                delivery: CODING_AGENT_DELIVERY.QUEUE,
              },
            ],
          ],
        );
        const page = readAnswer(
          codingAgentMessagesAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(AGENT_MESSAGES, owner, { id: agent.id })),
        );
        // The plan the turn opened with, which awaits nothing, then the two lines in the order sent.
        assert.deepEqual(userLines(page), [
          undefined,
          CODING_AGENT_DELIVERY.STEER,
          CODING_AGENT_DELIVERY.QUEUE,
        ]);
        assert.equal(page.status, CODING_AGENT_STATUS.RUNNING);
      }),
  );

  it.effect(
    "a message to an idle agent opens a turn whatever the delivery says, and the agent reads as running in the list and in the transcript until the turn takes the line",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const { owner, plan, agent, ask, target, writer } = yield* startedAgent(eve, {
          running: false,
        });
        const before = readAnswer(
          codingAgentListAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(PLAN_AGENTS, owner, { id: plan.id })),
        );
        assert.equal(before.agents[0]?.status, CODING_AGENT_STATUS.COMPLETED);

        const answered = readAnswer(
          codingAgentAnswerSchema,
          HOSTED_HTTP_STATUS.ACCEPTED,
          yield* ask(
            messageAs(owner, agent.id, {
              text: "Now add the tests.",
              delivery: CODING_AGENT_DELIVERY.QUEUE,
            }),
          ),
        );
        assert.equal(answered.agent.status, CODING_AGENT_STATUS.RUNNING);
        assert.equal(eve.sent.length, 1);
        const listed = readAnswer(
          codingAgentListAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(PLAN_AGENTS, owner, { id: plan.id })),
        );
        assert.equal(listed.agents[0]?.status, CODING_AGENT_STATUS.RUNNING);
        const page = readAnswer(
          codingAgentMessagesAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(AGENT_MESSAGES, owner, { id: agent.id })),
        );
        assert.deepEqual(userLines(page), [undefined, CODING_AGENT_DELIVERY.QUEUE]);
        assert.equal(page.status, CODING_AGENT_STATUS.RUNNING);

        // The next turn receives the line: the marker clears in place, the row is read again past
        // the cursor the page left, and nothing awaits, so the agent reads from its turns again.
        const nextTurn = randomUUID();
        yield* TestClock.adjust(Duration.minutes(1));
        yield* writer.enqueueTurn(target, {
          turnId: nextTurn,
          origin: TURN_ORIGIN.TYPED,
          eveTurnId: "turn_1",
        });
        const taken = yield* writer.takeAwaitingLine(target, {
          text: "Now add the tests.",
          turnId: nextTurn,
        });
        assert.ok(Result.isSuccess(taken) && Option.isSome(taken.success));
        const again = readAnswer(
          codingAgentMessagesAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(AGENT_MESSAGES, owner, { id: agent.id, after: page.cursor })),
        );
        assert.deepEqual(userLines(again), [undefined]);
        assert.equal(again.status, CODING_AGENT_STATUS.RUNNING);
        yield* writer.consume(target, {
          kind: BRAIN_RUN_EVENT.TURN_STARTED,
          conversationId: sessionKey(target.conversationId),
          turnId: nextTurn,
          sequence: 1,
          origin: BRAIN_TURN_ORIGIN.TYPED,
          trigger: BRAIN_TURN_TRIGGER.ASK,
          at: 0,
        });
        yield* writer.consume(target, {
          kind: BRAIN_RUN_EVENT.TURN_ENDED,
          conversationId: sessionKey(target.conversationId),
          turnId: nextTurn,
          sequence: 2,
          status: BRAIN_REQUEST_STATUS.SUCCEEDED,
          responseIds: [],
          at: 0,
        });
        const ended = readAnswer(
          codingAgentListAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(PLAN_AGENTS, owner, { id: plan.id })),
        );
        assert.equal(ended.agents[0]?.status, CODING_AGENT_STATUS.COMPLETED);
      }),
  );

  it.effect(
    "a message is the owner's alone and bounded: another account and no bearer are refused by name, as are words past the bound, no words, and a delivery outside the two, and eve hears none of them",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const { owner, other, agent, ask } = yield* startedAgent(eve, { running: true });
        const line = { text: "Rename the helper.", delivery: CODING_AGENT_DELIVERY.QUEUE };
        assert.deepEqual(
          yield* ask(messageAs(other, agent.id, line)),
          refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND),
        );
        assert.deepEqual(
          yield* ask(messageAs(undefined, agent.id, line)),
          refusal(HOSTED_HTTP_STATUS.UNAUTHORIZED, HOSTED_API_ERROR.INVALID_TOKEN),
        );
        assert.deepEqual(
          yield* ask(
            messageAs(owner, agent.id, {
              ...line,
              text: "x".repeat(CODING_AGENT_BOUNDS.MAX_MESSAGE_CHARS + 1),
            }),
          ),
          refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.MESSAGE_TOO_LONG),
        );
        const invalid = refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);
        assert.deepEqual(yield* ask(messageAs(owner, agent.id, { ...line, text: "   " })), invalid);
        assert.deepEqual(
          yield* ask(messageAs(owner, agent.id, { ...line, delivery: "later" })),
          invalid,
        );
        assert.deepEqual(yield* ask(messageAs(owner, agent.id, { text: "Hi" })), invalid);
        assert.deepEqual(eve.sent, []);
        const page = readAnswer(
          codingAgentMessagesAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(AGENT_MESSAGES, owner, { id: agent.id })),
        );
        assert.deepEqual(userLines(page), [undefined]);
        // The bound itself is taken.
        readAnswer(
          codingAgentAnswerSchema,
          HOSTED_HTTP_STATUS.ACCEPTED,
          yield* ask(
            messageAs(owner, agent.id, {
              ...line,
              text: "y".repeat(CODING_AGENT_BOUNDS.MAX_MESSAGE_CHARS),
            }),
          ),
        );
        assert.equal(eve.sent.length, 1);
      }),
  );

  it.effect(
    "eve's refusals are the route's words, and none of them leaves a line behind: a session still coming up or never claimed is a conflict to try again, one eve no longer runs is retired, and any other answer is unavailable",
    () =>
      Effect.gen(function* () {
        const line = { text: "Push what you have.", delivery: CODING_AGENT_DELIVERY.STEER };
        const answers = [
          [
            EVE_SEND_OUTCOME.NOT_READY,
            HOSTED_API_ERROR.AGENT_NOT_READY,
            HOSTED_HTTP_STATUS.CONFLICT,
          ],
          [EVE_SEND_OUTCOME.RETIRED, HOSTED_API_ERROR.AGENT_RETIRED, HOSTED_HTTP_STATUS.CONFLICT],
          [
            EVE_SEND_OUTCOME.FAILED,
            HOSTED_API_ERROR.UNAVAILABLE,
            HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE,
          ],
        ] as const;
        for (const [sends, error, status] of answers) {
          const eve = fakeEve({ sends });
          const { owner, agent, ask } = yield* startedAgent(eve, { running: true });
          assert.deepEqual(yield* ask(messageAs(owner, agent.id, line)), refusal(status, error));
          assert.equal(eve.sent.length, 1);
          const page = readAnswer(
            codingAgentMessagesAnswerSchema,
            HOSTED_HTTP_STATUS.OK,
            yield* ask(request(AGENT_MESSAGES, owner, { id: agent.id })),
          );
          assert.deepEqual(userLines(page), [undefined]);
        }

        // An agent whose session has not claimed the conversation yet has nowhere to take the line.
        const eve = fakeEve();
        const { owner, plan, ask } = yield* openPlan({ eve });
        const unclaimed = readAnswer(
          codingAgentAnswerSchema,
          HOSTED_HTTP_STATUS.CREATED,
          yield* ask(startAs(owner, plan.id, { idempotencyKey: randomUUID() })),
        ).agent;
        assert.deepEqual(
          yield* ask(messageAs(owner, unclaimed.id, line)),
          refusal(HOSTED_HTTP_STATUS.CONFLICT, HOSTED_API_ERROR.AGENT_NOT_READY),
        );
        assert.deepEqual(eve.sent, []);
      }),
  );

  it.effect(
    "a message to an agent whose repository the developer no longer reaches is refused before eve hears of it",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const { owner, plan, ask } = yield* openPlan({ eve });
        // An agent on a repository the App does not reach for the account: started past the Start's own check.
        const started = yield* createCodingAgent(owner, {
          planId: plan.id,
          idempotencyKey: randomUUID(),
          model: CODING_AGENT_DEFAULT_CHOICE.model,
          effort: CODING_AGENT_DEFAULT_CHOICE.effort,
          planSnapshot: planMarkdown(SAVED),
          repository: "Acme/Ledger",
        });
        assert.ok(Option.isSome(started));
        const { agent } = started.value;
        const target = { userId: owner, conversationId: agent.conversationId };
        yield* claimRuntimeSession(target, "wrun_01M0000000000000000000099", new Date());
        assert.deepEqual(
          yield* ask(
            messageAs(owner, agent.id, { text: "Go on.", delivery: CODING_AGENT_DELIVERY.QUEUE }),
          ),
          refusal(HOSTED_HTTP_STATUS.FORBIDDEN, HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE),
        );
        assert.deepEqual(eve.sent, []);
      }),
  );
});

/** A Start as the owner given, with the body given. */
function startAs(bearer: string | undefined, planId: string, body: WireBoundaryInput): Request {
  return request(PLAN_AGENTS, bearer, { method: "POST", id: planId, body });
}
