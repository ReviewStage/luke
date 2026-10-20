import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
import type { AccountInboxLiveAnswer } from "@luke/features/live-wire";
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
import type { WireRecord, WireValue } from "@luke/wire";
import { noNetwork } from "@luke/wire/testing";
import { Duration, Effect, ErrorReporter, Layer, Option, Schema } from "effect";
import { TestClock } from "effect/testing";
import { afterEach, vi } from "vitest";
import { type LiveClient, openRealtimeClient } from "./account-inbox-follow.js";
import { type CodingAgentClient, composeCodingAgents } from "./compose-coding-agents.js";
import { reporterLayer } from "./effect/seams.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

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
  let cursor = CODING_AGENT_CURSOR_START;
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
    messages: (agentId, after, callId) =>
      Effect.sync(() => {
        asked.push(
          callId === undefined
            ? `messages:${agentId}:${after}`
            : `worker:${agentId}:${callId}:${after}`,
        );
        cursor = "2:1";
        return {
          messages: [{ id: "m-1", role: "assistant", parts: [{ type: "text", text: "Hi" }] }],
          cursor,
          status: CODING_AGENT_STATUS.RUNNING,
          title: null,
        };
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
    agentInbox: (agentId, after) =>
      Effect.sync(() => {
        asked.push(`agent-inbox:${agentId}:${after}`);
        return { items: [ITEM], cursor: "8" };
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
    inbox: (taskId, after) =>
      Effect.sync(() => {
        asked.push(`inbox:${taskId}:${after}`);
        return { items: [ITEM], cursor: "7" };
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
  };
  return {
    client,
    asked,
    /** What the service seals for following the account's inbox; none answers unanswered. */
    seal: (next: AccountInboxLiveAnswer | undefined) => {
      live = next;
    },
  };
}

function subject(
  options: {
    signedIn?: boolean;
    sendsNetwork?: boolean;
    /** Whether the account inbox is followed over Realtime's own client, through the socket the test stubs, in place of the scripted one. */
    ownRealtime?: boolean;
  } = {},
) {
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
      openLive: options.ownRealtime === true ? openRealtimeClient : realtime.open,
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
 * A sealed statement as Realtime's own client admits one before sending it:
 * a compact JWE under the header Realtime seals with, opaque past it, and a
 * fingerprint of 64 hex digits. The scripted statements above are refused by
 * that client as it is handed them.
 */
function realtimeSealed(part: string) {
  const segment = (text: string) => Buffer.from(text).toString("base64url");
  return {
    capability: [
      segment(JSON.stringify({ alg: "dir", enc: "A256GCM", v: 1 })),
      "",
      segment(`iv-${part}`),
      segment(`sealed-${part}`),
      segment(`tag-${part}`),
    ].join("."),
    queryFingerprint: createHash("sha256").update(part).digest("hex"),
    expiresAt: NOW + 60_000,
  };
}

const REALTIME_SEALED: AccountInboxLiveAnswer = {
  url: SEALED.url,
  queries: {
    items: realtimeSealed("items"),
    planless: realtimeSealed("planless"),
    plans: realtimeSealed("plans"),
    automations: realtimeSealed("automations"),
    failedRuns: realtimeSealed("failedRuns"),
    chatAsks: realtimeSealed("chatAsks"),
    chatNotices: realtimeSealed("chatNotices"),
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

/** A frame the stubbed socket sends, as Realtime's protocol spells the two it needs. */
type RealtimeServerFrame =
  | { readonly type: "ready" }
  | {
      readonly type: "subscribe_rejected";
      readonly request_id: string;
      readonly code: string;
      readonly message: string;
      readonly retry_after_ms: number;
    };

/** A subscription Realtime's client sent, read off its frame; none for any other frame. */
const readSubscribe = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({ type: Schema.Literal("subscribe"), request_id: Schema.String }),
  ),
);

/**
 * Realtime's socket as a Realtime whose backend cannot start answers it,
 * stubbed where Realtime's own client opens one, the client's one process
 * boundary: ready at once, and every subscription refused with `code`, to be
 * asked for again after a hint, as production's proxy refused each one while
 * its backend's logical slot would not start.
 */
function refusingRealtimeSocket(code: string) {
  return class RefusingRealtimeSocket {
    readyState = 0;
    readonly #listeners: ((event: { readonly data: string }) => void)[] = [];

    constructor() {
      queueMicrotask(() => {
        this.readyState = 1;
        this.#receive({ type: "ready" });
      });
    }

    addEventListener(type: string, listener: (event: { readonly data: string }) => void) {
      if (type === "message") this.#listeners.push(listener);
    }

    send(frame: string) {
      const subscribe = readSubscribe(frame);
      if (Option.isNone(subscribe)) return;
      queueMicrotask(() =>
        this.#receive({
          type: "subscribe_rejected",
          request_id: subscribe.value.request_id,
          code,
          message: "Realtime is unavailable",
          retry_after_ms: 30_000,
        }),
      );
    }

    close() {
      this.readyState = 3;
    }

    #receive(frame: RealtimeServerFrame) {
      for (const listener of this.#listeners) listener({ data: JSON.stringify(frame) });
    }
  };
}

it.effect("each method asks the service once and answers what it said, whole", () =>
  Effect.gen(function* () {
    const { call, asked } = yield* subject();

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
    assert.deepEqual(yield* call(GATEWAY_METHOD.CODING_AGENTS_PAGE, { agentId: AGENT_ID }), {
      agent: PAGE,
    });
    assert.deepEqual(
      yield* call(GATEWAY_METHOD.CODING_AGENTS_AGENT_INBOX, {
        agentId: AGENT_ID,
        after: INBOX_CURSOR_START,
      }),
      { items: [ITEM], cursor: "8" },
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
      { items: [ITEM], cursor: "7" },
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
    yield* call(GATEWAY_METHOD.CODING_AGENTS_INBOX_MESSAGE, {
      itemId: ITEM.id,
      text: "Ship it.",
      clientKey: "message-2",
      answers: { ask: MESSAGE_ID, reply: INBOX_REPLY.CHOSE, choices: ["Ship it"] },
    });
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
      `messages:${AGENT_ID}:${CODING_AGENT_CURSOR_START}`,
      `worker:${AGENT_ID}:call-7:${CODING_AGENT_CURSOR_START}`,
      `message:${AGENT_ID}:send-1:Also expire them after a week.`,
      `choose:${AGENT_ID}:openai/gpt-6.1-sol:low`,
      `rename:${AGENT_ID}:Sign-out button`,
      `servers:${AGENT_ID}:linear`,
      `stop:${AGENT_ID}`,
      `archive:${AGENT_ID}:true`,
      `pin:${AGENT_ID}:true`,
      `page:${AGENT_ID}`,
      `agent-inbox:${AGENT_ID}:${INBOX_CURSOR_START}`,
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
      `inbox:${TASK_ID}:${INBOX_CURSOR_START}`,
      `attachment:${ITEM.id}:${ATTACHMENT_ID}`,
      `picture:${AGENT_ID}:${PICTURE_ID}:call-worker`,
      `answer:${ITEM.id}:2:${INBOX_REPLY.DECLINED}:Not before the freeze lifts.:answer-1`,
      `close:${ITEM.id}:2:close-1`,
      `inbox-message:${ITEM.id}:Also page on-call.:pager.txt:message-1`,
      `inbox-message:${ITEM.id}:Ship it.::message-2:answers ${MESSAGE_ID} chose Ship it`,
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
const settled = Effect.repeat(Effect.yieldNow, { times: 20 });

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
      yield* settled;
      assert.deepEqual(realtime.closed, [SEALED.url]);
      yield* TestClock.adjust("5 seconds");
      yield* settled;
      assert.deepEqual(realtime.opened, [SEALED.url, SEALED.url]);
    }),
);

/**
 * The host's line and the runtime's error reporters, as a follow started
 * under them hears them: every line said, and every error reported.
 */
function heard() {
  const lines: string[] = [];
  const reported: Error[] = [];
  const layer = Layer.merge(
    reporterLayer((line) => void lines.push(line)),
    ErrorReporter.layer([ErrorReporter.make(({ error }) => void reported.push(error))]),
  );
  return { lines, reported, layer };
}

it.effect(
  "a follow whose socket never delivers is reported once, as a warning naming no address or seal, after thirty seconds, and goes on asking",
  () =>
    Effect.gen(function* () {
      const { call, seal, realtime } = yield* subject();
      const { lines, reported, layer } = heard();
      seal(SEALED);
      yield* Effect.provide(call(GATEWAY_METHOD.CODING_AGENTS_ACCOUNT_INBOX_FOLLOW), layer);
      yield* settled;
      assert.deepEqual(realtime.opened, [SEALED.url]);

      yield* TestClock.adjust("29 seconds");
      yield* settled;
      assert.deepEqual(reported, []);
      yield* TestClock.adjust("1 second");
      yield* settled;
      const [warning, ...more] = reported;
      assert.ok(warning !== undefined && more.length === 0);
      assert.equal(ErrorReporter.getSeverity(warning), "Warn");
      const said = lines.filter((line) => line.includes("account inbox"));
      assert.deepEqual(said, [
        "the account inbox's live read has not answered in 30 seconds: Realtime has not delivered every part",
      ]);
      assert.ok(!said[0]?.includes(SEALED.url) && !said[0]?.includes("capability"));

      // It keeps following, and says so no more however long it waits.
      yield* TestClock.adjust("5 minutes");
      yield* settled;
      assert.equal(reported.length, 1);
      assert.ok(realtime.subscribed().length > 0);
    }),
);

it.effect(
  "a follow Realtime will not admit is reported with what Realtime's own client last reported, its code among it, and no address or seal",
  () =>
    Effect.gen(function* () {
      vi.stubGlobal("WebSocket", refusingRealtimeSocket("backend_unavailable"));
      // Realtime's client loaded already, as a host that has followed before holds it.
      yield* Effect.promise(() => import("@neon/realtime/client"));
      const { call, seal } = yield* subject({ ownRealtime: true });
      const { lines, reported, layer } = heard();
      seal(REALTIME_SEALED);
      yield* Effect.provide(call(GATEWAY_METHOD.CODING_AGENTS_ACCOUNT_INBOX_FOLLOW), layer);
      yield* settled;

      yield* TestClock.adjust("30 seconds");
      yield* settled;
      assert.equal(reported.length, 1);
      const said = lines.filter((line) => line.includes("account inbox"));
      assert.deepEqual(said, [
        "the account inbox's live read has not answered in 30 seconds: Realtime has not delivered every part; Realtime's client last reported subscription_retry_scheduled (backend_unavailable)",
      ]);
      for (const sealedPart of Object.values(REALTIME_SEALED.queries)) {
        assert.ok(!said[0]?.includes(sealedPart.capability));
      }
      assert.ok(!said[0]?.includes(REALTIME_SEALED.url));
    }),
);

it.effect(
  "a seal Realtime's own client refuses is let go and asked for again after a pause, rather than ending the follow",
  () =>
    Effect.gen(function* () {
      vi.stubGlobal("WebSocket", refusingRealtimeSocket("backend_unavailable"));
      yield* Effect.promise(() => import("@neon/realtime/client"));
      const { call, seal, asked } = yield* subject({ ownRealtime: true });
      // The scripted statements are no compact JWE, which Realtime's client throws on as it is handed one.
      seal(SEALED);
      yield* call(GATEWAY_METHOD.CODING_AGENTS_ACCOUNT_INBOX_FOLLOW);
      yield* settled;
      assert.deepEqual(asked, ["account-inbox-live"]);

      yield* TestClock.adjust("5 seconds");
      yield* settled;
      assert.deepEqual(asked, ["account-inbox-live", "account-inbox-live"]);
    }),
);

it.effect("a follow that answers within thirty seconds reports nothing", () =>
  Effect.gen(function* () {
    const { call, seal, realtime, inboxes } = yield* subject();
    const { lines, reported, layer } = heard();
    seal(SEALED);
    yield* Effect.provide(call(GATEWAY_METHOD.CODING_AGENTS_ACCOUNT_INBOX_FOLLOW), layer);
    yield* settled;
    for (const part of [
      "items",
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
    assert.equal(inboxes().length, 1);
    yield* TestClock.adjust("1 minute");
    yield* settled;
    assert.deepEqual(reported, []);
    assert.deepEqual(
      lines.filter((line) => line.includes("account inbox")),
      [],
    );
  }),
);

it.effect(
  "a follow that answered and later stops for good is watched again from its restart: one that never answers again is reported thirty seconds after it, once",
  () =>
    Effect.gen(function* () {
      const { call, seal, realtime, inboxes } = yield* subject();
      const { reported, layer } = heard();
      seal(SEALED);
      yield* Effect.provide(call(GATEWAY_METHOD.CODING_AGENTS_ACCOUNT_INBOX_FOLLOW), layer);
      yield* settled;
      for (const part of [
        "items",
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
      assert.equal(inboxes().length, 1);

      // A minute on, past the first bound, the subscription stops for good and is started again,
      // and the new one never delivers.
      yield* TestClock.adjust("1 minute");
      realtime.fail("items");
      yield* settled;
      yield* TestClock.adjust("5 seconds");
      yield* settled;
      assert.deepEqual(realtime.opened, [SEALED.url, SEALED.url]);

      yield* TestClock.adjust("29 seconds");
      yield* settled;
      assert.deepEqual(reported, []);
      yield* TestClock.adjust("1 second");
      yield* settled;
      assert.equal(reported.length, 1);
      yield* TestClock.adjust("5 minutes");
      yield* settled;
      assert.equal(reported.length, 1);
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
