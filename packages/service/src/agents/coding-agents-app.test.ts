import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { GITHUB_ACCOUNT_TYPE } from "@luke/database/github-installation-vocabulary";
import { readAccountPreferences } from "@luke/database/models/account-store";
import { MENTIONED_HEADING } from "@luke/database/models/attached-file-parts";
import {
  createAutomation,
  recordAutomationRun,
  settleAutomationRun,
} from "@luke/database/models/automation-store";
import {
  answerAsk,
  ensureMember,
  ensurePlanChannel,
  findOrMakeDm,
  history,
  memberNamed,
  postAsk,
  postMessage,
  readAttachment,
  roster,
  unreadFor,
} from "@luke/database/models/chat-store";
import {
  archiveCodingAgent,
  readCodingAgent,
  readCodingAgentByKey,
  renameCodingAgent,
  takeCodingAgentMentionedServers,
  updateCodingAgentBranch,
} from "@luke/database/models/coding-agent-store";
import { keepConversationPicture } from "@luke/database/models/conversation-pictures";
import { childConversationId, sentLineId } from "@luke/database/models/ids";
import { listMessagesPast, sentLineStands } from "@luke/database/models/message-reads";
import { writePage } from "@luke/database/models/plan-pages";
import { claimRuntimeSession } from "@luke/database/models/recorded-session";
import { openTaskConversation, savePlanText, updateTask } from "@luke/database/models/task-store";
import { ensurePersonalWorkspace } from "@luke/database/models/workspace-store";
import { storeWriter } from "@luke/database/models/writer";
import { member, user } from "@luke/database/schemas/auth";
import { codingAgent } from "@luke/database/schemas/coding-agent";
import { githubInstallation } from "@luke/database/schemas/github-installation";
import { conversations } from "@luke/database/schemas/storage";
import { CONVERSATION_KIND, MESSAGE_SENDER } from "@luke/database/storage-vocabulary";
import {
  fakeWorkspaceSeams,
  getTestDB,
  joinWorkspace,
  openWorkspace,
  startTask,
} from "@luke/database/testing";
import { HOSTED_API_ERROR } from "@luke/features";
import { accountInboxAnswerSchema } from "@luke/features/account-inbox-wire";
import {
  AUTOMATION_ACTION,
  AUTOMATION_DEFAULT_GUARDS,
  AUTOMATION_FIRING,
  AUTOMATION_RUN_REASON,
  AUTOMATION_RUN_STATUS,
  AUTOMATION_SCOPE,
  AUTOMATION_TRIGGER,
  type AutomationFiring,
  GITHUB_TRIGGER_EVENT,
} from "@luke/features/automation-wire";
import {
  ASK_STATUS,
  CHANNEL_KIND,
  CHAT_ASK,
  CHAT_BLOCK,
  CHAT_BOUNDS,
  CHAT_IMAGE_TYPE,
  CHAT_REPLY,
  MEMBER_KIND,
  mentionedHandles,
} from "@luke/features/chat-wire";
import {
  CODING_AGENT_ARCHIVER,
  CODING_AGENT_BOUNDS,
  CODING_AGENT_BRIEF,
  CODING_AGENT_SENDER,
  CODING_AGENT_STATUS,
  type CodingAgentMessage,
  codingAgentAnswerSchema,
  codingAgentListAnswerSchema,
  codingAgentMessagesAnswerSchema,
  codingAgentPageAnswerSchema,
} from "@luke/features/coding-agent-wire";
import {
  INBOX_ANSWER_LEAD,
  INBOX_BLOCK,
  INBOX_CURSOR_START,
  INBOX_IMAGE_TYPE,
  INBOX_REPLY,
  INBOX_RESPONSE,
  type InboxImageBlock,
  type InboxPost,
  inboxAnswerSchema,
} from "@luke/features/inbox-wire";
import { INTEGRATION_PROVIDER } from "@luke/features/integration-wire";
import { MENTION_KIND, mentionMarkdown } from "@luke/features/mention-link";
import { CODING_AGENT_DEFAULT_CHOICE, MODEL_PROVIDER } from "@luke/features/models-wire";
import { REPOSITORY_UNREACHED } from "@luke/features/repository-reach-wire";
import { TASK_LIST_ARCHIVED, taskListAnswerSchema } from "@luke/features/task-wire";
import { unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import { and, eq } from "drizzle-orm";
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
  Stream,
} from "effect";
import { HttpRouter } from "effect/http";
import { SqlClient } from "effect/sql";
import { TestClock } from "effect/testing";
import {
  ACTION_RESULT_STATUS,
  AssistantMessageBuilder,
  BRAIN_REQUEST_STATUS,
  BRAIN_RUN_EVENT,
  BRAIN_TURN_ORIGIN,
  BRAIN_TURN_TRIGGER,
  isRecord,
  isWireString,
  MESSAGE_AUTHOR,
  MESSAGE_CHANNEL,
  MESSAGE_ROLE,
  sessionKey,
  TURN_ORIGIN,
  userMessage,
  userMetadataOf,
} from "../core.js";
import { HostedEnvironment, type HostedEnvironmentValues } from "../environment.js";
import { LINK_OUTCOME, linkInstallation } from "../github/github-installations.js";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import { answerInboxItem, type InboxImage, postInboxItem } from "../inbox/inbox-store.js";
import { modelCatalogOf, type OfferedModel } from "../providers/model-catalog.js";
import { tasksApp } from "../tasks/tasks-app.js";
import {
  connectWorkspaceGitHub,
  type FakeGitHub,
  githubReaching,
  type InstallationFixture,
  openGithubUser,
  type RepositoryScript,
} from "../testing/github-app-fake.js";
import { CONNECTOR_ASKED_NOTHING, integrationConnectOf } from "../testing/integration-connect.js";
import { BRAIN_HOST_TURN } from "./brain-host/bounds.js";
import {
  EVE_CANCEL_OUTCOME,
  EVE_RESET_OUTCOME,
  EVE_SEND_OUTCOME,
  type EveMessage,
  type EveSessions,
  EveUnreachable,
} from "./brain-host/eve-sessions.js";
import { CODER } from "./coder-host/bounds.js";
import {
  CHAT_DIGEST_HEADING,
  CHAT_TOOL_REFUSAL,
  type ChatAgent,
  chatDigest,
  postAsAgent,
  readAsAgent,
  resolveAsAgent,
} from "./coder-host/chat.js";
import { ASK_REFUSAL } from "./coder-host/chat-ask.js";
import { type ChatTelling, HELD_DOORS, postChat, tellMessage } from "./coder-host/chat-notify.js";
import type { InboxSandboxDoor } from "./coder-host/inbox-image.js";
import { CODER_TOOL_SET } from "./coder-host/tool-set.js";
import { CURSOR_START } from "./coder-host/transcript.js";
import { codingAgentsApp } from "./coding-agents-app.js";

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
const TASK_AGENTS = "/api/plans/agents";
const AGENT_MESSAGES = "/api/agents/messages";
const AGENT = "/api/agents/agent";
const AGENT_INBOX = "/api/agents/inbox";
const WORKSPACE_AGENTS = "/api/agents";
/** One plan, served by the plans group, whose delete stops the plan's agents through the same Stop. */
const TASK = "/api/plans/plan";
/** The account's plans, served by the plans group, each naming its agents in brief. */
const TASKS = "/api/plans";

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
    stream: () => Stream.empty,
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
      integrationConnectOf(() => CONNECTOR_ASKED_NOTHING),
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
    const tasks = HttpRouter.toWebHandler(
      tasksApp(seams).pipe(HttpRouter.provideRequest(services)),
      { disableLogger: true },
    );
    yield* Effect.addFinalizer(() =>
      Effect.promise(() => Promise.all([agents.dispose(), tasks.dispose()])),
    );
    /** The response as the function answers it, for the one route that answers bytes; a plan's own path and the list land on the plans group. */
    const fetch = (request: Request) =>
      Effect.promise(() => {
        const { pathname } = new URL(request.url);
        return pathname === TASK || pathname === TASKS
          ? tasks.handler(request)
          : agents.handler(request);
      });
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
    picture?: string;
  } = {},
): Request {
  const url = new URL(path, ORIGIN);
  if (init.id !== undefined) url.searchParams.set("id", init.id);
  if (init.archived !== undefined) url.searchParams.set("archived", init.archived);
  if (init.after !== undefined) url.searchParams.set("after", init.after);
  if (init.call !== undefined) url.searchParams.set("call", init.call);
  if (init.attachment !== undefined) url.searchParams.set("attachment", init.attachment);
  if (init.picture !== undefined) url.searchParams.set("picture", init.picture);
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
const openTask = (
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
    const task = yield* startTask(owner, {
      name: "Teammate invitations",
      repository: options.repository === undefined ? RELAY_FULL_NAME : options.repository,
    });
    yield* savePlanText(owner, task.id, SAVED);
    const installation = freshInstallation();
    assert.equal(
      yield* connectWorkspaceGitHub(task.workspaceId, installation),
      LINK_OUTCOME.LINKED,
    );
    const bearers = new Map([
      [`Bearer ${owner}`, owner],
      [`Bearer ${other}`, other],
    ]);
    const github = githubReaching([installation], undefined, undefined, options.github);
    const eve = options.eve ?? fakeEve();
    const { ask, fetch } = yield* standing(bearers, github, eve, options.titles ?? false);
    return { owner, other, task, installation, eve, github, ask, fetch };
  });

