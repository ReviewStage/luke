import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { GITHUB_ACCOUNT_TYPE } from "@luke/database/github-installation-vocabulary";
import {
  readAccountPreferences,
  writeAccountPreferences,
} from "@luke/database/models/account-store";
import { MENTIONED_HEADING } from "@luke/database/models/attached-file-parts";
import {
  createAutomation,
  recordAutomationRun,
  settleAutomationRun,
} from "@luke/database/models/automation-store";
import {
  answerAsk,
  ensureMember,
  ensureTaskChannel,
  findOrMakeDm,
  history,
  memberNamed,
  postAsk,
  postMessage,
  readAttachment,
  readTo,
  roster,
  unreadFor,
} from "@luke/database/models/chat-store";
import {
  archiveCodingAgent,
  type CodingAgent,
  createCodingAgent,
  discardCodingAgent,
  lineSendersOf,
  readCodingAgent,
  readCodingAgentByKey,
  readCodingAgentPublished,
  recordCodingAgentCompaction,
  recordCodingAgentPublished,
  recordCodingAgentStep,
  renameCodingAgent,
  takeCodingAgentMentionedServers,
  updateCodingAgentBranch,
} from "@luke/database/models/coding-agent-store";
import { keepConversationPicture } from "@luke/database/models/conversation-pictures";
import { childConversationId, sentLineId } from "@luke/database/models/ids";
import { listMessagesPast, sentLineStands } from "@luke/database/models/message-reads";
import { writePage } from "@luke/database/models/plan-pages";
import { claimRuntimeSession } from "@luke/database/models/recorded-session";
import { holdSandbox } from "@luke/database/models/sandbox-terminal-lease";
import {
  openTaskConversation,
  readTask,
  savePlanText,
  updateTask,
} from "@luke/database/models/task-store";
import { ensurePersonalWorkspace } from "@luke/database/models/workspace-store";
import { storeWriter } from "@luke/database/models/writer";
import { member, user } from "@luke/database/schemas/auth";
import { codingAgent } from "@luke/database/schemas/coding-agent";
import { githubInstallation } from "@luke/database/schemas/github-installation";
import { conversations, messages } from "@luke/database/schemas/storage";
import { CONVERSATION_KIND, MESSAGE_SENDER } from "@luke/database/storage-vocabulary";
import {
  fakeWorkspaceSeams,
  getTestDB,
  joinWorkspace,
  openWorkspace,
  startTask,
} from "@luke/database/testing";
import { HOSTED_API_ERROR } from "@luke/features";
import {
  ACCOUNT_CHAT_REASON,
  ACCOUNT_INBOX_ARCHIVED,
  accountInboxAnswerSchema,
} from "@luke/features/account-inbox-wire";
import {
  firstMessageParts,
  firstMessageText,
  REPLAY_SENDER,
  REPLAY_STEP_KIND,
  REPLAY_TOOL_STATE,
  START_NOTE_HEADING,
  stepsBytes,
} from "@luke/features/agent-replay";
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
  chatAnswerSchema,
  chatWriteAnswerSchema,
  MEMBER_KIND,
  mentionedHandles,
} from "@luke/features/chat-wire";
import {
  CHECK_SUMMARY,
  CODING_AGENT_ARCHIVER,
  CODING_AGENT_ATTACHMENT_TYPE,
  CODING_AGENT_BOUNDS,
  CODING_AGENT_BRIEF,
  CODING_AGENT_SENDER,
  CODING_AGENT_STATUS,
  type CodingAgentMessage,
  codingAgentAnswerSchema,
  codingAgentChangesAnswerSchema,
  codingAgentListAnswerSchema,
  codingAgentMessagesAnswerSchema,
  codingAgentOverviewConversationAnswerSchema,
  codingAgentOverviewPullRequestAnswerSchema,
  codingAgentPageAnswerSchema,
  codingAgentPullRequestAnswerSchema,
  PULL_REQUEST_STATE,
} from "@luke/features/coding-agent-wire";
import {
  INBOX_ANSWER_LEAD,
  INBOX_BLOCK,
  INBOX_CURSOR_START,
  INBOX_IMAGE_TYPE,
  INBOX_MESSAGE_LEAD,
  INBOX_REPLY,
  INBOX_RESPONSE,
  INBOX_STATUS,
  type InboxImageBlock,
  type InboxPost,
  inboxAnsweredSchema,
  inboxAnswerSchema,
  inboxMessagedSchema,
  inboxReadAllSchema,
  inboxReadStateSchema,
} from "@luke/features/inbox-wire";
import { INTEGRATION_PROVIDER, type IntegrationProvider } from "@luke/features/integration-wire";
import { MENTION_KIND, mentionMarkdown } from "@luke/features/mention-link";
import { CODING_AGENT_DEFAULT_CHOICE, MODEL_PROVIDER } from "@luke/features/models-wire";
import { PAGE_SHOWER } from "@luke/features/page-wire";
import { PULL_REQUEST_WRITE_BOUNDS, REACTION } from "@luke/features/pull-request-write-wire";
import { REPOSITORY_UNREACHED } from "@luke/features/repository-reach-wire";
import {
  TASK_LIST_ARCHIVED,
  taskListAnswerSchema,
  taskStartAnswerSchema,
} from "@luke/features/task-wire";
import { EXPERIMENT } from "@luke/settings";
import { unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import { temporaryDirectory } from "@luke/wire/testing";
import { MockLanguageModelV4 } from "ai/test";
import { and, eq } from "drizzle-orm";
import {
  Clock,
  DateTime,
  Deferred,
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
import { afterEach, type TestContext, vi } from "vitest";
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
import { recordingProductAnalytics, SERVER_EVENT } from "../events/server-events.js";
import { LINK_OUTCOME, linkInstallation } from "../github/github-installations.js";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import { answerInboxItem, type InboxImage, postInboxItem } from "../inbox/inbox-store.js";
import { modelCatalogOf, type OfferedModel } from "../providers/model-catalog.js";
import { tasksApp } from "../tasks/tasks-app.js";
import { openedPagePolicy, SANDBOXED_PAGE } from "../testing/content-policy.js";
import {
  connectWorkspaceGitHub,
  type FakeGitHub,
  GITHUB_FIXTURE_INSTALLATION_TOKEN,
  githubReaching,
  type InstallationFixture,
  openGithubUser,
  type RepositoryScript,
  type SentToGitHub,
  standingGithubRow,
} from "../testing/github-app-fake.js";
import { CONNECTOR_ASKED_NOTHING, integrationConnectOf } from "../testing/integration-connect.js";
import {
  fixtureOidcToken,
  SOURCE_SANDBOX,
  type SourceCheckout,
  sourceCheckout,
  sourceSandbox,
} from "../testing/source-sandbox.js";
import { BRAIN_HOST_TURN } from "./brain-host/bounds.js";
import {
  EVE_CANCEL_OUTCOME,
  EVE_RESET_OUTCOME,
  EVE_SEND_OUTCOME,
  type EveMessage,
  type EveSessions,
  EveUnreachable,
} from "./brain-host/eve-sessions.js";
import { chatApp } from "./chat-app.js";
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
import {
  CHAT_DOORS,
  type ChatTelling,
  HELD_DOORS,
  postChat,
  tellMessage,
} from "./coder-host/chat-notify.js";
import type { InboxSandboxDoor } from "./coder-host/inbox-image.js";
import { accountInboxPast } from "./coder-host/inbox-page.js";
import { REPLAY_BOUNDS } from "./coder-host/replay.js";
import type { SummaryModelOf } from "./coder-host/replay-summary.js";
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
 * and the store PGlite. Synthetic accounts, bearers, tasks, and words
 * throughout.
 */

const ORIGIN = "https://luke.test";
const TASK_AGENTS = "/api/plans/agents";
const AGENT_MESSAGES = "/api/agents/messages";
const AGENT = "/api/agents/agent";
const AGENT_INBOX = "/api/agents/inbox";
const WORKSPACE_AGENTS = "/api/agents";
/** The overview's three reads, each its own route. */
const AGENT_OVERVIEW = [
  "/api/agents/overview-pull-request",
  "/api/agents/overview-checks",
  "/api/agents/overview-conversation",
] as const;
/** One task, served by the tasks group, whose delete stops the task's agents through the same Stop. */
const TASK = "/api/plans/plan";
/** The account's tasks, served by the tasks group, each naming its agents in brief. */
const TASKS = "/api/plans";
/** A workspace's chat, served by the chat group, whose posts tell the agents through the same door. */
const CHAT = "/api/workspaces/chat";

const RELAY = { owner: "Acme", name: "Relay" } as const;
const RELAY_FULL_NAME = `${RELAY.owner}/${RELAY.name}`;

/** Where the group serves an image an agent's pull request's overview names. */
const AGENT_GITHUB_IMAGE = "/api/agents/github-image";

/** An SVG a repository might hold, with a script in it that must never run as a page of the service. */
const SCRIPTED_SVG = new TextEncoder().encode(
  '<svg xmlns="http://www.w3.org/2000/svg"><script>fetch("/api/plans")</script></svg>',
);

/** The installation ids handed out so far: one installation stands for one workspace, so each task's workspace connects its own. */
let installationsConnected = 0;

/** A fresh installation reaching the repository, on an account of its own. */
function freshInstallation(): InstallationFixture {
  installationsConnected += 1;
  return { id: 7 + installationsConnected, login: RELAY.owner, repositories: [RELAY] };
}

const SAVED =
  "## Goal\n\nInvite a teammate by email.\n\n## Assumptions\n\n- Invites expire after 7 days.\n";

/** The saved plan as Copy writes it, its name as a title over its text, which is what an agent started on the task is handed. */
const SNAPSHOT = `# Teammate invitations\n\n${SAVED}`;

const SOL = "openai/gpt-6.1-sol";

/** A model offering two context windows, as OpenAI prices its long context apart. */
const GPT_LONG = "openai/gpt-5.5";

/** How many long turns a long source's transcript holds past its brief. */
const LONG_TURNS = 30;

/** A model with a small window, which a long replay does not fit whole. */
const SMALL_WINDOW = { model: "anthropic/claude-sonnet-4.9", tokens: 60_000 } as const;

/** The models offered, each with its prices in dollars per token, one with two windows. */
const CATALOG: readonly OfferedModel[] = [
  {
    id: SMALL_WINDOW.model,
    name: "Claude Sonnet 4.9",
    provider: MODEL_PROVIDER.ANTHROPIC,
    efforts: ["low", "high"],
    contextWindow: SMALL_WINDOW.tokens,
  },
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

/** What the endpoints counted, across the file; a test reads its own account's. */
const ANALYTICS = recordingProductAnalytics();

/** How many of one event the account was counted for. */
const countedFor = (userId: string, name: string) =>
  ANALYTICS.recorded.filter((event) => event.userId === userId && event.name === name).length;

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
  summaryModel: SummaryModelOf = () => Effect.succeed(undefined),
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
      ANALYTICS.layer,
    );
    const seams = {
      resolveUserId: (incoming: Request) =>
        Effect.succeed(
          Option.fromNullishOr(bearers.get(incoming.headers.get("authorization") ?? "")),
        ),
      eveOrigin: () => ORIGIN,
      eve: (authorization: Redacted.Redacted) => eve.eve(Redacted.value(authorization)),
      // The deployment acting for an agent's starter, which the fake writes down as the starter's bearer.
      eveAs: (starter: string) => eve.eve(`Bearer ${starter}`),
      workspaces: yield* fakeWorkspaceSeams,
      summaryModel,
    };
    const agents = HttpRouter.toWebHandler(
      codingAgentsApp(seams).pipe(HttpRouter.provideRequest(services)),
      { disableLogger: true },
    );
    const tasks = HttpRouter.toWebHandler(
      tasksApp(seams).pipe(HttpRouter.provideRequest(services)),
      { disableLogger: true },
    );
    const chat = HttpRouter.toWebHandler(chatApp(seams).pipe(HttpRouter.provideRequest(services)), {
      disableLogger: true,
    });
    yield* Effect.addFinalizer(() =>
      Effect.promise(() => Promise.all([agents.dispose(), tasks.dispose(), chat.dispose()])),
    );
    /** The response as the function answers it, for the one route that answers bytes; a task's own path and the list land on the tasks group, and the chat's on the chat's. */
    const fetch = (request: Request) =>
      Effect.promise(() => {
        const { pathname } = new URL(request.url);
        if (pathname === CHAT) return chat.handler(request);
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
    src?: string;
  } = {},
): Request {
  const url = new URL(path, ORIGIN);
  if (init.id !== undefined) url.searchParams.set("id", init.id);
  if (init.archived !== undefined) url.searchParams.set("archived", init.archived);
  if (init.after !== undefined) url.searchParams.set("after", init.after);
  if (init.call !== undefined) url.searchParams.set("call", init.call);
  if (init.attachment !== undefined) url.searchParams.set("attachment", init.attachment);
  if (init.picture !== undefined) url.searchParams.set("picture", init.picture);
  if (init.src !== undefined) url.searchParams.set("src", init.src);
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
 * An owner who holds one task on the repository, its workspace connected to
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
    /** The other account's GitHub token, or none where it holds no GitHub sign-in at all; the standing row's when unsaid. */
    readonly otherToken?: string | null;
    /** The model a replay's summary is written on; none unless a test names one. */
    readonly summaryModel?: SummaryModelOf;
  } = {},
) =>
  Effect.gen(function* () {
    const owner = yield* openGithubUser();
    const other = yield* otherAccount(options.otherToken);
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
    const { ask, fetch } = yield* standing(
      bearers,
      github,
      eve,
      options.titles ?? false,
      options.summaryModel,
    );
    return { owner, other, task, installation, eve, github, ask, fetch };
  });

/** An account beside the owner: signed in with GitHub on the token given, the standing row's when unsaid, or with no GitHub sign-in at all. */
const otherAccount = (token: string | null | undefined) =>
  Effect.gen(function* () {
    if (token === undefined) return yield* openGithubUser();
    if (token !== null) {
      return yield* openGithubUser({
        ...standingGithubRow(yield* Clock.currentTimeMillis),
        accessToken: token,
      });
    }
    const db = yield* Database;
    const userId = `user-${randomUUID()}`;
    yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
    return userId;
  });

/** The pull request an agent published from its branch, as GitHub holds it. */
const PUBLISHED = { branch: "luke/teammate-invitations", number: 12, headSha: "c0ffee1" } as const;

/** The repository answering the published pull request's reads, its overview's among them: no checks, no comments, no reviews. */
/** The same, the pull request a draft while `draft` says it is, its head the commit given, GitHub's short fixture one unless told. */
const publishedPullRequestDrafted =
  (draft: () => boolean, headSha: string = PUBLISHED.headSha): RepositoryScript =>
  (sent) => {
    const repository = `/repos/${RELAY.owner}/${RELAY.name}`;
    const pull = `${repository}/pulls/${PUBLISHED.number}`;
    const commit = `${repository}/commits/${PUBLISHED.headSha}`;
    // The overview's checks name the head by the ref GitHub keeps on the pull request.
    const head = `${repository}/commits/refs%2Fpull%2F${PUBLISHED.number}%2Fhead`;
    switch (new URL(sent.url).pathname) {
      case `${repository}/pulls`:
        return Response.json([{ number: PUBLISHED.number }]);
      case pull:
        return Response.json({
          number: PUBLISHED.number,
          title: "Expire teammate invitations",
          html_url: `https://github.com/${RELAY_FULL_NAME}/pull/${PUBLISHED.number}`,
          state: "open",
          draft: draft(),
          merged: false,
          merged_at: null,
          additions: 4,
          deletions: 1,
          changed_files: 1,
          body: "Invitations expire.",
          body_html: "<p>Invitations expire.</p>",
          base: { ref: "main" },
          head: { ref: PUBLISHED.branch, sha: headSha },
          created_at: "2026-10-15T09:00:00Z",
          mergeable_state: "clean",
          user: null,
          requested_reviewers: [],
        });
      case `${commit}/check-runs`:
      case `${head}/check-runs`:
        return Response.json({ check_runs: [] });
      case `${commit}/status`:
      case `${head}/status`:
        return Response.json({ statuses: [] });
      case `${repository}/issues/${PUBLISHED.number}/comments`:
      case `${pull}/reviews`:
        return Response.json([]);
      default:
        return undefined;
    }
  };

const publishedPullRequest = publishedPullRequestDrafted(() => false);

/** What GitHub was asked on the way to a repository token: the installation read, its listing and the token minted for it, and the repository's own token. */
function reachRequests(sent: readonly SentToGitHub[], installationId: number) {
  const app = `https://api.github.com/app/installations/${installationId}`;
  const mints = sent.filter((one) => one.url === `${app}/access_tokens`);
  const forRepository = (one: SentToGitHub) => "repositories" in JSON.parse(one.body);
  return {
    installationReads: sent.filter((one) => one.url === app).length,
    listings: sent.filter((one) => new URL(one.url).pathname === "/installation/repositories")
      .length,
    listingMints: mints.filter((one) => !forRepository(one)).length,
    repositoryMints: mints.filter(forRepository).length,
  };
}

it.layer(getTestDB())("the coding-agent routes", (it) => {
  it.effect(
    "a Start whose prompt mentions a page the store cannot read is refused before any agent is made, so a retry under its key starts afresh",
    () =>
      Effect.gen(function* () {
        const { owner, task, eve, ask } = yield* openTask();
        const shown = yield* writePage(
          owner,
          task.id,
          { title: "Chart", html: "<h1>Chart</h1>" },
          { kind: PAGE_SHOWER.LUKE },
        );
        assert.ok(Option.isSome(shown));
        const prompt = `Build ${mentionMarkdown({ kind: MENTION_KIND.PAGE, taskId: task.id, pageId: shown.value.id }, "Chart", { workspace: "acme", repository: task.repository })}.`;
        const idempotencyKey = randomUUID();
        const sql = yield* SqlClient.SqlClient;
        // The pages' table is moved aside for the Start alone, so the store's read of the page fails.
        const answered = yield* Effect.ensuring(
          Effect.andThen(
            sql.unsafe("ALTER TABLE plan_page_version RENAME TO plan_page_version_aside"),
            ask(startAs(owner, task.id, { idempotencyKey, task: prompt })),
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
    "a task's start naming an agent makes the task with an empty plan and starts the agent on it with the prompt, opening its session as the developer",
    () =>
      Effect.gen(function* () {
        const { owner, task, eve, ask } = yield* openTask();
        const prompt = "Expire invitations after a week.";

        const started = yield* ask(
          request(TASKS, owner, {
            method: "POST",
            body: {
              workspaceId: task.workspaceId,
              repository: RELAY_FULL_NAME,
              agent: { idempotencyKey: randomUUID(), prompt },
            },
          }),
        );

        const { plan, agent, agentRefusal } = readAnswer(
          taskStartAnswerSchema,
          HOSTED_HTTP_STATUS.CREATED,
          started,
        );
        assert.equal(agentRefusal, undefined);
        assert.ok(agent !== undefined);
        assert.notEqual(plan.id, task.id);
        assert.equal(plan.repository, RELAY_FULL_NAME);
        assert.equal(plan.document.body, "");
        assert.equal(agent.planId, plan.id);
        assert.equal(agent.brief, CODING_AGENT_BRIEF.PROMPT);
        assert.equal(agent.status, CODING_AGENT_STATUS.STARTING);
        assert.deepEqual(
          eve.opened.map((opened) => [opened.authorization, opened.message.message]),
          [[`Bearer ${owner}`, prompt]],
        );
      }),
  );

  it.effect(
    "a task's start retried under its agent's key answers the task and the agent the first made, and starts neither again; the key named for another workspace is refused",
    () =>
      Effect.gen(function* () {
        const { owner, task, eve, ask } = yield* openTask();
        const team = yield* openWorkspace(owner);
        const body = {
          name: "Invitation expiry",
          workspaceId: task.workspaceId,
          repository: RELAY_FULL_NAME,
          agent: { idempotencyKey: randomUUID(), prompt: "Expire invitations after a week." },
        };
        const startOnce = (status: number) =>
          Effect.map(ask(request(TASKS, owner, { method: "POST", body })), (answered) =>
            readAnswer(taskStartAnswerSchema, status, answered),
          );

        const first = yield* startOnce(HOSTED_HTTP_STATUS.CREATED);
        const again = yield* startOnce(HOSTED_HTTP_STATUS.OK);
        const elsewhere = yield* ask(
          request(TASKS, owner, { method: "POST", body: { ...body, workspaceId: team } }),
        );
        const listed = readAnswer(
          taskListAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(TASKS, owner)),
        );

        assert.equal(again.plan.id, first.plan.id);
        assert.equal(again.agent?.id, first.agent?.id);
        assert.deepEqual(
          elsewhere,
          refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST),
        );
        assert.equal(eve.opened.length, 1);
        assert.deepEqual(
          listed.plans.filter((each) => each.name === body.name).map((each) => each.id),
          [first.plan.id],
        );
      }),
  );

  it.effect(
    "a task's start whose agent eve does not take answers the task it made with the agent's refusal, and the task stands",
    () =>
      Effect.gen(function* () {
        const { owner, task, ask } = yield* openTask({ eve: fakeEve({ reachable: false }) });

        const started = readAnswer(
          taskStartAnswerSchema,
          HOSTED_HTTP_STATUS.CREATED,
          yield* ask(
            request(TASKS, owner, {
              method: "POST",
              body: {
                workspaceId: task.workspaceId,
                repository: RELAY_FULL_NAME,
                agent: { idempotencyKey: randomUUID(), prompt: "Expire invitations." },
              },
            }),
          ),
        );
        const opened = yield* ask(request(TASK, owner, { id: started.plan.id }));

        assert.equal(started.agent, undefined);
        assert.deepEqual(started.agentRefusal, { error: HOSTED_API_ERROR.UNAVAILABLE });
        assert.equal(opened.status, HOSTED_HTTP_STATUS.OK);
      }),
  );

  it.effect(
    "a task's start naming an agent is refused with nothing made where it names no repository, as an agent's Start on such a task is, or asks for planning beside it",
    () =>
      Effect.gen(function* () {
        const { owner, task, eve, ask } = yield* openTask();
        const agent = { idempotencyKey: randomUUID(), prompt: "Expire invitations." };
        const startWith = (body: WireBoundaryInput) =>
          ask(request(TASKS, owner, { method: "POST", body }));

        const answered = [
          yield* startWith({ name: "No repository", workspaceId: task.workspaceId, agent }),
          yield* startWith({
            name: "Null repository",
            workspaceId: task.workspaceId,
            repository: null,
            agent,
          }),
          yield* startWith({
            name: "Planned",
            workspaceId: task.workspaceId,
            repository: RELAY_FULL_NAME,
            planning: true,
            agent,
          }),
        ];
        const listed = readAnswer(
          taskListAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(TASKS, owner)),
        );

        assert.deepEqual(answered, [
          refusal(HOSTED_HTTP_STATUS.CONFLICT, HOSTED_API_ERROR.NO_REPOSITORY),
          refusal(HOSTED_HTTP_STATUS.CONFLICT, HOSTED_API_ERROR.NO_REPOSITORY),
          refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST),
        ]);
        assert.deepEqual(
          listed.plans.map((each) => each.id),
          [task.id],
        );
        assert.deepEqual(eve.opened, []);
      }),
  );

  it.effect(
    "a Start naming a model runs that agent on it and leaves the account's default as it stands, which only Settings writes",
    () =>
      Effect.gen(function* () {
        const { owner, task, ask } = yield* openTask();

        const started = yield* ask(
          startAs(owner, task.id, { idempotencyKey: randomUUID(), model: SOL, effort: "low" }),
        );

        const { agent } = readAnswer(codingAgentAnswerSchema, HOSTED_HTTP_STATUS.CREATED, started);
        assert.equal(agent.model, SOL);
        assert.equal(agent.effort, "low");
        assert.equal((yield* readAccountPreferences(owner))?.codingAgent, undefined);
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

  it.effect(
    "an agent's pull request overview, its three reads asked at once and then again, reaches the repository through its installation once and mints one token for it, and a read past the token's hour mints afresh",
    () =>
      Effect.gen(function* () {
        const { owner, task, installation, github, ask } = yield* openTask({
          github: publishedPullRequest,
        });
        const { agent } = yield* startedAgent(owner, task.id, ask);
        yield* updateCodingAgentBranch(owner, agent.id, PUBLISHED.branch);
        // Note that the Start reached the repository itself, so the reads begin past every kept answer.
        yield* TestClock.adjust(Duration.hours(2));
        const asked = github.sent.length;
        const overview = () =>
          Effect.all(
            AGENT_OVERVIEW.map((path) => ask(request(path, owner, { id: agent.id }))),
            { concurrency: "unbounded" },
          );

        const cold = yield* overview();
        const warm = yield* overview();

        for (const read of cold) {
          assert.equal(read.status, HOSTED_HTTP_STATUS.OK, JSON.stringify(read.body));
        }
        assert.deepEqual(warm, cold);
        assert.deepEqual(reachRequests(github.sent.slice(asked), installation.id), {
          installationReads: 1,
          listings: 1,
          listingMints: 1,
          repositoryMints: 1,
        });

        const later = github.sent.length;
        yield* TestClock.adjust(Duration.hours(1));
        assert.deepEqual(yield* overview(), cold);
        assert.equal(reachRequests(github.sent.slice(later), installation.id).repositoryMints, 1);
      }),
  );

  it.effect(
    "an SVG of the agent's own repository that its pull request's overview names is served as its bytes, sandboxed so it never runs as a page of the service",
    () =>
      Effect.gen(function* () {
        const contents = `/repos/${RELAY_FULL_NAME}/contents/docs/diagram.svg`;
        const { owner, task, ask, fetch } = yield* openTask({
          github: (sent) =>
            new URL(sent.url).pathname === contents
              ? new Response(SCRIPTED_SVG, {
                  headers: { "content-type": "application/vnd.github.raw" },
                })
              : undefined,
        });
        const { agent } = yield* startedAgent(owner, task.id, ask);

        const served = yield* fetch(
          request(AGENT_GITHUB_IMAGE, owner, {
            id: agent.id,
            src: `https://raw.githubusercontent.com/${RELAY_FULL_NAME}/main/docs/diagram.svg`,
          }),
        );

        assert.equal(served.status, HOSTED_HTTP_STATUS.OK);
        assert.equal(served.headers.get("content-type"), "image/svg+xml");
        assert.deepEqual(openedPagePolicy(served.headers), SANDBOXED_PAGE);
        assert.equal(served.headers.get("x-content-type-options"), "nosniff");
        assert.equal(served.headers.get("cache-control"), "private, no-store");
        assert.deepEqual(
          new Uint8Array(yield* Effect.promise(() => served.arrayBuffer())),
          SCRIPTED_SVG,
        );
      }),
  );
});

const AGENT_PULL_REQUEST_ACTION = "/api/agents/pull-request-action";
const AGENT_PULL_REQUEST_VIEWED = "/api/agents/pull-request-viewed";
const AGENT_PULL_REQUEST = "/api/agents/pull-request";
/** The agent's changes, the files Files changed draws. */
const AGENT_CHANGES = "/api/agents/changes";
const AGENT_OVERVIEW_PULL_REQUEST = AGENT_OVERVIEW[0];

/** The GraphQL id GitHub gives the published pull request. */
const PULL_REQUEST_NODE_ID = "PR_kwDOfixture12";

/** One GraphQL call as GitHub saw it: the bearer it came under, and its document's words. */
interface GraphqlCall {
  readonly authorization: string | null;
  readonly query: string;
  readonly variables: Readonly<Record<string, string | number>>;
}

/**
 * The repository answering the published pull request's reads as
 * `publishedPullRequest` does, and GitHub's GraphQL endpoint answering each
 * call as `answer` says, every call written down: by default the pull
 * request's id for its read and an empty answer for any mutation.
 */
function graphqlAnswering(
  calls: GraphqlCall[],
  answer: (call: GraphqlCall) => Response = (call) =>
    Response.json({
      data: call.query.includes("mutation")
        ? {}
        : { repository: { pullRequest: { id: PULL_REQUEST_NODE_ID } } },
    }),
  repository: RepositoryScript = publishedPullRequest,
): RepositoryScript {
  return (sent) => {
    if (new URL(sent.url).pathname !== "/graphql") return repository(sent);
    const { query, variables } = JSON.parse(sent.body);
    const call = { authorization: sent.headers.get("authorization"), query, variables };
    calls.push(call);
    return answer(call);
  };
}

/** A change to the agent's pull request as the bearer given, with the fields beside its action given. */
function actionAs(
  bearer: string,
  agentId: string,
  action: string,
  fields: Readonly<Record<string, string>> = {},
): Request {
  return request(AGENT_PULL_REQUEST_ACTION, bearer, {
    method: "POST",
    id: agentId,
    body: { action, ...fields },
  });
}

/** How the published pull request may be merged, as GitHub's GraphQL answers the merge box's read. */
const MERGING_ANSWER = {
  data: {
    repository: {
      mergeCommitAllowed: false,
      squashMergeAllowed: true,
      rebaseMergeAllowed: true,
      autoMergeAllowed: true,
      pullRequest: {
        headRefOid: PUBLISHED.headSha,
        isMergeQueueEnabled: false,
        mergeQueueEntry: null,
        autoMergeRequest: { mergeMethod: "SQUASH" },
        reviewDecision: "REVIEW_REQUIRED",
        commits: { nodes: [{ commit: { statusCheckRollup: { state: "PENDING" } } }] },
      },
    },
  },
} as const;

/** The mutation a GraphQL call made, by the field it named; none for a read. */
function mutationOf(call: GraphqlCall): string | undefined {
  return /mutation[^{]*\{\s*(\w+)/u.exec(call.query)?.[1];
}

/** A review submitted on the agent's pull request as the bearer given. */
function reviewAs(
  bearer: string,
  agentId: string,
  review: { readonly event: string; readonly body: string },
): Request {
  return request(AGENT_PULL_REQUEST_ACTION, bearer, {
    method: "POST",
    id: agentId,
    body: { action: "submit-review", ...review },
  });
}

/** One of the pull request's pending reviews as GitHub answers it: its id, whether the asker wrote it, and the commit it was started on where told. */
interface PendingNode {
  readonly id: string;
  readonly viewerDidAuthor: boolean;
  readonly commit?: { readonly oid: string };
}

/**
 * GitHub answering a review's calls: the pull request's id, the pending
 * reviews given for its read of them, and each mutation as `mutation`
 * says, an empty answer by default.
 */
function reviewsAnswering(
  pending: readonly PendingNode[],
  mutation: (call: GraphqlCall) => Response = () => Response.json({ data: {} }),
): (call: GraphqlCall) => Response {
  return (call) => {
    if (call.query.includes("mutation")) return mutation(call);
    if (call.query.includes("reviews(states: PENDING")) {
      return Response.json({ data: { node: { reviews: { nodes: pending } } } });
    }
    return Response.json({ data: { repository: { pullRequest: { id: PULL_REQUEST_NODE_ID } } } });
  };
}

/** The review mutations GitHub was sent, each as which (a new review, or a pending one submitted) and its variables. */
function reviewMutations(calls: readonly GraphqlCall[]) {
  return calls
    .filter((call) => call.query.includes("mutation"))
    .map((call) => [
      call.query.includes("submitPullRequestReview") ? "submit" : "add",
      call.variables,
    ]);
}

/** A change to one of the pull request's review threads as the bearer given. */
function threadActionAs(bearer: string, agentId: string, body: WireBoundaryInput): Request {
  return request(AGENT_PULL_REQUEST_ACTION, bearer, { method: "POST", id: agentId, body });
}

/**
 * GitHub answering the viewed read a page at a time, the first page's
 * cursor naming the second, and the pull request's id and an empty answer
 * to each mutation.
 */
function viewedAnswering(call: GraphqlCall): Response {
  if (call.query.includes("mutation")) return Response.json({ data: {} });
  if (!call.query.includes("viewerViewedState")) {
    return Response.json({ data: { repository: { pullRequest: { id: PULL_REQUEST_NODE_ID } } } });
  }
  const first = call.variables.after === null;
  const nodes = first
    ? [
        { path: "src/seats.ts", viewerViewedState: "VIEWED" },
        { path: "src/plan.ts", viewerViewedState: "DISMISSED" },
      ]
    : [{ path: "README.md", viewerViewedState: "UNVIEWED" }];
  return Response.json({
    data: {
      repository: {
        pullRequest: {
          files: {
            nodes,
            pageInfo: { hasNextPage: first, endCursor: first ? "cursor-2" : null },
          },
        },
      },
    },
  });
}

/** GitHub answering a thread's calls: the pull request's id, every thread named as one of the pull request given, and an empty answer to each mutation. */
function threadsAnswering(threadPullRequestId: string): (call: GraphqlCall) => Response {
  return (call) => {
    if (call.query.includes("mutation")) return Response.json({ data: {} });
    if (call.query.includes("PullRequestReviewThread")) {
      return Response.json({ data: { node: { pullRequest: { id: threadPullRequestId } } } });
    }
    return Response.json({ data: { repository: { pullRequest: { id: PULL_REQUEST_NODE_ID } } } });
  };
}

/** The GitHub mutation a document makes, by the name its first field spells. */
function mutationName(query: string): string {
  return /\{\s*(\w+)\(/u.exec(query)?.[1] ?? "";
}

/** The head a line comment names, as GitHub spells a commit. */
const LINE_HEAD = "c0ffee1c0ffee1c0ffee1c0ffee1c0ffee1c0ffe";

/** A comment on lines of the agent's pull request as the bearer given, on `src/invite.ts` line 12 on the new side unless the fields say otherwise. */
function lineCommentAs(
  bearer: string,
  agentId: string,
  fields: Readonly<Record<string, string | number>>,
): Request {
  return request(AGENT_PULL_REQUEST_ACTION, bearer, {
    method: "POST",
    id: agentId,
    body: {
      action: "add-review-comment",
      path: "src/invite.ts",
      line: 12,
      side: "right",
      body: "Rename this.",
      headSha: LINE_HEAD,
      ...fields,
    },
  });
}

/** GitHub answering a line comment's and a discard's calls: the member's pending reviews as given, and an empty answer to every mutation. */
function linesAnswering(pending: readonly PendingNode[]): (call: GraphqlCall) => Response {
  return reviewsAnswering(pending);
}

it.layer(getTestDB())("changing an agent's pull request", (it) => {
  /** The owner's plan with an agent that published a pull request, and the other account where the test makes it a member. */
  const published = (options: {
    readonly answer?: (call: GraphqlCall) => Response;
    readonly repository?: RepositoryScript;
    readonly otherToken?: string | null;
    readonly otherJoins?: boolean;
  }) =>
    Effect.gen(function* () {
      const calls: GraphqlCall[] = [];
      const opened = yield* openTask({
        github: graphqlAnswering(calls, options.answer, options.repository),
        ...(options.otherToken === undefined ? undefined : { otherToken: options.otherToken }),
      });
      if (options.otherJoins ?? true) yield* joinWorkspace(opened.task.workspaceId, opened.other);
      const { agent } = yield* startedAgent(opened.owner, opened.task.id, opened.ask);
      yield* updateCodingAgentBranch(opened.owner, agent.id, PUBLISHED.branch);
      return { ...opened, agent, calls };
    });

  it.effect(
    "a teammate marks the owner's agent's draft ready for review and turns it back into a draft, each on the teammate's own GitHub token and never the App's",
    () =>
      Effect.gen(function* () {
        const { other, agent, calls, ask } = yield* published({ otherToken: "ghu_teammate" });

        const ready = yield* ask(actionAs(other, agent.id, "ready-for-review"));
        const draft = yield* ask(actionAs(other, agent.id, "convert-to-draft"));

        assert.deepEqual(ready, { status: HOSTED_HTTP_STATUS.OK, body: { outcome: "done" } });
        assert.deepEqual(draft, { status: HOSTED_HTTP_STATUS.OK, body: { outcome: "done" } });
        assert.ok(calls.length > 0);
        assert.ok(calls.every((call) => call.authorization === "Bearer ghu_teammate"));
        const mutations = calls.filter((call) => call.query.includes("mutation"));
        assert.deepEqual(
          mutations.map((call) => [
            call.query.includes("markPullRequestReadyForReview")
              ? "ready"
              : call.query.includes("convertPullRequestToDraft")
                ? "draft"
                : "other",
            call.variables.id,
          ]),
          [
            ["ready", PULL_REQUEST_NODE_ID],
            ["draft", PULL_REQUEST_NODE_ID],
          ],
        );
        assert.deepEqual(calls[0]?.variables, {
          owner: RELAY.owner,
          name: RELAY.name,
          number: PUBLISHED.number,
        });
      }),
  );

  it.effect(
    "a merge, auto-merge on and off, and leaving the merge queue are each made on GitHub as the member, a merge and auto-merge against the head they saw",
    () =>
      Effect.gen(function* () {
        const { other, agent, calls, ask } = yield* published({ otherToken: "ghu_teammate" });
        const head = { headSha: PUBLISHED.headSha };

        const answers = [
          yield* ask(actionAs(other, agent.id, "merge", { method: "squash", ...head })),
          yield* ask(actionAs(other, agent.id, "enable-auto-merge", { method: "rebase", ...head })),
          yield* ask(actionAs(other, agent.id, "enable-auto-merge", head)),
          yield* ask(actionAs(other, agent.id, "disable-auto-merge")),
          yield* ask(actionAs(other, agent.id, "dequeue")),
        ];

        assert.deepEqual(
          answers.map((answer) => answer.body),
          answers.map(() => ({ outcome: "done" })),
        );
        assert.ok(calls.every((call) => call.authorization === "Bearer ghu_teammate"));
        const id = PULL_REQUEST_NODE_ID;
        assert.deepEqual(
          calls.flatMap((call) => {
            const mutation = mutationOf(call);
            return mutation === undefined ? [] : [[mutation, call.variables]];
          }),
          [
            ["mergePullRequest", { id, method: "SQUASH", head: PUBLISHED.headSha }],
            ["enablePullRequestAutoMerge", { id, head: PUBLISHED.headSha, method: "REBASE" }],
            ["enablePullRequestAutoMerge", { id, head: PUBLISHED.headSha }],
            ["disablePullRequestAutoMerge", { id }],
            ["dequeuePullRequest", { id }],
          ],
        );
      }),
  );

  it.effect(
    "closing, reopening, and retitling are each made on GitHub as the member, and a blank title is refused before GitHub",
    () =>
      Effect.gen(function* () {
        const { other, agent, calls, ask } = yield* published({ otherToken: "ghu_teammate" });

        const answers = [
          yield* ask(actionAs(other, agent.id, "close")),
          yield* ask(actionAs(other, agent.id, "reopen")),
          yield* ask(
            actionAs(other, agent.id, "edit-title", { title: "  Expire invitations weekly " }),
          ),
        ];
        const blank = yield* ask(actionAs(other, agent.id, "edit-title", { title: "   " }));

        assert.deepEqual(
          answers.map((answer) => answer.body),
          answers.map(() => ({ outcome: "done" })),
        );
        assert.deepEqual(
          blank,
          refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST),
        );
        assert.ok(calls.every((call) => call.authorization === "Bearer ghu_teammate"));
        const id = PULL_REQUEST_NODE_ID;
        assert.deepEqual(
          calls.flatMap((call) => {
            const mutation = mutationOf(call);
            return mutation === undefined ? [] : [[mutation, call.variables]];
          }),
          [
            ["closePullRequest", { id }],
            ["reopenPullRequest", { id }],
            ["updatePullRequest", { id, title: "Expire invitations weekly" }],
          ],
        );
      }),
  );

  it.effect(
    "a merge naming no head, or a head that is no commit, is refused before anything reaches GitHub",
    () =>
      Effect.gen(function* () {
        const { other, agent, calls, ask } = yield* published({});
        const invalid = refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);

        assert.deepEqual(
          yield* ask(actionAs(other, agent.id, "merge", { method: "squash" })),
          invalid,
        );
        assert.deepEqual(
          yield* ask(
            actionAs(other, agent.id, "merge", { method: "squash", headSha: "main; drop" }),
          ),
          invalid,
        );
        assert.deepEqual(calls, []);
      }),
  );

  it.effect(
    "the pull request's header read says how it may be merged, read on the App's token, and stands without it where GitHub would not say",
    () =>
      Effect.gen(function* () {
        let answering = true;
        const { owner, agent, calls, ask } = yield* published({
          answer: () =>
            answering
              ? Response.json(MERGING_ANSWER)
              : Response.json({ message: "Server Error" }, { status: 502 }),
        });
        const header = () =>
          Effect.map(
            ask(request(AGENT_OVERVIEW_PULL_REQUEST, owner, { id: agent.id })),
            (answered) =>
              readAnswer(
                codingAgentOverviewPullRequestAnswerSchema,
                HOSTED_HTTP_STATUS.OK,
                answered,
              ).pullRequest,
          );

        const read = yield* header();
        answering = false;
        const without = yield* header();

        assert.deepEqual(read?.merging, {
          methods: ["squash", "rebase"],
          autoMergeAllowed: true,
          queue: false,
          queued: null,
          autoMerge: { method: "squash" },
          headSha: PUBLISHED.headSha,
          review: "review-required",
          checks: "pending",
        });
        assert.ok(
          calls.every(
            (call) => call.authorization === `Bearer ${GITHUB_FIXTURE_INSTALLATION_TOKEN}`,
          ),
        );
        assert.equal(without?.title, read?.title);
        assert.equal(without?.merging, undefined);
      }),
  );

  it.effect(
    "a member with no GitHub sign-in is asked to sign in with GitHub, and nothing is sent to GitHub as anyone else",
    () =>
      Effect.gen(function* () {
        const { other, agent, calls, ask } = yield* published({ otherToken: null });

        const answered = yield* ask(actionAs(other, agent.id, "ready-for-review"));

        assert.deepEqual(answered, {
          status: HOSTED_HTTP_STATUS.OK,
          body: { outcome: "sign-in-required" },
        });
        assert.deepEqual(calls, []);
      }),
  );

  it.effect(
    "a token GitHub refuses asks the member to sign in with GitHub again, and nothing is tried on the App's token",
    () =>
      Effect.gen(function* () {
        const { other, agent, calls, ask } = yield* published({
          otherToken: "ghu_revoked",
          answer: () => Response.json({ message: "Bad credentials" }, { status: 401 }),
        });

        const answered = yield* ask(actionAs(other, agent.id, "convert-to-draft"));

        assert.deepEqual(answered, {
          status: HOSTED_HTTP_STATUS.OK,
          body: { outcome: "sign-in-required" },
        });
        assert.ok(calls.length > 0);
        assert.ok(calls.every((call) => call.authorization === "Bearer ghu_revoked"));
      }),
  );

  it.effect(
    "a change GitHub refuses is answered in GitHub's own words, whether as GraphQL errors or a refusal status",
    () =>
      Effect.gen(function* () {
        const { other, agent, ask } = yield* published({
          answer: (call) =>
            !call.query.includes("mutation")
              ? Response.json({
                  data: { repository: { pullRequest: { id: PULL_REQUEST_NODE_ID } } },
                })
              : call.query.includes("convertPullRequestToDraft")
                ? Response.json(
                    { message: "Resource not accessible by integration" },
                    { status: 403 },
                  )
                : Response.json({
                    data: null,
                    errors: [{ type: "FORBIDDEN", message: "Pull request is not a draft." }],
                  }),
        });

        assert.deepEqual(yield* ask(actionAs(other, agent.id, "ready-for-review")), {
          status: HOSTED_HTTP_STATUS.OK,
          body: { outcome: "refused", words: "Pull request is not a draft." },
        });
        assert.deepEqual(yield* ask(actionAs(other, agent.id, "convert-to-draft")), {
          status: HOSTED_HTTP_STATUS.OK,
          body: { outcome: "refused", words: "Resource not accessible by integration" },
        });
      }),
  );

  it.effect(
    "a teammate who read the pull request a moment before another member marked it ready reads it ready at once, not from what was kept",
    () =>
      Effect.gen(function* () {
        let draft = true;
        const { owner, other, agent, ask } = yield* published({
          repository: publishedPullRequestDrafted(() => draft),
          answer: (call) => {
            if (call.query.includes("markPullRequestReadyForReview")) draft = false;
            return Response.json({
              data: call.query.includes("mutation")
                ? {}
                : { repository: { pullRequest: { id: PULL_REQUEST_NODE_ID } } },
            });
          },
        });
        const stateAs = (bearer: string) =>
          Effect.map(
            ask(request(AGENT_PULL_REQUEST, bearer, { id: agent.id })),
            (answered) =>
              readAnswer(codingAgentPullRequestAnswerSchema, HOSTED_HTTP_STATUS.OK, answered)
                .pullRequest?.state,
          );
        assert.equal(yield* stateAs(owner), PULL_REQUEST_STATE.DRAFT);

        yield* ask(actionAs(other, agent.id, "ready-for-review"));

        assert.equal(yield* stateAs(owner), PULL_REQUEST_STATE.OPEN);
      }),
  );

  it.effect(
    "a pull request GitHub answers as none, with no word of why, is refused in words saying so",
    () =>
      Effect.gen(function* () {
        const { other, agent, calls, ask } = yield* published({
          answer: () => Response.json({ data: { repository: { pullRequest: null } } }),
        });

        assert.deepEqual(yield* ask(actionAs(other, agent.id, "ready-for-review")), {
          status: HOSTED_HTTP_STATUS.OK,
          body: {
            outcome: "refused",
            words: "Could not resolve to a pull request your GitHub account can see.",
          },
        });
        assert.ok(calls.every((call) => !call.query.includes("mutation")));
      }),
  );

  it.effect(
    "a review is made and submitted at once where the member holds no pending review, on their own token, and GitHub's refusal of it is answered in its words",
    () =>
      Effect.gen(function* () {
        const { other, agent, calls, ask } = yield* published({
          otherToken: "ghu_teammate",
          answer: reviewsAnswering([], (call) =>
            call.variables.event === "APPROVE"
              ? Response.json({
                  data: null,
                  errors: [{ message: "Review Can not approve your own pull request" }],
                })
              : Response.json({ data: {} }),
          ),
        });

        const commented = yield* ask(
          reviewAs(other, agent.id, { event: "comment", body: "Looks close; one question." }),
        );
        const approved = yield* ask(reviewAs(other, agent.id, { event: "approve", body: "" }));

        assert.deepEqual(commented, { status: HOSTED_HTTP_STATUS.OK, body: { outcome: "done" } });
        assert.deepEqual(approved, {
          status: HOSTED_HTTP_STATUS.OK,
          body: { outcome: "refused", words: "Review Can not approve your own pull request" },
        });
        assert.deepEqual(reviewMutations(calls), [
          [
            "add",
            {
              id: PULL_REQUEST_NODE_ID,
              event: "COMMENT",
              body: "Looks close; one question.",
            },
          ],
          ["add", { id: PULL_REQUEST_NODE_ID, event: "APPROVE" }],
        ]);
        assert.ok(calls.every((call) => call.authorization === "Bearer ghu_teammate"));
      }),
  );

  it.effect(
    "the member's own pending review is the one submitted, keeping its words where the press sends none, and nobody else's is touched",
    () =>
      Effect.gen(function* () {
        const { other, agent, calls, ask } = yield* published({
          answer: reviewsAnswering([
            { id: "PRR_someone_else", viewerDidAuthor: false },
            { id: "PRR_member_pending", viewerDidAuthor: true },
          ]),
        });

        const changes = yield* ask(
          reviewAs(other, agent.id, { event: "request-changes", body: "Please split this." }),
        );
        const kept = yield* ask(reviewAs(other, agent.id, { event: "comment", body: "  " }));

        assert.deepEqual(changes, { status: HOSTED_HTTP_STATUS.OK, body: { outcome: "done" } });
        assert.deepEqual(kept, { status: HOSTED_HTTP_STATUS.OK, body: { outcome: "done" } });
        assert.deepEqual(reviewMutations(calls), [
          [
            "submit",
            { id: "PRR_member_pending", event: "REQUEST_CHANGES", body: "Please split this." },
          ],
          ["submit", { id: "PRR_member_pending", event: "COMMENT" }],
        ]);
      }),
  );

  it.effect(
    "a review naming no event GitHub knows, or longer than GitHub takes, never reaches GitHub",
    () =>
      Effect.gen(function* () {
        const { owner, agent, calls, ask } = yield* published({ answer: reviewsAnswering([]) });

        const unnamed = yield* ask(
          request(AGENT_PULL_REQUEST_ACTION, owner, {
            method: "POST",
            id: agent.id,
            body: { action: "submit-review", event: "dismiss", body: "" },
          }),
        );
        const long = yield* ask(
          reviewAs(owner, agent.id, {
            event: "comment",
            body: "x".repeat(PULL_REQUEST_WRITE_BOUNDS.MAX_BODY_CHARS + 1),
          }),
        );

        for (const answered of [unnamed, long]) {
          assert.deepEqual(
            answered,
            refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST),
          );
        }
        assert.deepEqual(calls, []);
      }),
  );

  it.effect(
    "a member replies on a review thread of the pull request, resolves it, and opens it again, each on their own token",
    () =>
      Effect.gen(function* () {
        const { other, agent, calls, ask } = yield* published({
          otherToken: "ghu_teammate",
          answer: threadsAnswering(PULL_REQUEST_NODE_ID),
        });

        const answers = [
          yield* ask(
            threadActionAs(other, agent.id, {
              action: "reply-to-thread",
              threadId: "PRRT_flag",
              body: "Renamed in the next push.",
            }),
          ),
          yield* ask(
            threadActionAs(other, agent.id, { action: "resolve-thread", threadId: "PRRT_flag" }),
          ),
          yield* ask(
            threadActionAs(other, agent.id, { action: "unresolve-thread", threadId: "PRRT_flag" }),
          ),
        ];

        for (const answered of answers) {
          assert.deepEqual(answered, { status: HOSTED_HTTP_STATUS.OK, body: { outcome: "done" } });
        }
        assert.deepEqual(
          calls
            .filter((call) => call.query.includes("mutation"))
            .map((call) => [mutationName(call.query), call.variables]),
          [
            [
              "addPullRequestReviewThreadReply",
              { id: "PRRT_flag", body: "Renamed in the next push." },
            ],
            ["resolveReviewThread", { id: "PRRT_flag" }],
            ["unresolveReviewThread", { id: "PRRT_flag" }],
          ],
        );
        assert.ok(calls.every((call) => call.authorization === "Bearer ghu_teammate"));
      }),
  );

  it.effect(
    "a thread of another pull request is refused in words saying so and never changed, and a blank reply never reaches GitHub",
    () =>
      Effect.gen(function* () {
        const { other, agent, calls, ask } = yield* published({
          answer: threadsAnswering("PR_kwDOsomeOtherPull"),
        });

        const elsewhere = yield* ask(
          threadActionAs(other, agent.id, { action: "resolve-thread", threadId: "PRRT_elsewhere" }),
        );
        const blank = yield* ask(
          threadActionAs(other, agent.id, {
            action: "reply-to-thread",
            threadId: "PRRT_flag",
            body: " \n ",
          }),
        );

        assert.deepEqual(elsewhere, {
          status: HOSTED_HTTP_STATUS.OK,
          body: {
            outcome: "refused",
            words: "Could not resolve to a review thread on this pull request.",
          },
        });
        assert.deepEqual(
          blank,
          refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST),
        );
        assert.ok(calls.every((call) => !call.query.includes("mutation")));
      }),
  );

  it.effect(
    "a member comments on the pull request itself on their own token, and a blank comment never reaches GitHub",
    () =>
      Effect.gen(function* () {
        const { other, agent, calls, ask } = yield* published({ otherToken: "ghu_teammate" });

        const commented = yield* ask(
          threadActionAs(other, agent.id, { action: "comment", body: "Shipping after lunch." }),
        );
        const blank = yield* ask(
          threadActionAs(other, agent.id, { action: "comment", body: "\n" }),
        );

        assert.deepEqual(commented, { status: HOSTED_HTTP_STATUS.OK, body: { outcome: "done" } });
        assert.deepEqual(
          blank,
          refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST),
        );
        assert.deepEqual(
          calls
            .filter((call) => call.query.includes("mutation"))
            .map((call) => [mutationName(call.query), call.variables]),
          [["addComment", { id: PULL_REQUEST_NODE_ID, body: "Shipping after lunch." }]],
        );
        assert.ok(calls.every((call) => call.authorization === "Bearer ghu_teammate"));
      }),
  );

  it.effect(
    "two members reading the same conversation are each told which reactions are their own, each read on their own GitHub token, and the answer is never kept for anyone else",
    () =>
      Effect.gen(function* () {
        const { owner, other, agent, ask, fetch } = yield* published({
          otherToken: "ghu_teammate",
          answer: (call) =>
            Response.json({
              data: {
                repository: {
                  pullRequest: call.query.includes("viewerHasReacted")
                    ? {
                        id: PULL_REQUEST_NODE_ID,
                        reactionGroups: [
                          {
                            content: "HEART",
                            viewerHasReacted: call.authorization === "Bearer ghu_standing",
                          },
                        ],
                      }
                    : {
                        id: PULL_REQUEST_NODE_ID,
                        reactionGroups: [
                          { content: "HEART", reactors: { totalCount: 1, nodes: [] } },
                        ],
                        reviewThreads: { totalCount: 0, nodes: [] },
                      },
                },
              },
            }),
        });
        const readAs = (bearer: string) =>
          Effect.map(
            ask(request(AGENT_OVERVIEW[2], bearer, { id: agent.id })),
            (answered) =>
              readAnswer(
                codingAgentOverviewConversationAnswerSchema,
                HOSTED_HTTP_STATUS.OK,
                answered,
              ).pullRequest?.descriptionReactions,
          );

        assert.deepEqual(yield* readAs(owner), [
          { content: REACTION.HEART, count: 1, by: [], mine: true },
        ]);
        assert.deepEqual(yield* readAs(other), [
          { content: REACTION.HEART, count: 1, by: [], mine: false },
        ]);
        const response = yield* fetch(request(AGENT_OVERVIEW[2], other, { id: agent.id }));
        assert.equal(response.headers.get("cache-control"), "private, no-store");
      }),
  );

  it.effect(
    "a teammate gives a reaction and takes it back on their own GitHub token, once what it names is held to the agent's pull request; one on anything else is refused and nothing is changed",
    () =>
      Effect.gen(function* () {
        const { other, agent, calls, ask } = yield* published({
          otherToken: "ghu_teammate",
          answer: (call) =>
            Response.json({
              data: call.query.includes("mutation")
                ? {}
                : call.query.includes("repository(")
                  ? { repository: { pullRequest: { id: PULL_REQUEST_NODE_ID } } }
                  : {
                      node: {
                        issue: {
                          id: call.variables.id === "IC_1" ? PULL_REQUEST_NODE_ID : "PR_elsewhere",
                        },
                      },
                    },
            }),
        });
        const react = (action: string, subject: string) =>
          ask(
            request(AGENT_PULL_REQUEST_ACTION, other, {
              method: "POST",
              id: agent.id,
              body: { action, subject, content: REACTION.HEART },
            }),
          );

        const done = { status: HOSTED_HTTP_STATUS.OK, body: { outcome: "done" } };
        assert.deepEqual(yield* react("add-reaction", "IC_1"), done);
        assert.deepEqual(yield* react("remove-reaction", "IC_1"), done);
        assert.deepEqual(yield* react("add-reaction", "IC_ELSEWHERE"), {
          status: HOSTED_HTTP_STATUS.OK,
          body: {
            outcome: "refused",
            words: "Could not resolve to a comment on this pull request.",
          },
        });

        assert.ok(calls.every((call) => call.authorization === "Bearer ghu_teammate"));
        assert.deepEqual(
          calls
            .filter((call) => call.query.includes("mutation"))
            .map((call) => [
              call.query.includes("addReaction") ? "add" : "remove",
              call.variables.id,
              call.variables.content,
            ]),
          [
            ["add", "IC_1", "HEART"],
            ["remove", "IC_1", "HEART"],
          ],
        );
      }),
  );

  it.effect(
    "a single line comment is published at once as a review of its own, on the member's token, at the head their diff was read at",
    () =>
      Effect.gen(function* () {
        const { other, agent, calls, ask } = yield* published({
          otherToken: "ghu_teammate",
          answer: linesAnswering([]),
        });

        const answered = yield* ask(
          lineCommentAs(other, agent.id, { mode: "single", startLine: 10, startSide: "right" }),
        );

        assert.deepEqual(answered, { status: HOSTED_HTTP_STATUS.OK, body: { outcome: "done" } });
        const mutations = calls.filter((call) => call.query.includes("mutation"));
        assert.deepEqual(
          mutations.map((call) => [mutationName(call.query), call.variables]),
          [
            [
              "addPullRequestReview",
              {
                id: PULL_REQUEST_NODE_ID,
                commit: LINE_HEAD,
                path: "src/invite.ts",
                body: "Rename this.",
                line: 12,
                side: "RIGHT",
                startLine: 10,
                startSide: "RIGHT",
              },
            ],
          ],
        );
        assert.match(mutations[0]?.query ?? "", /event: COMMENT, threads: \[/u);
        assert.ok(calls.every((call) => call.authorization === "Bearer ghu_teammate"));
      }),
  );

  it.effect(
    "a comment for a review starts the member's pending review on the head their diff was read at where they hold none, and joins the one they hold otherwise, nobody else's",
    () =>
      Effect.gen(function* () {
        const fresh = yield* published({ answer: linesAnswering([]) });
        const started = yield* fresh.ask(
          lineCommentAs(fresh.other, fresh.agent.id, { mode: "review", side: "left" }),
        );
        const holding = yield* published({
          answer: linesAnswering([
            { id: "PRR_someone_else", viewerDidAuthor: false },
            { id: "PRR_member_pending", viewerDidAuthor: true, commit: { oid: LINE_HEAD } },
          ]),
        });
        const joined = yield* holding.ask(
          lineCommentAs(holding.other, holding.agent.id, { mode: "review" }),
        );

        for (const answered of [started, joined]) {
          assert.deepEqual(answered, { status: HOSTED_HTTP_STATUS.OK, body: { outcome: "done" } });
        }
        const mutations = (calls: readonly GraphqlCall[]) =>
          calls
            .filter((call) => call.query.includes("mutation"))
            .map((call) => [mutationName(call.query), call.variables]);
        assert.deepEqual(mutations(fresh.calls), [
          [
            "addPullRequestReview",
            {
              id: PULL_REQUEST_NODE_ID,
              commit: LINE_HEAD,
              path: "src/invite.ts",
              body: "Rename this.",
              line: 12,
              side: "LEFT",
            },
          ],
        ]);
        assert.doesNotMatch(
          fresh.calls.find((call) => call.query.includes("mutation"))?.query ?? "",
          /event:/u,
          "the review is started pending, its first thread with it",
        );
        assert.deepEqual(mutations(holding.calls), [
          [
            "addPullRequestReviewThread",
            {
              review: "PRR_member_pending",
              path: "src/invite.ts",
              body: "Rename this.",
              line: 12,
              side: "RIGHT",
            },
          ],
        ]);
      }),
  );

  it.effect(
    "a comment for a review held pending on another commit is refused in words saying so, its lines never sent to that review",
    () =>
      Effect.gen(function* () {
        const { other, agent, calls, ask } = yield* published({
          answer: linesAnswering([
            {
              id: "PRR_member_pending",
              viewerDidAuthor: true,
              commit: { oid: "0ld0ld0ld0ld0ld0ld0ld0ld0ld0ld0ld0ld0ld0" },
            },
          ]),
        });

        const answered = yield* ask(lineCommentAs(other, agent.id, { mode: "review" }));

        assert.deepEqual(answered, {
          status: HOSTED_HTTP_STATUS.OK,
          body: {
            outcome: "refused",
            words:
              "Your pending review was started on another commit. Submit or discard it, then refresh changes to comment on these lines.",
          },
        });
        assert.ok(calls.every((call) => !call.query.includes("mutation")));
      }),
  );

  it.effect(
    "Discard throws away the member's own pending review and nobody else's, and is refused in words where they hold none",
    () =>
      Effect.gen(function* () {
        const holding = yield* published({
          answer: linesAnswering([
            { id: "PRR_someone_else", viewerDidAuthor: false },
            { id: "PRR_member_pending", viewerDidAuthor: true },
          ]),
        });
        const empty = yield* published({
          answer: linesAnswering([{ id: "PRR_someone_else", viewerDidAuthor: false }]),
        });

        const discarded = yield* holding.ask(
          actionAs(holding.other, holding.agent.id, "discard-review"),
        );
        const refused = yield* empty.ask(actionAs(empty.other, empty.agent.id, "discard-review"));

        assert.deepEqual(discarded, { status: HOSTED_HTTP_STATUS.OK, body: { outcome: "done" } });
        assert.deepEqual(
          holding.calls
            .filter((call) => call.query.includes("mutation"))
            .map((call) => [mutationName(call.query), call.variables]),
          [["deletePullRequestReview", { id: "PRR_member_pending" }]],
        );
        assert.deepEqual(refused, {
          status: HOSTED_HTTP_STATUS.OK,
          body: { outcome: "refused", words: "You have no pending review on this pull request." },
        });
        assert.ok(empty.calls.every((call) => !call.query.includes("mutation")));
      }),
  );

  it.effect(
    "a line comment on no line, on a side GitHub does not name, or at a head that is no commit, never reaches GitHub",
    () =>
      Effect.gen(function* () {
        const { owner, agent, calls, ask } = yield* published({ answer: linesAnswering([]) });

        const answers = [
          yield* ask(lineCommentAs(owner, agent.id, { mode: "single", line: 0 })),
          yield* ask(lineCommentAs(owner, agent.id, { mode: "single", side: "middle" })),
          yield* ask(lineCommentAs(owner, agent.id, { mode: "review", headSha: "main" })),
          yield* ask(lineCommentAs(owner, agent.id, { mode: "later" })),
        ];

        for (const answered of answers) {
          assert.deepEqual(
            answered,
            refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST),
          );
        }
        assert.deepEqual(calls, []);
      }),
  );

  it.effect(
    "each member reads the review they hold pending beside the conversation, on their own token, and one with no sign-in or whom GitHub would not answer reads none",
    () =>
      Effect.gen(function* () {
        const pendingAnswer = (call: GraphqlCall) => {
          if (!call.query.includes("ViewerPendingReview")) return Response.json({ data: null });
          if (call.authorization === "Bearer ghu_broken") {
            return Response.json({ message: "Server Error" }, { status: 502 });
          }
          const nodes =
            call.authorization === "Bearer ghu_teammate"
              ? [{ viewerDidAuthor: true, comments: { totalCount: 2 } }]
              : [];
          return Response.json({ data: { repository: { pullRequest: { reviews: { nodes } } } } });
        };
        const pendingOf = (
          opened: { readonly ask: (request: Request) => Effect.Effect<Answer> },
          bearer: string,
          agentId: string,
        ) =>
          Effect.map(
            opened.ask(request(AGENT_OVERVIEW[2], bearer, { id: agentId })),
            (answered) =>
              readAnswer(
                codingAgentOverviewConversationAnswerSchema,
                HOSTED_HTTP_STATUS.OK,
                answered,
              ).pullRequest?.pendingReview,
          );
        const two = yield* published({ otherToken: "ghu_teammate", answer: pendingAnswer });
        const unsigned = yield* published({ otherToken: null, answer: pendingAnswer });
        const broken = yield* published({ otherToken: "ghu_broken", answer: pendingAnswer });

        assert.deepEqual(yield* pendingOf(two, two.other, two.agent.id), { comments: 2 });
        assert.equal(yield* pendingOf(two, two.owner, two.agent.id), null);
        assert.equal(yield* pendingOf(unsigned, unsigned.other, unsigned.agent.id), null);
        assert.equal(yield* pendingOf(broken, broken.other, broken.agent.id), null);
        assert.deepEqual(
          two.calls
            .filter((call) => call.query.includes("ViewerPendingReview"))
            .map((call) => call.authorization),
          ["Bearer ghu_teammate", "Bearer ghu_standing"],
        );
        assert.ok(unsigned.calls.every((call) => !call.query.includes("ViewerPendingReview")));
      }),
  );

  it.effect(
    "the changes name the head their files were read at, which a line comment is anchored to",
    () =>
      Effect.gen(function* () {
        const headed = publishedPullRequestDrafted(() => false, LINE_HEAD);
        const { owner, agent, ask } = yield* published({ repository: headed });

        const changes = readAnswer(
          codingAgentChangesAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(AGENT_CHANGES, owner, { id: agent.id })),
        );

        assert.equal(changes.pullRequest?.headSha, LINE_HEAD);
      }),
  );

  it.effect(
    "a teammate reads which files they viewed on GitHub, every page of them, and marks and unmarks one, each on their own GitHub token",
    () =>
      Effect.gen(function* () {
        const { other, agent, calls, ask } = yield* published({
          otherToken: "ghu_teammate",
          answer: viewedAnswering,
        });

        const viewed = yield* ask(request(AGENT_PULL_REQUEST_VIEWED, other, { id: agent.id }));
        const marked = yield* ask(
          threadActionAs(other, agent.id, { action: "mark-file-viewed", path: "README.md" }),
        );
        const unmarked = yield* ask(
          threadActionAs(other, agent.id, { action: "unmark-file-viewed", path: "src/seats.ts" }),
        );

        assert.deepEqual(viewed, {
          status: HOSTED_HTTP_STATUS.OK,
          body: {
            outcome: "done",
            files: [
              { path: "src/seats.ts", state: "viewed" },
              { path: "src/plan.ts", state: "dismissed" },
              { path: "README.md", state: "unviewed" },
            ],
          },
        });
        assert.deepEqual(marked, { status: HOSTED_HTTP_STATUS.OK, body: { outcome: "done" } });
        assert.deepEqual(unmarked, { status: HOSTED_HTTP_STATUS.OK, body: { outcome: "done" } });
        assert.deepEqual(
          calls
            .filter((call) => call.query.includes("viewerViewedState"))
            .map((call) => call.variables.after),
          [null, "cursor-2"],
        );
        assert.deepEqual(
          calls
            .filter((call) => call.query.includes("mutation"))
            .map((call) => [
              call.query.includes("unmarkFileAsViewed") ? "unmark" : "mark",
              call.variables,
            ]),
          [
            ["mark", { id: PULL_REQUEST_NODE_ID, path: "README.md" }],
            ["unmark", { id: PULL_REQUEST_NODE_ID, path: "src/seats.ts" }],
          ],
        );
        assert.ok(calls.every((call) => call.authorization === "Bearer ghu_teammate"));
      }),
  );

  it.effect(
    "a member with no GitHub sign-in, or one GitHub refuses, is asked to sign in before any viewed mark is read, never on the App's token",
    () =>
      Effect.gen(function* () {
        const unsigned = yield* published({ otherToken: null });
        assert.deepEqual(
          yield* unsigned.ask(
            request(AGENT_PULL_REQUEST_VIEWED, unsigned.other, { id: unsigned.agent.id }),
          ),
          { status: HOSTED_HTTP_STATUS.OK, body: { outcome: "sign-in-required" } },
        );
        assert.deepEqual(unsigned.calls, []);

        const revoked = yield* published({
          otherToken: "ghu_revoked",
          answer: () => Response.json({ message: "Bad credentials" }, { status: 401 }),
        });
        assert.deepEqual(
          yield* revoked.ask(
            request(AGENT_PULL_REQUEST_VIEWED, revoked.other, { id: revoked.agent.id }),
          ),
          { status: HOSTED_HTTP_STATUS.OK, body: { outcome: "sign-in-required" } },
        );
        assert.ok(revoked.calls.every((call) => call.authorization === "Bearer ghu_revoked"));
      }),
  );

  it.effect(
    "an account outside the agent's workspace is answered as if the agent were none, and a change the wire does not name is refused, neither reaching GitHub",
    () =>
      Effect.gen(function* () {
        const { owner, other, agent, calls, ask } = yield* published({ otherJoins: false });

        assert.deepEqual(
          yield* ask(actionAs(other, agent.id, "ready-for-review")),
          refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND),
        );
        assert.deepEqual(
          yield* ask(actionAs(owner, agent.id, "merge-it-all")),
          refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST),
        );
        assert.deepEqual(calls, []);
      }),
  );
});

