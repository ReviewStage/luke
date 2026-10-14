import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@sidecar/database/core/query";
import { GITHUB_ACCOUNT_TYPE } from "@sidecar/database/github-installation-vocabulary";
import { readAccountPreferences } from "@sidecar/database/models/account-store";
import { readCodingAgent } from "@sidecar/database/models/coding-agent-store";
import { sentLineId } from "@sidecar/database/models/ids";
import { sentLineStands } from "@sidecar/database/models/message-reads";
import {
  openPlanConversation,
  savePlanText,
  updatePlan,
} from "@sidecar/database/models/plan-store";
import { claimRuntimeSession } from "@sidecar/database/models/recorded-session";
import { storeWriter } from "@sidecar/database/models/writer";
import { conversations } from "@sidecar/database/schemas/storage";
import { getTestDB } from "@sidecar/database/testing";
import { HOSTED_API_ERROR } from "@sidecar/hosted";
import { accountInboxAnswerSchema } from "@sidecar/hosted/account-inbox-wire";
import {
  CODING_AGENT_BOUNDS,
  CODING_AGENT_BRIEF,
  CODING_AGENT_STATUS,
  type CodingAgentMessage,
  codingAgentAnswerSchema,
  codingAgentListAnswerSchema,
  codingAgentMessagesAnswerSchema,
} from "@sidecar/hosted/coding-agent-wire";
import {
  INBOX_BLOCK,
  INBOX_IMAGE_TYPE,
  INBOX_REPLY,
  INBOX_RESPONSE,
  type InboxImageBlock,
  type InboxPost,
  inboxAnswerSchema,
} from "@sidecar/hosted/inbox-wire";
import { CODING_AGENT_DEFAULT_CHOICE, MODEL_PROVIDER } from "@sidecar/hosted/models-wire";
import { REPOSITORY_UNREACHED } from "@sidecar/hosted/repository-reach-wire";
import { unparsedWire, type WireBoundaryInput } from "@sidecar/wire";
import { readEither } from "@sidecar/wire/effect";
import {
  Clock,
  DateTime,
  Duration,
  Effect,
  Fiber,
  Layer,
  Option,
  Redacted,
  Result,
  type Schema,
} from "effect";
import { HttpRouter } from "effect/http";
import { SqlClient } from "effect/sql";
import { TestClock } from "effect/testing";
import { codingAgentsApp } from "../server/coding-agents-app";
import {
  BRAIN_REQUEST_STATUS,
  BRAIN_RUN_EVENT,
  BRAIN_TURN_ORIGIN,
  BRAIN_TURN_TRIGGER,
  isRecord,
  isWireString,
  MESSAGE_ROLE,
  sessionKey,
  TURN_ORIGIN,
  userMessage,
  userMetadataOf,
} from "../server/core";
import { BRAIN_HOST_TURN } from "../server/hosted/brain-host/bounds";
import {
  EVE_CANCEL_OUTCOME,
  EVE_RESET_OUTCOME,
  EVE_SEND_OUTCOME,
  type EveMessage,
  type EveSessions,
  EveUnreachable,
} from "../server/hosted/brain-host/eve-sessions";
import { CODER } from "../server/hosted/coder-host/bounds";
import { CODER_TOOL_SET } from "../server/hosted/coder-host/tool-set";
import { HostedEnvironment, type HostedEnvironmentValues } from "../server/hosted/environment";
import {
  disconnectInstallation,
  LINK_OUTCOME,
  linkInstallation,
} from "../server/hosted/github-installations";
import { HOSTED_HTTP_STATUS } from "../server/hosted/http";
import { answerInboxItem, type InboxImage, postInboxItem } from "../server/hosted/inbox-store";
import { modelCatalogOf, type OfferedModel } from "../server/hosted/model-catalog";
import { plansApp } from "../server/plans-app";
import {
  connectWorkspaceGitHub,
  type FakeGitHub,
  githubReaching,
  type InstallationFixture,
  openGithubUser,
  type RepositoryScript,
} from "./support/github-app-fake";
import { fakeWorkspaceSeams, joinWorkspace, openWorkspace, startPlan } from "./support/workspaces";

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
/** One plan, served by the plans group, whose delete stops the plan's agents through the same Stop. */
const PLAN = "/api/plans/plan";

