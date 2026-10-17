import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { CHAT_CURSOR_START, MEMBER_KIND } from "@luke/features/chat-wire";
import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentAgentAnswer,
} from "@luke/features/coding-agent-view";
import {
  CHECK_SUMMARY,
  CODING_AGENT_STATUS,
  PULL_REQUEST_STATE,
} from "@luke/features/coding-agent-wire";
import {
  INBOX_IMAGE_TYPE,
  INBOX_RESPONSE,
  INBOX_STATUS,
  INBOX_WIRE_VERSION,
  type InboxItem,
} from "@luke/features/inbox-wire";
import { DEFAULT_PLAN_TEMPLATE } from "@luke/features/plan-document-template";
import { PROVIDER_KEY_PROVIDER } from "@luke/features/provider-key-wire";
import {
  PULL_REQUEST_ACTION,
  PULL_REQUEST_WRITE_OUTCOME,
} from "@luke/features/pull-request-write-wire";
import { Effect } from "effect";
import { ACT, ACT_KIND, ACT_OUTCOME_STATUS } from "../acts.js";
import { codingAgentActRows } from "./coding-agent-acts.js";
import { type ActRows, type ActSender, createActRouter } from "./router.js";

// The platform's handle on the window that asked, which no row here reads.
const SENDER = Symbol("window");

const PANEL: ActSender = { sender: SENDER, panel: true, voice: false, call: false };
const VOICE: ActSender = { ...PANEL, panel: false, voice: true };

/** A synthetic provider key, as Settings carries it once. */
const PROVIDER_KEY = "sk-proj-synthetic-00000000000000000000abcd";

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

const STARTED: CodingAgentAgentAnswer = {
  agent: {
    id: AGENT_ID,
    planId: TASK_ID,
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    title: null,
    createdAt: 1_800_000_000_000,
    status: CODING_AGENT_STATUS.STARTING,
    turnId: null,
  },
};
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