it.layer(getTestDB())("the coding-agent routes", (it) => {
  it.effect(
    "a Start whose prompt mentions a page the store cannot read is refused before any agent is made, so a retry under its key starts afresh",
    () =>
      Effect.gen(function* () {
        const { owner, task: plan, eve, ask } = yield* openTask();
        const shown = yield* writePage(owner, plan.id, { title: "Chart", html: "<h1>Chart</h1>" });
        assert.ok(Option.isSome(shown));
        const prompt = `Build ${mentionMarkdown({ kind: MENTION_KIND.PAGE, taskId: plan.id, pageId: shown.value.id }, "Chart", { workspace: "acme", repository: plan.repository })}.`;
        const idempotencyKey = randomUUID();
        const sql = yield* SqlClient.SqlClient;
        // The pages' table is moved aside for the Start alone, so the store's read of the page fails.
        const answered = yield* Effect.ensuring(
          Effect.andThen(
            sql.unsafe("ALTER TABLE plan_page_version RENAME TO plan_page_version_aside"),
            ask(startAs(owner, plan.id, { idempotencyKey, task: prompt })),
          ),
          Effect.orDie(
            sql.unsafe("ALTER TABLE plan_page_version_aside RENAME TO plan_page_version"),
          ),
        );

        assert.equal(answered.status, HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE);
        assert.ok(Option.isNone(yield* readCodingAgentByKey(owner, idempotencyKey)));
        assert.deepEqual(eve.opened, []);
      }),
  );

  it.effect(
    "a member deleting a plan a teammate planned on retires the teammate's eve session before the plan goes",
    () =>
      Effect.gen(function* () {
        const { owner, other, task, eve, ask } = yield* openTask();
        const { conversationId } = Option.getOrThrow(yield* openTaskConversation(owner, task.id));
        const sessionId = `wrun_${randomUUID()}`;
        assert.equal(
          yield* claimRuntimeSession({ userId: owner, conversationId }, sessionId, new Date()),
          true,
        );
        yield* joinWorkspace(task.workspaceId, other);

        const deleted = yield* ask(request(TASK, other, { method: "DELETE", id: task.id }));

        assert.equal(deleted.status, HOSTED_HTTP_STATUS.OK);
        assert.deepEqual(eve.reset, [sessionId]);
      }),
  );

  it.effect(
    "a workspace's agents are listed newest first for a member, narrowed to a repository whatever its case, and refused for an account outside it or a list naming no workspace",
    () =>
      Effect.gen(function* () {
        const { owner, other, task, ask } = yield* openTask();
        const start = () =>
          Effect.map(
            ask(
              request(TASK_AGENTS, owner, {
                method: "POST",
                id: task.id,
                body: { idempotencyKey: randomUUID() },
              }),
            ),
            (started) =>
              readAnswer(codingAgentAnswerSchema, HOSTED_HTTP_STATUS.CREATED, started).agent.id,
          );
        const first = yield* start();
        yield* TestClock.adjust(Duration.seconds(1));
        const second = yield* start();
        const listed = (by: string, query: Readonly<Record<string, string>>) => {
          const url = new URL(WORKSPACE_AGENTS, ORIGIN);
          for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
          return ask(new Request(url, { headers: { authorization: `Bearer ${by}` } }));
        };
        const ids = (answered: Answer) =>
          readAnswer(codingAgentListAnswerSchema, HOSTED_HTTP_STATUS.OK, answered).agents.map(
            (agent) => agent.id,
          );

        assert.deepEqual(ids(yield* listed(owner, { workspaceId: task.workspaceId })), [
          second,
          first,
        ]);
        assert.deepEqual(
          ids(yield* listed(owner, { workspaceId: task.workspaceId, repository: "acme/relay" })),
          [second, first],
        );
        assert.deepEqual(
          ids(yield* listed(owner, { workspaceId: task.workspaceId, repository: "acme/other" })),
          [],
        );
        assert.deepEqual(
          [
            (yield* listed(other, { workspaceId: task.workspaceId })).status,
            (yield* listed(owner, {})).status,
          ],
          [HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_HTTP_STATUS.BAD_REQUEST],
        );
      }),
  );

  it.effect(
    "a workspace's list leaves an archived agent out, and lists it marked as archived where archived=include asks",
    () =>
      Effect.gen(function* () {
        const { owner, task, ask } = yield* openTask();
        const kept = yield* startedAgentOf(owner, task.id, ask);
        const put = yield* startedAgentOf(owner, task.id, ask);
        yield* archiveCodingAgent(owner, put.agent.id, true);
        const listed = (query: Readonly<Record<string, string>>) => {
          const url = new URL(WORKSPACE_AGENTS, ORIGIN);
          url.searchParams.set("workspaceId", task.workspaceId);
          for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
          return Effect.map(
            ask(new Request(url, { headers: { authorization: `Bearer ${owner}` } })),
            (answered) =>
              readAnswer(codingAgentListAnswerSchema, HOSTED_HTTP_STATUS.OK, answered).agents.map(
                (agent) => [agent.id, agent.archivedAt !== undefined],
              ),
          );
        };

        assert.deepEqual(yield* listed({}), [[kept.agent.id, false]]);
        assert.deepEqual(
          (yield* listed({ archived: "include" })).toSorted(([first], [second]) =>
            String(first).localeCompare(String(second)),
          ),
          [
            [kept.agent.id, false],
            [put.agent.id, true],
          ].toSorted(([first], [second]) => String(first).localeCompare(String(second))),
        );
      }),
  );

  it.effect(
    "a workspace's list finds the agents whose title or task's name holds the words, whatever their case, a wildcard in them matched as itself",
    () =>
      Effect.gen(function* () {
        const { owner, task, ask } = yield* openTask();
        const titled = yield* startedAgentOf(owner, task.id, ask);
        const other = yield* startedAgentOf(owner, task.id, ask);
        yield* renameCodingAgent(owner, titled.agent.id, "Ledger 100% sweep");
        yield* renameCodingAgent(owner, other.agent.id, "Unrelated");
        const found = (words: string) => {
          const url = new URL(WORKSPACE_AGENTS, ORIGIN);
          url.searchParams.set("workspaceId", task.workspaceId);
          url.searchParams.set("words", words);
          return Effect.map(
            ask(new Request(url, { headers: { authorization: `Bearer ${owner}` } })),
            (answered) =>
              readAnswer(codingAgentListAnswerSchema, HOSTED_HTTP_STATUS.OK, answered)
                .agents.map((agent) => agent.id)
                .toSorted(),
          );
        };

        assert.deepEqual(yield* found("LEDGER"), [titled.agent.id]);
        assert.deepEqual(yield* found("100%"), [titled.agent.id]);
        assert.deepEqual(yield* found("10_%"), []);
        assert.deepEqual(
          yield* found("teammate invitations"),
          [titled.agent.id, other.agent.id].toSorted(),
          "the task's name finds every agent on it",
        );
      }),
  );

  it.effect(
    "a Start with no choice runs on the account's default, snapshots the plan as Copy would, and opens the session as the developer with the snapshot first",
    () =>
      Effect.gen(function* () {
        const { owner, task, eve, ask } = yield* openTask();
        const key = randomUUID();

        const started = yield* ask(
          request(TASK_AGENTS, owner, {
            method: "POST",
            id: task.id,
            body: { idempotencyKey: key },
          }),
        );

        const { agent } = readAnswer(codingAgentAnswerSchema, HOSTED_HTTP_STATUS.CREATED, started);
        assert.equal(agent.planId, task.id);
        assert.equal(agent.model, CODING_AGENT_DEFAULT_CHOICE.model);
        assert.equal(agent.effort, CODING_AGENT_DEFAULT_CHOICE.effort);
        assert.equal(agent.status, CODING_AGENT_STATUS.STARTING);
        assert.equal(agent.turnId, null);
        assert.equal(agent.brief, CODING_AGENT_BRIEF.PLAN);
        const stored = yield* readCodingAgent(owner, agent.id);
        assert.ok(Option.isSome(stored));
        assert.equal(stored.value.planSnapshot, SNAPSHOT);
        assert.equal(stored.value.prompt, null);
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
    "a Start on a plan whose workspace's account since reinstalled the App under an id GitHub does not know is refused as a connection that lapsed, and opens nothing",
    () =>
      Effect.gen(function* () {
        const { owner, task, installation, eve, ask } = yield* openTask();
        const linked = yield* linkInstallation(task.workspaceId, {
          installationId: installation.id + 10_000,
          accountId: installation.accountId ?? 50_000 + installation.id,
          accountLogin: installation.login,
          accountType: GITHUB_ACCOUNT_TYPE.ORGANIZATION,
          suspended: false,
        });
        assert.equal(linked, LINK_OUTCOME.LINKED);

        const started = yield* ask(startAs(owner, task.id, { idempotencyKey: randomUUID() }));

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
        const task = yield* startTask(owner, {
          name: "Teammate invitations",
          repository: RELAY_FULL_NAME,
        });
        yield* joinWorkspace(task.workspaceId, teammate);
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

        const byOwner = yield* ask(startAs(owner, task.id, { idempotencyKey: randomUUID() }));
        const byTeammate = yield* ask(startAs(teammate, task.id, { idempotencyKey: randomUUID() }));

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
    "a Start that names the owner's own first workspace as where the plan can move names it by the owner's name as it stands now",
    () =>
      Effect.gen(function* () {
        const owner = yield* openGithubUser();
        const task = yield* startTask(owner, {
          name: "Teammate invitations",
          repository: RELAY_FULL_NAME,
        });
        const personal = yield* ensurePersonalWorkspace(owner, yield* fakeWorkspaceSeams);
        assert.ok(Option.isSome(personal));
        const installation = freshInstallation();
        assert.equal(
          yield* connectWorkspaceGitHub(personal.value, installation),
          LINK_OUTCOME.LINKED,
        );
        yield* Database.use((db) =>
          db.update(user).set({ name: "Ada Lovelace" }).where(eq(user.id, owner)),
        );
        const { ask } = yield* standing(
          new Map([[`Bearer ${owner}`, owner]]),
          githubReaching([installation]),
          fakeEve(),
          false,
        );

        const started = yield* ask(startAs(owner, task.id, { idempotencyKey: randomUUID() }));

        assert.deepEqual(started, {
          status: HOSTED_HTTP_STATUS.FORBIDDEN,
          body: {
            error: HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE,
            unreached: {
              reason: REPOSITORY_UNREACHED.OTHER_WORKSPACE,
              repository: RELAY_FULL_NAME,
              workspace: { id: personal.value, name: "Ada Lovelace" },
            },
          },
        });
      }),
  );

  it.effect(
    "a Start names no other workspace whose installation on the repository's owner was not given the repository",
    () =>
      Effect.gen(function* () {
        const owner = yield* openGithubUser();
        const task = yield* startTask(owner, {
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

        const started = yield* ask(startAs(owner, task.id, { idempotencyKey: randomUUID() }));

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
        const { owner, task, eve, ask } = yield* openTask({
          github: (sent) =>
            new URL(sent.url).pathname.startsWith("/app/installations/")
              ? Response.json({ message: "Service Unavailable" }, { status: 503 })
              : undefined,
        });

        const started = yield* ask(startAs(owner, task.id, { idempotencyKey: randomUUID() }));

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
        const { owner, other, task, ask } = yield* openTask();
        const first = readAnswer(
          codingAgentAnswerSchema,
          HOSTED_HTTP_STATUS.CREATED,
          yield* ask(startAs(owner, task.id, { idempotencyKey: randomUUID() })),
        ).agent;
        yield* TestClock.adjust(Duration.minutes(1));
        const second = readAnswer(
          codingAgentAnswerSchema,
          HOSTED_HTTP_STATUS.CREATED,
          yield* ask(startAs(owner, task.id, { idempotencyKey: randomUUID() })),
        ).agent;
        const stored = yield* readCodingAgent(owner, second.id);
        assert.ok(Option.isSome(stored));
        const writer = yield* storeWriter({ tools: CODER_TOOL_SET });
        const target = { userId: owner, conversationId: stored.value.conversationId };
        yield* writer.enqueueTurn(target, { origin: TURN_ORIGIN.TYPED, eveTurnId: "turn_0" });

        const listed = readAnswer(
          codingAgentListAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(TASK_AGENTS, owner, { id: task.id })),
        );
        assert.deepEqual(
          listed.agents.map((agent) => [agent.id, agent.status]),
          [
            [first.id, CODING_AGENT_STATUS.STARTING],
            [second.id, CODING_AGENT_STATUS.RUNNING],
          ],
        );
        assert.deepEqual(
          yield* ask(request(TASK_AGENTS, other, { id: task.id })),
          refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND),
        );
      }),
  );

  it.effect(
    "the transcript answers the conversation's rows past the cursor, with the cursor to read on from, and a cursor outside its shape is refused",
    () =>
      Effect.gen(function* () {
        const { owner, other, task, ask } = yield* openTask();
        const agent = readAnswer(
          codingAgentAnswerSchema,
          HOSTED_HTTP_STATUS.CREATED,
          yield* ask(startAs(owner, task.id, { idempotencyKey: randomUUID() })),
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
      const opened = yield* openTask({ eve });
      const agent = readAnswer(
        codingAgentAnswerSchema,
        HOSTED_HTTP_STATUS.CREATED,
        yield* opened.ask(startAs(opened.owner, opened.task.id, { idempotencyKey: randomUUID() })),
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
    "a member's Archive of a teammate's agent records the member on it, which its summary names, and an Unarchive clears it",
    () =>
      Effect.gen(function* () {
        const { other, task, agent, ask } = yield* startedAgent(fakeEve(), { running: false });
        yield* joinWorkspace(task.workspaceId, other);
        const changed = (archived: boolean) =>
          Effect.map(
            ask(request(AGENT, other, { method: "PATCH", id: agent.id, body: { archived } })),
            (answered) =>
              readAnswer(codingAgentAnswerSchema, HOSTED_HTTP_STATUS.OK, answered).agent,
          );

        const archived = yield* changed(true);
        assert.ok(archived.archivedAt !== undefined);
        assert.equal(archived.archivedBy?.by, CODING_AGENT_ARCHIVER.MEMBER);
        assert.equal(archived.archivedBy?.member?.userId, other);
        assert.equal(archived.archivedBy?.agent, undefined);
        const back = yield* changed(false);
        assert.deepEqual([back.archivedAt, back.archivedBy], [undefined, undefined]);
      }),
  );

  it.effect(
    "a message the running turn took in after its second step reads as arriving after that step of the turn's journal, which closes behind it, while the line that opened the turn names no place",
    () =>
      Effect.gen(function* () {
        const { agent, ask, owner, target, writer, turnId, sent } = yield* startedAgent(fakeEve(), {
          running: true,
        });
        const turn = { conversationId: sessionKey(target.conversationId), turnId };
        /** The turn's step begun, as the relay tells the step's start. */
        const stepBegun = (step: number) =>
          writer.consume(target, {
            ...turn,
            kind: BRAIN_RUN_EVENT.STEP_STARTED,
            sequence: step + 2,
            step,
          });
        yield* stepBegun(1);
        yield* stepBegun(2);
        yield* sent("Rename the subject line too.");
        yield* writer.takeAwaitingLine(target, { text: "Rename the subject line too.", turnId });
        yield* stepBegun(3);
        const answer = new AssistantMessageBuilder();
        for (const _step of [1, 2, 3]) answer.stepStart();
        answer.text("Renamed it.");
        yield* writer.consume(target, {
          ...turn,
          kind: BRAIN_RUN_EVENT.MESSAGE_COMPLETED,
          sequence: 6,
          message: answer.finish(randomUUID()),
        });

        const page = readAnswer(
          codingAgentMessagesAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(AGENT_MESSAGES, owner, { id: agent.id })),
        );
        const journal = page.messages.find((each) => each.role === MESSAGE_ROLE.ASSISTANT);
        assert.ok(journal);
        // The closed journal stands behind the line it took, so the order alone would draw the line ahead of the turn.
        assert.deepEqual(
          page.messages.map((each) => [each.role, each.arrivedIn]),
          [
            [MESSAGE_ROLE.USER, undefined],
            [MESSAGE_ROLE.USER, { journalId: journal.id, afterStep: 2 }],
            [MESSAGE_ROLE.ASSISTANT, undefined],
          ],
        );
      }),
  );

  it.effect(
    "a member of the plan's workspace lists, reads, and messages an agent a teammate started, named as its starter, the line landing in the starter's conversation",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const { owner, other, task, agent, sessionId, ask, transcript } = yield* startedAgent(eve, {
          running: false,
        });
        const asOther = (text: string) =>
          ask(messageAs(other, agent.id, { text, clientKey: randomUUID() }));
        assert.deepEqual(
          yield* asOther("Before I joined."),
          refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND),
        );
        yield* joinWorkspace(task.workspaceId, other);

        const listed = readAnswer(
          codingAgentListAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(TASK_AGENTS, other, { id: task.id })),
        );
        assert.deepEqual(
          listed.agents.map((each) => [each.id, each.status]),
          [[agent.id, CODING_AGENT_STATUS.COMPLETED]],
        );
        // The teammate reads whose agent it is, which the window says as "Started by".
        assert.deepEqual(
          listed.agents.map((each) => each.startedBy?.userId),
          [owner],
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
        assert.equal(sent.agent.startedBy?.userId, owner);
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
    "the plan list a teammate reads names the member who started each of the plan's agents, by the name their account holds now",
    () =>
      Effect.gen(function* () {
        const { owner, other, task, agent, ask } = yield* startedAgent(fakeEve(), {
          running: false,
        });
        yield* joinWorkspace(task.workspaceId, other);
        yield* Database.use((db) =>
          db.update(user).set({ name: "Charles Pan" }).where(eq(user.id, owner)),
        );

        const listed = readAnswer(
          taskListAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(TASKS, other)),
        );
        assert.deepEqual(
          listed.plans
            .find((each) => each.id === task.id)
            ?.agents?.agents.map((each) => [each.id, each.startedBy]),
          [[agent.id, { userId: owner, name: "Charles Pan" }]],
        );
      }),
  );

  it.effect(
    "an agent an automation's run started names the automation on the plan's agent list and on the plan list's line, and one started by hand names none",
    () =>
      Effect.gen(function* () {
        const { owner, task, agent, ask } = yield* startedAgent(fakeEve(), { running: false });
        const automationIds = () =>
          Effect.gen(function* () {
            const agents = readAnswer(
              codingAgentListAnswerSchema,
              HOSTED_HTTP_STATUS.OK,
              yield* ask(request(TASK_AGENTS, owner, { id: task.id })),
            );
            const tasks = readAnswer(
              taskListAnswerSchema,
              HOSTED_HTTP_STATUS.OK,
              yield* ask(request(TASKS, owner)),
            );
            const line = tasks.plans.find((each) => each.id === task.id)?.agents?.agents[0];
            return [agents.agents[0]?.automationId, line?.automationId];
          });
        assert.deepEqual(yield* automationIds(), [undefined, undefined]);

        const made = yield* createAutomation(owner, {
          taskId: task.id,
          name: "Morning Sentry triage",
          scope: AUTOMATION_SCOPE.PERSONAL,
          trigger: { kind: AUTOMATION_TRIGGER.SCHEDULE, cron: "0 9 * * 1-5", timezone: "UTC" },
          action: { kind: AUTOMATION_ACTION.CODING_AGENT, prompt: "Triage Sentry." },
          guards: AUTOMATION_DEFAULT_GUARDS,
          nextRunAt: new Date("2026-10-16T09:00:00Z"),
          webhookSecretHash: null,
        });
        const automationId = Option.getOrThrow(made).id;
        yield* Database.use((db) =>
          db.update(codingAgent).set({ automationId }).where(eq(codingAgent.id, agent.id)),
        );

        assert.deepEqual(yield* automationIds(), [automationId, automationId]);
      }),
  );

  it.effect(
    "an agent with no plan is messaged and read like any other, its summary naming no plan, by a member of its workspace",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const { owner, task, agent, sessionId, ask } = yield* startedAgent(eve, { running: false });
        // An automation's run leaves an agent so: in its workspace, on no plan.
        yield* Database.use((db) =>
          db
            .update(codingAgent)
            .set({ taskId: null, organizationId: task.workspaceId })
            .where(eq(codingAgent.id, agent.id)),
        );

        const sent = readAnswer(
          codingAgentAnswerSchema,
          HOSTED_HTTP_STATUS.ACCEPTED,
          yield* ask(
            messageAs(owner, agent.id, { text: "Rebase on main.", clientKey: randomUUID() }),
          ),
        );
        const read = readAnswer(
          codingAgentMessagesAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(AGENT_MESSAGES, owner, { id: agent.id })),
        );

        assert.deepEqual([sent.agent.id, sent.agent.planId], [agent.id, null]);
        assert.deepEqual(userTexts(read), [SNAPSHOT, "Rebase on main."]);
        assert.deepEqual(
          eve.sent.map((each) => each.sessionId),
          [sessionId],
        );
      }),
  );

  it.effect(
    "an agent reads as its own page by its id, its plan named, and with no plan once an automation's run left it so, for a member of its workspace and no one else",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const { owner, other, task, agent, ask } = yield* startedAgent(eve, { running: false });
        const page = () =>
          Effect.map(ask(request(AGENT, owner, { id: agent.id })), (answered) =>
            readAnswer(codingAgentPageAnswerSchema, HOSTED_HTTP_STATUS.OK, answered),
          );

        const onTask = yield* page();
        yield* Database.use((db) =>
          db
            .update(codingAgent)
            .set({ taskId: null, organizationId: task.workspaceId })
            .where(eq(codingAgent.id, agent.id)),
        );
        const taskless = yield* page();
        const outside = yield* ask(request(AGENT, other, { id: agent.id }));

        assert.deepEqual(
          [onTask.agent.id, onTask.agent.planId, onTask.agent.workspaceId, onTask.agent.repository],
          [agent.id, task.id, task.workspaceId, RELAY_FULL_NAME],
        );
        assert.deepEqual(
          [taskless.agent.planId, taskless.agent.automationId, taskless.agent.workspaceId],
          [null, null, task.workspaceId],
        );
        assert.equal(taskless.agent.status, CODING_AGENT_STATUS.COMPLETED);
        assert.deepEqual(
          outside,
          refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND),
        );
      }),
  );

  it.effect(
    "an automation's agent reads as its page with the run that started it: the automation's name, the prompt alone, the pull request its event named, and who asked for a run now",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const { owner, task: plan, agent, ask } = yield* startedAgent(eve, { running: false });
        const ranAs = (firing: AutomationFiring) =>
          Effect.gen(function* () {
            yield* Database.use((db) =>
              db
                .update(codingAgent)
                .set({
                  taskId: null,
                  organizationId: plan.workspaceId,
                  automationOrigin: { name: "Code review", firing, prompt: "Review it." },
                })
                .where(eq(codingAgent.id, agent.id)),
            );
            return readAnswer(
              codingAgentPageAnswerSchema,
              HOSTED_HTTP_STATUS.OK,
              yield* ask(request(AGENT, owner, { id: agent.id })),
            ).agent;
          });

        const reviewed = yield* ranAs({
          kind: AUTOMATION_FIRING.GITHUB,
          event: GITHUB_TRIGGER_EVENT.PULL_REQUEST_OPENED,
          repository: RELAY_FULL_NAME,
          number: 2905,
          title: "View commands",
          url: "https://github.com/acme/relay/pull/2905",
        });
        const ranNow = yield* ranAs({ kind: AUTOMATION_FIRING.MANUAL, userId: owner });

        assert.equal(reviewed.automationName, "Code review");
        assert.deepEqual(reviewed.origin, {
          prompt: "Review it.",
          subject: {
            number: 2905,
            title: "View commands",
            url: "https://github.com/acme/relay/pull/2905",
          },
        });
        assert.equal(ranNow.origin?.runBy?.userId, owner);
        assert.equal(ranNow.origin?.subject, undefined);
      }),
  );

  it.effect(
    "the plan list names the teammate who archived an agent with no plan, as its own page does",
    () =>
      Effect.gen(function* () {
        const { owner, other, task, agent, ask } = yield* startedAgent(fakeEve(), {
          running: false,
        });
        yield* joinWorkspace(task.workspaceId, other);
        yield* Database.use((db) =>
          db
            .update(codingAgent)
            .set({ taskId: null, organizationId: task.workspaceId })
            .where(eq(codingAgent.id, agent.id)),
        );
        yield* ask(
          request(AGENT, other, { method: "PATCH", id: agent.id, body: { archived: true } }),
        );

        const listed = readAnswer(
          taskListAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(TASKS, owner, { archived: TASK_LIST_ARCHIVED.INCLUDE })),
        );
        const by = listed.planlessAgents?.find((each) => each.id === agent.id)?.archivedBy;
        assert.equal(by?.by, CODING_AGENT_ARCHIVER.MEMBER);
        assert.equal(by?.member?.userId, other);
        assert.ok((by?.member?.name ?? "") !== "", JSON.stringify(by));
      }),
  );

  it.effect(
    "the plan list carries an agent with no plan beside the plans, as its own page reads it and when it last moved, for a member of its workspace, an archived one only where asked for, and for no one else",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const {
          owner,
          other,
          task: plan,
          agent,
          ask,
        } = yield* startedAgent(eve, { running: false });
        yield* Database.use((db) =>
          db
            .update(codingAgent)
            .set({ taskId: null, organizationId: plan.workspaceId })
            .where(eq(codingAgent.id, agent.id)),
        );
        const listed = (bearer: string, archived?: string) =>
          Effect.map(ask(request(TASKS, bearer, { archived })), (answered) =>
            readAnswer(taskListAnswerSchema, HOSTED_HTTP_STATUS.OK, answered),
          );
        const page = readAnswer(
          codingAgentPageAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(AGENT, owner, { id: agent.id })),
        ).agent;

        const standing = yield* listed(owner);
        const outside = yield* listed(other);
        yield* Database.use((db) =>
          db
            .update(codingAgent)
            .set({ archivedAt: new Date() })
            .where(eq(codingAgent.id, agent.id)),
        );
        const archived = yield* listed(owner);
        const included = yield* listed(owner, TASK_LIST_ARCHIVED.INCLUDE);

        const [only, ...rest] = standing.planlessAgents ?? [];
        assert.ok(only !== undefined);
        const { activityAt, ...read } = only;
        assert.deepEqual([read, rest], [page, []]);
        assert.ok(activityAt >= page.createdAt);
        assert.equal(standing.plans.find((each) => each.id === plan.id)?.agents, undefined);
        assert.deepEqual(outside.planlessAgents, []);
        assert.deepEqual(archived.planlessAgents, []);
        assert.deepEqual(
          included.planlessAgents?.map((each) => each.id),
          [agent.id],
        );
      }),
  );

  it.effect(
    "a member's PATCH pins an agent with no plan in their own plan list and unpins it again, and pins nothing for an account outside its workspace",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const {
          owner,
          other,
          task: plan,
          agent,
          ask,
        } = yield* startedAgent(eve, { running: false });
        yield* Database.use((db) =>
          db
            .update(codingAgent)
            .set({ taskId: null, organizationId: plan.workspaceId })
            .where(eq(codingAgent.id, agent.id)),
        );
        const pin = (bearer: string, pinned: boolean) =>
          ask(request(AGENT, bearer, { method: "PATCH", id: agent.id, body: { pinned } }));
        const pinnedAt = (bearer: string) =>
          Effect.map(
            ask(request(TASKS, bearer)),
            (answered) =>
              readAnswer(
                taskListAnswerSchema,
                HOSTED_HTTP_STATUS.OK,
                answered,
              ).planlessAgents?.find((each) => each.id === agent.id)?.pinnedAt,
          );
        const at = yield* Clock.currentTimeMillis;

        const pinned = yield* pin(owner, true);
        const refused = yield* pin(other, true);
        const held = yield* pinnedAt(owner);
        yield* pin(owner, false);
        const unpinned = yield* pinnedAt(owner);

        assert.equal(
          readAnswer(codingAgentAnswerSchema, HOSTED_HTTP_STATUS.OK, pinned).agent.id,
          agent.id,
        );
        assert.equal(refused.status, HOSTED_HTTP_STATUS.NOT_FOUND);
        assert.equal(held, at);
        assert.equal(unpinned, undefined);
      }),
  );

  it.effect(
    "an agent's inbox reads by the agent for a member of its workspace, an agent with no plan among them, and as not found for anyone else",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const { owner, other, task, agent, ask } = yield* startedAgent(eve, { running: false });
        yield* Database.use((db) =>
          db
            .update(codingAgent)
            .set({ taskId: null, organizationId: task.workspaceId })
            .where(eq(codingAgent.id, agent.id)),
        );
        const posted = yield* postInboxItem(
          { userId: owner, taskId: null, agentId: agent.id },
          { key: "which-queue", title: "Which queue?", response: { type: INBOX_RESPONSE.TEXT } },
        );
        assert.ok(Result.isSuccess(posted));

        const read = readAnswer(
          inboxAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(AGENT_INBOX, owner, { id: agent.id, after: INBOX_CURSOR_START })),
        );
        const outside = yield* ask(
          request(AGENT_INBOX, other, { id: agent.id, after: INBOX_CURSOR_START }),
        );

        assert.deepEqual(
          read.items.map((item) => [item.id, item.title]),
          [[posted.success.id, "Which queue?"]],
        );
        assert.deepEqual(
          outside,
          refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND),
        );
      }),
  );

  it.effect(
    "a message to an agent whose plan's workspace holds no installation any more is refused, saying nothing is connected, and sends nothing",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const { owner, task, agent, ask } = yield* startedAgent(eve, { running: true });
        yield* Database.use((db) =>
          db
            .delete(githubInstallation)
            .where(eq(githubInstallation.organizationId, task.workspaceId)),
        );

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
        const { owner, other, task, agent, target, sessionId, ask, transcript } =
          yield* startedAgent(eve, { running: true });
        yield* joinWorkspace(task.workspaceId, other);
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
    "each member's line to an agent names them as its sender, by the name their account holds now, a line from before senders were kept names nobody, and a member whose account is gone reads as a former member",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const { owner, other, task, agent, ask, sent, writer, target } = yield* startedAgent(eve, {
          running: true,
        });
        yield* joinWorkspace(task.workspaceId, other);
        yield* Database.use((db) =>
          db.update(user).set({ name: "Dean Stratakos" }).where(eq(user.id, owner)),
        );
        yield* Database.use((db) =>
          db.update(user).set({ name: "Charles Pan" }).where(eq(user.id, other)),
        );
        yield* sent("Use seven days.");
        readAnswer(
          codingAgentAnswerSchema,
          HOSTED_HTTP_STATUS.ACCEPTED,
          yield* ask(messageAs(other, agent.id, { text: "Not five.", clientKey: randomUUID() })),
        );
        // Luke's line from a call, an automation's run's, and another coding agent's, written as their sends write them.
        for (const [text, sender] of [
          ["Rebase on main.", { kind: MESSAGE_SENDER.LUKE }],
          ["Triage the failures.", { kind: MESSAGE_SENDER.AUTOMATION, name: "Nightly triage" }],
          ["Take the split view.", { kind: MESSAGE_SENDER.AGENT, name: "Add PR overview tab" }],
        ] as const) {
          yield* writer.writeAwaitingLine(
            target,
            { text, clientKey: randomUUID(), sender },
            Effect.succeed(true),
          );
        }
        /** Each of the developer's lines as a member reads the page, beside what sent it. */
        const sendersAs = (reader: string) =>
          Effect.map(ask(request(AGENT_MESSAGES, reader, { id: agent.id })), (answered) =>
            readAnswer(codingAgentMessagesAnswerSchema, HOSTED_HTTP_STATUS.OK, answered)
              .messages.filter((message) => message.role === MESSAGE_ROLE.USER)
              .map((message) => [userTexts({ messages: [message] })[0], message.sentBy]),
          );

        const named = [
          // The task the relay wrote as the turn received it keeps no sender.
          [SNAPSHOT, undefined],
          [
            "Use seven days.",
            { userId: owner, name: "Dean Stratakos", kind: CODING_AGENT_SENDER.MEMBER },
          ],
          ["Not five.", { userId: other, name: "Charles Pan", kind: CODING_AGENT_SENDER.MEMBER }],
          // Luke and an automation are named by kind, so the window draws each as itself.
          ["Rebase on main.", { name: "Luke", kind: CODING_AGENT_SENDER.LUKE }],
          [
            "Triage the failures.",
            { name: "Nightly triage", kind: CODING_AGENT_SENDER.AUTOMATION },
          ],
          // Another agent is marked as one beside its name, with no kind an older window would refuse.
          ["Take the split view.", { name: "Add PR overview tab", agent: true }],
        ];
        assert.deepEqual(yield* sendersAs(owner), named);
        assert.deepEqual(yield* sendersAs(other), named);

        yield* Database.use((db) => db.delete(user).where(eq(user.id, other)));
        assert.deepEqual((yield* sendersAs(owner))[2], [
          "Not five.",
          { name: "Former member", kind: CODING_AGENT_SENDER.FORMER },
        ]);
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
    "a message mentioning a section of the agent's plan hands eve the section as it stands beside the words, and the line reads as the words alone",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const { task, transcript, sent } = yield* startedAgent(eve, { running: true });
        const words = `Do what ${mentionMarkdown({ kind: MENTION_KIND.SECTION, taskId: task.id, anchor: "goal" }, "Goal", { workspace: "acme", repository: task.repository })} says.`;

        yield* sent(words);

        assert.deepEqual(eve.sent.at(-1)?.message.message, [
          { type: "text", text: words },
          {
            type: "text",
            text: `${MENTIONED_HEADING}\n\nThe plan's section "Goal":\n\n## Goal\n\nInvite a teammate by email.`,
          },
        ]);
        assert.deepEqual((yield* transcript()).lines, [SNAPSHOT, words]);
      }),
  );

  it.effect(
    "a message mentioning a page and another agent of the plan hands eve the page by its id with its HTML and the agent by its id and branch, never its conversation",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const { owner, task: plan, ask, sent } = yield* startedAgent(eve, { running: true });
        const other = yield* startedAgentOf(owner, plan.id, ask);
        yield* updateCodingAgentBranch(owner, other.agent.id, "luke/store-invitations");
        const shown = yield* writePage(owner, plan.id, {
          title: "Invites by week",
          html: "<h1>Invites by week</h1>",
        });
        assert.ok(Option.isSome(shown));
        const place = { workspace: "acme", repository: plan.repository };
        const words = `Build what ${mentionMarkdown({ kind: MENTION_KIND.PAGE, taskId: plan.id, pageId: shown.value.id }, "Invites by week", place)} shows on ${mentionMarkdown({ kind: MENTION_KIND.AGENT, taskId: plan.id, agentId: other.agent.id }, "Store", place)}.`;

        yield* sent(words);

        const message = eve.sent.at(-1)?.message.message;
        assert.ok(Array.isArray(message));
        const [said, part] = message;
        assert.deepEqual(said, { type: "text", text: words });
        assert.ok(part?.type === "text");
        assert.ok(part.text.startsWith(MENTIONED_HEADING), part.text);
        assert.match(
          part.text,
          new RegExp(
            `the page "Invites by week" \\(id \`${shown.value.id}\`, version 1\\)[^]*<h1>Invites by week</h1>`,
            "u",
          ),
        );
        assert.match(
          part.text,
          new RegExp(
            `\\(id \`${other.agent.id}\`\\) working in \`${RELAY_FULL_NAME}\` on the branch \`luke/store-invitations\``,
            "u",
          ),
        );
        assert.match(part.text, /git fetch origin luke\/store-invitations/u);
      }),
  );

  it.effect(
    "a message mentioning agents on another task and on none of the workspace hands each by its task with how to message it, and one of another workspace the sender is also in as not found",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const { owner, other, task, ask, sent } = yield* startedAgent(eve, { running: true });
        const billing = yield* startTask(owner, { name: "Billing", repository: RELAY_FULL_NAME });
        const onBilling = yield* startedAgentOf(owner, billing.id, ask);
        const oneOff = yield* startedAgentOf(owner, task.id, ask);
        const foreign = yield* startedAgentOf(owner, task.id, ask);
        // The sender is a member of a second workspace, which holds the foreign agent.
        const elsewhere = yield* openWorkspace(other);
        yield* joinWorkspace(elsewhere, owner);
        const moved = (agentId: string, organizationId: string) =>
          Database.use((db) =>
            db
              .update(codingAgent)
              .set({ taskId: null, organizationId })
              .where(eq(codingAgent.id, agentId)),
          );
        yield* moved(oneOff.agent.id, task.workspaceId);
        yield* moved(foreign.agent.id, elsewhere);
        const place = { workspace: "acme", repository: task.repository };
        const mention = (agentId: string, planId: string | undefined, name: string) =>
          mentionMarkdown(
            planId === undefined
              ? { kind: MENTION_KIND.AGENT, agentId }
              : { kind: MENTION_KIND.AGENT, taskId: planId, agentId },
            name,
            place,
          );
        const words = `Line up with ${mention(onBilling.agent.id, billing.id, "Billing agent")}, ${mention(oneOff.agent.id, undefined, "Sweeper")} and ${mention(foreign.agent.id, undefined, "Stranger")}.`;

        yield* sent(words);

        const message = eve.sent.at(-1)?.message.message;
        assert.ok(Array.isArray(message));
        const part = message[1];
        assert.ok(part?.type === "text");
        assert.match(
          part.text,
          new RegExp(
            `another coding agent of your workspace on the task "Billing", "[^"]+" \\(id \`${onBilling.agent.id}\`\\)`,
            "u",
          ),
        );
        assert.match(
          part.text,
          new RegExp(`on no task, "[^"]+" \\(id \`${oneOff.agent.id}\`\\)`, "u"),
        );
        assert.equal(
          part.text.match(/To message it, call `message_agent` with its id\./gu)?.length,
          2,
        );
        assert.match(part.text, /The coding agent "Stranger": not found in your workspace\./u);
        assert.ok(!part.text.includes(`id \`${foreign.agent.id}\``), part.text);
      }),
  );

  it.effect(
    "a message mentioning an MCP server that eve does not take leaves no server for a later turn",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve({ sends: EVE_SEND_OUTCOME.NOT_READY });
        const { owner, agent, ask, target } = yield* startedAgent(eve, { running: true });
        const words = `Check ${mentionMarkdown({ kind: MENTION_KIND.SERVER, provider: INTEGRATION_PROVIDER.LINEAR }, "Linear", { workspace: "acme", repository: null })} first.`;

        const answered = yield* ask(
          messageAs(owner, agent.id, { text: words, clientKey: randomUUID() }),
        );

        assert.notEqual(answered.status, HOSTED_HTTP_STATUS.ACCEPTED);
        assert.deepEqual(
          yield* takeCodingAgentMentionedServers(target.userId, target.conversationId),
          [],
        );
      }),
  );

  it.effect(
    "an agent started on a prompt mentioning a switched-off MCP server leaves the server for its first turn to take, its switch left off",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const opened = yield* openTask({ eve });
        const task = `Triage ${mentionMarkdown({ kind: MENTION_KIND.SERVER, provider: INTEGRATION_PROVIDER.LINEAR }, "Linear", { workspace: "acme", repository: null })} first.`;

        const agent = readAnswer(
          codingAgentAnswerSchema,
          HOSTED_HTTP_STATUS.CREATED,
          yield* opened.ask(
            startAs(opened.owner, opened.task.id, {
              idempotencyKey: randomUUID(),
              task,
              disabledServers: [INTEGRATION_PROVIDER.LINEAR],
            }),
          ),
        ).agent;

        const stored = yield* readCodingAgent(opened.owner, agent.id);
        assert.ok(Option.isSome(stored));
        assert.deepEqual(stored.value.disabledServers, [INTEGRATION_PROVIDER.LINEAR]);
        assert.deepEqual(
          yield* takeCodingAgentMentionedServers(opened.owner, stored.value.conversationId),
          [INTEGRATION_PROVIDER.LINEAR],
        );
      }),
  );

  it.effect(
    "a message mentioning an MCP server hands eve a note naming its connection beside the words, and the server is left for the agent's next turn to take",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const { target, sent } = yield* startedAgent(eve, { running: true });
        const words = `Check ${mentionMarkdown({ kind: MENTION_KIND.SERVER, provider: INTEGRATION_PROVIDER.LINEAR }, "Linear", { workspace: "acme", repository: null })} first.`;

        yield* sent(words);

        const handed = eve.sent.at(-1)?.message.message;
        assert.ok(Array.isArray(handed), "eve was handed parts");
        assert.deepEqual(handed[0], { type: "text", text: words });
        assert.match(
          JSON.stringify(handed[1]),
          /pointed you at the Linear MCP server \(connection `linear`\)/u,
        );
        assert.deepEqual(
          yield* takeCodingAgentMentionedServers(target.userId, target.conversationId),
          [INTEGRATION_PROVIDER.LINEAR],
        );
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
  taskId: string,
  ask: (request: Request) => Effect.Effect<Answer>,
) =>
  Effect.gen(function* () {
    const agent = readAnswer(
      codingAgentAnswerSchema,
      HOSTED_HTTP_STATUS.CREATED,
      yield* ask(startAs(owner, taskId, { idempotencyKey: randomUUID() })),
    ).agent;
    const stored = yield* readCodingAgent(owner, agent.id);
    assert.ok(Option.isSome(stored));
    return { agent, target: { userId: owner, conversationId: stored.value.conversationId } };
  });