const RELAY = { owner: "Acme", name: "Relay" } as const;
const RELAY_FULL_NAME = `${RELAY.owner}/${RELAY.name}`;

/** The installation ids handed out so far: one installation stands for one workspace, so each plan's workspace connects its own. */
let installationsConnected = 0;

/** A fresh installation reaching the repository, on an account of its own. */
function freshInstallation(): InstallationFixture {
  installationsConnected += 1;
  return { id: 7 + installationsConnected, login: RELAY.owner, repositories: [RELAY] };
}

const SAVED =
  "## Goal\n\nInvite a teammate by email.\n\n## Assumptions\n\n- Invites expire after 7 days.\n";

/** The saved plan as Copy writes it, its name as a title over its text, which is what an agent started on the plan is handed. */
const SNAPSHOT = `# Teammate invitations\n\n${SAVED}`;

const SOL = "openai/gpt-6.1-sol";

/** A model offering two context windows, as OpenAI prices its long context apart. */
const GPT_LONG = "openai/gpt-5.5";

/** The models offered, each with its prices in dollars per token, one with two windows. */
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
  {
    id: GPT_LONG,
    name: "GPT-5.5",
    provider: MODEL_PROVIDER.OPENAI,
    efforts: ["low", "high"],
    contextWindow: 1_050_000,
    contextWindows: { standardTokens: 272_000, longTokens: 1_050_000 },
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
  /** Every session eve was asked to retire, in order. */
  const reset: string[] = [];
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
    reset: (sessionId) =>
      Effect.sync(() => {
        reset.push(sessionId);
        return { outcome: EVE_RESET_OUTCOME.RESET };
      }),
  });
  return { eve, opened, sent, cancelled, reset };
}