function fixture(answered: CodingAgentAgentAnswer = STARTED) {
  const asked: string[] = [];
  /** What the notices were told, in order. */
  const noted: string[] = [];
  const rows = codingAgentActRows({
    notices: {
      observeAgents: (agents) => {
        noted.push(`agents:${agents.map((agent) => `${agent.id}=${agent.status}`).join(",")}`);
      },
      observeStatus: (agentId, status) => {
        noted.push(`status:${agentId}=${status}`);
      },
      observeTitle: (agentId, title) => {
        noted.push(`title:${agentId}=${title}`);
      },
      observeMessaged: (agent) => {
        noted.push(`messaged:${agent.id}=${agent.status}`);
      },
      observeModels: (models) => {
        noted.push(`models:${models.length}`);
      },
      observePublished: (agentId, pullRequest) => {
        noted.push(`published:${agentId}=${pullRequest?.number ?? "none"}`);
      },
      observeTaskGone: (taskId) => {
        noted.push(`gone:${taskId}`);
      },
      shown: (agentId) => {
        noted.push(`shown:${agentId}`);
      },
      shownInbox: (taskId) => {
        noted.push(`inbox:${taskId}`);
      },
      shownChat: (shown) => {
        noted.push(`chat:${shown}`);
      },
    },
    host: {
      codingAgentWorkspaceList: (params) =>
        Effect.sync(() => {
          asked.push(`workspace agents ${params.workspaceId}`);
          return { agents: [] };
        }),
      codingAgentModels: () =>
        Effect.sync(() => {
          asked.push("models");
          return { models: [] };
        }),
      codingAgentDefaultRead: () =>
        Effect.sync(() => {
          asked.push("default");
          return { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED } as const;
        }),
      codingAgentDefaultWrite: (choice) =>
        Effect.sync(() => {
          asked.push(`default:${choice.model}:${choice.effort}`);
          return { choice };
        }),
      codingAgentList: ({ taskId, includeArchived }) =>
        Effect.sync(() => {
          asked.push(includeArchived === true ? `list:${taskId}:archived` : `list:${taskId}`);
          return { agents: [] };
        }),
      codingAgentStart: (params) =>
        Effect.sync(() => {
          asked.push(`start:${params.taskId}:${params.idempotencyKey}`);
          return STARTED;
        }),
      codingAgentMessages: ({ agentId, after, callId }) =>
        Effect.sync(() => {
          asked.push(
            callId === undefined
              ? `messages:${agentId}:${after}`
              : `worker:${agentId}:${callId}:${after}`,
          );
          return { messages: [], cursor: after, status: CODING_AGENT_STATUS.RUNNING, title: null };
        }),
      codingAgentMessage: ({ agentId, text, clientKey }) =>
        Effect.sync(() => {
          asked.push(`message:${agentId}:${clientKey}:${text}`);
          return STARTED;
        }),
      codingAgentChoose: ({ agentId, model, effort }) =>
        Effect.sync(() => {
          asked.push(`choose:${agentId}:${model}:${effort}`);
          return STARTED;
        }),
      codingAgentRename: ({ agentId, title }) =>
        Effect.sync(() => {
          asked.push(`rename:${agentId}:${title}`);
          return answered;
        }),
      codingAgentServers: ({ agentId, disabledServers }) =>
        Effect.sync(() => {
          asked.push(`servers:${agentId}:${disabledServers.join(",")}`);
          return STARTED;
        }),
      codingAgentStop: ({ agentId }) =>
        Effect.sync(() => {
          asked.push(`stop:${agentId}`);
          return STARTED;
        }),
      codingAgentArchive: ({ agentId, archived }) =>
        Effect.sync(() => {
          asked.push(`archive:${agentId}:${String(archived)}`);
          return answered;
        }),
      codingAgentPin: ({ agentId, pinned }) =>
        Effect.sync(() => {
          asked.push(`pin:${agentId}:${String(pinned)}`);
          return answered;
        }),
      tasksRefresh: () =>
        Effect.sync(() => {
          asked.push("refresh");
        }),
      codingAgentPage: () =>
        Effect.succeed({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED } as const),
      codingAgentAgentInbox: () =>
        Effect.succeed({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED } as const),
      codingAgentPullRequest: ({ agentId }) =>
        Effect.sync(() => {
          asked.push(`pull-request:${agentId}`);
          return {
            repository: "acme/relay",
            branch: "luke/invites",
            pullRequest: {
              number: 41,
              title: "Teammate invitations",
              url: "https://github.com/acme/relay/pull/41",
              state: PULL_REQUEST_STATE.OPEN,
              checks: CHECK_SUMMARY.PASSING,
              additions: 12,
              deletions: 3,
              changedFiles: 2,
            },
          };
        }),
      codingAgentChanges: ({ agentId }) =>
        Effect.sync(() => {
          asked.push(`changes:${agentId}`);
          return { pullRequest: null };
        }),
      codingAgentOverviewPullRequest: ({ agentId }) =>
        Effect.sync(() => {
          asked.push(`overview-pull-request:${agentId}`);
          return { pullRequest: null };
        }),
      codingAgentOverviewChecks: ({ agentId }) =>
        Effect.sync(() => {
          asked.push(`overview-checks:${agentId}`);
          return { pullRequest: null };
        }),
      codingAgentOverviewConversation: ({ agentId }) =>
        Effect.sync(() => {
          asked.push(`overview-conversation:${agentId}`);
          return { pullRequest: null };
        }),
      codingAgentPullRequestAction: ({ agentId, request }) =>
        Effect.sync(() => {
          asked.push(`pull-request-action:${agentId}:${request.action}`);
          return { outcome: PULL_REQUEST_WRITE_OUTCOME.DONE } as const;
        }),
      codingAgentGitHubImage: ({ agentId }) =>
        Effect.sync(() => {
          asked.push(`github-image:${agentId}`);
          return { failure: CODING_AGENT_CALL_FAILURE.NOT_FOUND } as const;
        }),
      providerKeysRead: () =>
        Effect.sync(() => {
          asked.push("keys");
          return { keys: [] };
        }),
      providerKeySave: ({ provider, key }) =>
        Effect.sync(() => {
          asked.push(`save:${provider}:${key === PROVIDER_KEY ? "the key" : "another"}`);
          return { keys: [] };
        }),
      providerKeyRemove: ({ provider }) =>
        Effect.sync(() => {
          asked.push(`remove:${provider}`);
          return { keys: [] };
        }),
      planTemplateRead: () =>
        Effect.sync(() => {
          asked.push("template");
          return { template: DEFAULT_PLAN_TEMPLATE, custom: false };
        }),
      planTemplateWrite: ({ template }) =>
        Effect.sync(() => {
          asked.push(`template:${template ?? "the default"}`);
          return { template: template ?? DEFAULT_PLAN_TEMPLATE, custom: template !== null };
        }),
      planTemplateRevisions: ({ before }) =>
        Effect.sync(() => {
          asked.push(`revisions:${before ?? "newest"}`);
          return { revisions: [] };
        }),
      planTemplateRevision: ({ seq }) =>
        Effect.sync(() => {
          asked.push(`revision:${seq}`);
          return {
            revision: { seq, document: { body: "## Why\n", assumptions: [] }, previous: null },
          };
        }),
      planTemplateRestore: ({ seq }) =>
        Effect.sync(() => {
          asked.push(`restore:${seq}`);
          return { template: "## Why\n", custom: true };
        }),
      dictationTranscribe: ({ audio, keywords }) =>
        Effect.sync(() => {
          asked.push(`transcribe:${audio}:${keywords.join(",")}`);
          return { text: "Run the tests" };
        }),
      codingAgentInbox: ({ taskId, after }) =>
        Effect.sync(() => {
          asked.push(`inbox:${taskId}:${after}`);
          return { items: [ITEM], cursor: "7" };
        }),
      codingAgentInboxAnswer: ({ itemId, revision, reply, clientKey }) =>
        Effect.sync(() => {
          asked.push(`answer:${itemId}:${revision}:${reply}:${clientKey}`);
          return { item: { ...ITEM, status: INBOX_STATUS.ANSWERED }, taken: true };
        }),
      codingAgentInboxMessage: ({ itemId, text, attachments, clientKey }) =>
        Effect.sync(() => {
          const files = (attachments ?? []).map((file) => file.name).join(",");
          asked.push(`message:${itemId}:${text}:${files}:${clientKey}`);
          return { item: ITEM };
        }),
      codingAgentInboxAttachment: ({ itemId, attachmentId }) =>
        Effect.sync(() => {
          asked.push(`attachment:${itemId}:${attachmentId}`);
          return { contentType: INBOX_IMAGE_TYPE.PNG, base64: "iVBORw0KGgo=" };
        }),
      codingAgentPicture: ({ agentId, pictureId, callId }) =>
        Effect.sync(() => {
          asked.push(`picture:${agentId}:${pictureId}:${callId ?? ""}`);
          return { contentType: INBOX_IMAGE_TYPE.PNG, base64: "iVBORw0KGgo=" };
        }),
      codingAgentChat: ({ workspaceId, after }) =>
        Effect.sync(() => {
          asked.push(`chat:${workspaceId}:${after}`);
          return CHAT;
        }),
      codingAgentChatPost: ({ workspaceId, write }) =>
        Effect.sync(() => {
          asked.push(`chat-post:${workspaceId}:${JSON.stringify(write)}`);
          return { readSeq: 4 };
        }),
    },
  });
  // SAFETY: the router dispatches on the kind alone; the rows under test are the only ones reached.
  const router = createActRouter(rows as ActRows);
  return { router, asked, noted };
}

