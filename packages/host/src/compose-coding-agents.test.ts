import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import {
  ACCOUNT_CHAT_REASON,
  type AccountChatEntry,
  type AccountInboxEntry,
  accountInboxAnswerSchema,
} from "@luke/features/account-inbox-wire";
import { CHAT_CURSOR_START, MEMBER_KIND } from "@luke/features/chat-wire";
import { CODING_AGENT_CALL_FAILURE } from "@luke/features/coding-agent-view";
import {
  CHANGED_FILE_STATUS,
  CHECK_SUMMARY,
  CODING_AGENT_CURSOR_START,
  CODING_AGENT_STATUS,
  type CodingAgentPage,
  type CodingAgentSummary,
  MERGE_STATE,
  PULL_REQUEST_STATE,
} from "@luke/features/coding-agent-wire";
import { GITHUB_IMAGE_TYPE } from "@luke/features/github-image";
import {
  INBOX_CURSOR_START,
  INBOX_IMAGE_TYPE,
  INBOX_MESSAGE_AUTHOR,
  INBOX_REPLY,
  INBOX_RESPONSE,
  INBOX_STATUS,
  INBOX_WIRE_VERSION,
  type InboxItem,
} from "@luke/features/inbox-wire";
import { INTEGRATION_PROVIDER } from "@luke/features/integration-wire";
import type {
  AccountInboxLiveAnswer,
  AgentTranscriptLiveAnswer,
  ScopeInboxLiveAnswer,
  TranscriptNowAnswer,
} from "@luke/features/live-wire";
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
import { isRecord, isWireString, type WireRecord, type WireValue } from "@luke/wire";
import { noNetwork } from "@luke/wire/testing";
import { Duration, Effect, Fiber, Schema } from "effect";
import { TestClock } from "effect/testing";
import { type CodingAgentClient, composeCodingAgents } from "./compose-coding-agents.js";
import type { LiveClient } from "./live-follow.js";

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
const CHAT = {
  self: MEMBER_ID,
  readSeq: 0,
  members: [{ id: MEMBER_ID, kind: MEMBER_KIND.HUMAN, handle: "ada", left: false }],
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

/** What the service answers of a kept key: never the key. */
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

/** The service as a script, writing down every ask in the order it was made. */
function fakeService() {
  const asked: string[] = [];
  let live: AccountInboxLiveAnswer | undefined;
  let scope: ScopeInboxLiveAnswer | { readonly failure: "not-found" } | undefined;
  let transcript: AgentTranscriptLiveAnswer | { readonly failure: "not-found" } | undefined;
  // Each page read at once, in turn; the last stands once the others are read.
  let pagesNow: readonly TranscriptNowAnswer[] = [];
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
        assert.ok(page, "a page read at once was scripted");
        if (rest.length > 0) pagesNow = rest;
        return page;
      }),
    agentTranscriptLive: (agentId, callId) =>
      Effect.sync(() => {
        asked.push(
          callId === undefined
            ? `transcript-live:${agentId}`
            : `transcript-live:${agentId}:${callId}`,
        );
        return transcript ?? { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED };
      }),
    message: (agentId, request) =>
      Effect.sync(() => {
        asked.push(`message:${agentId}:${request.clientKey}:${request.text}`);
        return { agent: AGENT };
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
    archive: (agentId, request) =>
      Effect.sync(() => {
        asked.push(`archive:${agentId}:${String(request.archived)}`);
        return { agent: { ...AGENT, archivedAt: 1_800_000_120_000 } };
      }),
    pin: (agentId, request) =>
      Effect.sync(() => {
        asked.push(`pin:${agentId}:${String(request.pinned)}`);
        return { agent: AGENT };
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
    markInboxItemRead: (itemId) =>
      Effect.sync(() => {
        asked.push(`inbox-read:${itemId}`);
        return { id: itemId, unread: false };
      }),
    markInboxItemUnread: (itemId) =>
      Effect.sync(() => {
        asked.push(`inbox-unread:${itemId}`);
        return { id: itemId, unread: true };
      }),
    markInboxRead: (request) =>
      Effect.sync(() => {
        asked.push(`inbox-read-all:${request?.workspaceId ?? ""}`);
        return { marked: 2 };
      }),
    messageInbox: (itemId, request) =>
      Effect.sync(() => {
        const files = (request.attachments ?? []).map((file) => file.name).join(",");
        asked.push(`inbox-message:${itemId}:${request.text}:${files}:${request.clientKey}`);
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
    closeInbox: (itemId, request) =>
      Effect.sync(() => {
        asked.push(`close:${itemId}:${request.revision}:${request.clientKey}`);
        return {
          item: { ...ITEM, status: INBOX_STATUS.CLOSED, closedBy: { userId: "u1", name: "Dana" } },
          taken: true,
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
    accountInboxLive: () =>
      Effect.sync(() => {
        asked.push("account-inbox-live");
        return live ?? { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED };
      }),
    chat: (workspaceId, after) =>
      Effect.sync(() => {
        asked.push(`chat:${workspaceId}:${after}`);
        return CHAT;
      }),
    chatPost: (workspaceId, write) =>
      Effect.sync(() => {
        asked.push(`chat-post:${workspaceId}:${JSON.stringify(write)}`);
        return { readSeq: 4 };
      }),
    chatAttachment: (workspaceId, messageId, attachmentId) =>
      Effect.sync(() => {
        asked.push(`chat-attachment:${workspaceId}:${messageId}:${attachmentId}`);
        return { contentType: INBOX_IMAGE_TYPE.PNG, base64: "iVBORw0KGgo=" };
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
  };
  return {
    client,
    asked,
    /** What the service seals for following the account's inbox; none answers unanswered. */
    seal: (next: AccountInboxLiveAnswer | undefined) => {
      live = next;
    },
    /** What the service seals for following a plan's or an agent's inbox, or that the account reaches none; none answers unanswered. */
    sealScope: (next: ScopeInboxLiveAnswer | { readonly failure: "not-found" } | undefined) => {
      scope = next;
    },
    /** What the service seals for following a transcript, or that the account reaches no such agent; none answers unanswered. */
    sealTranscript: (
      next: AgentTranscriptLiveAnswer | { readonly failure: "not-found" } | undefined,
    ) => {
      transcript = next;
    },
    /** The pages the service answers read at once, in turn. */
    pageNow: (...pages: readonly TranscriptNowAnswer[]) => {
      pagesNow = pages;
    },
  };
}

function subject(options: { signedIn?: boolean; sendsNetwork?: boolean } = {}) {
  return Effect.gen(function* () {
    const service = fakeService();
    const realtime = fakeRealtime();
    const events: { kind: GatewayEventKind; payload: WireValue }[] = [];
    // The host's clock, which `advance` moves with the test's.
    let elapsed = 0;
    const composer = yield* composeCodingAgents({
      kernel: {
        runMode: { sendsNetwork: options.sendsNetwork ?? true },
        emit: (kind, payload) => void events.push({ kind, payload }),
        now: () => NOW + elapsed,
      },
      account: { capabilitiesActive: () => options.signedIn ?? true },
      client: service.client,
      openLive: realtime.open,
    }).pipe(Effect.provide(noNetwork));
    const call = (method: GatewayMethod, params: WireRecord = {}) => {
      const handler = composer.methods[method];
      assert.ok(handler, `no handler for ${method}`);
      return handler(params, context);
    };
    /** Every account inbox the host said changed, in order. */
    const inboxes = () =>
      events.flatMap((event) =>
        event.kind === GATEWAY_EVENT.ACCOUNT_INBOX_CHANGED ? [event.payload] : [],
      );
    return {
      call,
      asked: service.asked,
      seal: service.seal,
      sealScope: service.sealScope,
      sealTranscript: service.sealTranscript,
      pageNow: service.pageNow,
      realtime,
      inboxes,
      reset: composer.reset,
      /** The host's clock and the test's moved on together, a minute at a time, so neither runs far ahead of the other. */
      advance: (millis: number) =>
        Effect.gen(function* () {
          for (let left = millis; left > 0; left -= MINUTE) {
            const step = Math.min(left, MINUTE);
            elapsed += step;
            yield* TestClock.adjust(Duration.millis(step));
          }
        }),
    };
  });
}

/** The host's clock, which an answer read live is stamped with. */
const NOW = 1_800_000_100_000;

const MINUTE = 60 * 1_000;
const DAY = 24 * 60 * MINUTE;

/** A sealed statement as the service answers one, named by the part it follows. */
function sealed(part: string, expiresAt = NOW + 60_000) {
  return { capability: `capability-${part}`, queryFingerprint: `fingerprint-${part}`, expiresAt };
}

const SEALED: AccountInboxLiveAnswer = {
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

/**
 * Realtime as a script: the address each client was opened at, each part's
 * subscription by its capability, the seals each was renewed with, and a
 * way to deliver rows to one or stop it for good.
 */
function fakeRealtime() {
  const opened: string[] = [];
  const closed: string[] = [];
  const listeners = new Map<
    string,
    (snapshot: { readonly status: string; readonly data: readonly unknown[] | undefined }) => void
  >();
  const renewed: string[] = [];
  const open = (url: string): LiveClient => {
    opened.push(url);
    return {
      subscribe: (query) => ({
        onChange: (listener) => {
          listeners.set(query.capability, listener);
          return () => listeners.delete(query.capability);
        },
        renew: (next) => {
          renewed.push(next.capability);
          return Promise.resolve();
        },
        unsubscribe: () => void listeners.delete(query.capability),
      }),
      close: () => void closed.push(url),
    };
  };
  return {
    open,
    opened,
    closed,
    renewed,
    /** Rows delivered to the part's subscription, as Realtime's snapshot carries them. */
    deliver: (part: string, data: readonly unknown[]) => {
      const listener = listeners.get(`capability-${part}`);
      assert.ok(listener, `no subscription to ${part}`);
      listener({ status: "live", data });
    },
    fail: (part: string) => listeners.get(`capability-${part}`)?.({ status: "error", data: [] }),
    subscribed: () => [...listeners.keys()].toSorted(),
  };
}

it.effect("each method asks the service once and answers what it said, whole", () =>
  Effect.gen(function* () {
    const { call, asked, sealTranscript, pageNow: script } = yield* subject();
    const page = pageNow("2:1", { holds: false, text: "Hi" });
    sealTranscript(SEALED_TRANSCRIPT);
    script(page);

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
      windowPage(page),
    );
    assert.deepEqual(
      yield* call(GATEWAY_METHOD.CODING_AGENTS_MESSAGES, {
        agentId: AGENT_ID,
        after: CODING_AGENT_CURSOR_START,
        callId: "call-7",
      }),
      windowPage(page),
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
    assert.deepEqual(yield* call(GATEWAY_METHOD.CODING_AGENTS_PAGE, { agentId: AGENT_ID }), {
      agent: PAGE,
    });
    assert.deepEqual(
      yield* call(GATEWAY_METHOD.CODING_AGENTS_AGENT_INBOX, {
        agentId: AGENT_ID,
        after: INBOX_CURSOR_START,
      }),
      { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED },
    );
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
      yield* call(GATEWAY_METHOD.CODING_AGENTS_INBOX, {
        taskId: TASK_ID,
        after: INBOX_CURSOR_START,
      }),
      { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED },
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
      yield* call(GATEWAY_METHOD.CODING_AGENTS_CHAT, {
        workspaceId: WORKSPACE_ID,
        after: CHAT_CURSOR_START,
      }),
      CHAT,
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
      `transcript-live:${AGENT_ID}`,
      `messages-now:${AGENT_ID}:${CODING_AGENT_CURSOR_START}`,
      `transcript-live:${AGENT_ID}:call-7`,
      `worker-now:${AGENT_ID}:call-7:${CODING_AGENT_CURSOR_START}`,
      `message:${AGENT_ID}:send-1:Also expire them after a week.`,
      `choose:${AGENT_ID}:openai/gpt-6.1-sol:low`,
      `rename:${AGENT_ID}:Sign-out button`,
      `servers:${AGENT_ID}:linear`,
      `stop:${AGENT_ID}`,
      `archive:${AGENT_ID}:true`,
      `pin:${AGENT_ID}:true`,
      `page:${AGENT_ID}`,
      `agent-inbox-live:${AGENT_ID}`,
      `pull-request:${AGENT_ID}`,
      `changes:${AGENT_ID}`,
      `changes:${AGENT_ID}#11`,
      `overview-pull-request:${AGENT_ID}`,
      `review-options:${AGENT_ID}`,
      `overview-checks:${AGENT_ID}`,
      `overview-conversation:${AGENT_ID}`,
      `github-image:${AGENT_ID}:https://camo.githubusercontent.com/abc`,
      `pull-request-action:${AGENT_ID}#11:${PULL_REQUEST_ACTION.READY_FOR_REVIEW}`,
      `pull-request-viewed:${AGENT_ID}`,
      `plan-inbox-live:${TASK_ID}`,
      `attachment:${ITEM.id}:${ATTACHMENT_ID}`,
      `picture:${AGENT_ID}:${PICTURE_ID}:call-worker`,
      `answer:${ITEM.id}:2:${INBOX_REPLY.DECLINED}:Not before the freeze lifts.:answer-1`,
      `close:${ITEM.id}:2:close-1`,
      `inbox-message:${ITEM.id}:Also page on-call.:pager.txt:message-1`,
      `inbox-unread:${ITEM.id}`,
      `inbox-read:${ITEM.id}`,
      `inbox-read-all:${WORKSPACE_ID}`,
      `chat:${WORKSPACE_ID}:${CHAT_CURSOR_START}`,
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

/** Every step the follower has to take, taken: it runs on a fiber of its own. */
const settled = Effect.repeat(Effect.yieldNow, { times: 100 });

/** A second item, changed after `WAITING`, which the answer lists first. */
const NEWER: AccountInboxEntry = {
  ...WAITING,
  id: "6f3e8d4b-2c5a-4f7b-9d0e-1a2b3c4d5e6f",
  title: "Expire invites after a week?",
  updatedAt: WAITING.updatedAt + 1_000,
};

const AUTOMATION_ID = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";

/** A run that failed to start, `daysAgo` before the host's clock. */
function failedRun(id: string, daysAgo: number) {
  return {
    id,
    automationId: AUTOMATION_ID,
    automationName: "Nightly flake sweep",
    workspaceId: "workspace-1",
    reason: null,
    failedAt: NOW - daysAgo * 24 * 60 * 60 * 1_000,
  };
}

/** One message waiting in chat, as a chat part's row delivers it. */
function chatEntry(
  messageId: string,
  reason: AccountChatEntry["reason"],
  updatedAt: number,
): AccountChatEntry {
  return {
    messageId,
    seq: 7,
    workspaceId: "workspace-1",
    reason,
    from: "agent-1",
    planId: null,
    touchedSeq: 7,
    updatedAt,
  };
}

it.effect(
  "the account inbox is followed over Realtime: every part subscribed at the address it names, and once each part has its rows the answer published whole, in the held read's order, with the last week's failed runs, and never a sealed statement",
  () =>
    Effect.gen(function* () {
      const { call, asked, seal, realtime, inboxes } = yield* subject();
      seal(SEALED);
      yield* call(GATEWAY_METHOD.CODING_AGENTS_ACCOUNT_INBOX_FOLLOW);
      yield* settled;
      assert.deepEqual(realtime.opened, [SEALED.url]);
      assert.deepEqual(realtime.subscribed(), [
        "capability-automations",
        "capability-chatAsks",
        "capability-chatNotices",
        "capability-failedRuns",
        "capability-items",
        "capability-planless",
        "capability-plans",
      ]);

      const recent = "2a3b4c5d-6e7f-4a8b-9c0d-1e2f3a4b5c6d";
      realtime.deliver("items", [WAITING, NEWER]);
      realtime.deliver("planless", []);
      realtime.deliver("plans", [{ planId: TASK_ID, items: 2, updatedAt: NEWER.updatedAt }]);
      realtime.deliver("automations", []);
      // A notice of an ask is the ask already, so only the other notice joins it.
      const ask = chatEntry(
        "4c5d6e7f-8a9b-4c0d-9e1f-2a3b4c5d6e7f",
        ACCOUNT_CHAT_REASON.ASK,
        NOW - 2,
      );
      const direct = chatEntry(
        "5d6e7f8a-9b0c-4d1e-8f2a-3b4c5d6e7f8a",
        ACCOUNT_CHAT_REASON.DIRECT,
        NOW - 1,
      );
      realtime.deliver("chatAsks", [ask]);
      realtime.deliver("chatNotices", [{ ...ask, reason: ACCOUNT_CHAT_REASON.MENTION }, direct]);
      yield* settled;
      // Nothing is published before every part has its first rows.
      assert.deepEqual(inboxes(), []);
      realtime.deliver("failedRuns", [
        failedRun("3b4c5d6e-7f8a-4b9c-8d1e-2f3a4b5c6d7e", 8),
        failedRun(recent, 1),
      ]);
      yield* settled;

      // The cursor is a digest of what the answer holds, opaque to a reader but for comparing.
      const published = inboxes().map((inbox) => {
        const { cursor: _cursor, ...rest } =
          Schema.decodeUnknownSync(accountInboxAnswerSchema)(inbox);
        return rest;
      });
      assert.deepEqual(published, [
        {
          items: [NEWER, WAITING],
          plans: [{ planId: TASK_ID, items: 2, updatedAt: NEWER.updatedAt }],
          planless: [],
          automations: [],
          failedRuns: [failedRun(recent, 1)],
          chat: [direct, ask],
          readAt: NOW,
        },
      ]);
      assert.deepEqual(asked, ["account-inbox-live"]);
      assert.ok(!JSON.stringify(inboxes()).includes("capability"));
    }),
);

it.effect(
  "a failed run that ages out of the last week with no row moving is let go: the answer is published again as it does",
  () =>
    Effect.gen(function* () {
      const { call, seal, realtime, inboxes, advance } = yield* subject();
      seal({
        ...SEALED,
        // Sealed for a month, so no renewal falls in the week the test spans.
        queries: {
          items: sealed("items", NOW + 30 * DAY),
          planless: sealed("planless", NOW + 30 * DAY),
          plans: sealed("plans", NOW + 30 * DAY),
          automations: sealed("automations", NOW + 30 * DAY),
          failedRuns: sealed("failedRuns", NOW + 30 * DAY),
          chatAsks: sealed("chatAsks", NOW + 30 * DAY),
          chatNotices: sealed("chatNotices", NOW + 30 * DAY),
        },
      });
      yield* call(GATEWAY_METHOD.CODING_AGENTS_ACCOUNT_INBOX_FOLLOW);
      yield* settled;
      const ageing = failedRun("3b4c5d6e-7f8a-4b9c-8d1e-2f3a4b5c6d7e", 6);
      for (const part of ["items", "planless", "plans", "automations", "chatAsks", "chatNotices"]) {
        realtime.deliver(part, []);
      }
      realtime.deliver("failedRuns", [ageing]);
      yield* settled;
      const failedRunsOf = () =>
        inboxes().map(
          (inbox) => Schema.decodeUnknownSync(accountInboxAnswerSchema)(inbox).failedRuns,
        );
      assert.deepEqual(failedRunsOf(), [[ageing]]);

      yield* advance(DAY - 1_000);
      yield* settled;
      assert.deepEqual(failedRunsOf(), [[ageing]], "a day short of a week, it still stands");
      yield* advance(2_000);
      yield* settled;
      assert.deepEqual(failedRunsOf(), [[ageing], []]);
    }),
);

it.effect(
  "every seal is renewed ten seconds before the earliest expires, with what the service seals then, and a row that does not decode stops the subscription, which is started again",
  () =>
    Effect.gen(function* () {
      const { call, asked, seal, realtime } = yield* subject();
      seal(SEALED);
      yield* call(GATEWAY_METHOD.CODING_AGENTS_ACCOUNT_INBOX_FOLLOW);
      yield* settled;

      yield* TestClock.adjust("49 seconds");
      yield* settled;
      assert.deepEqual(realtime.renewed, []);
      yield* TestClock.adjust("1 second");
      yield* settled;
      assert.deepEqual(realtime.renewed.toSorted(), [
        "capability-automations",
        "capability-chatAsks",
        "capability-chatNotices",
        "capability-failedRuns",
        "capability-items",
        "capability-planless",
        "capability-plans",
      ]);
      assert.deepEqual(asked, ["account-inbox-live", "account-inbox-live"]);

      realtime.deliver("items", [{ id: "not an item" }]);
      for (const part of [
        "planless",
        "plans",
        "automations",
        "failedRuns",
        "chatAsks",
        "chatNotices",
      ]) {
        realtime.deliver(part, []);
      }
      yield* settled;
      assert.deepEqual(realtime.closed, [SEALED.url]);
      yield* TestClock.adjust("5 seconds");
      yield* settled;
      assert.deepEqual(realtime.opened, [SEALED.url, SEALED.url]);
    }),
);

it.effect(
  "a seal the service did not answer is asked for again after a pause, and letting go, or a sign-out, ends the follow",
  () =>
    Effect.gen(function* () {
      const unsealed = yield* subject();
      yield* unsealed.call(GATEWAY_METHOD.CODING_AGENTS_ACCOUNT_INBOX_FOLLOW);
      yield* settled;
      assert.deepEqual(unsealed.asked, ["account-inbox-live"]);
      unsealed.seal(SEALED);
      yield* TestClock.adjust("5 seconds");
      yield* settled;
      assert.deepEqual(unsealed.asked, ["account-inbox-live", "account-inbox-live"]);
      assert.deepEqual(unsealed.realtime.opened, [SEALED.url]);
      assert.deepEqual(unsealed.inboxes(), []);

      const live = yield* subject();
      live.seal(SEALED);
      yield* live.call(GATEWAY_METHOD.CODING_AGENTS_ACCOUNT_INBOX_FOLLOW);
      yield* settled;
      yield* live.call(GATEWAY_METHOD.CODING_AGENTS_ACCOUNT_INBOX_UNFOLLOW);
      yield* settled;
      assert.deepEqual(live.realtime.closed, [SEALED.url]);
      assert.deepEqual(live.realtime.subscribed(), []);

      yield* live.call(GATEWAY_METHOD.CODING_AGENTS_ACCOUNT_INBOX_FOLLOW);
      yield* settled;
      yield* live.reset;
      yield* settled;
      assert.deepEqual(live.realtime.closed, [SEALED.url, SEALED.url]);
    }),
);

const SEALED_SCOPE: ScopeInboxLiveAnswer = {
  url: "wss://realtime.example/v1",
  queries: { items: sealed("items"), messages: sealed("messages"), files: sealed("files") },
};

/** That item as its row delivers it, what it leaves out held as null. */
/** That item as a reader who has read it reads it live. */
const LIVE_ITEM: InboxItem = { ...ITEM, unread: false };

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

it.effect(
  "a plan's inbox is answered from its Realtime subscription: at once once its rows land, then as soon as they move past the reader's cursor, and unchanged when the hold ends",
  () =>
    Effect.gen(function* () {
      const { call, asked, sealScope, realtime } = yield* subject();
      sealScope(SEALED_SCOPE);
      const first = yield* Effect.forkChild(
        call(GATEWAY_METHOD.CODING_AGENTS_INBOX, { taskId: TASK_ID, after: INBOX_CURSOR_START }),
      );
      yield* settled;
      assert.deepEqual(realtime.opened, [SEALED_SCOPE.url]);
      realtime.deliver("messages", []);
      realtime.deliver("files", []);
      realtime.deliver("items", [ITEM_ROW]);
      yield* settled;
      const answered = yield* Fiber.join(first);
      assert.ok(isRecord(answered) && isWireString(answered.cursor));
      assert.deepEqual(answered.items, [LIVE_ITEM]);

      // Read again from that cursor, it holds until the items move.
      const next = yield* Effect.forkChild(
        call(GATEWAY_METHOD.CODING_AGENTS_INBOX, { taskId: TASK_ID, after: answered.cursor }),
      );
      yield* settled;
      const closed = {
        ...ITEM_ROW,
        revision: 3,
        status: INBOX_STATUS.CLOSED,
        closedReason: "Done",
      };
      realtime.deliver("items", [closed]);
      yield* settled;
      const moved = yield* Fiber.join(next);
      assert.ok(isRecord(moved) && isWireString(moved.cursor));
      assert.notEqual(moved.cursor, answered.cursor);
      assert.deepEqual(moved.items, [
        { ...LIVE_ITEM, revision: 3, status: INBOX_STATUS.CLOSED, closedReason: "Done" },
      ]);

      const unchanged = yield* Effect.forkChild(
        call(GATEWAY_METHOD.CODING_AGENTS_INBOX, { taskId: TASK_ID, after: moved.cursor }),
      );
      yield* settled;
      yield* TestClock.adjust("20 seconds");
      assert.deepEqual(yield* Fiber.join(unchanged), moved);
      // One subscription served every read.
      assert.deepEqual(asked, [`plan-inbox-live:${TASK_ID}`]);
      assert.deepEqual(realtime.opened, [SEALED_SCOPE.url]);
    }),
);

it.effect(
  "a plan's inbox read past its cursor wakes at once when the reader marks an item unread, though nothing else on it moved",
  () =>
    Effect.gen(function* () {
      const { call, sealScope, realtime } = yield* subject();
      sealScope(SEALED_SCOPE);
      const first = yield* Effect.forkChild(
        call(GATEWAY_METHOD.CODING_AGENTS_INBOX, { taskId: TASK_ID, after: INBOX_CURSOR_START }),
      );
      yield* settled;
      realtime.deliver("messages", []);
      realtime.deliver("files", []);
      realtime.deliver("items", [ITEM_ROW]);
      yield* settled;
      const answered = yield* Fiber.join(first);
      assert.ok(isRecord(answered) && isWireString(answered.cursor));

      const next = yield* Effect.forkChild(
        call(GATEWAY_METHOD.CODING_AGENTS_INBOX, { taskId: TASK_ID, after: answered.cursor }),
      );
      yield* settled;
      realtime.deliver("items", [{ ...ITEM_ROW, unread: true }]);
      yield* settled;
      const moved = yield* Fiber.join(next);
      assert.ok(isRecord(moved));
      assert.notEqual(moved.cursor, answered.cursor);
      assert.deepEqual(moved.items, [{ ...LIVE_ITEM, unread: true }]);
    }),
);

it.effect(
  "an agent's inbox the account does not reach is not found, one the service seals nothing for is unanswered, and either is asked for again on the next read",
  () =>
    Effect.gen(function* () {
      const { call, asked, sealScope, realtime } = yield* subject();
      const read = () =>
        call(GATEWAY_METHOD.CODING_AGENTS_AGENT_INBOX, {
          agentId: AGENT_ID,
          after: INBOX_CURSOR_START,
        });
      sealScope({ failure: CODING_AGENT_CALL_FAILURE.NOT_FOUND });
      assert.deepEqual(yield* read(), { failure: CODING_AGENT_CALL_FAILURE.NOT_FOUND });
      sealScope(undefined);
      assert.deepEqual(yield* read(), { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED });
      assert.deepEqual(asked, [`agent-inbox-live:${AGENT_ID}`, `agent-inbox-live:${AGENT_ID}`]);
      assert.deepEqual(realtime.opened, []);
    }),
);

it.effect(
  "a plan's inbox whose subscription stops is unanswered, and the next read subscribes again",
  () =>
    Effect.gen(function* () {
      const { call, sealScope, realtime } = yield* subject();
      sealScope(SEALED_SCOPE);
      const read = () =>
        Effect.forkChild(
          call(GATEWAY_METHOD.CODING_AGENTS_INBOX, { taskId: TASK_ID, after: INBOX_CURSOR_START }),
        );
      const broken = yield* read();
      yield* settled;
      realtime.deliver("messages", []);
      realtime.deliver("files", []);
      realtime.deliver("items", [{ id: "not an item" }]);
      yield* settled;
      assert.deepEqual(yield* Fiber.join(broken), {
        failure: CODING_AGENT_CALL_FAILURE.UNANSWERED,
      });

      const again = yield* read();
      yield* settled;
      realtime.deliver("messages", []);
      realtime.deliver("files", []);
      realtime.deliver("items", [ITEM_ROW]);
      yield* settled;
      const answered = yield* Fiber.join(again);
      assert.ok(isRecord(answered));
      assert.deepEqual(answered.items, [LIVE_ITEM]);
      assert.deepEqual(realtime.opened, [SEALED_SCOPE.url, SEALED_SCOPE.url]);
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
  },
};

/** The transcript's statements as they stand: `seq` its newest message, `turns` how many it has opened. */
function transcriptRows(realtime: ReturnType<typeof fakeRealtime>, seq: number, turns = 1) {
  realtime.deliver("messages", [{ rows: seq, seq }]);
  realtime.deliver("turns", [
    { status: "running", rows: turns, stopped: 0, changedAt: NOW - 1_000 },
  ]);
  realtime.deliver("conversation", [{ title: null, revision: seq }]);
  realtime.deliver("agent", [{ title: "Invites" }]);
  realtime.deliver("workers", []);
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

/** A page as the window is answered it: the service's word on whether it would have held left in the host. */
function windowPage(page: TranscriptNowAnswer) {
  const { holds: _holds, ...rest } = page;
  return rest;
}

it.effect(
  "a running agent's transcript is held open on its Realtime subscription: the page read at once while it says something, then again only when the statements move, the empty page once the hold ends, and never a sealed statement",
  () =>
    Effect.gen(function* () {
      const { call, asked, sealTranscript, pageNow: script, realtime } = yield* subject();
      sealTranscript(SEALED_TRANSCRIPT);
      const said = pageNow("1:0", { holds: false, text: "Reading the invites." });
      script(said);
      const first = yield* call(GATEWAY_METHOD.CODING_AGENTS_MESSAGES, {
        agentId: AGENT_ID,
        after: CODING_AGENT_CURSOR_START,
      });
      assert.deepEqual(first, windowPage(said));
      yield* settled;
      assert.deepEqual(realtime.opened, [SEALED_TRANSCRIPT.url]);
      transcriptRows(realtime, 1);
      yield* settled;

      // Nothing stands past the cursor: the read is held, and the service asked nothing more until a statement moves.
      const nothing = pageNow("1:0", { holds: true });
      const moved = pageNow("2:0", { holds: false, text: "Writing the expiry." });
      script(nothing, moved);
      const next = yield* Effect.forkChild(
        call(GATEWAY_METHOD.CODING_AGENTS_MESSAGES, { agentId: AGENT_ID, after: "1:0" }),
      );
      yield* settled;
      yield* TestClock.adjust("5 seconds");
      yield* settled;
      assert.deepEqual(asked.filter((ask) => ask.startsWith("messages-now")).length, 2);
      transcriptRows(realtime, 2);
      yield* settled;
      assert.deepEqual(yield* Fiber.join(next), windowPage(moved));

      // Nothing moves within the hold: the page as it stands once the hold ends.
      script(pageNow("2:0", { holds: true }));
      const held = yield* Effect.forkChild(
        call(GATEWAY_METHOD.CODING_AGENTS_MESSAGES, { agentId: AGENT_ID, after: "2:0" }),
      );
      yield* settled;
      yield* TestClock.adjust("20 seconds");
      yield* settled;
      assert.deepEqual(yield* Fiber.join(held), windowPage(pageNow("2:0", { holds: true })));

      assert.deepEqual(asked, [
        `transcript-live:${AGENT_ID}`,
        `messages-now:${AGENT_ID}:${CODING_AGENT_CURSOR_START}`,
        `messages-now:${AGENT_ID}:1:0`,
        `messages-now:${AGENT_ID}:1:0`,
        `messages-now:${AGENT_ID}:2:0`,
        `messages-now:${AGENT_ID}:2:0`,
      ]);
      assert.deepEqual(realtime.opened, [SEALED_TRANSCRIPT.url]);
      assert.ok(!JSON.stringify([first, moved]).includes("capability"));
    }),
);

it.effect(
  "a worker's transcript is followed under its own seal, a subscription that stops has the read read again at once and is sealed and opened again after a pause, and a sign-out lets every subscription go",
  () =>
    Effect.gen(function* () {
      const { call, asked, sealTranscript, pageNow: script, realtime, reset } = yield* subject();
      sealTranscript(SEALED_TRANSCRIPT);
      const said = pageNow("2:0", { holds: false, text: "Writing the expiry." });
      script(pageNow("1:0", { holds: true }), said);
      const read = yield* Effect.forkChild(
        call(GATEWAY_METHOD.CODING_AGENTS_MESSAGES, {
          agentId: AGENT_ID,
          after: CODING_AGENT_CURSOR_START,
          callId: "call-7",
        }),
      );
      yield* settled;
      realtime.fail("messages");
      yield* settled;
      assert.deepEqual(yield* Fiber.join(read), windowPage(said));
      assert.deepEqual(realtime.closed, [SEALED_TRANSCRIPT.url]);

      yield* TestClock.adjust("1 second");
      yield* settled;
      assert.deepEqual(asked, [
        `transcript-live:${AGENT_ID}:call-7`,
        `worker-now:${AGENT_ID}:call-7:${CODING_AGENT_CURSOR_START}`,
        `worker-now:${AGENT_ID}:call-7:${CODING_AGENT_CURSOR_START}`,
        `transcript-live:${AGENT_ID}:call-7`,
      ]);
      assert.deepEqual(realtime.opened, [SEALED_TRANSCRIPT.url, SEALED_TRANSCRIPT.url]);

      yield* reset;
      yield* settled;
      assert.deepEqual(realtime.closed, [SEALED_TRANSCRIPT.url, SEALED_TRANSCRIPT.url]);
    }),
);

it.effect(
  "a transcript the account does not reach is not found, and one the service seals nothing for is sealed again each second, then read live",
  () =>
    Effect.gen(function* () {
      const refused = yield* subject();
      refused.sealTranscript({ failure: CODING_AGENT_CALL_FAILURE.NOT_FOUND });
      assert.deepEqual(
        yield* refused.call(GATEWAY_METHOD.CODING_AGENTS_MESSAGES, {
          agentId: AGENT_ID,
          after: CODING_AGENT_CURSOR_START,
        }),
        { failure: CODING_AGENT_CALL_FAILURE.NOT_FOUND },
      );

      const unsealed = yield* subject();
      const said = pageNow("1:0", { holds: false, text: "Reading the invites." });
      unsealed.pageNow(said);
      const read = yield* Effect.forkChild(
        unsealed.call(GATEWAY_METHOD.CODING_AGENTS_MESSAGES, {
          agentId: AGENT_ID,
          after: CODING_AGENT_CURSOR_START,
        }),
      );
      yield* settled;
      yield* TestClock.adjust("1 second");
      yield* settled;
      unsealed.sealTranscript(SEALED_TRANSCRIPT);
      yield* TestClock.adjust("1 second");
      yield* settled;
      assert.deepEqual(yield* Fiber.join(read), windowPage(said));
      assert.deepEqual(unsealed.asked, [
        `transcript-live:${AGENT_ID}`,
        `transcript-live:${AGENT_ID}`,
        `transcript-live:${AGENT_ID}`,
        `messages-now:${AGENT_ID}:${CODING_AGENT_CURSOR_START}`,
      ]);
      assert.deepEqual(unsealed.realtime.opened, [SEALED_TRANSCRIPT.url]);
    }),
);
