import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { HOSTED_API_ERROR } from "@sidecar/hosted";
import {
  CHECK_SUMMARY,
  CODING_AGENT_BOUNDS,
  CODING_AGENT_BRIEF,
  CODING_AGENT_FAILURE,
  CODING_AGENT_STATUS,
  type CodingAgentMessage,
  codingAgentAnswerSchema,
  codingAgentListAnswerSchema,
  codingAgentMessagesAnswerSchema,
  codingAgentPullRequestAnswerSchema,
  PULL_REQUEST_STATE,
} from "@sidecar/hosted/coding-agent-wire";
import { MODEL_PROVIDER } from "@sidecar/hosted/models-wire";
import { planMarkdown } from "@sidecar/hosted/plan-markdown";
import { unparsedWire, type WireBoundaryInput } from "@sidecar/wire";
import { readEither } from "@sidecar/wire/effect";
import { isTextUIPart, type UIMessage } from "ai";
import {
  Cause,
  Clock,
  Deferred,
  Duration,
  Effect,
  Exit,
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
  BRAIN_REQUEST_FAILURE,
  BRAIN_REQUEST_STATUS,
  BRAIN_RUN_EVENT,
  BRAIN_TURN_ORIGIN,
  BRAIN_TURN_TRIGGER,
  isRecord,
  isWireString,
  MESSAGE_AUTHOR,
  MESSAGE_ROLE,
  sessionKey,
  TURN_ORIGIN,
  userMessage,
  userMetadataOf,
} from "../server/core";
import { readAccountPreferences, writeAccountPreferences } from "../server/hosted/account-store";
import { BRAIN_HOST_TURN } from "../server/hosted/brain-host/bounds";
import { openChildConversation } from "../server/hosted/brain-host/conversation";
import {
  EVE_CANCEL_OUTCOME,
  EVE_SEND_OUTCOME,
  type EveMessage,
  type EveSessions,
  EveUnreachable,
} from "../server/hosted/brain-host/eve-sessions";
import { childConversationId, sentLineId } from "../server/hosted/brain-host/ids";
import { claimRuntimeSession } from "../server/hosted/brain-host/recorded-session";
import { CODER, CODER_REFUSAL } from "../server/hosted/coder-host/bounds";
import { recordDelegation } from "../server/hosted/coder-host/delegation";
import { CODER_TOOL, CODER_TOOL_SET } from "../server/hosted/coder-host/tool-set";
import { cursorOfWire } from "../server/hosted/coder-host/transcript";
import {
  awaitingLinesOf,
  createCodingAgent,
  fillCodingAgentTitle,
  listCodingAgents,
  readCodingAgent,
  recordCodingAgentCompaction,
  recordCodingAgentStep,
  updateCodingAgentBranch,
} from "../server/hosted/coding-agent-store";
import { HOSTED_HTTP_STATUS } from "../server/hosted/http";
import {
  CODING_AGENT_DEFAULT_CHOICE,
  modelCatalogOf,
  type OfferedModel,
} from "../server/hosted/model-catalog";
import { createPlan, savePlanDocument } from "../server/hosted/plan-store";
import { listMessagesPast, storeWriter } from "../server/hosted/store";
import { sentLineStands } from "../server/hosted/store/message-reads";
import {
  type FakeGitHub,
  githubReaching,
  openGithubUser,
  type RepositoryScript,
} from "./support/github-app-fake";
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
const AGENT = "/api/agents/agent";
const AGENT_STOP = "/api/agents/stop";
const AGENT_PULL_REQUEST = "/api/agents/pull-request";
const AGENT_SUBAGENT_MESSAGES = "/api/agents/subagent-messages";

const RELAY = { owner: "Acme", name: "Relay" } as const;
const RELAY_FULL_NAME = `${RELAY.owner}/${RELAY.name}`;
const INSTALLATION = { id: 7, login: RELAY.owner, repositories: [RELAY] } as const;

const SAVED = {
  body: "# Teammate invitations\n\n## Goal\n\nInvite a teammate by email.\n",
  assumptions: [{ text: "Invites expire after 7 days." }],
};

const SOL = "openai/gpt-6.1-sol";

/** The two models offered, each with its prices in dollars per token. */
const CATALOG: readonly OfferedModel[] = [
  {
    id: CODING_AGENT_DEFAULT_CHOICE.model,
    name: "Claude Opus 5.5",
    provider: MODEL_PROVIDER.ANTHROPIC,
    efforts: ["low", "medium", "high", "max"],
    pricing: { inputUsd: 0.000004, outputUsd: 0.00002, cachedInputUsd: 0.0000002 },
  },
  {
    id: SOL,
    name: "GPT-6.1 Sol",
    provider: MODEL_PROVIDER.OPENAI,
    efforts: ["low", "high"],
    pricing: { inputUsd: 0.000002, outputUsd: 0.00001, cachedInputUsd: 0.000001 },
  },
];

/** A turn's counts with nothing cached and no reasoning, as the brain keeps them. */
function counted(inputTokens: number, outputTokens: number) {
  return { inputTokens, outputTokens, cachedInputTokens: 0, reasoningTokens: 0 };
}

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

/**
 * The group over the test's own database, GitHub, and eve, stood once and
 * answering every request of the test, so what it keeps between two
 * requests, the published answers, is kept as one function instance keeps
 * it; let go with the test's scope.
 */
const standing = (
  bearers: ReadonlyMap<string, string>,
  github: FakeGitHub,
  eve: ReturnType<typeof fakeEve>,
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
    yield* Effect.addFinalizer(() => Effect.promise(() => dispose()));
    return (request: Request) =>
      Effect.gen(function* () {
        const response = yield* Effect.promise(() => handler(request));
        const text = yield* Effect.promise(() => response.text());
        // SAFETY: the group answers JSON; the test compares it as the wire value it is, and an answer
        // with no body is compared as its text so a failure names what came back.
        const body = (text.length === 0 ? text : JSON.parse(text)) as WireBoundaryInput;
        return { status: response.status, body } satisfies Answer;
      });
  });

