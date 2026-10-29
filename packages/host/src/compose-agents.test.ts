import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import type { AccountInboxEntry } from "@luke/features/account-inbox-wire";
import { AGENT_CALL_FAILURE, ARCHIVE_DRAWN, TRANSCRIPT_KIND } from "@luke/features/agent-view";
import {
  AGENT_BOUNDS,
  AGENT_CURSOR_START,
  AGENT_STATUS,
  type AgentNewestAnswer,
  type AgentPage,
  type AgentSummary,
  CHANGED_FILE_STATUS,
  CHECK_SUMMARY,
  MERGE_STATE,
  PULL_REQUEST_STATE,
} from "@luke/features/agent-wire";
import { CHAPTERS_MODEL } from "@luke/features/chapters-model-choice";
import { GITHUB_IMAGE_TYPE } from "@luke/features/github-image";
import { GITHUB_TOKEN_REJECTION } from "@luke/features/github-token-wire";
import {
  INBOX_IMAGE_TYPE,
  INBOX_MESSAGE_AUTHOR,
  INBOX_REPLY,
  INBOX_STATUS,
  INBOX_WIRE_VERSION,
  type InboxItem,
} from "@luke/features/inbox-wire";
import { INTEGRATION_PROVIDER } from "@luke/features/integration-wire";
import {
  FAILED_RUN_WINDOW_MILLIS,
  LIVE_SIGNED_OUT,
  type SealedLiveQueryWire,
  type TranscriptNowAnswer,
} from "@luke/features/live-wire";
import type { MemorySummary } from "@luke/features/memory-wire";
import { MODEL_PROVIDER } from "@luke/features/models-wire";
import {
  PROVIDER_KEY_PROVIDER,
  PROVIDER_KEY_STATUS,
  type ProviderKeySummary,
} from "@luke/features/provider-key-wire";
import { PULL_REQUEST_CHAPTERS_STATE } from "@luke/features/pull-request-chapters-wire";
import {
  PULL_REQUEST_ACTION,
  PULL_REQUEST_WRITE_OUTCOME,
} from "@luke/features/pull-request-write-wire";
import {
  GATEWAY_CLIENT_ROLE,
  GATEWAY_EVENT,
  GATEWAY_METHOD,
  type GatewayEventKind,
  type GatewayMethod,
} from "@luke/gateway";
import { isRecord, type WireRecord, type WireValue } from "@luke/wire";
import { noNetwork } from "@luke/wire/testing";
import { Deferred, Duration, Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";
import { type AgentClient, composeAgents } from "./compose-agents.js";
import type { RowWrite } from "./live-collection.js";
import { type AgentRow, taskListCollections } from "./task-list-collections.js";
import { type PolledLive, polledLive } from "./testing/polled-live.js";
import { agentListRow } from "./testing/task-list-rows.js";
import { HELD_TRANSCRIPTS } from "./transcript-held.js";

const TASK_ID = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
const AGENT_ID = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";
const WORKSPACE_ID = "2a9c4e6f-1b3d-4f5a-8c7e-9d0b1a2c3e4f";

const AGENT: AgentSummary = {
  id: AGENT_ID,
  planId: TASK_ID,
  model: "anthropic/claude-opus-5.5",
  effort: "high",
  title: null,
  createdAt: 1_800_000_000_000,
  status: AGENT_STATUS.RUNNING,
  turnId: "9d2b7b5a-4e3f-4e9c-9c77-7a5d8b3f4c32",
};

/** The agent as its own page reads it, with no task, as an automation's run leaves one. */
const PAGE: AgentPage = {
  ...AGENT,
  planId: null,
  automationId: "5a0c4d2e-8f1b-4c3a-9e7d-2b6f1a8c9d04",
  workspaceId: "workspace-1",
  repository: "acme/relay",
};

const MODELS = [
  {
    id: AGENT.model,
    name: "Claude Opus 5.5",
    provider: MODEL_PROVIDER.ANTHROPIC,
    efforts: ["low", "high"],
  },
];

/** What the agent published, as the service answers it. */
const PUBLISHED = {
  repository: "acme/relay",
  branch: "luke/teammate-invitations",
  pullRequest: {
    number: 123,
    title: "Teammate invitations",
    url: "https://github.com/acme/relay/pull/123",
    state: PULL_REQUEST_STATE.OPEN,
    checks: CHECK_SUMMARY.PASSING,
    additions: 210,
    deletions: 14,
    changedFiles: 6,
  },
};

/** The agent's changes, as the service answers them. */
/** A pull request's chapters as the service answers them: none made yet for its head. */
const CHAPTERS = {
  pullRequest: {
    number: 11,
    headSha: "c0ffee1",
    generatable: true,
    chapters: { status: PULL_REQUEST_CHAPTERS_STATE.NONE },
  },
} as const;

const CHANGES = {
  pullRequest: {
    url: "https://github.com/acme/relay/pull/123",
    files: [
      {
        path: "src/invite.ts",
        previousPath: null,
        status: CHANGED_FILE_STATUS.MODIFIED,
        additions: 1,
        deletions: 1,
        patch: "@@ -1 +1 @@\n-old\n+new",
        omitted: null,
      },
    ],
    truncated: false,
  },
};

/** That pull request itself, its checks, and its conversation, as its Pull request tab's overview reads them. */
/** What the reviewer and label pickers offer, as the service answers it. */
const REVIEW_OPTIONS = {
  labels: [{ name: "bug", color: "d73a4a" }],
  users: [{ login: "priyan", bot: false }],
  teams: [{ slug: "reviewers", name: "Reviewers" }],
};

const OVERVIEW = {
  pullRequest: {
    pullRequest: {
      number: 123,
      title: "Send the invite once",
      url: "https://github.com/acme/relay/pull/123",
      state: PULL_REQUEST_STATE.OPEN,
      html: "<p>Sends the invite once.</p>",
      base: "main",
      head: "luke/invite-once",
      createdAt: 1_800_000_000_000,
      mergedAt: null,
      merge: MERGE_STATE.CLEAN,
      requested: [],
    },
  },
  checks: { pullRequest: { checks: [] } },
  conversation: { pullRequest: { reviewers: [], conversation: [], earlier: 0 } },
} as const;

/** A synthetic key, as Settings carries it once; nothing below may answer it back. */
const PROVIDER_KEY = "sk-ant-api03-synthetic-0000000000000000wxyz";
const GITHUB_TOKEN = "synthetic-classic-token-0000000000wxyz";

/** What the service answers of a kept key: never the key. */
const MEMORY: MemorySummary = {
  id: "8a1f2c3d-4e5f-4a6b-9c7d-8e9f0a1b2c3d",
  text: "Deployments go out from the release branch.",
  keptBy: { userId: "user-1", name: "Dean" },
  forgettable: true,
  private: false,
  createdAt: 1,
  updatedAt: 2,
};

const KEPT: ProviderKeySummary = {
  provider: PROVIDER_KEY_PROVIDER.ANTHROPIC,
  hint: "sk-ant-…wxyz",
  addedAt: 1,
  status: PROVIDER_KEY_STATUS.VERIFIED,
  statusAt: 1,
};

const ATTACHMENT_ID = "9b8a7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const PICTURE_ID = "4fb17055-c16e-4293-bea5-7a8b9cadbec5";
const MESSAGE_ID = "5ac28166-d27f-4304-8cb6-8b9cadbecdf6";

const ITEM: InboxItem = {
  id: "5e2d7c3a-1b4f-4e6a-8c9d-0f1e2d3c4b5a",
  agentId: AGENT_ID,
  key: "push-access",
  revision: 2,
  version: INBOX_WIRE_VERSION,
  title: "Push to the release branch?",
  needsReply: true,
  status: INBOX_STATUS.OPEN,
  postedAt: 1_800_000_000_000,
  updatedAt: 1_800_000_060_000,
};

/** That item as what waits across the account carries it. */
const WAITING: AccountInboxEntry = {
  id: ITEM.id,
  planId: TASK_ID,
  agentId: AGENT_ID,
  agentTitle: null,
  agentModel: AGENT.model,
  title: ITEM.title,
  revision: ITEM.revision,
  postedAt: ITEM.postedAt,
  updatedAt: ITEM.updatedAt,
};

const context = { client: { clientId: "desktop", role: GATEWAY_CLIENT_ROLE.OPERATOR } };

/** A page with something on it, as the service answers a transcript read unless a test scripts another. */
const SAID = {
  messages: [
    { id: "m-1", role: "assistant" as const, parts: [{ type: "text" as const, text: "Hi" }] },
  ],
  status: AGENT_STATUS.RUNNING,
  title: null,
};

/** The service as a script, writing down every ask in the order it was made. */
function fakeService() {
  const asked: string[] = [];
  let scope: typeof LIVE_ANSWERED | { readonly failure: "not-found" } | undefined;
  let cursor = AGENT_CURSOR_START;
  let transcript: typeof LIVE_ANSWERED | { readonly failure: "not-found" } | undefined;
  let accountLive: typeof LIVE_ANSWERED | typeof LIVE_SIGNED_OUT | undefined;
  let itemsLive: typeof LIVE_ANSWERED | undefined;
  // Each live read's rows, polled; every followed scope's inbox reads the one script.
  const live = {
    transcript: polledLive(TRANSCRIPT_PARTS),
    scope: polledLive(SCOPE_PARTS),
    account: polledLive(ACCOUNT_PARTS),
    items: polledLive(ITEMS_PARTS),
  };
  // Each page read at once, in turn; the last stands once the others are read.
  let pagesNow: readonly (TranscriptNowAnswer | { readonly failure: "unanswered" })[] = [];
  let pageGate: Effect.Effect<void> = Effect.void;
  // The newest page, as the follow opens with it; none answers one with something on it.
  let newestPage: AgentNewestAnswer | { readonly failure: "unanswered" } | undefined;
  // The transaction a pin answers it committed in, where it answers one.
  let startTxid: string | undefined;
  // The transaction the service says each inbox write committed in; none says it changed nothing.
  let committedIn: { readonly txid?: string } = {};
  /** The item as the agent changed it first, which a close is answered not taken with; none takes every close. */
  let changedFirst: InboxItem | undefined;
  /** The transaction the service says wrote a sent message's row; none says none was written. */
  let sentTxid: string | undefined;
  /** What a rename, an archive, a change of model, or a switch of servers waits on before the service answers it; nothing from the start. */
  let changeGate: Effect.Effect<void> = Effect.void;
  /** A plan's or an agent's inbox as its live read answers it: polled from the one script, or the refusal standing. */
  const scopeLive = (poll: boolean | undefined, after: string | undefined) =>
    Effect.suspend((): ReturnType<AgentClient["taskInboxLive"]> => {
      if (scope === undefined) return Effect.succeed({ failure: AGENT_CALL_FAILURE.UNANSWERED });
      if (typeof scope === "object") return Effect.succeed(scope);
      return poll === true ? live.scope.poll(after) : Effect.succeed(live.scope.first());
    });
  const client: AgentClient = {
    models: () =>
      Effect.sync(() => {
        asked.push("models");
        return { models: MODELS };
      }),
    readDefault: () =>
      Effect.sync(() => {
        asked.push("default");
        return { choice: { model: AGENT.model, effort: AGENT.effort } };
      }),
    writeDefault: (choice) =>
      Effect.sync(() => {
        asked.push(`default:${choice.model}:${choice.effort}`);
        return { choice };
      }),
    hosts: () => Effect.succeed({ failure: "unanswered" }),
    devicePresence: () => Effect.succeed({ failure: "unanswered" }),
    removeHost: () => Effect.succeed({ failure: "unanswered" }),
    keepHostInstallToken: () => Effect.succeed({ failure: "unanswered" }),
    revokeHostInstallToken: () => Effect.succeed({ failure: "unanswered" }),
    list: (taskId, includeArchived) =>
      Effect.sync(() => {
        asked.push(includeArchived === true ? `list:${taskId}:archived` : `list:${taskId}`);
        return { agents: [AGENT] };
      }),
    listWorkspace: ({ workspaceId, repository }) =>
      Effect.sync(() => {
        asked.push(`workspace:${workspaceId}:${repository ?? "any"}`);
        return { agents: [AGENT] };
      }),
    start: (taskId, request) =>
      Effect.sync(() => {
        asked.push(`start:${taskId}:${request.idempotencyKey}:${request.model ?? "default"}`);
        const agent = { ...AGENT, status: AGENT_STATUS.STARTING };
        return startTxid === undefined ? { agent } : { agent, txid: startTxid };
      }),
    startFrom: (request) =>
      Effect.sync(() => {
        asked.push(`start-from:${request.from?.agentId}:${request.idempotencyKey}`);
        return { agent: { ...AGENT, status: AGENT_STATUS.STARTING } };
      }),
    messagesNow: (agentId, after, callId) =>
      Effect.andThen(
        Effect.suspend(() => pageGate),
        Effect.sync(() => {
          asked.push(
            callId === undefined
              ? `messages-now:${agentId}:${after}`
              : `worker-now:${agentId}:${callId}:${after}`,
          );
          const [page, ...rest] = pagesNow;
          if (rest.length > 0) pagesNow = rest;
          cursor = "2:1";
          return page ?? { ...SAID, cursor, holds: false };
        }),
      ),
    messagesNewest: (agentId, callId, cut) =>
      Effect.sync(() => {
        asked.push(
          (callId === undefined
            ? `messages-newest:${agentId}`
            : `worker-newest:${agentId}:${callId}`) + (cut === true ? ":cut" : ""),
        );
        // Note that the service answers an agent the account does not reach not found on every read alike.
        if (typeof transcript === "object") return transcript;
        return newestPage ?? { ...SAID, cursor: "1:0" };
      }),
    messagesBefore: (agentId, before, callId, cut) =>
      Effect.sync(() => {
        asked.push(
          (callId === undefined
            ? `messages-before:${agentId}:${before}`
            : `worker-before:${agentId}:${callId}:${before}`) + (cut === true ? ":cut" : ""),
        );
        return { messages: SAID.messages, before: "3" };
      }),
    // Note that a poll is counted apart from the first ask (`live.transcript.polls`), as each is held until the rows move.
    agentTranscriptLive: (agentId, _userId, callId, poll, after) =>
      Effect.suspend((): ReturnType<AgentClient["agentTranscriptLive"]> => {
        if (poll !== true) {
          asked.push(`transcript-live:${agentId}${callId === undefined ? "" : `:${callId}`}`);
        }
        if (transcript === undefined) {
          return Effect.succeed({ failure: AGENT_CALL_FAILURE.UNANSWERED });
        }
        if (typeof transcript === "object") return Effect.succeed(transcript);
        return poll === true
          ? live.transcript.poll(after)
          : Effect.succeed(live.transcript.first());
      }),
    message: (agentId, request) =>
      Effect.sync(() => {
        const files = (request.attachments ?? []).map((file) => file.name).join(",");
        asked.push(
          `message:${agentId}:${request.clientKey}:${request.text}${files === "" ? "" : `:files ${files}`}`,
        );
        return sentTxid === undefined ? { agent: AGENT } : { agent: AGENT, txid: sentTxid };
      }),
    choose: (agentId, choice) =>
      Effect.map(changeGate, () => {
        asked.push(`choose:${agentId}:${choice.model}:${choice.effort}`);
        return { agent: { ...AGENT, ...choice } };
      }),
    rename: (agentId, request) =>
      Effect.map(changeGate, () => {
        asked.push(`rename:${agentId}:${request.title}`);
        return { agent: { ...AGENT, title: request.title } };
      }),
    switchServers: (agentId, request) =>
      Effect.map(changeGate, () => {
        asked.push(`servers:${agentId}:${request.disabledServers.join(",")}`);
        return { agent: { ...AGENT, disabledServers: request.disabledServers } };
      }),
    changeQueue: (agentId, change) =>
      Effect.sync(() => {
        asked.push(`queue:${agentId}:${change.change}`);
        return { queue: { messages: [], revision: 1 } };
      }),
    stop: (agentId) =>
      Effect.sync(() => {
        asked.push(`stop:${agentId}`);
        return { agent: { ...AGENT, status: AGENT_STATUS.CANCELLED } };
      }),
    rewind: (agentId, messageId) =>
      Effect.sync(() => {
        asked.push(`rewind:${agentId}:${messageId}`);
        return { agent: AGENT };
      }),
    delete: (agentId) =>
      Effect.sync(() => {
        asked.push(`delete:${agentId}`);
        return { deleted: true as const, txid: "9102" };
      }),
    archive: (agentId, request) =>
      Effect.map(changeGate, () => {
        asked.push(`archive:${agentId}:${String(request.archived)}`);
        return { agent: { ...AGENT, archivedAt: 1_800_000_120_000 } };
      }),
    pin: (agentId, request) =>
      Effect.sync(() => {
        asked.push(`pin:${agentId}:${String(request.pinned)}`);
        return { agent: AGENT };
      }),
    ensureOperator: (workspaceId, request) =>
      Effect.sync(() => {
        asked.push(`ensureOperator:${workspaceId}:${String(request.reset === true)}`);
        return { agentId: AGENT_ID, txid: "9103" };
      }),
    agent: (agentId) =>
      Effect.sync(() => {
        asked.push(`page:${agentId}`);
        return { agent: PAGE };
      }),
    pullRequest: (agentId) =>
      Effect.sync(() => {
        asked.push(`pull-request:${agentId}`);
        return PUBLISHED;
      }),
    changes: (agentId, number) =>
      Effect.sync(() => {
        asked.push(`changes:${agentId}${number === undefined ? "" : `#${number}`}`);
        return CHANGES;
      }),
    chapters: (agentId, number) =>
      Effect.sync(() => {
        asked.push(`chapters:${agentId}${number === undefined ? "" : `#${number}`}`);
        return CHAPTERS;
      }),
    generateChapters: (agentId, number) =>
      Effect.sync(() => {
        asked.push(`chapters-generate:${agentId}${number === undefined ? "" : `#${number}`}`);
        return CHAPTERS;
      }),
    readChaptersModel: () =>
      Effect.sync(() => {
        asked.push("chapters-model");
        return { model: CHAPTERS_MODEL.HAIKU };
      }),
    writeChaptersModel: (model) =>
      Effect.sync(() => {
        asked.push(`chapters-model-write:${model}`);
        return { model };
      }),
    overviewPullRequest: (agentId) =>
      Effect.sync(() => {
        asked.push(`overview-pull-request:${agentId}`);
        return OVERVIEW.pullRequest;
      }),
    reviewOptions: (agentId) =>
      Effect.sync(() => {
        asked.push(`review-options:${agentId}`);
        return REVIEW_OPTIONS;
      }),
    lukeTools: () => Effect.die("no Luke tools read in this suite"),
    overviewChecks: (agentId) =>
      Effect.sync(() => {
        asked.push(`overview-checks:${agentId}`);
        return OVERVIEW.checks;
      }),
    overviewConversation: (agentId) =>
      Effect.sync(() => {
        asked.push(`overview-conversation:${agentId}`);
        return OVERVIEW.conversation;
      }),
    pullRequestAction: (agentId, request, number) =>
      Effect.sync(() => {
        asked.push(
          `pull-request-action:${agentId}${number === undefined ? "" : `#${number}`}:${request.action}`,
        );
        return { outcome: PULL_REQUEST_WRITE_OUTCOME.DONE };
      }),
    pullRequestViewed: (agentId) =>
      Effect.sync(() => {
        asked.push(`pull-request-viewed:${agentId}`);
        return { outcome: PULL_REQUEST_WRITE_OUTCOME.DONE, files: [] };
      }),
    githubImage: (agentId, src) =>
      Effect.sync(() => {
        asked.push(`github-image:${agentId}:${src}`);
        return { contentType: GITHUB_IMAGE_TYPE.PNG, base64: "iVBORw0KGgo=" };
      }),
    readProviderKeys: () =>
      Effect.sync(() => {
        asked.push("keys");
        return { keys: [KEPT] };
      }),
    saveProviderKey: (save) =>
      Effect.sync(() => {
        asked.push(`save:${save.provider}:${save.key === PROVIDER_KEY ? "the key" : "another"}`);
        return { keys: [KEPT] };
      }),
    removeProviderKey: (removal) =>
      Effect.sync(() => {
        asked.push(`remove:${removal.provider}`);
        return { keys: [] };
      }),
    setProviderKeyForAgents: (change) =>
      Effect.sync(() => {
        asked.push(`forAgents:${change.kind}:${String(change.forAgents)}`);
        return { keys: [] };
      }),
    readGitHubToken: () =>
      Effect.sync(() => {
        asked.push("token");
        return { token: null };
      }),
    saveGitHubToken: (save) =>
      Effect.sync(() => {
        asked.push(`save-token:${save.token === GITHUB_TOKEN ? "the token" : "another"}`);
        return { token: null, rejected: GITHUB_TOKEN_REJECTION.NO_REPO_SCOPE };
      }),
    removeGitHubToken: () =>
      Effect.sync(() => {
        asked.push("remove-token");
        return { token: null };
      }),
    readMemories: (reading) =>
      Effect.sync(() => {
        asked.push(`memories:${reading.workspaceId}`);
        return { memories: [MEMORY] };
      }),
    forgetMemory: (forget) =>
      Effect.sync(() => {
        asked.push(`forget:${forget.workspaceId}:${forget.id}`);
        return { memories: [] };
      }),
    transcribeDictation: (clip) =>
      Effect.sync(() => {
        asked.push(`transcribe:${clip.audio}:${clip.keywords.join(",")}`);
        return { text: "Run the tests" };
      }),
    taskInboxLive: (taskId, _userId, poll, after) => {
      if (poll !== true) asked.push(`plan-inbox-live:${taskId}`);
      return scopeLive(poll, after);
    },
    agentInboxLive: (agentId, _userId, poll, after) => {
      if (poll !== true) asked.push(`agent-inbox-live:${agentId}`);
      return scopeLive(poll, after);
    },
    inboxAttachment: (itemId, attachmentId) =>
      Effect.sync(() => {
        asked.push(`attachment:${itemId}:${attachmentId}`);
        return { contentType: INBOX_IMAGE_TYPE.PNG, base64: "iVBORw0KGgo=" };
      }),
    agentPicture: (agentId, pictureId, callId) =>
      Effect.sync(() => {
        asked.push(`picture:${agentId}:${pictureId}:${callId ?? ""}`);
        return { contentType: INBOX_IMAGE_TYPE.PNG, base64: "iVBORw0KGgo=" };
      }),
    agentPart: (agentId, messageId, index, callId) =>
      Effect.sync(() => {
        asked.push(`part:${agentId}:${messageId}:${index}:${callId ?? ""}`);
        return { part: { type: "reasoning", text: "Whole." } };
      }),
    markInboxItemRead: (itemId) =>
      Effect.sync(() => {
        asked.push(`inbox-read:${itemId}`);
        return { id: itemId, unread: false, ...committedIn };
      }),
    markInboxItemUnread: (itemId) =>
      Effect.sync(() => {
        asked.push(`inbox-unread:${itemId}`);
        return { id: itemId, unread: true, ...committedIn };
      }),
    markInboxRead: (request) =>
      Effect.sync(() => {
        asked.push(`inbox-read-all:${request?.workspaceId ?? ""}`);
        return { marked: 2, ...committedIn };
      }),
    messageInbox: (itemId, request) =>
      Effect.sync(() => {
        const files = (request.attachments ?? []).map((file) => file.name).join(",");
        const answer =
          request.answers === undefined
            ? ""
            : `:answers ${request.answers.ask} ${request.answers.reply} ${(request.answers.choices ?? []).join(",")}`;
        asked.push(
          `inbox-message:${itemId}:${request.text}:${files}:${request.clientKey}${answer}`,
        );
        return {
          item: {
            ...ITEM,
            messages: [
              {
                id: MESSAGE_ID,
                author: INBOX_MESSAGE_AUTHOR.MEMBER,
                text: request.text,
                createdAt: ITEM.updatedAt,
              },
            ],
          },
        };
      }),
    startInboxThread: (request) =>
      Effect.sync(() => {
        asked.push(
          `inbox-start:${request.agentId}:${request.title}:${request.text}:${request.clientKey}`,
        );
        return {
          item: {
            ...ITEM,
            title: request.title ?? ITEM.title,
            messages: [
              {
                id: MESSAGE_ID,
                author: INBOX_MESSAGE_AUTHOR.MEMBER,
                text: request.text,
                createdAt: ITEM.updatedAt,
              },
            ],
          },
        };
      }),
    closeInbox: (itemId, request) =>
      Effect.sync(() => {
        asked.push(`close:${itemId}:${request.revision}:${request.clientKey}`);
        if (changedFirst !== undefined) return { item: changedFirst, taken: false };
        return {
          item: { ...ITEM, status: INBOX_STATUS.CLOSED, closedBy: { userId: "u1", name: "Dana" } },
          taken: true,
          ...committedIn,
        };
      }),
    answerInbox: (itemId, request) =>
      Effect.sync(() => {
        asked.push(`answer:${itemId}:${request.revision}:${request.reply}:${request.clientKey}`);
        return { item: { ...ITEM, revision: 3, status: INBOX_STATUS.ANSWERED }, taken: true };
      }),
    accountInboxLive: (userId, poll, after) =>
      Effect.suspend((): ReturnType<AgentClient["accountInboxLive"]> => {
        if (poll !== true) asked.push(`account-inbox-live:${userId}`);
        if (accountLive === undefined) {
          return Effect.succeed({ failure: AGENT_CALL_FAILURE.UNANSWERED });
        }
        if (typeof accountLive === "object") return Effect.succeed(accountLive);
        return poll === true ? live.account.poll(after) : Effect.succeed(live.account.first());
      }),
    accountInboxItemsLive: (userId, since, poll, after) =>
      Effect.suspend((): ReturnType<AgentClient["accountInboxItemsLive"]> => {
        if (poll !== true) asked.push(`account-items-live:${userId}`);
        if (itemsLive === undefined) {
          return Effect.succeed({ failure: AGENT_CALL_FAILURE.UNANSWERED });
        }
        if (poll !== true) return Effect.succeed(changedSince(live.items.first(), since));
        if (after === undefined) asked.push(`account-items-again:${since}`);
        return Effect.map(live.items.poll(after), (answer) => changedSince(answer, since));
      }),
  };
  return {
    client,
    asked,
    live,
    /** Whether the service answers a transcript's live read, or that the account reaches no such agent; none answers unanswered. */
    sealTranscript: (
      next: typeof LIVE_ANSWERED | { readonly failure: "not-found" } | undefined,
    ) => {
      transcript = next;
    },
    /** The pages the service answers read at once, in turn, or that it did not answer one. */
    pageNow: (...pages: readonly (TranscriptNowAnswer | { readonly failure: "unanswered" })[]) => {
      pagesNow = pages;
    },
    /** What a page read at once waits on before the service answers it; nothing from the start. */
    holdPages: (gate: Effect.Effect<void>) => {
      pageGate = gate;
    },
    /** The newest page the service answers. */
    pageNewest: (page: AgentNewestAnswer | { readonly failure: "unanswered" }) => {
      newestPage = page;
    },
    /** The transaction the service answers a sent message with. */
    sendTxid: (txid: string | undefined) => {
      sentTxid = txid;
    },
    /** What a change to an agent waits on before the service answers it. */
    holdChanges: (gate: Effect.Effect<void>) => {
      changeGate = gate;
    },
    /** Whether the service answers a plan's or an agent's inbox's live read, or that the account reaches none; none answers unanswered. */
    sealScope: (next: typeof LIVE_ANSWERED | { readonly failure: "not-found" } | undefined) => {
      scope = next;
    },
    /** The transaction the service says each inbox write committed in from now on; none says it changed nothing. */
    commitIn: (txid: string | undefined) => {
      committedIn = txid === undefined ? {} : { txid };
    },
    /** The item as the agent changed it before any close from now on, which the service answers each close not taken with. */
    changeFirst: (item: InboxItem) => {
      changedFirst = item;
    },
    /** Whether the service answers the account inbox's live read, or that the session signed out; none answers unanswered. */
    sealAccount: (next: typeof LIVE_ANSWERED | typeof LIVE_SIGNED_OUT | undefined) => {
      accountLive = next;
    },
    /** Whether the service answers the account's items' live read; none answers unanswered. */
    sealItems: (next: typeof LIVE_ANSWERED | undefined) => {
      itemsLive = next;
    },
    /** The transaction a Start answers it committed in; none answers none. */
    startCommits: (txid: string | undefined) => {
      startTxid = txid;
    },
  };
}

/** Now, as the host reads it in these tests. */
const NOW = 1_800_000_100_000;

/** A transcript's live read as the test scripts it. */
type TranscriptLive = PolledLive<(typeof TRANSCRIPT_PARTS)[number]>;

/** That the service answers a live read, its rows polled from the test's script (`polledLive`). */
const LIVE_ANSWERED = "answered";

/** The parts of a transcript's live read, of a plan's or an agent's inbox's, and of the account inbox's. */
const TRANSCRIPT_PARTS = [
  "messages",
  "turns",
  "conversation",
  "agent",
  "workers",
  "window",
  "windowParts",
  "queueRevision",
] as const;
const SCOPE_PARTS = ["items", "messages", "files"] as const;
const ACCOUNT_PARTS = ["items", "planless", "plans", "automations", "failedRuns"] as const;
const ITEMS_PARTS = ["stamps", "items", "messages", "files"] as const;

/** The account's items' read as the service answers it: every stamp, and the items changed at or after `since` alone, every one where it names none. */
function changedSince<Answer extends { readonly queries: { readonly items: SealedLiveQueryWire } }>(
  answer: Answer,
  since: number | undefined,
): Answer {
  const { items } = answer.queries;
  if (items.rows === undefined) return answer;
  const rows = items.rows.filter(
    (row) =>
      typeof row === "object" &&
      row !== null &&
      "updatedAt" in row &&
      typeof row.updatedAt === "number" &&
      row.updatedAt >= (since ?? 0),
  );
  return { ...answer, queries: { ...answer.queries, items: { ...items, rows } } };
}

/** Every step a follow has to take, taken: it runs on a fiber of its own. */
const settled = Effect.repeat(Effect.yieldNow, { times: 100 });

/** Every step taken, then the host's next poll asked, which waits half a second after the last answered (`live-follow.ts`). */
const nextPoll = Effect.andThen(
  settled,
  Effect.andThen(TestClock.adjust(Duration.millis(500)), settled),
);

function subject(
  options: {
    signedIn?: boolean;
    sendsNetwork?: boolean;
    accountId?: () => string | undefined;
    listed?: (txid: string | undefined) => Effect.Effect<void>;
    writeAgent?: RowWrite<AgentRow>;
  } = {},
) {
  return Effect.gen(function* () {
    const service = fakeService();
    // Each event with how many reads the service had been asked as it was told.
    const events: { kind: GatewayEventKind; payload: WireValue; asked: number }[] = [];
    const composer = yield* composeAgents({
      kernel: {
        runMode: { sendsNetwork: options.sendsNetwork ?? true },
        emit: (kind, payload) => void events.push({ kind, payload, asked: service.asked.length }),
        now: () => NOW,
      },
      account: { capabilitiesActive: () => options.signedIn ?? true },
      accountId: options.accountId ?? (() => "user-dana"),
      client: service.client,
      ...(options.listed === undefined ? undefined : { listed: options.listed }),
      ...(options.writeAgent === undefined ? undefined : { writeAgent: options.writeAgent }),
    }).pipe(Effect.provide(noNetwork));
    const call = (method: GatewayMethod, params: WireRecord = {}) => {
      const handler = composer.methods[method];
      assert.ok(handler, `no handler for ${method}`);
      return handler(params, context);
    };
    /** Every followed transcript's page the host told, in order. */
    const pages = () =>
      events.flatMap((event) =>
        event.kind === GATEWAY_EVENT.TRANSCRIPT_CHANGED ? [event.payload] : [],
      );
    /** How many reads the service had been asked as each followed transcript's page was told, in order. */
    const askedAsTold = () =>
      events.flatMap((event) =>
        event.kind === GATEWAY_EVENT.TRANSCRIPT_CHANGED ? [event.asked] : [],
      );
    return {
      call,
      pages,
      askedAsTold,
      asked: service.asked,
      startCommits: service.startCommits,
      sealTranscript: service.sealTranscript,
      pageNow: service.pageNow,
      holdPages: service.holdPages,
      pageNewest: service.pageNewest,
      sendTxid: service.sendTxid,
      holdChanges: service.holdChanges,
      sealScope: service.sealScope,
      sealAccount: service.sealAccount,
      sealItems: service.sealItems,
      commitIn: service.commitIn,
      changeFirst: service.changeFirst,
      live: service.live,
      /** Every answer of the followed account inbox the host told, in order. */
      accountInboxes: () =>
        events.flatMap((event) =>
          event.kind === GATEWAY_EVENT.ACCOUNT_INBOX_CHANGED ? [event.payload] : [],
        ),
      /** Every telling of the followed account's items, each one's scopes in the order of their ids. */
      accountItems: () =>
        events.flatMap((event): unknown[] => {
          if (event.kind !== GATEWAY_EVENT.ACCOUNT_ITEMS_CHANGED) return [];
          const told = event.payload;
          if (!isRecord(told) || !Array.isArray(told.scopes)) return [told];
          const scopes = told.scopes.toSorted((one, other) =>
            JSON.stringify(one) < JSON.stringify(other) ? -1 : 1,
          );
          return [{ ...told, scopes }];
        }),
      /** Every followed plan's or agent's inbox the host told, in order. */
      told: () =>
        events.flatMap((event) =>
          event.kind === GATEWAY_EVENT.INBOX_CHANGED ? [event.payload] : [],
        ),
      reset: composer.reset,
    };
  });
}

it.effect(
  "an ensure of the operator that made one waits for the task list to carry it before it answers",
  () =>
    Effect.gen(function* () {
      const waited: (string | undefined)[] = [];
      const { call, asked } = yield* subject({
        listed: (txid) => Effect.sync(() => void waited.push(txid)),
      });

      assert.deepEqual(
        yield* call(GATEWAY_METHOD.AGENTS_ENSURE_OPERATOR, {
          workspaceId: "workspace-1",
          reset: true,
        }),
        { agentId: AGENT_ID, txid: "9103" },
      );
      assert.deepEqual(waited, ["9103"]);
      assert.ok(asked.includes("ensureOperator:workspace-1:true"));
    }),
);

it.effect("a delete waits for the task list to carry its transaction before it answers", () =>
  Effect.gen(function* () {
    const waited: (string | undefined)[] = [];
    const { call } = yield* subject({
      listed: (txid) => Effect.sync(() => void waited.push(txid)),
    });

    assert.deepEqual(yield* call(GATEWAY_METHOD.AGENTS_DELETE, { agentId: AGENT_ID }), {
      deleted: true,
      txid: "9102",
    });
    assert.deepEqual(waited, ["9102"]);
  }),
);

it.effect("each method asks the service once and answers what it said, whole", () =>
  Effect.gen(function* () {
    const { call, asked, sealTranscript } = yield* subject();
    sealTranscript(LIVE_ANSWERED);

    assert.deepEqual(yield* call(GATEWAY_METHOD.AGENTS_MODELS), { models: MODELS });
    assert.deepEqual(yield* call(GATEWAY_METHOD.AGENTS_DEFAULT_READ), {
      choice: { model: AGENT.model, effort: AGENT.effort },
    });
    assert.deepEqual(
      yield* call(GATEWAY_METHOD.AGENTS_DEFAULT_WRITE, {
        model: "openai/gpt-6.1-sol",
        effort: "xhigh",
      }),
      { choice: { model: "openai/gpt-6.1-sol", effort: "xhigh" } },
    );
    assert.deepEqual(yield* call(GATEWAY_METHOD.AGENTS_LIST, { taskId: TASK_ID }), {
      agents: [AGENT],
    });
    assert.deepEqual(
      yield* call(GATEWAY_METHOD.AGENTS_LIST, { taskId: TASK_ID, includeArchived: true }),
      { agents: [AGENT] },
    );
    assert.deepEqual(
      yield* call(GATEWAY_METHOD.AGENTS_WORKSPACE_LIST, {
        workspaceId: "workspace-1",
        repository: "acme/relay",
      }),
      { agents: [AGENT] },
    );
    assert.deepEqual(
      yield* call(GATEWAY_METHOD.AGENTS_START, {
        taskId: TASK_ID,
        idempotencyKey: "press-1",
      }),
      { agent: { ...AGENT, status: AGENT_STATUS.STARTING } },
    );
    assert.deepEqual(
      yield* call(GATEWAY_METHOD.AGENTS_MESSAGES, {
        agentId: AGENT_ID,
        after: AGENT_CURSOR_START,
      }),
      {
        messages: [{ id: "m-1", role: "assistant", parts: [{ type: "text", text: "Hi" }] }],
        cursor: "2:1",
        status: AGENT_STATUS.RUNNING,
        title: null,
      },
    );
    assert.deepEqual(
      yield* call(GATEWAY_METHOD.AGENTS_MESSAGES, {
        agentId: AGENT_ID,
        after: AGENT_CURSOR_START,
        callId: "call-7",
      }),
      {
        messages: [{ id: "m-1", role: "assistant", parts: [{ type: "text", text: "Hi" }] }],
        cursor: "2:1",
        status: AGENT_STATUS.RUNNING,
        title: null,
      },
    );
    assert.deepEqual(
      yield* call(GATEWAY_METHOD.AGENTS_MESSAGE, {
        agentId: AGENT_ID,
        text: "Also expire them after a week.",
        clientKey: "send-1",
      }),
      { agent: AGENT },
    );
    assert.deepEqual(
      yield* call(GATEWAY_METHOD.AGENTS_CHOOSE, {
        agentId: AGENT_ID,
        model: "openai/gpt-6.1-sol",
        effort: "low",
      }),
      { agent: { ...AGENT, model: "openai/gpt-6.1-sol", effort: "low" } },
    );
    assert.deepEqual(
      yield* call(GATEWAY_METHOD.AGENTS_RENAME, {
        agentId: AGENT_ID,
        title: "Sign-out button",
      }),
      { agent: { ...AGENT, title: "Sign-out button" } },
    );
    assert.deepEqual(
      yield* call(GATEWAY_METHOD.AGENTS_SERVERS, {
        agentId: AGENT_ID,
        disabledServers: [INTEGRATION_PROVIDER.LINEAR],
      }),
      { agent: { ...AGENT, disabledServers: [INTEGRATION_PROVIDER.LINEAR] } },
    );
    assert.deepEqual(yield* call(GATEWAY_METHOD.AGENTS_STOP, { agentId: AGENT_ID }), {
      agent: { ...AGENT, status: AGENT_STATUS.CANCELLED },
    });
    assert.deepEqual(
      yield* call(GATEWAY_METHOD.AGENTS_ARCHIVE, { agentId: AGENT_ID, archived: true }),
      { agent: { ...AGENT, archivedAt: 1_800_000_120_000 } },
    );
    assert.deepEqual(yield* call(GATEWAY_METHOD.AGENTS_PIN, { agentId: AGENT_ID, pinned: true }), {
      agent: AGENT,
    });
    assert.deepEqual(yield* call(GATEWAY_METHOD.AGENTS_DELETE, { agentId: AGENT_ID }), {
      deleted: true,
      txid: "9102",
    });
    assert.deepEqual(yield* call(GATEWAY_METHOD.AGENTS_PAGE, { agentId: AGENT_ID }), {
      agent: PAGE,
    });
    assert.deepEqual(
      yield* call(GATEWAY_METHOD.AGENTS_PULL_REQUEST, { agentId: AGENT_ID }),
      PUBLISHED,
    );
    assert.deepEqual(yield* call(GATEWAY_METHOD.AGENTS_CHANGES, { agentId: AGENT_ID }), CHANGES);
    assert.deepEqual(
      yield* call(GATEWAY_METHOD.AGENTS_CHANGES, { agentId: AGENT_ID, number: 11 }),
      CHANGES,
    );
    assert.deepEqual(yield* call(GATEWAY_METHOD.AGENTS_CHAPTERS, { agentId: AGENT_ID }), CHAPTERS);
    assert.deepEqual(
      yield* call(GATEWAY_METHOD.AGENTS_CHAPTERS_GENERATE, {
        agentId: AGENT_ID,
        number: 11,
      }),
      CHAPTERS,
    );
    assert.deepEqual(yield* call(GATEWAY_METHOD.CHAPTERS_MODEL_READ), {
      model: CHAPTERS_MODEL.HAIKU,
    });
    assert.deepEqual(
      yield* call(GATEWAY_METHOD.CHAPTERS_MODEL_WRITE, { model: CHAPTERS_MODEL.OPUS }),
      { model: CHAPTERS_MODEL.OPUS },
    );
    assert.deepEqual(
      yield* call(GATEWAY_METHOD.AGENTS_OVERVIEW_PULL_REQUEST, { agentId: AGENT_ID }),
      OVERVIEW.pullRequest,
    );
    assert.deepEqual(
      yield* call(GATEWAY_METHOD.AGENTS_REVIEW_OPTIONS, { agentId: AGENT_ID }),
      REVIEW_OPTIONS,
    );
    assert.deepEqual(
      yield* call(GATEWAY_METHOD.AGENTS_OVERVIEW_CHECKS, { agentId: AGENT_ID }),
      OVERVIEW.checks,
    );
    assert.deepEqual(
      yield* call(GATEWAY_METHOD.AGENTS_OVERVIEW_CONVERSATION, { agentId: AGENT_ID }),
      OVERVIEW.conversation,
    );
    assert.deepEqual(
      yield* call(GATEWAY_METHOD.AGENTS_GITHUB_IMAGE, {
        agentId: AGENT_ID,
        src: "https://camo.githubusercontent.com/abc",
      }),
      { contentType: GITHUB_IMAGE_TYPE.PNG, base64: "iVBORw0KGgo=" },
    );
    assert.deepEqual(
      yield* call(GATEWAY_METHOD.AGENTS_PULL_REQUEST_ACTION, {
        agentId: AGENT_ID,
        number: 11,
        request: { action: PULL_REQUEST_ACTION.READY_FOR_REVIEW },
      }),
      { outcome: PULL_REQUEST_WRITE_OUTCOME.DONE },
    );
    assert.deepEqual(
      yield* call(GATEWAY_METHOD.AGENTS_PULL_REQUEST_VIEWED, { agentId: AGENT_ID }),
      { outcome: PULL_REQUEST_WRITE_OUTCOME.DONE, files: [] },
    );
    assert.deepEqual(
      yield* call(GATEWAY_METHOD.AGENTS_INBOX_ATTACHMENT, {
        itemId: ITEM.id,
        attachmentId: ATTACHMENT_ID,
      }),
      { contentType: INBOX_IMAGE_TYPE.PNG, base64: "iVBORw0KGgo=" },
    );
    assert.deepEqual(
      yield* call(GATEWAY_METHOD.AGENTS_PICTURE, {
        agentId: AGENT_ID,
        pictureId: PICTURE_ID,
        callId: "call-worker",
      }),
      { contentType: INBOX_IMAGE_TYPE.PNG, base64: "iVBORw0KGgo=" },
    );
    assert.deepEqual(
      yield* call(GATEWAY_METHOD.AGENTS_PART, {
        agentId: AGENT_ID,
        messageId: "message-1",
        index: 2,
      }),
      { part: { type: "reasoning", text: "Whole." } },
    );
    assert.deepEqual(
      yield* call(GATEWAY_METHOD.AGENTS_INBOX_ANSWER, {
        itemId: ITEM.id,
        revision: 2,
        reply: INBOX_REPLY.ACKNOWLEDGED,
        clientKey: "answer-1",
      }),
      { item: { ...ITEM, revision: 3, status: INBOX_STATUS.ANSWERED }, taken: true },
    );
    assert.deepEqual(
      yield* call(GATEWAY_METHOD.AGENTS_INBOX_CLOSE, {
        itemId: ITEM.id,
        revision: 2,
        clientKey: "close-1",
      }),
      {
        item: { ...ITEM, status: INBOX_STATUS.CLOSED, closedBy: { userId: "u1", name: "Dana" } },
        taken: true,
      },
    );
    assert.deepEqual(
      yield* call(GATEWAY_METHOD.AGENTS_INBOX_MESSAGE, {
        itemId: ITEM.id,
        text: "Also page on-call.",
        attachments: [{ name: "pager.txt", mediaType: "text/plain", data: "b24tY2FsbA==" }],
        clientKey: "message-1",
      }),
      {
        item: {
          ...ITEM,
          messages: [
            {
              id: MESSAGE_ID,
              author: INBOX_MESSAGE_AUTHOR.MEMBER,
              text: "Also page on-call.",
              createdAt: ITEM.updatedAt,
            },
          ],
        },
      },
    );
    yield* call(GATEWAY_METHOD.AGENTS_INBOX_MESSAGE, {
      itemId: ITEM.id,
      text: "Ship it.",
      clientKey: "message-2",
      answers: { ask: MESSAGE_ID, reply: INBOX_REPLY.CHOSE, choices: ["Ship it"] },
    });
    assert.deepEqual(
      yield* call(GATEWAY_METHOD.AGENTS_INBOX_START, {
        agentId: AGENT_ID,
        title: "Annual plan copy",
        text: "Draft the annual plan's line too.",
        clientKey: "start-1",
      }),
      {
        item: {
          ...ITEM,
          title: "Annual plan copy",
          messages: [
            {
              id: MESSAGE_ID,
              author: INBOX_MESSAGE_AUTHOR.MEMBER,
              text: "Draft the annual plan's line too.",
              createdAt: ITEM.updatedAt,
            },
          ],
        },
      },
    );
    assert.deepEqual(
      yield* call(GATEWAY_METHOD.AGENTS_INBOX_READ_STATE, { itemId: ITEM.id, unread: true }),
      { id: ITEM.id, unread: true },
    );
    assert.deepEqual(
      yield* call(GATEWAY_METHOD.AGENTS_INBOX_READ_STATE, {
        itemId: ITEM.id,
        unread: false,
      }),
      { id: ITEM.id, unread: false },
    );
    assert.deepEqual(
      yield* call(GATEWAY_METHOD.AGENTS_INBOX_READ_ALL, {
        workspaceId: WORKSPACE_ID,
        itemIds: [],
      }),
      { marked: 2 },
    );

    assert.deepEqual(asked, [
      "models",
      "default",
      "default:openai/gpt-6.1-sol:xhigh",
      `list:${TASK_ID}`,
      `list:${TASK_ID}:archived`,
      "workspace:workspace-1:acme/relay",
      `start:${TASK_ID}:press-1:default`,
      `messages-now:${AGENT_ID}:${AGENT_CURSOR_START}`,
      `worker-now:${AGENT_ID}:call-7:${AGENT_CURSOR_START}`,
      `message:${AGENT_ID}:send-1:Also expire them after a week.`,
      `choose:${AGENT_ID}:openai/gpt-6.1-sol:low`,
      `rename:${AGENT_ID}:Sign-out button`,
      `servers:${AGENT_ID}:linear`,
      `stop:${AGENT_ID}`,
      `archive:${AGENT_ID}:true`,
      `pin:${AGENT_ID}:true`,
      `delete:${AGENT_ID}`,
      `page:${AGENT_ID}`,
      `pull-request:${AGENT_ID}`,
      `changes:${AGENT_ID}`,
      `changes:${AGENT_ID}#11`,
      `chapters:${AGENT_ID}`,
      `chapters-generate:${AGENT_ID}#11`,
      "chapters-model",
      `chapters-model-write:${CHAPTERS_MODEL.OPUS}`,
      `overview-pull-request:${AGENT_ID}`,
      `review-options:${AGENT_ID}`,
      `overview-checks:${AGENT_ID}`,
      `overview-conversation:${AGENT_ID}`,
      `github-image:${AGENT_ID}:https://camo.githubusercontent.com/abc`,
      `pull-request-action:${AGENT_ID}#11:${PULL_REQUEST_ACTION.READY_FOR_REVIEW}`,
      `pull-request-viewed:${AGENT_ID}`,
      `attachment:${ITEM.id}:${ATTACHMENT_ID}`,
      `picture:${AGENT_ID}:${PICTURE_ID}:call-worker`,
      `part:${AGENT_ID}:message-1:2:`,
      `answer:${ITEM.id}:2:${INBOX_REPLY.ACKNOWLEDGED}:answer-1`,
      `close:${ITEM.id}:2:close-1`,
      `inbox-message:${ITEM.id}:Also page on-call.:pager.txt:message-1`,
      `inbox-message:${ITEM.id}:Ship it.::message-2:answers ${MESSAGE_ID} chose Ship it`,
      `inbox-start:${AGENT_ID}:Annual plan copy:Draft the annual plan's line too.:start-1`,
      `inbox-unread:${ITEM.id}`,
      `inbox-read:${ITEM.id}`,
      `inbox-read-all:${WORKSPACE_ID}`,
    ]);
  }),
);

it.effect(
  "behind a closed account gate, or on a run that sends nothing, every ask is unanswered",
  () =>
    Effect.gen(function* () {
      const signedOut = yield* subject({ signedIn: false });
      const offline = yield* subject({ sendsNetwork: false });

      assert.deepEqual(yield* signedOut.call(GATEWAY_METHOD.AGENTS_MODELS), {
        failure: AGENT_CALL_FAILURE.UNANSWERED,
      });
      assert.deepEqual(yield* offline.call(GATEWAY_METHOD.AGENTS_LIST, { taskId: TASK_ID }), {
        failure: AGENT_CALL_FAILURE.UNANSWERED,
      });
      assert.deepEqual(signedOut.asked, []);
      assert.deepEqual(offline.asked, []);
    }),
);

it.effect(
  "a Start from an agent that names no task asks the service to start where that agent is, one on a task still starts on it, and one naming neither a task nor an agent is refused, asking nothing",
  () =>
    Effect.gen(function* () {
      const { call, asked } = yield* subject();

      const fromTaskless = yield* call(GATEWAY_METHOD.AGENTS_START, {
        idempotencyKey: "press-continue",
        from: { agentId: AGENT_ID },
      });
      yield* call(GATEWAY_METHOD.AGENTS_START, {
        taskId: TASK_ID,
        idempotencyKey: "press-fork",
        from: { agentId: AGENT_ID },
      });
      const refused = yield* Effect.flip(
        call(GATEWAY_METHOD.AGENTS_START, {
          idempotencyKey: "press-nowhere",
          prompt: "Go.",
        }),
      );

      assert.deepEqual(fromTaskless, { agent: { ...AGENT, status: AGENT_STATUS.STARTING } });
      assert.equal(refused._tag, "InvalidParamsRefusal");
      assert.deepEqual(asked, [
        `start-from:${AGENT_ID}:press-continue`,
        `start:${TASK_ID}:press-fork:default`,
      ]);
    }),
);

it.effect(
  "a provider key passes through to the service once and is answered back as its hint alone, and a save the schema refuses is refused in words that hold no key",
  () =>
    Effect.gen(function* () {
      const { call, asked } = yield* subject();

      const read = yield* call(GATEWAY_METHOD.PROVIDER_KEYS_READ);
      const saved = yield* call(GATEWAY_METHOD.PROVIDER_KEYS_SAVE, {
        provider: PROVIDER_KEY_PROVIDER.ANTHROPIC,
        key: PROVIDER_KEY,
      });
      const removed = yield* call(GATEWAY_METHOD.PROVIDER_KEYS_REMOVE, {
        provider: PROVIDER_KEY_PROVIDER.ANTHROPIC,
      });
      const refused = yield* Effect.flip(
        call(GATEWAY_METHOD.PROVIDER_KEYS_SAVE, { provider: "google", key: PROVIDER_KEY }),
      );

      assert.deepEqual(read, { keys: [KEPT] });
      assert.deepEqual(saved, { keys: [KEPT] });
      assert.deepEqual(removed, { keys: [] });
      assert.ok(!JSON.stringify([read, saved, removed]).includes(PROVIDER_KEY));
      assert.equal(refused._tag, "InvalidParamsRefusal");
      assert.ok(!JSON.stringify(refused).includes(PROVIDER_KEY));
      assert.deepEqual(asked, [
        "keys",
        `save:${PROVIDER_KEY_PROVIDER.ANTHROPIC}:the key`,
        `remove:${PROVIDER_KEY_PROVIDER.ANTHROPIC}`,
      ]);
    }),
);

it.effect(
  "a GitHub token passes through to the service once and is never answered back, and a save the schema refuses is refused in words that hold no token",
  () =>
    Effect.gen(function* () {
      const { call, asked } = yield* subject();

      const read = yield* call(GATEWAY_METHOD.GITHUB_TOKEN_READ);
      const saved = yield* call(GATEWAY_METHOD.GITHUB_TOKEN_SAVE, { token: GITHUB_TOKEN });
      const removed = yield* call(GATEWAY_METHOD.GITHUB_TOKEN_REMOVE);
      const refused = yield* Effect.flip(
        call(GATEWAY_METHOD.GITHUB_TOKEN_SAVE, { token: `${GITHUB_TOKEN} spaced` }),
      );

      assert.deepEqual(read, { token: null });
      assert.deepEqual(saved, { token: null, rejected: GITHUB_TOKEN_REJECTION.NO_REPO_SCOPE });
      assert.deepEqual(removed, { token: null });
      assert.equal(refused._tag, "InvalidParamsRefusal");
      assert.ok(!JSON.stringify(refused).includes(GITHUB_TOKEN));
      assert.deepEqual(asked, ["token", "save-token:the token", "remove-token"]);
    }),
);

/** The transcript's statements as they stand: `seq` its newest message, `turns` how many it has opened. */
function transcriptRows(live: { readonly transcript: TranscriptLive }, seq: number, turns = 1) {
  live.transcript.set({
    messages: [],
    turns: [{ status: "running", rows: turns, stopped: 0, changedAt: NOW - 1_000 }],
    conversation: [{ id: "conversation-1", title: null, revision: seq }],
    agent: [{ id: AGENT_ID, title: "Invites" }],
    workers: [],
    window: [],
    windowParts: [],
    queueRevision: [],
  });
}

/** One message of the window as its rows deliver it: a line of the agent's at `seq`, saying `text` in one part. */
function windowRow(seq: number, text: string) {
  return {
    row: {
      id: `m-${seq}`,
      seq,
      clientId: `client-${seq}`,
      turnId: null,
      role: "assistant",
      partCount: 1,
      metadata: null,
      placedAt: NOW,
      finishedAt: null,
      sender: null,
      senderName: null,
      senderModel: null,
      memberId: null,
      memberName: null,
      agentId: null,
      agentTaskId: null,
      journalId: null,
      afterStep: null,
      askTurnId: null,
      askAfterStep: null,
      turnStartedAt: null,
      turnStatus: null,
      turnModel: null,
      turnEffort: null,
      turnUsage: null,
      turnFailure: null,
      turnFastRefused: null,
    },
    part: {
      messageId: `m-${seq}`,
      index: 0,
      part: { type: "text", text },
      cutField: null,
      bytes: null,
      head: null,
      tail: null,
    },
  };
}

/** A page the service answers read at once: its messages, its cursor, its status, and whether its held read would have held. */
function pageNow(
  cursor: string,
  options: { holds: boolean; text?: string; status?: typeof AGENT_STATUS.RUNNING },
): TranscriptNowAnswer {
  return {
    messages:
      options.text === undefined
        ? []
        : [{ id: `m-${cursor}`, role: "assistant", parts: [{ type: "text", text: options.text }] }],
    cursor,
    status: options.status ?? AGENT_STATUS.RUNNING,
    title: "Invites",
    holds: options.holds,
  };
}

/** A page past a cursor as the window is told it: the service's word on whether it would have held left in the host, and whether it came back short of a page's most. */
function windowPage(page: TranscriptNowAnswer) {
  const { holds: _holds, ...rest } = page;
  return { ...rest, caughtUp: page.messages.length < AGENT_BOUNDS.MESSAGES_PAGE };
}

/** The newest page the service answers: one message, the cursor to follow on from, and where the older page is read below. */
function newestPage(cursor: string, text: string, before?: string): AgentNewestAnswer {
  return {
    messages: [{ id: `m-${cursor}`, role: "assistant", parts: [{ type: "text", text }] }],
    cursor,
    status: AGENT_STATUS.RUNNING,
    title: "Invites",
    ...(before === undefined ? undefined : { before }),
  };
}

const FOLLOWED = { kind: TRANSCRIPT_KIND.AGENT, agentId: AGENT_ID } as const;

/** Whether a page the host told came back caught up. */
function caughtUpOf(told: WireValue | undefined): unknown {
  return isRecord(told) && isRecord(told.page) ? told.page.caughtUp : undefined;
}

it.effect(
  "a followed transcript opens on its newest page, read once beside the live read, then follows on from its cursor once the live read's first rows land, missing nothing written between; a short page is caught up, and the next is read only as the statements move or at the edge the service names; letting it go ends the telling",
  () =>
    Effect.gen(function* () {
      const {
        call,
        asked,
        pages,
        sealTranscript,
        pageNow: script,
        pageNewest,
        live,
      } = yield* subject();
      sealTranscript(LIVE_ANSWERED);
      const newest = newestPage("1:0", "Reading the invites.", "40");
      pageNewest(newest);
      // A message written after the newest page was read, before the live read's first rows landed.
      const between = {
        ...pageNow("2:0", { holds: true, text: "Writing the expiry." }),
        wakeIn: 3_000,
      };
      script(between);
      assert.deepEqual(yield* call(GATEWAY_METHOD.AGENTS_TRANSCRIPT_FOLLOW, FOLLOWED), {});
      yield* settled;
      assert.deepEqual(pages(), [
        { transcript: FOLLOWED, page: { ...newest, newest: true, caughtUp: false } },
      ]);
      assert.deepEqual(asked.toSorted(), [
        `messages-newest:${AGENT_ID}:cut`,
        `transcript-live:${AGENT_ID}`,
      ]);

      // The live read's first rows read on from the newest page's cursor, never from the start.
      transcriptRows(live, 2);
      yield* settled;
      assert.deepEqual(pages()[1], { transcript: FOLLOWED, page: windowPage(between) });
      assert.equal(caughtUpOf(pages()[1]), true);
      const reads = asked.filter((ask) => ask.startsWith("messages-"));
      assert.deepEqual(reads, [`messages-newest:${AGENT_ID}:cut`, `messages-now:${AGENT_ID}:1:0`]);

      // Note that a short page is caught up, so nothing is read again until the clock reaches the edge the service named.
      yield* TestClock.adjust("2 seconds");
      yield* settled;
      assert.equal(pages().length, 2);
      yield* TestClock.adjust("1 second");
      yield* settled;
      assert.equal(pages().length, 3);
      assert.equal(asked.at(-1), `messages-now:${AGENT_ID}:2:0`);

      const moved = pageNow("3:0", { holds: false, text: "Testing the expiry." });
      script(moved);
      // A turn opening is what reads the page again; its messages come as rows (see the window's own test).
      transcriptRows(live, 3, 2);
      yield* settled;
      assert.deepEqual(pages().at(-1), { transcript: FOLLOWED, page: windowPage(moved) });
      assert.equal(asked.filter((ask) => ask.startsWith("messages-newest")).length, 1);
      assert.ok(!asked.includes(`messages-now:${AGENT_ID}:${AGENT_CURSOR_START}`));

      yield* call(GATEWAY_METHOD.AGENTS_TRANSCRIPT_UNFOLLOW, FOLLOWED);
      const toldBefore = pages().length;
      transcriptRows(live, 4, 3);
      yield* settled;
      assert.equal(pages().length, toldBefore);
    }),
);

it.effect(
  "a followed transcript's newest messages are told as its window's rows draw them, each once and as caught up, beside what the last page said of the agent, with no page read again; a message whose parts are not all in waits for them",
  () =>
    Effect.gen(function* () {
      const {
        call,
        asked,
        pages,
        sealTranscript,
        pageNow: script,
        pageNewest,
        live,
      } = yield* subject();
      sealTranscript(LIVE_ANSWERED);
      pageNewest(newestPage("1:0", "Reading the invites."));
      const caught = pageNow("1:0", { holds: true });
      script(caught);
      yield* call(GATEWAY_METHOD.AGENTS_TRANSCRIPT_FOLLOW, FOLLOWED);
      yield* settled;
      transcriptRows(live, 1);
      yield* settled;
      const reads = () => asked.filter((ask) => ask.startsWith("messages-")).length;
      const readBefore = reads();
      const toldBefore = pages().length;

      const first = windowRow(2, "Writing the expiry.");
      const second = windowRow(3, "Testing the expiry.");
      // The second message's part has not landed yet, so only the first is drawn.
      live.transcript.set({ window: [first.row, second.row], windowParts: [first.part] });
      yield* nextPoll;
      live.transcript.set({ windowParts: [first.part, second.part] });
      yield* nextPoll;
      // Rows answered again alike tell nothing more.
      live.transcript.set({ window: [first.row, second.row] });
      yield* nextPoll;

      const said = (seq: number, text: string) => ({
        id: `m-${seq}`,
        role: "assistant",
        parts: [{ type: "text", text }],
      });
      assert.deepEqual(pages().slice(toldBefore), [
        {
          transcript: FOLLOWED,
          page: { ...windowPage(caught), messages: [said(2, "Writing the expiry.")] },
        },
        {
          transcript: FOLLOWED,
          page: { ...windowPage(caught), messages: [said(3, "Testing the expiry.")] },
        },
      ]);
      assert.equal(reads(), readBefore);

      // A turn moving reads the page past the messages the rows told.
      transcriptRows(live, 3, 2);
      yield* nextPoll;
      assert.equal(asked.at(-1), `messages-now:${AGENT_ID}:3:0`);
    }),
);

it.effect(
  "a followed transcript reads its page again at the edge a page names though it would not hold, as a queued message's edit lapsing",
  () =>
    Effect.gen(function* () {
      const { call, asked, sealTranscript, pageNow: script, pageNewest, live } = yield* subject();
      sealTranscript(LIVE_ANSWERED);
      pageNewest(newestPage("1:0", "Reading the invites.", "40"));
      script({ ...pageNow("1:0", { holds: false, text: "Reading the invites." }), wakeIn: 3_000 });
      yield* call(GATEWAY_METHOD.AGENTS_TRANSCRIPT_FOLLOW, FOLLOWED);
      yield* settled;
      transcriptRows(live, 1);
      yield* settled;
      const reads = () => asked.filter((ask) => ask.startsWith("messages-now")).length;
      const before = reads();

      yield* TestClock.adjust("2 seconds");
      yield* settled;
      assert.equal(reads(), before, "nothing is read before the edge");
      yield* TestClock.adjust("1 second");
      yield* settled;
      assert.equal(reads(), before + 1, "the edge reads the page");
    }),
);

it.effect(
  "a followed transcript reads its page again when only the agent's queue moves, or a line of the developer's lands awaiting its turn, whoever wrote it",
  () =>
    Effect.gen(function* () {
      const { call, asked, sealTranscript, pageNow: script, pageNewest, live } = yield* subject();
      sealTranscript(LIVE_ANSWERED);
      pageNewest(newestPage("1:0", "Reading the invites.", "40"));
      script(pageNow("1:0", { holds: false, text: "Reading the invites." }));
      yield* call(GATEWAY_METHOD.AGENTS_TRANSCRIPT_FOLLOW, FOLLOWED);
      yield* settled;
      transcriptRows(live, 1);
      yield* settled;
      const reads = () => asked.filter((ask) => ask.startsWith("messages-now")).length;

      // A message queued, edited, sent, or the queue paused: nothing but its revision moves.
      const beforeQueue = reads();
      live.transcript.set({ queueRevision: [{ revision: 1 }] });
      yield* nextPoll;
      assert.equal(reads(), beforeQueue + 1, "the queue moving reads the page");

      // A queue's hand-off writes the member's line before its turn is opened; the page says the agent runs.
      const beforeLine = reads();
      const line = windowRow(2, "Open the pull request.");
      live.transcript.set({
        window: [{ ...line.row, role: "user", turnStatus: null }],
        windowParts: [line.part],
      });
      yield* nextPoll;
      assert.equal(reads(), beforeLine + 1, "a line awaiting its turn reads the page");
    }),
);

/**
 * A follow whose rows draw `m-2` as "Writing the expiry." at the
 * conversation's revision 2 while a moved turn's page is read, the page
 * answering `pageText` for it at the cursor named: every page told from the
 * moment the turn moved, once the page and a delivery of the rows after it
 * landed.
 */
function toldBesideRead(pageCursor: string, pageText: string) {
  return Effect.gen(function* () {
    const {
      call,
      pages,
      sealTranscript,
      pageNow: script,
      holdPages,
      pageNewest,
      live,
    } = yield* subject();
    sealTranscript(LIVE_ANSWERED);
    pageNewest(newestPage("1:0", "Reading the invites."));
    const caught = pageNow("1:0", { holds: true });
    script(caught);
    yield* call(GATEWAY_METHOD.AGENTS_TRANSCRIPT_FOLLOW, FOLLOWED);
    yield* settled;
    transcriptRows(live, 1);
    yield* settled;
    const toldBefore = pages().length;

    const answer = yield* Deferred.make<void>();
    holdPages(Deferred.await(answer));
    const read: TranscriptNowAnswer = {
      ...pageNow(pageCursor, { holds: false }),
      messages: [said(2, pageText), said(3, "Testing the expiry.")],
    };
    script(read);
    // A turn opening reads the page, which the service is slow to answer.
    transcriptRows(live, 2, 2);
    yield* nextPoll;
    const drawn = windowRow(2, "Writing the expiry.");
    live.transcript.set({ window: [drawn.row], windowParts: [drawn.part] });
    yield* nextPoll;
    const beside = pages().slice(toldBefore);

    yield* Deferred.succeed(answer, undefined);
    yield* settled;
    // The rows answer again as they stood, which tells nothing older than the page.
    live.transcript.set({ windowParts: [drawn.part] });
    yield* nextPoll;
    return { beside, after: pages().slice(toldBefore + beside.length), caught, read };
  });
}

/** One of the agent's messages, at `seq`, saying `text` in one part. */
function said(seq: number, text: string) {
  return { id: `m-${seq}`, role: "assistant" as const, parts: [{ type: "text", text }] };
}

it.effect(
  "a message the window's rows draw while a moved turn's page is read is told at once, and left out of that page where the page read it at an older revision",
  () =>
    Effect.gen(function* () {
      const { beside, after, caught, read } = yield* toldBesideRead("3:0", "Writ");

      assert.deepEqual(beside, [
        {
          transcript: FOLLOWED,
          page: { ...windowPage(caught), messages: [said(2, "Writing the expiry.")] },
        },
      ]);
      assert.deepEqual(after, [
        {
          transcript: FOLLOWED,
          page: { ...windowPage(read), messages: [said(3, "Testing the expiry.")] },
        },
      ]);
    }),
);

it.effect(
  "a page read at the rows' revision or later tells its newer copy of a message the rows drew beside it, and the rows never draw the older one back over it",
  () =>
    Effect.gen(function* () {
      const newer = "Writing the expiry, then testing it.";
      const { after, read } = yield* toldBesideRead("3:5", newer);

      assert.deepEqual(after, [
        {
          transcript: FOLLOWED,
          page: { ...windowPage(read), messages: [said(2, newer), said(3, "Testing the expiry.")] },
        },
      ]);
    }),
);

it.effect(
  "messages the window's rows drew are held too, so a transcript followed again is told them and reads on past them",
  () =>
    Effect.gen(function* () {
      const harness = yield* subject();
      const { call, asked, pages, sealTranscript, pageNow: script, pageNewest, live } = harness;
      sealTranscript(LIVE_ANSWERED);
      const newest = newestPage("1:0", "Reading the invites.");
      pageNewest(newest);
      script(pageNow("1:0", { holds: true }));
      yield* call(GATEWAY_METHOD.AGENTS_TRANSCRIPT_FOLLOW, FOLLOWED);
      yield* settled;
      transcriptRows(live, 1);
      yield* settled;
      const drawn = windowRow(2, "Writing the expiry.");
      live.transcript.set({ window: [drawn.row], windowParts: [drawn.part] });
      yield* nextPoll;
      yield* call(GATEWAY_METHOD.AGENTS_TRANSCRIPT_UNFOLLOW, FOLLOWED);

      const toldBefore = pages().length;
      const askedBefore = asked.length;
      yield* call(GATEWAY_METHOD.AGENTS_TRANSCRIPT_FOLLOW, FOLLOWED);
      yield* settled;
      const told = pages()[toldBefore];
      assert.ok(isRecord(told) && isRecord(told.page) && Array.isArray(told.page.messages));
      assert.equal(told.page.held, true);
      assert.deepEqual(
        told.page.messages.map((message) => (isRecord(message) ? message.id : undefined)),
        [newest.messages[0]?.id, "m-2"],
      );
      assert.deepEqual(asked.slice(askedBefore), [`messages-now:${AGENT_ID}:2:0`]);
    }),
);

it.effect(
  "a full page is followed by the next at once, and the short one after it is caught up",
  () =>
    Effect.gen(function* () {
      const { call, asked, pages, sealTranscript, pageNow: script, live } = yield* subject();
      sealTranscript(LIVE_ANSWERED);
      const full: TranscriptNowAnswer = {
        ...pageNow("2:0", { holds: false }),
        messages: Array.from({ length: AGENT_BOUNDS.MESSAGES_PAGE }, (_, index) => ({
          id: `m-full-${index}`,
          role: "assistant" as const,
          parts: [{ type: "text" as const, text: `Step ${index}` }],
        })),
      };
      const rest = pageNow("3:0", { holds: true, text: "Done." });
      script(full, rest);
      yield* call(GATEWAY_METHOD.AGENTS_TRANSCRIPT_FOLLOW, FOLLOWED);
      yield* settled;
      transcriptRows(live, 2);
      yield* settled;
      const told = pages().map(caughtUpOf);
      assert.deepEqual(told.slice(0, 3), [false, false, true]);
      assert.deepEqual(asked.filter((ask) => ask.startsWith("messages-now")).slice(0, 2), [
        `messages-now:${AGENT_ID}:1:0`,
        `messages-now:${AGENT_ID}:2:0`,
      ]);
    }),
);

it.effect(
  "a live read the service does not answer leaves the newest page told, is asked again a bounded number of times, then says the transcript could not be read; following again reads anew",
  () =>
    Effect.gen(function* () {
      const { call, asked, pages, sealTranscript } = yield* subject();
      yield* call(GATEWAY_METHOD.AGENTS_TRANSCRIPT_FOLLOW, FOLLOWED);
      yield* settled;
      assert.deepEqual(pages(), [
        {
          transcript: FOLLOWED,
          page: { ...SAID, cursor: "1:0", newest: true, caughtUp: false },
        },
      ]);

      yield* TestClock.adjust("1 minute");
      yield* settled;
      const seals = asked.filter((ask) => ask === `transcript-live:${AGENT_ID}`).length;
      assert.ok(seals > 1 && seals < 60, `read ${seals} times`);
      assert.deepEqual(pages().at(-1), {
        transcript: FOLLOWED,
        page: { failure: AGENT_CALL_FAILURE.UNANSWERED },
      });
      yield* TestClock.adjust("1 minute");
      yield* settled;
      assert.equal(asked.filter((ask) => ask === `transcript-live:${AGENT_ID}`).length, seals);

      sealTranscript(LIVE_ANSWERED);
      yield* call(GATEWAY_METHOD.AGENTS_TRANSCRIPT_FOLLOW, FOLLOWED);
      yield* settled;
      assert.equal(asked.filter((ask) => ask === `transcript-live:${AGENT_ID}`).length, seals + 1);
      // Note that the newest page told before stands held, so following again opens on it rather than reading it anew.
      assert.equal(asked.filter((ask) => ask === `messages-newest:${AGENT_ID}:cut`).length, 1);
    }),
);

it.effect(
  "a newest page the service keeps not answering is asked for a bounded number of times, then the follow ends on the failure told",
  () =>
    Effect.gen(function* () {
      const { call, asked, pages, sealTranscript, pageNewest } = yield* subject();
      sealTranscript(LIVE_ANSWERED);
      pageNewest({ failure: AGENT_CALL_FAILURE.UNANSWERED });
      yield* call(GATEWAY_METHOD.AGENTS_TRANSCRIPT_FOLLOW, FOLLOWED);
      yield* settled;
      yield* TestClock.adjust("1 minute");
      yield* settled;
      const newest = () => asked.filter((ask) => ask === `messages-newest:${AGENT_ID}:cut`).length;
      const read = newest();
      assert.ok(read > 1 && read < 60, `read the newest page ${read} times`);
      assert.deepEqual(pages().at(-1), {
        transcript: FOLLOWED,
        page: { failure: AGENT_CALL_FAILURE.UNANSWERED },
      });
      yield* TestClock.adjust("1 minute");
      yield* settled;
      assert.equal(newest(), read);
      assert.ok(!asked.some((ask) => ask.startsWith("messages-now")));
    }),
);

it.effect(
  "a page read at another rewind than the window's has the follow read the newest page afresh and tell it as the newest, which the window takes in place of what it drew",
  () =>
    Effect.gen(function* () {
      const {
        call,
        asked,
        pages,
        sealTranscript,
        pageNow: script,
        pageNewest,
        live,
      } = yield* subject();
      sealTranscript(LIVE_ANSWERED);
      pageNewest(newestPage("2:0", "Writing the expiry."));
      script(pageNow("2:0", { holds: true }));
      yield* call(GATEWAY_METHOD.AGENTS_TRANSCRIPT_FOLLOW, FOLLOWED);
      yield* settled;
      transcriptRows(live, 2);
      yield* settled;

      // The agent is taken back to before its second line: every page says so from now on.
      const rewound = { ...newestPage("3:1", "Reading the invites."), rewound: 1 };
      pageNewest(rewound);
      script({ ...pageNow("3:1", { holds: true }), rewound: 1 });
      transcriptRows(live, 3, 2);
      yield* nextPoll;

      const newestTold = pages().filter(
        (told) => isRecord(told) && isRecord(told.page) && told.page.newest === true,
      );
      assert.deepEqual(newestTold.at(-1), {
        transcript: FOLLOWED,
        page: { ...rewound, newest: true, caughtUp: false },
      });
      assert.equal(asked.filter((ask) => ask.startsWith("messages-newest")).length, 2);
    }),
);

it.effect("an older page is read below the place the window names, the agent's or a worker's", () =>
  Effect.gen(function* () {
    const { call, asked } = yield* subject();
    assert.deepEqual(
      yield* call(GATEWAY_METHOD.AGENTS_TRANSCRIPT_OLDER, { ...FOLLOWED, before: "40" }),
      { messages: SAID.messages, before: "3" },
    );
    yield* call(GATEWAY_METHOD.AGENTS_TRANSCRIPT_OLDER, {
      ...FOLLOWED,
      callId: "call-7",
      before: "40",
    });
    const refused = yield* Effect.flip(
      call(GATEWAY_METHOD.AGENTS_TRANSCRIPT_OLDER, { ...FOLLOWED, before: "the start" }),
    );
    assert.equal(refused._tag, "InvalidParamsRefusal");
    assert.deepEqual(asked, [
      `messages-before:${AGENT_ID}:40:cut`,
      `worker-before:${AGENT_ID}:call-7:40:cut`,
    ]);
  }),
);

it.effect(
  "a followed transcript the account does not reach is told not found once; behind a closed gate it is told unanswered; and a sign-out lets every followed transcript go",
  () =>
    Effect.gen(function* () {
      const worker = { ...FOLLOWED, callId: "call-7" };
      const refused = yield* subject();
      refused.sealTranscript({ failure: AGENT_CALL_FAILURE.NOT_FOUND });
      yield* refused.call(GATEWAY_METHOD.AGENTS_TRANSCRIPT_FOLLOW, worker);
      yield* settled;
      yield* TestClock.adjust("5 seconds");
      yield* settled;
      assert.deepEqual(refused.pages(), [
        { transcript: worker, page: { failure: AGENT_CALL_FAILURE.NOT_FOUND } },
      ]);

      const signedOut = yield* subject({ signedIn: false });
      yield* signedOut.call(GATEWAY_METHOD.AGENTS_TRANSCRIPT_FOLLOW, FOLLOWED);
      yield* settled;
      assert.deepEqual(signedOut.pages(), [
        { transcript: FOLLOWED, page: { failure: AGENT_CALL_FAILURE.UNANSWERED } },
      ]);
      assert.deepEqual(signedOut.asked, []);

      const followed = yield* subject();
      followed.sealTranscript(LIVE_ANSWERED);
      followed.pageNow(pageNow("1:0", { holds: true }));
      yield* followed.call(GATEWAY_METHOD.AGENTS_TRANSCRIPT_FOLLOW, FOLLOWED);
      yield* settled;
      assert.equal(followed.live.transcript.held(), 1, "its poll is held while nothing moves");
      yield* followed.reset;
      yield* settled;
      assert.equal(followed.live.transcript.held(), 0, "a sign-out lets its poll go");
      assert.equal(followed.pages().length, 1);
    }),
);

/** A followed transcript opened on its newest page and caught up past it, as a window that followed it last saw it: its window, as the host holds it. */
function followedOnce(
  harness: Effect.Success<ReturnType<typeof subject>>,
  transcript: { readonly kind: "agent"; readonly agentId: string } = FOLLOWED,
) {
  return Effect.gen(function* () {
    const newest = newestPage("1:0", "Reading the invites.", "40");
    const past = pageNow("2:0", { holds: false, text: "Writing the expiry." });
    harness.sealTranscript(LIVE_ANSWERED);
    harness.pageNewest(newest);
    harness.pageNow(past);
    yield* harness.call(GATEWAY_METHOD.AGENTS_TRANSCRIPT_FOLLOW, transcript);
    yield* settled;
    transcriptRows(harness.live, 2);
    yield* settled;
    yield* harness.call(GATEWAY_METHOD.AGENTS_TRANSCRIPT_UNFOLLOW, transcript);
    const { holds: _holds, ...read } = past;
    return {
      ...read,
      messages: [...newest.messages, ...past.messages],
      before: "40",
      newest: true,
      held: true,
      caughtUp: false,
    };
  });
}

it.effect(
  "a transcript followed again is told the window held of it before the service is asked anything, then read on once from the held cursor, so a message written while away arrives",
  () =>
    Effect.gen(function* () {
      const harness = yield* subject();
      const window = yield* followedOnce(harness);
      const { asked, pages, askedAsTold, live } = harness;

      // Written while no window followed it.
      const away = pageNow("3:0", { holds: false, text: "Written while away." });
      harness.pageNow(away);
      yield* TestClock.adjust("5 seconds");
      transcriptRows(live, 3);
      yield* settled;

      const toldBefore = pages().length;
      const askedBefore = asked.length;
      yield* harness.call(GATEWAY_METHOD.AGENTS_TRANSCRIPT_FOLLOW, FOLLOWED);
      yield* settled;
      assert.deepEqual(pages().slice(toldBefore), [
        { transcript: FOLLOWED, page: window },
        { transcript: FOLLOWED, page: windowPage(away) },
      ]);
      assert.equal(askedAsTold()[toldBefore], askedBefore);
      assert.deepEqual(asked.slice(askedBefore), [`messages-now:${AGENT_ID}:2:0`]);
    }),
);

it.effect(
  "a held message rewritten while away arrives on the read past the held cursor, and the window held after it carries the rewrite in place",
  () =>
    Effect.gen(function* () {
      const harness = yield* subject();
      const window = yield* followedOnce(harness);
      const { pages, live } = harness;
      // The service answers a message older than the cursor again once its revision passed it.
      const rewrite = {
        ...pageNow("2:1", { holds: false }),
        messages: [
          {
            id: "m-1:0",
            role: "assistant" as const,
            parts: [{ type: "text" as const, text: "Read them all." }],
          },
        ],
      };
      harness.pageNow(rewrite);
      transcriptRows(live, 2);
      yield* settled;

      const toldBefore = pages().length;
      yield* harness.call(GATEWAY_METHOD.AGENTS_TRANSCRIPT_FOLLOW, FOLLOWED);
      yield* settled;
      assert.deepEqual(pages().slice(toldBefore), [
        { transcript: FOLLOWED, page: window },
        { transcript: FOLLOWED, page: windowPage(rewrite) },
      ]);

      yield* harness.call(GATEWAY_METHOD.AGENTS_TRANSCRIPT_UNFOLLOW, FOLLOWED);
      const again = pages().length;
      yield* harness.call(GATEWAY_METHOD.AGENTS_TRANSCRIPT_FOLLOW, FOLLOWED);
      yield* settled;
      const told = pages()[again];
      assert.ok(isRecord(told) && isRecord(told.page));
      assert.equal(told.page.cursor, "2:1");
      assert.deepEqual(told.page.messages, [rewrite.messages[0], window.messages[1]]);
    }),
);

it.effect(
  "a held cursor the service refuses is let go for the newest page, as a follow holding nothing opens, and the refusal is never told",
  () =>
    Effect.gen(function* () {
      const harness = yield* subject();
      const window = yield* followedOnce(harness);
      const { asked, pages } = harness;
      const fresh = newestPage("5:0", "Read afresh.", "41");
      harness.pageNewest(fresh);
      harness.pageNow({ failure: AGENT_CALL_FAILURE.UNANSWERED }, pageNow("6:0", { holds: false }));

      const toldBefore = pages().length;
      const askedBefore = asked.length;
      yield* harness.call(GATEWAY_METHOD.AGENTS_TRANSCRIPT_FOLLOW, FOLLOWED);
      yield* settled;
      assert.deepEqual(
        pages()
          .slice(toldBefore)
          .map((told) => (isRecord(told) ? told.page : undefined)),
        [
          window,
          { ...fresh, newest: true, caughtUp: false },
          windowPage(pageNow("6:0", { holds: false })),
        ],
      );
      assert.deepEqual(asked.slice(askedBefore), [
        `messages-now:${AGENT_ID}:2:0`,
        `messages-newest:${AGENT_ID}:cut`,
        `messages-now:${AGENT_ID}:5:0`,
      ]);
    }),
);

it.effect(
  "a transcript followed again while the service answers no read at all stays followed, and reads on once the service is back",
  () =>
    Effect.gen(function* () {
      const harness = yield* subject();
      yield* followedOnce(harness);
      const { pages } = harness;
      harness.pageNow({ failure: AGENT_CALL_FAILURE.UNANSWERED });
      harness.pageNewest({ failure: AGENT_CALL_FAILURE.UNANSWERED });
      yield* harness.call(GATEWAY_METHOD.AGENTS_TRANSCRIPT_FOLLOW, FOLLOWED);
      yield* settled;
      yield* TestClock.adjust("40 seconds");
      yield* settled;

      const back = pageNow("3:0", { holds: false, text: "Back again." });
      harness.pageNow(back);
      harness.pageNewest(newestPage("3:0", "Back again.", "40"));
      yield* TestClock.adjust("5 seconds");
      yield* settled;
      const told = pages().at(-1);
      assert.ok(isRecord(told) && isRecord(told.page));
      assert.ok(!("failure" in told.page));
      assert.ok(JSON.stringify(told.page.messages).includes("Back again."));
    }),
);

it.effect(
  "a sign-out, a switch of account, and an agent archived each let go of what was held, so the next follow reads the newest page",
  () =>
    Effect.gen(function* () {
      const newestReads = (asked: readonly string[]) =>
        asked.filter((ask) => ask === `messages-newest:${AGENT_ID}:cut`).length;
      const heldTold = (pages: readonly WireValue[]) =>
        pages.filter((told) => isRecord(told) && isRecord(told.page) && told.page.held === true)
          .length;

      const signedOut = yield* subject();
      yield* followedOnce(signedOut);
      yield* signedOut.reset;
      yield* signedOut.call(GATEWAY_METHOD.AGENTS_TRANSCRIPT_FOLLOW, FOLLOWED);
      yield* settled;
      assert.equal(newestReads(signedOut.asked), 2);
      assert.equal(heldTold(signedOut.pages()), 0);

      let account = "user-dana";
      const switched = yield* subject({ accountId: () => account });
      yield* followedOnce(switched);
      account = "user-eli";
      yield* switched.call(GATEWAY_METHOD.AGENTS_TRANSCRIPT_FOLLOW, FOLLOWED);
      yield* settled;
      assert.equal(newestReads(switched.asked), 2);
      assert.equal(heldTold(switched.pages()), 0);

      const archived = yield* subject();
      yield* followedOnce(archived);
      yield* archived.call(GATEWAY_METHOD.AGENTS_ARCHIVE, {
        agentId: AGENT_ID,
        archived: true,
      });
      yield* archived.call(GATEWAY_METHOD.AGENTS_TRANSCRIPT_FOLLOW, FOLLOWED);
      yield* settled;
      assert.equal(newestReads(archived.asked), 2);
      assert.equal(heldTold(archived.pages()), 0);
    }),
);

it.effect(
  "only the transcripts told most recently are held, the least recent let go past the bound",
  () =>
    Effect.gen(function* () {
      const harness = yield* subject();
      const transcripts = Array.from({ length: HELD_TRANSCRIPTS + 1 }, (_, index) => ({
        kind: TRANSCRIPT_KIND.AGENT,
        agentId: `agent-${index}`,
      }));
      for (const transcript of transcripts) yield* followedOnce(harness, transcript);
      const newestReads = (agentId: string) =>
        harness.asked.filter((ask) => ask === `messages-newest:${agentId}:cut`).length;

      const last = transcripts.at(-1) ?? FOLLOWED;
      yield* harness.call(GATEWAY_METHOD.AGENTS_TRANSCRIPT_FOLLOW, last);
      yield* settled;
      assert.equal(newestReads(last.agentId), 1);
      const first = transcripts[0] ?? FOLLOWED;
      yield* harness.call(GATEWAY_METHOD.AGENTS_TRANSCRIPT_FOLLOW, first);
      yield* settled;
      assert.equal(newestReads(first.agentId), 2);
    }),
);

/** That item as a reader who has read it reads it live. */
const LIVE_ITEM: InboxItem = { ...ITEM, unread: false };

/** That item as its row delivers it, what it leaves out held as null. */
const ITEM_ROW = {
  ...LIVE_ITEM,
  startedBy: "user-dana",
  startedByName: null,
  answeredBy: null,
  answeredByName: null,
  closedReason: null,
  closedBy: null,
  closedByName: null,
  openAskMessageId: null,
  settledAt: null,
};

const PLAN_SCOPE = { kind: "plan", id: TASK_ID } as const;

/** Steps taken until the host has told `times` inboxes, since a row's digest is the platform's own promise. */
const toldTimes = (told: () => readonly unknown[], times: number) =>
  Effect.repeat(Effect.yieldNow, { until: () => told().length >= times, times: 10_000 });
const AGENT_SCOPE = { kind: "agent", id: AGENT_ID } as const;

it.effect(
  "a followed plan's inbox is told from its live read once its rows land, again each time they move and never when an answer moved nothing; letting it go ends the telling",
  () =>
    Effect.gen(function* () {
      const { call, asked, sealScope, live, told } = yield* subject();
      sealScope(LIVE_ANSWERED);
      assert.deepEqual(yield* call(GATEWAY_METHOD.AGENTS_INBOX_FOLLOW, PLAN_SCOPE), {});
      yield* settled;
      assert.deepEqual(told(), []);

      live.scope.set({ messages: [], files: [], items: [ITEM_ROW] });
      yield* toldTimes(told, 1);
      live.scope.set({ items: [ITEM_ROW] });
      yield* nextPoll;
      const closed = {
        ...ITEM_ROW,
        revision: 3,
        status: INBOX_STATUS.CLOSED,
        closedReason: "Done",
      };
      live.scope.set({ items: [closed] });
      yield* nextPoll;
      yield* toldTimes(told, 2);
      assert.deepEqual(told(), [
        { scope: PLAN_SCOPE, inbox: { items: [LIVE_ITEM] } },
        {
          scope: PLAN_SCOPE,
          inbox: {
            items: [
              { ...LIVE_ITEM, revision: 3, status: INBOX_STATUS.CLOSED, closedReason: "Done" },
            ],
          },
        },
      ]);
      assert.deepEqual(asked, [`plan-inbox-live:${TASK_ID}`]);

      yield* call(GATEWAY_METHOD.AGENTS_INBOX_UNFOLLOW, PLAN_SCOPE);
      yield* settled;
      live.scope.set({ items: [ITEM_ROW] });
      yield* nextPoll;
      assert.equal(told().length, 2);
    }),
);

it.effect(
  "a message landing after its item's row is told as soon as it lands, its item's thread whole",
  () =>
    Effect.gen(function* () {
      const { call, sealScope, live, told } = yield* subject();
      sealScope(LIVE_ANSWERED);
      yield* call(GATEWAY_METHOD.AGENTS_INBOX_FOLLOW, PLAN_SCOPE);
      yield* settled;
      live.scope.set({ messages: [], files: [], items: [ITEM_ROW] });
      yield* toldTimes(told, 1);
      const message = {
        id: "6f1d2a10-7b0f-4e3b-9a55-5e3b2c1d4c7a",
        itemId: ITEM.id,
        author: INBOX_MESSAGE_AUTHOR.AGENT,
        userId: null,
        name: null,
        text: "Also the staging branch?",
        ask: null,
        answers: null,
        createdAt: ITEM.updatedAt,
      };
      live.scope.set({ messages: [message] });
      yield* nextPoll;
      yield* toldTimes(told, 2);
      assert.equal(told().length, 2);
      assert.ok(JSON.stringify(told()[1]).includes("Also the staging branch?"));
    }),
);

it.effect(
  "an agent's inbox the account does not reach is told not found, one the service answers nothing for is told unanswered, and behind a closed gate every follow is told unanswered",
  () =>
    Effect.gen(function* () {
      const refused = yield* subject();
      refused.sealScope({ failure: AGENT_CALL_FAILURE.NOT_FOUND });
      yield* refused.call(GATEWAY_METHOD.AGENTS_INBOX_FOLLOW, AGENT_SCOPE);
      yield* settled;
      assert.deepEqual(refused.told(), [
        { scope: AGENT_SCOPE, inbox: { failure: AGENT_CALL_FAILURE.NOT_FOUND } },
      ]);

      const unsealed = yield* subject();
      yield* unsealed.call(GATEWAY_METHOD.AGENTS_INBOX_FOLLOW, AGENT_SCOPE);
      yield* settled;
      assert.deepEqual(unsealed.told(), [
        { scope: AGENT_SCOPE, inbox: { failure: AGENT_CALL_FAILURE.UNANSWERED } },
      ]);

      const signedOut = yield* subject({ signedIn: false });
      yield* signedOut.call(GATEWAY_METHOD.AGENTS_INBOX_FOLLOW, PLAN_SCOPE);
      yield* settled;
      assert.deepEqual(signedOut.told(), [
        { scope: PLAN_SCOPE, inbox: { failure: AGENT_CALL_FAILURE.UNANSWERED } },
      ]);
      assert.deepEqual(signedOut.asked, []);
    }),
);

it.effect("a sign-out lets every followed inbox go", () =>
  Effect.gen(function* () {
    const { call, sealScope, live, told, reset } = yield* subject();
    sealScope(LIVE_ANSWERED);
    yield* call(GATEWAY_METHOD.AGENTS_INBOX_FOLLOW, PLAN_SCOPE);
    yield* settled;
    assert.equal(live.scope.held(), 1, "its poll is held while nothing moves");
    yield* reset;
    yield* settled;
    assert.equal(live.scope.held(), 0, "a sign-out lets its poll go");
    assert.deepEqual(told(), []);
  }),
);

/** A run of the account's own automation that failed a second short of a week before now. */
const FAILED_RUN = {
  id: "7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f",
  automationId: "8d2e3f4a-5b6c-4d7e-9f8a-0b1c2d3e4f5a",
  automationName: "Nightly flaky-test sweep",
  workspaceId: WORKSPACE_ID,
  reason: null,
  failedAt: NOW - FAILED_RUN_WINDOW_MILLIS + 1_000,
};

/** Every part of the account's read delivered, the item and run given and nothing else. */
function deliverAccount(
  live: { readonly account: PolledLive<(typeof ACCOUNT_PARTS)[number]> },
  rows: { readonly items?: readonly unknown[]; readonly failedRuns?: readonly unknown[] },
) {
  live.account.set({
    items: rows.items ?? [],
    planless: [],
    plans: [],
    automations: [],
    failedRuns: rows.failedRuns ?? [],
  });
}

it.effect(
  "what waits across the account is told from its live read each time it moves, whole, and a failed run ageing out of the week tells it again",
  () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW);
      const { call, asked, sealAccount, live, accountInboxes } = yield* subject();
      sealAccount(LIVE_ANSWERED);

      yield* call(GATEWAY_METHOD.AGENTS_ACCOUNT_INBOX_FOLLOW);
      yield* settled;
      deliverAccount(live, { items: [WAITING], failedRuns: [FAILED_RUN] });
      yield* settled;
      const [answered] = accountInboxes();
      assert.ok(isRecord(answered) && typeof answered.cursor === "string");
      assert.deepEqual(
        { ...answered, cursor: "" },
        {
          items: [WAITING],
          plans: [],
          planless: [],
          automations: [],
          failedRuns: [FAILED_RUN],
          cursor: "",
          readAt: NOW,
        },
      );
      deliverAccount(live, {
        items: [{ ...WAITING, revision: 3, updatedAt: NOW }],
        failedRuns: [FAILED_RUN],
      });
      yield* nextPoll;
      const moved = accountInboxes().at(-1);
      assert.ok(isRecord(moved) && typeof moved.cursor === "string");
      assert.notEqual(moved.cursor, answered.cursor);
      assert.deepEqual(moved.items, [{ ...WAITING, revision: 3, updatedAt: NOW }]);

      // No row moves as the run ages out of the week, and it is told all the same.
      yield* TestClock.adjust("2 seconds");
      yield* settled;
      const aged = accountInboxes().at(-1);
      assert.ok(isRecord(aged));
      assert.deepEqual(aged.failedRuns, []);
      assert.notEqual(aged.cursor, moved.cursor);
      assert.deepEqual(asked, ["account-inbox-live:user-dana"]);

      // Let go, nothing more is told.
      yield* call(GATEWAY_METHOD.AGENTS_ACCOUNT_INBOX_UNFOLLOW);
      const told = accountInboxes().length;
      deliverAccount(live, { items: [] });
      yield* nextPoll;
      assert.equal(accountInboxes().length, told);
    }),
);

it.effect(
  "the account inbox is told unanswered with nobody signed in, and a session the service signs out is read again after a rest, telling nothing meanwhile",
  () =>
    Effect.gen(function* () {
      const nobody = yield* subject({ accountId: () => undefined });
      nobody.sealAccount(LIVE_ANSWERED);
      yield* nobody.call(GATEWAY_METHOD.AGENTS_ACCOUNT_INBOX_FOLLOW);
      yield* settled;
      assert.deepEqual(nobody.accountInboxes(), [{ failure: AGENT_CALL_FAILURE.UNANSWERED }]);
      assert.deepEqual(nobody.asked, []);

      const { call, asked, sealAccount, accountInboxes } = yield* subject();
      sealAccount(LIVE_SIGNED_OUT);
      yield* call(GATEWAY_METHOD.AGENTS_ACCOUNT_INBOX_FOLLOW);
      yield* settled;
      assert.deepEqual(asked, ["account-inbox-live:user-dana"]);
      yield* TestClock.adjust("5 seconds");
      yield* settled;
      assert.deepEqual(asked, ["account-inbox-live:user-dana", "account-inbox-live:user-dana"]);
      assert.deepEqual(accountInboxes(), []);
      yield* call(GATEWAY_METHOD.AGENTS_ACCOUNT_INBOX_UNFOLLOW);
    }),
);

/** The channel the account's items live in, and another one moved to. */
const CHANNEL_ID = "1f2e3d4c-5b6a-4978-8695-a4b3c2d1e0f9";
const OTHER_CHANNEL_ID = "2a3b4c5d-6e7f-4a8b-9c0d-1e2f3a4b5c6d";

/** The item as the account's items read sends it, in its channel. */
const HELD_ITEM: InboxItem = { ...LIVE_ITEM, channelId: CHANNEL_ID };

/** A second task of the account's, and an item on it changed a minute before the first. */
const OTHER_TASK_ID = "3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f";
const OTHER_PLAN_SCOPE = { kind: "plan", id: OTHER_TASK_ID } as const;
const OTHER_ITEM: InboxItem = {
  ...HELD_ITEM,
  id: "6a7b8c9d-0e1f-4a2b-8c3d-4e5f6a7b8c9d",
  key: "deploy",
  title: "Deploy to staging?",
  updatedAt: ITEM.updatedAt - 60_000,
};

/** Where an item on `planId` stands as its stamp carries it, waiting on Dana with nothing on its thread, unless `moved` says otherwise. */
function stampOf(item: InboxItem, planId: string, moved: Record<string, unknown> = {}) {
  return {
    id: item.id,
    planId,
    agentId: item.agentId,
    revision: item.revision,
    version: item.version,
    status: item.status,
    updatedAt: item.updatedAt,
    unread: item.unread ?? false,
    waitsOn: "user-dana",
    channelId: item.channelId ?? CHANNEL_ID,
    messages: 0,
    ...moved,
  };
}

/** The account's items' read moved to the stamps given, the items given its rows, each as `row` writes it. */
function deliverItems(
  live: { readonly items: PolledLive<(typeof ITEMS_PARTS)[number]> },
  stamps: readonly unknown[],
  items: readonly (InboxItem | Record<string, unknown>)[],
) {
  live.items.set({
    stamps,
    items: items.map((item) => ({ ...ITEM_ROW, ...item })),
    messages: [],
    files: [],
  });
}

it.effect(
  "the account's items are told whole by plan once their rows land, then only the plan an item moved on",
  () =>
    Effect.gen(function* () {
      const { call, sealItems, live, accountItems } = yield* subject();
      sealItems(LIVE_ANSWERED);
      yield* call(GATEWAY_METHOD.AGENTS_ACCOUNT_ITEMS_FOLLOW);
      yield* settled;
      const both = [stampOf(HELD_ITEM, TASK_ID), stampOf(OTHER_ITEM, OTHER_TASK_ID)];
      deliverItems(live, both, [HELD_ITEM, OTHER_ITEM]);
      yield* toldTimes(accountItems, 1);

      const moved = { ...HELD_ITEM, revision: 3, updatedAt: HELD_ITEM.updatedAt + 1_000 };
      deliverItems(live, [stampOf(moved, TASK_ID), both[1]], [moved, OTHER_ITEM]);
      yield* nextPoll;
      yield* toldTimes(accountItems, 2);

      assert.deepEqual(accountItems(), [
        {
          whole: true,
          scopes: [
            { scope: OTHER_PLAN_SCOPE, items: [OTHER_ITEM] },
            { scope: PLAN_SCOPE, items: [HELD_ITEM] },
          ],
        },
        { whole: false, scopes: [{ scope: PLAN_SCOPE, items: [moved] }] },
      ]);
    }),
);

it.effect(
  "an item's read mark and channel moving with no resend are patched from its stamp, and who it waits on moving asks for it again from its change",
  () =>
    Effect.gen(function* () {
      const { call, asked, sealItems, live, accountItems } = yield* subject();
      sealItems(LIVE_ANSWERED);
      yield* call(GATEWAY_METHOD.AGENTS_ACCOUNT_ITEMS_FOLLOW);
      yield* settled;
      deliverItems(
        live,
        [stampOf(HELD_ITEM, TASK_ID), stampOf(OTHER_ITEM, OTHER_TASK_ID)],
        [HELD_ITEM, OTHER_ITEM],
      );
      yield* toldTimes(accountItems, 1);

      // Only the stamp moves: the item changed before the latest held, so it is not sent.
      const marked = { ...OTHER_ITEM, unread: true, channelId: OTHER_CHANNEL_ID };
      deliverItems(
        live,
        [stampOf(HELD_ITEM, TASK_ID), stampOf(marked, OTHER_TASK_ID)],
        [HELD_ITEM, OTHER_ITEM],
      );
      yield* nextPoll;
      yield* toldTimes(accountItems, 2);

      const reassigned = { ...marked, waitsOn: { userId: "user-sam", name: "Sam" } };
      deliverItems(
        live,
        [stampOf(HELD_ITEM, TASK_ID), stampOf(marked, OTHER_TASK_ID, { waitsOn: "user-sam" })],
        [HELD_ITEM, { ...marked, waitsOn: "user-sam", waitsOnName: "Sam" }],
      );
      yield* nextPoll;
      yield* nextPoll;
      yield* toldTimes(accountItems, 3);

      assert.deepEqual(accountItems().slice(1), [
        { whole: false, scopes: [{ scope: OTHER_PLAN_SCOPE, items: [marked] }] },
        { whole: false, scopes: [{ scope: OTHER_PLAN_SCOPE, items: [reassigned] }] },
      ]);
      assert.deepEqual(
        asked.filter((each) => each.startsWith("account-items-again:")),
        [`account-items-again:${OTHER_ITEM.updatedAt}`],
      );
    }),
);

it.effect("an item no stamp names any more is dropped, its plan told holding nothing", () =>
  Effect.gen(function* () {
    const { call, sealItems, live, accountItems } = yield* subject();
    sealItems(LIVE_ANSWERED);
    yield* call(GATEWAY_METHOD.AGENTS_ACCOUNT_ITEMS_FOLLOW);
    yield* settled;
    deliverItems(
      live,
      [stampOf(HELD_ITEM, TASK_ID), stampOf(OTHER_ITEM, OTHER_TASK_ID)],
      [HELD_ITEM, OTHER_ITEM],
    );
    yield* toldTimes(accountItems, 1);

    deliverItems(live, [stampOf(HELD_ITEM, TASK_ID)], [HELD_ITEM]);
    yield* nextPoll;
    yield* toldTimes(accountItems, 2);

    assert.deepEqual(accountItems()[1], {
      whole: false,
      scopes: [{ scope: OTHER_PLAN_SCOPE, items: [] }],
    });
  }),
);

it.effect(
  "a window following the account's items through a sign-out is told there are none, then the next account's items whole once it signs in",
  () =>
    Effect.gen(function* () {
      let signedIn: string | undefined = "user-dana";
      const { call, asked, sealItems, live, accountItems, reset } = yield* subject({
        accountId: () => signedIn,
      });
      sealItems(LIVE_ANSWERED);
      yield* call(GATEWAY_METHOD.AGENTS_ACCOUNT_ITEMS_FOLLOW);
      yield* settled;
      deliverItems(live, [stampOf(HELD_ITEM, TASK_ID)], [HELD_ITEM]);
      yield* toldTimes(accountItems, 1);

      signedIn = undefined;
      yield* reset;
      yield* settled;
      signedIn = "user-sam";
      deliverItems(live, [stampOf(OTHER_ITEM, OTHER_TASK_ID)], [OTHER_ITEM]);
      yield* TestClock.adjust("5 seconds");
      yield* toldTimes(accountItems, 3);

      assert.deepEqual(accountItems().slice(1), [
        { failure: AGENT_CALL_FAILURE.UNANSWERED },
        { whole: true, scopes: [{ scope: OTHER_PLAN_SCOPE, items: [OTHER_ITEM] }] },
      ]);
      assert.deepEqual(
        asked.filter((each) => each.startsWith("account-items-live:")),
        ["account-items-live:user-dana", "account-items-live:user-sam"],
      );
    }),
);

/** Whether the last telling of a plan's inbox, and of the account's items, holds the item as `holds` reads it. */
function bothHold(
  harness: {
    readonly told: () => readonly WireValue[];
    readonly accountItems: () => readonly unknown[];
  },
  holds: (item: InboxItem) => boolean,
): readonly [boolean, boolean] {
  const firstOf = (items: WireValue | undefined) => {
    const first = Array.isArray(items) ? items[0] : undefined;
    // SAFETY: a telling's items are inbox items, as the window is told them.
    return first === undefined ? false : holds(first as InboxItem);
  };
  const plan = harness.told().at(-1);
  // SAFETY: the account's items are told as wire values, each scope's items sorted in place.
  const account = harness.accountItems().at(-1) as WireValue | undefined;
  const scope = isRecord(account) && Array.isArray(account.scopes) ? account.scopes[0] : undefined;
  return [
    firstOf(isRecord(plan) && isRecord(plan.inbox) ? plan.inbox.items : undefined),
    firstOf(isRecord(scope) ? scope.items : undefined),
  ];
}

it.effect(
  "a mark on an item a plan's inbox and the account's items both hold draws in both at once and holds there until each carries its transaction, and a close the agent overtook lands on the service's word in both",
  () =>
    Effect.gen(function* () {
      const harness = yield* subject();
      const { call, sealScope, sealItems, live, commitIn, changeFirst } = harness;
      sealScope(LIVE_ANSWERED);
      sealItems(LIVE_ANSWERED);
      yield* call(GATEWAY_METHOD.AGENTS_INBOX_FOLLOW, PLAN_SCOPE);
      yield* call(GATEWAY_METHOD.AGENTS_ACCOUNT_ITEMS_FOLLOW);
      yield* settled;
      // Each read is woken by a write once, so each hands a wait for the next.
      live.scope.set({ items: [ITEM_ROW], messages: [], files: [] }, ["9100"]);
      live.items.set(
        {
          stamps: [stampOf(HELD_ITEM, TASK_ID)],
          items: [{ ...ITEM_ROW, ...HELD_ITEM }],
          messages: [],
          files: [],
        },
        ["9100"],
      );
      yield* toldTimes(harness.told, 1);
      yield* toldTimes(harness.accountItems, 1);
      const unread = (item: InboxItem) => item.unread === true;

      commitIn("9200");
      const marking = yield* Effect.forkChild(
        call(GATEWAY_METHOD.AGENTS_INBOX_READ_STATE, { itemId: ITEM.id, unread: true }),
      );
      yield* settled;
      assert.deepEqual(bothHold(harness, unread), [true, true]);

      // The account's items carry the mark first, and the plan's inbox answers once more from before it.
      live.items.set({ stamps: [stampOf(HELD_ITEM, TASK_ID, { unread: true })], items: [] }, [
        "9200",
      ]);
      live.scope.set({ items: [ITEM_ROW] });
      yield* nextPoll;
      assert.deepEqual(bothHold(harness, unread), [true, true]);
      assert.equal(marking.pollUnsafe(), undefined);

      live.scope.set({ items: [{ ...ITEM_ROW, unread: true }] }, ["9200"]);
      yield* nextPoll;
      assert.deepEqual(yield* Fiber.join(marking), { id: ITEM.id, unread: true, txid: "9200" });
      assert.deepEqual(bothHold(harness, unread), [true, true]);

      const overtaken = { ...LIVE_ITEM, revision: 3, title: "Push to main instead?" };
      changeFirst(overtaken);
      commitIn(undefined);
      const closing = yield* Effect.forkChild(
        call(GATEWAY_METHOD.AGENTS_INBOX_CLOSE, {
          itemId: ITEM.id,
          revision: ITEM.revision,
          clientKey: "close-1",
        }),
      );
      yield* settled;
      assert.deepEqual(yield* Fiber.join(closing), { item: overtaken, taken: false });
      assert.deepEqual(
        bothHold(harness, (item) => item.status === INBOX_STATUS.OPEN && item.revision === 3),
        [true, true],
      );
    }),
);

it.effect(
  "a plain reply the service answers with no transaction lands as the service answered its item in every inbox holding it",
  () =>
    Effect.gen(function* () {
      const harness = yield* subject();
      const { call, sealScope, sealItems, live } = harness;
      sealScope(LIVE_ANSWERED);
      sealItems(LIVE_ANSWERED);
      yield* call(GATEWAY_METHOD.AGENTS_INBOX_FOLLOW, PLAN_SCOPE);
      yield* call(GATEWAY_METHOD.AGENTS_ACCOUNT_ITEMS_FOLLOW);
      yield* settled;
      live.scope.set({ items: [ITEM_ROW], messages: [], files: [] });
      deliverItems(live, [stampOf(HELD_ITEM, TASK_ID)], [HELD_ITEM]);
      yield* toldTimes(harness.told, 1);
      yield* toldTimes(harness.accountItems, 1);
      const replied = (item: InboxItem) => JSON.stringify(item).includes(MESSAGE_ID);
      assert.deepEqual(bothHold(harness, replied), [false, false]);

      yield* call(GATEWAY_METHOD.AGENTS_INBOX_MESSAGE, {
        itemId: ITEM.id,
        text: "Push it after the tests pass.",
        clientKey: "reply-1",
      });
      yield* settled;
      assert.deepEqual(bothHold(harness, replied), [true, true]);
    }),
);

it.effect(
  "a close drops its question from what waits across the account, its task counting one fewer, the moment it is asked and before the account's read carries it",
  () =>
    Effect.gen(function* () {
      const { call, sealAccount, live, commitIn, accountInboxes } = yield* subject();
      sealAccount(LIVE_ANSWERED);
      yield* call(GATEWAY_METHOD.AGENTS_ACCOUNT_INBOX_FOLLOW);
      yield* settled;
      const plan = { planId: TASK_ID, items: 1, toDo: 1, updatedAt: ITEM.updatedAt };
      const parts = { planless: [], automations: [], failedRuns: [] };
      live.account.set({ ...parts, items: [WAITING], plans: [plan] }, ["9100"]);
      yield* toldTimes(accountInboxes, 1);
      /** What waits, and each task's count, as the account inbox was last told. */
      const waiting = () => {
        const told = accountInboxes().at(-1);
        assert.ok(isRecord(told) && Array.isArray(told.items) && Array.isArray(told.plans));
        return {
          items: told.items.length,
          toDo: told.plans.map((each) => (isRecord(each) ? each.toDo : undefined)),
        };
      };
      assert.deepEqual(waiting(), { items: 1, toDo: [1] });

      commitIn("9300");
      const closing = yield* Effect.forkChild(
        call(GATEWAY_METHOD.AGENTS_INBOX_CLOSE, {
          itemId: ITEM.id,
          revision: ITEM.revision,
          clientKey: "close-1",
        }),
      );
      yield* settled;
      assert.deepEqual(waiting(), { items: 0, toDo: [0] });
      assert.equal(closing.pollUnsafe(), undefined);

      live.account.set({ ...parts, items: [], plans: [{ ...plan, toDo: 0 }] }, ["9300"]);
      yield* nextPoll;
      yield* Fiber.join(closing);
      assert.deepEqual(waiting(), { items: 0, toDo: [0] });
    }),
);

it.effect(
  "a rename, an archive, a change of model, and a switch of MCP servers each stand on the agent's row of the task list from the press, and an archive a dialog waits on draws nothing until it is answered",
  () =>
    Effect.gen(function* () {
      const drawn: (readonly AgentSummary[])[] = [];
      const list = yield* taskListCollections({
        draw: ({ taskAgents }) => void drawn.push(taskAgents),
        txWait: () => undefined,
      });
      yield* list.answer({ plans: [], agents: [{ ...agentListRow(TASK_ID, NOW), id: AGENT_ID }] });
      const answered = yield* Deferred.make<void>();
      const { call, holdChanges } = yield* subject({ writeAgent: list.writeAgent });
      holdChanges(Deferred.await(answered));
      const standing = () => drawn.at(-1)?.[0];

      const asked = yield* Effect.forkChild(
        Effect.all(
          [
            call(GATEWAY_METHOD.AGENTS_RENAME, { agentId: AGENT_ID, title: "Sign-out button" }),
            call(GATEWAY_METHOD.AGENTS_ARCHIVE, { agentId: AGENT_ID, archived: true }),
            call(GATEWAY_METHOD.AGENTS_CHOOSE, {
              agentId: AGENT_ID,
              model: "openai/gpt-6.1-sol",
              effort: "low",
            }),
            call(GATEWAY_METHOD.AGENTS_SERVERS, { agentId: AGENT_ID, disabledServers: ["linear"] }),
          ],
          { concurrency: "unbounded" },
        ),
      );
      yield* settled;
      const pressed = standing();
      yield* Deferred.succeed(answered, undefined);
      yield* Fiber.join(asked);

      const held = yield* Deferred.make<void>();
      holdChanges(Deferred.await(held));
      const asking = yield* Effect.forkChild(
        call(GATEWAY_METHOD.AGENTS_ARCHIVE, {
          agentId: AGENT_ID,
          archived: false,
          drawn: ARCHIVE_DRAWN.ON_ANSWER,
        }),
      );
      yield* settled;
      const dialog = standing()?.archivedAt;
      yield* Deferred.succeed(held, undefined);
      yield* Fiber.join(asking);

      assert.deepEqual(
        [pressed?.title, pressed?.archivedAt, pressed?.model, pressed?.effort],
        ["Sign-out button", NOW, "openai/gpt-6.1-sol", "low"],
      );
      assert.deepEqual(pressed?.disabledServers, ["linear"]);
      assert.equal(dialog, NOW, "the dialog's unarchive is not drawn while it is out");
    }),
);

it.effect(
  "a Start answers its agent once the task list carries the Start's transaction, so its tab finds the agent the list draws",
  () =>
    Effect.gen(function* () {
      const carried = yield* Deferred.make<void>();
      const waited: (string | undefined)[] = [];
      const { call, startCommits } = yield* subject({
        listed: (txid) =>
          Effect.andThen(
            Effect.sync(() => waited.push(txid)),
            Deferred.await(carried),
          ),
      });
      startCommits("9104");

      const starting = yield* Effect.forkChild(
        call(GATEWAY_METHOD.AGENTS_START, { taskId: TASK_ID, idempotencyKey: "press-1" }),
      );
      yield* settled;
      assert.equal(starting.pollUnsafe(), undefined, "no answer while the list is behind");

      yield* Deferred.succeed(carried, undefined);
      assert.deepEqual(waited, ["9104"]);
      assert.deepEqual(yield* Fiber.join(starting), {
        agent: { ...AGENT, status: AGENT_STATUS.STARTING },
        txid: "9104",
      });
    }),
);

it.effect(
  "a workspace's memories are read and one is forgotten, each one ask of the service naming the workspace; a read naming no workspace or a forget naming no memory id is refused before it, and a closed gate answers unanswered",
  () =>
    Effect.gen(function* () {
      const { call, asked } = yield* subject();
      const signedOut = yield* subject({ signedIn: false });

      const read = yield* call(GATEWAY_METHOD.MEMORIES_READ, { workspaceId: WORKSPACE_ID });
      const forgotten = yield* call(GATEWAY_METHOD.MEMORIES_FORGET, {
        workspaceId: WORKSPACE_ID,
        id: MEMORY.id,
      });
      const refused = [
        yield* Effect.flip(
          call(GATEWAY_METHOD.MEMORIES_FORGET, { workspaceId: WORKSPACE_ID, id: "not-a-memory" }),
        ),
        yield* Effect.flip(call(GATEWAY_METHOD.MEMORIES_READ, {})),
      ];
      const unanswered = yield* signedOut.call(GATEWAY_METHOD.MEMORIES_READ, {
        workspaceId: WORKSPACE_ID,
      });

      assert.deepEqual(read, { memories: [MEMORY] });
      assert.deepEqual(forgotten, { memories: [] });
      assert.deepEqual(
        refused.map((refusal) => refusal._tag),
        ["InvalidParamsRefusal", "InvalidParamsRefusal"],
      );
      assert.deepEqual(unanswered, { failure: AGENT_CALL_FAILURE.UNANSWERED });
      assert.deepEqual(asked, [`memories:${WORKSPACE_ID}`, `forget:${WORKSPACE_ID}:${MEMORY.id}`]);
      assert.deepEqual(signedOut.asked, []);
    }),
);