/** The same, under a name a suite with a `startedAgent` of its own still reaches. */
const startedAgentOf = startedAgent;

function startAs(bearer: string | undefined, planId: string, body: WireBoundaryInput): Request {
  return request(TASK_AGENTS, bearer, { method: "POST", id: planId, body });
}

const TASK_INBOX = "/api/plans/inbox";
const INBOX_ITEM = "/api/inbox/item";
const ACCOUNT_INBOX = "/api/inbox";
const INBOX_ATTACHMENT = "/api/inbox/attachment";

/** The first bytes of a PNG, as a screenshot's file starts. */
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

it.layer(getTestDB())("the developer's inbox", (it) => {
  /** The owner's plan with one agent started on it, its session claimed so a message reaches it, and the inbox as each side sees it. */
  const openInbox = (eve = fakeEve()) =>
    Effect.gen(function* () {
      const opened = yield* openTask({ eve });
      const { agent, target } = yield* startedAgent(opened.owner, opened.task.id, opened.ask);
      const sessionId = eve.opened[0]?.sessionId ?? "";
      assert.equal(yield* claimRuntimeSession(target, sessionId, yield* DateTime.nowAsDate), true);
      const owned = { userId: opened.owner, taskId: opened.task.id, agentId: agent.id };
      /** An item posted for the agent, as its tool will post one, with the pictures its image blocks name read. */
      const post = (value: InboxPost, images?: readonly InboxImage[]) =>
        postInboxItem(owned, value, images);
      /** The plan's inbox as the owner reads it past the cursor. */
      const read = (after?: string) =>
        Effect.map(
          opened.ask(
            request(TASK_INBOX, opened.owner, {
              id: opened.task.id,
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
        const second = yield* startTask(owner, {
          name: "Billing export",
          repository: RELAY_FULL_NAME,
        });
        yield* savePlanText(owner, second.id, SAVED);
        const secondAgent = (yield* startedAgent(owner, second.id, ask)).agent;
        const onSecond = (value: InboxPost) =>
          postInboxItem({ userId: owner, taskId: second.id, agentId: secondAgent.id }, value);
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

        yield* updateTask(owner, second.id, { archived: true });
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
    "an answer to an item that asks nothing back reaches the agent as the developer's message where it carries a typed note, and a bare press is kept for the agent to read",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const { post, answer } = yield* openInbox(eve);
        const todo = (key: string) =>
          post({
            key,
            title: "Turn on the agent-mail flag in staging",
            response: { type: INBOX_RESPONSE.TODO },
            needsReply: false,
          });
        const noted = yield* todo("flag-noted");
        const bare = yield* todo("flag-bare");
        assert.ok(Result.isSuccess(noted) && Result.isSuccess(bare));
        const before = eve.sent.length;

        const pressed = yield* answer(bare.success.id, {
          revision: bare.success.revision,
          clientKey: randomUUID(),
          reply: INBOX_REPLY.DONE,
        });
        assert.equal(pressed.status, HOSTED_HTTP_STATUS.OK);
        assert.equal(eve.sent.length, before, "a bare Done messages nobody");

        const written = yield* answer(noted.success.id, {
          revision: noted.success.revision,
          clientKey: randomUUID(),
          reply: INBOX_REPLY.DONE,
          note: "Done, and on preview too.",
        });
        assert.equal(written.status, HOSTED_HTTP_STATUS.OK);
        assert.equal(eve.sent.length, before + 1, "a typed note reaches the agent");
        const handed = JSON.stringify(eve.sent.at(-1)?.message.message);
        assert.ok(handed.includes(INBOX_ANSWER_LEAD), "it reads as an Inbox answer");
        assert.ok(handed.includes("Done, and on preview too."), "it carries the note");
      }),
  );

  it.effect(
    "a run of the account's own automation that failed to start rides the account's inbox read and moves its cursor, as no item, and another account's read carries none",
    () =>
      Effect.gen(function* () {
        const { owner, other, task: plan, waiting } = yield* openInbox();
        const automation = Option.getOrThrow(
          yield* createAutomation(owner, {
            taskId: plan.id,
            name: "Nightly flaky-test sweep",
            trigger: { kind: AUTOMATION_TRIGGER.WEBHOOK },
            action: { kind: AUTOMATION_ACTION.CODING_AGENT, prompt: "Fix one flaky test." },
            guards: AUTOMATION_DEFAULT_GUARDS,
            nextRunAt: null,
            webhookSecretHash: null,
          }),
        );
        const before = yield* waiting();

        const run = Option.getOrThrow(
          yield* recordAutomationRun(automation, {
            dedupeKey: randomUUID(),
            firing: { kind: AUTOMATION_FIRING.MANUAL },
            firedAt: yield* DateTime.nowAsDate,
          }),
        );
        yield* settleAutomationRun(run.id, {
          status: AUTOMATION_RUN_STATUS.FAILED,
          reason: AUTOMATION_RUN_REASON.REPOSITORY_UNREACHABLE,
        });
        const after = yield* waiting(before.cursor);

        assert.deepEqual(before.failedRuns, []);
        assert.notEqual(after.cursor, before.cursor);
        assert.deepEqual(after.items, before.items);
        assert.deepEqual(
          after.failedRuns?.map((each) => [
            each.id,
            each.automationId,
            each.automationName,
            each.workspaceId,
            each.reason,
          ]),
          [
            [
              run.id,
              automation.id,
              "Nightly flaky-test sweep",
              plan.workspaceId,
              AUTOMATION_RUN_REASON.REPOSITORY_UNREACHABLE,
            ],
          ],
        );
        assert.deepEqual((yield* waiting(undefined, other)).failedRuns, []);
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

const AGENT_PICTURE = "/api/agents/picture";

/** A picture a tool answered: its bytes, the type they were sniffed to be, and its size; synthetic, as the store keeps what it is handed. */
const picture = (mark: number) => ({
  bytes: Uint8Array.from([...PNG, mark]),
  contentType: INBOX_IMAGE_TYPE.PNG,
  width: 1200,
  height: 720,
});

it.layer(getTestDB())("an agent's pictures", (it) => {
  it.effect(
    "a picture a tool answered an agent or its worker is served as its bytes, not to be sniffed and not to be cached, to whoever may read the agent, and through its own transcript alone",
    () =>
      Effect.gen(function* () {
        const { owner, other, task, ask, fetch } = yield* openTask();
        const { agent, target } = yield* startedAgent(owner, task.id, ask);
        const callId = "call-worker";
        const workerConversation = childConversationId(target.conversationId, callId);
        const db = yield* Database;
        yield* db.insert(conversations).values({
          id: workerConversation,
          userId: owner,
          kind: CONVERSATION_KIND.CHILD,
          parentConversationId: target.conversationId,
        });
        const agentPicture = Option.getOrThrow(yield* keepConversationPicture(target, picture(1)));
        const workerPicture = Option.getOrThrow(
          yield* keepConversationPicture(
            { userId: owner, conversationId: workerConversation },
            picture(2),
          ),
        );
        const at = (bearer: string | undefined, pictureId: string, call?: string) =>
          request(AGENT_PICTURE, bearer, {
            id: agent.id,
            picture: pictureId,
            ...(call === undefined ? undefined : { call }),
          });
        const notFound = refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND);

        const served = yield* fetch(at(owner, agentPicture.id));
        assert.equal(served.status, HOSTED_HTTP_STATUS.OK);
        assert.equal(served.headers.get("content-type"), INBOX_IMAGE_TYPE.PNG);
        assert.equal(served.headers.get("x-content-type-options"), "nosniff");
        assert.equal(served.headers.get("cache-control"), "private, no-store");
        assert.deepEqual(
          new Uint8Array(yield* Effect.promise(() => served.arrayBuffer())),
          picture(1).bytes,
        );
        const workerServed = yield* fetch(at(owner, workerPicture.id, callId));
        assert.deepEqual(
          new Uint8Array(yield* Effect.promise(() => workerServed.arrayBuffer())),
          picture(2).bytes,
        );

        assert.deepEqual(yield* ask(at(other, agentPicture.id)), notFound, "not a member");
        assert.deepEqual(
          yield* ask(at(owner, workerPicture.id)),
          notFound,
          "a worker's picture is not the agent's",
        );
        assert.deepEqual(
          yield* ask(at(owner, agentPicture.id, callId)),
          notFound,
          "the agent's picture is not its worker's",
        );
        assert.deepEqual(yield* ask(at(owner, randomUUID())), notFound);
        assert.deepEqual(yield* ask(at(owner, "members.png")), notFound);
        assert.deepEqual(
          yield* ask(at(undefined, agentPicture.id)),
          refusal(HOSTED_HTTP_STATUS.UNAUTHORIZED, HOSTED_API_ERROR.INVALID_TOKEN),
        );

        yield* joinWorkspace(task.workspaceId, other);
        const teammate = yield* fetch(at(other, agentPicture.id));
        assert.equal(teammate.status, HOSTED_HTTP_STATUS.OK, "a member of the agent's workspace");
      }),
  );
});

it.layer(getTestDB())("telling a chat message to the agents it addresses", (it) => {
  /**
   * The owner's plan with two agents on it, each session claimed so a notice
   * reaches it, their chat members and the owner's, the plan's channel, and
   * the door a post goes through, as the owner posts.
   */
  const openChat = (eve = fakeEve(), secondByTeammate = false) =>
    Effect.gen(function* () {
      const opened = yield* openTask({ eve });
      const workspace = opened.task.workspaceId;
      if (secondByTeammate) yield* joinWorkspace(workspace, opened.other);
      const agents = [];
      for (const at of [0, 1]) {
        const starter = at === 1 && secondByTeammate ? opened.other : opened.owner;
        const started = yield* startedAgent(starter, opened.task.id, opened.ask);
        const sessionId = eve.opened[at]?.sessionId ?? "";
        assert.equal(
          yield* claimRuntimeSession(started.target, sessionId, yield* DateTime.nowAsDate),
          true,
        );
        const member = Option.getOrThrow(
          yield* ensureMember(opened.owner, workspace, {
            kind: MEMBER_KIND.AGENT,
            agentId: started.agent.id,
          }),
        );
        agents.push({ ...started, sessionId, member });
      }
      const [first, second] = agents;
      assert.ok(first && second);
      const person = Option.getOrThrow(
        yield* ensureMember(opened.owner, workspace, {
          kind: MEMBER_KIND.HUMAN,
          userId: opened.owner,
        }),
      );
      const channel = Option.getOrThrow(yield* ensurePlanChannel(opened.owner, opened.task.id));
      const writer = yield* storeWriter({ tools: CODER_TOOL_SET });
      const telling: ChatTelling = {
        eveFor: (starter) => eve.eve(`Bearer ${starter}`),
        writer: Effect.succeed(writer),
        userId: opened.owner,
        organizationId: workspace,
        doors: HELD_DOORS,
      };
      /** A post by the member given, its mentions read off its words, through the door. */
      const post = (
        author: { readonly id: string },
        text: string,
        to: { readonly channelId: string } | { readonly replyTo: number } = {
          channelId: channel.id,
        },
        clientKey: string = randomUUID(),
      ) =>
        postChat(telling, {
          authorMemberId: author.id,
          to,
          blocks: [{ type: CHAT_BLOCK.MARKDOWN, text }],
          mentions: mentionedHandles(text),
          clientKey,
        }).pipe(Effect.provide(opened.github.layer));
      /** The user rows of an agent's conversation, as the store keeps them. */
      const rowsOf = (target: { readonly userId: string; readonly conversationId: string }) =>
        Effect.map(
          listMessagesPast(target.userId, target.conversationId, CODER_TOOL_SET, CURSOR_START, 50),
          (page) =>
            (page.read.ok ? page.read.value : []).filter(
              (record) => record.message.role === MESSAGE_ROLE.USER,
            ),
        );
      return { ...opened, workspace, first, second, person, channel, telling, post, rowsOf };
    });

  it.effect(
    "a DM steers the other agent once as a chat-marked line of its own, a second while the first is unread is held, and one after it reads is told",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const chat = yield* openChat(eve);
        const dm = Option.getOrThrow(
          yield* findOrMakeDm(
            chat.owner,
            chat.workspace,
            chat.first.member.id,
            chat.second.member.id,
          ),
        );
        const key = randomUUID();
        const sent = yield* chat.post(
          chat.first.member,
          "The invite table is mine.",
          { channelId: dm.id },
          key,
        );
        assert.deepEqual(sent.receipt, { told: ["agent-2"], held: [], left: [], unresolved: [] });
        assert.deepEqual(
          eve.sent.map((each) => each.sessionId),
          [chat.second.sessionId],
        );
        // The notice is the only line the second agent's conversation holds: no turn of its has run.
        const [notice] = yield* chat.rowsOf(chat.second.target);
        assert.ok(notice?.message.role === MESSAGE_ROLE.USER);
        assert.deepEqual(notice.message.metadata, {
          author: MESSAGE_AUTHOR.AGENT,
          channel: MESSAGE_CHANNEL.CHAT,
          chat_seq: sent.message.seq,
          from: "agent-1",
        });
        const again = yield* chat.post(
          chat.first.member,
          "The invite table is mine.",
          { channelId: dm.id },
          key,
        );
        assert.equal(again.repeated, true);
        assert.equal(eve.sent.length, 1);

        const held = yield* chat.post(chat.first.member, "And the emails.", { channelId: dm.id });
        assert.deepEqual(held.receipt.held, ["agent-2"]);
        assert.equal(eve.sent.length, 1);
        yield* unreadFor(chat.owner, chat.workspace, chat.second.member.id);
        const told = yield* chat.post(chat.first.member, "Done now.", { channelId: dm.id });
        assert.deepEqual(told.receipt.told, ["agent-2"]);
        assert.equal(eve.sent.length, 2);
      }),
  );

  it.effect(
    "a plain post steers nobody, a mention steers the agent it names, and a planner, a person, and a handle naming no one are told no agent's way",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const chat = yield* openChat(eve);
        const plain = yield* chat.post(chat.first.member, "Starting on the emails.");
        assert.deepEqual(plain.receipt, { told: [], held: [], left: [], unresolved: [] });
        assert.equal(eve.sent.length, 0);

        const mentioned = yield* chat.post(
          chat.first.member,
          `@agent-2 take the table; @luke and @${chat.person.handle} FYI; @nobody`,
        );
        assert.deepEqual(mentioned.receipt, {
          told: ["agent-2"],
          held: ["luke", chat.person.handle],
          left: [],
          unresolved: ["nobody"],
        });
        assert.deepEqual(
          eve.sent.map((each) => each.sessionId),
          [chat.second.sessionId],
        );
      }),
  );

  it.effect(
    "a thread reply tells the root's author and the earlier repliers, never its own author",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const chat = yield* openChat(eve);
        const root = yield* chat.post(chat.first.member, "Who owns the invite table?");
        const reply = yield* chat.post(chat.person, "agent-2 does.", { replyTo: root.message.seq });
        assert.deepEqual(reply.receipt.told, ["agent-1"]);
        const answer = yield* chat.post(chat.second.member, "Confirmed.", {
          replyTo: root.message.seq,
        });
        assert.deepEqual(
          [answer.receipt.told, answer.receipt.held],
          [[], ["agent-1", chat.person.handle]],
        );
        assert.deepEqual(
          eve.sent.map((each) => each.sessionId),
          [chat.first.sessionId],
        );
      }),
  );

  it.effect(
    "an archived agent is said to have left and steered nothing, and is told again once brought back; one whose session eve no longer runs is stamped as having left for good",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const chat = yield* openChat(eve);
        yield* archiveCodingAgent(chat.owner, chat.second.agent.id, true);
        const archived = yield* chat.post(chat.first.member, "@agent-2 still there?");
        assert.deepEqual(archived.receipt.left, ["agent-2"]);
        assert.equal(eve.sent.length, 0);
        yield* archiveCodingAgent(chat.owner, chat.second.agent.id, false);
        const back = yield* chat.post(chat.first.member, "@agent-2 welcome back.");
        assert.deepEqual(back.receipt.told, ["agent-2"]);
        assert.equal(eve.sent.length, 1);
        assert.deepEqual(
          (yield* roster(chat.owner, chat.workspace)).filter((row) => row.leftAt !== null),
          [],
        );
      }),
  );

  it.effect(
    "an agent whose session eve no longer runs is stamped as having left, and posts nothing more",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve({ sends: EVE_SEND_OUTCOME.RETIRED });
        const chat = yield* openChat(eve);
        const toSecond = yield* chat.post(chat.person, "@agent-2 are you?");
        assert.deepEqual(toSecond.receipt.left, ["agent-2"]);
        const left = (yield* roster(chat.owner, chat.workspace)).filter(
          (row) => row.leftAt !== null,
        );
        assert.deepEqual(
          left.map((row) => row.handle),
          ["agent-2"],
        );
        const silenced = yield* chat.post(chat.second.member, "Still here.").pipe(Effect.result);
        assert.ok(Result.isFailure(silenced));
      }),
  );

  it.effect(
    "a DM tells its other member alone, a mention in it naming no one else, so its words reach no one who may not read them",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const chat = yield* openChat(eve);
        const dm = Option.getOrThrow(
          yield* findOrMakeDm(chat.owner, chat.workspace, chat.first.member.id, chat.person.id),
        );
        const sent = yield* chat.post(chat.first.member, "@agent-2 is slow, between us.", {
          channelId: dm.id,
        });
        assert.deepEqual(sent.receipt, {
          told: [],
          held: [chat.person.handle],
          left: [],
          unresolved: [],
        });
        assert.equal(eve.sent.length, 0);
      }),
  );

  it.effect(
    "a post sent again under its key finishes a telling the first send never made, and steers no one twice",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const chat = yield* openChat(eve);
        const key = randomUUID();
        // The first send landed and was never told, as a send that failed after its write leaves it.
        yield* postMessage(chat.owner, chat.workspace, {
          authorMemberId: chat.first.member.id,
          to: { channelId: chat.channel.id },
          blocks: [{ type: CHAT_BLOCK.MARKDOWN, text: "@agent-2 the table is mine." }],
          mentions: ["agent-2"],
          clientKey: key,
        });
        const retried = yield* chat.post(
          chat.first.member,
          "@agent-2 the table is mine.",
          { channelId: chat.channel.id },
          key,
        );
        assert.deepEqual([retried.repeated, retried.receipt.told], [true, ["agent-2"]]);
        const again = yield* chat.post(
          chat.first.member,
          "@agent-2 the table is mine.",
          { channelId: chat.channel.id },
          key,
        );
        assert.deepEqual(again.receipt.held, ["agent-2"]);
        assert.equal(eve.sent.length, 1);
      }),
  );

  it.effect("an ask posted again under its key is told again with what it now asks", () =>
    Effect.gen(function* () {
      const eve = fakeEve();
      const chat = yield* openChat(eve);
      const asked = (text: string) =>
        Effect.gen(function* () {
          const posted = Result.getOrThrow(
            yield* postAsk(chat.owner, chat.workspace, {
              authorMemberId: chat.first.member.id,
              to: { channelId: chat.channel.id },
              blocks: [{ type: CHAT_BLOCK.MARKDOWN, text }],
              mentions: ["agent-2"],
              clientKey: randomUUID(),
              key: "table-owner",
              ask: { response: { type: CHAT_ASK.TEXT } },
            }),
          );
          return yield* tellMessage(chat.telling, posted.message, posted.unresolved).pipe(
            Effect.provide(chat.github.layer),
          );
        });
      assert.deepEqual((yield* asked("@agent-2 who owns the table?")).told, ["agent-2"]);
      yield* unreadFor(chat.owner, chat.workspace, chat.second.member.id);
      assert.deepEqual((yield* asked("@agent-2 who owns the table, now?")).told, ["agent-2"]);
      assert.deepEqual(
        eve.sent.map((each) => String(each.message.message).includes("now?")),
        [false, true],
      );
    }),
  );

  it.effect(
    "a notice to an agent a teammate started is minted for that teammate, whose principal its turn runs under, whoever posted",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const chat = yield* openChat(eve, true);
        const told = yield* chat.post(chat.first.member, "@agent-2 the table is mine.");
        assert.deepEqual(told.receipt.told, ["agent-2"]);
        assert.deepEqual(
          eve.sent.map((each) => [each.authorization, each.sessionId]),
          [[`Bearer ${chat.other}`, chat.second.sessionId]],
        );
        const back = yield* chat.post(chat.second.member, "@agent-1 noted.");
        assert.deepEqual(back.receipt.told, ["agent-1"]);
        assert.deepEqual(eve.sent[1]?.authorization, `Bearer ${chat.owner}`);
      }),
  );

  it.effect(
    "an agent whose starter left the workspace is away: said to have left, steered nothing, stamped nothing, and told again once its starter is back",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const chat = yield* openChat(eve, true);
        const db = yield* Database;
        yield* db
          .delete(member)
          .where(and(eq(member.organizationId, chat.workspace), eq(member.userId, chat.other)));
        const away = yield* chat.post(chat.person, "@agent-2 please carry on.");
        assert.deepEqual(away.receipt.left, ["agent-2"]);
        assert.equal(eve.sent.length, 0);
        assert.deepEqual(
          (yield* roster(chat.owner, chat.workspace)).filter((row) => row.leftAt !== null),
          [],
        );

        yield* joinWorkspace(chat.workspace, chat.other);
        const back = yield* chat.post(chat.person, "@agent-2 welcome back.");
        assert.deepEqual(back.receipt.told, ["agent-2"]);
        assert.deepEqual(
          eve.sent.map((each) => each.authorization),
          [`Bearer ${chat.other}`],
        );
      }),
  );

  it.effect("an ask only answered since it was told steers no one again", () =>
    Effect.gen(function* () {
      const eve = fakeEve();
      const chat = yield* openChat(eve);
      const posted = Result.getOrThrow(
        yield* postAsk(chat.owner, chat.workspace, {
          authorMemberId: chat.first.member.id,
          to: { channelId: chat.channel.id },
          blocks: [{ type: CHAT_BLOCK.MARKDOWN, text: "@agent-2 who owns the table?" }],
          mentions: ["agent-2"],
          clientKey: randomUUID(),
          key: "table-owner",
          ask: { response: { type: CHAT_ASK.TEXT } },
        }),
      );
      const tell = (message: typeof posted.message) =>
        tellMessage(chat.telling, message, []).pipe(Effect.provide(chat.github.layer));
      yield* tell(posted.message);
      yield* unreadFor(chat.owner, chat.workspace, chat.second.member.id);
      const answered = Result.getOrThrow(
        yield* answerAsk(chat.owner, chat.workspace, {
          answererMemberId: chat.person.id,
          seq: posted.message.seq,
          revision: 1,
          reply: { reply: CHAT_REPLY.ANSWERED, note: "agent-1 does." },
          clientKey: randomUUID(),
        }),
      );
      yield* tell(answered.ask);
      assert.equal(eve.sent.length, 1);
    }),
  );
});