/** One REST write as GitHub saw it: the bearer, the method, the path, and the body. */
interface RestWrite {
  readonly authorization: string | null;
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
}

/** The published pull request's repository, writing down every write to its requested reviewers or labels and answering it as `answer` says. */
function peopleAndLabelsAnswering(
  writes: RestWrite[],
  answer: (write: RestWrite) => Response = () => Response.json({}, { status: 201 }),
): RepositoryScript {
  return (sent) => {
    const path = decodeURIComponent(new URL(sent.url).pathname);
    const reviewersOrLabels = /\/(requested_reviewers|labels)(\/|$)/u.test(path);
    if (!reviewersOrLabels || sent.method === "GET") return publishedPullRequest(sent);
    const write = {
      authorization: sent.headers.get("authorization"),
      method: sent.method,
      path,
      body: sent.body === "" ? undefined : JSON.parse(sent.body),
    };
    writes.push(write);
    return answer(write);
  };
}

/** A change naming a reviewer or a label, as the bearer given. */
function changeAs(bearer: string, agentId: string, body: WireBoundaryInput): Request {
  return request(AGENT_PULL_REQUEST_ACTION, bearer, { method: "POST", id: agentId, body });
}

it.layer(getTestDB())("asking reviews and labelling an agent's pull request", (it) => {
  const published = (repository: RepositoryScript, otherToken = "ghu_teammate") =>
    Effect.gen(function* () {
      const opened = yield* openTask({ github: repository, otherToken });
      yield* joinWorkspace(opened.task.workspaceId, opened.other);
      const { agent } = yield* startedAgent(opened.owner, opened.task.id, opened.ask);
      yield* updateCodingAgentBranch(opened.owner, agent.id, PUBLISHED.branch);
      return { ...opened, agent };
    });

  it.effect(
    "a teammate asks a review of a team, asks one of a user no longer, puts a label on and takes one off, each a REST write on the teammate's own token",
    () =>
      Effect.gen(function* () {
        const writes: RestWrite[] = [];
        const { other, agent, ask } = yield* published(peopleAndLabelsAnswering(writes));
        const pull = `/repos/${RELAY.owner}/${RELAY.name}/pulls/${PUBLISHED.number}`;
        const issue = `/repos/${RELAY.owner}/${RELAY.name}/issues/${PUBLISHED.number}`;

        const answers = [
          yield* ask(
            changeAs(other, agent.id, {
              action: "request-review",
              reviewer: { kind: "team", name: "reviewers" },
            }),
          ),
          yield* ask(
            changeAs(other, agent.id, {
              action: "remove-review-request",
              reviewer: { kind: "user", name: "priyan" },
            }),
          ),
          yield* ask(changeAs(other, agent.id, { action: "add-label", label: "bug" })),
          yield* ask(changeAs(other, agent.id, { action: "remove-label", label: "needs review" })),
        ];

        assert.ok(
          answers.every((answered) => answered.status === HOSTED_HTTP_STATUS.OK),
          "every change is answered",
        );
        assert.deepEqual(
          answers.map((answered) => answered.body),
          answers.map(() => ({ outcome: "done" })),
        );
        assert.deepEqual(
          writes.map(({ method, path, body }) => ({ method, path, body })),
          [
            {
              method: "POST",
              path: `${pull}/requested_reviewers`,
              body: { team_reviewers: ["reviewers"] },
            },
            {
              method: "DELETE",
              path: `${pull}/requested_reviewers`,
              body: { reviewers: ["priyan"] },
            },
            { method: "POST", path: `${issue}/labels`, body: { labels: ["bug"] } },
            { method: "DELETE", path: `${issue}/labels/needs review`, body: undefined },
          ],
        );
        assert.ok(writes.every((write) => write.authorization === "Bearer ghu_teammate"));
      }),
  );

  it.effect(
    "a review GitHub will not ask is answered in its words, and a reviewer the wire does not name is refused before GitHub",
    () =>
      Effect.gen(function* () {
        const writes: RestWrite[] = [];
        const { other, agent, ask } = yield* published(
          peopleAndLabelsAnswering(writes, () =>
            Response.json(
              { message: "Reviews may only be requested from collaborators." },
              { status: 422 },
            ),
          ),
        );

        assert.deepEqual(
          yield* ask(
            changeAs(other, agent.id, {
              action: "request-review",
              reviewer: { kind: "user", name: "stranger" },
            }),
          ),
          {
            status: HOSTED_HTTP_STATUS.OK,
            body: {
              outcome: "refused",
              words: "Reviews may only be requested from collaborators.",
            },
          },
        );
        assert.deepEqual(
          yield* ask(
            changeAs(other, agent.id, {
              action: "request-review",
              reviewer: { kind: "everyone", name: "all" },
            }),
          ),
          refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST),
        );
        assert.equal(writes.length, 1);
      }),
  );
});

