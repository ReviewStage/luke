import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { GATEWAY_CLIENT_ROLE, GATEWAY_METHOD, type GatewayMethod } from "@sidecar/gateway";
import type { AccountInboxEntry } from "@sidecar/hosted/account-inbox-wire";
import { CODING_AGENT_CALL_FAILURE } from "@sidecar/hosted/coding-agent-view";
import {
  CHANGED_FILE_STATUS,
  CHECK_SUMMARY,
  CODING_AGENT_CURSOR_START,
  CODING_AGENT_STATUS,
  type CodingAgentSummary,
  PULL_REQUEST_STATE,
} from "@sidecar/hosted/coding-agent-wire";
import {
  INBOX_CURSOR_START,
  INBOX_IMAGE_TYPE,
  INBOX_REPLY,
  INBOX_RESPONSE,
  INBOX_STATUS,
  INBOX_WIRE_VERSION,
  type InboxItem,
} from "@sidecar/hosted/inbox-wire";
import { MODEL_PROVIDER } from "@sidecar/hosted/models-wire";
import {
  DEFAULT_PLAN_TEMPLATE,
  PLAN_TEMPLATE_BOUNDS,
  type PlanTemplateRevisionLine,
} from "@sidecar/hosted/plan-document-template";
import { PLAN_ACTOR } from "@sidecar/hosted/plan-wire";
import {
  PROVIDER_KEY_PROVIDER,
  PROVIDER_KEY_STATUS,
  type ProviderKeySummary,
} from "@sidecar/hosted/provider-key-wire";
import type { WireRecord } from "@sidecar/wire";
import { Effect } from "effect";
import { type CodingAgentClient, composeCodingAgents } from "./compose-coding-agents.js";

/** One revision of the template as the service lists it. */
const TEMPLATE_REVISION: PlanTemplateRevisionLine = {
  seq: 2,
  lastEdit: { actor: PLAN_ACTOR.DEVELOPER, at: 1_000, duringCall: false },
  startedAt: 1_000,
  changes: 1,
};

const PLAN_ID = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
const AGENT_ID = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";