it.effect(
  "a panel's Start reaches the host with the plan and the press's own key, and hears the agent",
  () =>
    Effect.gen(function* () {
      const { router, asked } = fixture();

      const outcome = yield* router.performAct(
        {
          kind: ACT_KIND.CODING_AGENTS_START,
          payload: { taskId: TASK_ID, idempotencyKey: "press-1" },
        },
        PANEL,
      );

      assert.deepEqual(outcome, { status: ACT_OUTCOME_STATUS.DONE, value: STARTED });
      assert.deepEqual(asked, [`start:${TASK_ID}:press-1`]);
    }),
);
it.effect(
  "a rename, an archive, or a pin answering an agent with no plan reads the plan list again, which lists it, and one on a plan does not",
  () =>
    Effect.gen(function* () {
      assert.ok("agent" in STARTED);
      const planless = fixture({ agent: { ...STARTED.agent, planId: null } });
      const onTask = fixture();
      const rename = {
        kind: ACT_KIND.CODING_AGENTS_RENAME,
        payload: { agentId: AGENT_ID, title: "Triage" },
      } as const;
      const archive = {
        kind: ACT_KIND.CODING_AGENTS_ARCHIVE,
        payload: { agentId: AGENT_ID, archived: true },
      } as const;

      const pin = {
        kind: ACT_KIND.CODING_AGENTS_PIN,
        payload: { agentId: AGENT_ID, pinned: true },
      } as const;

      yield* planless.router.performAct(rename, PANEL);
      yield* planless.router.performAct(archive, PANEL);
      yield* planless.router.performAct(pin, PANEL);
      yield* onTask.router.performAct(rename, PANEL);

      assert.deepEqual(planless.asked, [
        `rename:${AGENT_ID}:Triage`,
        "refresh",
        `archive:${AGENT_ID}:true`,
        "refresh",
        `pin:${AGENT_ID}:true`,
        "refresh",
      ]);
      assert.deepEqual(onTask.asked, [`rename:${AGENT_ID}:Triage`]);
    }),
);
it.effect(
  "the voice window is refused every coding-agent act in the kind's own words, and the host is not asked",
  () =>
    Effect.gen(function* () {
      const { router, asked } = fixture();

      const refused = yield* router.performAct(
        { kind: ACT_KIND.CODING_AGENTS_STOP, payload: { agentId: AGENT_ID } },
        VOICE,
      );
      const models = yield* router.performAct({ kind: ACT_KIND.CODING_AGENTS_MODELS }, VOICE);

      assert.deepEqual(refused, {
        status: ACT_OUTCOME_STATUS.REFUSED,
        reason: ACT[ACT_KIND.CODING_AGENTS_STOP].refusal,
      });
      assert.deepEqual(models, {
        status: ACT_OUTCOME_STATUS.REFUSED,
        reason: ACT[ACT_KIND.CODING_AGENTS_MODELS].refusal,
      });
      assert.deepEqual(asked, []);
    }),
);
it.effect(
  "a panel's provider key reaches the host once, and the voice window can neither read, save, nor remove one",
  () =>
    Effect.gen(function* () {
      const { router, asked } = fixture();
      const save = {
        kind: ACT_KIND.PROVIDER_KEYS_SAVE,
        payload: { provider: PROVIDER_KEY_PROVIDER.OPENAI, key: PROVIDER_KEY },
      } as const;
      const remove = {
        kind: ACT_KIND.PROVIDER_KEYS_REMOVE,
        payload: { provider: PROVIDER_KEY_PROVIDER.OPENAI },
      } as const;

      const saved = yield* router.performAct(save, PANEL);
      yield* router.performAct({ kind: ACT_KIND.PROVIDER_KEYS_READ }, PANEL);
      yield* router.performAct(remove, PANEL);
      const refused = [
        yield* router.performAct(save, VOICE),
        yield* router.performAct({ kind: ACT_KIND.PROVIDER_KEYS_READ }, VOICE),
        yield* router.performAct(remove, VOICE),
      ];

      assert.deepEqual(saved, { status: ACT_OUTCOME_STATUS.DONE, value: { keys: [] } });
      assert.deepEqual(asked, [
        `save:${PROVIDER_KEY_PROVIDER.OPENAI}:the key`,
        "keys",
        `remove:${PROVIDER_KEY_PROVIDER.OPENAI}`,
      ]);
      assert.deepEqual(
        refused.map((outcome) => outcome.status),
        [ACT_OUTCOME_STATUS.REFUSED, ACT_OUTCOME_STATUS.REFUSED, ACT_OUTCOME_STATUS.REFUSED],
      );
      assert.ok(!JSON.stringify(refused).includes(PROVIDER_KEY));
    }),
);