const AGENT_REVIEW_OPTIONS = "/api/agents/review-options";

it.layer(getTestDB())("what the reviewer and label pickers offer", (it) => {
  it.effect(
    "the repository's labels, collaborators named against the workspace, and teams, read on the App's token; teams it may not read list none",
    () =>
      Effect.gen(function* () {
        const repository = `/repos/${RELAY.owner}/${RELAY.name}`;
        const asked: SentToGitHub[] = [];
        const { owner, task, ask } = yield* openTask({
          github: (sent) => {
            const path = new URL(sent.url).pathname;
            if (path.startsWith(repository)) asked.push(sent);
            switch (path) {
              case `${repository}/labels`:
                return Response.json([{ name: "bug", color: "d73a4a" }]);
              case `${repository}/collaborators`:
                return Response.json([
                  {
                    login: "priyan",
                    id: 1002,
                    type: "User",
                    avatar_url: "https://avatars.githubusercontent.com/u/1002?v=4",
                  },
                ]);
              case `${repository}/teams`:
                return Response.json(
                  { message: "Resource not accessible by integration" },
                  { status: 403 },
                );
              default:
                return publishedPullRequest(sent);
            }
          },
        });
        const { agent } = yield* startedAgent(owner, task.id, ask);

        const answered = yield* ask(request(AGENT_REVIEW_OPTIONS, owner, { id: agent.id }));

        assert.deepEqual(answered, {
          status: HOSTED_HTTP_STATUS.OK,
          body: {
            labels: [{ name: "bug", color: "d73a4a" }],
            users: [
              {
                login: "priyan",
                bot: false,
                avatarUrl: "https://avatars.githubusercontent.com/u/1002?v=4",
              },
            ],
            teams: [],
          },
        });
        assert.ok(
          asked.every((sent) => !sent.headers.get("authorization")?.includes("ghu_")),
          "the repository is read on an installation token, never a member's",
        );
      }),
  );

  it.effect(
    "a listing GitHub did not answer fails the read rather than offering an empty list, so the picker reads it again",
    () =>
      Effect.gen(function* () {
        const repository = `/repos/${RELAY.owner}/${RELAY.name}`;
        const { owner, task, ask } = yield* openTask({
          github: (sent) =>
            new URL(sent.url).pathname === `${repository}/labels`
              ? Response.json({ message: "Service unavailable" }, { status: 503 })
              : new URL(sent.url).pathname.startsWith(`${repository}/`) &&
                  !new URL(sent.url).pathname.startsWith(`${repository}/pulls`)
                ? Response.json([])
                : publishedPullRequest(sent),
        });
        const { agent } = yield* startedAgent(owner, task.id, ask);

        const answered = yield* ask(request(AGENT_REVIEW_OPTIONS, owner, { id: agent.id }));

        assert.notEqual(answered.status, HOSTED_HTTP_STATUS.OK);
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

it.layer(getTestDB())("an agent's kept pull request", (it) => {
  /** One file as GitHub lists a pull request's files. */
  const githubFile = (filename: string, additions: number, deletions: number) => ({
    filename,
    status: "modified",
    additions,
    deletions,
    changes: additions + deletions,
    patch: "@@ -1 +1 @@",
  });

  /** Where the published pull request stands on GitHub as a test moves it: its head, the lines it adds against its base, the files its files read lists, and when it merged, none while open. */
  interface Standing {
    sha: string;
    additions: number;
    files: readonly ReturnType<typeof githubFile>[];
    mergedAt: string | null;
    /** Whether GitHub's read of the files answers unavailable; it answers them unless a test says so. */
    filesDown?: boolean;
  }

  const MERGED_AT = "2026-10-17T09:00:00Z";

  /** The repository answering the published pull request as `standing` holds it. */
  const standingPullRequest =
    (standing: Standing): RepositoryScript =>
    async (sent) => {
      const pull = `/repos/${RELAY.owner}/${RELAY.name}/pulls/${PUBLISHED.number}`;
      const { pathname } = new URL(sent.url);
      if (pathname === `${pull}/files`) {
        return standing.filesDown === true
          ? Response.json({ message: "Service Unavailable" }, { status: 503 })
          : Response.json(standing.files);
      }
      const answered = await publishedPullRequest(sent);
      if (answered === undefined || pathname !== pull) return answered;
      const merged = standing.mergedAt !== null;
      return Response.json({
        ...(await answered.json()),
        ...(merged ? { state: "closed" } : undefined),
        merged,
        merged_at: standing.mergedAt,
        additions: standing.additions,
        head: { ref: PUBLISHED.branch, sha: standing.sha },
      });
    };

  /** The owner's agent on the published branch, its pull request answered as `standing` holds it, and a read of it a kept answer's TTL after the last. */
  const publishedAs = (standing: Standing) =>
    Effect.gen(function* () {
      const { owner, task, ask } = yield* openTask({ github: standingPullRequest(standing) });
      const { agent } = yield* startedAgent(owner, task.id, ask);
      yield* updateCodingAgentBranch(owner, agent.id, PUBLISHED.branch);
      const read = Effect.gen(function* () {
        yield* TestClock.adjust(CODER.PUBLISHED_TTL);
        const answered = yield* ask(request(AGENT_PULL_REQUEST, owner, { id: agent.id }));
        assert.equal(answered.status, HOSTED_HTTP_STATUS.OK, JSON.stringify(answered.body));
        return answered.body;
      });
      const kept = readCodingAgentPublished(owner, agent.id);
      return { read, kept };
    });

  it.effect(
    "a merged pull request is kept with the instant GitHub says it merged and its lines by directory, while the tab's answer carries what it always did",
    () =>
      Effect.gen(function* () {
        const { read, kept } = yield* publishedAs({
          sha: PUBLISHED.headSha,
          additions: 4,
          files: [
            githubFile("packages/service/src/agents/coder-host/published.ts", 4, 1),
            githubFile("README.md", 1, 0),
          ],
          mergedAt: MERGED_AT,
        });

        const answered = yield* read;

        const stored = yield* kept;
        assert.equal(stored?.state, PULL_REQUEST_STATE.MERGED);
        assert.equal(stored?.mergedAt, Date.parse(MERGED_AT));
        assert.deepEqual(stored?.areas, [
          { path: "packages/service/src/agents", additions: 4, deletions: 1 },
          { path: ".", additions: 1, deletions: 0 },
        ]);
        assert.deepEqual(answered, {
          repository: RELAY_FULL_NAME,
          branch: PUBLISHED.branch,
          pullRequest: {
            number: PUBLISHED.number,
            title: "Expire teammate invitations",
            url: `https://github.com/${RELAY_FULL_NAME}/pull/${PUBLISHED.number}`,
            state: PULL_REQUEST_STATE.MERGED,
            checks: CHECK_SUMMARY.NONE,
            additions: 4,
            deletions: 1,
            changedFiles: 1,
          },
        });
      }),
  );

  it.effect(
    "a pull request whose files GitHub cannot list now is still answered and kept, with no areas until a later read lists them",
    () =>
      Effect.gen(function* () {
        const standing: Standing = {
          sha: PUBLISHED.headSha,
          additions: 2,
          files: [githubFile("apps/web/vite.config.ts", 2, 0)],
          mergedAt: MERGED_AT,
          filesDown: true,
        };
        const { read, kept } = yield* publishedAs(standing);

        const answered = yield* read;

        assert.equal(
          readAnswer(codingAgentPullRequestAnswerSchema, HOSTED_HTTP_STATUS.OK, {
            status: HOSTED_HTTP_STATUS.OK,
            body: answered,
          }).pullRequest?.state,
          PULL_REQUEST_STATE.MERGED,
        );
        const stored = yield* kept;
        assert.equal(stored?.mergedAt, Date.parse(MERGED_AT));
        assert.equal(stored?.areas, undefined);

        standing.filesDown = false;
        yield* read;
        assert.deepEqual((yield* kept)?.areas, [{ path: "apps/web", additions: 2, deletions: 0 }]);
      }),
  );

  it.effect(
    "a pull request's areas follow its files once its head, its size, or where it stands moved, and a read that moved none of them keeps the areas it had",
    () =>
      Effect.gen(function* () {
        const standing: Standing = {
          sha: PUBLISHED.headSha,
          additions: 2,
          files: [githubFile("apps/web/vite.config.ts", 2, 0)],
          mergedAt: null,
        };
        const { read, kept } = yield* publishedAs(standing);
        const areas = Effect.map(kept, (stored) => stored?.areas);
        const file = (path: string) => [githubFile(path, 2, 0)];

        yield* read;
        assert.deepEqual(yield* areas, [{ path: "apps/web", additions: 2, deletions: 0 }]);
        assert.equal((yield* kept)?.mergedAt, undefined);

        // A check's delivery moves nothing the pull request's read says, so its files are not read.
        standing.files = file("docs/unread.md");
        yield* read;
        assert.deepEqual(yield* areas, [{ path: "apps/web", additions: 2, deletions: 0 }]);

        standing.sha = "beef002";
        standing.files = file("apps/desktop/src/main.ts");
        yield* read;
        assert.deepEqual(yield* areas, [{ path: "apps/desktop/src", additions: 2, deletions: 0 }]);

        // The base moved under the same head, which GitHub's count of its lines says.
        standing.additions = 3;
        standing.files = file("packages/ui/src/a.ts");
        yield* read;
        assert.deepEqual(yield* areas, [{ path: "packages/ui/src", additions: 2, deletions: 0 }]);

        standing.mergedAt = MERGED_AT;
        standing.files = file("tools/a.ts");
        yield* read;
        assert.deepEqual(yield* areas, [{ path: "tools", additions: 2, deletions: 0 }]);
        assert.equal((yield* kept)?.mergedAt, Date.parse(MERGED_AT));
      }),
  );
});

it.layer(getTestDB())("messaging a coding agent", (it) => {
  /** An agent started on the owner's task, its session claimed, and its first turn where asked. */
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
    "a member's archive of a plan stops its running agent first and archives it with the plan, a message to it is refused as the plan's, and the plan's unarchive brings it back",
    () =>
      Effect.gen(function* () {
        const { owner, other, task, agent, ask, eve, sessionId } = yield* startedAgent(fakeEve(), {
          running: true,
        });
        yield* joinWorkspace(task.workspaceId, other);
        const marked = (archived: boolean) =>
          Effect.map(
            ask(request(TASK, other, { method: "PATCH", id: task.id, body: { archived } })),
            (answered) => answered.status,
          );
        const archiveNow = () =>
          Effect.map(readCodingAgent(owner, agent.id), (read) => {
            const stored = Option.getOrThrow(read);
            return { archived: stored.archivedAt !== null, by: stored.archivedBy };
          });

        assert.equal(yield* marked(true), HOSTED_HTTP_STATUS.OK);
        assert.deepEqual(eve.cancelled, [[sessionId, "turn_0"]]);
        assert.deepEqual(yield* archiveNow(), {
          archived: true,
          by: { by: CODING_AGENT_ARCHIVER.MEMBER, userId: other, withTask: true },
        });
        assert.deepEqual(
          yield* ask(messageAs(owner, agent.id, { text: "Carry on.", clientKey: randomUUID() })),
          refusal(HOSTED_HTTP_STATUS.CONFLICT, HOSTED_API_ERROR.TASK_ARCHIVED),
        );

        assert.equal(yield* marked(false), HOSTED_HTTP_STATUS.OK);
        assert.deepEqual(yield* archiveNow(), { archived: false, by: null });
      }),
  );

  it.effect(
    "a plan's archive is refused as not ready while one of its agents holds a message awaiting its turn, which no Stop can name yet, before any Stop is sent, and leaves the plan and the agent standing",
    () =>
      Effect.gen(function* () {
        const { owner, task, agent, ask, sent, eve } = yield* startedAgent(fakeEve(), {
          running: true,
        });
        yield* sent("Rename the subject line too.");

        assert.deepEqual(
          yield* ask(
            request(TASK, owner, { method: "PATCH", id: task.id, body: { archived: true } }),
          ),
          refusal(HOSTED_HTTP_STATUS.CONFLICT, HOSTED_API_ERROR.AGENT_NOT_READY),
        );
        assert.equal(Option.getOrThrow(yield* readTask(owner, task.id)).task.archivedAt, undefined);
        assert.equal(Option.getOrThrow(yield* readCodingAgent(owner, agent.id)).archivedAt, null);
        assert.deepEqual(eve.cancelled, []);
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
    "a line no turn ever took reads its agent running for the line's grace and failed past it, alike on its page, in its task's list, and on its transcript",
    () =>
      Effect.gen(function* () {
        const { owner, task, agent, ask, transcript, sent } = yield* startedAgent(fakeEve(), {
          running: false,
        });
        // The session takes the line and then fails with the store's hooks, so no turn row is written for it.
        yield* TestClock.adjust(Duration.seconds(1));
        assert.equal(
          (yield* sent("Rename the subject line too.")).agent.status,
          CODING_AGENT_STATUS.RUNNING,
        );
        const statuses = () =>
          Effect.gen(function* () {
            const page = readAnswer(
              codingAgentPageAnswerSchema,
              HOSTED_HTTP_STATUS.OK,
              yield* ask(request(AGENT, owner, { id: agent.id })),
            );
            const listed = readAnswer(
              codingAgentListAnswerSchema,
              HOSTED_HTTP_STATUS.OK,
              yield* ask(request(TASK_AGENTS, owner, { id: task.id })),
            );
            return {
              page: page.agent.status,
              list: listed.agents.find((each) => each.id === agent.id)?.status,
              transcript: (yield* transcript()).status,
            };
          });

        yield* TestClock.adjust(CODER.LINE_GRACE);
        assert.deepEqual(yield* statuses(), {
          page: CODING_AGENT_STATUS.RUNNING,
          list: CODING_AGENT_STATUS.RUNNING,
          transcript: CODING_AGENT_STATUS.RUNNING,
        });
        yield* TestClock.adjust(Duration.millis(1));
        assert.deepEqual(yield* statuses(), {
          page: CODING_AGENT_STATUS.FAILED,
          list: CODING_AGENT_STATUS.FAILED,
          transcript: CODING_AGENT_STATUS.FAILED,
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
        // An automation's run leaves an agent so: in its workspace, on no task.
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
        const { owner, task, agent, ask } = yield* startedAgent(eve, { running: false });
        const ranAs = (firing: AutomationFiring) =>
          Effect.gen(function* () {
            yield* Database.use((db) =>
              db
                .update(codingAgent)
                .set({
                  taskId: null,
                  organizationId: task.workspaceId,
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
        const { owner, other, task, agent, ask } = yield* startedAgent(eve, { running: false });
        yield* Database.use((db) =>
          db
            .update(codingAgent)
            .set({ taskId: null, organizationId: task.workspaceId })
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
        assert.equal(standing.plans.find((each) => each.id === task.id)?.agents, undefined);
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
        const { owner, other, task, agent, ask } = yield* startedAgent(eve, { running: false });
        yield* Database.use((db) =>
          db
            .update(codingAgent)
            .set({ taskId: null, organizationId: task.workspaceId })
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
    "a member's PATCH drags their pin of an agent with no plan to a position the list then carries, and one given with an unpin is refused",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const { owner, task, agent, ask } = yield* startedAgent(eve, { running: false });
        yield* Database.use((db) =>
          db
            .update(codingAgent)
            .set({ taskId: null, organizationId: task.workspaceId })
            .where(eq(codingAgent.id, agent.id)),
        );
        const patch = (body: { pinned: boolean; position: string }) =>
          ask(request(AGENT, owner, { method: "PATCH", id: agent.id, body }));
        const listed = Effect.map(ask(request(TASKS, owner)), (answered) =>
          readAnswer(taskListAnswerSchema, HOSTED_HTTP_STATUS.OK, answered).planlessAgents?.find(
            (each) => each.id === agent.id,
          ),
        );

        const placed = yield* patch({ pinned: true, position: "a1" });
        const refused = yield* patch({ pinned: false, position: "a2" });
        const held = yield* listed;

        assert.equal(placed.status, HOSTED_HTTP_STATUS.OK);
        assert.equal(refused.status, HOSTED_HTTP_STATUS.BAD_REQUEST);
        assert.equal(held?.pinPosition, "a1");
        assert.notEqual(held?.pinnedAt, undefined);
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
    "each member's line to an agent names them as its sender and when it was sent, by the name their account holds now, a line from before senders were kept names nobody, and a member whose account is gone reads as a former member",
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
        // Charles answers a minute later, which the time each line names says.
        yield* TestClock.adjust(Duration.minutes(1));
        readAnswer(
          codingAgentAnswerSchema,
          HOSTED_HTTP_STATUS.ACCEPTED,
          yield* ask(messageAs(other, agent.id, { text: "Not five.", clientKey: randomUUID() })),
        );
        // Luke's line from a call, an automation's run's, and another coding agent's, written as their sends write them.
        for (const [text, sender] of [
          ["Rebase on main.", { kind: MESSAGE_SENDER.LUKE }],
          ["Triage the failures.", { kind: MESSAGE_SENDER.AUTOMATION, name: "Nightly triage" }],
          [
            "Take the split view.",
            {
              kind: MESSAGE_SENDER.AGENT,
              agentId: agent.id,
              name: "Add PR overview tab",
              model: agent.model,
            },
          ],
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
          // Another agent is marked as one beside its name, its model, and itself on its task, with no kind an older window would refuse.
          [
            "Take the split view.",
            {
              name: "Add PR overview tab",
              agent: true,
              model: agent.model,
              agentId: agent.id,
              taskId: task.id,
            },
          ],
        ];
        assert.deepEqual(yield* sendersAs(owner), named);
        assert.deepEqual(yield* sendersAs(other), named);

        // Every line names when it was sent, a minute apart where they were.
        const sentAts = readAnswer(
          codingAgentMessagesAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(AGENT_MESSAGES, owner, { id: agent.id })),
        )
          .messages.filter((message) => message.role === MESSAGE_ROLE.USER)
          .map((message) => message.sentAt);
        assert.ok(sentAts.every((at) => at !== undefined));
        assert.equal((sentAts[2] ?? 0) - (sentAts[1] ?? 0), Duration.toMillis(Duration.minutes(1)));

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
    "a message mentioning a page and another agent of the plan hands eve the page by its id and version with how to read it, never its HTML, and the agent by its id and branch, never its conversation",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const { owner, task, ask, sent } = yield* startedAgent(eve, { running: true });
        const other = yield* startedAgentOf(owner, task.id, ask);
        yield* updateCodingAgentBranch(owner, other.agent.id, "luke/store-invitations");
        const shown = yield* writePage(
          owner,
          task.id,
          {
            title: "Invites by week",
            html: "<h1>Invites by week</h1>",
          },
          { kind: PAGE_SHOWER.LUKE },
        );
        assert.ok(Option.isSome(shown));
        const place = { workspace: "acme", repository: task.repository };
        const words = `Build what ${mentionMarkdown({ kind: MENTION_KIND.PAGE, taskId: task.id, pageId: shown.value.id }, "Invites by week", place)} shows on ${mentionMarkdown({ kind: MENTION_KIND.AGENT, taskId: task.id, agentId: other.agent.id }, "Store", place)}.`;

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
            `the page "Invites by week" \\(id \`${shown.value.id}\`, version 1\\)[^]*with \`read_page\`, \`pageId: "${shown.value.id}"\`, and \`version: 1\``,
            "u",
          ),
        );
        assert.ok(!part.text.includes("<h1>Invites by week</h1>"), part.text);
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
        const mention = (agentId: string, taskId: string | undefined, name: string) =>
          mentionMarkdown(
            taskId === undefined
              ? { kind: MENTION_KIND.AGENT, agentId }
              : { kind: MENTION_KIND.AGENT, taskId, agentId },
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
    "a message mentioning people hands a member of the agent's workspace by their role, never their email, and someone of another workspace the sender is also in as not a member",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const { owner, other, task, sent } = yield* startedAgent(eve, { running: true });
        // The sender and the other account share a second workspace, which is not the agent's.
        const elsewhere = yield* openWorkspace(other);
        yield* joinWorkspace(elsewhere, owner);
        const place = { workspace: "acme", repository: task.repository };
        const mention = (userId: string, name: string) =>
          mentionMarkdown({ kind: MENTION_KIND.PERSON, userId }, name, place);
        const words = `Ask ${mention(owner, "Me")} and ${mention(other, "Stranger")}.`;

        yield* sent(words);

        const message = eve.sent.at(-1)?.message.message;
        assert.ok(Array.isArray(message));
        const part = message[1];
        assert.ok(part?.type === "text");
        assert.match(
          part.text,
          /The developer pointed you at [^\n]+, an owner of your workspace\./u,
        );
        assert.ok(!part.text.includes("@"), part.text);
        assert.match(part.text, /The person "Stranger": not a member of your workspace\./u);
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

/** An agent started on the task, with its conversation as the writer targets it. */
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

function startAs(bearer: string | undefined, taskId: string, body: WireBoundaryInput): Request {
  return request(TASK_AGENTS, bearer, { method: "POST", id: taskId, body });
}

const TASK_INBOX = "/api/plans/inbox";
const INBOX_ITEM = "/api/inbox/item";
const ACCOUNT_INBOX = "/api/inbox";
const INBOX_ATTACHMENT = "/api/inbox/attachment";
const INBOX_MESSAGES = "/api/inbox/messages";
const INBOX_READ = "/api/inbox/read";

/** The first bytes of a PNG, as a screenshot's file starts. */
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

it.layer(getTestDB())("the developer's inbox", (it) => {
  /** The owner's task with one agent started on it, its session claimed so a message reaches it, and the inbox as each side sees it. */
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
      /** The task's inbox as the owner reads it past the cursor. */
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
      /** A member's message on an item's thread, as the route answers it. */
      const message = (itemId: string, body: WireBoundaryInput, bearer = opened.owner) =>
        opened.ask(request(INBOX_MESSAGES, bearer, { method: "POST", id: itemId, body }));
      /** The agent's transcript as the owner reads it: the developer's lines, and where it stands. */
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
      return {
        ...opened,
        agent,
        target,
        sessionId,
        post,
        read,
        answer,
        waiting,
        message,
        transcript,
      };
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
    "an archived plan's items are put away with it: its open item waits nowhere, the plan is listed among those holding items only where archived=include asks, an answer to the item is refused as archived, and unarchiving brings the item back as it stood",
    () =>
      Effect.gen(function* () {
        const { owner, task, ask, post, answer, waiting } = yield* openInbox();
        const posted = yield* post(QUESTION);
        assert.ok(Result.isSuccess(posted));
        const archivedToo = () =>
          Effect.map(
            ask(request(ACCOUNT_INBOX, owner, { archived: ACCOUNT_INBOX_ARCHIVED.INCLUDE })),
            (answered) => readAnswer(accountInboxAnswerSchema, HOSTED_HTTP_STATUS.OK, answered),
          );
        assert.deepEqual(
          (yield* archivedToo()).plans.map((plan) => plan.planId),
          [task.id],
        );

        yield* updateTask(owner, task.id, { archived: true });
        const standing = yield* waiting();
        assert.deepEqual(standing.items, []);
        assert.deepEqual(standing.plans, []);
        const included = yield* archivedToo();
        assert.deepEqual(included.items, [], "an archived plan's open item still waits on nobody");
        assert.deepEqual(
          included.plans.map((plan) => [plan.planId, plan.items]),
          [[task.id, 1]],
        );
        assert.deepEqual(
          yield* answer(posted.success.id, {
            revision: posted.success.revision,
            clientKey: randomUUID(),
            reply: INBOX_REPLY.ANSWERED,
            note: "Keep it short.",
          }),
          refusal(HOSTED_HTTP_STATUS.CONFLICT, HOSTED_API_ERROR.TASK_ARCHIVED),
        );

        yield* updateTask(owner, task.id, { archived: false });
        assert.deepEqual(
          (yield* waiting()).items.map((item) => [item.id, item.revision]),
          [[posted.success.id, posted.success.revision]],
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
    "an answer carrying a file and no note reaches the agent with the file, even from an item that asks nothing back, and the item names the file it kept",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const { post, answer, read } = yield* openInbox(eve);
        const todo = yield* post({
          key: "flag-file",
          title: "Turn on the agent-mail flag in staging",
          response: { type: INBOX_RESPONSE.TODO },
          needsReply: false,
        });
        assert.ok(Result.isSuccess(todo));
        const before = eve.sent.length;
        const trace = {
          name: "flag-trace.txt",
          mediaType: CODING_AGENT_ATTACHMENT_TYPE.TEXT,
          data: Buffer.from("flag on in staging\n").toString("base64"),
        };

        const sent = yield* answer(todo.success.id, {
          revision: todo.success.revision,
          clientKey: randomUUID(),
          reply: INBOX_REPLY.DONE,
          attachments: [trace],
        });
        assert.equal(sent.status, HOSTED_HTTP_STATUS.OK);
        const handed = JSON.stringify(eve.sent.slice(before).map((each) => each.message.message));
        assert.ok(handed.includes(INBOX_ANSWER_LEAD), "it reads as an Inbox answer");
        assert.ok(handed.includes("flag on in staging"), "it carries the file");
        const kept = (yield* read()).items.find((item) => item.key === "flag-file");
        assert.deepEqual(
          kept?.answerFiles?.map((file) => [file.name, file.mediaType]),
          [[trace.name, trace.mediaType]],
        );
      }),
  );

  it.effect("an answer in the developer's own words may be a file alone", () =>
    Effect.gen(function* () {
      const { post, answer } = yield* openInbox();
      const asked = yield* post(QUESTION);
      assert.ok(Result.isSuccess(asked));
      const shot = {
        name: "invite.png",
        mediaType: CODING_AGENT_ATTACHMENT_TYPE.PNG,
        data: Buffer.from(PNG).toString("base64"),
      };
      const answered = (attachments?: readonly (typeof shot)[]) =>
        answer(asked.success.id, {
          revision: asked.success.revision,
          clientKey: randomUUID(),
          reply: INBOX_REPLY.ANSWERED,
          ...(attachments === undefined ? undefined : { attachments }),
        });

      assert.deepEqual(
        yield* answered(),
        refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST),
      );
      const taken = readAnswer(inboxAnsweredSchema, HOSTED_HTTP_STATUS.OK, yield* answered([shot]));
      assert.equal(taken.taken, true);
      assert.deepEqual(
        taken.item.answerFiles?.map((file) => file.name),
        [shot.name],
      );
    }),
  );

  /** The agent's one turn run to its end, as the relay writes a turn that settled: the agent stopped, and waits on nothing. */
  const turnEnded = (target: { readonly userId: string; readonly conversationId: string }) =>
    Effect.gen(function* () {
      const writer = yield* storeWriter({ tools: CODER_TOOL_SET });
      const turnId = randomUUID();
      const turn = { conversationId: sessionKey(target.conversationId), turnId };
      yield* writer.enqueueTurn(target, { turnId, origin: TURN_ORIGIN.TYPED, eveTurnId: "turn_0" });
      yield* writer.consume(target, {
        ...turn,
        kind: BRAIN_RUN_EVENT.TURN_STARTED,
        sequence: 1,
        origin: BRAIN_TURN_ORIGIN.TYPED,
        trigger: BRAIN_TURN_TRIGGER.ASK,
        at: 0,
      });
      yield* writer.consume(target, {
        ...turn,
        kind: BRAIN_RUN_EVENT.MESSAGE_COMPLETED,
        sequence: 2,
        message: userMessage(
          randomUUID(),
          SNAPSHOT,
          userMetadataOf(BRAIN_TURN_TRIGGER.ASK, undefined),
        ),
      });
      yield* writer.consume(target, {
        ...turn,
        kind: BRAIN_RUN_EVENT.TURN_ENDED,
        sequence: 3,
        status: BRAIN_REQUEST_STATUS.SUCCEEDED,
        responseIds: [],
        at: 0,
      });
    });

  it.effect(
    "a member's message on an answered item wakes the agent that stopped, reaching it under its own lead with its files, and leaves the item answered at its revision, its thread naming the member; a teammate writes as the starter does, a repeat under its key reaches the agent once, and an outsider, no bearer, and an empty message are refused",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const { owner, other, task, target, ask, post, answer, read, message, transcript } =
          yield* openInbox(eve);
        const asked = yield* post({
          key: "flag-thread",
          title: "Turn on the agent-mail flag in staging",
          response: { type: INBOX_RESPONSE.TODO },
          needsReply: false,
        });
        assert.ok(Result.isSuccess(asked));
        const { id, key, title } = asked.success;
        // A bare Done on an item that asks nothing back reaches nobody, so the turn below is the agent's last.
        const answered = readAnswer(
          inboxAnsweredSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* answer(id, {
            revision: asked.success.revision,
            clientKey: randomUUID(),
            reply: INBOX_REPLY.DONE,
          }),
        ).item;
        yield* turnEnded(target);
        assert.equal((yield* transcript()).status, CODING_AGENT_STATUS.COMPLETED);
        const before = eve.sent.length;
        const trace = {
          name: "copy-review.txt",
          mediaType: CODING_AGENT_ATTACHMENT_TYPE.TEXT,
          data: Buffer.from("subject line too long\n").toString("base64"),
        };
        const body = {
          text: "One more: drop the emoji.",
          attachments: [trace],
          clientKey: randomUUID(),
        };

        const sent = readAnswer(
          inboxMessagedSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* message(id, body),
        );
        assert.deepEqual(
          [sent.item.status, sent.item.revision, sent.item.answer],
          [INBOX_STATUS.ANSWERED, answered.revision, answered.answer],
        );
        assert.deepEqual(
          sent.item.messages?.map((each) => [
            each.member?.userId,
            each.text,
            each.files?.map((file) => file.name),
          ]),
          [[owner, body.text, [trace.name]]],
        );
        const handed = JSON.stringify(eve.sent.slice(before).map((each) => each.message.message));
        assert.ok(handed.includes(`${INBOX_MESSAGE_LEAD} on \\"${title}\\" (key ${key})`));
        assert.ok(handed.includes(body.text), "it carries the words");
        assert.ok(handed.includes("subject line too long"), "it carries the file");
        const woken = yield* transcript();
        assert.equal(woken.status, CODING_AGENT_STATUS.RUNNING, "the message woke the agent");
        assert.ok(woken.lines.some((line) => line?.includes(body.text)));

        yield* message(id, body);
        assert.equal(eve.sent.length, before + 1, "a repeat under the key reaches the agent once");
        assert.deepEqual(
          yield* message(id, { ...body, text: "Something else." }),
          refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST),
          "other words under a key already taken are refused, so the agent never hears what the thread does not show",
        );
        assert.equal(eve.sent.length, before + 1);

        assert.deepEqual(
          yield* message(id, { text: "Before I joined.", clientKey: randomUUID() }, other),
          refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND),
        );
        yield* joinWorkspace(task.workspaceId, other);
        yield* TestClock.adjust(Duration.seconds(1));
        readAnswer(
          inboxMessagedSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* message(id, { text: "Agreed.", clientKey: randomUUID() }, other),
        );
        const kept = (yield* read()).items.find((item) => item.id === id);
        assert.deepEqual(
          kept?.messages?.map((each) => [each.member?.userId, each.text]),
          [
            [owner, body.text],
            [other, "Agreed."],
          ],
        );
        assert.equal(kept?.status, INBOX_STATUS.ANSWERED);

        assert.deepEqual(
          yield* ask(
            request(INBOX_MESSAGES, undefined, {
              method: "POST",
              id,
              body: { text: "Hello.", clientKey: randomUUID() },
            }),
          ),
          refusal(HOSTED_HTTP_STATUS.UNAUTHORIZED, HOSTED_API_ERROR.INVALID_TOKEN),
        );
        assert.deepEqual(
          yield* message(id, { text: "  ", clientKey: randomUUID() }),
          refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST),
        );
      }),
  );

  it.effect(
    "an Inbox answer is counted once it stands: not where its hand-off failed and was withdrawn, and once however often it is sent again under its key",
    () =>
      Effect.gen(function* () {
        const refused = yield* openInbox(fakeEve({ sends: EVE_SEND_OUTCOME.FAILED }));
        const lost = yield* refused.post(QUESTION);
        assert.ok(Result.isSuccess(lost));
        const withdrawn = yield* refused.answer(lost.success.id, {
          revision: lost.success.revision,
          clientKey: randomUUID(),
          reply: INBOX_REPLY.ANSWERED,
          note: "Say hello.",
        });
        assert.equal(withdrawn.status, HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE);
        assert.equal(countedFor(refused.owner, SERVER_EVENT.INBOX_ANSWER_SEND), 0);

        const { owner, post, answer } = yield* openInbox();
        const asked = yield* post(QUESTION);
        assert.ok(Result.isSuccess(asked));
        const body = {
          revision: asked.success.revision,
          clientKey: randomUUID(),
          reply: INBOX_REPLY.ANSWERED,
          note: "Say hello.",
        };
        assert.equal((yield* answer(asked.success.id, body)).status, HOSTED_HTTP_STATUS.OK);
        assert.equal((yield* answer(asked.success.id, body)).status, HOSTED_HTTP_STATUS.OK);
        assert.equal(countedFor(owner, SERVER_EVENT.INBOX_ANSWER_SEND), 1);
      }),
  );

  it.effect(
    "a message the agent's session did not take is taken back off the thread, so the thread never shows what the agent was not told",
    () =>
      Effect.gen(function* () {
        const { post, read, message } = yield* openInbox(
          fakeEve({ sends: EVE_SEND_OUTCOME.FAILED }),
        );
        const asked = yield* post(QUESTION);
        assert.ok(Result.isSuccess(asked));

        const sent = yield* message(asked.success.id, {
          text: "Still there?",
          clientKey: randomUUID(),
        });

        assert.equal(sent.status, HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE);
        const kept = (yield* read()).items.find((item) => item.id === asked.success.id);
        assert.equal(kept?.messages, undefined);
      }),
  );

  it.effect(
    "a member marks an item read and unread for themselves alone, or every item of a workspace's Inbox read, and an outsider, another method, and a malformed request are refused",
    () =>
      Effect.gen(function* () {
        const { owner, other, task, ask, post, read, waiting } = yield* openInbox();
        const asked = yield* post(QUESTION);
        assert.ok(Result.isSuccess(asked));
        const { id } = asked.success;
        const unread = () =>
          Effect.map(read(), (page) => page.items.find((item) => item.id === id)?.unread);
        const mark = (method: string, bearer = owner) =>
          ask(request(INBOX_READ, bearer, { method, id }));
        assert.equal(yield* unread(), true, "a new item is unread");
        assert.deepEqual(
          (yield* waiting()).items.map((entry) => [entry.id, entry.unread]),
          [[id, true]],
        );

        assert.deepEqual(
          readAnswer(inboxReadStateSchema, HOSTED_HTTP_STATUS.OK, yield* mark("PUT")),
          { id, unread: false },
        );
        assert.equal(yield* unread(), false);
        assert.deepEqual(
          readAnswer(inboxReadStateSchema, HOSTED_HTTP_STATUS.OK, yield* mark("DELETE")),
          { id, unread: true },
        );
        assert.equal(yield* unread(), true);

        assert.deepEqual(
          yield* mark("PUT", other),
          refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND),
          "an account outside the workspace reaches no item",
        );
        assert.deepEqual(
          yield* mark("POST"),
          refusal(HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED, HOSTED_API_ERROR.METHOD_NOT_ALLOWED),
        );
        assert.deepEqual(
          yield* ask(request(INBOX_READ, owner, { method: "DELETE", body: {} })),
          refusal(HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED, HOSTED_API_ERROR.METHOD_NOT_ALLOWED),
          "nothing marks every item unread",
        );

        const all = (body: WireBoundaryInput) =>
          ask(request(INBOX_READ, owner, { method: "PUT", body }));
        assert.deepEqual(
          yield* all({ workspaceId: "" }),
          refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST),
        );
        assert.deepEqual(
          readAnswer(
            inboxReadAllSchema,
            HOSTED_HTTP_STATUS.OK,
            yield* all({ workspaceId: task.workspaceId }),
          ),
          { marked: 1 },
        );
        assert.equal(yield* unread(), false);
        assert.deepEqual(readAnswer(inboxReadAllSchema, HOSTED_HTTP_STATUS.OK, yield* all({})), {
          marked: 0,
        });
      }),
  );

  it.effect(
    "a run of the account's own automation that failed to start rides the account's inbox read and moves its cursor, as no item, and another account's read carries none",
    () =>
      Effect.gen(function* () {
        const { owner, other, task, waiting } = yield* openInbox();
        const automation = Option.getOrThrow(
          yield* createAutomation(owner, {
            taskId: task.id,
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
              task.workspaceId,
              AUTOMATION_RUN_REASON.REPOSITORY_UNREACHABLE,
            ],
          ],
        );
        assert.deepEqual((yield* waiting(undefined, other)).failedRuns, []);
      }),
  );

  it.effect(
    "an item's attachment is served as its bytes under the type the service kept, not to be sniffed, not to be cached, and never to run as a page, to the item's account alone: another account, no bearer, another item, and a name that is no attachment are refused",
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
        assert.deepEqual(openedPagePolicy(served.headers), SANDBOXED_PAGE);
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
    "a picture a tool answered an agent or its worker is served as its bytes, not to be sniffed, not to be cached, and never to run as a page, to whoever may read the agent, and through its own transcript alone",
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
        assert.deepEqual(openedPagePolicy(served.headers), SANDBOXED_PAGE);
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
      // Chat is an experiment each starter turns on; the tests below are of its telling.
      for (const starter of [opened.owner, opened.other]) {
        yield* writeAccountPreferences(starter, { experiments: { [EXPERIMENT.CHAT]: true } });
      }
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
      const channel = Option.getOrThrow(yield* ensureTaskChannel(opened.owner, opened.task.id));
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
        assert.deepEqual(
          (yield* lineSendersOf(chat.second.target, [notice.message.id])).get(notice.message.id),
          // An agent's notice names it by its handle, and by its member's agent and the model that agent posted under.
          {
            kind: MESSAGE_SENDER.AGENT,
            name: "agent-1",
            model: chat.first.agent.model,
            agent: { id: chat.first.agent.id, taskId: chat.first.agent.planId ?? undefined },
          },
        );
        // The notice keeps the model its agent posted under, whatever the agent runs on since.
        yield* Database.use((db) =>
          db
            .update(codingAgent)
            .set({ model: "openai/gpt-6.1-sol" })
            .where(eq(codingAgent.id, chat.first.agent.id)),
        );
        assert.deepEqual(
          (yield* lineSendersOf(chat.second.target, [notice.message.id])).get(notice.message.id),
          {
            kind: MESSAGE_SENDER.AGENT,
            name: "agent-1",
            model: chat.first.agent.model,
            agent: { id: chat.first.agent.id, taskId: chat.first.agent.planId ?? undefined },
          },
        );
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
    "an account with Chat off reads nothing waiting in chat, a message addressed to its person among it",
    () =>
      Effect.gen(function* () {
        const chat = yield* openChat();
        yield* chooseChat(chat.owner, false);
        const telling = { ...chat.telling, doors: CHAT_DOORS };
        const dm = Option.getOrThrow(
          yield* findOrMakeDm(chat.owner, chat.workspace, chat.first.member.id, chat.person.id),
        );
        const before = yield* accountInboxPast(chat.owner, INBOX_CURSOR_START);
        yield* postChat(telling, {
          authorMemberId: chat.first.member.id,
          to: { channelId: dm.id },
          blocks: [{ type: CHAT_BLOCK.MARKDOWN, text: "Can I take the invite file too?" }],
          mentions: [],
          clientKey: randomUUID(),
        }).pipe(Effect.provide(chat.github.layer));
        const after = yield* accountInboxPast(chat.owner, INBOX_CURSOR_START);
        assert.deepEqual(after.chat, []);
        assert.equal(after.cursor, before.cursor, "nothing in chat moves the read");
      }),
  );

  it.effect(
    "a person a message addresses is told through their account's read once, a second before they read is held, and the read carries who and where until they read past it, with none of its words",
    () =>
      Effect.gen(function* () {
        const chat = yield* openChat();
        yield* chooseChat(chat.owner, true);
        const telling = { ...chat.telling, doors: CHAT_DOORS };
        const dm = Option.getOrThrow(
          yield* findOrMakeDm(chat.owner, chat.workspace, chat.first.member.id, chat.person.id),
        );
        const say = (text: string) =>
          postChat(telling, {
            authorMemberId: chat.first.member.id,
            to: { channelId: dm.id },
            blocks: [{ type: CHAT_BLOCK.MARKDOWN, text }],
            mentions: [],
            clientKey: randomUUID(),
          }).pipe(Effect.provide(chat.github.layer));
        const before = yield* accountInboxPast(chat.owner, INBOX_CURSOR_START);
        assert.deepEqual(before.chat, []);

        const first = yield* say("Can I take the invite file too?");
        assert.deepEqual(first.receipt.told, [chat.person.handle]);
        const second = yield* say("Or should I wait for #214?");
        assert.deepEqual(second.receipt.held, [chat.person.handle]);

        const waiting = yield* accountInboxPast(chat.owner, before.cursor);
        assert.notEqual(waiting.cursor, before.cursor);
        assert.deepEqual(
          waiting.chat?.map(({ seq, reason, from, workspaceId }) => ({
            seq,
            reason,
            from,
            workspaceId,
          })),
          [
            {
              seq: first.message.seq,
              reason: ACCOUNT_CHAT_REASON.DIRECT,
              from: "agent-1",
              workspaceId: chat.workspace,
            },
          ],
        );
        assert.ok(!JSON.stringify(waiting.chat).includes("invite file"));

        yield* readTo(
          chat.owner,
          chat.workspace,
          chat.person.id,
          second.message.channelId,
          second.message.seq,
        );
        const read = yield* accountInboxPast(chat.owner, waiting.cursor);
        assert.deepEqual(read.chat, []);
        const third = yield* say("Going ahead.");
        assert.deepEqual(third.receipt.told, [chat.person.handle]);
      }),
  );

  it.effect(
    "a plain post steers nobody, a mention steers the agent it names, and Luke, a person, and a handle naming no one are told no agent's way",
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

  it.effect(
    "an agent whose starter has not turned Chat on is steered nothing, however it is addressed",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const chat = yield* openChat(eve, true);
        yield* writeAccountPreferences(chat.other, { experiments: { [EXPERIMENT.CHAT]: false } });
        const told = yield* chat.post(chat.person, "@agent-2 please carry on.");
        assert.deepEqual([told.receipt.told, told.receipt.held], [[], ["agent-2"]]);
        assert.equal(eve.sent.length, 0);
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
      yield* writeAccountPreferences(opened.owner, { experiments: { [EXPERIMENT.CHAT]: true } });
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
          taskId: opened.task.id,
          self: { kind: MEMBER_KIND.AGENT, agentId: started.agent.id },
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
          { name: "#teammate-invitations", kind: CHANNEL_KIND.TASK, unread: 0 },
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
          ["#teammate-invitations", CHANNEL_KIND.TASK],
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
          .where(eq(codingAgent.id, "agentId" in chat.first.self ? chat.first.self.agentId : ""));
        const taskless = { ...chat.first, taskId: null };
        const posted = yield* chat.post(taskless, { text: "@luke who owns the invite table?" });
        assert.ok("seq" in posted);
        assert.deepEqual([posted.in, posted.unresolved], ["#general", ["@luke"]]);
      }),
  );

  it.effect("an agent started where its starter has not turned Chat on joins no chat", () =>
    Effect.gen(function* () {
      const opened = yield* openTask();
      yield* startedAgent(opened.owner, opened.task.id, opened.ask);
      assert.deepEqual(yield* roster(opened.owner, opened.task.workspaceId), []);
      yield* writeAccountPreferences(opened.owner, { experiments: { [EXPERIMENT.CHAT]: true } });
      yield* startedAgent(opened.owner, opened.task.id, opened.ask);
      assert.equal((yield* roster(opened.owner, opened.task.workspaceId)).length, 1);
    }),
  );

  it.effect(
    "a post is the calling agent's own, whatever member, author, or 'as' its input names",
    () =>
      Effect.gen(function* () {
        const chat = yield* openAgents();
        const other = Option.getOrThrow(
          yield* memberNamed(chat.owner, chat.task.workspaceId, chat.handles.second.slice(1)),
        );
        const posted = yield* chat.post(chat.first, {
          text: "Who wrote this?",
          authorMemberId: other.id,
          author: other.id,
          as: chat.handles.second,
          memberId: other.id,
        });
        assert.equal(posted.status, ACTION_RESULT_STATUS.ACCEPTED);
        const read = yield* chat.read(chat.second);
        assert.ok("messages" in read);
        assert.deepEqual(
          read.messages.map((message) => [message.from, message.text]),
          [[chat.handles.first, "Who wrote this?"]],
        );
      }),
  );

  it.effect(
    "a read seats the other agents on its task only where their starters turned Chat on",
    () =>
      Effect.gen(function* () {
        const chat = yield* openAgents();
        yield* joinWorkspace(chat.task.workspaceId, chat.other);
        const theirs = yield* startedAgent(chat.other, chat.task.id, chat.ask);
        const seated = () =>
          Effect.map(roster(chat.owner, chat.task.workspaceId), (members) =>
            members.some((member) => member.agentId === theirs.agent.id),
          );
        yield* chat.read(chat.first);
        assert.equal(yield* seated(), false, "a teammate with Chat off is not seated");
        yield* writeAccountPreferences(chat.other, { experiments: { [EXPERIMENT.CHAT]: true } });
        yield* chat.read(chat.first);
        assert.equal(yield* seated(), true);
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
          refused(ASK_REFUSAL.NEEDS_KEY),
        );
        assert.deepEqual(
          yield* chat.post(chat.first, { text: "An ask that does not read.", ask: null }),
          refused(CHAT_TOOL_REFUSAL.UNREADABLE_POST),
          "a key would not mend an ask that does not read",
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
        const newcomer: ChatAgent = {
          ...chat.first,
          self: { kind: MEMBER_KIND.AGENT, agentId: started.agent.id },
        };
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

/** A row of an agent's transcript as the relay leaves it, written straight to the store at the sequence given, answering its id. */
const transcriptRow = (
  agent: { readonly userId: string; readonly conversationId: string },
  seq: number,
  role: typeof MESSAGE_ROLE.USER | typeof MESSAGE_ROLE.ASSISTANT,
  parts: WireBoundaryInput,
) =>
  Effect.map(
    Database.use((db) =>
      db
        .insert(messages)
        .values({
          userId: agent.userId,
          conversationId: agent.conversationId,
          seq,
          clientId: randomUUID(),
          role,
          // SAFETY: the parts are the stored vocabulary's, spelled as the relay writes them.
          parts: parts as never,
          metadata:
            role === MESSAGE_ROLE.USER
              ? userMetadataOf(BRAIN_TURN_TRIGGER.ASK, undefined)
              : { author: MESSAGE_AUTHOR.BRAIN },
          placedAt: new Date(),
        })
        .returning({ id: messages.id }),
    ),
    ([row]) => row?.id ?? assert.fail("the row was not written"),
  );

const text = (words: string) => ({ type: "text", text: words });

/** The first message the newest session opened on, read back into its brief, its replay, and its note. */
function openedParts(eve: ReturnType<typeof fakeEve>) {
  const message = eve.opened.at(-1)?.message.message;
  if (message === undefined || Array.isArray(message)) {
    return assert.fail("the session opened on words alone");
  }
  return { text: message, parts: firstMessageParts(message) };
}

it.layer(getTestDB())("starting an agent from another", (it) => {
  /** A source agent on the owner's plan, on a choice and servers of its own, with a transcript of two turns, a branch, and a pull request, its GitHub answering as given. */
  const sourceAgentOn = (github?: RepositoryScript, eve?: ReturnType<typeof fakeEve>) =>
    Effect.gen(function* () {
      const opened = yield* openTask({
        ...(github === undefined ? undefined : { github }),
        ...(eve === undefined ? undefined : { eve }),
      });
      const source = readAnswer(
        codingAgentAnswerSchema,
        HOSTED_HTTP_STATUS.CREATED,
        yield* opened.ask(
          startAs(opened.owner, opened.task.id, {
            idempotencyKey: randomUUID(),
            model: SOL,
            effort: "low",
            disabledServers: [INTEGRATION_PROVIDER.LINEAR],
          }),
        ),
      ).agent;
      const stored = Option.getOrThrow(yield* readCodingAgent(opened.owner, source.id));
      yield* transcriptRow(stored, 1, MESSAGE_ROLE.USER, [text(SNAPSHOT)]);
      yield* transcriptRow(stored, 2, MESSAGE_ROLE.USER, [text("Use the mailer.")]);
      const firstTurn = yield* transcriptRow(stored, 3, MESSAGE_ROLE.ASSISTANT, [
        { type: "reasoning", text: "A thought of its own.", state: "done" },
        text("On it."),
        {
          type: "tool-bash",
          toolCallId: "call-1",
          state: "output-available",
          input: { command: "pnpm test" },
          output: "ok",
        },
      ]);
      const laterLine = yield* transcriptRow(stored, 4, MESSAGE_ROLE.USER, [
        text("Also add tests."),
      ]);
      yield* transcriptRow(stored, 5, MESSAGE_ROLE.ASSISTANT, [text("Done.")]);
      yield* updateCodingAgentBranch(opened.owner, source.id, PUBLISHED.branch);
      yield* recordCodingAgentPublished(opened.owner, source.id, {
        number: PUBLISHED.number,
        title: "Expire teammate invitations",
        url: `https://github.com/${RELAY_FULL_NAME}/pull/${PUBLISHED.number}`,
        state: PULL_REQUEST_STATE.OPEN,
        checks: CHECK_SUMMARY.NONE,
        additions: 4,
        deletions: 1,
        changedFiles: 1,
      });
      return { ...opened, source, stored, firstTurn, laterLine };
    });
  const sourceAgent = sourceAgentOn();

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.effect(
    "a continue is handed the plan as it stands now and every step after the source's brief, its reasoning left out, on the source's choice and servers, and names where it came from",
    () =>
      Effect.gen(function* () {
        const { owner, task, ask, eve, source } = yield* sourceAgent;
        yield* savePlanText(owner, task.id, "## Goal\n\nInvite by link.\n");

        const started = readAnswer(
          codingAgentAnswerSchema,
          HOSTED_HTTP_STATUS.CREATED,
          yield* ask(
            startAs(owner, task.id, { idempotencyKey: randomUUID(), from: { agentId: source.id } }),
          ),
        ).agent;
        const { text: handed, parts } = openedParts(eve);

        assert.deepEqual(started.from, { agentId: source.id, steps: 5, totalSteps: 5 });
        assert.deepEqual(
          [started.model, started.effort, started.disabledServers],
          [SOL, "low", [INTEGRATION_PROVIDER.LINEAR]],
        );
        assert.equal(parts.brief, "# Teammate invitations\n\n## Goal\n\nInvite by link.\n");
        assert.deepEqual(
          parts.replay?.steps.map((step) => [step.kind, step.summary]),
          [
            [REPLAY_STEP_KIND.LINE, "The developer: Use the mailer."],
            [REPLAY_STEP_KIND.SAID, "Said: On it."],
            [REPLAY_STEP_KIND.TOOL, "Ran: pnpm test"],
            [REPLAY_STEP_KIND.LINE, "The developer: Also add tests."],
            [REPLAY_STEP_KIND.SAID, "Said: Done."],
          ],
        );
        assert.match(parts.replay?.steps[2]?.words ?? "", /Result: ok/u);
        assert.match(parts.replay?.preamble ?? "", /You continue the work/u);
        assert.ok(parts.replay?.preamble.includes(PUBLISHED.branch));
        assert.match(
          parts.replay?.preamble ?? "",
          /what it had not pushed could not be copied from its sandbox/u,
          "a source that never opened a sandbox is taken up from the branch it pushed",
        );
        assert.ok(parts.replay?.preamble.includes(`/pull/${PUBLISHED.number}`));
        assert.doesNotMatch(handed, /A thought of its own/u);
        const stored = Option.getOrThrow(yield* readCodingAgent(owner, started.id));
        assert.equal(
          stored.planSnapshot,
          handed,
          "the agent keeps the first message it was handed",
        );
        const listed = readAnswer(
          codingAgentListAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(TASK_AGENTS, owner, { id: task.id })),
        );
        const fromOf = new Map(listed.agents.map((agent) => [agent.id, agent.from]));
        assert.deepEqual(
          [fromOf.has(source.id), fromOf.get(source.id), fromOf.get(started.id)],
          [true, undefined, { agentId: source.id, steps: 5, totalSteps: 5 }],
        );
      }),
  );

  /** A source whose session eve opened is claimed, with a turn under way eve knows as `turn_0`; answers the session. */
  const sourceRunning = (stored: CodingAgent, eve: ReturnType<typeof fakeEve>) =>
    Effect.gen(function* () {
      const target = { userId: stored.userId, conversationId: stored.conversationId };
      const sessionId = eve.opened[0]?.sessionId ?? "";
      assert.equal(yield* claimRuntimeSession(target, sessionId, new Date()), true);
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
      // The source's lines are the turn's, so none of them reads as awaiting a turn of its own.
      yield* Database.use((db) =>
        db
          .update(messages)
          .set({ turnId })
          .where(eq(messages.conversationId, stored.conversationId)),
      );
      return sessionId;
    });

  it.effect(
    "a continue stops its source's turn still running, once however many continue it, and a fork leaves its source running",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const { owner, task, ask, source, stored, firstTurn } = yield* sourceAgentOn(
          undefined,
          eve,
        );
        const sessionId = yield* sourceRunning(stored, eve);
        const startFrom = (from: { agentId: string; messageId?: string }) =>
          Effect.map(
            ask(startAs(owner, task.id, { idempotencyKey: randomUUID(), from })),
            (answered) =>
              readAnswer(codingAgentAnswerSchema, HOSTED_HTTP_STATUS.CREATED, answered).agent,
          );
        const sourceStatus = Effect.map(
          ask(request(AGENT, owner, { id: source.id })),
          (answered) =>
            readAnswer(codingAgentPageAnswerSchema, HOSTED_HTTP_STATUS.OK, answered).agent.status,
        );

        yield* startFrom({ agentId: source.id, messageId: firstTurn });
        assert.deepEqual(eve.cancelled, [], "a fork stops nothing");
        assert.equal(yield* sourceStatus, CODING_AGENT_STATUS.RUNNING);

        yield* startFrom({ agentId: source.id });
        assert.deepEqual(eve.cancelled, [[sessionId, "turn_0"]]);
        assert.equal(yield* sourceStatus, CODING_AGENT_STATUS.CANCELLED);

        yield* startFrom({ agentId: source.id });
        assert.deepEqual(
          eve.cancelled,
          [[sessionId, "turn_0"]],
          "a source stopped is not stopped again",
        );
      }),
  );

  it.effect("a source eve refuses to stop still has its continue started, and runs on", () =>
    Effect.gen(function* () {
      const eve = fakeEve({ cancels: false });
      const { owner, task, ask, source, stored } = yield* sourceAgentOn(undefined, eve);
      const sessionId = yield* sourceRunning(stored, eve);

      const started = readAnswer(
        codingAgentAnswerSchema,
        HOSTED_HTTP_STATUS.CREATED,
        yield* ask(
          startAs(owner, task.id, { idempotencyKey: randomUUID(), from: { agentId: source.id } }),
        ),
      ).agent;

      assert.deepEqual(started.from?.agentId, source.id);
      assert.deepEqual(eve.cancelled, [[sessionId, "turn_0"]]);
      const page = readAnswer(
        codingAgentPageAnswerSchema,
        HOSTED_HTTP_STATUS.OK,
        yield* ask(request(AGENT, owner, { id: source.id })),
      ).agent;
      assert.equal(page.status, CODING_AGENT_STATUS.RUNNING);
    }),
  );

  it.effect(
    "a continue is named after its source, the suffix never stacked and the whole cut to fit, a source with no title names none, and a fork is named as it starts",
    () =>
      Effect.gen(function* () {
        const { owner, task, ask, source, firstTurn } = yield* sourceAgent;
        const titleFrom = (from: { agentId: string; messageId?: string }) =>
          Effect.map(
            ask(startAs(owner, task.id, { idempotencyKey: randomUUID(), from })),
            (answered) =>
              readAnswer(codingAgentAnswerSchema, HOSTED_HTTP_STATUS.CREATED, answered).agent,
          );

        assert.equal((yield* titleFrom({ agentId: source.id })).title, null);
        yield* renameCodingAgent(owner, source.id, "Invite by link");
        const continued = yield* titleFrom({ agentId: source.id });
        assert.equal(continued.title, "Invite by link (continued)");
        assert.equal(
          (yield* titleFrom({ agentId: continued.id })).title,
          "Invite by link (continued)",
        );
        assert.equal((yield* titleFrom({ agentId: source.id, messageId: firstTurn })).title, null);
        const long = "Expire teammate invitations ".repeat(4);
        yield* renameCodingAgent(owner, source.id, long);
        const cut = (yield* titleFrom({ agentId: source.id })).title ?? "";
        assert.equal(cut.length <= CODING_AGENT_BOUNDS.MAX_TITLE_CHARS, true);
        assert.match(cut, /^Expire teammate invitations Expire .*[^ ] \(continued\)$/u);
      }),
  );

  it.effect(
    "a source names the agents that continued and forked it, in its task's list, on its own page, and once archived",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const { owner, task, ask, source, stored, firstTurn } = yield* sourceAgentOn(
          undefined,
          eve,
        );
        yield* sourceRunning(stored, eve);
        const startFrom = (from: { agentId: string; messageId?: string }) =>
          Effect.map(
            ask(startAs(owner, task.id, { idempotencyKey: randomUUID(), from })),
            (answered) =>
              readAnswer(codingAgentAnswerSchema, HOSTED_HTTP_STATUS.CREATED, answered).agent,
          );
        const continued = yield* startFrom({ agentId: source.id });
        const forked = yield* startFrom({ agentId: source.id, messageId: firstTurn });
        // Note that the two start within one instant here, so they are compared in the order of their ids.
        const byId = <Named extends { readonly agentId: string }>(
          named: readonly Named[] | undefined,
        ) => [...(named ?? [])].sort((a, b) => a.agentId.localeCompare(b.agentId));
        const expected = byId([
          { agentId: continued.id, title: null, forked: false },
          { agentId: forked.id, title: null, forked: true, messageId: firstTurn },
        ]);

        const listed = readAnswer(
          codingAgentListAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(TASK_AGENTS, owner, { id: task.id })),
        );
        const continuedByOf = new Map(listed.agents.map((agent) => [agent.id, agent.continuedBy]));
        assert.deepEqual(byId(continuedByOf.get(source.id)), expected);
        assert.equal(continuedByOf.get(continued.id), undefined);
        const page = readAnswer(
          codingAgentPageAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(AGENT, owner, { id: source.id })),
        ).agent;
        assert.deepEqual(byId(page.continuedBy), expected);
        const archived = readAnswer(
          codingAgentAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(
            request(AGENT, owner, { method: "PATCH", id: source.id, body: { archived: true } }),
          ),
        ).agent;
        assert.deepEqual(byId(archived.continuedBy), expected);
      }),
  );

  /** A source whose stopped sandbox holds a change it never committed, over a checkout and remote on disk, and a continue of it; GitHub answers its pull request's reads as `pull` does, where given. */
  const copyScenario = (t: TestContext, pull?: RepositoryScript) =>
    Effect.gen(function* () {
      vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureOidcToken());
      const checkout = sourceCheckout(yield* Effect.promise(() => temporaryDirectory(t, "copy-")));
      writeFileSync(join(checkout.checkout, "invites.ts"), "export const ttl = 7;\n");
      const sandbox = sourceSandbox(checkout, "stopped");
      const opened = yield* sourceAgentOn(
        pull === undefined ? sandbox.answer : (sent) => sandbox.answer(sent) ?? pull(sent),
      );
      yield* claimRuntimeSession(opened.stored, "wrun_source", new Date());
      const continued = Effect.gen(function* () {
        const started = readAnswer(
          codingAgentAnswerSchema,
          HOSTED_HTTP_STATUS.CREATED,
          yield* opened.ask(
            startAs(opened.owner, opened.task.id, {
              idempotencyKey: randomUUID(),
              from: { agentId: opened.source.id },
            }),
          ),
        ).agent;
        return { started, preamble: openedParts(opened.eve).parts.replay?.preamble ?? "" };
      });
      return { ...opened, checkout, sandbox, continued };
    });

  /** The fetch the preamble hands on, run in a checkout of the remote cloned as an agent's is, with the default branch alone; answers that checkout. */
  const fetchedAsHanded = (checkout: SourceCheckout, preamble: string) => {
    const fetch = /`(git remote set-branches [^`]+)`/u.exec(preamble)?.[1] ?? "";
    const fresh = join(checkout.root, "fresh");
    checkout.sh(
      checkout.root,
      "git",
      "clone",
      "--quiet",
      "--single-branch",
      "--branch",
      "main",
      checkout.remote,
      fresh,
    );
    checkout.sh(fresh, "sh", "-c", fetch);
    return fresh;
  };

  it.effect(
    "a continue copies the source's checkout, what it had not committed included, to a branch of its own from the sandbox it wakes and stops again, names that branch and how a fresh checkout fetches it, and keeps it on its record",
    (t) =>
      Effect.gen(function* () {
        const { checkout, sandbox, continued } = yield* copyScenario(t);

        const { started, preamble } = yield* continued;

        const branch = started.from?.branch ?? "";
        assert.match(branch, /^luke\/teammate-invitations-continued-[0-9a-f]{8}$/u);
        assert.ok(
          preamble.includes(
            `with what it had not committed or pushed recorded as one snapshot commit on top, is copied to the branch \`${branch}\`, made for you`,
          ),
        );
        assert.ok(preamble.includes(`Its own branch was \`${PUBLISHED.branch}\``));
        // The words the preamble hands on, run in a checkout cloned as an agent's is, find the copy.
        const fresh = fetchedAsHanded(checkout, preamble);
        assert.equal(checkout.sh(fresh, "git", "branch", "--show-current"), branch);
        assert.equal(readFileSync(join(fresh, "invites.ts"), "utf8"), "export const ttl = 7;\n");
        // The stop runs behind the Start, which answered without waiting on it.
        yield* Deferred.await(sandbox.stopAsked);
        assert.deepEqual(
          [sandbox.ran, sandbox.stops],
          [[SOURCE_SANDBOX.WOKEN], [SOURCE_SANDBOX.WOKEN]],
        );
      }),
  );

  it.effect(
    "a continue of a source whose pull request is still open is told to carry the copy onto that pull request's branch and open no second one, and the words it is handed bring the branch to the copy",
    (t) =>
      Effect.gen(function* () {
        const { checkout, continued } = yield* copyScenario(t, publishedPullRequest);
        // The source worked on its pull request's branch, pushed, with its change still uncommitted.
        checkout.sh(checkout.checkout, "git", "switch", "--quiet", "-c", PUBLISHED.branch);
        checkout.sh(checkout.checkout, "git", "push", "--quiet", "origin", PUBLISHED.branch);

        const { started, preamble } = yield* continued;

        const copied = started.from?.branch ?? "";
        assert.ok(preamble.includes("open no new pull request"), preamble);
        assert.ok(!preamble.includes("open your pull request from it"), preamble);
        const fresh = fetchedAsHanded(checkout, preamble);
        const [, carry = ""] = [...preamble.matchAll(/`(git remote set-branches [^`]+)`/gu)].map(
          (match) => match[1],
        );
        const merge = /`(git merge --ff-only [^`]+)`/u.exec(preamble)?.[1] ?? "";
        checkout.sh(fresh, "sh", "-c", `${carry} && ${merge}`);
        assert.equal(checkout.sh(fresh, "git", "branch", "--show-current"), PUBLISHED.branch);
        assert.equal(
          checkout.sh(fresh, "git", "rev-parse", "HEAD"),
          checkout.sh(fresh, "git", "rev-parse", copied),
        );
        assert.equal(readFileSync(join(fresh, "invites.ts"), "utf8"), "export const ttl = 7;\n");
      }),
  );

  it.effect(
    "a continue of a source whose pull request its row still reads open, but GitHub says merged since, opens its own from the copy",
    (t) =>
      Effect.gen(function* () {
        const merged: RepositoryScript = async (sent) => {
          const answered = await publishedPullRequest(sent);
          const pathname = new URL(sent.url).pathname;
          if (answered === undefined || !pathname.endsWith(`/pulls/${PUBLISHED.number}`)) {
            return answered;
          }
          const pull = await answered.json();
          return Response.json({
            ...pull,
            state: "closed",
            merged: true,
            merged_at: "2026-10-16T09:00:00Z",
          });
        };
        const { continued } = yield* copyScenario(t, merged);

        const { preamble } = yield* continued;

        assert.ok(preamble.includes("open your pull request from it as usual"), preamble);
        assert.ok(!preamble.includes("open no new pull request"), preamble);
      }),
  );

  it.effect(
    "a sandbox held past the copy's own hold, by a developer's terminal or another Start's copy, is woken for the copy and left up",
    (t) =>
      Effect.gen(function* () {
        const { stored, sandbox, continued } = yield* copyScenario(t);
        yield* holdSandbox(stored.conversationId, new Date(Date.now() + 10 * 60_000));

        const { started } = yield* continued;

        assert.ok(started.from?.branch !== undefined);
        assert.deepEqual([sandbox.ran, sandbox.stops], [[SOURCE_SANDBOX.WOKEN], []]);
      }),
  );

  it.effect(
    "a source whose task moved to another repository since it started is copied nowhere, its sandbox left asleep, and taken up from the branch it pushed, fetched as one word whatever a shell would read in its name",
    (t) =>
      Effect.gen(function* () {
        const { owner, source, checkout, sandbox, continued } = yield* copyScenario(t);
        // A name git allows whose words a shell would run, joined so it reads as no template placeholder.
        const pushedBranch = ["luke/invites$(touch$", "{IFS}pwned)"].join("");
        checkout.sh(
          checkout.checkout,
          "git",
          "push",
          "--quiet",
          "origin",
          `HEAD:refs/heads/${pushedBranch}`,
        );
        yield* updateCodingAgentBranch(owner, source.id, pushedBranch);
        yield* Database.use((db) =>
          db
            .update(codingAgent)
            .set({ repository: "Acme/Former" })
            .where(eq(codingAgent.id, source.id)),
        );

        const { started, preamble } = yield* continued;

        assert.equal(started.from?.branch, undefined);
        assert.match(preamble, /what it had not pushed could not be copied from its sandbox/u);
        assert.deepEqual([sandbox.ran, sandbox.stops, sandbox.state.status], [[], [], "stopped"]);
        const fresh = fetchedAsHanded(checkout, preamble);
        assert.equal(checkout.sh(fresh, "git", "branch", "--show-current"), pushedBranch);
        assert.equal(existsSync(join(fresh, "pwned")), false);
      }),
  );

  it.effect(
    "a fork is cut at the source's message, its turn included, warned of the files the source edited after it, and a message that is none of the source's journals is refused",
    () =>
      Effect.gen(function* () {
        const { owner, task, ask, eve, source, stored, firstTurn, laterLine } = yield* sourceAgent;
        const patch = (files: readonly string[]) => ({
          patchText: `*** Begin Patch\n${files.map((file) => `*** Update File: ${file}\n@@\n-a\n+b`).join("\n")}\n*** End Patch`,
        });
        yield* transcriptRow(stored, 6, MESSAGE_ROLE.ASSISTANT, [
          {
            type: "tool-apply_patch",
            toolCallId: "call-2",
            state: "output-available",
            input: patch(["src/invites.ts", "src/expiry.ts"]),
            output: "ok",
          },
          {
            type: "tool-write_file",
            toolCallId: "call-3",
            state: "output-available",
            input: { filePath: "src/mailer.ts", content: "x" },
            output: "ok",
          },
          {
            type: "tool-apply_patch",
            toolCallId: "call-4",
            state: "output-error",
            input: patch(["src/refused.ts"]),
            errorText: "the patch did not apply",
          },
          {
            type: "tool-apply_patch",
            toolCallId: "call-5",
            state: "output-available",
            input: patch(["src/invites.ts"]),
            output: "ok",
          },
          {
            type: "tool-apply_patch",
            toolCallId: "call-6",
            state: "output-available",
            input: {
              patchText:
                "*** Begin Patch\n*** Update File: src/old.ts\n*** Move to: src/new.ts\n*** End Patch",
            },
            output: "ok",
          },
        ]);
        const fork = (messageId: string) =>
          ask(
            startAs(owner, task.id, {
              idempotencyKey: randomUUID(),
              from: { agentId: source.id, messageId },
            }),
          );

        const started = readAnswer(
          codingAgentAnswerSchema,
          HOSTED_HTTP_STATUS.CREATED,
          yield* fork(firstTurn),
        ).agent;
        const { parts } = openedParts(eve);

        assert.deepEqual(started.from, {
          agentId: source.id,
          messageId: firstTurn,
          steps: 3,
          totalSteps: 3,
        });
        assert.deepEqual(
          parts.replay?.steps.map((step) => step.summary),
          ["The developer: Use the mailer.", "Said: On it.", "Ran: pnpm test"],
        );
        assert.match(parts.replay?.preamble ?? "", /You are a fork/u);
        assert.match(
          parts.replay?.preamble ?? "",
          /may be ahead of the message you were forked at\. After that message it edited `src\/invites\.ts`, `src\/expiry\.ts`, `src\/mailer\.ts`, `src\/old\.ts`, `src\/new\.ts`; undo/u,
        );
        for (const named of [laterLine, randomUUID()]) {
          assert.deepEqual(
            yield* fork(named),
            refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST),
          );
        }
      }),
  );

  it.effect(
    "a continue of a source whose turn failed part way replays the words that turn formed before it failed",
    () =>
      Effect.gen(function* () {
        const { owner, task, ask, eve, source, stored } = yield* sourceAgent;
        const target = { userId: owner, conversationId: stored.conversationId };
        const writer = yield* storeWriter({ tools: CODER_TOOL_SET });
        const turnId = randomUUID();
        const turn = { conversationId: sessionKey(target.conversationId), turnId };
        yield* writer.enqueueTurn(target, {
          turnId,
          origin: TURN_ORIGIN.TYPED,
          eveTurnId: "turn_1",
        });
        const bodies = [
          {
            kind: BRAIN_RUN_EVENT.TURN_STARTED,
            origin: BRAIN_TURN_ORIGIN.TYPED,
            trigger: BRAIN_TURN_TRIGGER.ASK,
            at: 0,
          },
          { kind: BRAIN_RUN_EVENT.STEP_STARTED, step: 1 },
          { kind: BRAIN_RUN_EVENT.TEXT_DRAFTED, step: 1, text: "Halfway through the mailer." },
          {
            kind: BRAIN_RUN_EVENT.TURN_ENDED,
            status: BRAIN_REQUEST_STATUS.FAILED,
            responseIds: [],
            at: 1,
          },
        ] as const;
        for (const [index, body] of bodies.entries()) {
          yield* writer.consume(target, { ...turn, ...body, sequence: index + 1 });
        }

        readAnswer(
          codingAgentAnswerSchema,
          HOSTED_HTTP_STATUS.CREATED,
          yield* ask(
            startAs(owner, task.id, {
              idempotencyKey: randomUUID(),
              from: { agentId: source.id },
            }),
          ),
        );

        assert.equal(
          openedParts(eve).parts.replay?.steps.at(-1)?.summary,
          "Said: Halfway through the mailer.",
        );
      }),
  );

  it.effect(
    "a fork of a reply still being written keeps the steps, and the words and calls of the last of them, seen as Fork was pressed, nothing written after, and names the files the rest of that reply edited; a fork naming no steps keeps the reply whole",
    () =>
      Effect.gen(function* () {
        const { owner, task, ask, eve, source, stored } = yield* sourceAgent;
        const write = (callId: string, filePath: string) => ({
          type: "tool-write_file",
          toolCallId: callId,
          state: "output-available",
          input: { filePath, content: "x" },
          output: "ok",
        });
        const writing = yield* transcriptRow(stored, 6, MESSAGE_ROLE.ASSISTANT, [
          { type: "step-start" },
          text("Writing the expiry first."),
          write("call-7", "src/expiry.ts"),
          { type: "step-start" },
          text("Now the mailer."),
          write("call-8", "src/mailer.ts"),
        ]);
        const fork = (messageSteps: number | undefined, messageStepParts?: number) =>
          Effect.gen(function* () {
            const started = readAnswer(
              codingAgentAnswerSchema,
              HOSTED_HTTP_STATUS.CREATED,
              yield* ask(
                startAs(owner, task.id, {
                  idempotencyKey: randomUUID(),
                  from: {
                    agentId: source.id,
                    messageId: writing,
                    ...(messageSteps === undefined ? undefined : { messageSteps }),
                    ...(messageStepParts === undefined ? undefined : { messageStepParts }),
                  },
                }),
              ),
            ).agent;
            return { started, replay: openedParts(eve).parts.replay };
          });

        const pinned = yield* fork(1);
        assert.equal(pinned.started.from?.messageSteps, 1);
        assert.deepEqual(
          pinned.replay?.steps.slice(-2).map((step) => step.summary),
          ["Said: Writing the expiry first.", "Wrote: src/expiry.ts"],
        );
        assert.match(
          pinned.replay?.preamble ?? "",
          /After that message it edited `src\/mailer\.ts`; undo/u,
        );

        // A press that saw the step's words and not yet its call keeps the words alone.
        const within = yield* fork(1, 1);
        assert.equal(within.started.from?.messageStepParts, 1);
        assert.equal(within.replay?.steps.at(-1)?.summary, "Said: Writing the expiry first.");
        assert.match(
          within.replay?.preamble ?? "",
          /After that message it edited `src\/expiry\.ts`, `src\/mailer\.ts`; undo/u,
        );

        const whole = yield* fork(undefined);
        assert.equal(whole.started.from?.messageSteps, undefined);
        assert.deepEqual(
          whole.replay?.steps.slice(-2).map((step) => step.summary),
          ["Said: Now the mailer.", "Wrote: src/mailer.ts"],
        );
        assert.match(whole.replay?.preamble ?? "", /edited no file after that message/u);

        assert.deepEqual(
          yield* ask(
            startAs(owner, task.id, {
              idempotencyKey: randomUUID(),
              from: { agentId: source.id, messageSteps: 1 },
            }),
          ),
          refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST),
        );
        assert.deepEqual(
          yield* ask(
            startAs(owner, task.id, {
              idempotencyKey: randomUUID(),
              from: { agentId: source.id, messageId: writing, messageStepParts: 1 },
            }),
          ),
          refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST),
        );
      }),
  );

  it.effect(
    "a source on another plan, or one the account does not reach, is refused as naming nothing, and a prompt beside a source as invalid",
    () =>
      Effect.gen(function* () {
        const { owner, other, task, ask, eve, source } = yield* sourceAgent;
        const elsewhere = yield* startTask(owner, { name: "Billing", repository: RELAY_FULL_NAME });
        const away = Option.getOrThrow(
          yield* createCodingAgent(owner, {
            taskId: elsewhere.id,
            planSnapshot: "# Billing",
            prompt: null,
            idempotencyKey: randomUUID(),
            model: SOL,
            effort: "low",
            repository: RELAY_FULL_NAME,
          }),
        ).agent;
        const opened = eve.opened.length;

        assert.deepEqual(
          yield* ask(
            startAs(owner, task.id, { idempotencyKey: randomUUID(), from: { agentId: away.id } }),
          ),
          refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND),
        );
        assert.deepEqual(
          yield* ask(
            startAs(other, task.id, { idempotencyKey: randomUUID(), from: { agentId: source.id } }),
          ),
          refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND),
        );
        assert.deepEqual(
          yield* ask(
            startAs(owner, task.id, {
              idempotencyKey: randomUUID(),
              task: "Do it again.",
              from: { agentId: source.id },
            }),
          ),
          refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST),
        );
        assert.equal(eve.opened.length, opened);
      }),
  );

  /** A server mention as the desktop writes one. */
  const serverMention = (provider: IntegrationProvider, name: string) =>
    mentionMarkdown({ kind: MENTION_KIND.SERVER, provider }, name, {
      workspace: "acme",
      repository: null,
    });

  /** The words and files the session opened on, its first part's words read back as a first message. */
  const openedWithFiles = (eve: ReturnType<typeof fakeEve>) => {
    const message = eve.opened.at(-1)?.message.message;
    assert.ok(Array.isArray(message), "the session opened on parts");
    const [first] = message;
    assert.ok(first?.type === "text", "the first part is the words");
    return {
      parts: firstMessageParts(first.text),
      files: message.flatMap((part) => (part.type === "file" ? [part.filename] : [])),
    };
  };

  it.effect(
    "a note beside a source is written after the replay as the developer's with its files, and the first turn's servers are read from the note, never the replay",
    () =>
      Effect.gen(function* () {
        const { owner, task, ask, eve, source, stored } = yield* sourceAgent;
        yield* transcriptRow(stored, 6, MESSAGE_ROLE.USER, [
          text(`Look in ${serverMention(INTEGRATION_PROVIDER.NOTION, "Notion")} too.`),
        ]);
        const note = `Now check ${serverMention(INTEGRATION_PROVIDER.LINEAR, "Linear")} first.`;
        const png = {
          name: "flow.png",
          mediaType: CODING_AGENT_ATTACHMENT_TYPE.PNG,
          data: Buffer.from(PNG).toString("base64"),
        };

        const started = readAnswer(
          codingAgentAnswerSchema,
          HOSTED_HTTP_STATUS.CREATED,
          yield* ask(
            startAs(owner, task.id, {
              idempotencyKey: randomUUID(),
              from: { agentId: source.id },
              note: `  ${note}\n`,
              attachments: [png],
            }),
          ),
        ).agent;
        const { parts, files } = openedWithFiles(eve);

        assert.deepEqual(parts.note, {
          heading: START_NOTE_HEADING.DEVELOPER,
          text: note,
          files: { text: 0, other: 1 },
        });
        assert.equal(parts.replay?.steps.length, 6);
        assert.deepEqual(files, ["flow.png"]);
        const kept = Option.getOrThrow(yield* readCodingAgent(owner, started.id));
        assert.deepEqual(yield* takeCodingAgentMentionedServers(owner, kept.conversationId), [
          INTEGRATION_PROVIDER.LINEAR,
        ]);
      }),
  );

  it.effect(
    "the source's files are attached again only as far as they fit beside the note's within one message's bounds, and the rest are named as not passed on",
    () =>
      Effect.gen(function* () {
        const { owner, task, ask, eve } = yield* openTask();
        const data = Buffer.from(PNG).toString("base64");
        const source = Option.getOrThrow(
          yield* createCodingAgent(owner, {
            taskId: task.id,
            planSnapshot: null,
            prompt: "Match these screens.",
            idempotencyKey: randomUUID(),
            model: SOL,
            effort: "low",
            repository: RELAY_FULL_NAME,
          }),
        ).agent;
        const shots = Array.from(
          { length: CODING_AGENT_BOUNDS.MAX_ATTACHMENTS },
          (_, at) => `screen-${at}.png`,
        );
        yield* transcriptRow(source, 1, MESSAGE_ROLE.USER, [
          text("Match these screens."),
          ...shots.map((filename) => ({
            type: "file",
            mediaType: CODING_AGENT_ATTACHMENT_TYPE.PNG,
            filename,
            url: `data:${CODING_AGENT_ATTACHMENT_TYPE.PNG};base64,${data}`,
          })),
        ]);

        yield* ask(
          startAs(owner, task.id, {
            idempotencyKey: randomUUID(),
            from: { agentId: source.id },
            note: "And this one.",
            attachments: [{ name: "new.png", mediaType: CODING_AGENT_ATTACHMENT_TYPE.PNG, data }],
          }),
        );
        const { parts, files } = openedWithFiles(eve);

        assert.deepEqual(files, [...shots.slice(0, -1), "new.png"]);
        assert.match(parts.replay?.preamble ?? "", /could not be passed on: screen-9\.png\./u);
      }),
  );

  it.effect(
    "an automation run's source hands on the servers its own prompt names and the note's, never those of the webhook body it carried",
    () =>
      Effect.gen(function* () {
        const { owner, task, ask } = yield* openTask();
        const prompt = `Triage ${serverMention(INTEGRATION_PROVIDER.LINEAR, "Linear")} daily.`;
        const run = Option.getOrThrow(
          yield* createCodingAgent(owner, {
            taskId: task.id,
            planSnapshot: null,
            prompt: `${prompt}\n\nThe webhook said: see ${serverMention(INTEGRATION_PROVIDER.NOTION, "Notion")}.`,
            idempotencyKey: randomUUID(),
            model: SOL,
            effort: "low",
            repository: RELAY_FULL_NAME,
            automationOrigin: {
              name: "Daily triage",
              firing: { kind: AUTOMATION_FIRING.WEBHOOK, bytes: 40 },
              prompt,
            },
          }),
        ).agent;

        const started = readAnswer(
          codingAgentAnswerSchema,
          HOSTED_HTTP_STATUS.CREATED,
          yield* ask(
            startAs(owner, task.id, {
              idempotencyKey: randomUUID(),
              from: { agentId: run.id },
              note: `Post it in ${serverMention(INTEGRATION_PROVIDER.SLACK, "Slack")}.`,
            }),
          ),
        ).agent;

        const kept = Option.getOrThrow(yield* readCodingAgent(owner, started.id));
        assert.deepEqual(
          (yield* takeCodingAgentMentionedServers(owner, kept.conversationId)).toSorted(),
          [INTEGRATION_PROVIDER.LINEAR, INTEGRATION_PROVIDER.SLACK],
        );
      }),
  );

  it.effect(
    "a note without a source, files beside a source with no note, and a prompt beside a source and a note are refused as invalid",
    () =>
      Effect.gen(function* () {
        const { owner, task, ask, eve, source } = yield* sourceAgent;
        const png = {
          name: "flow.png",
          mediaType: CODING_AGENT_ATTACHMENT_TYPE.PNG,
          data: Buffer.from(PNG).toString("base64"),
        };
        const opened = eve.opened.length;
        for (const body of [
          { note: "Carry on." },
          { from: { agentId: source.id }, attachments: [png] },
          { from: { agentId: source.id }, note: "Carry on.", task: "Do it again." },
          { from: { agentId: source.id }, note: " " },
        ]) {
          assert.deepEqual(
            yield* ask(startAs(owner, task.id, { idempotencyKey: randomUUID(), ...body })),
            refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST),
            JSON.stringify(Object.keys(body)),
          );
        }
        assert.equal(eve.opened.length, opened);
      }),
  );

  it.effect(
    "a retry from another agent answers the agent its key made though the source has gone since, and a source whose transcript does not read is answered as unavailable rather than as an empty replay",
    () =>
      Effect.gen(function* () {
        const { owner, task, ask, eve, source, stored } = yield* sourceAgent;
        const body = { idempotencyKey: randomUUID(), from: { agentId: source.id } };
        const first = readAnswer(
          codingAgentAnswerSchema,
          HOSTED_HTTP_STATUS.CREATED,
          yield* ask(startAs(owner, task.id, body)),
        ).agent;

        yield* transcriptRow(stored, 6, MESSAGE_ROLE.ASSISTANT, [{ type: "text" }]);
        const opened = eve.opened.length;
        assert.deepEqual(
          yield* ask(
            startAs(owner, task.id, { idempotencyKey: randomUUID(), from: { agentId: source.id } }),
          ),
          refusal(HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE, HOSTED_API_ERROR.UNAVAILABLE),
        );
        assert.equal(eve.opened.length, opened);

        yield* discardCodingAgent(owner, source.id);
        const again = readAnswer(
          codingAgentAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(startAs(owner, task.id, body)),
        ).agent;
        assert.equal(again.id, first.id);
        assert.equal(eve.opened.length, opened);
      }),
  );

  it.effect(
    "a source whose prompt holds a note's heading in its prose hands on its brief whole, and a note it was handed behind its marker becomes its first step",
    () =>
      Effect.gen(function* () {
        const { owner, task, ask, eve } = yield* openTask();
        const prose = `Write the guide.\n\n${START_NOTE_HEADING.DEVELOPER}\n\nExplain this heading in the guide.`;
        const sourceOf = (handed: string) =>
          Effect.gen(function* () {
            const made = Option.getOrThrow(
              yield* createCodingAgent(owner, {
                taskId: task.id,
                planSnapshot: null,
                prompt: handed,
                idempotencyKey: randomUUID(),
                model: SOL,
                effort: "low",
                repository: RELAY_FULL_NAME,
              }),
            ).agent;
            yield* transcriptRow(made, 1, MESSAGE_ROLE.USER, [text(handed)]);
            return made;
          });
        const continueFrom = (agentId: string) =>
          ask(startAs(owner, task.id, { idempotencyKey: randomUUID(), from: { agentId } }));

        yield* continueFrom((yield* sourceOf(prose)).id);
        assert.equal(openedParts(eve).parts.brief, prose);
        assert.deepEqual(openedParts(eve).parts.replay?.steps, []);

        yield* continueFrom(
          (yield* sourceOf(firstMessageText(prose, undefined, "Keep it short."))).id,
        );
        const read = openedParts(eve).parts;
        assert.equal(read.brief, prose);
        assert.deepEqual(
          read.replay?.steps.map((step) => step.summary),
          ["The developer: Keep it short."],
        );
      }),
  );

  it.effect(
    "a transcript of more rows than are read keeps its newest rows, so a continue replays where it ended and a fork at a late message is found, and an unreadable row past a fork's cut refuses only a continue",
    () =>
      Effect.gen(function* () {
        const { owner, task, ask, eve } = yield* openTask();
        const source = readAnswer(
          codingAgentAnswerSchema,
          HOSTED_HTTP_STATUS.CREATED,
          yield* ask(startAs(owner, task.id, { idempotencyKey: randomUUID() })),
        ).agent;
        const stored = Option.getOrThrow(yield* readCodingAgent(owner, source.id));
        yield* transcriptRow(stored, 1, MESSAGE_ROLE.USER, [text(SNAPSHOT)]);
        const turns = REPLAY_BOUNDS.MAX_ROWS + 50;
        const ids: string[] = [];
        // Note that the rows go in by the thousand, because one insert a row would take minutes.
        for (let from = 0; from < turns; from += 1_000) {
          const rows = Array.from({ length: Math.min(1_000, turns - from) }, (_, at) => ({
            userId: stored.userId,
            conversationId: stored.conversationId,
            seq: from + at + 2,
            clientId: randomUUID(),
            role: MESSAGE_ROLE.ASSISTANT,
            // SAFETY: the parts are the stored vocabulary's, spelled as the relay writes them.
            parts: [text(`Step ${from + at}.`)] as never,
            metadata: { author: MESSAGE_AUTHOR.BRAIN },
            placedAt: new Date(),
          }));
          const written = yield* Database.use((db) =>
            db.insert(messages).values(rows).returning({ id: messages.id }),
          );
          ids.push(...written.map((row) => row.id));
        }
        const startFrom = (from: WireBoundaryInput) =>
          Effect.map(
            ask(startAs(owner, task.id, { idempotencyKey: randomUUID(), from })),
            (answered) =>
              readAnswer(codingAgentAnswerSchema, HOSTED_HTTP_STATUS.CREATED, answered).agent,
          );

        yield* startFrom({ agentId: source.id });
        assert.equal(
          openedParts(eve).parts.replay?.steps.at(-1)?.summary,
          `Said: Step ${turns - 1}.`,
        );
        const late = turns - 10;
        yield* startFrom({ agentId: source.id, messageId: ids[late] ?? "" });
        assert.equal(openedParts(eve).parts.replay?.steps.at(-1)?.summary, `Said: Step ${late}.`);

        // A fork with more rows after it than are read names no files as if they were all it edited.
        yield* startFrom({ agentId: source.id, messageId: ids[10] ?? "" });
        assert.match(
          openedParts(eve).parts.replay?.preamble ?? "",
          /Which files it edited after that message could not all be read/u,
        );

        // A fork with exactly as many rows after it as are read still names what they edited, here nothing.
        yield* startFrom({
          agentId: source.id,
          messageId: ids[turns - 1 - REPLAY_BOUNDS.MAX_ROWS] ?? "",
        });
        assert.match(
          openedParts(eve).parts.replay?.preamble ?? "",
          /Its file tools edited no file after that message/u,
        );

        // A row past the cut that does not read refuses a continue, but not a fork that needs none of it.
        yield* transcriptRow(stored, turns + 2, MESSAGE_ROLE.ASSISTANT, [{ type: "text" }]);
        assert.deepEqual(
          yield* ask(
            startAs(owner, task.id, { idempotencyKey: randomUUID(), from: { agentId: source.id } }),
          ),
          refusal(HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE, HOSTED_API_ERROR.UNAVAILABLE),
        );
        const fork = yield* startFrom({ agentId: source.id, messageId: ids[late] ?? "" });
        assert.equal(fork.from?.steps, openedParts(eve).parts.replay?.steps.length);
        assert.equal(openedParts(eve).parts.replay?.steps.at(-1)?.summary, `Said: Step ${late}.`);
        assert.match(
          openedParts(eve).parts.replay?.preamble ?? "",
          /Which files it edited after that message could not all be read/u,
        );
      }),
  );

  /** A source on the small-window model with a transcript of thirty long turns after its brief. */
  const longSource = (options: { readonly summaryModel?: SummaryModelOf } = {}) =>
    Effect.gen(function* () {
      const opened = yield* openTask(options);
      const first = readAnswer(
        codingAgentAnswerSchema,
        HOSTED_HTTP_STATUS.CREATED,
        yield* opened.ask(
          startAs(opened.owner, opened.task.id, {
            idempotencyKey: randomUUID(),
            model: SMALL_WINDOW.model,
            effort: "high",
          }),
        ),
      ).agent;
      const stored = Option.getOrThrow(yield* readCodingAgent(opened.owner, first.id));
      yield* transcriptRow(stored, 1, MESSAGE_ROLE.USER, [text(SNAPSHOT)]);
      for (let turn = 0; turn < LONG_TURNS; turn += 1) {
        yield* transcriptRow(stored, turn + 2, MESSAGE_ROLE.ASSISTANT, [
          text(`Step ${turn}. ${"x".repeat(5_000)}`),
        ]);
      }
      const continueFrom = (
        agentId: string,
        body: Readonly<Record<string, WireBoundaryInput>> = {},
      ) =>
        Effect.map(
          opened.ask(
            startAs(opened.owner, opened.task.id, {
              idempotencyKey: randomUUID(),
              from: { agentId },
              ...body,
            }),
          ),
          (answered) =>
            readAnswer(codingAgentAnswerSchema, HOSTED_HTTP_STATUS.CREATED, answered).agent,
        );
      return { ...opened, first, stored, continueFrom };
    });

  it.effect(
    "a source whose transcript fits the new agent's window replays whole, every tool call's input and result in full",
    () =>
      Effect.gen(function* () {
        const { owner, task, ask, eve, stored, source } = yield* sourceAgent;
        // A result that reads like a failure and a subject that reads like a running call are neither.
        const output = `Failed: nothing, this is what it printed\n${"line of output\n".repeat(400)}the end`;
        yield* transcriptRow(stored, 6, MESSAGE_ROLE.ASSISTANT, [
          {
            type: "tool-bash",
            toolCallId: "call-2",
            state: "output-available",
            input: { command: `pnpm test ${"--flag ".repeat(200)}(running)` },
            output,
          },
        ]);

        const started = readAnswer(
          codingAgentAnswerSchema,
          HOSTED_HTTP_STATUS.CREATED,
          yield* ask(
            startAs(owner, task.id, { idempotencyKey: randomUUID(), from: { agentId: source.id } }),
          ),
        ).agent;
        const steps = openedParts(eve).parts.replay?.steps ?? [];

        assert.deepEqual(started.from, { agentId: source.id, steps: 6, totalSteps: 6 });
        assert.ok(steps.at(-1)?.words.endsWith(`Result: ${output}`));
        assert.ok(steps.at(-1)?.words.includes("--flag ".repeat(200)));
        assert.deepEqual(
          [steps.at(-1)?.state, steps.at(-1)?.output, steps.at(-1)?.input],
          [
            REPLAY_TOOL_STATE.DONE,
            output,
            JSON.stringify({ command: `pnpm test ${"--flag ".repeat(200)}(running)` }),
          ],
        );
        assert.deepEqual(steps[0]?.sender, { kind: REPLAY_SENDER.DEVELOPER });
      }),
  );

  it.effect(
    "a smaller window keeps the newest steps that fit it and says how many were left out, where a larger one replays the same transcript whole",
    () =>
      Effect.gen(function* () {
        const { eve, first, continueFrom } = yield* longSource();

        const small = yield* continueFrom(first.id);
        const kept = openedParts(eve).parts.replay;
        assert.equal(small.from?.totalSteps, LONG_TURNS);
        assert.ok(
          (small.from?.steps ?? LONG_TURNS) < LONG_TURNS,
          "the oldest steps went past the bound",
        );
        assert.ok((small.from?.steps ?? 0) > 0);
        assert.equal(kept?.steps.length, small.from?.steps);
        assert.match(kept?.steps.at(-1)?.summary ?? "", /^Said: Step 29\./u);
        assert.ok(stepsBytes(kept?.steps ?? []) < SMALL_WINDOW.tokens * 4);
        assert.match(
          kept?.preamble ?? "",
          new RegExp(
            `The oldest ${LONG_TURNS - (small.from?.steps ?? 0)} of its ${LONG_TURNS} steps are left out`,
            "u",
          ),
        );
        assert.equal(kept?.summary, undefined);

        const large = yield* continueFrom(first.id, { model: SOL, effort: "low" });
        assert.deepEqual(large.from, {
          agentId: first.id,
          steps: LONG_TURNS,
          totalSteps: LONG_TURNS,
        });
      }),
  );

  it.effect(
    "the steps a window cannot keep are summarized on the new agent's model at its lowest effort, the summary ahead of the newest steps and counted within the bound",
    () =>
      Effect.gen(function* () {
        const asked: { prompt: string; options: string }[] = [];
        const efforts: string[] = [];
        const model = new MockLanguageModelV4({
          doGenerate: async (options) => {
            asked.push({
              prompt: JSON.stringify(options.prompt),
              options: JSON.stringify(options.providerOptions),
            });
            return {
              content: [{ type: "text", text: "Recap: the developer asked for step after step." }],
              finishReason: { unified: "stop", raw: "stop" },
              usage: {
                inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
                outputTokens: { total: 1, text: 1, reasoning: 0 },
              },
              warnings: [],
            };
          },
        });
        const summaryModel: SummaryModelOf = (_, __, effort) => {
          efforts.push(effort);
          return Effect.succeed({ model, providerOptions: {}, counted: Effect.void });
        };
        const { eve, first, continueFrom } = yield* longSource({ summaryModel });
        const unsummarized = yield* longSource();
        yield* unsummarized.continueFrom(unsummarized.first.id);
        const alone = openedParts(unsummarized.eve).parts.replay?.steps.length ?? 0;

        const started = yield* continueFrom(first.id);
        const replay = openedParts(eve).parts.replay;

        assert.deepEqual(efforts, ["low"]);
        assert.deepEqual(replay?.summary, {
          text: "Recap: the developer asked for step after step.",
          steps: LONG_TURNS - (started.from?.steps ?? 0),
        });
        assert.ok(
          (started.from?.steps ?? 0) < alone,
          "the summary's room came out of the steps kept",
        );
        assert.match(replay?.steps.at(-1)?.summary ?? "", /^Said: Step 29\./u);
        assert.match(replay?.preamble ?? "", /written by Luke rather than by that agent/u);
        assert.match(asked[0]?.prompt ?? "", /Step 0\./u);
        assert.ok(
          asked.every((call) => !/Step 29\./u.test(call.prompt)),
          "a step kept is not summarized",
        );
      }),
  );

  it.effect(
    "a continue of a continue keeps the summary its source carried ahead of that source's steps, where the new window holds them",
    () =>
      Effect.gen(function* () {
        const model = new MockLanguageModelV4({
          doGenerate: async () => ({
            content: [{ type: "text", text: "Recap of the oldest steps." }],
            finishReason: { unified: "stop", raw: "stop" },
            usage: {
              inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
              outputTokens: { total: 1, text: 1, reasoning: 0 },
            },
            warnings: [],
          }),
        });
        const summaryModel: SummaryModelOf = () =>
          Effect.succeed({ model, providerOptions: {}, counted: Effect.void });
        const { owner, eve, first, continueFrom } = yield* longSource({ summaryModel });
        const second = yield* continueFrom(first.id);
        const carried = openedParts(eve).parts.replay;
        assert.ok(carried?.summary !== undefined);

        const secondStored = Option.getOrThrow(yield* readCodingAgent(owner, second.id));
        yield* transcriptRow(secondStored, 1, MESSAGE_ROLE.USER, [
          text(secondStored.planSnapshot ?? ""),
        ]);
        yield* continueFrom(second.id, { model: SOL, effort: "low" });
        const third = openedParts(eve).parts.replay;

        assert.deepEqual(third?.summary, carried.summary);
        assert.deepEqual(
          third?.steps.map((step) => step.summary),
          carried.steps.map((step) => step.summary),
        );
        assert.equal(third?.totalSteps, LONG_TURNS);
      }),
  );

  it.effect(
    "the files a Start's note carries are counted against the window before the steps are chosen",
    () =>
      Effect.gen(function* () {
        const { eve, first, continueFrom } = yield* longSource();
        yield* continueFrom(first.id, { note: "Look at this." });
        const without = openedParts(eve).parts.replay?.steps.length ?? 0;

        const notes = {
          name: "notes.txt",
          mediaType: CODING_AGENT_ATTACHMENT_TYPE.TEXT,
          data: Buffer.from("y".repeat(40_000), "utf8").toString("base64"),
        };
        const started = yield* continueFrom(first.id, {
          note: "Look at this.",
          attachments: [notes],
        });

        assert.ok((started.from?.steps ?? without) < without, "the file took room the steps had");
      }),
  );

  it.effect(
    "a continue of an agent that never ran a turn is sent to the branch and pull request of the agent that one took up, not the default branch, unless that branch is in a repository the task moved from",
    () =>
      Effect.gen(function* () {
        // GitHub holds the source's pull request open, as its row says, when the first continue reads it again.
        const { owner, task, ask, eve, source } = yield* sourceAgentOn(publishedPullRequest);
        const continueFrom = (agentId: string) =>
          Effect.map(
            ask(startAs(owner, task.id, { idempotencyKey: randomUUID(), from: { agentId } })),
            (answered) =>
              readAnswer(codingAgentAnswerSchema, HOSTED_HTTP_STATUS.CREATED, answered).agent,
          );
        // The middle agent's session never ran a turn: it has no rows, no branch, and no sandbox.
        const never = yield* continueFrom(source.id);
        yield* continueFrom(never.id);
        const preamble = openedParts(eve).parts.replay?.preamble ?? "";

        assert.match(
          preamble,
          /It never made a branch of its own: it took up the work of the coding agent/u,
        );
        assert.ok(preamble.includes(`(agent id ${source.id})`));
        assert.ok(preamble.includes(`git switch '${PUBLISHED.branch}'`));
        assert.ok(preamble.includes(`/pull/${PUBLISHED.number}`));
        assert.doesNotMatch(preamble, /start from the repository's default branch/u);

        // A branch left in a repository the task has since moved from is none the new checkout holds.
        yield* Database.use((db) =>
          db
            .update(codingAgent)
            .set({ repository: "Acme/Former" })
            .where(eq(codingAgent.id, source.id)),
        );
        yield* continueFrom(never.id);
        const moved = openedParts(eve).parts.replay?.preamble ?? "";
        assert.match(moved, /start from the repository's default branch/u);
        assert.ok(!moved.includes(PUBLISHED.branch));
      }),
  );

  it.effect(
    "a source eve compacted replays verbatim no more than the context it last measured, where the same source uncompacted replays whole",
    () =>
      Effect.gen(function* () {
        const { owner, eve, first, continueFrom } = yield* longSource();
        const stepAt = (inputTokens: number, at: number) =>
          recordCodingAgentStep(owner, first.id, {
            inputTokens,
            outputTokens: 500,
            systemPromptTokens: 2_000,
            toolDefinitionTokens: 1_000,
            briefTokens: 100,
            at,
          });
        // Its thirty steps of about five thousand bytes each, as its model last read them whole.
        yield* stepAt(LONG_TURNS * 2_600, 1_000);
        const whole = yield* continueFrom(first.id, { model: SOL, effort: "low" });
        assert.equal(whole.from?.steps, LONG_TURNS, "a source that never compacted replays whole");

        // eve folded all but the newest into a summary, and the next step read far less.
        const measured = 6_000;
        yield* recordCodingAgentCompaction(owner, first.id, new Date(2_000));
        yield* stepAt(measured, 3_000);
        const bounded = yield* continueFrom(first.id, { model: SOL, effort: "low" });
        const replay = openedParts(eve).parts.replay;

        assert.equal(bounded.from?.totalSteps, LONG_TURNS);
        assert.ok((bounded.from?.steps ?? LONG_TURNS) < LONG_TURNS);
        assert.ok(stepsBytes(replay?.steps ?? []) <= measured * 2);
        assert.match(replay?.steps.at(-1)?.summary ?? "", /^Said: Step 29\./u);
      }),
  );

  it.effect(
    "a continue of a continue carries the first source's kept steps ahead of its own within the new agent's window",
    () =>
      Effect.gen(function* () {
        const { owner, eve, first, continueFrom } = yield* longSource();
        const second = yield* continueFrom(first.id);
        const secondSteps = openedParts(eve).parts.replay?.steps ?? [];

        const secondStored = Option.getOrThrow(yield* readCodingAgent(owner, second.id));
        yield* transcriptRow(secondStored, 1, MESSAGE_ROLE.USER, [
          text(secondStored.planSnapshot ?? ""),
        ]);
        yield* transcriptRow(secondStored, 2, MESSAGE_ROLE.ASSISTANT, [
          text(`Picked it up. ${"y".repeat(5_000)}`),
        ]);
        const third = yield* continueFrom(second.id);
        const thirdSteps = openedParts(eve).parts.replay?.steps ?? [];

        assert.equal(third.from?.totalSteps, LONG_TURNS + 1);
        assert.equal(third.from?.steps, thirdSteps.length);
        assert.match(thirdSteps.at(-1)?.summary ?? "", /^Said: Picked it up\./u);
        assert.match(thirdSteps.at(-2)?.summary ?? "", /^Said: Step 29\./u);
        assert.notEqual(
          thirdSteps[0]?.summary,
          secondSteps[0]?.summary,
          "the chain's oldest kept step went to make room for the new one",
        );
      }),
  );
});