const AGENT: CodingAgentSummary = {
  id: AGENT_ID,
  planId: PLAN_ID,
  model: "anthropic/claude-opus-5.5",
  effort: "high",
  title: null,
  createdAt: 1_800_000_000_000,
  status: CODING_AGENT_STATUS.RUNNING,
  turnId: "9d2b7b5a-4e3f-4e9c-9c77-7a5d8b3f4c32",
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
  planId: PLAN_ID,
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
    list: (planId, includeArchived) =>
      Effect.sync(() => {
        asked.push(includeArchived === true ? `list:${planId}:archived` : `list:${planId}`);
        return { agents: [AGENT] };
      }),
    start: (planId, request) =>
      Effect.sync(() => {
        asked.push(`start:${planId}:${request.idempotencyKey}:${request.model ?? "default"}`);
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
    inbox: (planId, after) =>
      Effect.sync(() => {
        asked.push(`inbox:${planId}:${after}`);
        return { items: [ITEM], cursor: "7" };
      }),
    inboxAttachment: (itemId, attachmentId) =>
      Effect.sync(() => {
        asked.push(`attachment:${itemId}:${attachmentId}`);
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
    accountInbox: (after) =>
      Effect.sync(() => {
        asked.push(`account-inbox:${after}`);
        return { items: [WAITING], plans: [], cursor: "9", readAt: ITEM.updatedAt };
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
    });
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
    assert.deepEqual(yield* call(GATEWAY_METHOD.CODING_AGENTS_LIST, { planId: PLAN_ID }), {
      agents: [AGENT],
    });
    assert.deepEqual(
      yield* call(GATEWAY_METHOD.CODING_AGENTS_LIST, { planId: PLAN_ID, includeArchived: true }),
      { agents: [AGENT] },
    );
    assert.deepEqual(
      yield* call(GATEWAY_METHOD.CODING_AGENTS_START, {
        planId: PLAN_ID,
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
    assert.deepEqual(yield* call(GATEWAY_METHOD.CODING_AGENTS_STOP, { agentId: AGENT_ID }), {
      agent: { ...AGENT, status: CODING_AGENT_STATUS.CANCELLED },
    });
    assert.deepEqual(
      yield* call(GATEWAY_METHOD.CODING_AGENTS_ARCHIVE, { agentId: AGENT_ID, archived: true }),
      { agent: { ...AGENT, archivedAt: 1_800_000_120_000 } },
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
      yield* call(GATEWAY_METHOD.CODING_AGENTS_INBOX, {
        planId: PLAN_ID,
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
      yield* call(GATEWAY_METHOD.CODING_AGENTS_ACCOUNT_INBOX, { after: INBOX_CURSOR_START }),
      { items: [WAITING], plans: [], cursor: "9", readAt: ITEM.updatedAt },
    );

    assert.deepEqual(asked, [
      "models",
      "default",
      "default:openai/gpt-6.1-sol:xhigh",
      `list:${PLAN_ID}`,
      `list:${PLAN_ID}:archived`,
      `start:${PLAN_ID}:press-1:default`,
      `messages:${AGENT_ID}:${CODING_AGENT_CURSOR_START}`,
      `worker:${AGENT_ID}:call-7:${CODING_AGENT_CURSOR_START}`,
      `message:${AGENT_ID}:send-1:Also expire them after a week.`,
      `choose:${AGENT_ID}:openai/gpt-6.1-sol:low`,
      `rename:${AGENT_ID}:Sign-out button`,
      `stop:${AGENT_ID}`,
      `archive:${AGENT_ID}:true`,
      `pull-request:${AGENT_ID}`,
      `changes:${AGENT_ID}`,
      `inbox:${PLAN_ID}:${INBOX_CURSOR_START}`,
      `attachment:${ITEM.id}:${ATTACHMENT_ID}`,
      `answer:${ITEM.id}:2:${INBOX_REPLY.DECLINED}:Not before the freeze lifts.:answer-1`,
      `account-inbox:${INBOX_CURSOR_START}`,
    ]);
  }),
);

it.effect("a Start that names a model hands the service the choice as one thing", () =>
  Effect.gen(function* () {
    const { call, asked } = yield* subject();

    yield* call(GATEWAY_METHOD.CODING_AGENTS_START, {
      planId: PLAN_ID,
      idempotencyKey: "press-2",
      model: "openai/gpt-6.1-sol",
      effort: "xhigh",
    });

    assert.deepEqual(asked, [`start:${PLAN_ID}:press-2:openai/gpt-6.1-sol`]);
  }),
);

it.effect(
  "params a method's own schema refuses are refused as invalid, and the service is not asked",
  () =>
    Effect.gen(function* () {
      const { call, asked } = yield* subject();

      const refused = yield* Effect.flip(
        call(GATEWAY_METHOD.CODING_AGENTS_MESSAGES, { agentId: AGENT_ID }),
      );
      const noCursor = yield* Effect.flip(
        call(GATEWAY_METHOD.CODING_AGENTS_INBOX, { planId: PLAN_ID }),
      );
      const noAccountCursor = yield* Effect.flip(
        call(GATEWAY_METHOD.CODING_AGENTS_ACCOUNT_INBOX, {}),
      );
      const noRevision = yield* Effect.flip(
        call(GATEWAY_METHOD.CODING_AGENTS_INBOX_ANSWER, {
          itemId: ITEM.id,
          reply: INBOX_REPLY.APPROVED,
          clientKey: "answer-2",
        }),
      );

      assert.equal(refused._tag, "InvalidParamsRefusal");
      assert.equal(noCursor._tag, "InvalidParamsRefusal");
      assert.equal(noRevision._tag, "InvalidParamsRefusal");
      assert.equal(noAccountCursor._tag, "InvalidParamsRefusal");
      assert.deepEqual(asked, []);
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
        yield* offline.call(GATEWAY_METHOD.CODING_AGENTS_LIST, { planId: PLAN_ID }),
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

it.effect(
  "the plan template is read, kept as written, and reset with null, each one ask of the service; a template past the bound is refused before it, and a closed gate answers unanswered",
  () =>
    Effect.gen(function* () {
      const { call, asked } = yield* subject();
      const signedOut = yield* subject({ signedIn: false });

      const read = yield* call(GATEWAY_METHOD.PLAN_TEMPLATE_READ);
      const kept = yield* call(GATEWAY_METHOD.PLAN_TEMPLATE_WRITE, { template: "## Why\n" });
      const reset = yield* call(GATEWAY_METHOD.PLAN_TEMPLATE_WRITE, { template: null });
      const refused = yield* Effect.flip(
        call(GATEWAY_METHOD.PLAN_TEMPLATE_WRITE, {
          template: "x".repeat(PLAN_TEMPLATE_BOUNDS.MAX_CHARS + 1),
        }),
      );
      const unanswered = yield* signedOut.call(GATEWAY_METHOD.PLAN_TEMPLATE_READ);

      assert.deepEqual(read, { template: DEFAULT_PLAN_TEMPLATE, custom: false });
      assert.deepEqual(kept, { template: "## Why\n", custom: true });
      assert.deepEqual(reset, { template: DEFAULT_PLAN_TEMPLATE, custom: false });
      assert.equal(refused._tag, "InvalidParamsRefusal");
      assert.deepEqual(unanswered, { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED });
      assert.deepEqual(asked, ["template", "template:## Why\n", "template:the default"]);
      assert.deepEqual(signedOut.asked, []);
    }),
);

it.effect(
  "the plan template's history is read a page and a revision at a time and a revision restored, each one ask of the service; a revision with no number is refused before it, and a closed gate answers unanswered",
  () =>
    Effect.gen(function* () {
      const { call, asked } = yield* subject();
      const signedOut = yield* subject({ signedIn: false });

      const newest = yield* call(GATEWAY_METHOD.PLAN_TEMPLATE_REVISIONS, {});
      const older = yield* call(GATEWAY_METHOD.PLAN_TEMPLATE_REVISIONS, { before: 3 });
      const revision = yield* call(GATEWAY_METHOD.PLAN_TEMPLATE_REVISION, { seq: 2 });
      const restored = yield* call(GATEWAY_METHOD.PLAN_TEMPLATE_RESTORE, { seq: 2 });
      const refused = yield* Effect.flip(call(GATEWAY_METHOD.PLAN_TEMPLATE_RESTORE, { seq: 0 }));
      const unanswered = yield* signedOut.call(GATEWAY_METHOD.PLAN_TEMPLATE_REVISIONS, {});

      assert.deepEqual(newest, { revisions: [TEMPLATE_REVISION] });
      assert.deepEqual(older, { revisions: [TEMPLATE_REVISION] });
      assert.deepEqual(revision, {
        revision: { seq: 2, document: { body: "## Why\n", assumptions: [] }, previous: null },
      });
      assert.deepEqual(restored, { template: "## Why\n", custom: true });
      assert.equal(refused._tag, "InvalidParamsRefusal");
      assert.deepEqual(unanswered, { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED });
      assert.deepEqual(asked, ["revisions:newest", "revisions:3", "revision:2", "restore:2"]);
      assert.deepEqual(signedOut.asked, []);
    }),
);

it.effect(
  "a dictated clip passes through to the service once and is answered with its words, and a clip the schema refuses is refused in words that hold none of it",
  () =>
    Effect.gen(function* () {
      const { call, asked } = yield* subject();
      const signedOut = yield* subject({ signedIn: false });

      const heard = yield* call(GATEWAY_METHOD.DICTATION_TRANSCRIBE, {
        audio: "GkXfow==",
        durationMs: 1_500,
        keywords: ["luke"],
      });
      const refused = yield* Effect.flip(
        call(GATEWAY_METHOD.DICTATION_TRANSCRIBE, { audio: "not base64!", keywords: ["luke"] }),
      );
      const unanswered = yield* signedOut.call(GATEWAY_METHOD.DICTATION_TRANSCRIBE, {
        audio: "GkXfow==",
        durationMs: 1_500,
        keywords: [],
      });

      assert.deepEqual(heard, { text: "Run the tests" });
      assert.equal(refused._tag, "InvalidParamsRefusal");
      assert.ok(!JSON.stringify(refused).includes("not base64!"));
      assert.deepEqual(unanswered, { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED });
      assert.deepEqual(asked, ["transcribe:GkXfow==:luke"]);
      assert.deepEqual(signedOut.asked, []);
    }),
);