it.effect(
  "a panel's ask for a workspace's agents reaches the host as asked, and the voice window's is refused before it",
  () =>
    Effect.gen(function* () {
      const { router, asked } = fixture();
      const act = {
        kind: ACT_KIND.CODING_AGENTS_WORKSPACE_LIST,
        payload: { workspaceId: "workspace-1" },
      } as const;

      const refused = yield* router.performAct(act, VOICE);
      const listed = yield* router.performAct(act, PANEL);

      assert.deepEqual(refused, {
        status: ACT_OUTCOME_STATUS.REFUSED,
        reason: ACT[ACT_KIND.CODING_AGENTS_WORKSPACE_LIST].refusal,
      });
      assert.deepEqual(listed, { status: ACT_OUTCOME_STATUS.DONE, value: { agents: [] } });
      assert.deepEqual(asked, ["workspace agents workspace-1"]);
    }),
);

it.effect(
  "a panel's change to an agent's pull request reaches the host as asked and hears how GitHub took it, and the voice window's is refused before it",
  () =>
    Effect.gen(function* () {
      const { router, asked } = fixture();
      const act = {
        kind: ACT_KIND.CODING_AGENTS_PULL_REQUEST_ACTION,
        payload: { agentId: AGENT_ID, request: { action: PULL_REQUEST_ACTION.CONVERT_TO_DRAFT } },
      } as const;

      const refused = yield* router.performAct(act, VOICE);
      const changed = yield* router.performAct(act, PANEL);

      assert.deepEqual(refused, {
        status: ACT_OUTCOME_STATUS.REFUSED,
        reason: ACT[ACT_KIND.CODING_AGENTS_PULL_REQUEST_ACTION].refusal,
      });
      assert.deepEqual(changed, {
        status: ACT_OUTCOME_STATUS.DONE,
        value: { outcome: PULL_REQUEST_WRITE_OUTCOME.DONE },
      });
      assert.deepEqual(asked, [
        `pull-request-action:${AGENT_ID}:${PULL_REQUEST_ACTION.CONVERT_TO_DRAFT}`,
      ]);
    }),
);