/** The deployment's environment with no key of its own, which a test gives the one it reads. */
const NO_KEYS: HostedEnvironmentValues = {
  openAiKey: undefined,
  anthropicKey: undefined,
  posthogPersonalApiKey: undefined,
  posthogProjectId: undefined,
  posthogApiHost: undefined,
  posthogProjectApiKey: undefined,
  posthogIngestHost: undefined,
  cronSecret: undefined,
  githubWebhookSecret: undefined,
  providerKeyEncryptionKeys: undefined,
};

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
  titles: boolean,
) =>
  Effect.gen(function* () {
    const client = yield* SqlClient.SqlClient;
    const services = Layer.mergeAll(
      Layer.succeed(SqlClient.SqlClient, client),
      Layer.succeed(Database, yield* Database),
      Layer.succeed(Clock.Clock, yield* Clock.Clock),
      Layer.succeed(HostedEnvironment, {
        ...NO_KEYS,
        anthropicKey: titles ? Redacted.make("sk-ant-fixture") : undefined,
      }),
      github.layer,
      modelCatalogOf(CATALOG),
    );
    const seams = {
      resolveUserId: (incoming: Request) =>
        Effect.succeed(
          Option.fromNullishOr(bearers.get(incoming.headers.get("authorization") ?? "")),
        ),
      eveOrigin: () => ORIGIN,
      eve: (authorization: Redacted.Redacted) => eve.eve(Redacted.value(authorization)),
      workspaces: yield* fakeWorkspaceSeams,
    };
    const agents = HttpRouter.toWebHandler(
      codingAgentsApp(seams).pipe(HttpRouter.provideRequest(services)),
      { disableLogger: true },
    );
    const plans = HttpRouter.toWebHandler(
      plansApp(seams).pipe(HttpRouter.provideRequest(services)),
      { disableLogger: true },
    );
    yield* Effect.addFinalizer(() =>
      Effect.promise(() => Promise.all([agents.dispose(), plans.dispose()])),
    );
    /** The response as the function answers it, for the one route that answers bytes; a plan's own path lands on the plans group. */
    const fetch = (request: Request) =>
      Effect.promise(() =>
        new URL(request.url).pathname === PLAN ? plans.handler(request) : agents.handler(request),
      );
    const ask = (request: Request) =>
      Effect.gen(function* () {
        const response = yield* fetch(request);
        const text = yield* Effect.promise(() => response.text());
        // SAFETY: the group answers JSON; the test compares it as the wire value it is, and an answer
        // with no body is compared as its text so a failure names what came back.
        const body = (text.length === 0 ? text : JSON.parse(text)) as WireBoundaryInput;
        return { status: response.status, body } satisfies Answer;
      });
    return { ask, fetch };
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
    archived?: string | undefined;
    attachment?: string;
  } = {},
): Request {
  const url = new URL(path, ORIGIN);
  if (init.id !== undefined) url.searchParams.set("id", init.id);
  if (init.archived !== undefined) url.searchParams.set("archived", init.archived);
  if (init.after !== undefined) url.searchParams.set("after", init.after);
  if (init.call !== undefined) url.searchParams.set("call", init.call);
  if (init.attachment !== undefined) url.searchParams.set("attachment", init.attachment);
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

/** The steps a read held while its agent starts is driven by: past its hold, and under the grace an agent with no turn reads as starting within. */
const STARTING_READ_STEPS =
  Math.floor(
    (Duration.toMillis(CODER.STARTING_GRACE) - Duration.toMillis(CODER.MESSAGES_HOLD)) /
      Duration.toMillis(CODER.MESSAGES_POLL),
  ) - 1;

/**
 * A held read of a starting agent driven to its answer, each step taken
 * only after a round trip to the test's database. Note that the steps are
 * paced by the database rather than by the loop, because the read reaches
 * its hold only after queries of its own: steps the loop races ahead with
 * either pass the hold before the read waits on it, leaving its join
 * waiting on a clock nothing moves, or, unbounded, carry the clock past the
 * grace so the page reads the agent failed. A round trip queued behind the
 * read's own keeps the two in step, and the bound keeps the clock inside
 * the grace whatever the database's pace.
 */
const drivenWhileStarting = <A, E>(fiber: Fiber.Fiber<A, E>) =>
  Effect.gen(function* () {
    for (let attempt = 0; attempt < STARTING_READ_STEPS; attempt += 1) {
      if (fiber.pollUnsafe() !== undefined) return yield* Fiber.join(fiber);
      yield* Effect.orDie(
        Database.use((db) => db.select({ id: conversations.id }).from(conversations).limit(1)),
      );
      yield* TestClock.adjust(CODER.MESSAGES_POLL);
      yield* Effect.yieldNow;
    }
    return yield* Fiber.join(fiber);
  });

/**
 * An owner who holds one plan on the repository, its workspace connected to
 * an installation reaching it, another account beside them, and the group
 * over that GitHub and the eve given.
 */
const openPlan = (
  options: {
    readonly repository?: string | null;
    readonly eve?: ReturnType<typeof fakeEve>;
    /** What the repository answers on its own paths, for a test of what an agent published. */
    readonly github?: RepositoryScript;
    /** Whether the deployment holds the Anthropic key workers' titles are generated on. */
    readonly titles?: boolean;
  } = {},
) =>
  Effect.gen(function* () {
    const owner = yield* openGithubUser();
    const other = yield* openGithubUser();
    const plan = yield* startPlan(owner, {
      name: "Teammate invitations",
      repository: options.repository === undefined ? RELAY_FULL_NAME : options.repository,
    });
    yield* savePlanText(owner, plan.id, SAVED);
    const installation = freshInstallation();
    assert.equal(
      yield* connectWorkspaceGitHub(plan.workspaceId, installation),
      LINK_OUTCOME.LINKED,
    );
    const bearers = new Map([
      [`Bearer ${owner}`, owner],
      [`Bearer ${other}`, other],
    ]);
    const github = githubReaching([installation], undefined, undefined, options.github);
    const eve = options.eve ?? fakeEve();
    const { ask, fetch } = yield* standing(bearers, github, eve, options.titles ?? false);
    return { owner, other, plan, installation, eve, github, ask, fetch };
  });

it.layer(getTestDB())("the coding-agent routes", (it) => {
  it.effect(
    "a member deleting a plan a teammate planned on retires the teammate's eve session before the plan goes",
    () =>
      Effect.gen(function* () {
        const { owner, other, plan, eve, ask } = yield* openPlan();
        const { conversationId } = Option.getOrThrow(yield* openPlanConversation(owner, plan.id));
        const sessionId = `wrun_${randomUUID()}`;
        assert.equal(
          yield* claimRuntimeSession({ userId: owner, conversationId }, sessionId, new Date()),
          true,
        );
        yield* joinWorkspace(plan.workspaceId, other);

        const deleted = yield* ask(request(PLAN, other, { method: "DELETE", id: plan.id }));

        assert.equal(deleted.status, HOSTED_HTTP_STATUS.OK);
        assert.deepEqual(eve.reset, [sessionId]);
      }),
  );

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
        assert.equal(stored.value.planSnapshot, SNAPSHOT);
        assert.equal(stored.value.task, null);
        assert.equal(stored.value.repository, RELAY_FULL_NAME);
        assert.deepEqual(eve.opened, [
          {
            authorization: `Bearer ${owner}`,
            message: {
              conversationId: stored.value.conversationId,
              turn: BRAIN_HOST_TURN.TYPED,
              message: SNAPSHOT,
            },
            sessionId: eve.opened[0]?.sessionId ?? "",
          },
        ]);
        // The default stands: nothing was chosen.
        assert.equal(yield* readAccountPreferences(owner), undefined);
      }),
  );

  it.effect(
    "a Start on a plan whose workspace since connected an installation GitHub does not know is refused as a connection that lapsed, and opens nothing",
    () =>
      Effect.gen(function* () {
        const { owner, plan, installation, eve, ask } = yield* openPlan();
        const linked = yield* linkInstallation(plan.workspaceId, {
          installationId: installation.id + 10_000,
          accountId: 9_008,
          accountLogin: "elsewhere",
          accountType: GITHUB_ACCOUNT_TYPE.ORGANIZATION,
        });
        assert.equal(linked, LINK_OUTCOME.LINKED);

        const started = yield* ask(startAs(owner, plan.id, { idempotencyKey: randomUUID() }));

        assert.deepEqual(started, {
          status: HOSTED_HTTP_STATUS.FORBIDDEN,
          body: {
            error: HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE,
            unreached: {
              reason: REPOSITORY_UNREACHED.CONNECTION_LAPSED,
              repository: RELAY_FULL_NAME,
            },
          },
        });
        assert.deepEqual(eve.opened, []);
      }),
  );

  it.effect(
    "a Start on a plan whose workspace has nothing connected names the owner's other workspace connected to the repository's owner, where the plan can move, and a teammate hears only that nothing is connected",
    () =>
      Effect.gen(function* () {
        const owner = yield* openGithubUser();
        const teammate = yield* openGithubUser();
        const plan = yield* startPlan(owner, {
          name: "Teammate invitations",
          repository: RELAY_FULL_NAME,
        });
        yield* joinWorkspace(plan.workspaceId, teammate);
        const team = yield* openWorkspace(owner);
        const installation = freshInstallation();
        assert.equal(yield* connectWorkspaceGitHub(team, installation), LINK_OUTCOME.LINKED);
        const eve = fakeEve();
        const { ask } = yield* standing(
          new Map([
            [`Bearer ${owner}`, owner],
            [`Bearer ${teammate}`, teammate],
          ]),
          githubReaching([installation]),
          eve,
          false,
        );

        const byOwner = yield* ask(startAs(owner, plan.id, { idempotencyKey: randomUUID() }));
        const byTeammate = yield* ask(startAs(teammate, plan.id, { idempotencyKey: randomUUID() }));

        assert.deepEqual(byOwner, {
          status: HOSTED_HTTP_STATUS.FORBIDDEN,
          body: {
            error: HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE,
            unreached: {
              reason: REPOSITORY_UNREACHED.OTHER_WORKSPACE,
              repository: RELAY_FULL_NAME,
              workspace: { id: team, name: "Test Workspace" },
            },
          },
        });
        assert.deepEqual(byTeammate, {
          status: HOSTED_HTTP_STATUS.FORBIDDEN,
          body: {
            error: HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE,
            unreached: { reason: REPOSITORY_UNREACHED.NOT_CONNECTED, repository: RELAY_FULL_NAME },
          },
        });
        assert.deepEqual(eve.opened, []);
      }),
  );

  it.effect(
    "a Start names no other workspace whose installation on the repository's owner was not given the repository",
    () =>
      Effect.gen(function* () {
        const owner = yield* openGithubUser();
        const plan = yield* startPlan(owner, {
          name: "Teammate invitations",
          repository: RELAY_FULL_NAME,
        });
        const team = yield* openWorkspace(owner);
        installationsConnected += 1;
        const ledgerOnly: InstallationFixture = {
          id: 7 + installationsConnected,
          login: RELAY.owner,
          repositories: [{ owner: RELAY.owner, name: "Ledger" }],
        };
        assert.equal(yield* connectWorkspaceGitHub(team, ledgerOnly), LINK_OUTCOME.LINKED);
        const eve = fakeEve();
        const { ask } = yield* standing(
          new Map([[`Bearer ${owner}`, owner]]),
          githubReaching([ledgerOnly]),
          eve,
          false,
        );

        const started = yield* ask(startAs(owner, plan.id, { idempotencyKey: randomUUID() }));

        assert.deepEqual(started, {
          status: HOSTED_HTTP_STATUS.FORBIDDEN,
          body: {
            error: HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE,
            unreached: { reason: REPOSITORY_UNREACHED.NOT_CONNECTED, repository: RELAY_FULL_NAME },
          },
        });
        assert.deepEqual(eve.opened, []);
      }),
  );

  it.effect(
    "a Start while GitHub does not answer is refused as GitHub unanswered, which a retry may get past, and opens nothing",
    () =>
      Effect.gen(function* () {
        const { owner, plan, eve, ask } = yield* openPlan({
          github: (sent) =>
            new URL(sent.url).pathname.startsWith("/app/installations/")
              ? Response.json({ message: "Service Unavailable" }, { status: 503 })
              : undefined,
        });

        const started = yield* ask(startAs(owner, plan.id, { idempotencyKey: randomUUID() }));

        assert.deepEqual(
          started,
          refusal(HOSTED_HTTP_STATUS.BAD_GATEWAY, HOSTED_API_ERROR.GITHUB_UNANSWERED),
        );
        assert.deepEqual(eve.opened, []);
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
          yield* drivenWhileStarting(starting),
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
            SNAPSHOT,
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

it.layer(getTestDB())("messaging a coding agent", (it) => {
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
            SNAPSHOT,
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
    "a member of the plan's workspace lists, reads, and messages an agent a teammate started, the line landing in the starter's conversation",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const { other, plan, agent, sessionId, ask, transcript } = yield* startedAgent(eve, {
          running: false,
        });
        const asOther = (text: string) =>
          ask(messageAs(other, agent.id, { text, clientKey: randomUUID() }));
        assert.deepEqual(
          yield* asOther("Before I joined."),
          refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND),
        );
        yield* joinWorkspace(plan.workspaceId, other);

        const listed = readAnswer(
          codingAgentListAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(PLAN_AGENTS, other, { id: plan.id })),
        );
        assert.deepEqual(
          listed.agents.map((each) => [each.id, each.status]),
          [[agent.id, CODING_AGENT_STATUS.COMPLETED]],
        );
        const read = readAnswer(
          codingAgentMessagesAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(AGENT_MESSAGES, other, { id: agent.id })),
        );
        assert.deepEqual(userTexts(read), [SNAPSHOT]);

        const sent = readAnswer(
          codingAgentAnswerSchema,
          HOSTED_HTTP_STATUS.ACCEPTED,
          yield* asOther("Rename the subject line too."),
        );
        assert.equal(sent.agent.status, CODING_AGENT_STATUS.RUNNING);
        assert.deepEqual(
          eve.sent.map((each) => [each.authorization, each.sessionId]),
          [[`Bearer ${other}`, sessionId]],
        );
        assert.deepEqual(yield* transcript(), {
          lines: [SNAPSHOT, "Rename the subject line too."],
          status: CODING_AGENT_STATUS.RUNNING,
        });
      }),
  );

  it.effect(
    "a message to an agent whose plan's workspace was disconnected since is refused, saying nothing is connected, and sends nothing",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const { owner, plan, agent, ask } = yield* startedAgent(eve, { running: true });
        yield* disconnectInstallation(plan.workspaceId);

        const sent = yield* ask(
          messageAs(owner, agent.id, { text: "Rebase on main.", clientKey: randomUUID() }),
        );

        assert.deepEqual(sent, {
          status: HOSTED_HTTP_STATUS.FORBIDDEN,
          body: {
            error: HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE,
            unreached: { reason: REPOSITORY_UNREACHED.NOT_CONNECTED, repository: RELAY_FULL_NAME },
          },
        });
        assert.deepEqual(eve.sent, []);
      }),
  );

  it.effect(
    "a member steers the running turn of an agent a teammate started: the words reach the starter's session and stand under the starter, so a repeat under the key sends nothing",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const { owner, other, plan, agent, target, sessionId, ask, transcript } =
          yield* startedAgent(eve, { running: true });
        yield* joinWorkspace(plan.workspaceId, other);
        const clientKey = randomUUID();
        const steer = () =>
          ask(messageAs(other, agent.id, { text: "Use seven days, not five.", clientKey }));

        readAnswer(codingAgentAnswerSchema, HOSTED_HTTP_STATUS.ACCEPTED, yield* steer());
        assert.deepEqual(
          eve.sent.map((each) => [each.authorization, each.sessionId, each.message.conversationId]),
          [[`Bearer ${other}`, sessionId, target.conversationId]],
        );
        assert.equal(
          yield* sentLineStands(owner, target.conversationId, sentLineId(clientKey)),
          true,
        );
        assert.deepEqual(yield* transcript(), {
          lines: [SNAPSHOT, "Use seven days, not five."],
          status: CODING_AGENT_STATUS.RUNNING,
        });

        readAnswer(codingAgentAnswerSchema, HOSTED_HTTP_STATUS.ACCEPTED, yield* steer());
        assert.equal(eve.sent.length, 1);
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
          lines: [SNAPSHOT, "Use the helper."],
          status: CODING_AGENT_STATUS.RUNNING,
        });
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
        assert.deepEqual((yield* transcript()).lines, [SNAPSHOT]);
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
});

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