function request(
  path: string,
  bearer: string | undefined,
  init: {
    method?: string;
    body?: WireBoundaryInput;
    id?: string;
    after?: string;
    call?: string;
  } = {},
): Request {
  const url = new URL(path, ORIGIN);
  if (init.id !== undefined) url.searchParams.set("id", init.id);
  if (init.after !== undefined) url.searchParams.set("after", init.after);
  if (init.call !== undefined) url.searchParams.set("call", init.call);
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

/** How far a read asked ahead of its record is stepped: well inside the hold it must answer within. */
const EARLY_READ_STEPS = 10;

/**
 * A forked ask driven to its answer, the clock moved a step at a time so
 * each wait it holds elapses, then joined. The steps are bounded, because
 * a step lands while a query of the ask's is still on its way, and an ask
 * that is meant to answer inside its hold must not have the hold stepped
 * out from under it: a bound under the hold leaves the join to the query.
 */
const driven = <A, E>(fiber: Fiber.Fiber<A, E>, step: Duration.Duration, steps = 1_000) =>
  Effect.gen(function* () {
    for (let attempt = 0; attempt < steps; attempt += 1) {
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
  options: {
    readonly repository?: string | null;
    readonly eve?: ReturnType<typeof fakeEve>;
    /** What the repository answers on its own paths, for a test of what an agent published. */
    readonly github?: RepositoryScript;
  } = {},
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
    const github = githubReaching([INSTALLATION], undefined, undefined, options.github);
    const eve = options.eve ?? fakeEve();
    const ask = yield* standing(bearers, github, eve);
    return { owner, other, plan, eve, github, ask };
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
        assert.equal(agent.turnId, null);
        assert.equal(agent.brief, CODING_AGENT_BRIEF.PLAN);
        const stored = yield* readCodingAgent(owner, agent.id);
        assert.ok(Option.isSome(stored));
        assert.equal(stored.value.planSnapshot, planMarkdown(SAVED));
        assert.equal(stored.value.task, null);
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
    "a Start naming a task opens the session with the task as its first message and never the plan, keeps no copy of the plan, and works in the plan's repository",
    () =>
      Effect.gen(function* () {
        const { owner, plan, eve, ask } = yield* openPlan();
        const task = "Rename the invite email's subject to say who sent it.";

        const started = yield* ask(
          startAs(owner, plan.id, { idempotencyKey: randomUUID(), task: `  ${task}\n` }),
        );

        const { agent } = readAnswer(codingAgentAnswerSchema, HOSTED_HTTP_STATUS.CREATED, started);
        assert.equal(agent.brief, CODING_AGENT_BRIEF.TASK);
        const stored = yield* readCodingAgent(owner, agent.id);
        assert.ok(Option.isSome(stored));
        assert.equal(stored.value.task, task);
        assert.equal(stored.value.planSnapshot, null);
        assert.equal(stored.value.repository, RELAY_FULL_NAME);
        assert.deepEqual(
          eve.opened.map((opened) => opened.message.message),
          [task],
        );
        // The agent reads as handed its task wherever it is listed.
        const listed = yield* ask(request(PLAN_AGENTS, owner, { method: "GET", id: plan.id }));
        assert.deepEqual(
          readAnswer(codingAgentListAnswerSchema, HOSTED_HTTP_STATUS.OK, listed).agents.map(
            (each) => each.brief,
          ),
          [CODING_AGENT_BRIEF.TASK],
        );
      }),
  );

  it.effect(
    "a task is bounded as a message is: one past the bound, or nothing but whitespace, is refused, and one at the bound at JSON's widest escape is taken",
    () =>
      Effect.gen(function* () {
        const { owner, plan, eve, ask } = yield* openPlan();
        const invalid = refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);
        assert.deepEqual(
          yield* ask(
            startAs(owner, plan.id, {
              idempotencyKey: randomUUID(),
              task: "x".repeat(CODING_AGENT_BOUNDS.MAX_MESSAGE_CHARS + 1),
            }),
          ),
          invalid,
        );
        assert.deepEqual(
          yield* ask(startAs(owner, plan.id, { idempotencyKey: randomUUID(), task: " \n\t " })),
          invalid,
        );
        assert.equal(eve.opened.length, 0, "no refused task opens a session");

        // A control character is spelled as six bytes in JSON, the widest a character escapes to.
        const widest = "\u0001".repeat(CODING_AGENT_BOUNDS.MAX_MESSAGE_CHARS);
        const taken = yield* ask(
          startAs(owner, plan.id, { idempotencyKey: randomUUID(), task: widest }),
        );
        readAnswer(codingAgentAnswerSchema, HOSTED_HTTP_STATUS.CREATED, taken);
        assert.deepEqual(
          eve.opened.map((opened) => opened.message.message),
          [widest],
        );
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
    "a worker's transcript is read under the agent and the call that started it, by the owner alone; a call no delegation was recorded for reads as none",
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
        const parent = { userId: owner, conversationId: stored.value.conversationId };
        const callId = "call-worker-1";
        const child = {
          userId: owner,
          conversationId: childConversationId(parent.conversationId, callId),
        };
        // Asked a step ahead of the record, as a tab opened the moment the call was requested
        // asks, the read holds and answers the transcript once the record lands.
        const early = yield* Effect.forkChild(
          ask(request(AGENT_SUBAGENT_MESSAGES, owner, { id: agent.id, call: callId })),
        );
        yield* TestClock.adjust(CODER.MESSAGES_POLL);
        assert.equal(early.pollUnsafe(), undefined);
        yield* recordDelegation(
          parent,
          child.conversationId,
          { model: "openai/gpt-6.1-sol", effort: "low" },
          CODER_TOOL.DELEGATE,
        );
        const writer = yield* storeWriter({ tools: CODER_TOOL_SET });
        const turnId = randomUUID();
        yield* writer.enqueueTurn(child, {
          turnId,
          origin: TURN_ORIGIN.CHILD,
          eveTurnId: "turn_0",
        });
        yield* writer.consume(child, {
          kind: BRAIN_RUN_EVENT.TURN_STARTED,
          conversationId: sessionKey(child.conversationId),
          turnId,
          sequence: 1,
          origin: BRAIN_TURN_ORIGIN.CHILD,
          trigger: BRAIN_TURN_TRIGGER.CHILD_TASK,
          at: 0,
        });
        yield* writer.consume(child, {
          kind: BRAIN_RUN_EVENT.MESSAGE_COMPLETED,
          conversationId: sessionKey(child.conversationId),
          turnId,
          sequence: 2,
          message: userMessage(
            randomUUID(),
            "Count the routes.",
            userMetadataOf(BRAIN_TURN_TRIGGER.CHILD_TASK, undefined),
          ),
        });

        const page = readAnswer(
          codingAgentMessagesAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* driven(early, CODER.MESSAGES_POLL, EARLY_READ_STEPS),
        );
        assert.equal(page.messages.length, 1);
        assert.equal(page.messages[0]?.role, MESSAGE_ROLE.USER);
        assert.equal(page.status, CODING_AGENT_STATUS.RUNNING);

        assert.deepEqual(
          yield* ask(request(AGENT_SUBAGENT_MESSAGES, other, { id: agent.id, call: callId })),
          refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND),
        );
        // A call recorded nowhere while the agent still runs is held for, then read as a worker starting.
        const unrecorded = yield* Effect.forkChild(
          ask(request(AGENT_SUBAGENT_MESSAGES, owner, { id: agent.id, call: "call-9" })),
        );
        yield* TestClock.adjust(CODER.MESSAGES_HOLD);
        const starting = readAnswer(
          codingAgentMessagesAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* driven(unrecorded, CODER.MESSAGES_POLL),
        );
        assert.deepEqual(starting.messages, []);
        assert.equal(starting.status, CODING_AGENT_STATUS.STARTING);
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

  it.effect(
    "a change of model writes the choice on the agent's row and answers the agent with it, leaving the account's default; another account's agent is not found, and a model or effort outside the catalog or a choice missing its effort is refused",
    () =>
      Effect.gen(function* () {
        const { owner, other, plan, ask } = yield* openPlan();
        const { agent } = readAnswer(
          codingAgentAnswerSchema,
          HOSTED_HTTP_STATUS.CREATED,
          yield* ask(startAs(owner, plan.id, { idempotencyKey: randomUUID() })),
        );
        const chooseAs = (bearer: string, body: WireBoundaryInput) =>
          ask(request(AGENT, bearer, { method: "PATCH", id: agent.id, body }));

        const changed = readAnswer(
          codingAgentAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* chooseAs(owner, { model: "openai/gpt-6.1-sol", effort: "low" }),
        );
        assert.deepEqual(
          [changed.agent.model, changed.agent.effort],
          ["openai/gpt-6.1-sol", "low"],
        );
        const stored = yield* readCodingAgent(owner, agent.id);
        assert.deepEqual(
          Option.map(stored, (row) => [row.model, row.effort]),
          Option.some(["openai/gpt-6.1-sol", "low"]),
        );
        assert.equal(yield* readAccountPreferences(owner), undefined, "the default stands");

        assert.deepEqual(
          yield* chooseAs(other, { model: "openai/gpt-6.1-sol", effort: "high" }),
          refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND),
        );
        for (const body of [
          { model: "anthropic/claude-haiku-1", effort: "high" },
          { model: "openai/gpt-6.1-sol", effort: "max" },
          { model: "openai/gpt-6.1-sol" },
        ]) {
          assert.deepEqual(
            yield* chooseAs(owner, body),
            refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST),
          );
        }
      }),
  );

  it.effect(
    "a rename writes the title on the agent's row and answers the agent with it, which the list reads back, an empty title clears it, and a generated title never covers a name the developer gave; another account's agent is not found, and a title past the bound is refused",
    () =>
      Effect.gen(function* () {
        const { owner, other, plan, ask } = yield* openPlan();
        const { agent } = readAnswer(
          codingAgentAnswerSchema,
          HOSTED_HTTP_STATUS.CREATED,
          yield* ask(startAs(owner, plan.id, { idempotencyKey: randomUUID() })),
        );
        assert.equal(agent.title, null);
        const renameAs = (bearer: string, body: WireBoundaryInput) =>
          ask(request(AGENT, bearer, { method: "PATCH", id: agent.id, body }));

        const renamed = readAnswer(
          codingAgentAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* renameAs(owner, { title: "  Sign-out button in account menu " }),
        );
        assert.equal(renamed.agent.title, "Sign-out button in account menu");
        assert.equal(yield* fillCodingAgentTitle(owner, agent.id, "Teammate invitations"), false);
        const listed = readAnswer(
          codingAgentListAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(PLAN_AGENTS, owner, { id: plan.id })),
        );
        assert.equal(listed.agents[0]?.title, "Sign-out button in account menu");

        const cleared = readAnswer(
          codingAgentAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* renameAs(owner, { title: "" }),
        );
        assert.equal(cleared.agent.title, null);

        assert.deepEqual(
          yield* renameAs(other, { title: "Theirs" }),
          refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND),
        );
        assert.deepEqual(
          yield* renameAs(owner, { title: "x".repeat(CODING_AGENT_BOUNDS.MAX_TITLE_CHARS + 1) }),
          refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST),
        );
      }),
  );

  it.effect(
    "what an agent published is the pull request from the branch its row holds, read from GitHub with its sizes and its head's checks, and kept for the TTL: a second ask inside it reads GitHub no more, one past it sees the pull request drafted, merged, or closed and its checks moved",
    () =>
      Effect.gen(function* () {
        const pullRequest = pullRequestFixture();
        const { owner, other, plan, github, ask } = yield* openPlan({
          github: relayRepository({ pullRequest, pushed: true }),
        });
        const { agent } = yield* startedAgent(owner, plan.id, ask);
        yield* updateCodingAgentBranch(owner, agent.id, HEAD.ref);

        const read = () =>
          Effect.map(ask(request(AGENT_PULL_REQUEST, owner, { id: agent.id })), (answered) =>
            readAnswer(codingAgentPullRequestAnswerSchema, HOSTED_HTTP_STATUS.OK, answered),
          );
        assert.deepEqual(yield* read(), {
          repository: RELAY_FULL_NAME,
          branch: HEAD.ref,
          pullRequest: {
            number: 41,
            title: "Teammate invitations",
            url: `https://github.com/${RELAY_FULL_NAME}/pull/41`,
            state: PULL_REQUEST_STATE.OPEN,
            checks: CHECK_SUMMARY.PASSING,
            additions: 210,
            deletions: 14,
            changedFiles: 6,
          },
        });
        assert.equal(repositoryReads(github, "/pulls/41"), 1);

        // Inside the TTL the kept answer stands, whatever GitHub now holds.
        pullRequest.draft = true;
        pullRequest.runs = [{ status: "in_progress", conclusion: null }];
        assert.equal((yield* read()).pullRequest?.state, PULL_REQUEST_STATE.OPEN);
        assert.equal(repositoryReads(github, "/pulls/41"), 1);

        // Past it, GitHub is asked again: drafted, with a run still going.
        yield* TestClock.adjust(CODER.PUBLISHED_TTL);
        const drafted = yield* read();
        assert.equal(drafted.pullRequest?.state, PULL_REQUEST_STATE.DRAFT);
        assert.equal(drafted.pullRequest?.checks, CHECK_SUMMARY.PENDING);
        assert.equal(repositoryReads(github, "/pulls/41"), 2);

        // Merged beats closed, a failed run or a failed status reads as failing, and none at all as none.
        pullRequest.state = "closed";
        pullRequest.merged = true;
        pullRequest.runs = [{ status: "completed", conclusion: "failure" }];
        yield* TestClock.adjust(CODER.PUBLISHED_TTL);
        const merged = yield* read();
        assert.equal(merged.pullRequest?.state, PULL_REQUEST_STATE.MERGED);
        assert.equal(merged.pullRequest?.checks, CHECK_SUMMARY.FAILING);

        pullRequest.merged = false;
        pullRequest.runs = [];
        pullRequest.statuses = ["success", "failure"];
        yield* TestClock.adjust(CODER.PUBLISHED_TTL);
        const closed = yield* read();
        assert.equal(closed.pullRequest?.state, PULL_REQUEST_STATE.CLOSED);
        assert.equal(closed.pullRequest?.checks, CHECK_SUMMARY.FAILING);

        pullRequest.statuses = [];
        yield* TestClock.adjust(CODER.PUBLISHED_TTL);
        assert.equal((yield* read()).pullRequest?.checks, CHECK_SUMMARY.NONE);

        // A head whose checks the App may not read reads as having none, rather than failing the answer.
        pullRequest.checksReadable = false;
        pullRequest.statuses = ["pending"];
        yield* TestClock.adjust(CODER.PUBLISHED_TTL);
        assert.equal((yield* read()).pullRequest?.checks, CHECK_SUMMARY.PENDING);

        assert.deepEqual(
          yield* ask(request(AGENT_PULL_REQUEST, other, { id: agent.id })),
          refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND),
        );
        assert.deepEqual(
          yield* ask(request(AGENT_PULL_REQUEST, owner, { method: "POST", id: agent.id })),
          refusal(HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED, HOSTED_API_ERROR.METHOD_NOT_ALLOWED),
        );
      }),
  );

  it.effect(
    "an agent whose row holds no branch published nothing and asks GitHub nothing, and one still on the default branch published nothing; one whose row holds a branch answers the newest pull request from it, else the branch alone where GitHub holds it, else nothing; a repository the developer no longer reaches is refused",
    () =>
      Effect.gen(function* () {
        const repository: RepositoryFixture = { pullRequest: undefined, pushed: false };
        const { owner, plan, github, ask } = yield* openPlan({
          github: (sent) => relayRepository(repository)(sent),
        });
        const read = (agentId: string) =>
          Effect.map(ask(request(AGENT_PULL_REQUEST, owner, { id: agentId })), (answered) =>
            readAnswer(codingAgentPullRequestAnswerSchema, HOSTED_HTTP_STATUS.OK, answered),
          );

        const silent = yield* startedAgent(owner, plan.id, ask);
        const nothing = { repository: RELAY_FULL_NAME, branch: null, pullRequest: null };
        assert.deepEqual(yield* read(silent.agent.id), nothing);
        assert.equal(
          github.sent.some((sent) => new URL(sent.url).pathname.startsWith("/repos/")),
          false,
        );

        const pushed = yield* startedAgent(owner, plan.id, ask);
        // Still on the default branch, as an agent that only read leaves it: nothing.
        yield* updateCodingAgentBranch(owner, pushed.agent.id, "main");
        assert.deepEqual(yield* read(pushed.agent.id), nothing);
        yield* updateCodingAgentBranch(owner, pushed.agent.id, HEAD.ref);
        yield* TestClock.adjust(CODER.PUBLISHED_TTL);
        // Never pushed, as GitHub has it: nothing.
        assert.deepEqual(yield* read(pushed.agent.id), nothing);
        // Pushed with no pull request: the branch alone.
        repository.pushed = true;
        yield* TestClock.adjust(CODER.PUBLISHED_TTL);
        assert.deepEqual(yield* read(pushed.agent.id), { ...nothing, branch: HEAD.ref });
        // A pull request opened from it since, by anyone: found by the head.
        repository.pullRequest = pullRequestFixture({ number: 7 });
        yield* TestClock.adjust(CODER.PUBLISHED_TTL);
        const found = yield* read(pushed.agent.id);
        assert.equal(found.pullRequest?.number, 7);
        assert.equal(found.branch, HEAD.ref);

        // An agent on a repository the App no longer reaches for the developer: nothing of it is read.
        const away = yield* createCodingAgent(owner, {
          planId: plan.id,
          idempotencyKey: randomUUID(),
          model: CODING_AGENT_DEFAULT_CHOICE.model,
          effort: CODING_AGENT_DEFAULT_CHOICE.effort,
          planSnapshot: "# Ledger\n",
          task: null,
          repository: "Acme/Ledger",
        });
        assert.ok(Option.isSome(away));
        yield* updateCodingAgentBranch(owner, away.value.agent.id, "luke/ledger");
        assert.deepEqual(
          yield* ask(request(AGENT_PULL_REQUEST, owner, { id: away.value.agent.id })),
          refusal(HOSTED_HTTP_STATUS.FORBIDDEN, HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE),
        );
      }),
  );

  it.effect(
    "the agent's turn ending is read afresh inside the TTL, so the pull request it opened last shows at once",
    () =>
      Effect.gen(function* () {
        const repository: RepositoryFixture = { pullRequest: undefined, pushed: false };
        const { owner, plan, ask } = yield* openPlan({
          github: (sent) => relayRepository(repository)(sent),
        });
        const read = (agentId: string) =>
          Effect.map(ask(request(AGENT_PULL_REQUEST, owner, { id: agentId })), (answered) =>
            readAnswer(codingAgentPullRequestAnswerSchema, HOSTED_HTTP_STATUS.OK, answered),
          );
        const nothing = { repository: RELAY_FULL_NAME, branch: null, pullRequest: null };

        // Running on a branch of an earlier turn: nothing pushed yet, and the empty answer is kept.
        const worker = yield* startedAgent(owner, plan.id, ask);
        yield* updateCodingAgentBranch(owner, worker.agent.id, HEAD.ref);
        const turnId = yield* agentWroteMessages(worker.target, [
          agentMessage(agentParts([], "Starting.")),
        ]);
        assert.deepEqual(yield* read(worker.agent.id), nothing);

        // The push, the pull request, and the end land inside the TTL: the first read after the end is fresh.
        repository.pushed = true;
        repository.pullRequest = pullRequestFixture({ number: 7 });
        yield* agentEnded(worker.target, turnId);
        const published = yield* read(worker.agent.id);
        assert.equal(published.pullRequest?.number, 7);
        assert.equal(published.branch, HEAD.ref);
      }),
  );
});