/** A sandbox door no post with words alone opens: one that fails if it is. */
const noSandbox: InboxSandboxDoor = () => Promise.reject(new Error("the sandbox was opened"));

/** A sandbox holding the files given by absolute path, each read as one stream. */
function sandboxWith(files: Readonly<Record<string, Uint8Array>>): InboxSandboxDoor {
  return () =>
    Promise.resolve({
      readFile: ({ path }: { path: string }) => {
        const bytes = files[path];
        if (bytes === undefined) return Promise.resolve(null);
        return Promise.resolve(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(bytes);
              controller.close();
            },
          }),
        );
      },
    });
}

/** An ask as an agent posts one: a choice between two queues, the first recommended. */
const QUEUE_ASK = {
  text: "Which queue sends the invitation emails?",
  key: "invite-queue",
  ask: {
    response: {
      type: CHAT_ASK.CHOICE,
      options: [{ label: "Postgres outbox", detail: "No new service." }, { label: "Redis" }],
      recommended: "Postgres outbox",
    },
  },
} as const;

it.layer(getTestDB())("the coding agent's chat tools", (it) => {
  /**
   * The owner's plan with two agents on it, each session claimed so a notice
   * reaches it, and each agent's tools as its own calls run them: a post
   * under a fresh call id, with the turn's count given, and a read.
   */
  const openAgents = (eve = fakeEve()) =>
    Effect.gen(function* () {
      const opened = yield* openTask({ eve });
      const writer = yield* storeWriter({ tools: CODER_TOOL_SET });
      const telling = {
        eveFor: (starter: string) => eve.eve(`Bearer ${starter}`),
        writer: Effect.succeed(writer),
        doors: HELD_DOORS,
      };
      const agents: ChatAgent[] = [];
      for (const at of [0, 1]) {
        const started = yield* startedAgent(opened.owner, opened.task.id, opened.ask);
        const sessionId = eve.opened[at]?.sessionId ?? "";
        assert.equal(
          yield* claimRuntimeSession(started.target, sessionId, yield* DateTime.nowAsDate),
          true,
        );
        agents.push({
          userId: opened.owner,
          agentId: started.agent.id,
          planId: opened.task.id,
          repository: RELAY_FULL_NAME,
          telling,
        });
      }
      const [first, second] = agents;
      assert.ok(first && second);
      const post = (
        agent: ChatAgent,
        value: WireBoundaryInput,
        call: { readonly postsInTurn?: number; readonly sandbox?: InboxSandboxDoor } = {},
      ) =>
        postAsAgent(agent, unparsedWire(value), {
          clientKey: randomUUID(),
          postsInTurn: call.postsInTurn ?? 0,
          sandbox: call.sandbox ?? noSandbox,
        }).pipe(Effect.provide(opened.github.layer));
      const read = (agent: ChatAgent, value: WireBoundaryInput = {}) =>
        readAsAgent(agent, unparsedWire(value));
      const resolve = (agent: ChatAgent, value: WireBoundaryInput) =>
        resolveAsAgent(agent, unparsedWire(value));
      // Note that the handles are read back rather than assumed, because two agents started at one instant mint in either order.
      const handleOf = (agent: ChatAgent) =>
        Effect.map(read(agent, { channel: "#teammate-invitations" }), (answer) => {
          assert.ok("you" in answer);
          return answer.you;
        });
      const handles = { first: yield* handleOf(first), second: yield* handleOf(second) };
      /** The chat member an agent's handle names. */
      const memberOf = (handle: string) =>
        Effect.map(
          memberNamed(opened.owner, opened.task.workspaceId, handle.slice(1)),
          Option.getOrThrow,
        );
      return { ...opened, first, second, handles, post, read, resolve, memberOf };
    });

  it.effect(
    "a plain post lands in the plan's channel and tells nobody, the other agent reads it once as unread, and a mention tells the agent it names and names a handle that names no one",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const chat = yield* openAgents(eve);
        const plain = yield* chat.post(chat.first, { text: "Starting on the emails." });
        assert.ok(plain.status === ACTION_RESULT_STATUS.ACCEPTED && "seq" in plain);
        assert.deepEqual(
          { ...plain, seq: 0 },
          {
            status: ACTION_RESULT_STATUS.ACCEPTED,
            seq: 0,
            in: "#teammate-invitations",
            told: [],
            held: [],
            left: [],
            unresolved: [],
          },
        );
        assert.equal(eve.sent.length, 0);

        const unread = yield* chat.read(chat.second);
        assert.ok(unread.status === ACTION_RESULT_STATUS.ACCEPTED && "messages" in unread);
        assert.equal(unread.you, chat.handles.second);
        assert.deepEqual(unread.messages, [
          {
            seq: plain.seq,
            in: "#teammate-invitations",
            from: chat.handles.first,
            text: "Starting on the emails.",
          },
        ]);
        assert.deepEqual(unread.channels, [
          { name: "#teammate-invitations", kind: CHANNEL_KIND.PLAN, unread: 0 },
        ]);
        const again = yield* chat.read(chat.second);
        assert.ok("messages" in again);
        assert.deepEqual(again.messages, [], "a message read is read once");

        const underneath = yield* chat.post(chat.first, {
          text: "One more thing.",
          blocks: [{ type: CHAT_BLOCK.MARKDOWN, text: `${chat.handles.second} owns the emails.` }],
        });
        assert.ok("told" in underneath);
        assert.deepEqual(
          underneath.told,
          [chat.handles.second],
          "a mention under the words tells too",
        );
        // The first notice stands until its member reads, so it reads before the next is told.
        yield* chat.read(chat.second);
        const mentioned = yield* chat.post(chat.first, {
          text: `${chat.handles.second} take the invite table; @nobody FYI`,
        });
        assert.ok("told" in mentioned);
        assert.deepEqual(
          [mentioned.told, mentioned.unresolved],
          [[chat.handles.second], ["@nobody"]],
        );
        assert.equal(eve.sent.length, 2);
      }),
  );

  it.effect(
    "a post to @handle is a DM the other agent reads by its handle, a reply lands in the thread it answers and tells its poster, and every message names its thread's root",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const chat = yield* openAgents(eve);
        const { first: one, second: two } = chat.handles;
        const dm = yield* chat.post(chat.first, { text: "Is the invite table yours?", to: two });
        assert.ok("told" in dm);
        assert.deepEqual([dm.in, dm.told], [two, [two]]);
        const direct = yield* chat.read(chat.second, { channel: one });
        assert.ok("messages" in direct);
        assert.deepEqual(
          direct.messages.map((message) => [message.in, message.text]),
          [[one, "Is the invite table yours?"]],
        );
        // The read of one channel marks nothing read.
        const unread = yield* chat.read(chat.second);
        assert.ok("messages" in unread);
        assert.deepEqual(
          unread.channels.map((channel) => [channel.name, channel.unread]),
          [
            ["#teammate-invitations", 0],
            [one, 0],
          ],
        );
        assert.equal(unread.messages.length, 1);

        const root = yield* chat.post(chat.first, { text: "Who owns the emails?" });
        assert.ok("seq" in root);
        const reply = yield* chat.post(chat.second, { text: "I do.", replyTo: root.seq });
        assert.ok("told" in reply);
        assert.deepEqual([reply.thread, reply.in, reply.told], [root.seq, undefined, [one]]);
        const nested = yield* chat.post(chat.first, { text: "Thanks.", replyTo: reply.seq });
        assert.ok("seq" in nested);
        assert.equal(nested.thread, root.seq, "a reply to a reply lands in its root's thread");
        const thread = yield* chat.read(chat.first, { thread: root.seq });
        assert.ok("messages" in thread);
        assert.deepEqual(
          thread.messages.map((message) => [message.from, message.thread]),
          [
            [one, undefined],
            [two, root.seq],
            [one, root.seq],
          ],
        );
      }),
  );

  it.effect(
    "an agent started on another plan of the workspace answers to its handle before it ever posts or reads, and is told a DM to it",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const chat = yield* openAgents(eve);
        const other = yield* startTask(chat.owner, {
          name: "Billing export",
          repository: RELAY_FULL_NAME,
        });
        const third = yield* startedAgent(chat.owner, other.id, chat.ask);
        const sessionId = eve.opened[2]?.sessionId ?? "";
        assert.equal(
          yield* claimRuntimeSession(third.target, sessionId, yield* DateTime.nowAsDate),
          true,
        );
        const dm = yield* chat.post(chat.first, { text: "Take the emails?", to: "@agent-3" });
        assert.ok("told" in dm);
        assert.deepEqual(dm.told, ["@agent-3"]);
        assert.deepEqual(
          eve.sent.map((each) => each.sessionId),
          [sessionId],
        );
      }),
  );

  it.effect(
    "a #name no channel holds opens a topic channel, and the read lists the roster and every channel the agent sees",
    () =>
      Effect.gen(function* () {
        const chat = yield* openAgents();
        const topic = yield* chat.post(chat.first, {
          text: "Release notes go here.",
          to: "#releases",
        });
        assert.ok("in" in topic);
        assert.equal(topic.in, "#releases");
        yield* chat.post(chat.first, { text: "Hello all.", to: "#general" });
        const read = yield* chat.read(chat.second);
        assert.ok("members" in read);
        assert.deepEqual(
          read.members.toSorted((a, b) => a.handle.localeCompare(b.handle)),
          [
            { handle: "@agent-1", kind: MEMBER_KIND.AGENT },
            { handle: "@agent-2", kind: MEMBER_KIND.AGENT },
          ],
        );
        assert.deepEqual(read.channels.map((channel) => [channel.name, channel.kind]).toSorted(), [
          ["#general", CHANNEL_KIND.GENERAL],
          ["#releases", CHANNEL_KIND.TOPIC],
          ["#teammate-invitations", CHANNEL_KIND.PLAN],
        ]);
      }),
  );

  it.effect(
    "a post refused names why: both a reply and a target, a handle naming no one or the agent itself, a message that is not there, words that do not read, and a turn past its bound; a read of a channel the agent does not see",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const chat = yield* openAgents(eve);
        const refused = (reason: string) => ({ status: ACTION_RESULT_STATUS.REJECTED, reason });
        assert.deepEqual(
          yield* chat.post(chat.first, { text: "Hi.", to: "#general", replyTo: 1 }),
          refused(CHAT_TOOL_REFUSAL.REPLY_AND_TO),
        );
        assert.deepEqual(
          yield* chat.post(chat.first, { text: "Hi.", to: "@nobody" }),
          refused(CHAT_TOOL_REFUSAL.NO_MEMBER),
        );
        assert.deepEqual(
          yield* chat.post(chat.first, { text: "Hi.", to: chat.handles.first }),
          refused(CHAT_TOOL_REFUSAL.TO_SELF),
        );
        assert.deepEqual(
          yield* chat.post(chat.first, { text: "Hi.", replyTo: 9_999 }),
          refused(CHAT_TOOL_REFUSAL.NO_MESSAGE),
        );
        assert.deepEqual(
          yield* chat.post(chat.first, { text: "" }),
          refused(CHAT_TOOL_REFUSAL.UNREADABLE_POST),
        );
        assert.deepEqual(
          yield* chat.post(
            chat.first,
            { text: "One more." },
            { postsInTurn: CHAT_BOUNDS.MAX_POSTS_PER_TURN },
          ),
          refused(CHAT_TOOL_REFUSAL.TOO_MANY_POSTS),
        );
        assert.deepEqual(
          yield* chat.read(chat.first, { channel: "#nowhere" }),
          refused(CHAT_TOOL_REFUSAL.NO_CHANNEL),
        );
        const history = yield* chat.read(chat.second, { channel: "#teammate-invitations" });
        assert.ok("messages" in history);
        assert.deepEqual(history.messages, [], "nothing refused was posted");
        assert.equal(eve.sent.length, 0);
      }),
  );

  it.effect(
    "a planless agent posts in its workspace's general channel by default, and its @luke names no one",
    () =>
      Effect.gen(function* () {
        const chat = yield* openAgents();
        const db = yield* Database;
        yield* db
          .update(codingAgent)
          .set({ taskId: null })
          .where(eq(codingAgent.id, chat.first.agentId));
        const planless = { ...chat.first, planId: null };
        const posted = yield* chat.post(planless, { text: "@luke who owns the invite table?" });
        assert.ok("seq" in posted);
        assert.deepEqual([posted.in, posted.unresolved], ["#general", ["@luke"]]);
      }),
  );

  it.effect(
    "an ask posted twice under its key is one ask at a moved-on revision, answered in its thread by another member, resolved by its poster, and every read carries the agent's asks",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const chat = yield* openAgents(eve);
        const asked = yield* chat.post(chat.first, QUEUE_ASK);
        assert.ok("asks" in asked && asked.asks !== undefined && "seq" in asked);
        assert.deepEqual(asked.asks, [
          {
            key: QUEUE_ASK.key,
            seq: asked.seq,
            in: "#teammate-invitations",
            status: ASK_STATUS.OPEN,
            revision: 1,
            response: QUEUE_ASK.ask.response,
            needsReply: true,
          },
        ]);
        const again = yield* chat.post(chat.first, {
          ...QUEUE_ASK,
          text: "Which queue, now that Redis is gone?",
        });
        assert.ok("asks" in again && again.asks !== undefined);
        assert.deepEqual(
          again.asks.map((ask) => [ask.key, ask.revision, ask.status]),
          [[QUEUE_ASK.key, 2, ASK_STATUS.OPEN]],
          "one ask per key",
        );
        const [standing] = again.asks;
        assert.ok(standing);

        const answerer = yield* chat.memberOf(chat.handles.second);
        const answered = yield* answerAsk(chat.owner, chat.task.workspaceId, {
          answererMemberId: answerer.id,
          seq: standing.seq,
          revision: 2,
          reply: { reply: CHAT_REPLY.CHOSE, choices: ["Postgres outbox"] },
          clientKey: randomUUID(),
        });
        assert.ok(Result.isSuccess(answered) && answered.success.taken);
        const read = yield* chat.read(chat.first);
        assert.ok("asks" in read);
        assert.deepEqual(read.asks, [
          {
            key: QUEUE_ASK.key,
            seq: read.asks[0]?.seq ?? 0,
            in: "#teammate-invitations",
            status: ASK_STATUS.ANSWERED,
            revision: 2,
            answer: { reply: CHAT_REPLY.CHOSE, choices: ["Postgres outbox"] },
            answeredBy: chat.handles.second,
          },
        ]);

        const resolved = yield* chat.resolve(chat.first, {
          key: QUEUE_ASK.key,
          reason: "Shipped on the outbox.",
        });
        assert.ok("asks" in resolved);
        assert.deepEqual(
          resolved.asks.map((ask) => [ask.status, ask.closedReason]),
          [[ASK_STATUS.CLOSED, "Shipped on the outbox."]],
        );
        assert.deepEqual(yield* chat.resolve(chat.first, { key: "nothing", reason: "No." }), {
          status: ACTION_RESULT_STATUS.REJECTED,
          reason: ASK_REFUSAL.NO_ASK,
        });
        const others = yield* chat.read(chat.second);
        assert.ok("asks" in others);
        assert.deepEqual(others.asks, [], "another agent's asks are not its own");
      }),
  );

  it.effect(
    "an ask stays where it was first posted, and one whose shape asks what it cannot is refused before anything is posted",
    () =>
      Effect.gen(function* () {
        const chat = yield* openAgents();
        const refused = (reason: string) => ({ status: ACTION_RESULT_STATUS.REJECTED, reason });
        yield* chat.post(chat.first, QUEUE_ASK);
        assert.deepEqual(
          yield* chat.post(chat.first, { ...QUEUE_ASK, to: "#general" }),
          refused(ASK_REFUSAL.ELSEWHERE),
        );
        assert.deepEqual(
          yield* chat.post(chat.first, {
            ...QUEUE_ASK,
            key: "twice",
            ask: {
              response: {
                type: CHAT_ASK.CHOICE,
                options: [{ label: "Redis" }, { label: "Redis" }],
              },
            },
          }),
          refused(ASK_REFUSAL.NO_OPTIONS),
        );
        assert.deepEqual(
          yield* chat.post(chat.first, {
            ...QUEUE_ASK,
            key: "nowhere",
            ask: { response: { ...QUEUE_ASK.ask.response, recommended: "Kafka" } },
          }),
          refused(ASK_REFUSAL.UNKNOWN_RECOMMENDATION),
        );
        assert.deepEqual(
          yield* chat.post(chat.first, {
            text: "These lines.",
            blocks: [
              {
                type: CHAT_BLOCK.CODE,
                repo: "acme/other",
                path: "src/invite.ts",
                startLine: 1,
                endLine: 4,
                sha: "a".repeat(40),
              },
            ],
          }),
          refused(ASK_REFUSAL.CODE_REPOSITORY),
        );
        assert.deepEqual(
          yield* chat.post(chat.first, { text: "An ask with no key.", ask: QUEUE_ASK.ask }),
          refused(CHAT_TOOL_REFUSAL.UNREADABLE_POST),
        );
        const link = {
          type: CHAT_BLOCK.LINK,
          url: "https://github.com/acme/relay",
          label: "Relay",
        };
        assert.deepEqual(
          yield* chat.post(chat.first, {
            text: "Every link.",
            blocks: Array.from({ length: CHAT_BOUNDS.MAX_BLOCKS }, () => link),
          }),
          refused(ASK_REFUSAL.TOO_MANY_BLOCKS),
          "the words are a block of the message's own",
        );
        const read = yield* chat.read(chat.first);
        assert.ok("asks" in read);
        assert.deepEqual(
          read.asks.map((ask) => ask.key),
          [QUEUE_ASK.key],
        );
      }),
  );

  it.effect(
    "an image block's picture is read from the sandbox and kept with the message, and a file that is not there refuses the post naming its path",
    () =>
      Effect.gen(function* () {
        const chat = yield* openAgents();
        const sandbox = sandboxWith({ [`${CODER.CHECKOUT_PATH}/shot.png`]: PNG });
        const posted = yield* chat.post(
          chat.first,
          {
            text: "The invite form as it renders.",
            blocks: [{ type: CHAT_BLOCK.IMAGE, path: "shot.png", alt: "The invite form." }],
          },
          { sandbox },
        );
        assert.ok(posted.status === ACTION_RESULT_STATUS.ACCEPTED && "seq" in posted);
        const poster = yield* chat.memberOf(chat.handles.first);
        const [message] = Option.getOrThrow(
          yield* history(chat.owner, chat.task.workspaceId, poster.id, {}),
        );
        const image = message?.blocks.find((block) => block.type === CHAT_BLOCK.IMAGE);
        assert.ok(image !== undefined && "attachmentId" in image);
        assert.equal(image.alt, "The invite form.");
        const kept = Option.getOrThrow(
          yield* readAttachment(
            chat.owner,
            chat.task.workspaceId,
            message?.id ?? "",
            image.attachmentId,
          ),
        );
        assert.deepEqual([kept.contentType, kept.bytes], [CHAT_IMAGE_TYPE.PNG, PNG]);

        const asked = yield* chat.post(
          chat.first,
          {
            ...QUEUE_ASK,
            blocks: [{ type: CHAT_BLOCK.IMAGE, path: "shot.png", alt: "The queue's dashboard." }],
          },
          { sandbox },
        );
        assert.ok("seq" in asked);
        const [ask] = Option.getOrThrow(
          yield* history(chat.owner, chat.task.workspaceId, poster.id, { thread: asked.seq }),
        );
        const shown = ask?.blocks.find((block) => block.type === CHAT_BLOCK.IMAGE);
        assert.ok(ask !== undefined && shown !== undefined && "attachmentId" in shown);
        yield* chat.post(chat.first, { ...QUEUE_ASK, text: "Which queue? No picture now." });
        assert.deepEqual(
          yield* readAttachment(chat.owner, chat.task.workspaceId, ask.id, shown.attachmentId),
          Option.none(),
          "a picture an ask dropped when posted again is dropped from the store",
        );

        const missing = yield* chat.post(
          chat.first,
          {
            text: "Another.",
            blocks: [{ type: CHAT_BLOCK.IMAGE, path: "missing.png", alt: "Nothing." }],
          },
          { sandbox },
        );
        assert.ok(missing.status === ACTION_RESULT_STATUS.REJECTED && "reason" in missing);
        assert.ok(missing.reason.endsWith("missing.png"), missing.reason);
      }),
  );

  it.effect(
    "a turn opens with the chat the agent has not read, once, leaving out the message a notice already told it, and with nothing once it has read",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const chat = yield* openAgents(eve);
        const { first: one, second: two } = chat.handles;
        assert.equal(yield* chatDigest(chat.second), undefined, "nothing waits yet");

        const plain = yield* chat.post(chat.first, { text: "Starting on the emails." });
        const root = yield* chat.post(chat.first, QUEUE_ASK);
        const dm = yield* chat.post(chat.first, { text: "Is the table yours?", to: two });
        assert.ok("seq" in plain && "seq" in root && "told" in dm);
        assert.deepEqual(dm.told, [two], "the DM is told as a notice");
        assert.equal(
          yield* chatDigest(chat.second),
          [
            CHAT_DIGEST_HEADING,
            `m ${plain.seq} · ${one} in #teammate-invitations: Starting on the emails.`,
            `m ${root.seq} · ${one} in #teammate-invitations asks (${CHAT_ASK.CHOICE}): ${QUEUE_ASK.text}`,
          ].join("\n"),
        );
        assert.equal(yield* chatDigest(chat.second), undefined, "a digest is a read");

        const long = "Every invitation carries its sender, its workspace, and its expiry. ".repeat(
          12,
        );
        const reply = yield* chat.post(chat.first, { text: long, replyTo: plain.seq });
        assert.ok("seq" in reply);
        const cut = yield* chatDigest(chat.second);
        assert.ok(cut !== undefined);
        assert.ok(
          cut.endsWith(`… (read_chat({ thread: ${plain.seq} }) reads the rest)`),
          "a message cut short names the read that carries it whole",
        );
        const thread = yield* chat.read(chat.second, { thread: plain.seq });
        assert.ok("messages" in thread);
        assert.equal(thread.messages.at(-1)?.text, long);

        yield* chat.post(chat.first, { text: "One more.", replyTo: plain.seq });
        const read = yield* chat.read(chat.second);
        assert.ok("messages" in read);
        assert.equal(read.messages.length, 1);
        assert.equal(yield* chatDigest(chat.second), undefined, "what a read took waits no more");
      }),
  );

  it.effect(
    "an agent that joins the chat joins at its head, so its first turn opens with nothing that was said before it, and with what is said after",
    () =>
      Effect.gen(function* () {
        const chat = yield* openAgents();
        yield* chat.post(chat.first, { text: "Said before the newcomer." });
        const started = yield* startedAgent(chat.owner, chat.task.id, chat.ask);
        const newcomer: ChatAgent = { ...chat.first, agentId: started.agent.id };
        assert.equal(yield* chatDigest(newcomer), undefined);
        const after = yield* chat.post(chat.first, { text: "Said after." });
        assert.ok("seq" in after);
        assert.equal(
          yield* chatDigest(newcomer),
          `${CHAT_DIGEST_HEADING}\nm ${after.seq} · ${chat.handles.first} in #teammate-invitations: Said after.`,
        );
      }),
  );
});
