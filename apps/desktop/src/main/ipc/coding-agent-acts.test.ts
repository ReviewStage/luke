import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentAgentAnswer,
} from "@sidecar/hosted/coding-agent-view";
import {
  CHECK_SUMMARY,
  CODING_AGENT_STATUS,
  PULL_REQUEST_STATE,
} from "@sidecar/hosted/coding-agent-wire";
import {
  INBOX_IMAGE_TYPE,
  INBOX_REPLY,
  INBOX_RESPONSE,
  INBOX_STATUS,
  INBOX_WIRE_VERSION,
  type InboxItem,
} from "@sidecar/hosted/inbox-wire";
import {
  DEFAULT_PLAN_TEMPLATE,
  PLAN_TEMPLATE_BOUNDS,
} from "@sidecar/hosted/plan-document-template";
import { PROVIDER_KEY_PROVIDER } from "@sidecar/hosted/provider-key-wire";
import { Effect } from "effect";
import type { WebContents } from "electron";
import { ACT, ACT_KIND, ACT_OUTCOME_STATUS } from "#shared/messages/acts";
import { type ActRows, type ActSender, createActRouter } from "../act-router";
import { codingAgentActRows } from "./coding-agent-acts";

// SAFETY: the router reads the sender by identity alone; one inert object is one window.
const SENDER = {} as WebContents;

const PANEL: ActSender = { sender: SENDER, panel: true, voice: false, call: false };
const VOICE: ActSender = { ...PANEL, panel: false, voice: true };

/** A synthetic provider key, as Settings carries it once. */
const PROVIDER_KEY = "sk-proj-synthetic-00000000000000000000abcd";

const PLAN_ID = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
const AGENT_ID = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";

const STARTED: CodingAgentAgentAnswer = {
  agent: {
    id: AGENT_ID,
    planId: PLAN_ID,
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    title: null,
    createdAt: 1_800_000_000_000,
    status: CODING_AGENT_STATUS.STARTING,
    turnId: null,
  },
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

function fixture() {
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
      observePlanGone: (planId) => {
        noted.push(`gone:${planId}`);
      },
      shown: (agentId) => {
        noted.push(`shown:${agentId}`);
      },
      shownInbox: (planId) => {
        noted.push(`inbox:${planId}`);
      },
    },
    host: {
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
      codingAgentList: ({ planId, includeArchived }) =>
        Effect.sync(() => {
          asked.push(includeArchived === true ? `list:${planId}:archived` : `list:${planId}`);
          return { agents: [] };
        }),
      codingAgentStart: (params) =>
        Effect.sync(() => {
          asked.push(`start:${params.planId}:${params.idempotencyKey}`);
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
          return STARTED;
        }),
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
      codingAgentInbox: ({ planId, after }) =>
        Effect.sync(() => {
          asked.push(`inbox:${planId}:${after}`);
          return { items: [ITEM], cursor: "7" };
        }),
      codingAgentInboxAnswer: ({ itemId, revision, reply, clientKey }) =>
        Effect.sync(() => {
          asked.push(`answer:${itemId}:${revision}:${reply}:${clientKey}`);
          return { item: { ...ITEM, status: INBOX_STATUS.ANSWERED }, taken: true };
        }),
      codingAgentInboxAttachment: ({ itemId, attachmentId }) =>
        Effect.sync(() => {
          asked.push(`attachment:${itemId}:${attachmentId}`);
          return { contentType: INBOX_IMAGE_TYPE.PNG, base64: "iVBORw0KGgo=" };
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
          payload: { planId: PLAN_ID, idempotencyKey: "press-1" },
        },
        PANEL,
      );

      assert.deepEqual(outcome, { status: ACT_OUTCOME_STATUS.DONE, value: STARTED });
      assert.deepEqual(asked, [`start:${PLAN_ID}:press-1`]);
    }),
);

it.effect(
  "a panel's list asks for the archived agents only where it names them, and an archive carries the agent and which way it goes, hearing the agent back",
  () =>
    Effect.gen(function* () {
      const { router, asked } = fixture();

      yield* router.performAct(
        { kind: ACT_KIND.CODING_AGENTS_LIST, payload: { planId: PLAN_ID, includeArchived: true } },
        PANEL,
      );
      const outcome = yield* router.performAct(
        { kind: ACT_KIND.CODING_AGENTS_ARCHIVE, payload: { agentId: AGENT_ID, archived: true } },
        PANEL,
      );

      assert.deepEqual(outcome, { status: ACT_OUTCOME_STATUS.DONE, value: STARTED });
      assert.deepEqual(asked, [`list:${PLAN_ID}:archived`, `archive:${AGENT_ID}:true`]);
    }),
);