/** A message to the agent as the bearer given, with the body given. */
function messageAs(bearer: string | undefined, agentId: string, body: WireBoundaryInput): Request {
  return request(AGENT_MESSAGES, bearer, { method: "POST", id: agentId, body });
}

/** The words of each user row of a transcript page, in order. */
function userTexts(page: {
  readonly messages: readonly CodingAgentMessage[];
}): readonly (string | undefined)[] {
  return page.messages
    .filter((message) => message.role === MESSAGE_ROLE.USER)
    .map((message) => {
      const part = message.parts.find((each) => isRecord(each) && each.type === "text");
      return isRecord(part) && isWireString(part.text) ? part.text : undefined;
    });
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
      /** The transcript as the owner reads it now: the developer's lines, and the status. */
      const transcript = () =>
        Effect.map(
          opened.ask(request(AGENT_MESSAGES, opened.owner, { id: agent.id })),
          (answered) => {
            const page = readAnswer(
              codingAgentMessagesAnswerSchema,
              HOSTED_HTTP_STATUS.OK,
              answered,
            );
            return { lines: userTexts(page), status: page.status };
          },
        );
      /** A message of the owner's under the key given, or one minted, answered as the wire declares a message taken. */
      const sent = (text: string, clientKey = randomUUID()) =>
        Effect.map(opened.ask(messageAs(opened.owner, agent.id, { text, clientKey })), (answered) =>
          readAnswer(codingAgentAnswerSchema, HOSTED_HTTP_STATUS.ACCEPTED, answered),
        );
      return { ...opened, agent, target, sessionId, writer, turnId, transcript, sent };
    });

  it.effect(
    "a page carries what the agent's model's context holds as its newest step left it, read from its row on every page, against the window a step on its model is told and eve's threshold in it; the plan's estimate goes once eve compacted",
    () =>
      Effect.gen(function* () {
        const { owner, agent, ask } = yield* startedAgent(fakeEve(), { running: false });
        const context = () =>
          Effect.map(
            ask(request(AGENT_MESSAGES, owner, { id: agent.id })),
            (answered) =>
              readAnswer(codingAgentMessagesAnswerSchema, HOSTED_HTTP_STATUS.OK, answered).context,
          );
        assert.equal(yield* context(), undefined);

        yield* recordCodingAgentStep(owner, agent.id, {
          inputTokens: 150_000,
          outputTokens: 2_400,
          cachedInputTokens: 140_000,
          cacheWriteTokens: 9_000,
          systemPromptTokens: 1_200,
          toolDefinitionTokens: 2_800,
          briefTokens: 600,
          at: 1_800_000_000_000,
        });
        assert.deepEqual(yield* context(), {
          windowTokens: CODER.FALLBACK_CONTEXT_WINDOW_TOKENS,
          compactionThresholdTokens: 180_000,
          inputTokens: 150_000,
          outputTokens: 2_400,
          cachedInputTokens: 140_000,
          cacheWriteTokens: 9_000,
          estimated: { systemPromptTokens: 1_200, toolDefinitionTokens: 2_800, briefTokens: 600 },
          measuredAt: 1_800_000_000_000,
        });

        yield* recordCodingAgentCompaction(owner, agent.id, new Date(1_800_000_060_000));
        const compacted = yield* context();
        assert.equal(compacted?.compactedAt, 1_800_000_060_000);
        assert.deepEqual(compacted?.estimated, {
          systemPromptTokens: 1_200,
          toolDefinitionTokens: 2_800,
        });
      }),
  );

  it.effect(
    "a page carries what the agent has cost over its own turns and its workers', each step priced at the model it ran on, and what its newest turn cost",
    () =>
      Effect.gen(function* () {
        const { owner, agent, target, writer, turnId, ask } = yield* startedAgent(fakeEve(), {
          running: true,
        });
        // The agent's turn ran a step on Opus ($0.006) and one on Sol ($0.0015).
        yield* writer.consume(target, {
          kind: BRAIN_RUN_EVENT.TURN_ENDED,
          conversationId: sessionKey(target.conversationId),
          turnId,
          sequence: 3,
          status: BRAIN_REQUEST_STATUS.SUCCEEDED,
          usage: counted(1500, 150),
          usageByModel: [
            { model: CODING_AGENT_DEFAULT_CHOICE.model, ...counted(1000, 100) },
            { model: SOL, ...counted(500, 50) },
          ],
          responseIds: [],
          at: 0,
        });
        // A worker's turn, in the child conversation delegated from the agent's, on Sol ($0.0006).
        const worker = { userId: owner, conversationId: randomUUID() };
        yield* openChildConversation(target, worker.conversationId, "worker");
        const workerTurnId = randomUUID();
        yield* writer.enqueueTurn(worker, {
          turnId: workerTurnId,
          origin: TURN_ORIGIN.TYPED,
          model: SOL,
        });
        yield* writer.consume(worker, {
          kind: BRAIN_RUN_EVENT.TURN_ENDED,
          conversationId: sessionKey(worker.conversationId),
          turnId: workerTurnId,
          sequence: 1,
          status: BRAIN_REQUEST_STATUS.SUCCEEDED,
          usage: counted(200, 20),
          responseIds: [],
          at: 0,
        });
        const page = readAnswer(
          codingAgentMessagesAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(AGENT_MESSAGES, owner, { id: agent.id })),
        );
        assert.deepEqual(page.usage, {
          inputTokens: 1700,
          outputTokens: 170,
          cachedInputTokens: 0,
          costUsd: 0.0081,
        });
        assert.deepEqual(page.turnUsage, {
          inputTokens: 1500,
          outputTokens: 150,
          cachedInputTokens: 0,
          costUsd: 0.0075,
        });
      }),
  );

  it.effect(
    "a page read after the turn failed says why as the wire's word, read off the turn's failure and the host's words in its detail",
    () =>
      Effect.gen(function* () {
        const { owner, agent, target, writer, turnId, ask } = yield* startedAgent(fakeEve(), {
          running: true,
        });
        yield* writer.consume(target, {
          kind: BRAIN_RUN_EVENT.TURN_ENDED,
          conversationId: sessionKey(target.conversationId),
          turnId,
          sequence: 3,
          status: BRAIN_REQUEST_STATUS.FAILED,
          failure: BRAIN_REQUEST_FAILURE.MODEL,
          failureDetail: `MODEL_CALL_FAILED ${CODER_REFUSAL.NOT_REACHABLE}`,
          responseIds: [],
          at: 0,
        });
        const page = readAnswer(
          codingAgentMessagesAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(AGENT_MESSAGES, owner, { id: agent.id })),
        );
        assert.equal(page.status, CODING_AGENT_STATUS.FAILED);
        assert.equal(page.failureReason, CODING_AGENT_FAILURE.GITHUB);
      }),
  );

  it.effect(
    "a message while a turn runs reaches eve under the developer's bearer with no policy of its own, shows in the transcript at once as the developer's line, and leaves the agent running",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const { owner, sessionId, sent, transcript } = yield* startedAgent(eve, {
          running: true,
        });
        const answered = yield* sent("  Use the helper.  ");
        assert.equal(answered.agent.status, CODING_AGENT_STATUS.RUNNING);
        assert.deepEqual(
          eve.sent.map((each) => [each.authorization, each.sessionId, each.message]),
          [
            [
              `Bearer ${owner}`,
              sessionId,
              {
                conversationId: eve.opened[0]?.message.conversationId,
                turn: BRAIN_HOST_TURN.TYPED,
                message: "Use the helper.",
              },
            ],
          ],
        );
        assert.deepEqual(yield* transcript(), {
          lines: [planMarkdown(SAVED), "Use the helper."],
          status: CODING_AGENT_STATUS.RUNNING,
        });
      }),
  );

  it.effect(
    "a message to an idle agent opens a turn, and the agent reads as running in the list and in the transcript until the turn takes the line",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const { owner, plan, agent, ask, target, writer, turnId, sent, transcript } =
          yield* startedAgent(eve, { running: false });
        const before = readAnswer(
          codingAgentListAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(PLAN_AGENTS, owner, { id: plan.id })),
        );
        assert.equal(before.agents[0]?.status, CODING_AGENT_STATUS.COMPLETED);

        const answered = yield* sent("Now add the tests.");
        assert.equal(answered.agent.status, CODING_AGENT_STATUS.RUNNING);
        // The turn named is still the ended one until eve opens the next on the line.
        assert.equal(answered.agent.turnId, turnId);
        assert.equal(eve.sent.length, 1);
        const listed = readAnswer(
          codingAgentListAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(PLAN_AGENTS, owner, { id: plan.id })),
        );
        assert.equal(listed.agents[0]?.status, CODING_AGENT_STATUS.RUNNING);
        assert.equal(listed.agents[0]?.turnId, turnId);
        assert.deepEqual(yield* transcript(), {
          lines: [planMarkdown(SAVED), "Now add the tests."],
          status: CODING_AGENT_STATUS.RUNNING,
        });

        // The next turn receives the line: the row is read again in place past the cursor the
        // page left, and nothing awaits, so the agent reads from its turns again.
        const page = readAnswer(
          codingAgentMessagesAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(AGENT_MESSAGES, owner, { id: agent.id })),
        );
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
        assert.ok(Result.isSuccess(taken) && taken.success.length === 1);
        const again = readAnswer(
          codingAgentMessagesAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(AGENT_MESSAGES, owner, { id: agent.id, after: page.cursor })),
        );
        assert.deepEqual(userTexts(again), ["Now add the tests."]);
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
        assert.equal(ended.agents[0]?.turnId, nextTurn);
      }),
  );

  it.effect(
    "lines a turn already received coalesced into one row of its own, as the relay wrote them before it took a coalesced run, await nothing: the agent reads as completed once the turn ends, and a line no turn has received still reads it as running",
    () =>
      Effect.gen(function* () {
        const { owner, plan, ask, target, writer, turnId, sent, transcript } = yield* startedAgent(
          fakeEve(),
          { running: true },
        );
        const lines = [
          "Check the verification map first.",
          "Then see if you disagree with the plan.",
        ];
        for (const line of lines) yield* sent(line);
        // eve's receipt of both lines at once, which no awaiting line's words matched alone.
        yield* writer.consume(target, {
          kind: BRAIN_RUN_EVENT.MESSAGE_COMPLETED,
          conversationId: sessionKey(target.conversationId),
          turnId,
          sequence: 3,
          message: userMessage(
            randomUUID(),
            lines.join("\n\n"),
            userMetadataOf(BRAIN_TURN_TRIGGER.ASK, undefined),
          ),
        });
        yield* writer.consume(target, {
          kind: BRAIN_RUN_EVENT.TURN_ENDED,
          conversationId: sessionKey(target.conversationId),
          turnId,
          sequence: 4,
          status: BRAIN_REQUEST_STATUS.SUCCEEDED,
          responseIds: [],
          at: 0,
        });
        const listed = () =>
          Effect.map(
            ask(request(PLAN_AGENTS, owner, { id: plan.id })),
            (answered) =>
              readAnswer(codingAgentListAnswerSchema, HOSTED_HTTP_STATUS.OK, answered).agents[0]
                ?.status,
          );
        assert.equal(yield* listed(), CODING_AGENT_STATUS.COMPLETED);
        assert.equal((yield* transcript()).status, CODING_AGENT_STATUS.COMPLETED);

        yield* sent("Now add the tests.");
        assert.equal(yield* listed(), CODING_AGENT_STATUS.RUNNING);
        assert.equal((yield* transcript()).status, CODING_AGENT_STATUS.RUNNING);
      }),
  );

  it.effect(
    "an agent's run is counted from its own start before any turn, from its newest turn's queueing and then its start, and from nowhere while a message awaits its turn, in the list and on the transcript's page alike",
    () =>
      Effect.gen(function* () {
        const { owner, plan, agent, ask, target, writer, sent } = yield* startedAgent(
          fakeEve(),
          undefined,
        );
        const listed = () =>
          Effect.map(
            ask(request(PLAN_AGENTS, owner, { id: plan.id })),
            (answered) =>
              readAnswer(codingAgentListAnswerSchema, HOSTED_HTTP_STATUS.OK, answered).agents[0],
          );
        const paged = () =>
          Effect.map(
            ask(request(AGENT_MESSAGES, owner, { id: agent.id })),
            (answered) =>
              readAnswer(codingAgentMessagesAnswerSchema, HOSTED_HTTP_STATUS.OK, answered)
                .runStartedAt,
          );
        assert.equal((yield* listed())?.runStartedAt, agent.createdAt);

        const firstTurn = randomUUID();
        yield* TestClock.adjust(Duration.seconds(5));
        yield* writer.enqueueTurn(target, {
          turnId: firstTurn,
          origin: TURN_ORIGIN.TYPED,
          eveTurnId: "turn_0",
        });
        assert.equal((yield* listed())?.runStartedAt, agent.createdAt + 5_000);
        yield* writer.consume(target, {
          kind: BRAIN_RUN_EVENT.TURN_STARTED,
          conversationId: sessionKey(target.conversationId),
          turnId: firstTurn,
          sequence: 1,
          origin: BRAIN_TURN_ORIGIN.TYPED,
          trigger: BRAIN_TURN_TRIGGER.ASK,
          at: agent.createdAt + 7_000,
        });
        assert.equal((yield* listed())?.runStartedAt, agent.createdAt + 7_000);
        yield* writer.consume(target, {
          kind: BRAIN_RUN_EVENT.TURN_ENDED,
          conversationId: sessionKey(target.conversationId),
          turnId: firstTurn,
          sequence: 2,
          status: BRAIN_REQUEST_STATUS.SUCCEEDED,
          responseIds: [],
          at: agent.createdAt + 60_000,
        });

        // A message reads the agent as running again, but its run begins only with its turn.
        const answered = yield* sent("Now add the tests.");
        assert.equal(answered.agent.status, CODING_AGENT_STATUS.RUNNING);
        assert.equal(answered.agent.runStartedAt, undefined);
        assert.equal((yield* listed())?.runStartedAt, undefined);
        assert.equal(yield* paged(), undefined);

        const nextTurn = randomUUID();
        yield* TestClock.adjust(Duration.minutes(2));
        yield* writer.enqueueTurn(target, {
          turnId: nextTurn,
          origin: TURN_ORIGIN.TYPED,
          eveTurnId: "turn_1",
        });
        yield* writer.takeAwaitingLine(target, { text: "Now add the tests.", turnId: nextTurn });
        yield* writer.consume(target, {
          kind: BRAIN_RUN_EVENT.TURN_STARTED,
          conversationId: sessionKey(target.conversationId),
          turnId: nextTurn,
          sequence: 1,
          origin: BRAIN_TURN_ORIGIN.TYPED,
          trigger: BRAIN_TURN_TRIGGER.ASK,
          at: agent.createdAt + 126_000,
        });
        const running = yield* listed();
        assert.equal(running?.turnId, nextTurn);
        assert.equal(running?.runStartedAt, agent.createdAt + 126_000);
        assert.equal(yield* paged(), agent.createdAt + 126_000);
      }),
  );

  it.effect(
    "a send repeated under its key answers what the first did and sends nothing again, once to eve and once in the transcript, and the same words under another key are a second message",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const { owner, target, sent, transcript } = yield* startedAgent(eve, { running: true });
        const key = randomUUID();
        const first = yield* sent("Use the helper.", key);
        const again = yield* sent("Use the helper.", key);
        assert.equal(first.agent.status, CODING_AGENT_STATUS.RUNNING);
        assert.deepEqual(again, first);
        assert.equal(eve.sent.length, 1);
        assert.deepEqual((yield* transcript()).lines, [planMarkdown(SAVED), "Use the helper."]);
        // The row stands under the key, which is how the repeat found it.
        assert.equal(yield* sentLineStands(owner, target.conversationId, sentLineId(key)), true);

        yield* sent("Use the helper.", randomUUID());
        assert.equal(eve.sent.length, 2);
        assert.deepEqual((yield* transcript()).lines, [
          planMarkdown(SAVED),
          "Use the helper.",
          "Use the helper.",
        ]);
      }),
  );

  it.effect(
    "a message is the owner's alone and bounded: another account and no bearer are refused by name, as are words past the bound, no words, and a key missing or past its bound, and eve hears none of them",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const { owner, other, agent, ask, transcript } = yield* startedAgent(eve, {
          running: true,
        });
        const line = { text: "Rename the helper.", clientKey: randomUUID() };
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
        assert.deepEqual(yield* ask(messageAs(owner, agent.id, { text: "Hi" })), invalid);
        assert.deepEqual(
          yield* ask(messageAs(owner, agent.id, { ...line, delivery: "queue" })),
          invalid,
        );
        assert.deepEqual(
          yield* ask(
            messageAs(owner, agent.id, {
              ...line,
              clientKey: "k".repeat(CODING_AGENT_BOUNDS.MAX_KEY_CHARS + 1),
            }),
          ),
          invalid,
        );
        assert.deepEqual(eve.sent, []);
        assert.deepEqual((yield* transcript()).lines, [planMarkdown(SAVED)]);
        // The bounds themselves are taken.
        readAnswer(
          codingAgentAnswerSchema,
          HOSTED_HTTP_STATUS.ACCEPTED,
          yield* ask(
            messageAs(owner, agent.id, {
              text: "y".repeat(CODING_AGENT_BOUNDS.MAX_MESSAGE_CHARS),
              clientKey: "k".repeat(CODING_AGENT_BOUNDS.MAX_KEY_CHARS),
            }),
          ),
        );
        assert.equal(eve.sent.length, 1);
      }),
  );

  it.effect(
    "eve's refusals are the route's words, and none of them leaves a line behind, so the same key sends again: a session still coming up or never claimed is a conflict to try again, one eve no longer runs is retired, and any other answer is unavailable",
    () =>
      Effect.gen(function* () {
        const line = { text: "Push what you have.", clientKey: randomUUID() };
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
          const { owner, agent, ask, transcript } = yield* startedAgent(eve, { running: true });
          assert.deepEqual(yield* ask(messageAs(owner, agent.id, line)), refusal(status, error));
          assert.equal(eve.sent.length, 1);
          assert.deepEqual((yield* transcript()).lines, [planMarkdown(SAVED)]);
          assert.deepEqual(yield* ask(messageAs(owner, agent.id, line)), refusal(status, error));
          assert.equal(eve.sent.length, 2);
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
    "the line's write cannot be interrupted once eve is being asked, so a request that goes away still leaves the accepted line on record, and a hand-over past its deadline is read as refused and writes nothing",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const { target, writer } = yield* startedAgent(eve, { running: true });
        const line = { text: "Keep going.", clientKey: randomUUID() };
        // eve takes the message only once the test lets it, which is when the request is interrupted.
        const accepting = yield* Deferred.make<boolean>();
        const asked = yield* Deferred.make<void>();
        const dispatch = Effect.andThen(
          Deferred.succeed(asked, undefined),
          Deferred.await(accepting),
        );
        const writing = yield* Effect.forkChild(writer.writeAwaitingLine(target, line, dispatch));
        yield* Deferred.await(asked);
        const interrupting = yield* Effect.forkChild(Fiber.interrupt(writing));
        yield* Effect.yieldNow;
        yield* Deferred.succeed(accepting, true);
        yield* Fiber.join(interrupting);
        // The interrupt is honoured once the write is through, so the fiber ends interrupted with
        // the row standing; without the fence the transaction would roll the accepted line back.
        const exit = yield* Fiber.await(writing);
        assert.ok(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause));
        assert.ok(
          (yield* awaitingLinesOf(target.userId, [target.conversationId])).has(
            target.conversationId,
          ),
        );

        // A hand-over that never answers is given up at the deadline, and no row stands for it.
        const hung = yield* Deferred.make<void>();
        const never = yield* Effect.forkChild(
          writer.writeAwaitingLine(
            target,
            { text: "Still there?", clientKey: randomUUID() },
            Effect.andThen(Deferred.succeed(hung, undefined), Effect.never),
          ),
        );
        yield* Deferred.await(hung);
        yield* TestClock.adjust(Duration.seconds(29));
        assert.equal(never.pollUnsafe(), undefined);
        yield* TestClock.adjust(Duration.seconds(1));
        const givenUp = yield* Fiber.join(never);
        assert.ok(Result.isSuccess(givenUp) && Option.isNone(givenUp.success));
        const page = yield* listMessagesPast(
          target.userId,
          target.conversationId,
          CODER_TOOL_SET,
          cursorOfWire("0:0"),
        );
        assert.ok(page.read.ok);
        assert.deepEqual(
          page.read.value
            .filter((record) => record.message.role === MESSAGE_ROLE.USER)
            .map((record) => record.message.parts.find(isTextUIPart)?.text),
          [planMarkdown(SAVED), "Keep going."],
        );
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
          task: null,
          repository: "Acme/Ledger",
        });
        assert.ok(Option.isSome(started));
        const { agent } = started.value;
        const target = { userId: owner, conversationId: agent.conversationId };
        yield* claimRuntimeSession(target, "wrun_01M0000000000000000000099", new Date());
        assert.deepEqual(
          yield* ask(messageAs(owner, agent.id, { text: "Go on.", clientKey: randomUUID() })),
          refusal(HOSTED_HTTP_STATUS.FORBIDDEN, HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE),
        );
        assert.deepEqual(eve.sent, []);
      }),
  );
});

