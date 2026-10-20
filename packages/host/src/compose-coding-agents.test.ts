import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import type { AccountInboxEntry } from "@luke/features/account-inbox-wire";
import { CHAPTERS_MODEL } from "@luke/features/chapters-model-choice";
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
import { GATEWAY_CLIENT_ROLE, GATEWAY_METHOD, type GatewayMethod } from "@luke/gateway";
import type { WireRecord } from "@luke/wire";
import { noNetwork } from "@luke/wire/testing";
import { Effect } from "effect";
import { type CodingAgentClient, composeCodingAgents } from "./compose-coding-agents.js";

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
    accountInbox: (after) =>
      Effect.sync(() => {
        asked.push(`account-inbox:${after}`);
        return { items: [WAITING], plans: [], cursor: "9", readAt: ITEM.updatedAt };
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
  return { client, asked };
}

function subject(options: { signedIn?: boolean; sendsNetwork?: boolean } = {}) {
  return Effect.gen(function* () {
    const service = fakeService();
    const composer = yield* composeCodingAgents({
      kernel: { runMode: { sendsNetwork: options.sendsNetwork ?? true } },
      account: { capabilitiesActive: () => options.signedIn ?? true },
      client: service.client,
    }).pipe(Effect.provide(noNetwork));
    const call = (method: GatewayMethod, params: WireRecord = {}) => {
      const handler = composer.methods[method];
      assert.ok(handler, `no handler for ${method}`);
      return handler(params, context);
    };
    return { call, asked: service.asked };
  });
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
      yield* call(GATEWAY_METHOD.CODING_AGENTS_ACCOUNT_INBOX, { after: INBOX_CURSOR_START }),
      { items: [WAITING], plans: [], cursor: "9", readAt: ITEM.updatedAt },
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
      `account-inbox:${INBOX_CURSOR_START}`,
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
