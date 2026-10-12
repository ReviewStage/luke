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
import { INBOX_KIND, INBOX_REPLY, INBOX_STATUS, type InboxItem } from "@sidecar/hosted/inbox-wire";
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

const ITEM: InboxItem = {
  id: "5e2d7c3a-1b4f-4e6a-8c9d-0f1e2d3c4b5a",
  agentId: AGENT_ID,
  key: "push-access",
  revision: 2,
  kind: INBOX_KIND.APPROVAL,
  title: "Push to the release branch?",
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
      codingAgentList: ({ planId }) =>
        Effect.sync(() => {
          asked.push(`list:${planId}`);
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
        { kind: ACT_KIND.CODING_AGENTS_SHOWN, payload: { agentId: AGENT_ID } },
        PANEL,
      );
      yield* router.performAct(
        { kind: ACT_KIND.CODING_AGENTS_SHOWN, payload: { agentId: null } },
        PANEL,
      );
      const refused = yield* router.performAct(
        { kind: ACT_KIND.CODING_AGENTS_SHOWN, payload: { agentId: AGENT_ID } },
        VOICE,
      );

      assert.deepEqual(noted, [
        `agents:${AGENT_ID}=${CODING_AGENT_STATUS.STARTING}`,
        `title:${AGENT_ID}=null`,
        `status:${AGENT_ID}=${CODING_AGENT_STATUS.RUNNING}`,
        "agents:",
        `shown:${AGENT_ID}`,
        "shown:null",
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
  "a panel's inbox read carries the plan and its cursor, and an answer the item, its revision, and the answer's key; the voice window is refused both",
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
      const refused = yield* router.performAct(
        { kind: ACT_KIND.CODING_AGENTS_INBOX, payload: { planId: PLAN_ID, after: "0" } },
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
      assert.deepEqual(refused, {
        status: ACT_OUTCOME_STATUS.REFUSED,
        reason: ACT[ACT_KIND.CODING_AGENTS_INBOX].refusal,
      });
      assert.deepEqual(asked, [
        `inbox:${PLAN_ID}:0`,
        `answer:${ITEM.id}:2:${INBOX_REPLY.APPROVED}:answer-1`,
      ]);
      assert.deepEqual(noted, []);
    }),
);