/** A Start as the owner given, with the body given. */
/** One pull request as the test's GitHub holds it, changed by the test between reads. */
interface PullRequestFixture {
  number: number;
  state: "open" | "closed";
  draft: boolean;
  merged: boolean;
  /** Each check run's status and conclusion on its head. */
  runs: readonly { status: string; conclusion: string | null }[];
  /** Each commit status's state on its head. */
  statuses: readonly string[];
  /** Whether the App may read the head's check runs; a refusal is 403. */
  checksReadable: boolean;
}

const HEAD = { ref: "luke/teammate-invitations", sha: "0123abcd" } as const;

function pullRequestFixture(overrides: Partial<PullRequestFixture> = {}): PullRequestFixture {
  return {
    number: 41,
    state: "open",
    draft: false,
    merged: false,
    runs: [{ status: "completed", conclusion: "success" }],
    statuses: [],
    checksReadable: true,
    ...overrides,
  };
}

/**
 * The repository on the test's GitHub: the one pull request by its number
 * and by its head, the head's branch where pushed, and the head's checks.
 */
/** The repository as the test's GitHub holds it: its one pull request, where there is one, and whether the head was pushed. */
interface RepositoryFixture {
  pullRequest: PullRequestFixture | undefined;
  pushed: boolean;
}