const PLAN_INBOX = "/api/plans/inbox";
const INBOX_ITEM = "/api/inbox/item";
const ACCOUNT_INBOX = "/api/inbox";
const INBOX_ATTACHMENT = "/api/inbox/attachment";

/** The first bytes of a PNG, as a screenshot's file starts. */
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

it.layer(getTestDB())("the developer's inbox", (it) => {
  /** The owner's plan with one agent started on it, its session claimed so a message reaches it, and the inbox as each side sees it. */
  const openInbox = (eve = fakeEve()) =>
    Effect.gen(function* () {
      const opened = yield* openPlan({ eve });
      const { agent, target } = yield* startedAgent(opened.owner, opened.plan.id, opened.ask);
      const sessionId = eve.opened[0]?.sessionId ?? "";
      assert.equal(yield* claimRuntimeSession(target, sessionId, yield* DateTime.nowAsDate), true);
      const owned = { userId: opened.owner, planId: opened.plan.id, agentId: agent.id };
      /** An item posted for the agent, as its tool will post one, with the pictures its image blocks name read. */
      const post = (value: InboxPost, images?: readonly InboxImage[]) =>
        postInboxItem(owned, value, images);
      /** The plan's inbox as the owner reads it past the cursor. */
      const read = (after?: string) =>
        Effect.map(
          opened.ask(
            request(PLAN_INBOX, opened.owner, {
              id: opened.plan.id,
              ...(after === undefined ? undefined : { after }),
            }),
          ),
          (answered) => readAnswer(inboxAnswerSchema, HOSTED_HTTP_STATUS.OK, answered),
        );
      /** The owner's answer to an item, as the route answers it. */
      const answer = (itemId: string, body: WireBoundaryInput, bearer = opened.owner) =>
        opened.ask(request(INBOX_ITEM, bearer, { method: "POST", id: itemId, body }));
      /** What waits across the account, as the bearer reads it past the cursor. */
      const waiting = (after?: string, bearer = opened.owner) =>
        Effect.map(
          opened.ask(request(ACCOUNT_INBOX, bearer, after === undefined ? undefined : { after })),
          (answered) => readAnswer(accountInboxAnswerSchema, HOSTED_HTTP_STATUS.OK, answered),
        );
      return { ...opened, agent, target, post, read, answer, waiting };
    });

  const QUESTION = {
    key: "invite-copy",
    title: "What should the invitation email say?",
    response: { type: INBOX_RESPONSE.TEXT },
  } as const;

  it.effect(
    "the account's inbox answers every open item across its plans with the agent that posted it, and leaves out settled items, an archived plan's, and another account's",
    () =>
      Effect.gen(function* () {
        const { owner, other, agent, ask, post, waiting } = yield* openInbox();
        const second = yield* startPlan(owner, {
          name: "Billing export",
          repository: RELAY_FULL_NAME,
        });
        yield* savePlanText(owner, second.id, SAVED);
        const secondAgent = (yield* startedAgent(owner, second.id, ask)).agent;
        const onSecond = (value: InboxPost) =>
          postInboxItem({ userId: owner, planId: second.id, agentId: secondAgent.id }, value);
        yield* post(QUESTION);
        const settled = yield* post({ ...QUESTION, key: "settled", title: "Settled already" });
        assert.ok(Result.isSuccess(settled));
        yield* answerInboxItem(
          owner,
          settled.success.id,
          settled.success.revision,
          { reply: INBOX_REPLY.ANSWERED, note: "Done." },
          randomUUID(),
        );
        yield* onSecond({ ...QUESTION, key: "export-format", title: "CSV or JSON?" });

        const all = yield* waiting();
        assert.deepEqual(
          all.items.map((item) => [item.title, item.planId, item.agentId, item.agentModel]).sort(),
          [
            [QUESTION.title, agent.planId, agent.id, agent.model],
            ["CSV or JSON?", second.id, secondAgent.id, secondAgent.model],
          ].sort(),
        );
        assert.ok(all.items.every((item) => item.agentTitle === null));

        yield* updatePlan(owner, second.id, { archived: true });
        assert.deepEqual(
          (yield* waiting()).items.map((item) => item.title),
          [QUESTION.title],
        );
        assert.deepEqual((yield* waiting(undefined, other)).items, []);
        assert.deepEqual(
          yield* ask(request(ACCOUNT_INBOX, undefined)),
          refusal(HOSTED_HTTP_STATUS.UNAUTHORIZED, HOSTED_API_ERROR.INVALID_TOKEN),
        );
      }),
  );

  it.effect(
    "an item's attachment is served as its bytes under the type the service kept, not to be sniffed and not to be cached, to the item's account alone: another account, no bearer, another item, and a name that is no attachment are refused",
    () =>
      Effect.gen(function* () {
        const { owner, other, fetch, ask, post, read } = yield* openInbox();
        yield* post(
          {
            key: "landing",
            title: "Does the landing page read right?",
            blocks: [
              { type: INBOX_BLOCK.IMAGE, path: "shots/landing.png", alt: "The landing page" },
            ],
            response: { type: INBOX_RESPONSE.APPROVAL },
          },
          [{ contentType: INBOX_IMAGE_TYPE.PNG, bytes: PNG }],
        );
        const item = (yield* read()).items.find((each) => each.key === "landing");
        const block = item?.blocks.find(
          (each): each is InboxImageBlock => each.type === INBOX_BLOCK.IMAGE,
        );
        assert.ok(item && block);
        const at = (bearer: string | undefined, id = item.id, attachment = block.attachmentId) =>
          request(INBOX_ATTACHMENT, bearer, { id, attachment });

        const served = yield* fetch(at(owner));
        assert.equal(served.status, HOSTED_HTTP_STATUS.OK);
        assert.equal(served.headers.get("content-type"), INBOX_IMAGE_TYPE.PNG);
        assert.equal(served.headers.get("x-content-type-options"), "nosniff");
        assert.equal(served.headers.get("cache-control"), "private, no-store");
        assert.deepEqual(new Uint8Array(yield* Effect.promise(() => served.arrayBuffer())), PNG);

        assert.deepEqual(
          yield* ask(at(other)),
          refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND),
        );
        assert.deepEqual(
          yield* ask(at(undefined)),
          refusal(HOSTED_HTTP_STATUS.UNAUTHORIZED, HOSTED_API_ERROR.INVALID_TOKEN),
        );
        assert.deepEqual(
          yield* ask(at(owner, randomUUID())),
          refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND),
        );
        assert.deepEqual(
          yield* ask(at(owner, item.id, "landing.png")),
          refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND),
        );
        assert.deepEqual(
          yield* ask(
            request(INBOX_ATTACHMENT, owner, {
              method: "POST",
              id: item.id,
              attachment: block.attachmentId,
            }),
          ),
          refusal(HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED, HOSTED_API_ERROR.METHOD_NOT_ALLOWED),
        );
      }),
  );
});
