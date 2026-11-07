/**
 * agents-subject.ts -- the agents and the account's asks composed over a fake service, as the host composes them, for the tests of each.
 */
import assert from "node:assert/strict";
import { CALL_FAULT } from "@repo/features";
import type { AccountInboxEntry } from "@repo/features/account-inbox-wire";
import { ACCOUNT_PREFERENCES_READ } from "@repo/features/account-preferences-live";
import { AGENT_ORIGIN_READ } from "@repo/features/agent-origin-live";
import { AGENT_TRANSCRIPT_READ } from "@repo/features/agent-transcript-live";
import {
  AGENT_CALL_FAILURE,
  type AgentAgentAnswer,
  type AgentQueueAnswerView,
  type DevicePresenceAnswerView,
  type HostDoneAnswerView,
  type MemoriesAnswerView,
  TRANSCRIPT_KIND,
} from "@repo/features/agent-view";
import {
  AGENT_CURSOR_START,
  AGENT_STATUS,
  type AgentNewestAnswer,
  type AgentPage,
  type AgentSummary,
  CHANGED_FILE_STATUS,
  CHECK_SUMMARY,
  MERGE_STATE,
  PULL_REQUEST_STATE,
} from "@repo/features/agent-wire";
import { FAILURE_FACT, GATE_CLOSED_BY } from "@repo/features/failure-facts";
import { GITHUB_IMAGE_TYPE } from "@repo/features/github-image";
import { GITHUB_TOKEN_STATUS, type GitHubTokenSummary } from "@repo/features/github-token-wire";
import { HOSTS_READ } from "@repo/features/host-live";
import {
  ACCOUNT_INBOX_READ,
  AGENT_INBOX_READ,
  INBOX_ITEMS_READ,
  TASK_INBOX_READ,
} from "@repo/features/inbox-live";
import {
  INBOX_IMAGE_TYPE,
  INBOX_MESSAGE_AUTHOR,
  INBOX_STATUS,
  INBOX_WIRE_VERSION,
  type InboxItem,
} from "@repo/features/inbox-wire";
import {
  LIVE_READ,
  type LIVE_SIGNED_OUT,
  type LiveRead,
  type SealedLiveQueryWire,
  type TranscriptNowAnswer,
} from "@repo/features/live-wire";
import { WORKSPACE_MEMORIES_READ } from "@repo/features/memory-live";
import type { MemorySummary } from "@repo/features/memory-wire";
import { type CatalogModel, MODEL_PROVIDER } from "@repo/features/models-wire";
import {
  PROVIDER_KEY_PROVIDER,
  PROVIDER_KEY_STATUS,
  type ProviderKeySummary,
} from "@repo/features/provider-key-wire";
import { PULL_REQUEST_CHAPTERS_READ } from "@repo/features/pull-request-chapters-live";
import { PULL_REQUEST_CHAPTERS_STATE } from "@repo/features/pull-request-chapters-wire";
import { PULL_REQUEST_WRITE_OUTCOME } from "@repo/features/pull-request-write-wire";
import {
  GATEWAY_CLIENT_ROLE,
  GATEWAY_EVENT,
  type GatewayEventKind,
  type GatewayMethod,
} from "@repo/gateway";
import { type EntityPool, entityPool } from "@repo/sync";
import { isRecord, type WireRecord, type WireValue } from "@repo/wire";
import { noNetwork } from "@repo/wire/testing";
import { Duration, Effect, Exit, Scope } from "effect";
import { TestClock } from "effect/testing";
import { type AppTranscript, type AppTranscripts, OWN_TRANSCRIPT } from "../app-state.js";
import { type AccountAsksClient, composeAccountAsks } from "../compose-account-asks.js";
import { type AgentClient, composeAgents } from "../compose-agents.js";
import { KEPT_CONTENT_CHARACTERS, keptContent } from "../kept-content.js";
import { windowFocus } from "../window-focus.js";
import { type PolledLive, polledLive } from "./polled-live.js";
import { tellingsOf } from "./told-live.js";

export const TASK_ID = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
export const AGENT_ID = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";
export const WORKSPACE_ID = "2a9c4e6f-1b3d-4f5a-8c7e-9d0b1a2c3e4f";