function relayRepository(fixture: RepositoryFixture): RepositoryScript {
  const base = `/repos/${RELAY.owner}/${RELAY.name}`;
  const notFound = () => Response.json({ message: "Not Found" }, { status: 404 });
  const pullJson = (pull: PullRequestFixture) => ({
    number: pull.number,
    title: "Teammate invitations",
    html_url: `https://github.com/${RELAY_FULL_NAME}/pull/${pull.number}`,
    state: pull.state,
    draft: pull.draft,
    merged: pull.merged,
    additions: 210,
    deletions: 14,
    changed_files: 6,
    head: { ref: HEAD.ref, sha: HEAD.sha, label: `${RELAY.owner}:${HEAD.ref}` },
    user: { login: "luke[bot]", type: "Bot" },
  });
  return (sent) => {
    const url = new URL(sent.url);
    const { pathname } = url;
    if (!pathname.startsWith(base)) return undefined;
    const path = pathname.slice(base.length);
    const { pullRequest } = fixture;
    if (path === "/pulls") {
      const head = url.searchParams.get("head");
      return Response.json(
        pullRequest !== undefined && head === `${RELAY.owner}:${HEAD.ref}`
          ? [pullJson(pullRequest)]
          : [],
      );
    }
    if (path === `/pulls/${pullRequest?.number}` && pullRequest !== undefined) {
      return Response.json(pullJson(pullRequest));
    }
    if (path === `/branches/${encodeURIComponent(HEAD.ref)}`) {
      return fixture.pushed
        ? Response.json({ name: HEAD.ref, commit: { sha: HEAD.sha } })
        : notFound();
    }
    if (path === `/commits/${HEAD.sha}/check-runs` && pullRequest !== undefined) {
      return pullRequest.checksReadable
        ? Response.json({ total_count: pullRequest.runs.length, check_runs: pullRequest.runs })
        : Response.json({ message: "Resource not accessible by integration" }, { status: 403 });
    }
    if (path === `/commits/${HEAD.sha}/status` && pullRequest !== undefined) {
      return Response.json({
        state: pullRequest.statuses[0] ?? "pending",
        total_count: pullRequest.statuses.length,
        statuses: pullRequest.statuses.map((state) => ({ state })),
      });
    }
    return notFound();
  };
}