it.effect(
  "a panel's message on an inbox item's thread reaches the host with its words, files, and key, and hears the item; the voice window's is refused before it",
  () =>
    Effect.gen(function* () {
      const { router, asked } = fixture();
      const message = {
        kind: ACT_KIND.CODING_AGENTS_INBOX_MESSAGE,
        payload: {
          itemId: ITEM.id,
          text: "Also page on-call.",
          attachments: [{ name: "pager.txt", mediaType: "text/plain", data: "b24tY2FsbA==" }],
          clientKey: "message-1",
        },
      } as const;

      const refused = yield* router.performAct(message, VOICE);
      const sent = yield* router.performAct(message, PANEL);

      assert.deepEqual(refused, {
        status: ACT_OUTCOME_STATUS.REFUSED,
        reason: ACT[ACT_KIND.CODING_AGENTS_INBOX_MESSAGE].refusal,
      });
      assert.deepEqual(sent, { status: ACT_OUTCOME_STATUS.DONE, value: { item: ITEM } });
      assert.deepEqual(asked, [`message:${ITEM.id}:Also page on-call.:pager.txt:message-1`]);
    }),
);

it.effect(
  "a panel's read of an agent's or a worker's picture reaches the host as asked, and the voice window's is refused before it",
  () =>
    Effect.gen(function* () {
      const { router, asked } = fixture();
      const pictureId = "4fb17055-c16e-4293-bea5-7a8b9cadbec5";
      const read = (callId?: string) =>
        ({
          kind: ACT_KIND.CODING_AGENTS_PICTURE,
          payload: {
            agentId: AGENT_ID,
            pictureId,
            ...(callId === undefined ? undefined : { callId }),
          },
        }) as const;

      const agents = yield* router.performAct(read(), PANEL);
      const workers = yield* router.performAct(read("call-worker"), PANEL);
      const refused = yield* router.performAct(read(), VOICE);

      const picture = { contentType: INBOX_IMAGE_TYPE.PNG, base64: "iVBORw0KGgo=" };
      assert.deepEqual(agents, { status: ACT_OUTCOME_STATUS.DONE, value: picture });
      assert.deepEqual(workers, { status: ACT_OUTCOME_STATUS.DONE, value: picture });
      assert.deepEqual(refused, {
        status: ACT_OUTCOME_STATUS.REFUSED,
        reason: ACT[ACT_KIND.CODING_AGENTS_PICTURE].refusal,
      });
      assert.deepEqual(asked, [
        `picture:${AGENT_ID}:${pictureId}:`,
        `picture:${AGENT_ID}:${pictureId}:call-worker`,
      ]);
    }),
);

it.effect(
  "a panel's chat read and write reach the host with the workspace, the cursor, and the write as sent, and hear the answer; the voice window is refused both and the host is not asked",
  () =>
    Effect.gen(function* () {
      const { router, asked } = fixture();
      const read = {
        kind: ACT_KIND.CODING_AGENTS_CHAT,
        payload: { workspaceId: WORKSPACE_ID, after: CHAT_CURSOR_START },
      } as const;
      const write = {
        kind: ACT_KIND.CODING_AGENTS_CHAT_POST,
        payload: {
          workspaceId: WORKSPACE_ID,
          write: { text: "Morning, @agent-2.", to: "#general", clientKey: "send-1" },
        },
      } as const;

      const refused = [
        yield* router.performAct(read, VOICE),
        yield* router.performAct(write, VOICE),
      ];
      const chat = yield* router.performAct(read, PANEL);
      const wrote = yield* router.performAct(write, PANEL);
      const malformed = yield* router.performAct(
        {
          kind: ACT_KIND.CODING_AGENTS_CHAT_POST,
          payload: {
            workspaceId: WORKSPACE_ID,
            write: { text: "Two places.", to: "#general", replyTo: 4, clientKey: "send-2" },
          },
        },
        PANEL,
      );

      assert.deepEqual(
        refused.map((outcome) => outcome.status),
        [ACT_OUTCOME_STATUS.REFUSED, ACT_OUTCOME_STATUS.REFUSED],
      );
      assert.deepEqual(chat, { status: ACT_OUTCOME_STATUS.DONE, value: CHAT });
      assert.deepEqual(wrote, { status: ACT_OUTCOME_STATUS.DONE, value: { readSeq: 4 } });
      assert.notEqual(malformed.status, ACT_OUTCOME_STATUS.DONE);
      assert.deepEqual(asked, [
        `chat:${WORKSPACE_ID}:${CHAT_CURSOR_START}`,
        `chat-post:${WORKSPACE_ID}:${JSON.stringify(write.payload.write)}`,
      ]);
    }),
);
