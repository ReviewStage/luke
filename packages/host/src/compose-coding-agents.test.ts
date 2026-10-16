import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import type { AccountInboxEntry } from "@luke/features/account-inbox-wire";
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
  INBOX_REPLY,
  INBOX_RESPONSE,
  INBOX_STATUS,
  INBOX_WIRE_VERSION,
  type InboxItem,
} from "@luke/features/inbox-wire";
import { INTEGRATION_PROVIDER } from "@luke/features/integration-wire";
import type { AccountInboxLiveAnswer, ScopeInboxLiveAnswer } from "@luke/features/live-wire";
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
import { PLAN_ACTOR } from "@luke/features/task-wire";
import {
  GATEWAY_CLIENT_ROLE,
  GATEWAY_EVENT,
  GATEWAY_METHOD,
  type GatewayEventKind,
  type GatewayMethod,
} from "@luke/gateway";
import { isRecord, isWireString, type WireRecord, type WireValue } from "@luke/wire";
import { Effect, Fiber } from "effect";
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

/** The agent as its own page reads it, with no plan, as an automation's run leaves one. */
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

/** That pull request as its Pull request tab draws it. */
const OVERVIEW = {
  pullRequest: {
    number: 123,
    title: "Send the invite once",
    url: "https://github.com/acme/relay/pull/123",
    state: PULL_REQUEST_STATE.OPEN,
    html: "<p>Sends the invite once.</p>",
    cut: false,
    base: "main",
    head: "luke/invite-once",
    createdAt: 1_800_000_000_000,
    mergedAt: null,
    merge: MERGE_STATE.CLEAN,
    checks: [],
    reviewers: [],
    conversation: [],
    earlier: 0,
  },
};

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
    changes: (agentId) =>
      Effect.sync(() => {
        asked.push(`changes:${agentId}`);
        return CHANGES;
      }),
    overview: (agentId) =>
      Effect.sync(() => {
        asked.push(`overview:${agentId}`);
        return OVERVIEW;
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
    // The held read answers at once from the start and is held from its own cursor on, as the service holds it while nothing changed.
    accountInbox: (after) =>
      Effect.suspend(() => {
        asked.push(`account-inbox:${after}`);
        return after === "9"
          ? Effect.never
          : Effect.succeed({ items: [WAITING], plans: [], cursor: "9", readAt: ITEM.updatedAt });
      }),
    accountInboxLive: () =>
      Effect.sync(() => {
        asked.push("account-inbox-live");
        return live ?? { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED };
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
    /** What the service seals for following the account's inbox; none answers unanswered, as a service without Realtime does. */
    seal: (next: AccountInboxLiveAnswer | undefined) => {
      live = next;
    },
    /** What the service seals for following a plan's or an agent's inbox, or that the account reaches none; none answers unanswered. */
    sealScope: (next: ScopeInboxLiveAnswer | { readonly failure: "not-found" } | undefined) => {
      scope = next;
    },
  };
}

function subject(options: { signedIn?: boolean; sendsNetwork?: boolean } = {}) {
  return Effect.gen(function* () {
    const service = fakeService();
    const realtime = fakeRealtime();
    const events: { kind: GatewayEventKind; payload: WireValue }[] = [];
    const composer = yield* composeCodingAgents({
      kernel: {
        runMode: { sendsNetwork: options.sendsNetwork ?? true },
        emit: (kind, payload) => void events.push({ kind, payload }),
        now: () => NOW,
      },
      account: { capabilitiesActive: () => options.signedIn ?? true },
      client: service.client,
      openLive: realtime.open,
    });
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
      realtime,
      inboxes,
      reset: composer.reset,
    };
  });
}

/** The host's clock, which an answer read live is stamped with. */
const NOW = 1_800_000_100_000;

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
      yield* call(GATEWAY_METHOD.CODING_AGENTS_OVERVIEW, { agentId: AGENT_ID }),
      OVERVIEW,
    );
    assert.deepEqual(
      yield* call(GATEWAY_METHOD.CODING_AGENTS_GITHUB_IMAGE, {
        agentId: AGENT_ID,
        src: "https://camo.githubusercontent.com/abc",
      }),
      { contentType: GITHUB_IMAGE_TYPE.PNG, base64: "iVBORw0KGgo=" },
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
      `agent-inbox-live:${AGENT_ID}`,
      `agent-inbox:${AGENT_ID}:${INBOX_CURSOR_START}`,
      `pull-request:${AGENT_ID}`,
      `changes:${AGENT_ID}`,
      `overview:${AGENT_ID}`,
      `github-image:${AGENT_ID}:https://camo.githubusercontent.com/abc`,
      `plan-inbox-live:${TASK_ID}`,
      `inbox:${TASK_ID}:${INBOX_CURSOR_START}`,
      `attachment:${ITEM.id}:${ATTACHMENT_ID}`,
      `picture:${AGENT_ID}:${PICTURE_ID}:call-worker`,
      `answer:${ITEM.id}:2:${INBOX_REPLY.DECLINED}:Not before the freeze lifts.:answer-1`,
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

it.effect(
  "the account inbox is followed over Realtime where the service seals it: every part subscribed at the address it names, and once each part has its rows the answer published whole, in the held read's order, with the last week's failed runs, and never a sealed statement",
  () =>
    Effect.gen(function* () {
      const { call, asked, seal, realtime, inboxes } = yield* subject();
      seal(SEALED);
      yield* call(GATEWAY_METHOD.CODING_AGENTS_ACCOUNT_INBOX_FOLLOW);
      yield* settled;
      assert.deepEqual(realtime.opened, [SEALED.url]);
      assert.deepEqual(realtime.subscribed(), [
        "capability-automations",
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
      yield* settled;
      // Nothing is published before every part has its first rows.
      assert.deepEqual(inboxes(), []);
      realtime.deliver("failedRuns", [
        failedRun("3b4c5d6e-7f8a-4b9c-8d1e-2f3a4b5c6d7e", 8),
        failedRun(recent, 1),
      ]);
      yield* settled;

      assert.deepEqual(inboxes(), [
        {
          items: [NEWER, WAITING],
          plans: [{ planId: TASK_ID, items: 2, updatedAt: NEWER.updatedAt }],
          planless: [],
          automations: [],
          failedRuns: [failedRun(recent, 1)],
          cursor: "",
          readAt: NOW,
        },
      ]);
      assert.deepEqual(asked, ["account-inbox-live"]);
      assert.ok(!JSON.stringify(inboxes()).includes("capability"));
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
        "capability-failedRuns",
        "capability-items",
        "capability-planless",
        "capability-plans",
      ]);
      assert.deepEqual(asked, ["account-inbox-live", "account-inbox-live"]);

      realtime.deliver("items", [{ id: "not an item" }]);
      for (const part of ["planless", "plans", "automations", "failedRuns"]) {
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
  "a service that seals nothing is followed by its held read as before, and letting go, or a sign-out, ends the follow",
  () =>
    Effect.gen(function* () {
      const held = yield* subject();
      yield* held.call(GATEWAY_METHOD.CODING_AGENTS_ACCOUNT_INBOX_FOLLOW);
      yield* settled;
      assert.deepEqual(held.asked, [
        "account-inbox-live",
        `account-inbox:${INBOX_CURSOR_START}`,
        "account-inbox:9",
      ]);
      assert.deepEqual(held.inboxes(), [
        { items: [WAITING], plans: [], cursor: "9", readAt: ITEM.updatedAt },
      ]);
      assert.deepEqual(held.realtime.opened, []);

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
  queries: { items: sealed("items") },
};

/** That item as its row delivers it, what it leaves out held as null. */
const ITEM_ROW = {
  ...ITEM,
  answer: null,
  answeredBy: null,
  answeredByName: null,
  closedReason: null,
};

it.effect(
  "a plan's inbox is answered from its Realtime subscription: at once once its rows land, then as soon as they move past the reader's cursor, unchanged when the hold ends, and never from the held read",
  () =>
    Effect.gen(function* () {
      const { call, asked, sealScope, realtime } = yield* subject();
      sealScope(SEALED_SCOPE);
      const first = yield* Effect.forkChild(
        call(GATEWAY_METHOD.CODING_AGENTS_INBOX, { taskId: TASK_ID, after: INBOX_CURSOR_START }),
      );
      yield* settled;
      assert.deepEqual(realtime.opened, [SEALED_SCOPE.url]);
      realtime.deliver("items", [ITEM_ROW]);
      yield* settled;
      const answered = yield* Fiber.join(first);
      assert.ok(isRecord(answered) && isWireString(answered.cursor));
      assert.deepEqual(answered.items, [ITEM]);

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
        { ...ITEM, revision: 3, status: INBOX_STATUS.CLOSED, closedReason: "Done" },
      ]);

      const unchanged = yield* Effect.forkChild(
        call(GATEWAY_METHOD.CODING_AGENTS_INBOX, { taskId: TASK_ID, after: moved.cursor }),
      );
      yield* settled;
      yield* TestClock.adjust("20 seconds");
      assert.deepEqual(yield* Fiber.join(unchanged), moved);
      // One subscription served every read, and the service's held read was never asked.
      assert.deepEqual(asked, [`plan-inbox-live:${TASK_ID}`]);
      assert.deepEqual(realtime.opened, [SEALED_SCOPE.url]);
    }),
);

it.effect(
  "an agent's inbox the account does not reach is not found, and one the service seals nothing for is the held read",
  () =>
    Effect.gen(function* () {
      const refused = yield* subject();
      refused.sealScope({ failure: CODING_AGENT_CALL_FAILURE.NOT_FOUND });
      assert.deepEqual(
        yield* refused.call(GATEWAY_METHOD.CODING_AGENTS_AGENT_INBOX, {
          agentId: AGENT_ID,
          after: INBOX_CURSOR_START,
        }),
        { failure: CODING_AGENT_CALL_FAILURE.NOT_FOUND },
      );

      const held = yield* subject();
      assert.deepEqual(
        yield* held.call(GATEWAY_METHOD.CODING_AGENTS_AGENT_INBOX, {
          agentId: AGENT_ID,
          after: INBOX_CURSOR_START,
        }),
        { items: [ITEM], cursor: "8" },
      );
      assert.deepEqual(held.realtime.opened, []);
    }),
);