type Target = { userId: string; conversationId: string };

/** The parts of one of the agent's messages: the commands it ran, each with what it printed, then its words. */
function agentParts(calls: readonly (readonly [command: string, stdout: string])[], words: string) {
  return [
    ...calls.map(([command, stdout], index) => ({
      type: `tool-${CODER_TOOL.BASH}` as const,
      toolCallId: `call-${index}-${command.length}`,
      state: "output-available" as const,
      input: { command },
      output: { status: "completed", exitCode: 0, stdout, stderr: "" },
    })),
    { type: "text" as const, text: words },
  ];
}

/** One of the agent's own messages, as the relay writes it. */
function agentMessage(parts: ReturnType<typeof agentParts>): UIMessage {
  return {
    id: randomUUID(),
    role: MESSAGE_ROLE.ASSISTANT,
    metadata: { author: MESSAGE_AUTHOR.BRAIN },
    parts,
  };
}

/** The agent's turn written into its conversation, the messages given in order; answers the turn's id, for its end. */
const agentWroteMessages = (target: Target, messages: readonly UIMessage[]) =>
  Effect.gen(function* () {
    const writer = yield* storeWriter({ tools: CODER_TOOL_SET });
    const turnId = randomUUID();
    yield* writer.enqueueTurn(target, { turnId, origin: TURN_ORIGIN.TYPED, eveTurnId: "turn_0" });
    yield* writer.consume(target, {
      kind: BRAIN_RUN_EVENT.TURN_STARTED,
      conversationId: sessionKey(target.conversationId),
      turnId,
      sequence: 1,
      origin: BRAIN_TURN_ORIGIN.TYPED,
      trigger: BRAIN_TURN_TRIGGER.ASK,
      at: 0,
    });
    let sequence = 1;
    for (const message of messages) {
      sequence += 1;
      yield* writer.consume(target, {
        kind: BRAIN_RUN_EVENT.MESSAGE_COMPLETED,
        conversationId: sessionKey(target.conversationId),
        turnId,
        sequence,
        message,
      });
    }
    return turnId;
  });

