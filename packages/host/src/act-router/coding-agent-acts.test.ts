import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { CHAT_CURSOR_START, MEMBER_KIND } from "@luke/features/chat-wire";
import { CODING_AGENT_CALL_FAILURE } from "@luke/features/coding-agent-view";
import { CHECK_SUMMARY, PULL_REQUEST_STATE } from "@luke/features/coding-agent-wire";
import {
  INBOX_IMAGE_TYPE,
  INBOX_RESPONSE,
  INBOX_STATUS,
  INBOX_WIRE_VERSION,
  type InboxItem,
} from "@luke/features/inbox-wire";
import {
  FILE_VIEWED_STATE,
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

function fixture() {
  const asked: string[] = [];
  /** What the notices were told, in order. */
  const noted: string[] = [];
  const rows = codingAgentActRows({
    notices: {
      observePublished: (agentId, pullRequest) => {
        noted.push(`published:${agentId}=${pullRequest?.number ?? "none"}`);
      },
    },
    host: {
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
      codingAgentReviewOptions: ({ agentId }) =>
        Effect.sync(() => {
          asked.push(`review-options:${agentId}`);
          return { labels: [], users: [], teams: [] };
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
      codingAgentPullRequestViewed: ({ agentId }) =>
        Effect.sync(() => {
          asked.push(`pull-request-viewed:${agentId}`);
          return {
            outcome: PULL_REQUEST_WRITE_OUTCOME.DONE,
            files: [{ path: "src/seats.ts", state: FILE_VIEWED_STATE.VIEWED }],
          } as const;
        }),
      codingAgentGitHubImage: ({ agentId }) =>
        Effect.sync(() => {
          asked.push(`github-image:${agentId}`);
          return { failure: CODING_AGENT_CALL_FAILURE.NOT_FOUND } as const;
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
      codingAgentInboxReadState: ({ itemId, unread }) =>
        Effect.sync(() => {
          asked.push(`read-state:${itemId}:${unread}`);
          return { id: itemId, unread };
        }),
      codingAgentInboxReadAll: ({ workspaceId }) =>
        Effect.sync(() => {
          asked.push(`read-all:${workspaceId ?? "every workspace"}`);
          return { marked: 3 };
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
      codingAgentChatAttachment: ({ workspaceId, messageId, attachmentId }) =>
        Effect.sync(() => {
          asked.push(`chat-attachment:${workspaceId}:${messageId}:${attachmentId}`);
          return { contentType: INBOX_IMAGE_TYPE.PNG, base64: "iVBORw0KGgo=" };
        }),
    },
  });
  // SAFETY: the router dispatches on the kind alone; the rows under test are the only ones reached.
  const router = createActRouter(rows as ActRows);
  return { router, asked, noted };
}

it.effect(
  "the voice window is refused every coding-agent act in the kind's own words, and the host is not asked",
  () =>
    Effect.gen(function* () {
      const { router, asked } = fixture();

      const refused = yield* router.performAct(
        { kind: ACT_KIND.CODING_AGENTS_CHANGES, payload: { agentId: AGENT_ID } },
        VOICE,
      );
      const inbox = yield* router.performAct(
        { kind: ACT_KIND.CODING_AGENTS_INBOX, payload: { taskId: TASK_ID, after: "0" } },
        VOICE,
      );

      assert.deepEqual(refused, {
        status: ACT_OUTCOME_STATUS.REFUSED,
        reason: ACT[ACT_KIND.CODING_AGENTS_CHANGES].refusal,
      });
      assert.deepEqual(inbox, {
        status: ACT_OUTCOME_STATUS.REFUSED,
        reason: ACT[ACT_KIND.CODING_AGENTS_INBOX].refusal,
      });
      assert.deepEqual(asked, []);
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
  "a panel's read of which files it viewed reaches the host and hears each file's mark, and the voice window's is refused before it",
  () =>
    Effect.gen(function* () {
      const { router, asked } = fixture();
      const act = {
        kind: ACT_KIND.CODING_AGENTS_PULL_REQUEST_VIEWED,
        payload: { agentId: AGENT_ID },
      } as const;

      const refused = yield* router.performAct(act, VOICE);
      const read = yield* router.performAct(act, PANEL);

      assert.deepEqual(refused, {
        status: ACT_OUTCOME_STATUS.REFUSED,
        reason: ACT[ACT_KIND.CODING_AGENTS_PULL_REQUEST_VIEWED].refusal,
      });
      assert.deepEqual(read, {
        status: ACT_OUTCOME_STATUS.DONE,
        value: {
          outcome: PULL_REQUEST_WRITE_OUTCOME.DONE,
          files: [{ path: "src/seats.ts", state: FILE_VIEWED_STATE.VIEWED }],
        },
      });
      assert.deepEqual(asked, [`pull-request-viewed:${AGENT_ID}`]);
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

it.effect(
  "a panel's read of a chat message's picture reaches the host with the workspace, the message, and the attachment, and the voice window's is refused before it",
  () =>
    Effect.gen(function* () {
      const { router, asked } = fixture();
      const read = {
        kind: ACT_KIND.CODING_AGENTS_CHAT_ATTACHMENT,
        payload: { workspaceId: WORKSPACE_ID, messageId: "message-1", attachmentId: "picture-1" },
      } as const;

      const refused = yield* router.performAct(read, VOICE);
      const picture = yield* router.performAct(read, PANEL);

      assert.deepEqual(refused, {
        status: ACT_OUTCOME_STATUS.REFUSED,
        reason: ACT[ACT_KIND.CODING_AGENTS_CHAT_ATTACHMENT].refusal,
      });
      assert.deepEqual(picture, {
        status: ACT_OUTCOME_STATUS.DONE,
        value: { contentType: INBOX_IMAGE_TYPE.PNG, base64: "iVBORw0KGgo=" },
      });
      assert.deepEqual(asked, [`chat-attachment:${WORKSPACE_ID}:message-1:picture-1`]);
    }),
);

it.effect(
  "a panel marks an inbox item read or unread, or its whole Inbox read in one workspace or all, and hears the read state; the voice window's is refused before it",
  () =>
    Effect.gen(function* () {
      const { router, asked } = fixture();
      const unread = {
        kind: ACT_KIND.CODING_AGENTS_INBOX_READ_STATE,
        payload: { itemId: ITEM.id, unread: true },
      } as const;

      const refused = yield* router.performAct(unread, VOICE);
      const marked = yield* router.performAct(unread, PANEL);
      const read = yield* router.performAct(
        {
          kind: ACT_KIND.CODING_AGENTS_INBOX_READ_STATE,
          payload: { itemId: ITEM.id, unread: false },
        },
        PANEL,
      );
      const all = yield* router.performAct(
        { kind: ACT_KIND.CODING_AGENTS_INBOX_READ_ALL, payload: { workspaceId: "workspace-1" } },
        PANEL,
      );
      const everywhere = yield* router.performAct(
        { kind: ACT_KIND.CODING_AGENTS_INBOX_READ_ALL, payload: {} },
        PANEL,
      );

      assert.deepEqual(refused, {
        status: ACT_OUTCOME_STATUS.REFUSED,
        reason: ACT[ACT_KIND.CODING_AGENTS_INBOX_READ_STATE].refusal,
      });
      assert.deepEqual(marked, {
        status: ACT_OUTCOME_STATUS.DONE,
        value: { id: ITEM.id, unread: true },
      });
      assert.deepEqual(read, {
        status: ACT_OUTCOME_STATUS.DONE,
        value: { id: ITEM.id, unread: false },
      });
      assert.deepEqual(all, { status: ACT_OUTCOME_STATUS.DONE, value: { marked: 3 } });
      assert.deepEqual(everywhere, { status: ACT_OUTCOME_STATUS.DONE, value: { marked: 3 } });
      assert.deepEqual(asked, [
        `read-state:${ITEM.id}:true`,
        `read-state:${ITEM.id}:false`,
        "read-all:workspace-1",
        "read-all:every workspace",
      ]);
    }),
);
