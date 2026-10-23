import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import type { AccountInboxEntry } from "@luke/features/account-inbox-wire";
import { CHAPTERS_MODEL } from "@luke/features/chapters-model-choice";
import { MEMBER_KIND } from "@luke/features/chat-wire";
import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentChatWriteAnswerView,
  TRANSCRIPT_KIND,
} from "@luke/features/coding-agent-view";
import {
  CHANGED_FILE_STATUS,
  CHECK_SUMMARY,
  CODING_AGENT_BOUNDS,
  CODING_AGENT_CURSOR_START,
  CODING_AGENT_STATUS,
  type CodingAgentNewestAnswer,
  type CodingAgentPage,
  type CodingAgentSummary,
  MERGE_STATE,
  PULL_REQUEST_STATE,
} from "@luke/features/coding-agent-wire";
import { GITHUB_IMAGE_TYPE } from "@luke/features/github-image";
import { GITHUB_TOKEN_REJECTION } from "@luke/features/github-token-wire";
import {
  INBOX_IMAGE_TYPE,
  INBOX_MESSAGE_AUTHOR,
  INBOX_REPLY,
  INBOX_RESPONSE,
  INBOX_STATUS,
  INBOX_WIRE_VERSION,
  type InboxItem,
} from "@luke/features/inbox-wire";
import { INTEGRATION_PROVIDER } from "@luke/features/integration-wire";
import {
  type AccountInboxLiveAnswer,
  type AgentTranscriptLiveAnswer,
  FAILED_RUN_WINDOW_MILLIS,
  LIVE_SIGNED_OUT,
  type ScopeInboxLiveAnswer,
  type TranscriptNowAnswer,
  type WorkspaceChatLiveAnswer,
} from "@luke/features/live-wire";
import type { MemorySummary } from "@luke/features/memory-wire";
import { MODEL_PROVIDER } from "@luke/features/models-wire";
import {
  DEFAULT_PLAN_TEMPLATE,
  type PlanTemplateRevisionLine,
} from "@luke/features/plan-document-template";
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
import { PLAN_ACTOR } from "@luke/features/task-wire";
import {
  GATEWAY_CLIENT_ROLE,
  GATEWAY_EVENT,
  GATEWAY_METHOD,
  type GatewayEventKind,
  type GatewayMethod,
} from "@luke/gateway";
import { isRecord, type WireRecord, type WireValue } from "@luke/wire";
import { noNetwork } from "@luke/wire/testing";
import { Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";
import { type CodingAgentClient, composeCodingAgents } from "./compose-coding-agents.js";
import { fakeRealtime } from "./testing/fake-realtime.js";
import { HELD_TRANSCRIPTS } from "./transcript-held.js";

/** One revision of the template as the service lists it. */
const TEMPLATE_REVISION: PlanTemplateRevisionLine = {
  seq: 2,
  lastEdit: { actor: PLAN_ACTOR.DEVELOPER, at: 1_000, duringCall: false },
  startedAt: 1_000,
  changes: 1,
};

const TASK_ID = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
const AGENT_ID = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";
const WORKSPACE_ID = "2a9c4e6f-1b3d-4f5a-8c7e-9d0b1a2c3e4f";
const MEMBER_ID = "4e2b8c1d-5f3a-4b6c-9d7e-8f1a2b3c4d5e";

/** A workspace's chat as the service answers it: the reader alone, nothing posted yet. */
const _CHAT = {
  self: MEMBER_ID,
  readSeq: 0,
  members: [{ id: MEMBER_ID, kind: MEMBER_KIND.HUMAN, name: "Ada", left: false }],
  channels: [],
  messages: [],
  cursor: "1",
};

const AGENT: CodingAgentSummary = {
  id: AGENT_ID,
  planId: TASK_ID,
  model: "anthropic/claude-opus-5.5",
  effort: "high",
  title: null,
  createdAt: 1_800_000_000_000,
  status: CODING_AGENT_STATUS.RUNNING,
  turnId: "9d2b7b5a-4e3f-4e9c-9c77-7a5d8b3f4c32",
};

/** The agent as its own page reads it, with no task, as an automation's run leaves one. */
const PAGE: CodingAgentPage = {
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
  blocks: [],
  response: { type: INBOX_RESPONSE.APPROVAL },
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
  status: CODING_AGENT_STATUS.RUNNING,
  title: null,
};

/** The service as a script, writing down every ask in the order it was made. */
function fakeService() {
  const asked: string[] = [];
  let scope: ScopeInboxLiveAnswer | { readonly failure: "not-found" } | undefined;
  let cursor = CODING_AGENT_CURSOR_START;
  let transcript: AgentTranscriptLiveAnswer | { readonly failure: "not-found" } | undefined;
  let chatLive: WorkspaceChatLiveAnswer | { readonly failure: "not-found" } | undefined;
  let written: CodingAgentChatWriteAnswerView = { readSeq: 4 };
  let accountLive: AccountInboxLiveAnswer | typeof LIVE_SIGNED_OUT | undefined;
  // Each page read at once, in turn; the last stands once the others are read.
  let pagesNow: readonly (TranscriptNowAnswer | { readonly failure: "unanswered" })[] = [];
  // The newest page, as the follow opens with it; none answers one with something on it.
  let newestPage: CodingAgentNewestAnswer | { readonly failure: "unanswered" } | undefined;
  // The transaction a pin answers it committed in, where it answers one.
  let startTxid: string | undefined;
  let pinTxid: string | undefined;
  // The transaction the service says each inbox write committed in; none says it changed nothing.
  let committedIn: { readonly txid?: string } = {};
  /** The transaction the service says wrote a sent message's row; none says none was written. */
  let sentTxid: string | undefined;
  const client: CodingAgentClient = {
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
        const agent = { ...AGENT, status: CODING_AGENT_STATUS.STARTING };
        return startTxid === undefined ? { agent } : { agent, txid: startTxid };
      }),
    startFrom: (request) =>
      Effect.sync(() => {
        asked.push(`start-from:${request.from?.agentId}:${request.idempotencyKey}`);
        return { agent: { ...AGENT, status: CODING_AGENT_STATUS.STARTING } };
      }),
    messagesNow: (agentId, after, callId) =>
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
    messagesNewest: (agentId, callId, cut) =>
      Effect.sync(() => {
        asked.push(
          (callId === undefined
            ? `messages-newest:${agentId}`
            : `worker-newest:${agentId}:${callId}`) + (cut === true ? ":cut" : ""),
        );
        // Note that the service answers an agent the account does not reach not found on every read alike.
        if (transcript !== undefined && "failure" in transcript) return transcript;
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
    agentTranscriptLive: (agentId, _userId, callId, poll) =>
      Effect.sync(() => {
        asked.push(
          `${poll === true ? "transcript-poll" : "transcript-live"}:${agentId}${callId === undefined ? "" : `:${callId}`}`,
        );
        return transcript ?? { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED };
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
      Effect.sync(() => {
        asked.push(`choose:${agentId}:${choice.model}:${choice.effort}`);
        return { agent: { ...AGENT, ...choice } };
      }),
    rename: (agentId, request) =>
      Effect.sync(() => {
        asked.push(`rename:${agentId}:${request.title}`);
        return { agent: { ...AGENT, title: request.title } };
      }),
    switchServers: (agentId, request) =>
      Effect.sync(() => {
        asked.push(`servers:${agentId}:${request.disabledServers.join(",")}`);
        return { agent: { ...AGENT, disabledServers: request.disabledServers } };
      }),
    stop: (agentId) =>
      Effect.sync(() => {
        asked.push(`stop:${agentId}`);
        return { agent: { ...AGENT, status: CODING_AGENT_STATUS.CANCELLED } };
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
      Effect.sync(() => {
        asked.push(`archive:${agentId}:${String(request.archived)}`);
        return { agent: { ...AGENT, archivedAt: 1_800_000_120_000 } };
      }),
    pin: (agentId, request) =>
      Effect.sync(() => {
        asked.push(`pin:${agentId}:${String(request.pinned)}`);
        return pinTxid === undefined ? { agent: AGENT } : { agent: AGENT, txid: pinTxid };
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
    calls: (agentId) =>
      Effect.sync(() => {
        asked.push(`calls:${agentId}`);
        return { transcript: { calls: [], earlierOmitted: false } };
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
    readPlanTemplate: () =>
      Effect.sync(() => {
        asked.push("template");
        return { template: DEFAULT_PLAN_TEMPLATE, custom: false };
      }),
    writePlanTemplate: (write) =>
      Effect.sync(() => {
        asked.push(`template:${write.template ?? "the default"}`);
        return {
          template: write.template ?? DEFAULT_PLAN_TEMPLATE,
          custom: write.template !== null,
        };
      }),
    readPlanTemplateRevisions: (page) =>
      Effect.sync(() => {
        asked.push(`revisions:${page.before ?? "newest"}`);
        return { revisions: [TEMPLATE_REVISION] };
      }),
    readPlanTemplateRevision: (revision) =>
      Effect.sync(() => {
        asked.push(`revision:${revision.seq}`);
        return {
          revision: {
            seq: revision.seq,
            document: { body: "## Why\n", assumptions: [] },
            previous: null,
          },
        };
      }),
    restorePlanTemplate: (revision) =>
      Effect.sync(() => {
        asked.push(`restore:${revision.seq}`);
        return { template: "## Why\n", custom: true };
      }),
    transcribeDictation: (clip) =>
      Effect.sync(() => {
        asked.push(`transcribe:${clip.audio}:${clip.keywords.join(",")}`);
        return { text: "Run the tests" };
      }),
    taskInboxLive: (taskId) =>
      Effect.sync(() => {
        asked.push(`plan-inbox-live:${taskId}`);
        return scope ?? { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED };
      }),
    agentInboxLive: (agentId) =>
      Effect.sync(() => {
        asked.push(`agent-inbox-live:${agentId}`);
        return scope ?? { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED };
      }),
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
        return {
          item: { ...ITEM, status: INBOX_STATUS.CLOSED, closedBy: { userId: "u1", name: "Dana" } },
          taken: true,
          ...committedIn,
        };
      }),
    answerInbox: (itemId, request) =>
      Effect.sync(() => {
        asked.push(
          `answer:${itemId}:${request.revision}:${request.reply}:${request.note ?? ""}:${request.clientKey}`,
        );
        return {
          item: {
            ...ITEM,
            revision: 3,
            status: INBOX_STATUS.ANSWERED,
            answer: { reply: request.reply },
          },
          taken: true,
        };
      }),
    accountInboxLive: (userId, poll) =>
      Effect.sync(() => {
        asked.push(`account-inbox-live:${userId}${poll ? ":poll" : ""}`);
        return accountLive ?? { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED };
      }),
    chatPost: (workspaceId, write) =>
      Effect.sync(() => {
        asked.push(`chat-post:${workspaceId}:${JSON.stringify(write)}`);
        return written;
      }),
    chatJoin: (workspaceId) =>
      Effect.sync(() => {
        asked.push(`chat-join:${workspaceId}`);
        return chatLive !== undefined && "failure" in chatLive ? chatLive : { self: MEMBER_ID };
      }),
    workspaceChatLive: (workspaceId, userId, poll) =>
      Effect.sync(() => {
        asked.push(`chat-live:${workspaceId}:${userId}${poll ? ":poll" : ""}`);
        return chatLive ?? { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED };
      }),
    chatAttachment: (workspaceId, messageId, attachmentId) =>
      Effect.sync(() => {
        asked.push(`chat-attachment:${workspaceId}:${messageId}:${attachmentId}`);
        return { contentType: INBOX_IMAGE_TYPE.PNG, base64: "iVBORw0KGgo=" };
      }),
  };
  return {
    client,
    asked,
    /** What the service seals for following a transcript, or that the account reaches no such agent; none answers unanswered. */
    sealTranscript: (
      next: AgentTranscriptLiveAnswer | { readonly failure: "not-found" } | undefined,
    ) => {
      transcript = next;
    },
    /** What the service answers a write to a workspace's chat. */
    answerWrites: (next: CodingAgentChatWriteAnswerView) => {
      written = next;
    },
    /** What the service seals for following a workspace's chat, or that the account is not in it; none answers unanswered. */
    sealChat: (next: WorkspaceChatLiveAnswer | { readonly failure: "not-found" } | undefined) => {
      chatLive = next;
    },
    /** The pages the service answers read at once, in turn, or that it did not answer one. */
    pageNow: (...pages: readonly (TranscriptNowAnswer | { readonly failure: "unanswered" })[]) => {
      pagesNow = pages;
    },
    /** The newest page the service answers. */
    pageNewest: (page: CodingAgentNewestAnswer | { readonly failure: "unanswered" }) => {
      newestPage = page;
    },
    /** The transaction the service answers a sent message with. */
    sendTxid: (txid: string | undefined) => {
      sentTxid = txid;
    },
    /** What the service seals for following a plan's or an agent's inbox, or that the account reaches none; none answers unanswered. */
    sealScope: (next: ScopeInboxLiveAnswer | { readonly failure: "not-found" } | undefined) => {
      scope = next;
    },
    /** The transaction the service says each inbox write committed in from now on; none says it changed nothing. */
    commitIn: (txid: string | undefined) => {
      committedIn = txid === undefined ? {} : { txid };
    },
    /** What the service seals for following the account inbox, or that the session signed out; none answers unanswered. */
    sealAccount: (next: AccountInboxLiveAnswer | typeof LIVE_SIGNED_OUT | undefined) => {
      accountLive = next;
    },
    /** The transaction a Start answers it committed in; none answers none. */
    startCommits: (txid: string | undefined) => {
      startTxid = txid;
    },
    /** The transaction a pin answers it committed in; none answers none. */
    pinCommits: (txid: string | undefined) => {
      pinTxid = txid;
    },
  };
}

/** Now, as the host reads it in these tests. */
const NOW = 1_800_000_100_000;

/** A sealed statement as the service answers one, named by the part it follows. */
function sealed(part: string, expiresAt = NOW + 60_000) {
  return { capability: `capability-${part}`, queryFingerprint: `fingerprint-${part}`, expiresAt };
}

/** Every step a subscription has to take, taken: it runs on a fiber of its own. */
const settled = Effect.repeat(Effect.yieldNow, { times: 100 });

function subject(
  options: {
    signedIn?: boolean;
    sendsNetwork?: boolean;
    typeIntoCall?: (agentId: string, text: string, clientKey: string) => boolean;
    accountId?: () => string | undefined;
    listed?: (txid: string | undefined) => Effect.Effect<void>;
  } = {},
) {
  return Effect.gen(function* () {
    const service = fakeService();
    const realtime = fakeRealtime();
    // Each event with how many reads the service had been asked as it was told.
    const events: { kind: GatewayEventKind; payload: WireValue; asked: number }[] = [];
    const composer = yield* composeCodingAgents({
      kernel: {
        runMode: { sendsNetwork: options.sendsNetwork ?? true },
        emit: (kind, payload) => void events.push({ kind, payload, asked: service.asked.length }),
        now: () => NOW,
      },
      account: { capabilitiesActive: () => options.signedIn ?? true },
      accountId: options.accountId ?? (() => "user-dana"),
      client: service.client,
      openLive: realtime.open,
      ...(options.typeIntoCall === undefined ? undefined : { typeIntoCall: options.typeIntoCall }),
      ...(options.listed === undefined ? undefined : { listed: options.listed }),
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
      pinCommits: service.pinCommits,
      startCommits: service.startCommits,
      sealTranscript: service.sealTranscript,
      sealChat: service.sealChat,
      answerWrites: service.answerWrites,
      /** Every workspace chat the host said changed, in order. */
      chats: () =>
        events.flatMap((event) =>
          event.kind === GATEWAY_EVENT.CHAT_CHANGED ? [event.payload] : [],
        ),
      pageNow: service.pageNow,
      pageNewest: service.pageNewest,
      sendTxid: service.sendTxid,
      sealScope: service.sealScope,
      sealAccount: service.sealAccount,
      commitIn: service.commitIn,
      realtime,
      /** Every answer of the followed account inbox the host told, in order. */
      accountInboxes: () =>
        events.flatMap((event) =>
          event.kind === GATEWAY_EVENT.ACCOUNT_INBOX_CHANGED ? [event.payload] : [],
        ),
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
  "a pin that answers its transaction waits for the task list to carry it before it answers",
  () =>
    Effect.gen(function* () {
      const waited: (string | undefined)[] = [];
      const { call, pinCommits } = yield* subject({
        listed: (txid) => Effect.sync(() => void waited.push(txid)),
      });
      pinCommits("9101");

      assert.deepEqual(
        yield* call(GATEWAY_METHOD.CODING_AGENTS_PIN, { agentId: AGENT_ID, pinned: true }),
        { agent: AGENT, txid: "9101" },
      );
      assert.deepEqual(waited, ["9101"]);
    }),
);

it.effect(
  "an ensure of the operator that made one waits for the task list to carry it before it answers",
  () =>
    Effect.gen(function* () {
      const waited: (string | undefined)[] = [];
      const { call, asked } = yield* subject({
        listed: (txid) => Effect.sync(() => void waited.push(txid)),
      });

      assert.deepEqual(
        yield* call(GATEWAY_METHOD.CODING_AGENTS_ENSURE_OPERATOR, {
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

    assert.deepEqual(yield* call(GATEWAY_METHOD.CODING_AGENTS_DELETE, { agentId: AGENT_ID }), {
      deleted: true,
      txid: "9102",
    });
    assert.deepEqual(waited, ["9102"]);
  }),
);

it.effect("each method asks the service once and answers what it said, whole", () =>
  Effect.gen(function* () {
    const { call, asked, sealTranscript } = yield* subject();
    sealTranscript(SEALED_TRANSCRIPT);

    assert.deepEqual(yield* call(GATEWAY_METHOD.CODING_AGENTS_MODELS), { models: MODELS });
    assert.deepEqual(yield* call(GATEWAY_METHOD.CODING_AGENTS_DEFAULT_READ), {
      choice: { model: AGENT.model, effort: AGENT.effort },
    });
    assert.deepEqual(
      yield* call(GATEWAY_METHOD.CODING_AGENTS_DEFAULT_WRITE, {
        model: "openai/gpt-6.1-sol",
        effort: "xhigh",
      }),
      { choice: { model: "openai/gpt-6.1-sol", effort: "xhigh" } },
    );
    assert.deepEqual(yield* call(GATEWAY_METHOD.CODING_AGENTS_LIST, { taskId: TASK_ID }), {
      agents: [AGENT],
    });
    assert.deepEqual(
      yield* call(GATEWAY_METHOD.CODING_AGENTS_LIST, { taskId: TASK_ID, includeArchived: true }),
      { agents: [AGENT] },
    );
    assert.deepEqual(
      yield* call(GATEWAY_METHOD.CODING_AGENTS_WORKSPACE_LIST, {
        workspaceId: "workspace-1",
        repository: "acme/relay",
      }),
      { agents: [AGENT] },
    );
    assert.deepEqual(
      yield* call(GATEWAY_METHOD.CODING_AGENTS_START, {
        taskId: TASK_ID,
        idempotencyKey: "press-1",
      }),
      { agent: { ...AGENT, status: CODING_AGENT_STATUS.STARTING } },
    );
    assert.deepEqual(
      yield* call(GATEWAY_METHOD.CODING_AGENTS_MESSAGES, {
        agentId: AGENT_ID,
        after: CODING_AGENT_CURSOR_START,
      }),
      {
        messages: [{ id: "m-1", role: "assistant", parts: [{ type: "text", text: "Hi" }] }],
        cursor: "2:1",
        status: CODING_AGENT_STATUS.RUNNING,
        title: null,
      },
    );
    assert.deepEqual(
      yield* call(GATEWAY_METHOD.CODING_AGENTS_MESSAGES, {
        agentId: AGENT_ID,
        after: CODING_AGENT_CURSOR_START,
        callId: "call-7",
      }),
      {
        messages: [{ id: "m-1", role: "assistant", parts: [{ type: "text", text: "Hi" }] }],
        cursor: "2:1",
        status: CODING_AGENT_STATUS.RUNNING,
        title: null,
      },
    );
    assert.deepEqual(
      yield* call(GATEWAY_METHOD.CODING_AGENTS_MESSAGE, {
        agentId: AGENT_ID,
        text: "Also expire them after a week.",
        clientKey: "send-1",
      }),
      { agent: AGENT },
    );
    assert.deepEqual(
      yield* call(GATEWAY_METHOD.CODING_AGENTS_CHOOSE, {
        agentId: AGENT_ID,
        model: "openai/gpt-6.1-sol",
        effort: "low",
      }),
      { agent: { ...AGENT, model: "openai/gpt-6.1-sol", effort: "low" } },
    );
    assert.deepEqual(
      yield* call(GATEWAY_METHOD.CODING_AGENTS_RENAME, {
        agentId: AGENT_ID,
        title: "Sign-out button",
      }),
      { agent: { ...AGENT, title: "Sign-out button" } },
    );
    assert.deepEqual(
      yield* call(GATEWAY_METHOD.CODING_AGENTS_SERVERS, {
        agentId: AGENT_ID,
        disabledServers: [INTEGRATION_PROVIDER.LINEAR],
      }),
      { agent: { ...AGENT, disabledServers: [INTEGRATION_PROVIDER.LINEAR] } },
    );
    assert.deepEqual(yield* call(GATEWAY_METHOD.CODING_AGENTS_STOP, { agentId: AGENT_ID }), {
      agent: { ...AGENT, status: CODING_AGENT_STATUS.CANCELLED },
    });
    assert.deepEqual(
      yield* call(GATEWAY_METHOD.CODING_AGENTS_ARCHIVE, { agentId: AGENT_ID, archived: true }),
      { agent: { ...AGENT, archivedAt: 1_800_000_120_000 } },
    );
    assert.deepEqual(
      yield* call(GATEWAY_METHOD.CODING_AGENTS_PIN, { agentId: AGENT_ID, pinned: true }),
      { agent: AGENT },
    );
    assert.deepEqual(yield* call(GATEWAY_METHOD.CODING_AGENTS_DELETE, { agentId: AGENT_ID }), {
      deleted: true,
      txid: "9102",
    });
    assert.deepEqual(yield* call(GATEWAY_METHOD.CODING_AGENTS_PAGE, { agentId: AGENT_ID }), {
      agent: PAGE,
    });
    assert.deepEqual(
      yield* call(GATEWAY_METHOD.CODING_AGENTS_PULL_REQUEST, { agentId: AGENT_ID }),
      PUBLISHED,
    );
    assert.deepEqual(
      yield* call(GATEWAY_METHOD.CODING_AGENTS_CHANGES, { agentId: AGENT_ID }),
      CHANGES,
    );
    assert.deepEqual(
      yield* call(GATEWAY_METHOD.CODING_AGENTS_CHANGES, { agentId: AGENT_ID, number: 11 }),
      CHANGES,
    );
    assert.deepEqual(
      yield* call(GATEWAY_METHOD.CODING_AGENTS_CHAPTERS, { agentId: AGENT_ID }),
      CHAPTERS,
    );
    assert.deepEqual(
      yield* call(GATEWAY_METHOD.CODING_AGENTS_CHAPTERS_GENERATE, {
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
      yield* call(GATEWAY_METHOD.CODING_AGENTS_OVERVIEW_PULL_REQUEST, { agentId: AGENT_ID }),
      OVERVIEW.pullRequest,
    );
    assert.deepEqual(
      yield* call(GATEWAY_METHOD.CODING_AGENTS_REVIEW_OPTIONS, { agentId: AGENT_ID }),
      REVIEW_OPTIONS,
    );
    assert.deepEqual(
      yield* call(GATEWAY_METHOD.CODING_AGENTS_OVERVIEW_CHECKS, { agentId: AGENT_ID }),
      OVERVIEW.checks,
    );
    assert.deepEqual(
      yield* call(GATEWAY_METHOD.CODING_AGENTS_OVERVIEW_CONVERSATION, { agentId: AGENT_ID }),
      OVERVIEW.conversation,
    );
    assert.deepEqual(
      yield* call(GATEWAY_METHOD.CODING_AGENTS_GITHUB_IMAGE, {
        agentId: AGENT_ID,
        src: "https://camo.githubusercontent.com/abc",
      }),
      { contentType: GITHUB_IMAGE_TYPE.PNG, base64: "iVBORw0KGgo=" },
    );
    assert.deepEqual(
      yield* call(GATEWAY_METHOD.CODING_AGENTS_PULL_REQUEST_ACTION, {
        agentId: AGENT_ID,
        number: 11,
        request: { action: PULL_REQUEST_ACTION.READY_FOR_REVIEW },
      }),
      { outcome: PULL_REQUEST_WRITE_OUTCOME.DONE },
    );
    assert.deepEqual(
      yield* call(GATEWAY_METHOD.CODING_AGENTS_PULL_REQUEST_VIEWED, { agentId: AGENT_ID }),
      { outcome: PULL_REQUEST_WRITE_OUTCOME.DONE, files: [] },
    );
    assert.deepEqual(
      yield* call(GATEWAY_METHOD.CODING_AGENTS_INBOX_ATTACHMENT, {
        itemId: ITEM.id,
        attachmentId: ATTACHMENT_ID,
      }),
      { contentType: INBOX_IMAGE_TYPE.PNG, base64: "iVBORw0KGgo=" },
    );
    assert.deepEqual(
      yield* call(GATEWAY_METHOD.CODING_AGENTS_PICTURE, {
        agentId: AGENT_ID,
        pictureId: PICTURE_ID,
        callId: "call-worker",
      }),
      { contentType: INBOX_IMAGE_TYPE.PNG, base64: "iVBORw0KGgo=" },
    );
    assert.deepEqual(
      yield* call(GATEWAY_METHOD.CODING_AGENTS_PART, {
        agentId: AGENT_ID,
        messageId: "message-1",
        index: 2,
      }),
      { part: { type: "reasoning", text: "Whole." } },
    );
    assert.deepEqual(
      yield* call(GATEWAY_METHOD.CODING_AGENTS_INBOX_ANSWER, {
        itemId: ITEM.id,
        revision: 2,
        reply: INBOX_REPLY.DECLINED,
        note: "Not before the freeze lifts.",
        clientKey: "answer-1",
      }),
      {
        item: {
          ...ITEM,
          revision: 3,
          status: INBOX_STATUS.ANSWERED,
          answer: { reply: INBOX_REPLY.DECLINED },
        },
        taken: true,
      },
    );
    assert.deepEqual(
      yield* call(GATEWAY_METHOD.CODING_AGENTS_INBOX_CLOSE, {
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
      yield* call(GATEWAY_METHOD.CODING_AGENTS_INBOX_MESSAGE, {
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
    yield* call(GATEWAY_METHOD.CODING_AGENTS_INBOX_MESSAGE, {
      itemId: ITEM.id,
      text: "Ship it.",
      clientKey: "message-2",
      answers: { ask: MESSAGE_ID, reply: INBOX_REPLY.CHOSE, choices: ["Ship it"] },
    });
    assert.deepEqual(
      yield* call(GATEWAY_METHOD.CODING_AGENTS_INBOX_START, {
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
      yield* call(GATEWAY_METHOD.CODING_AGENTS_INBOX_READ_STATE, { itemId: ITEM.id, unread: true }),
      { id: ITEM.id, unread: true },
    );
    assert.deepEqual(
      yield* call(GATEWAY_METHOD.CODING_AGENTS_INBOX_READ_STATE, {
        itemId: ITEM.id,
        unread: false,
      }),
      { id: ITEM.id, unread: false },
    );
    assert.deepEqual(
      yield* call(GATEWAY_METHOD.CODING_AGENTS_INBOX_READ_ALL, { workspaceId: WORKSPACE_ID }),
      { marked: 2 },
    );

    assert.deepEqual(
      yield* call(GATEWAY_METHOD.CODING_AGENTS_CHAT_POST, {
        workspaceId: WORKSPACE_ID,
        write: { readTo: 4 },
      }),
      { readSeq: 4 },
    );
    assert.deepEqual(
      yield* call(GATEWAY_METHOD.CODING_AGENTS_CHAT_ATTACHMENT, {
        workspaceId: WORKSPACE_ID,
        messageId: "message-1",
        attachmentId: ATTACHMENT_ID,
      }),
      { contentType: INBOX_IMAGE_TYPE.PNG, base64: "iVBORw0KGgo=" },
    );

    assert.deepEqual(asked, [
      "models",
      "default",
      "default:openai/gpt-6.1-sol:xhigh",
      `list:${TASK_ID}`,
      `list:${TASK_ID}:archived`,
      "workspace:workspace-1:acme/relay",
      `start:${TASK_ID}:press-1:default`,
      `messages-now:${AGENT_ID}:${CODING_AGENT_CURSOR_START}`,
      `worker-now:${AGENT_ID}:call-7:${CODING_AGENT_CURSOR_START}`,
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
      `answer:${ITEM.id}:2:${INBOX_REPLY.DECLINED}:Not before the freeze lifts.:answer-1`,
      `close:${ITEM.id}:2:close-1`,
      `inbox-message:${ITEM.id}:Also page on-call.:pager.txt:message-1`,
      `inbox-message:${ITEM.id}:Ship it.::message-2:answers ${MESSAGE_ID} chose Ship it`,
      `inbox-start:${AGENT_ID}:Annual plan copy:Draft the annual plan's line too.:start-1`,
      `inbox-unread:${ITEM.id}`,
      `inbox-read:${ITEM.id}`,
      `inbox-read-all:${WORKSPACE_ID}`,
      `chat-post:${WORKSPACE_ID}:{"readTo":4}`,
      `chat-attachment:${WORKSPACE_ID}:message-1:${ATTACHMENT_ID}`,
    ]);
  }),
);

it.effect(
  "behind a closed account gate, or on a run that sends nothing, every ask is unanswered",
  () =>
    Effect.gen(function* () {
      const signedOut = yield* subject({ signedIn: false });
      const offline = yield* subject({ sendsNetwork: false });

      assert.deepEqual(yield* signedOut.call(GATEWAY_METHOD.CODING_AGENTS_MODELS), {
        failure: CODING_AGENT_CALL_FAILURE.UNANSWERED,
      });
      assert.deepEqual(
        yield* offline.call(GATEWAY_METHOD.CODING_AGENTS_LIST, { taskId: TASK_ID }),
        { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED },
      );
      assert.deepEqual(signedOut.asked, []);
      assert.deepEqual(offline.asked, []);
    }),
);

it.effect(
  "a Start from an agent that names no task asks the service to start where that agent is, one on a task still starts on it, and one naming neither a task nor an agent is refused, asking nothing",
  () =>
    Effect.gen(function* () {
      const { call, asked } = yield* subject();

      const fromTaskless = yield* call(GATEWAY_METHOD.CODING_AGENTS_START, {
        idempotencyKey: "press-continue",
        from: { agentId: AGENT_ID },
      });
      yield* call(GATEWAY_METHOD.CODING_AGENTS_START, {
        taskId: TASK_ID,
        idempotencyKey: "press-fork",
        from: { agentId: AGENT_ID },
      });
      const refused = yield* Effect.flip(
        call(GATEWAY_METHOD.CODING_AGENTS_START, {
          idempotencyKey: "press-nowhere",
          prompt: "Go.",
        }),
      );

      assert.deepEqual(fromTaskless, { agent: { ...AGENT, status: CODING_AGENT_STATUS.STARTING } });
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

const SEALED_TRANSCRIPT: AgentTranscriptLiveAnswer = {
  url: "wss://realtime.example/v1",
  queries: {
    messages: sealed("messages"),
    turns: sealed("turns"),
    conversation: sealed("conversation"),
    agent: sealed("agent"),
    workers: sealed("workers"),
    window: sealed("window"),
    windowParts: sealed("windowParts"),
  },
};

/** The transcript's statements as they stand: `seq` its newest message, `turns` how many it has opened. */
function transcriptRows(realtime: ReturnType<typeof fakeRealtime>, seq: number, turns = 1) {
  realtime.deliver("turns", [
    { status: "running", rows: turns, stopped: 0, changedAt: NOW - 1_000 },
  ]);
  realtime.deliver("conversation", [{ id: "conversation-1", title: null, revision: seq }]);
  realtime.deliver("agent", [{ id: AGENT_ID, title: "Invites" }]);
  realtime.deliver("workers", []);
  realtime.deliver("window", []);
  realtime.deliver("windowParts", []);
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
  options: { holds: boolean; text?: string; status?: typeof CODING_AGENT_STATUS.RUNNING },
): TranscriptNowAnswer {
  return {
    messages:
      options.text === undefined
        ? []
        : [{ id: `m-${cursor}`, role: "assistant", parts: [{ type: "text", text: options.text }] }],
    cursor,
    status: options.status ?? CODING_AGENT_STATUS.RUNNING,
    title: "Invites",
    holds: options.holds,
  };
}

/** A page past a cursor as the window is told it: the service's word on whether it would have held left in the host, and whether it came back short of a page's most. */
function windowPage(page: TranscriptNowAnswer) {
  const { holds: _holds, ...rest } = page;
  return { ...rest, caughtUp: page.messages.length < CODING_AGENT_BOUNDS.MESSAGES_PAGE };
}

/** The newest page the service answers: one message, the cursor to follow on from, and where the older page is read below. */
function newestPage(cursor: string, text: string, before?: string): CodingAgentNewestAnswer {
  return {
    messages: [{ id: `m-${cursor}`, role: "assistant", parts: [{ type: "text", text }] }],
    cursor,
    status: CODING_AGENT_STATUS.RUNNING,
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
  "a followed transcript opens on its newest page, read once beside the seal, then follows on from its cursor once the subscription stands, missing nothing written between; a short page is caught up, and the next is read only as the statements move or at the edge the service names; letting it go ends the telling",
  () =>
    Effect.gen(function* () {
      const {
        call,
        asked,
        pages,
        sealTranscript,
        pageNow: script,
        pageNewest,
        realtime,
      } = yield* subject();
      sealTranscript(SEALED_TRANSCRIPT);
      const newest = newestPage("1:0", "Reading the invites.", "40");
      pageNewest(newest);
      // A message written after the newest page was read, before the subscription stood.
      const between = {
        ...pageNow("2:0", { holds: true, text: "Writing the expiry." }),
        wakeIn: 3_000,
      };
      script(between);
      assert.deepEqual(yield* call(GATEWAY_METHOD.CODING_AGENTS_TRANSCRIPT_FOLLOW, FOLLOWED), {});
      yield* settled;
      assert.deepEqual(pages(), [
        { transcript: FOLLOWED, page: { ...newest, newest: true, caughtUp: false } },
      ]);
      assert.deepEqual(asked.toSorted(), [
        `messages-newest:${AGENT_ID}:cut`,
        `transcript-live:${AGENT_ID}`,
      ]);

      // The subscription's first rows read on from the newest page's cursor, never from the start.
      transcriptRows(realtime, 2);
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
      transcriptRows(realtime, 3, 2);
      yield* settled;
      assert.deepEqual(pages().at(-1), { transcript: FOLLOWED, page: windowPage(moved) });
      assert.equal(asked.filter((ask) => ask.startsWith("messages-newest")).length, 1);
      assert.ok(!asked.includes(`messages-now:${AGENT_ID}:${CODING_AGENT_CURSOR_START}`));
      assert.ok(!JSON.stringify(pages()).includes("capability"));
      // The count of messages released desktops wake on is not followed: the window's rows carry them.
      assert.ok(!realtime.subscribed().includes("capability-messages"));

      yield* call(GATEWAY_METHOD.CODING_AGENTS_TRANSCRIPT_UNFOLLOW, FOLLOWED);
      const toldBefore = pages().length;
      transcriptRows(realtime, 4, 3);
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
        realtime,
      } = yield* subject();
      sealTranscript(SEALED_TRANSCRIPT);
      pageNewest(newestPage("1:0", "Reading the invites."));
      const caught = pageNow("1:0", { holds: true });
      script(caught);
      yield* call(GATEWAY_METHOD.CODING_AGENTS_TRANSCRIPT_FOLLOW, FOLLOWED);
      yield* settled;
      transcriptRows(realtime, 1);
      yield* settled;
      const reads = () => asked.filter((ask) => ask.startsWith("messages-")).length;
      const readBefore = reads();
      const toldBefore = pages().length;

      const first = windowRow(2, "Writing the expiry.");
      const second = windowRow(3, "Testing the expiry.");
      realtime.deliver("window", [first.row, second.row]);
      // The second message's part has not landed yet, so only the first is drawn.
      realtime.deliver("windowParts", [first.part]);
      yield* settled;
      realtime.deliver("windowParts", [first.part, second.part]);
      yield* settled;
      // Rows delivered again alike tell nothing more.
      realtime.deliver("window", [first.row, second.row]);
      yield* settled;

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
      transcriptRows(realtime, 3, 2);
      yield* settled;
      assert.equal(asked.at(-1), `messages-now:${AGENT_ID}:3:0`);
    }),
);

it.effect(
  "messages the window's rows drew are held too, so a transcript followed again is told them and reads on past them",
  () =>
    Effect.gen(function* () {
      const harness = yield* subject();
      const { call, asked, pages, sealTranscript, pageNow: script, pageNewest, realtime } = harness;
      sealTranscript(SEALED_TRANSCRIPT);
      const newest = newestPage("1:0", "Reading the invites.");
      pageNewest(newest);
      script(pageNow("1:0", { holds: true }));
      yield* call(GATEWAY_METHOD.CODING_AGENTS_TRANSCRIPT_FOLLOW, FOLLOWED);
      yield* settled;
      transcriptRows(realtime, 1);
      yield* settled;
      const drawn = windowRow(2, "Writing the expiry.");
      realtime.deliver("window", [drawn.row]);
      realtime.deliver("windowParts", [drawn.part]);
      yield* settled;
      yield* call(GATEWAY_METHOD.CODING_AGENTS_TRANSCRIPT_UNFOLLOW, FOLLOWED);

      const toldBefore = pages().length;
      const askedBefore = asked.length;
      yield* call(GATEWAY_METHOD.CODING_AGENTS_TRANSCRIPT_FOLLOW, FOLLOWED);
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
      const { call, asked, pages, sealTranscript, pageNow: script, realtime } = yield* subject();
      sealTranscript(SEALED_TRANSCRIPT);
      const full: TranscriptNowAnswer = {
        ...pageNow("2:0", { holds: false }),
        messages: Array.from({ length: CODING_AGENT_BOUNDS.MESSAGES_PAGE }, (_, index) => ({
          id: `m-full-${index}`,
          role: "assistant" as const,
          parts: [{ type: "text" as const, text: `Step ${index}` }],
        })),
      };
      const rest = pageNow("3:0", { holds: true, text: "Done." });
      script(full, rest);
      yield* call(GATEWAY_METHOD.CODING_AGENTS_TRANSCRIPT_FOLLOW, FOLLOWED);
      yield* settled;
      transcriptRows(realtime, 2);
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
  "a seal the service does not answer leaves the newest page told, is asked again a bounded number of times, then says the transcript could not be read; following again seals anew",
  () =>
    Effect.gen(function* () {
      const { call, asked, pages, sealTranscript } = yield* subject();
      yield* call(GATEWAY_METHOD.CODING_AGENTS_TRANSCRIPT_FOLLOW, FOLLOWED);
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
      assert.ok(seals > 1 && seals < 60, `sealed ${seals} times`);
      assert.deepEqual(pages().at(-1), {
        transcript: FOLLOWED,
        page: { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED },
      });
      yield* TestClock.adjust("1 minute");
      yield* settled;
      assert.equal(asked.filter((ask) => ask === `transcript-live:${AGENT_ID}`).length, seals);

      sealTranscript(SEALED_TRANSCRIPT);
      yield* call(GATEWAY_METHOD.CODING_AGENTS_TRANSCRIPT_FOLLOW, FOLLOWED);
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
      sealTranscript(SEALED_TRANSCRIPT);
      pageNewest({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED });
      yield* call(GATEWAY_METHOD.CODING_AGENTS_TRANSCRIPT_FOLLOW, FOLLOWED);
      yield* settled;
      yield* TestClock.adjust("1 minute");
      yield* settled;
      const newest = () => asked.filter((ask) => ask === `messages-newest:${AGENT_ID}:cut`).length;
      const read = newest();
      assert.ok(read > 1 && read < 60, `read the newest page ${read} times`);
      assert.deepEqual(pages().at(-1), {
        transcript: FOLLOWED,
        page: { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED },
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
        realtime,
      } = yield* subject();
      sealTranscript(SEALED_TRANSCRIPT);
      pageNewest(newestPage("2:0", "Writing the expiry."));
      script(pageNow("2:0", { holds: true }));
      yield* call(GATEWAY_METHOD.CODING_AGENTS_TRANSCRIPT_FOLLOW, FOLLOWED);
      yield* settled;
      transcriptRows(realtime, 2);
      yield* settled;

      // The agent is taken back to before its second line: every page says so from now on.
      const rewound = { ...newestPage("3:1", "Reading the invites."), rewound: 1 };
      pageNewest(rewound);
      script({ ...pageNow("3:1", { holds: true }), rewound: 1 });
      transcriptRows(realtime, 3, 2);
      yield* settled;

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
      yield* call(GATEWAY_METHOD.CODING_AGENTS_TRANSCRIPT_OLDER, { ...FOLLOWED, before: "40" }),
      { messages: SAID.messages, before: "3" },
    );
    yield* call(GATEWAY_METHOD.CODING_AGENTS_TRANSCRIPT_OLDER, {
      ...FOLLOWED,
      callId: "call-7",
      before: "40",
    });
    const refused = yield* Effect.flip(
      call(GATEWAY_METHOD.CODING_AGENTS_TRANSCRIPT_OLDER, { ...FOLLOWED, before: "the start" }),
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
      refused.sealTranscript({ failure: CODING_AGENT_CALL_FAILURE.NOT_FOUND });
      yield* refused.call(GATEWAY_METHOD.CODING_AGENTS_TRANSCRIPT_FOLLOW, worker);
      yield* settled;
      yield* TestClock.adjust("5 seconds");
      yield* settled;
      assert.deepEqual(refused.pages(), [
        { transcript: worker, page: { failure: CODING_AGENT_CALL_FAILURE.NOT_FOUND } },
      ]);

      const signedOut = yield* subject({ signedIn: false });
      yield* signedOut.call(GATEWAY_METHOD.CODING_AGENTS_TRANSCRIPT_FOLLOW, FOLLOWED);
      yield* settled;
      assert.deepEqual(signedOut.pages(), [
        { transcript: FOLLOWED, page: { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED } },
      ]);
      assert.deepEqual(signedOut.asked, []);

      const followed = yield* subject();
      followed.sealTranscript(SEALED_TRANSCRIPT);
      followed.pageNow(pageNow("1:0", { holds: true }));
      yield* followed.call(GATEWAY_METHOD.CODING_AGENTS_TRANSCRIPT_FOLLOW, FOLLOWED);
      yield* settled;
      yield* followed.reset;
      yield* settled;
      assert.deepEqual(followed.realtime.closed, [SEALED_TRANSCRIPT.url]);
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
    harness.sealTranscript(SEALED_TRANSCRIPT);
    harness.pageNewest(newest);
    harness.pageNow(past);
    yield* harness.call(GATEWAY_METHOD.CODING_AGENTS_TRANSCRIPT_FOLLOW, transcript);
    yield* settled;
    transcriptRows(harness.realtime, 2);
    yield* settled;
    yield* harness.call(GATEWAY_METHOD.CODING_AGENTS_TRANSCRIPT_UNFOLLOW, transcript);
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
      const { asked, pages, askedAsTold, realtime } = harness;

      // Written while no window followed it.
      const away = pageNow("3:0", { holds: false, text: "Written while away." });
      harness.pageNow(away);
      yield* TestClock.adjust("5 seconds");
      transcriptRows(realtime, 3);
      yield* settled;

      const toldBefore = pages().length;
      const askedBefore = asked.length;
      yield* harness.call(GATEWAY_METHOD.CODING_AGENTS_TRANSCRIPT_FOLLOW, FOLLOWED);
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
      const { pages, realtime } = harness;
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
      transcriptRows(realtime, 2);
      yield* settled;

      const toldBefore = pages().length;
      yield* harness.call(GATEWAY_METHOD.CODING_AGENTS_TRANSCRIPT_FOLLOW, FOLLOWED);
      yield* settled;
      assert.deepEqual(pages().slice(toldBefore), [
        { transcript: FOLLOWED, page: window },
        { transcript: FOLLOWED, page: windowPage(rewrite) },
      ]);

      yield* harness.call(GATEWAY_METHOD.CODING_AGENTS_TRANSCRIPT_UNFOLLOW, FOLLOWED);
      const again = pages().length;
      yield* harness.call(GATEWAY_METHOD.CODING_AGENTS_TRANSCRIPT_FOLLOW, FOLLOWED);
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
      harness.pageNow(
        { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED },
        pageNow("6:0", { holds: false }),
      );

      const toldBefore = pages().length;
      const askedBefore = asked.length;
      yield* harness.call(GATEWAY_METHOD.CODING_AGENTS_TRANSCRIPT_FOLLOW, FOLLOWED);
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
      harness.pageNow({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED });
      harness.pageNewest({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED });
      yield* harness.call(GATEWAY_METHOD.CODING_AGENTS_TRANSCRIPT_FOLLOW, FOLLOWED);
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
      yield* signedOut.call(GATEWAY_METHOD.CODING_AGENTS_TRANSCRIPT_FOLLOW, FOLLOWED);
      yield* settled;
      assert.equal(newestReads(signedOut.asked), 2);
      assert.equal(heldTold(signedOut.pages()), 0);

      let account = "user-dana";
      const switched = yield* subject({ accountId: () => account });
      yield* followedOnce(switched);
      account = "user-eli";
      yield* switched.call(GATEWAY_METHOD.CODING_AGENTS_TRANSCRIPT_FOLLOW, FOLLOWED);
      yield* settled;
      assert.equal(newestReads(switched.asked), 2);
      assert.equal(heldTold(switched.pages()), 0);

      const archived = yield* subject();
      yield* followedOnce(archived);
      yield* archived.call(GATEWAY_METHOD.CODING_AGENTS_ARCHIVE, {
        agentId: AGENT_ID,
        archived: true,
      });
      yield* archived.call(GATEWAY_METHOD.CODING_AGENTS_TRANSCRIPT_FOLLOW, FOLLOWED);
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
      yield* harness.call(GATEWAY_METHOD.CODING_AGENTS_TRANSCRIPT_FOLLOW, last);
      yield* settled;
      assert.equal(newestReads(last.agentId), 1);
      const first = transcripts[0] ?? FOLLOWED;
      yield* harness.call(GATEWAY_METHOD.CODING_AGENTS_TRANSCRIPT_FOLLOW, first);
      yield* settled;
      assert.equal(newestReads(first.agentId), 2);
    }),
);

it.effect(
  "a line typed while this Mac's call is up on the agent goes to the call and is not steered, and the tab hears the agent as it stands",
  () =>
    Effect.gen(function* () {
      const typed: [string, string, string][] = [];
      const { call, asked } = yield* subject({
        typeIntoCall: (agentId, text, clientKey) => {
          typed.push([agentId, text, clientKey]);
          return agentId === AGENT_ID;
        },
      });
      const {
        automationId: _automation,
        workspaceId: _workspace,
        repository: _repository,
        ...page
      } = PAGE;
      assert.deepEqual(
        yield* call(GATEWAY_METHOD.CODING_AGENTS_MESSAGE, {
          agentId: AGENT_ID,
          text: "Use the fixture branch.",
          clientKey: "send-1",
        }),
        // Running, as a steer's answer is: the call asks the line a moment after the frame leaves.
        { agent: { ...page, status: CODING_AGENT_STATUS.RUNNING } },
      );
      assert.deepEqual(typed, [[AGENT_ID, "Use the fixture branch.", "send-1"]]);
      assert.deepEqual(asked, [`page:${AGENT_ID}`]);
    }),
);

it.effect(
  "a line typed with no call on the agent, a call on another agent, or files alone steers as before",
  () =>
    Effect.gen(function* () {
      const typed: string[] = [];
      const other = "0f9e8d7c-6b5a-4c3d-8e2f-1a0b9c8d7e6f";
      const { call, asked } = yield* subject({
        typeIntoCall: (agentId, text) => {
          typed.push(text);
          return agentId === other;
        },
      });
      assert.deepEqual(
        yield* call(GATEWAY_METHOD.CODING_AGENTS_MESSAGE, {
          agentId: AGENT_ID,
          text: "Expire them after a week.",
          clientKey: "send-1",
        }),
        { agent: AGENT },
      );
      assert.deepEqual(
        yield* call(GATEWAY_METHOD.CODING_AGENTS_MESSAGE, {
          agentId: other,
          text: "",
          clientKey: "send-2",
          attachments: [{ name: "pager.txt", mediaType: "text/plain", data: "b24tY2FsbA==" }],
        }),
        { agent: AGENT },
      );
      // Only the line with words was offered to the call; the files-only line never was.
      assert.deepEqual(typed, ["Expire them after a week."]);
      assert.deepEqual(asked, [
        `message:${AGENT_ID}:send-1:Expire them after a week.`,
        `message:${other}:send-2::files pager.txt`,
      ]);

      const { call: callWithNoCalls, asked: steered } = yield* subject();
      yield* callWithNoCalls(GATEWAY_METHOD.CODING_AGENTS_MESSAGE, {
        agentId: AGENT_ID,
        text: "Expire them after a week.",
        clientKey: "send-3",
      });
      assert.deepEqual(steered, [`message:${AGENT_ID}:send-3:Expire them after a week.`]);
    }),
);

it.effect(
  "a line with files typed while this Mac's call is up on the agent steers with its files, and the call is offered none of it",
  () =>
    Effect.gen(function* () {
      const typed: string[] = [];
      const { call, asked } = yield* subject({
        typeIntoCall: (agentId, text) => {
          typed.push(text);
          return agentId === AGENT_ID;
        },
      });
      assert.deepEqual(
        yield* call(GATEWAY_METHOD.CODING_AGENTS_MESSAGE, {
          agentId: AGENT_ID,
          text: "What does this pager say?",
          clientKey: "send-1",
          attachments: [{ name: "pager.txt", mediaType: "text/plain", data: "b24tY2FsbA==" }],
        }),
        { agent: AGENT },
      );
      assert.deepEqual(typed, []);
      assert.deepEqual(asked, [
        `message:${AGENT_ID}:send-1:What does this pager say?:files pager.txt`,
      ]);
    }),
);

const SEALED_SCOPE: ScopeInboxLiveAnswer = {
  url: "wss://realtime.example/v1",
  queries: { items: sealed("items"), messages: sealed("messages"), files: sealed("files") },
};

/** That item as a reader who has read it reads it live. */
const LIVE_ITEM: InboxItem = { ...ITEM, unread: false };

/** That item as its row delivers it, what it leaves out held as null. */
const ITEM_ROW = {
  ...LIVE_ITEM,
  startedBy: "user-dana",
  startedByName: null,
  answer: null,
  answeredBy: null,
  answeredByName: null,
  closedReason: null,
  closedBy: null,
  closedByName: null,
  openAskMessageId: null,
  settledAt: null,
};

const SEALED_CHAT: WorkspaceChatLiveAnswer = {
  url: "wss://realtime.example/v1",
  queries: {
    self: sealed("self"),
    members: sealed("members"),
    channels: sealed("channels"),
    messages: sealed("messages"),
    reads: sealed("reads"),
  },
};

const CHANNEL_ID = "6bd39277-e38a-4415-9dc7-9cadbecdf0a7";

/** A message as the messages part's row delivers it, at its place. */
function messageRow(id: string, seq: number) {
  return {
    id,
    seq,
    touchedSeq: seq,
    channelId: CHANNEL_ID,
    parentId: null,
    authorId: MEMBER_ID,
    blocks: [{ type: "markdown", text: `Message ${seq}.` }],
    mentions: [],
    postedAt: NOW - 10 + seq,
    ask: null,
    askKey: null,
    askRevision: null,
    askStatus: null,
    answer: null,
    answeredBy: null,
    closedReason: null,
  };
}

/** Every part of the chat delivered, the messages given among them. */
function deliverChat(
  realtime: ReturnType<typeof fakeRealtime>,
  messages: readonly ReturnType<typeof messageRow>[],
) {
  realtime.deliver("self", [{ self: MEMBER_ID, readSeq: 0 }]);
  realtime.deliver("members", [
    {
      id: MEMBER_ID,
      kind: MEMBER_KIND.HUMAN,
      handle: "ada",
      name: "Ada Lovelace",
      userId: "user-ada",
      agentId: null,
      planId: null,
      left: false,
      ordinal: 1,
      joinedAt: NOW - 100,
    },
  ]);
  realtime.deliver("channels", [
    {
      id: CHANNEL_ID,
      kind: "general",
      name: "general",
      planId: null,
      dmAMemberId: null,
      dmBMemberId: null,
      archived: false,
      purpose: null,
      createdAt: NOW - 100,
    },
  ]);
  realtime.deliver("reads", []);
  realtime.deliver("messages", messages);
}

it.effect(
  "a workspace's chat is followed over Realtime: joined once, every part subscribed, and each change told whole in the held read's order and never a sealed statement",
  () =>
    Effect.gen(function* () {
      const { call, asked, sealChat, realtime, chats } = yield* subject();
      sealChat(SEALED_CHAT);
      yield* call(GATEWAY_METHOD.CODING_AGENTS_CHAT_FOLLOW, { workspaceId: WORKSPACE_ID });
      yield* settled;
      // Sealed for the account signed in, which every renewal names too.
      assert.deepEqual(asked, [`chat-join:${WORKSPACE_ID}`, `chat-live:${WORKSPACE_ID}:user-dana`]);
      assert.deepEqual(realtime.subscribed(), [
        "capability-channels",
        "capability-members",
        "capability-messages",
        "capability-reads",
        "capability-self",
      ]);

      const first = "7ce4a388-f49b-4526-8ed8-adbecdf0a1b8";
      const second = "8df5b499-a5ac-4637-9fe9-becdf0a1b2c9";
      deliverChat(realtime, [messageRow(second, 2), messageRow(first, 1)]);
      yield* settled;
      const told = chats();
      assert.equal(told.length, 1);
      const [only] = told;
      assert.ok(isRecord(only) && only.workspaceId === WORKSPACE_ID && isRecord(only.chat));
      assert.equal(only.chat.self, MEMBER_ID);
      const messages = only.chat.messages;
      assert.ok(Array.isArray(messages));
      assert.deepEqual(
        messages.map((message) => (isRecord(message) ? message.id : undefined)),
        [first, second],
      );
      assert.ok(!JSON.stringify(told).includes("capability"));
    }),
);

it.effect(
  "a write to a followed chat is answered once its transaction reaches the chat, and a write that changed nothing, or to a chat not followed, at once",
  () =>
    Effect.gen(function* () {
      const { call, sealChat, answerWrites, realtime } = yield* subject();
      sealChat(SEALED_CHAT);
      yield* call(GATEWAY_METHOD.CODING_AGENTS_CHAT_FOLLOW, { workspaceId: WORKSPACE_ID });
      yield* settled;
      deliverChat(realtime, []);
      yield* settled;
      const write = (workspaceId: string, request: WireRecord) =>
        Effect.forkChild(
          call(GATEWAY_METHOD.CODING_AGENTS_CHAT_POST, { workspaceId, write: request }),
        );

      answerWrites({ readSeq: 0, reads: [{ channelId: CHANNEL_ID, readSeq: 3 }], txid: "78" });
      const read = yield* write(WORKSPACE_ID, { readTo: 3, channelId: CHANNEL_ID });
      yield* settled;
      assert.equal(read.pollUnsafe(), undefined, "the write waits for its transaction");
      assert.deepEqual(realtime.awaitingTxids(), ["78"]);
      realtime.arrive("78");
      yield* settled;
      assert.deepEqual(yield* Fiber.join(read), {
        readSeq: 0,
        reads: [{ channelId: CHANNEL_ID, readSeq: 3 }],
        txid: "78",
      });

      // A read to where the cursor stands writes nothing, and another workspace's chat is not followed.
      answerWrites({ readSeq: 0 });
      yield* Fiber.join(yield* write(WORKSPACE_ID, { readTo: 3, channelId: CHANNEL_ID }));
      answerWrites({ readSeq: 0, txid: "79" });
      yield* Fiber.join(
        yield* write("3c1e9d2b-7a4f-4e6b-8d0c-1f2a3b4c5d6e", { readTo: 3, channelId: CHANNEL_ID }),
      );
      assert.deepEqual(realtime.awaitingTxids(), []);
    }),
);

it.effect(
  "a workspace's chat the service seals nothing for is told unanswered and followed again after a pause, one the account is not in is told not found and let go, and letting go, a sign-out, or a closed gate ends the follow",
  () =>
    Effect.gen(function* () {
      const unsealed = yield* subject();
      yield* unsealed.call(GATEWAY_METHOD.CODING_AGENTS_CHAT_FOLLOW, { workspaceId: WORKSPACE_ID });
      yield* settled;
      assert.deepEqual(unsealed.chats(), [
        { workspaceId: WORKSPACE_ID, chat: { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED } },
      ]);
      unsealed.sealChat(SEALED_CHAT);
      yield* TestClock.adjust("5 seconds");
      yield* settled;
      assert.deepEqual(unsealed.realtime.opened, [SEALED_CHAT.url]);

      const outside = yield* subject();
      outside.sealChat({ failure: CODING_AGENT_CALL_FAILURE.NOT_FOUND });
      yield* outside.call(GATEWAY_METHOD.CODING_AGENTS_CHAT_FOLLOW, { workspaceId: WORKSPACE_ID });
      yield* settled;
      yield* TestClock.adjust("1 minute");
      yield* settled;
      assert.deepEqual(outside.asked, [`chat-join:${WORKSPACE_ID}`]);
      assert.deepEqual(outside.chats(), [
        { workspaceId: WORKSPACE_ID, chat: { failure: CODING_AGENT_CALL_FAILURE.NOT_FOUND } },
      ]);

      const live = yield* subject();
      live.sealChat(SEALED_CHAT);
      yield* live.call(GATEWAY_METHOD.CODING_AGENTS_CHAT_FOLLOW, { workspaceId: WORKSPACE_ID });
      yield* settled;
      yield* live.call(GATEWAY_METHOD.CODING_AGENTS_CHAT_UNFOLLOW, { workspaceId: WORKSPACE_ID });
      yield* settled;
      assert.deepEqual(live.realtime.closed, [SEALED_CHAT.url]);
      assert.deepEqual(live.realtime.subscribed(), []);
      yield* live.call(GATEWAY_METHOD.CODING_AGENTS_CHAT_FOLLOW, { workspaceId: WORKSPACE_ID });
      yield* settled;
      yield* live.reset;
      yield* settled;
      assert.deepEqual(live.realtime.closed, [SEALED_CHAT.url, SEALED_CHAT.url]);

      const closed = yield* subject({ signedIn: false });
      yield* closed.call(GATEWAY_METHOD.CODING_AGENTS_CHAT_FOLLOW, { workspaceId: WORKSPACE_ID });
      yield* settled;
      assert.deepEqual(closed.asked, []);
      assert.deepEqual(closed.chats(), [
        { workspaceId: WORKSPACE_ID, chat: { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED } },
      ]);
    }),
);

const PLAN_SCOPE = { kind: "plan", id: TASK_ID } as const;

/** Steps taken until the host has told `times` inboxes, since a row's digest is the platform's own promise. */
const toldTimes = (told: () => readonly unknown[], times: number) =>
  Effect.repeat(Effect.yieldNow, { until: () => told().length >= times, times: 10_000 });
const AGENT_SCOPE = { kind: "agent", id: AGENT_ID } as const;

it.effect(
  "a followed plan's inbox is told from its Realtime subscription once its rows land, again each time they move and never when a delivery moved nothing; letting it go ends the telling",
  () =>
    Effect.gen(function* () {
      const { call, asked, sealScope, realtime, told } = yield* subject();
      sealScope(SEALED_SCOPE);
      assert.deepEqual(yield* call(GATEWAY_METHOD.CODING_AGENTS_INBOX_FOLLOW, PLAN_SCOPE), {});
      yield* settled;
      assert.deepEqual(realtime.opened, [SEALED_SCOPE.url]);
      assert.deepEqual(told(), []);

      realtime.deliver("messages", []);
      realtime.deliver("files", []);
      realtime.deliver("items", [ITEM_ROW]);
      yield* toldTimes(told, 1);
      realtime.deliver("items", [ITEM_ROW]);
      yield* settled;
      const closed = {
        ...ITEM_ROW,
        revision: 3,
        status: INBOX_STATUS.CLOSED,
        closedReason: "Done",
      };
      realtime.deliver("items", [closed]);
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
      assert.ok(!JSON.stringify(told()).includes("capability"));

      yield* call(GATEWAY_METHOD.CODING_AGENTS_INBOX_UNFOLLOW, PLAN_SCOPE);
      yield* settled;
      realtime.deliver("items", [ITEM_ROW]);
      yield* settled;
      assert.equal(told().length, 2);
    }),
);

it.effect(
  "a message landing after its item's row is told as soon as it lands, its item's thread whole",
  () =>
    Effect.gen(function* () {
      const { call, sealScope, realtime, told } = yield* subject();
      sealScope(SEALED_SCOPE);
      yield* call(GATEWAY_METHOD.CODING_AGENTS_INBOX_FOLLOW, PLAN_SCOPE);
      yield* settled;
      realtime.deliver("messages", []);
      realtime.deliver("files", []);
      realtime.deliver("items", [ITEM_ROW]);
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
      realtime.deliver("messages", [message]);
      yield* toldTimes(told, 2);
      assert.equal(told().length, 2);
      assert.ok(JSON.stringify(told()[1]).includes("Also the staging branch?"));
    }),
);

it.effect(
  "an agent's inbox the account does not reach is told not found, one the service seals nothing for is told unanswered, and behind a closed gate every follow is told unanswered",
  () =>
    Effect.gen(function* () {
      const refused = yield* subject();
      refused.sealScope({ failure: CODING_AGENT_CALL_FAILURE.NOT_FOUND });
      yield* refused.call(GATEWAY_METHOD.CODING_AGENTS_INBOX_FOLLOW, AGENT_SCOPE);
      yield* settled;
      assert.deepEqual(refused.told(), [
        { scope: AGENT_SCOPE, inbox: { failure: CODING_AGENT_CALL_FAILURE.NOT_FOUND } },
      ]);

      const unsealed = yield* subject();
      yield* unsealed.call(GATEWAY_METHOD.CODING_AGENTS_INBOX_FOLLOW, AGENT_SCOPE);
      yield* settled;
      assert.deepEqual(unsealed.told(), [
        { scope: AGENT_SCOPE, inbox: { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED } },
      ]);
      assert.deepEqual(unsealed.realtime.opened, []);

      const signedOut = yield* subject({ signedIn: false });
      yield* signedOut.call(GATEWAY_METHOD.CODING_AGENTS_INBOX_FOLLOW, PLAN_SCOPE);
      yield* settled;
      assert.deepEqual(signedOut.told(), [
        { scope: PLAN_SCOPE, inbox: { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED } },
      ]);
      assert.deepEqual(signedOut.asked, []);
    }),
);

it.effect("a sign-out lets every followed inbox go", () =>
  Effect.gen(function* () {
    const { call, sealScope, realtime, told, reset } = yield* subject();
    sealScope(SEALED_SCOPE);
    yield* call(GATEWAY_METHOD.CODING_AGENTS_INBOX_FOLLOW, PLAN_SCOPE);
    yield* settled;
    yield* reset;
    yield* settled;
    assert.deepEqual(realtime.closed, [SEALED_SCOPE.url]);
    assert.deepEqual(told(), []);
  }),
);

const ACCOUNT_PARTS = [
  "items",
  "planless",
  "plans",
  "automations",
  "failedRuns",
  "chatAsks",
  "chatNotices",
] as const;

const SEALED_ACCOUNT: AccountInboxLiveAnswer = {
  url: "wss://realtime.example/v1",
  queries: {
    items: sealed("items"),
    planless: sealed("planless"),
    plans: sealed("plans"),
    automations: sealed("automations"),
    failedRuns: sealed("failedRuns"),
    chatAsks: sealed("chatAsks"),
    chatNotices: sealed("chatNotices"),
  },
};

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
  realtime: ReturnType<typeof fakeRealtime>,
  rows: { readonly items?: readonly unknown[]; readonly failedRuns?: readonly unknown[] },
) {
  for (const part of ACCOUNT_PARTS) {
    realtime.deliver(part, part === "items" || part === "failedRuns" ? (rows[part] ?? []) : []);
  }
}

it.effect(
  "what waits across the account is told from its Realtime subscription each time it moves, whole and never a sealed statement, and a failed run ageing out of the week tells it again",
  () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW);
      const { call, asked, sealAccount, realtime, accountInboxes } = yield* subject();
      sealAccount(SEALED_ACCOUNT);

      yield* call(GATEWAY_METHOD.CODING_AGENTS_ACCOUNT_INBOX_FOLLOW);
      yield* settled;
      assert.deepEqual(realtime.opened, [SEALED_ACCOUNT.url]);
      deliverAccount(realtime, { items: [WAITING], failedRuns: [FAILED_RUN] });
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
          chat: [],
          cursor: "",
          readAt: NOW,
        },
      );
      assert.ok(!JSON.stringify(answered).includes("capability"));

      deliverAccount(realtime, {
        items: [{ ...WAITING, revision: 3, updatedAt: NOW }],
        failedRuns: [FAILED_RUN],
      });
      yield* settled;
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
      yield* call(GATEWAY_METHOD.CODING_AGENTS_ACCOUNT_INBOX_UNFOLLOW);
      const told = accountInboxes().length;
      deliverAccount(realtime, { items: [] });
      yield* settled;
      assert.equal(accountInboxes().length, told);
    }),
);

it.effect(
  "the account inbox is told unanswered with nobody signed in, and a session the service signs out is sealed again after a rest, telling nothing meanwhile",
  () =>
    Effect.gen(function* () {
      const nobody = yield* subject({ accountId: () => undefined });
      nobody.sealAccount(SEALED_ACCOUNT);
      yield* nobody.call(GATEWAY_METHOD.CODING_AGENTS_ACCOUNT_INBOX_FOLLOW);
      yield* settled;
      assert.deepEqual(nobody.accountInboxes(), [
        { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED },
      ]);
      assert.deepEqual(nobody.asked, []);

      const { call, asked, sealAccount, realtime, accountInboxes } = yield* subject();
      sealAccount(LIVE_SIGNED_OUT);
      yield* call(GATEWAY_METHOD.CODING_AGENTS_ACCOUNT_INBOX_FOLLOW);
      yield* settled;
      assert.deepEqual(asked, ["account-inbox-live:user-dana"]);
      yield* TestClock.adjust("5 seconds");
      yield* settled;
      assert.deepEqual(asked, ["account-inbox-live:user-dana", "account-inbox-live:user-dana"]);
      assert.deepEqual(accountInboxes(), []);
      assert.deepEqual(realtime.opened, []);
      yield* call(GATEWAY_METHOD.CODING_AGENTS_ACCOUNT_INBOX_UNFOLLOW);
    }),
);

it.effect(
  "a mark is answered once a followed inbox has its transaction, and at once where no inbox is followed over Realtime or the write changed nothing",
  () =>
    Effect.gen(function* () {
      const { call, sealScope, realtime, told, commitIn } = yield* subject();
      const markRead = { itemId: ITEM.id, unread: false };
      commitIn("41");
      assert.deepEqual(
        yield* call(GATEWAY_METHOD.CODING_AGENTS_INBOX_READ_STATE, markRead),
        { id: ITEM.id, unread: false, txid: "41" },
        "with no inbox followed, nothing is waited on",
      );

      sealScope(SEALED_SCOPE);
      yield* call(GATEWAY_METHOD.CODING_AGENTS_INBOX_FOLLOW, PLAN_SCOPE);
      yield* settled;
      realtime.deliver("messages", []);
      realtime.deliver("files", []);
      realtime.deliver("items", [ITEM_ROW]);
      yield* toldTimes(told, 1);

      commitIn("42");
      const marking = yield* Effect.forkChild(
        call(GATEWAY_METHOD.CODING_AGENTS_INBOX_READ_STATE, markRead),
      );
      yield* settled;
      assert.deepEqual(realtime.awaitingTxids(), ["42"]);
      assert.equal(marking.pollUnsafe(), undefined, "not answered before the inbox has it");
      realtime.arrive("42");
      assert.deepEqual(yield* Fiber.join(marking), { id: ITEM.id, unread: false, txid: "42" });

      commitIn(undefined);
      assert.deepEqual(
        yield* call(GATEWAY_METHOD.CODING_AGENTS_INBOX_READ_ALL, { workspaceId: WORKSPACE_ID }),
        { marked: 2 },
        "a write that changed nothing answers at once",
      );
      assert.deepEqual(realtime.awaitingTxids(), []);
    }),
);

it.effect(
  "a sent message answers before its row's transaction reaches the transcript a window follows, so the next send is not held behind it",
  () =>
    Effect.gen(function* () {
      const { call, sealTranscript, pageNow: script, sendTxid, realtime, asked } = yield* subject();
      sealTranscript(SEALED_TRANSCRIPT);
      script(pageNow("1:0", { holds: true }));
      yield* call(GATEWAY_METHOD.CODING_AGENTS_TRANSCRIPT_FOLLOW, FOLLOWED);
      yield* settled;
      transcriptRows(realtime, 1);
      yield* settled;
      sendTxid("742");

      const first = yield* Effect.forkChild(
        call(GATEWAY_METHOD.CODING_AGENTS_MESSAGE, {
          agentId: AGENT_ID,
          text: "Use seven days.",
          clientKey: "send-1",
        }),
      );
      yield* settled;
      assert.notEqual(first.pollUnsafe(), undefined, "answered with its row still on its way");
      assert.deepEqual(yield* Fiber.join(first), { agent: AGENT });

      sendTxid("743");
      assert.deepEqual(
        yield* call(GATEWAY_METHOD.CODING_AGENTS_MESSAGE, {
          agentId: AGENT_ID,
          text: "And email them.",
          clientKey: "send-2",
        }),
        { agent: AGENT },
      );
      assert.deepEqual(realtime.awaitingTxids(), []);
      assert.deepEqual(
        asked.filter((each) => each.startsWith("message:")),
        [`message:${AGENT_ID}:send-1:Use seven days.`, `message:${AGENT_ID}:send-2:And email them.`],
      );
    }),
);

it.effect(
  "a Start answers its agent before the task list carries the Start's transaction",
  () =>
    Effect.gen(function* () {
      const { call, startCommits } = yield* subject({ listed: () => Effect.never });
      startCommits("9104");

      const starting = yield* Effect.forkChild(
        call(GATEWAY_METHOD.CODING_AGENTS_START, { taskId: TASK_ID, idempotencyKey: "press-1" }),
      );
      yield* settled;

      assert.notEqual(starting.pollUnsafe(), undefined, "answered with the list still behind");
      assert.deepEqual(yield* Fiber.join(starting), {
        agent: { ...AGENT, status: CODING_AGENT_STATUS.STARTING },
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
      assert.deepEqual(unanswered, { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED });
      assert.deepEqual(asked, [`memories:${WORKSPACE_ID}`, `forget:${WORKSPACE_ID}:${MEMORY.id}`]);
      assert.deepEqual(signedOut.asked, []);
    }),
);