it.effect(
  "a transcript read carries the agent and the cursor the panel stands at, and a worker's read the call that started it, whose page is no word on where the agent stands",
  () =>
    Effect.gen(function* () {
      const { router, asked, noted } = fixture();

      const outcome = yield* router.performAct(
        { kind: ACT_KIND.CODING_AGENTS_MESSAGES, payload: { agentId: AGENT_ID, after: "3:2" } },
        PANEL,
      );
      yield* router.performAct(
        {
          kind: ACT_KIND.CODING_AGENTS_MESSAGES,
          payload: { agentId: AGENT_ID, after: "0:0", callId: "call-7" },
        },
        PANEL,
      );

      assert.deepEqual(outcome, {
        status: ACT_OUTCOME_STATUS.DONE,
        value: { messages: [], cursor: "3:2", status: CODING_AGENT_STATUS.RUNNING, title: null },
      });
      assert.deepEqual(asked, [`messages:${AGENT_ID}:3:2`, `worker:${AGENT_ID}:call-7:0:0`]);
      assert.deepEqual(noted, [
        `title:${AGENT_ID}=null`,
        `status:${AGENT_ID}=${CODING_AGENT_STATUS.RUNNING}`,
      ]);
    }),
);

it.effect(
  "a message carries the agent, the words, and the send's key, and hears the agent back",
  () =>
    Effect.gen(function* () {
      const { router, asked, noted } = fixture();

      const outcome = yield* router.performAct(
        {
          kind: ACT_KIND.CODING_AGENTS_MESSAGE,
          payload: {
            agentId: AGENT_ID,
            text: "Also expire them after a week.",
            clientKey: "send-1",
          },
        },
        PANEL,
      );

      assert.deepEqual(outcome, { status: ACT_OUTCOME_STATUS.DONE, value: STARTED });
      assert.deepEqual(asked, [`message:${AGENT_ID}:send-1:Also expire them after a week.`]);
      // The answer is noted as a message's, so the ledger watches for the turn it opens.
      assert.deepEqual(noted, [`messaged:${AGENT_ID}=${STARTED.agent.status}`]);
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
  "what an agent published is noted on its way to the panel, so the sidebar's rows can be read again",
  () =>
    Effect.gen(function* () {
      const { router, noted } = fixture();

      yield* router.performAct(
        { kind: ACT_KIND.CODING_AGENTS_PULL_REQUEST, payload: { agentId: AGENT_ID } },
        PANEL,
      );

      assert.deepEqual(noted, [`published:${AGENT_ID}=41`]);
    }),
);

it.effect(
  "an agent's changes reach the panel as the host answered them, and the voice window is refused them",
  () =>
    Effect.gen(function* () {
      const { router, asked } = fixture();
      const act = { kind: ACT_KIND.CODING_AGENTS_CHANGES, payload: { agentId: AGENT_ID } } as const;

      const refused = yield* router.performAct(act, VOICE);
      const answered = yield* router.performAct(act, PANEL);

      assert.deepEqual(refused, {
        status: ACT_OUTCOME_STATUS.REFUSED,
        reason: ACT[ACT_KIND.CODING_AGENTS_CHANGES].refusal,
      });
      assert.deepEqual(answered, {
        status: ACT_OUTCOME_STATUS.DONE,
        value: { pullRequest: null },
      });
      assert.deepEqual(asked, [`changes:${AGENT_ID}`]);
    }),
);

it.effect("a Start naming a model without its effort is refused at the boundary", () =>
  Effect.gen(function* () {
    const { router, asked } = fixture();

    const outcome = yield* router.performAct(
      {
        kind: ACT_KIND.CODING_AGENTS_START,
        // SAFETY: the test sends a payload the act's own schema admits by key but the service refuses as half a choice; the router reads it again before the row runs.
        payload: { planId: PLAN_ID, idempotencyKey: "press-1", model: "openai/gpt-6.1-sol" },
      },
      PANEL,
    );

    // The schema admits either key alone; the service refuses the half, so the row still runs.
    assert.equal(outcome.status, ACT_OUTCOME_STATUS.DONE);
    assert.deepEqual(asked, [`start:${PLAN_ID}:press-1`]);
  }),
);

it.effect(
  "every answer's agents are noted on their way to the panel, and the panel's shown agent reaches the notices",
  () =>
    Effect.gen(function* () {
      const { router, noted } = fixture();

      yield* router.performAct(
        { kind: ACT_KIND.CODING_AGENTS_START, payload: { planId: PLAN_ID, idempotencyKey: "k" } },
        PANEL,
      );
      yield* router.performAct(
        { kind: ACT_KIND.CODING_AGENTS_MESSAGES, payload: { agentId: AGENT_ID, after: "0:0" } },
        PANEL,
      );
      yield* router.performAct(
        { kind: ACT_KIND.CODING_AGENTS_LIST, payload: { planId: PLAN_ID } },
        PANEL,
      );
      yield* router.performAct(
        { kind: ACT_KIND.CODING_AGENTS_SHOWN, payload: { agentId: AGENT_ID, inboxPlanId: null } },
        PANEL,
      );
      yield* router.performAct(
        { kind: ACT_KIND.CODING_AGENTS_SHOWN, payload: { agentId: null, inboxPlanId: PLAN_ID } },
        PANEL,
      );
      const refused = yield* router.performAct(
        { kind: ACT_KIND.CODING_AGENTS_SHOWN, payload: { agentId: AGENT_ID, inboxPlanId: null } },
        VOICE,
      );

      assert.deepEqual(noted, [
        `agents:${AGENT_ID}=${CODING_AGENT_STATUS.STARTING}`,
        `title:${AGENT_ID}=null`,
        `status:${AGENT_ID}=${CODING_AGENT_STATUS.RUNNING}`,
        "agents:",
        `shown:${AGENT_ID}`,
        "inbox:null",
        "shown:null",
        `inbox:${PLAN_ID}`,
      ]);
      assert.equal(refused.status, ACT_OUTCOME_STATUS.REFUSED);
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
  "a panel reads the plan template's history and restores a revision through the host; the voice window cannot, and a revision with no number reaches nothing",
  () =>
    Effect.gen(function* () {
      const { router, asked } = fixture();
      const page = { kind: ACT_KIND.PLAN_TEMPLATE_REVISIONS, payload: { before: 3 } } as const;
      const revision = { kind: ACT_KIND.PLAN_TEMPLATE_REVISION, payload: { seq: 2 } } as const;
      const restore = { kind: ACT_KIND.PLAN_TEMPLATE_RESTORE, payload: { seq: 2 } } as const;

      const paged = yield* router.performAct(page, PANEL);
      const read = yield* router.performAct(revision, PANEL);
      const restored = yield* router.performAct(restore, PANEL);
      const refused = [
        yield* router.performAct(page, VOICE),
        yield* router.performAct(revision, VOICE),
        yield* router.performAct(restore, VOICE),
        yield* router.performAct(
          { kind: ACT_KIND.PLAN_TEMPLATE_RESTORE, payload: { seq: 0 } },
          PANEL,
        ),
      ];

      assert.deepEqual(paged, { status: ACT_OUTCOME_STATUS.DONE, value: { revisions: [] } });
      assert.deepEqual(read, {
        status: ACT_OUTCOME_STATUS.DONE,
        value: {
          revision: { seq: 2, document: { body: "## Why\n", assumptions: [] }, previous: null },
        },
      });
      assert.deepEqual(restored, {
        status: ACT_OUTCOME_STATUS.DONE,
        value: { template: "## Why\n", custom: true },
      });
      assert.deepEqual(asked, ["revisions:3", "revision:2", "restore:2"]);
      assert.deepEqual(
        refused.map((outcome) => outcome.status),
        [
          ACT_OUTCOME_STATUS.REFUSED,
          ACT_OUTCOME_STATUS.REFUSED,
          ACT_OUTCOME_STATUS.REFUSED,
          ACT_OUTCOME_STATUS.REFUSED,
        ],
      );
    }),
);

it.effect(
  "a panel reads, keeps, and resets the plan template through the host; the voice window cannot, and a template past the bound reaches nothing",
  () =>
    Effect.gen(function* () {
      const { router, asked } = fixture();
      const read = { kind: ACT_KIND.PLAN_TEMPLATE_READ } as const;
      const keep = {
        kind: ACT_KIND.PLAN_TEMPLATE_WRITE,
        payload: { template: "## Why\n" },
      } as const;
      const reset = { kind: ACT_KIND.PLAN_TEMPLATE_WRITE, payload: { template: null } } as const;

      const answered = yield* router.performAct(read, PANEL);
      const kept = yield* router.performAct(keep, PANEL);
      yield* router.performAct(reset, PANEL);
      const refused = [
        yield* router.performAct(read, VOICE),
        yield* router.performAct(keep, VOICE),
        yield* router.performAct(
          {
            kind: ACT_KIND.PLAN_TEMPLATE_WRITE,
            payload: { template: "x".repeat(PLAN_TEMPLATE_BOUNDS.MAX_CHARS + 1) },
          },
          PANEL,
        ),
      ];

      assert.deepEqual(answered, {
        status: ACT_OUTCOME_STATUS.DONE,
        value: { template: DEFAULT_PLAN_TEMPLATE, custom: false },
      });
      assert.deepEqual(kept, {
        status: ACT_OUTCOME_STATUS.DONE,
        value: { template: "## Why\n", custom: true },
      });
      assert.deepEqual(asked, ["template", "template:## Why\n", "template:the default"]);
      assert.deepEqual(
        refused.map((outcome) => outcome.status),
        [ACT_OUTCOME_STATUS.REFUSED, ACT_OUTCOME_STATUS.REFUSED, ACT_OUTCOME_STATUS.REFUSED],
      );
    }),
);

it.effect(
  "a panel's dictated clip reaches the host once, and the voice window cannot send one",
  () =>
    Effect.gen(function* () {
      const { router, asked } = fixture();
      const clip = {
        kind: ACT_KIND.DICTATION_TRANSCRIBE,
        payload: { audio: "GkXfow==", durationMs: 1_500, keywords: ["luke"] },
      } as const;

      const heard = yield* router.performAct(clip, PANEL);
      const refused = yield* router.performAct(clip, VOICE);

      assert.deepEqual(heard, {
        status: ACT_OUTCOME_STATUS.DONE,
        value: { text: "Run the tests" },
      });
      assert.equal(refused.status, ACT_OUTCOME_STATUS.REFUSED);
      assert.deepEqual(asked, ["transcribe:GkXfow==:luke"]);
    }),
);

it.effect(
  "a panel's inbox read carries the plan and its cursor, an image read the item and its attachment, and an answer the item, its revision, and the answer's key; the voice window is refused each",
  () =>
    Effect.gen(function* () {
      const { router, asked, noted } = fixture();

      const read = yield* router.performAct(
        { kind: ACT_KIND.CODING_AGENTS_INBOX, payload: { planId: PLAN_ID, after: "0" } },
        PANEL,
      );
      const answered = yield* router.performAct(
        {
          kind: ACT_KIND.CODING_AGENTS_INBOX_ANSWER,
          payload: {
            itemId: ITEM.id,
            revision: 2,
            reply: INBOX_REPLY.APPROVED,
            clientKey: "answer-1",
          },
        },
        PANEL,
      );
      const image = yield* router.performAct(
        {
          kind: ACT_KIND.CODING_AGENTS_INBOX_ATTACHMENT,
          payload: { itemId: ITEM.id, attachmentId: ATTACHMENT_ID },
        },
        PANEL,
      );
      const refused = yield* router.performAct(
        { kind: ACT_KIND.CODING_AGENTS_INBOX, payload: { planId: PLAN_ID, after: "0" } },
        VOICE,
      );
      const imageRefused = yield* router.performAct(
        {
          kind: ACT_KIND.CODING_AGENTS_INBOX_ATTACHMENT,
          payload: { itemId: ITEM.id, attachmentId: ATTACHMENT_ID },
        },
        VOICE,
      );

      assert.deepEqual(read, {
        status: ACT_OUTCOME_STATUS.DONE,
        value: { items: [ITEM], cursor: "7" },
      });
      assert.deepEqual(answered, {
        status: ACT_OUTCOME_STATUS.DONE,
        value: { item: { ...ITEM, status: INBOX_STATUS.ANSWERED }, taken: true },
      });
      assert.deepEqual(image, {
        status: ACT_OUTCOME_STATUS.DONE,
        value: { contentType: INBOX_IMAGE_TYPE.PNG, base64: "iVBORw0KGgo=" },
      });
      assert.deepEqual(refused, {
        status: ACT_OUTCOME_STATUS.REFUSED,
        reason: ACT[ACT_KIND.CODING_AGENTS_INBOX].refusal,
      });
      assert.deepEqual(imageRefused, {
        status: ACT_OUTCOME_STATUS.REFUSED,
        reason: ACT[ACT_KIND.CODING_AGENTS_INBOX_ATTACHMENT].refusal,
      });
      assert.deepEqual(asked, [
        `inbox:${PLAN_ID}:0`,
        `answer:${ITEM.id}:2:${INBOX_REPLY.APPROVED}:answer-1`,
        `attachment:${ITEM.id}:${ATTACHMENT_ID}`,
      ]);
      assert.deepEqual(noted, []);
    }),
);