/** The agent's turn ended well, so the agent reads as completed. */
const agentEnded = (target: Target, turnId: string) =>
  Effect.gen(function* () {
    const writer = yield* storeWriter({ tools: CODER_TOOL_SET });
    yield* writer.consume(target, {
      kind: BRAIN_RUN_EVENT.TURN_ENDED,
      conversationId: sessionKey(target.conversationId),
      turnId,
      sequence: 1_000,
      status: BRAIN_REQUEST_STATUS.SUCCEEDED,
      responseIds: [],
      at: 1,
    });
  });

/** How many times the test's GitHub was asked for a path under the repository. */
function repositoryReads(github: FakeGitHub, path: string): number {
  return github.sent.filter(
    (sent) => new URL(sent.url).pathname === `/repos/${RELAY_FULL_NAME}${path}`,
  ).length;
}

/** An agent started on the plan, with its conversation as the writer targets it. */
const startedAgent = (
  owner: string,
  planId: string,
  ask: (request: Request) => Effect.Effect<Answer>,
) =>
  Effect.gen(function* () {
    const agent = readAnswer(
      codingAgentAnswerSchema,
      HOSTED_HTTP_STATUS.CREATED,
      yield* ask(startAs(owner, planId, { idempotencyKey: randomUUID() })),
    ).agent;
    const stored = yield* readCodingAgent(owner, agent.id);
    assert.ok(Option.isSome(stored));
    return { agent, target: { userId: owner, conversationId: stored.value.conversationId } };
  });

function startAs(bearer: string | undefined, planId: string, body: WireBoundaryInput): Request {
  return request(PLAN_AGENTS, bearer, { method: "POST", id: planId, body });
}