/** Turns the Chat experiment on or off for the account, as Settings › Experimental does. */
const chooseChat = (userId: string, on: boolean) =>
  writeAccountPreferences(userId, { experiments: { [EXPERIMENT.CHAT]: on } });

it.layer(getTestDB())("a person's chat from the window", (it) => {
  /**
   * The owner's plan with one agent on it, its session claimed so a notice
   * reaches it, its chat member, the plan's channel, and the chat's writes
   * and reads as the bearer given makes them.
   */
  const openWindowChat = (eve = fakeEve()) =>
    Effect.gen(function* () {
      const opened = yield* openTask({ eve });
      yield* chooseChat(opened.owner, true);
      const workspace = opened.task.workspaceId;
      const started = yield* startedAgent(opened.owner, opened.task.id, opened.ask);
      const sessionId = eve.opened[0]?.sessionId ?? "";
      assert.equal(
        yield* claimRuntimeSession(started.target, sessionId, yield* DateTime.nowAsDate),
        true,
      );
      const agent = Option.getOrThrow(
        yield* ensureMember(opened.owner, workspace, {
          kind: MEMBER_KIND.AGENT,
          agentId: started.agent.id,
        }),
      );
      const channel = Option.getOrThrow(yield* ensureTaskChannel(opened.owner, opened.task.id));
      const at = (bearer: string | undefined, method: string, body?: WireBoundaryInput) => {
        const url = new URL(CHAT, ORIGIN);
        url.searchParams.set("workspaceId", workspace);
        return new Request(url, {
          method,
          headers: bearer === undefined ? {} : { authorization: `Bearer ${bearer}` },
          ...(body === undefined ? undefined : { body: JSON.stringify(body) }),
        });
      };
      /** A write as the bearer makes it, the owner's where unsaid. */
      const write = (body: WireBoundaryInput, bearer: string | undefined = opened.owner) =>
        opened.ask(at(bearer, "POST", body));
      /** A write read as the wire declares its answer. */
      const wrote = (body: WireBoundaryInput, bearer: string = opened.owner) =>
        Effect.map(write(body, bearer), (answered) =>
          readAnswer(chatWriteAnswerSchema, HOSTED_HTTP_STATUS.OK, answered),
        );
      /** The chat as the owner reads it from the start. */
      const read = Effect.map(opened.ask(at(opened.owner, "GET")), (answered) =>
        readAnswer(chatAnswerSchema, HOSTED_HTTP_STATUS.OK, answered),
      );
      /** An ask the agent posts in the plan's channel under the key, as its tool will post one. */
      const agentAsks = (text: string) =>
        Effect.map(
          postAsk(opened.owner, workspace, {
            authorMemberId: agent.id,
            to: { channelId: channel.id },
            blocks: [{ type: CHAT_BLOCK.MARKDOWN, text }],
            mentions: [],
            clientKey: randomUUID(),
            key: "invite-expiry",
            ask: { response: { type: CHAT_ASK.APPROVAL } },
          }),
          Result.getOrThrow,
        );
      return {
        ...opened,
        ...started,
        workspace,
        sessionId,
        agent,
        channel,
        write,
        wrote,
        read,
        agentAsks,
      };
    });

  it.effect(
    "a person's DM to an agent steers it once as a chat line, the receipt naming it told, and the post repeated under its key steers nothing more",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const chat = yield* openWindowChat(eve);
        const send = {
          text: "Rename the helper, @nobody.",
          to: "@agent-1",
          clientKey: randomUUID(),
        };

        const sent = yield* chat.wrote(send);
        assert.ok("posted" in sent);
        assert.deepEqual(sent.receipt, {
          told: ["agent-1"],
          held: [],
          left: [],
          unresolved: ["nobody"],
        });
        assert.deepEqual(
          eve.sent.map((each) => [each.authorization, each.sessionId]),
          [[`Bearer ${chat.owner}`, chat.sessionId]],
        );
        const page = yield* listMessagesPast(
          chat.target.userId,
          chat.target.conversationId,
          CODER_TOOL_SET,
          CURSOR_START,
          50,
        );
        const notices = (page.read.ok ? page.read.value : []).flatMap(({ message }) =>
          message.role === MESSAGE_ROLE.USER &&
          message.metadata !== undefined &&
          "channel" in message.metadata &&
          message.metadata.channel === MESSAGE_CHANNEL.CHAT
            ? [message.metadata]
            : [],
        );
        assert.deepEqual(notices, [
          {
            author: MESSAGE_AUTHOR.HUMAN,
            channel: MESSAGE_CHANNEL.CHAT,
            chat_seq: sent.posted.seq,
            from: "test-user",
          },
        ]);

        const again = yield* chat.wrote(send);
        assert.ok("posted" in again);
        assert.equal(again.posted.id, sent.posted.id);
        // Told again, the repeat finds the first notice still outstanding and steers nothing more.
        assert.deepEqual(again.receipt, { told: [], held: ["agent-1"], left: [], unresolved: [] });
        assert.equal(eve.sent.length, 1);
        // A teammate's DM reaches the agent as the member who started it, whoever posts,
        // once the teammate has turned Chat on: until then their write is to no workspace.
        yield* joinWorkspace(chat.workspace, chat.other);
        yield* unreadFor(chat.owner, chat.workspace, chat.agent.id);
        const chatOff = { text: "Before Chat.", to: "@agent-1", clientKey: randomUUID() };
        assert.deepEqual(
          yield* chat.write(chatOff, chat.other),
          refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND),
        );
        yield* chooseChat(chat.other, true);
        const fromTeammate = yield* chat.wrote(
          { text: "Use the new table.", to: "@agent-1", clientKey: randomUUID() },
          chat.other,
        );
        assert.ok("posted" in fromTeammate);
        assert.deepEqual(fromTeammate.receipt.told, ["agent-1"]);
        assert.deepEqual(
          eve.sent.map((each) => each.authorization),
          [`Bearer ${chat.owner}`, `Bearer ${chat.owner}`],
        );
        // A plain post in a channel tells nobody.
        const plain = yield* chat.wrote({ text: "Morning, all.", clientKey: randomUUID() });
        assert.ok("posted" in plain);
        assert.deepEqual(plain.receipt.told, []);
        assert.equal(eve.sent.length, 2);
      }),
  );

  it.effect(
    "a member's answer to an ask is counted as their reply in the thread, once however often it is sent again under its key",
    () =>
      Effect.gen(function* () {
        const chat = yield* openWindowChat(fakeEve());
        const asked = yield* chat.agentAsks("Ship with seven-day invites?");
        const before = countedFor(chat.owner, SERVER_EVENT.CHAT_MESSAGE_SEND);
        const answer = {
          answer: { seq: asked.message.seq, revision: 1, reply: { reply: CHAT_REPLY.APPROVED } },
          clientKey: randomUUID(),
        };

        const taken = yield* chat.wrote(answer);
        assert.ok("ask" in taken);
        assert.equal(taken.taken, true);
        const again = yield* chat.wrote(answer);
        assert.ok("ask" in again);
        assert.equal(again.taken, true);
        assert.equal(countedFor(chat.owner, SERVER_EVENT.CHAT_MESSAGE_SEND), before + 1);
        assert.deepEqual(
          ANALYTICS.recorded.findLast(
            (event) => event.userId === chat.owner && event.name === SERVER_EVENT.CHAT_MESSAGE_SEND,
          )?.properties,
          { is_reply: true },
        );
      }),
  );

  it.effect(
    "an answer at a revision the agent moved past is not taken and tells nothing; one at the revision drawn is taken as the person's reply in the thread, which steers the agent",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const chat = yield* openWindowChat(eve);
        const first = yield* chat.agentAsks("Ship with seven-day invites?");
        yield* chat.agentAsks("Ship with fourteen-day invites?");
        const answer = (revision: number, reply: WireBoundaryInput) => ({
          answer: { seq: first.message.seq, revision, reply },
          clientKey: randomUUID(),
        });

        const stale = yield* chat.wrote(answer(1, { reply: CHAT_REPLY.APPROVED }));
        assert.ok("ask" in stale);
        assert.deepEqual(
          [stale.taken, stale.ask.ask?.revision, stale.ask.ask?.status],
          [false, 2, ASK_STATUS.OPEN],
        );
        assert.equal(eve.sent.length, 0);
        // An answer drawn from an earlier revision is not taken, whatever that revision asked.
        const earlier = yield* chat.wrote(
          answer(1, { reply: CHAT_REPLY.ANSWERED, note: "Later." }),
        );
        assert.ok("ask" in earlier);
        assert.equal(earlier.taken, false);
        assert.deepEqual(
          yield* chat.write(answer(2, { reply: CHAT_REPLY.CHOSE, choices: ["Yes"] })),
          refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST),
        );

        const taken = yield* chat.wrote(answer(2, { reply: CHAT_REPLY.APPROVED }));
        assert.ok("ask" in taken);
        assert.deepEqual([taken.taken, taken.ask.ask?.status], [true, ASK_STATUS.ANSWERED]);
        assert.deepEqual(
          eve.sent.map((each) => each.sessionId),
          [chat.sessionId],
        );
        const replies = (yield* chat.read).messages.filter(
          (message) => message.parentId === first.message.id,
        );
        assert.equal(replies.length, 1);
      }),
  );

  it.effect(
    "a read moves the person's cursor on, never back, and the chat's read answers it; a resolve of an ask not the person's, a write to a workspace the account is not in, and a write that is none are refused",
    () =>
      Effect.gen(function* () {
        const chat = yield* openWindowChat();
        const asked = yield* chat.agentAsks("Ship it?");

        assert.deepEqual(yield* chat.wrote({ readTo: asked.message.seq }), {
          readSeq: asked.message.seq,
        });
        assert.deepEqual(yield* chat.wrote({ readTo: 0 }), { readSeq: asked.message.seq });
        assert.equal((yield* chat.read).readSeq, asked.message.seq);

        const notFound = refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND);
        assert.deepEqual(
          yield* chat.write({ resolve: { seq: asked.message.seq, reason: "Not mine." } }),
          notFound,
        );
        assert.deepEqual(yield* chat.write({ readTo: 1 }, chat.other), notFound);
        assert.deepEqual(
          yield* chat.write({ text: "To no one.", to: "#nowhere", clientKey: randomUUID() }),
          notFound,
        );
        assert.deepEqual(
          yield* chat.write({ text: "Two ways.", blocks: [], clientKey: randomUUID() }),
          refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST),
        );
        assert.deepEqual(
          yield* chat.write({ readTo: 1 }, "no-such-bearer"),
          refusal(HOSTED_HTTP_STATUS.UNAUTHORIZED, HOSTED_API_ERROR.INVALID_TOKEN),
        );
      }),
  );

  it.effect(
    "a read naming the channel shown moves that channel's own cursor alone, which the write's answer and the chat's read both carry, and a channel the person may not see is refused",
    () =>
      Effect.gen(function* () {
        const chat = yield* openWindowChat();
        // The window's read moves its cursor to the head, so the ask comes after it.
        const floor = (yield* chat.read).readSeq;
        const asked = yield* chat.agentAsks("Ship it?");
        const { channelId, seq } = asked.message;

        assert.deepEqual(yield* chat.wrote({ readTo: seq, channelId }), {
          readSeq: floor,
          reads: [{ channelId, readSeq: seq }],
        });
        const read = yield* chat.read;
        assert.equal(read.readSeq, floor, "the cursor everywhere stays where it was");
        assert.deepEqual(read.reads, [{ channelId, readSeq: seq }]);

        // Every channel read past it leaves no channel's own cursor ahead to say.
        assert.deepEqual(yield* chat.wrote({ readTo: seq }), { readSeq: seq });
        assert.equal((yield* chat.read).reads, undefined);

        assert.deepEqual(
          yield* chat.write({ readTo: seq, channelId: randomUUID() }),
          refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND),
        );
      }),
  );

  it.effect(
    "a write naming the member it acts as is refused and writes nothing, since the window always acts as the caller's own person",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const chat = yield* openWindowChat(eve);
        const asked = yield* chat.agentAsks("Ship it?");
        const invalid = refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);
        const before = (yield* chat.read).messages.length;

        for (const spoofed of [
          { text: "As the agent.", clientKey: randomUUID(), authorMemberId: chat.agent.id },
          { text: "As the agent.", clientKey: randomUUID(), as: chat.agent.id },
          {
            answer: {
              seq: asked.message.seq,
              revision: 1,
              reply: { reply: CHAT_REPLY.APPROVED },
              answererMemberId: chat.agent.id,
            },
            clientKey: randomUUID(),
          },
          {
            answer: { seq: asked.message.seq, revision: 1, reply: { reply: CHAT_REPLY.APPROVED } },
            clientKey: randomUUID(),
            answererMemberId: chat.agent.id,
          },
          { readTo: asked.message.seq, memberId: chat.agent.id },
        ]) {
          assert.deepEqual(yield* chat.write(spoofed), invalid, JSON.stringify(spoofed));
        }
        assert.equal((yield* chat.read).messages.length, before);
        assert.equal(eve.sent.length, 0);

        // The same post with no member named is the caller's own.
        const own = yield* chat.wrote({ text: "Mine.", clientKey: randomUUID() });
        assert.ok("posted" in own);
        const self = (yield* chat.read).self;
        assert.equal(own.posted.authorId, self);
        assert.notEqual(own.posted.authorId, chat.agent.id);
      }),
  );
});