export const AGENT: AgentSummary = {
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
export const PAGE: AgentPage = {
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
  branch: "agent/teammate-invitations",
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
export const CHAPTERS = {
  pullRequest: {
    number: 11,
    generatable: true,
    chapters: { status: PULL_REQUEST_CHAPTERS_STATE.NONE },
  },
} as const;

export const CHANGES = {
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
      head: "agent/invite-once",
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
export const PROVIDER_KEY = "sk-ant-api03-synthetic-0000000000000000wxyz";
export const GITHUB_TOKEN = "synthetic-classic-token-0000000000wxyz";

/** What the service answers of a saved token: never the token, and a made-up hint. */
export const SAVED_TOKEN: GitHubTokenSummary = {
  login: "octo-dev",
  hint: "fake…hint",
  status: GITHUB_TOKEN_STATUS.VERIFIED,
  statusAt: 1_000,
  addedAt: 1_000,
  expiresAt: null,
};

/** What the service answers of a kept key: never the key. */
export const MEMORY: MemorySummary = {
  id: "8a1f2c3d-4e5f-4a6b-9c7d-8e9f0a1b2c3d",
  text: "Deployments go out from the release branch.",
  keptBy: { userId: "user-1", name: "Dean" },
  forgettable: true,
  createdAt: 1,
  updatedAt: 2,
};

export const KEPT: ProviderKeySummary = {
  provider: PROVIDER_KEY_PROVIDER.ANTHROPIC,
  hint: "sk-ant-…wxyz",
  addedAt: 1,
  status: PROVIDER_KEY_STATUS.VERIFIED,
  statusAt: 1,
};

export const ATTACHMENT_ID = "9b8a7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
export const PICTURE_ID = "4fb17055-c16e-4293-bea5-7a8b9cadbec5";
export const MESSAGE_ID = "5ac28166-d27f-4304-8cb6-8b9cadbecdf6";

export const ITEM: InboxItem = {
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
export const WAITING: AccountInboxEntry = {
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
  let transcript:
    | typeof LIVE_ANSWERED
    | { readonly failure: "not-found" }
    | typeof OFFLINE
    | undefined;
  let accountLive: typeof LIVE_ANSWERED | typeof LIVE_SIGNED_OUT | undefined;
  let itemsLive: typeof LIVE_ANSWERED | undefined;
  /** What the account's items' read keeps to answer by sync id, so a read past one is answered what moved since. */
  const itemsBySync: ItemsBySync = { rows: new Map(), at: new Map() };
  /** The sync id the account's items stand still at, as behind a long transaction; none while it moves. */
  let itemsStalledAt: string | undefined;
  /** Each key a read mark was sent under, in order, and whether the service answers marks at all. */
  const markKeys: (string | undefined)[] = [];
  let marksAnswered = true;
  // Each live read's rows, polled; every followed scope's inbox reads the one script.
  const live = {
    transcript: polledLive(TRANSCRIPT_PARTS),
    scope: polledLive(SCOPE_PARTS),
    account: polledLive(ACCOUNT_PARTS),
    items: polledLive(ITEMS_PARTS),
    memories: polledLive(MEMORIES_PARTS),
    origin: polledLive(["origin"]),
    hosts: polledLive(["hosts"]),
    // Note that the account stored no preferences until a test sets a row, as a new account has none.
    preferences: polledLive(["preferences"], () => ({ preferences: [] })),
  };
  /** The models the account is offered, as the service answers them; the one Claude model from the start. */
  let offeredModels: readonly CatalogModel[] = MODELS;
  /** The account's provider keys, as the service answers them; the one Claude key from the start. */
  let keptKeys: readonly ProviderKeySummary[] = [KEPT];
  // Each page read at once, in turn; the last stands once the others are read.
  let pagesNow: readonly (TranscriptNowAnswer | { readonly failure: "unanswered" })[] = [];
  let pageGate: Effect.Effect<void> = Effect.void;
  // The newest page, as the follow opens with it; none answers one with something on it.
  let newestPage: AgentNewestAnswer | { readonly failure: "unanswered" } | undefined;
  // The transaction a pin answers it committed in, where it answers one.
  let startTxid: string | undefined;
  // Whether a Start goes unanswered, as one sent offline does.
  let startsUnanswered = false;
  // The transaction the service says each inbox write committed in; none says it changed nothing.
  let committedIn: { readonly txid?: string } = {};
  /** The item as the agent changed it first, which a close is answered not taken with; none takes every close. */
  let changedFirst: InboxItem | undefined;
  /** What each close waits on once asked, before it is answered. */
  let closesWait: Effect.Effect<void> = Effect.void;
  /** The transaction the service says wrote a sent message's row; none says none was written. */
  let sentTxid: string | undefined;
  /** What a rename, an archive, a change of model, or a switch of servers waits on before the service answers it; nothing from the start. */
  let changeGate: Effect.Effect<void> = Effect.void;
  /** What a change of an agent's queue answers, once its gate lets it; the queue empty at its first revision from the start. */
  let queueAnswer: AgentQueueAnswerView = { queue: { messages: [], revision: 1 } };
  /** What a change of an agent's queue waits on before the service answers it; nothing from the start. */
  let queueGate: Effect.Effect<void> = Effect.void;
  /** What a forget answers, once its gate lets it; the memories left, with no transaction, from the start. */
  let forgetAnswer: MemoriesAnswerView = { memories: [] };
  /** What a forget waits on before the service answers it; nothing from the start. */
  let forgetGate: Effect.Effect<void> = Effect.void;
  /** What a message on an inbox thread waits on before the service answers it; nothing from the start. */
  let messageGate: Effect.Effect<void> = Effect.void;
  /** What a host's removal answers, once its gate lets it; unanswered from the start. */
  let removeAnswer: HostDoneAnswerView = { failure: AGENT_CALL_FAILURE.UNANSWERED };
  /** What a host's removal waits on before the service answers it; nothing from the start. */
  let removeGate: Effect.Effect<void> = Effect.void;
  /** How long ago the account's devices beat, as the service answers it; unanswered until a test says, and never where it hangs. */
  let presence: Effect.Effect<DevicePresenceAnswerView> = Effect.succeed({
    failure: AGENT_CALL_FAILURE.UNANSWERED,
  });
  /** A plan's or an agent's inbox as its live read answers it: polled from the one script, or the refusal standing. */
  const scopeLive = (poll: boolean | undefined, after: string | undefined) =>
    Effect.suspend((): Effect.Effect<unknown> => {
      if (scope === undefined) return Effect.succeed({ failure: AGENT_CALL_FAILURE.UNANSWERED });
      if (typeof scope === "object") return Effect.succeed(scope);
      return poll === true ? live.scope.poll(after) : Effect.succeed(live.scope.first());
    });
  // Note that a poll is counted apart from the first ask (`live.transcript.polls`), as each is held until the rows move.
  const transcriptLive = (
    agentId: string | undefined,
    callId: string | undefined,
    poll: boolean,
    after: string | undefined,
  ) =>
    Effect.suspend((): Effect.Effect<unknown> => {
      if (poll !== true) {
        asked.push(`transcript-live:${agentId}${callId === undefined ? "" : `:${callId}`}`);
      }
      if (transcript === undefined) {
        return Effect.succeed({ failure: AGENT_CALL_FAILURE.UNANSWERED });
      }
      if (typeof transcript === "object") return Effect.succeed(transcript);
      return poll === true ? live.transcript.poll(after) : Effect.succeed(live.transcript.first());
    });
  /** The account's inbox as its live read answers it: polled from the one script, or the refusal standing. */
  const accountInboxLive = (userId: string | undefined, poll: boolean, after: string | undefined) =>
    Effect.suspend((): Effect.Effect<unknown> => {
      if (poll !== true) asked.push(`account-inbox-live:${userId}`);
      if (accountLive === undefined) {
        return Effect.succeed({ failure: AGENT_CALL_FAILURE.UNANSWERED });
      }
      if (typeof accountLive === "object") return Effect.succeed(accountLive);
      return poll === true ? live.account.poll(after) : Effect.succeed(live.account.first());
    });
  /** The account's items as their live read answers them, by the sync id the follow asks past. */
  const accountItemsLive = (userId: string | undefined, sync: string | undefined) =>
    Effect.suspend((): Effect.Effect<unknown> => {
      if (sync === "") asked.push(`account-items-live:${userId}`);
      if (sync === undefined) asked.push(`account-items-whole:${userId}`);
      if (itemsLive === undefined) {
        return Effect.succeed({ failure: AGENT_CALL_FAILURE.UNANSWERED });
      }
      if (sync === undefined) return Effect.succeed(live.items.first());
      const settled = (answer: ItemsAnswer) =>
        itemsStalledAt ?? answer.queries.stamps.digest ?? "0";
      if (sync === "") {
        const whole = live.items.first();
        return Effect.succeed(
          "failure" in whole ? whole : bySyncId(whole, undefined, settled(whole), itemsBySync),
        );
      }
      return Effect.map(live.items.poll(sync), (answer) =>
        "failure" in answer ? answer : bySyncId(answer, sync, settled(answer), itemsBySync),
      );
    });
  const client: AgentClient & AccountAsksClient = {
    models: () =>
      Effect.sync(() => {
        asked.push("models");
        return { models: offeredModels };
      }),
    writeDefault: (choice) =>
      Effect.sync(() => {
        asked.push(`default:${choice.model}:${choice.effort}`);
        return { choice };
      }),
    writeChaptersProvider: (provider) =>
      Effect.sync(() => {
        asked.push(`chapters-provider:${provider}`);
        return { provider };
      }),
    // SAFETY: each declared read the client is asked for answers its own script's rows, as its declaration's answer.
    liveRead: ((
      read: { readonly name: string },
      params: {
        readonly workspaceId?: string;
        readonly id?: string;
        readonly call?: string;
        readonly userId?: string;
        readonly sync?: string;
      },
      poll?: { readonly after?: string | undefined },
    ) =>
      Effect.suspend((): Effect.Effect<unknown> => {
        const answered = <Part extends string>(script: PolledLive<Part>) =>
          poll === undefined ? Effect.succeed(script.first()) : script.poll(poll.after);
        switch (read.name) {
          case HOSTS_READ.name:
            return Effect.map(answered(live.hosts), (answer) => ({
              ...answer,
              installScriptUrl: INSTALL_SCRIPT,
            }));
          case ACCOUNT_PREFERENCES_READ.name:
            if (poll === undefined) asked.push("preferences-live");
            return answered(live.preferences);
          case AGENT_ORIGIN_READ.name:
            if (poll === undefined) asked.push(`agent-origin-live:${params.id}`);
            return answered(live.origin);
          case WORKSPACE_MEMORIES_READ.name:
            if (poll === undefined) asked.push(`memories-live:${params.workspaceId}`);
            return answered(live.memories);
          case PULL_REQUEST_CHAPTERS_READ.name:
            return Effect.succeed({ failure: AGENT_CALL_FAILURE.UNANSWERED });
          case AGENT_TRANSCRIPT_READ.name:
            return transcriptLive(params.id, params.call, poll !== undefined, poll?.after);
          case TASK_INBOX_READ.name:
            if (poll === undefined) asked.push(`description-inbox-live:${params.id}`);
            return scopeLive(poll !== undefined, poll?.after);
          case AGENT_INBOX_READ.name:
            if (poll === undefined) asked.push(`agent-inbox-live:${params.id}`);
            return scopeLive(poll !== undefined, poll?.after);
          case ACCOUNT_INBOX_READ.name:
            return accountInboxLive(params.userId, poll !== undefined, poll?.after);
          case INBOX_ITEMS_READ.name:
            return accountItemsLive(params.userId, params.sync);
          default:
            return assert.fail(`no script answers the live read ${read.name}`);
        }
      })) as AgentClient["liveRead"],
    devicePresence: () =>
      Effect.suspend(() => {
        asked.push("presence");
        return presence;
      }),
    removeHost: (id) =>
      Effect.andThen(
        Effect.sync(() => {
          asked.push(`remove-host:${id}`);
        }),
        Effect.andThen(
          Effect.suspend(() => removeGate),
          Effect.sync(() => removeAnswer),
        ),
      ),
    readHostPairing: () => Effect.succeed({ failure: "unanswered" }),
    approveHostPairing: () => Effect.succeed({ failure: "unanswered" }),
    denyHostPairing: () => Effect.succeed({ failure: "unanswered" }),
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
      Effect.sync((): AgentAgentAnswer => {
        asked.push(`start:${taskId}:${request.idempotencyKey}:${request.model ?? "default"}`);
        if (startsUnanswered) {
          return {
            failure: AGENT_CALL_FAILURE.UNANSWERED,
            cause: { _tag: FAILURE_FACT.HOSTED_UNANSWERED, fault: CALL_FAULT.NETWORK },
          };
        }
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
    addRepository: (agentId, request) =>
      Effect.map(changeGate, () => {
        asked.push(`addRepository:${agentId}:${request.addRepository.repository}`);
        return { agent: AGENT };
      }),
    changeQueue: (agentId, change) =>
      Effect.andThen(
        Effect.suspend(() => queueGate),
        Effect.sync(() => {
          asked.push(`queue:${agentId}:${change.change}`);
          return queueAnswer;
        }),
      ),
    stop: (agentId) =>
      Effect.sync(() => {
        asked.push(`stop:${agentId}`);
        return { agent: { ...AGENT, status: AGENT_STATUS.CANCELED } };
      }),
    rewind: (agentId, messageId) =>
      Effect.sync(() => {
        asked.push(`rewind:${agentId}:${messageId}`);
        return { agent: AGENT };
      }),
    delete: (agentId) =>
      Effect.map(changeGate, () => {
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
    markRead: (agentId, request) =>
      Effect.sync(() => {
        asked.push(`mark-read:${agentId}:${request.readMark}`);
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
    generateChapters: (agentId, number) =>
      Effect.sync(() => {
        asked.push(`chapters-generate:${agentId}${number === undefined ? "" : `#${number}`}`);
        return CHAPTERS;
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
    workspaceTools: () => Effect.die("no Vespin tools read in this suite"),
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
        return { keys: keptKeys };
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
    startChatGptDeviceLogin: () => Effect.succeed({ failure: AGENT_CALL_FAILURE.UNANSWERED }),
    pollChatGptDeviceLogin: () => Effect.succeed({ failure: AGENT_CALL_FAILURE.UNANSWERED }),
    cancelChatGptDeviceLogin: () => Effect.succeed({ failure: AGENT_CALL_FAILURE.UNANSWERED }),
    readGitHubToken: () =>
      Effect.sync(() => {
        asked.push("token");
        return { token: null };
      }),
    saveGitHubToken: (save) =>
      Effect.sync(() => {
        asked.push(`save-token:${save.token === GITHUB_TOKEN ? "the token" : "another"}`);
        return { token: SAVED_TOKEN };
      }),
    removeGitHubToken: () =>
      Effect.sync(() => {
        asked.push("remove-token");
        return { token: null };
      }),

    forgetMemory: (forget) =>
      Effect.andThen(
        Effect.sync(() => {
          asked.push(`forget:${forget.workspaceId}:${forget.id}`);
        }),
        Effect.andThen(
          Effect.suspend(() => forgetGate),
          Effect.sync(() => forgetAnswer),
        ),
      ),
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
    agentPart: (agentId, messageId, index, callId) =>
      Effect.sync(() => {
        asked.push(`part:${agentId}:${messageId}:${index}:${callId ?? ""}`);
        return { part: { type: "reasoning", text: "Whole." } };
      }),
    markInboxItemRead: (itemId, key) =>
      Effect.sync(() => {
        asked.push(`inbox-read:${itemId}`);
        markKeys.push(key);
        if (!marksAnswered) {
          return {
            failure: AGENT_CALL_FAILURE.UNANSWERED,
            cause: { _tag: FAILURE_FACT.HOSTED_UNANSWERED, fault: CALL_FAULT.NETWORK },
          };
        }
        return { id: itemId, unread: false, ...committedIn };
      }),
    inboxItemHome: (itemId) =>
      Effect.sync(() => {
        asked.push(`inbox-home:${itemId}`);
        return { agentId: ITEM.agentId, planId: null, workspaceId: "workspace-1" };
      }),
    markInboxItemUnread: (itemId) =>
      Effect.sync(() => {
        asked.push(`inbox-unread:${itemId}`);
        return { id: itemId, unread: true, ...committedIn };
      }),
    remindInboxItem: (itemId, until) =>
      Effect.sync(() => {
        asked.push(`inbox-remind:${itemId}:${until ?? "none"}`);
        return { id: itemId, unread: false, ...committedIn };
      }),
    markInboxRead: (request) =>
      Effect.sync(() => {
        asked.push(`inbox-read-all:${request?.workspaceId ?? ""}`);
        return { marked: 2, ...committedIn };
      }),
    messageInbox: (itemId, request) =>
      Effect.map(
        Effect.suspend(() => messageGate),
        () => {
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
            ...committedIn,
          };
        },
      ),
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
      }).pipe(
        Effect.andThen(Effect.suspend(() => closesWait)),
        Effect.map(() => {
          if (changedFirst !== undefined) return { item: changedFirst, taken: false };
          return {
            item: {
              ...ITEM,
              status: INBOX_STATUS.CLOSED,
              closedBy: { userId: "u1", name: "Dana" },
            },
            taken: true,
            ...committedIn,
          };
        }),
      ),
    answerInbox: (itemId, request) =>
      Effect.sync(() => {
        asked.push(`answer:${itemId}:${request.revision}:${request.reply}:${request.clientKey}`);
        return { item: { ...ITEM, revision: 3, status: INBOX_STATUS.ANSWERED }, taken: true };
      }),
  };
  return {
    client,
    asked,
    live,
    /** Whether the service answers a transcript's live read, or that the account reaches no such agent; none answers unanswered. */
    sealTranscript: (
      next: typeof LIVE_ANSWERED | { readonly failure: "not-found" } | typeof OFFLINE | undefined,
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
    markKeys,
    /** Whether the service answers a read mark, or no answer comes back, as offline. */
    answerMarks: (answers: boolean) => {
      marksAnswered = answers;
    },
    /** What a change to an agent waits on before the service answers it. */
    holdChanges: (gate: Effect.Effect<void>) => {
      changeGate = gate;
    },
    /** What a message on an inbox thread waits on before the service answers it. */
    holdMessages: (gate: Effect.Effect<void>) => {
      messageGate = gate;
    },
    /** What a change of an agent's queue answers from now on, once `gate` lets it. */
    answerQueue: (answer: AgentQueueAnswerView, gate: Effect.Effect<void> = Effect.void) => {
      queueAnswer = answer;
      queueGate = gate;
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
    /** Holds the account items' sync id where it stands, as a long transaction does, so each read past it is answered nothing moved. */
    stallItems: () => {
      itemsStalledAt = live.items.first().queries.stamps.digest;
    },
    /** The transaction a Start answers it committed in; none answers none. */
    startCommits: (txid: string | undefined) => {
      startTxid = txid;
    },
    /** What each close from now on waits on once asked, before it is answered. */
    answerClosesAfter: (wait: Effect.Effect<void>) => {
      closesWait = wait;
    },
    /** Whether each Start from now on goes unanswered, as one sent offline does. */
    leaveStartsUnanswered: (unanswered: boolean) => {
      startsUnanswered = unanswered;
    },
    /** What each host's removal answers from now on, and what it waits on before it does. */
    answerRemoves: (answer: HostDoneAnswerView, gate: Effect.Effect<void> = Effect.void) => {
      removeAnswer = answer;
      removeGate = gate;
    },
    /** What each forget answers from now on, and what it waits on before it does. */
    answerForgets: (answer: MemoriesAnswerView, gate: Effect.Effect<void> = Effect.void) => {
      forgetAnswer = answer;
      forgetGate = gate;
    },
    /** How long ago the account's devices beat, as the service answers from now on. */
    answerPresence: (next: DevicePresenceAnswerView) => {
      presence = Effect.succeed(next);
    },
    /** The account's provider keys and the models it is offered as the service answers them from now on. */
    answerKeys: (keys: readonly ProviderKeySummary[], models: readonly CatalogModel[]) => {
      keptKeys = keys;
      offeredModels = models;
    },
    /** Every read of how long ago the devices beat failing from now on, as one past its deadline does. */
    failPresence: () => {
      presence = Effect.succeed({ failure: AGENT_CALL_FAILURE.UNANSWERED });
    },
  };
}

/** Now, as the host reads it in these tests. */
export const NOW = 1_800_000_100_000;

/** A transcript's live read as the test scripts it. */
export type TranscriptLive = PolledLive<(typeof TRANSCRIPT_PARTS)[number]>;

/** That the service answers a live read, its rows polled from the test's script (`polledLive`). */
export const LIVE_ANSWERED = "answered";
/** A live read whose call got no answer at all, as one sent offline ends. */
export const OFFLINE = {
  failure: AGENT_CALL_FAILURE.UNANSWERED,
  cause: { _tag: FAILURE_FACT.HOSTED_UNANSWERED, fault: CALL_FAULT.NETWORK },
} as const;

/** What a call the closed account gate kept from the service answers: unanswered, saying the gate stood closed for want of an account. */
export const GATE_CLOSED_SIGNED_OUT = {
  failure: AGENT_CALL_FAILURE.UNANSWERED,
  cause: { _tag: FAILURE_FACT.GATE_CLOSED, code: GATE_CLOSED_BY.NO_ACCOUNT },
};

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
  "launch",
] as const;
const SCOPE_PARTS = ["items", "messages", "files"] as const;
export const ACCOUNT_PARTS = ["items", "planless", "plans", "automations", "failedRuns"] as const;
export const ITEMS_PARTS = ["stamps", "items", "messages", "files"] as const;
const MEMORIES_PARTS = ["memories"] as const;

/** The install script's address the hosts' read answers beside them. */
const INSTALL_SCRIPT = "https://app.test/install.sh";

/** The account's items' read as the service answers it, before it is read by sync id. */
type ItemsAnswer = Exclude<
  ReturnType<PolledLive<(typeof ITEMS_PARTS)[number]>["first"]>,
  { failure: string }
>;

/** A row's text field `name`; none where it carries none. */
function textOf(row: unknown, name: string): string | undefined {
  const value = typeof row === "object" && row !== null ? Reflect.get(row, name) : undefined;
  return typeof value === "string" ? value : undefined;
}

/** The id a row of the account's items names its item by: its own, or the item its message is on. */
function itemIdOf(row: unknown): string | undefined {
  return textOf(row, "itemId") ?? textOf(row, "id");
}

/** What the fake keeps of the account's items to answer them by sync id: each item's last row set, and the items as they stood at each id answered. */
interface ItemsBySync {
  readonly rows: Map<string, unknown>;
  readonly at: Map<string, ReadonlyMap<string, string>>;
}

/**
 * The account's items' read as the service answers it by sync id. The
 * items there are are those the stamps a test set name, each its last row
 * set, its read mark the stamp's, as a service that resends an item whole
 * with its mark. Past no id it is every one, each part with the id to read
 * past next; past an id, only those that moved since, with the ids of
 * those that stand no longer, and nothing where the id stands still.
 */
function bySyncId(
  answer: ItemsAnswer,
  past: string | undefined,
  next: string,
  items: ItemsBySync,
): ItemsAnswer {
  for (const row of answer.queries.items.rows ?? []) {
    const id = itemIdOf(row);
    if (id !== undefined) items.rows.set(id, row);
  }
  const stamps = answer.queries.stamps.rows ?? [];
  const current = new Map(
    stamps.flatMap((stamp) => {
      const id = itemIdOf(stamp);
      const row = id === undefined ? undefined : items.rows.get(id);
      if (id === undefined || typeof row !== "object" || row === null) return [];
      const unread =
        typeof stamp === "object" && stamp !== null ? Reflect.get(stamp, "unread") : undefined;
      return [[id, { stamp, row: { ...row, unread } }] as const];
    }),
  );
  const now = new Map([...current].map(([id, each]) => [id, JSON.stringify(each)] as const));
  const before = past === undefined ? undefined : items.at.get(past);
  items.at.set(next, now);
  const stood = past !== undefined && past === next;
  const moved = [...current.keys()].filter((id) => !stood && before?.get(id) !== now.get(id));
  const gone = before === undefined || stood ? [] : [...before.keys()].filter((id) => !now.has(id));
  const movedMessages = (answer.queries.messages.rows ?? []).filter((row) =>
    moved.includes(itemIdOf(row) ?? ""),
  );
  const messageIds = new Set(movedMessages.flatMap((row) => textOf(row, "id") ?? []));
  // Note that a read answered before the test set any rows carries none, as one Realtime sealed does.
  const part = (query: SealedLiveQueryWire, rows: readonly unknown[]): SealedLiveQueryWire => ({
    ...query,
    ...(query.rows === undefined ? undefined : { rows }),
    sync: past === undefined ? { next } : { past, next },
    ...(past === undefined ? undefined : { gone }),
  });
  const { queries } = answer;
  return {
    ...answer,
    queries: {
      stamps: part(
        queries.stamps,
        moved.flatMap((id) => current.get(id)?.stamp ?? []),
      ),
      items: part(
        queries.items,
        moved.flatMap((id) => current.get(id)?.row ?? []),
      ),
      messages: part(queries.messages, movedMessages),
      files: part(
        queries.files,
        (queries.files.rows ?? []).filter((row) => messageIds.has(textOf(row, "messageId") ?? "")),
      ),
    },
  };
}

/** Every step a follow has to take, taken: it runs on a fiber of its own. */
export const settled = Effect.repeat(Effect.yieldNow, { times: 100 });

/** Every step taken, then the host's next poll asked, which waits half a second after the last answered (`live-follow.ts`). */
export const nextPoll = Effect.andThen(
  settled,
  Effect.andThen(TestClock.adjust(Duration.millis(500)), settled),
);

/**
 * A live follow's read held as one window's stream holds it, in a scope of
 * its own, answering the effect that lets it go, as the window's stream
 * closing does.
 */
export function holding(
  hold: Effect.Effect<void, never, Scope.Scope>,
): Effect.Effect<Effect.Effect<void>> {
  return Effect.gen(function* () {
    const scope = yield* Scope.make();
    yield* Scope.provide(hold, scope);
    return Scope.close(scope, Exit.void);
  });
}

/** The agent's own transcript, as a window follows it. */
export const FOLLOWED = { kind: TRANSCRIPT_KIND.AGENT, agentId: AGENT_ID } as const;

export function subject(
  options: {
    signedIn?: boolean;
    sendsNetwork?: boolean;
    accountId?: () => string | undefined;
    listed?: (txid: string | undefined) => Effect.Effect<void>;
    repositoriesMoved?: Effect.Effect<void>;
    pool?: EntityPool;
  } = {},
) {
  return Effect.gen(function* () {
    const service = fakeService();
    // Each event with how many reads the service had been asked as it was told.
    const events: { kind: GatewayEventKind; payload: WireValue; asked: number }[] = [];
    /** Every telling of a live follow's slice (`LIVE_READ_CHANGED`) named `read`, whole, in order. */
    const toldLive = (read: LiveRead) => tellingsOf(events, read);
    const kernel = {
      runMode: { sendsNetwork: options.sendsNetwork ?? true },
      emit: (kind: GatewayEventKind, payload: WireValue) =>
        void events.push({ kind, payload, asked: service.asked.length }),
      now: () => NOW,
    };
    const account = { capabilitiesActive: () => options.signedIn ?? true };
    const accountId = options.accountId ?? (() => "user-dana");
    const focus = yield* windowFocus;
    const pool = options.pool ?? (yield* entityPool());
    const composer = yield* composeAgents({
      kernel,
      account,
      accountId,
      kept: yield* keptContent(KEPT_CONTENT_CHARACTERS),
      focus,
      client: service.client,
      ...(options.listed === undefined ? undefined : { listed: options.listed }),
      pool,
    }).pipe(Effect.provide(noNetwork));
    // Note that the account's asks are composed beside the agents as the host composes them (`compose-host.ts`).
    const accountAsks = yield* composeAccountAsks({
      kernel,
      account,
      accountId,
      focus,
      client: service.client,
      pool,
      modelsMoved: composer.modelsMoved,
      ...(options.repositoriesMoved === undefined
        ? undefined
        : { repositoriesMoved: options.repositoriesMoved }),
    }).pipe(Effect.provide(noNetwork));
    /** A Gateway method either composer answers, called as a window calls it. */
    const call = (method: GatewayMethod, params: WireRecord = {}) => {
      const handler = composer.methods[method] ?? accountAsks.methods[method];
      assert.ok(handler, `no handler for ${method}`);
      return handler(params, context);
    };
    /**
     * Each read of `transcript` the host laid on the held transcripts as it
     * moved, its rows, none where it held none, and how many reads the
     * service had been asked as each was laid, in order.
     */
    const transcripts = (
      transcript: { readonly agentId: string; readonly callId?: string } = FOLLOWED,
    ) => {
      const laid: { readonly rows: AppTranscript | undefined; readonly asked: number }[] = [];
      let was: unknown;
      for (const event of events) {
        if (
          event.kind !== GATEWAY_EVENT.LIVE_READ_CHANGED ||
          !isRecord(event.payload) ||
          event.payload.read !== LIVE_READ.TRANSCRIPT
        )
          continue;
        // SAFETY: the held transcripts are the host's own, told as built.
        const held = event.payload.held as unknown as AppTranscripts;
        const read = held[transcript.agentId]?.[transcript.callId ?? OWN_TRANSCRIPT];
        if (read === was) continue;
        was = read;
        laid.push({ rows: read?.rows, asked: event.asked });
      }
      return laid;
    };
    return {
      call,
      /** Both composers' declared acts, each handed its input as the port reads it. */
      acts: { ...composer.acts, ...accountAsks.acts },
      /** The composer's row writes that may wait, as a relaunch lays its queue back by. */
      queueable: composer.queueable,
      flushHeldCloses: composer.flushHeldCloses,
      letGoHeldCloses: composer.letGoHeldCloses,
      answerClosesAfter: service.answerClosesAfter,
      transcripts,
      /** Each of `transcript`'s rows the host laid, in order. */
      held: (transcript?: { readonly agentId: string; readonly callId?: string }) =>
        transcripts(transcript).map((each) => each.rows),
      asked: service.asked,
      startCommits: service.startCommits,
      leaveStartsUnanswered: service.leaveStartsUnanswered,
      answerRemoves: service.answerRemoves,
      answerForgets: service.answerForgets,
      answerPresence: service.answerPresence,
      answerKeys: service.answerKeys,
      markKeys: service.markKeys,
      answerMarks: service.answerMarks,
      failPresence: service.failPresence,
      sealTranscript: service.sealTranscript,
      pageNow: service.pageNow,
      holdPages: service.holdPages,
      pageNewest: service.pageNewest,
      sendTxid: service.sendTxid,
      holdChanges: service.holdChanges,
      holdMessages: service.holdMessages,
      answerQueue: service.answerQueue,
      sealScope: service.sealScope,
      sealAccount: service.sealAccount,
      sealItems: service.sealItems,
      stallItems: service.stallItems,
      commitIn: service.commitIn,
      changeFirst: service.changeFirst,
      live: service.live,
      /** Every answer of the followed account inbox the host told, in order. */
      accountInboxes: () =>
        events.flatMap((event) =>
          event.kind === GATEWAY_EVENT.ACCOUNT_INBOX_CHANGED ? [event.payload] : [],
        ),
      /** Every telling of the account's items, whole, in order. */
      accountItems: () =>
        events.flatMap((event) =>
          event.kind === GATEWAY_EVENT.INBOX_ITEMS_CHANGED ? [event.payload] : [],
        ),
      /** Every telling of the models the host holds for the windows, whole, in order. */
      models: () => toldLive(LIVE_READ.MODELS),
      /** Every telling of the account's preferences the host holds for the session, whole, in order. */
      preferences: () =>
        events.flatMap((event) =>
          event.kind === GATEWAY_EVENT.ACCOUNT_PREFERENCES_CHANGED ? [event.payload] : [],
        ),
      /** Every telling of the provider keys the host holds for the windows, whole, in order. */
      providerKeys: () => toldLive(LIVE_READ.PROVIDER_KEYS),
      /** Every telling of the hosts the host holds for the windows, whole, in order. */
      hosts: () => toldLive(LIVE_READ.HOSTS),
      /** Every telling of the GitHub token the host holds for the windows, whole, in order. */
      githubToken: () => toldLive(LIVE_READ.GITHUB_TOKEN),
      /** Every telling of the memories the host holds for the windows, whole, in order. */
      memories: () => toldLive(LIVE_READ.MEMORIES),
      /** Every telling of the beats the host holds for the windows, whole, in order. */
      beats: () => toldLive(LIVE_READ.DEVICE_PRESENCE),
      /** Every telling of the inboxes the host holds for the windows, whole, in order. */
      told: () => toldLive(LIVE_READ.HOLDER_INBOX),
      /** Every telling of the agents' origins the host holds for the windows, whole, in order. */
      origins: () => toldLive(LIVE_READ.AGENT_ORIGINS),
      /** The account gate opening, as the host opens it. */
      open: Effect.andThen(composer.open, accountAsks.open),
      /** The account gate closing, as the host closes it. */
      reset: Effect.andThen(composer.reset, accountAsks.reset),
    };
  });
}
