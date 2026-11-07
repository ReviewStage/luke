/**
 * agents-procedures.test.ts -- the Tasks tab's agent acts, and what an agent published, through the act port.
 *
 * The Tasks tab's asks about a task's coding agents, through the act port
 * as a window calls them: only a panel asks each declared act, any other
 * window refused in the kind's own words before the host is asked or
 * anything noted, and a host without This Mac answers its set as
 * unanswered. An ask whose answer is noted
 * reaches its composer's handler with its payload as the panel sent it,
 * what the handler answers is noted on its way, and a handler that fails
 * or dies is drawn as the ask's unanswered failure, noted nowhere.
 */

import assert from "node:assert/strict";
import { afterEach, it } from "@effect/vitest";
import {
  AGENT_CALL_FAILURE,
  type AgentAgentAnswer,
  TRANSCRIPT_KIND,
} from "@repo/features/agent-view";
import { AGENT_CURSOR_START, AGENT_STATUS, QUEUE_CHANGE } from "@repo/features/agent-wire";
import { PULL_REQUEST_ACTION } from "@repo/features/pull-request-write-wire";
import { READ_MARK } from "@repo/features/read-mark";
import type { WireBoundaryInput } from "@repo/wire";
import { Effect } from "effect";
import { AGENT_ACT_KIND, AGENT_ACTS, type PortActKind } from "../contract/index.js";
import { hostActPort } from "../testing/host-act-port.js";
import { type AgentProceduresDependencies, agentProcedures } from "./agents-procedures.js";
import type { ActSender } from "./base.js";
import { type TestActPort, testActPort } from "./testing.js";

// The platform's handle on the window that asked, which no procedure here reads.
const SENDER = Symbol("window");

const PANEL: ActSender = { sender: SENDER, panel: true };
const OTHER_WINDOW: ActSender = { ...PANEL, panel: false };

const TASK_ID = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
const AGENT_ID = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";
const WORKSPACE_ID = "2a9c4e6f-1b3d-4f5a-8c7e-9d0b1a2c3e4f";
const HOST_ID = "5c2d3e4f-6a7b-4c8d-9e0f-1a2b3c4d5e6f";
const QUEUED_ID = "3d4e5f6a-7b8c-4d9e-8f0a-1b2c3d4e5f6a";
const PAIRING_CODE = "BCDF-GHJK";

const STARTED = {
  agent: {
    id: AGENT_ID,
    planId: TASK_ID,
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    title: null,
    createdAt: 1_800_000_000_000,
    status: AGENT_STATUS.STARTING,
    turnId: null,
  },
} satisfies AgentAgentAnswer;

const UNANSWERED = { failure: AGENT_CALL_FAILURE.UNANSWERED } as const;

/** Each kind's refusal, as the window drew it before the kinds were declared. */
const REFUSAL = {
  [AGENT_ACT_KIND.AGENTS_DEFAULT_WRITE]: "Could not change the default model on this system.",
  [AGENT_ACT_KIND.AGENTS_CHAPTERS_PROVIDER_WRITE]:
    "Could not change which key chapters run on on this system.",
  [AGENT_ACT_KIND.HOSTS_REMOVE]: "Could not remove the host on this system.",
  [AGENT_ACT_KIND.HOSTS_THIS_MAC_SET]: "Could not change this Mac on this system.",
  [AGENT_ACT_KIND.HOSTS_PAIRING_READ]: "Could not read the code on this system.",
  [AGENT_ACT_KIND.HOSTS_PAIRING_APPROVE]: "Could not connect the host on this system.",
  [AGENT_ACT_KIND.HOSTS_PAIRING_DENY]: "Could not deny the host on this system.",
  [AGENT_ACT_KIND.AGENTS_LIST]: "Could not read the task's agents on this system.",
  [AGENT_ACT_KIND.AGENTS_WORKSPACE_LIST]: "Could not read the workspace's agents on this system.",
  [AGENT_ACT_KIND.AGENTS_START]: "Could not start an agent on this system.",
  [AGENT_ACT_KIND.AGENTS_MESSAGES]: "Could not read the agent's transcript on this system.",
  [AGENT_ACT_KIND.AGENTS_PART]: "Could not read the agent's output on this system.",
  [AGENT_ACT_KIND.AGENTS_TRANSCRIPT_OLDER]:
    "Could not read the agent's earlier messages on this system.",
  [AGENT_ACT_KIND.AGENTS_MESSAGE]: "Could not message the agent on this system.",
  [AGENT_ACT_KIND.AGENTS_CHOOSE]: "Could not change the agent's model on this system.",
  [AGENT_ACT_KIND.AGENTS_RENAME]: "Could not rename the agent on this system.",
  [AGENT_ACT_KIND.AGENTS_SERVERS]: "Could not switch the agent's MCP servers on this system.",
  [AGENT_ACT_KIND.AGENTS_ADD_REPOSITORY]: "Could not add a repository to the agent on this system.",
  [AGENT_ACT_KIND.AGENTS_QUEUE]: "Could not change the agent's queue on this system.",
  [AGENT_ACT_KIND.AGENTS_STOP]: "Could not stop the agent on this system.",
  [AGENT_ACT_KIND.AGENTS_REWIND]: "Could not rewind the agent on this system.",
  [AGENT_ACT_KIND.AGENTS_WARM]: "Could not keep the agent warm on this system.",
  [AGENT_ACT_KIND.AGENTS_ARCHIVE]: "Could not archive the agent on this system.",
  [AGENT_ACT_KIND.AGENTS_PIN]: "Could not pin the agent on this system.",
  [AGENT_ACT_KIND.AGENTS_MARK_READ]: "Could not mark the agent on this system.",
  [AGENT_ACT_KIND.AGENTS_DELETE]: "Could not delete the agent on this system.",
  [AGENT_ACT_KIND.AGENTS_SHOWN]: "Could not note which agent is shown on this system.",
  [AGENT_ACT_KIND.AGENTS_PAGE]: "Could not read the agent on this system.",
  [AGENT_ACT_KIND.AGENTS_CHANGES]: "Could not read the agent's changes on this system.",
  [AGENT_ACT_KIND.AGENTS_GITHUB_IMAGE]: "Could not read the pull request's image on this system.",
  [AGENT_ACT_KIND.AGENTS_PULL_REQUEST_ACTION]: "Could not change the pull request on this system.",
  [AGENT_ACT_KIND.AGENTS_PREFERENCES_RETRY]:
    "Could not read your preferences again on this system.",
} as const;

/** A payload each declared act's schema takes, so a window refused it was refused for who it is alone. */
const PAYLOAD: { readonly [Name in keyof typeof AGENT_ACTS]: WireBoundaryInput } = {
  AGENTS_DEFAULT_WRITE: { model: "anthropic/claude-opus-5.5", effort: "high" },
  AGENTS_CHAPTERS_PROVIDER_WRITE: { provider: "openai" },
  AGENTS_PREFERENCES_RETRY: undefined,
  HOSTS_REMOVE: { id: HOST_ID },
  HOSTS_THIS_MAC_SET: { on: true },
  HOSTS_PAIRING_READ: { code: PAIRING_CODE },
  HOSTS_PAIRING_APPROVE: { code: PAIRING_CODE },
  HOSTS_PAIRING_DENY: { code: PAIRING_CODE },
  AGENTS_LIST: { taskId: TASK_ID },
  AGENTS_WORKSPACE_LIST: { workspaceId: WORKSPACE_ID },
  AGENTS_START: { taskId: TASK_ID, idempotencyKey: "press-1" },
  AGENTS_MESSAGES: { agentId: AGENT_ID, after: AGENT_CURSOR_START },
  AGENTS_PART: { agentId: AGENT_ID, messageId: "m-1", index: 0 },
  AGENTS_TRANSCRIPT_OLDER: { kind: TRANSCRIPT_KIND.AGENT, agentId: AGENT_ID, before: "40" },
  AGENTS_MESSAGE: { agentId: AGENT_ID, text: "Carry on.", clientKey: "send-1" },
  AGENTS_CHOOSE: { agentId: AGENT_ID, model: "anthropic/claude-opus-5.5", effort: "high" },
  AGENTS_RENAME: { agentId: AGENT_ID, title: "Sign-out button" },
  AGENTS_SERVERS: { agentId: AGENT_ID, disabledServers: ["linear"] },
  AGENTS_ADD_REPOSITORY: { agentId: AGENT_ID, addRepository: { repository: "acme/app" } },
  AGENTS_QUEUE: {
    agentId: AGENT_ID,
    change: { change: QUEUE_CHANGE.DELETE, messageId: QUEUED_ID },
  },
  AGENTS_STOP: { agentId: AGENT_ID },
  AGENTS_REWIND: { agentId: AGENT_ID, messageId: "m-1" },
  AGENTS_WARM: { agentId: AGENT_ID },
  AGENTS_ARCHIVE: { agentId: AGENT_ID, archived: true },
  AGENTS_PIN: { agentId: AGENT_ID, pinned: true },
  AGENTS_MARK_READ: { agentId: AGENT_ID, readMark: READ_MARK.READ },
  AGENTS_DELETE: { agentId: AGENT_ID },
  AGENTS_PAGE: { agentId: AGENT_ID },
  AGENTS_CHANGES: { agentId: AGENT_ID },
  AGENTS_GITHUB_IMAGE: {
    agentId: AGENT_ID,
    src: "https://github.com/user-attachments/assets/0f1e2d3c",
  },
  AGENTS_PULL_REQUEST_ACTION: {
    agentId: AGENT_ID,
    number: 41,
    request: { action: PULL_REQUEST_ACTION.CONVERT_TO_DRAFT },
  },
};

type NotedActs = AgentProceduresDependencies["acts"];

/** The acts answered here, so their answer is noted on its way. */
const NOTED_ACTS = [
  "AGENTS_LIST",
  "AGENTS_START",
  "AGENTS_MESSAGES",
  "AGENTS_MESSAGE",
  "AGENTS_CHOOSE",
  "AGENTS_RENAME",
  "AGENTS_SERVERS",
  "AGENTS_ADD_REPOSITORY",
  "AGENTS_STOP",
  "AGENTS_REWIND",
  "AGENTS_ARCHIVE",
  "AGENTS_PIN",
  "AGENTS_MARK_READ",
] as const satisfies readonly (keyof NotedActs)[];

const ports: TestActPort<unknown>[] = [];

afterEach(() => {
  for (const port of ports.splice(0)) port.close();
});

/** What the host's handlers answer, by act, where a test answers one otherwise than unanswered. */
type Answers = Partial<Record<keyof NotedActs, () => Effect.Effect<unknown, unknown>>>;

/**
 * A window's act port over the procedures written here, opened as the
 * bridge opens one: each noted act's handler answering unanswered unless
 * `answers` says otherwise, the notices writing down what they were told,
 * and the window standing as `actor`.
 */
function windowPort(
  actor: ActSender,
  options: {
    trusted?: boolean;
    answers?: Answers;
    fallback?: () => Effect.Effect<unknown, unknown>;
  } = {},
) {
  const asked: unknown[] = [];
  const noted: string[] = [];
  const handler = (name: keyof NotedActs) => (input: unknown) =>
    Effect.suspend(() => {
      asked.push([name, input]);
      const answer =
        options.answers?.[name] ?? options.fallback ?? (() => Effect.succeed(UNANSWERED));
      return answer();
    });
  // SAFETY: each handler answers what its test hands it, which the procedure checks against the act's output schema; none is a row write a pool draws.
  const acts = Object.fromEntries(NOTED_ACTS.map((name) => [name, handler(name)])) as NotedActs;
  const notices: AgentProceduresDependencies["notices"] = {
    observeAgents: (agents) => {
      noted.push(`agents:${agents.map((agent) => `${agent.id}=${agent.status}`).join(",")}`);
    },
    observeStatus: (agentId, status) => {
      noted.push(`status:${agentId}=${status}`);
    },
    observeMessaged: (agent) => {
      noted.push(`messaged:${agent.id}=${agent.status}`);
    },
    observeTaskGone: (taskId) => {
      noted.push(`gone:${taskId}`);
    },
    shown: (agentId) => {
      noted.push(`shown:${agentId}`);
    },
    seen: (agentId) => {
      noted.push(`seen:${agentId}`);
    },
  };
  const port = testActPort(agentProcedures({ acts, notices }));
  ports.push(port);
  /** One kind called as this window, settled to its answer or the sentence of its refusal. */
  const call = (kind: PortActKind, payload: WireBoundaryInput) => port.call(actor, kind, payload);
  return { call, asked, noted };
}

it.effect.each(Object.values(AGENT_ACTS))(
  "a window that is not a panel is refused $name in the kind's own words, its payload taken by the schema, and nothing is asked nor noted",
  (act) =>
    Effect.gen(function* () {
      const { port, requests } = yield* hostActPort();
      const noted = windowPort(OTHER_WINDOW);
      // Note that an act answered by hand is served by its own procedure, which the standing host's port leaves to the platform.
      const refused = act.byHand
        ? yield* Effect.promise(() => noted.call(act.kind, PAYLOAD[act.name]))
        : yield* port.perform({ kind: act.kind, payload: PAYLOAD[act.name] }, OTHER_WINDOW);

      assert.deepEqual(refused, { refused: REFUSAL[act.kind] });
      assert.deepEqual(requests, []);
      assert.deepEqual(noted.asked, []);
    }),
);

it.effect(
  "a host without This Mac answers its set as unanswered, as its refused Gateway method was drawn",
  () =>
    Effect.gen(function* () {
      const { port } = yield* hostActPort();

      const set = yield* port.perform(
        { kind: AGENT_ACT_KIND.HOSTS_THIS_MAC_SET, payload: { on: true } },
        PANEL,
      );

      assert.deepEqual(set, { answer: UNANSWERED });
    }),
);

it("a panel's Start reaches its handler with the plan and the press's own key, hears the agent, and the agent is noted", async () => {
  const { call, asked, noted } = windowPort(PANEL, {
    answers: { AGENTS_START: () => Effect.succeed(STARTED) },
  });

  const started = await call(AGENT_ACT_KIND.AGENTS_START, {
    taskId: TASK_ID,
    idempotencyKey: "press-1",
  });

  assert.deepEqual(started, { answer: STARTED });
  assert.deepEqual(asked, [["AGENTS_START", { taskId: TASK_ID, idempotencyKey: "press-1" }]]);
  assert.deepEqual(noted, [`agents:${AGENT_ID}=${AGENT_STATUS.STARTING}`]);
});

it("a panel's reads are noted on their way: a task's agents or the task gone, and an agent's status, but a worker's page is no word on the agent", async () => {
  const { call, noted } = windowPort(PANEL, {
    answers: {
      AGENTS_LIST: () => Effect.succeed({ failure: AGENT_CALL_FAILURE.NOT_FOUND }),
      AGENTS_MESSAGES: () =>
        Effect.succeed({
          messages: [],
          cursor: AGENT_CURSOR_START,
          status: AGENT_STATUS.RUNNING,
          title: "Triage",
        }),
      AGENTS_MESSAGE: () => Effect.succeed(STARTED),
    },
  });

  await call(AGENT_ACT_KIND.AGENTS_LIST, { taskId: TASK_ID });
  await call(AGENT_ACT_KIND.AGENTS_MESSAGES, { agentId: AGENT_ID, after: "0" });
  await call(AGENT_ACT_KIND.AGENTS_MESSAGES, {
    agentId: AGENT_ID,
    after: "0",
    callId: "call-worker",
  });
  await call(AGENT_ACT_KIND.AGENTS_MESSAGE, {
    agentId: AGENT_ID,
    text: "Carry on.",
    clientKey: "send-1",
  });

  assert.deepEqual(noted, [
    `gone:${TASK_ID}`,
    `status:${AGENT_ID}=${AGENT_STATUS.RUNNING}`,
    `messaged:${AGENT_ID}=${AGENT_STATUS.STARTING}`,
  ]);
});

it("a panel's word on which agent it shows is noted, none as none, and answers nothing", async () => {
  const { call, asked, noted } = windowPort(PANEL);

  const named = await call(AGENT_ACT_KIND.AGENTS_SHOWN, { agentId: AGENT_ID });
  const none = await call(AGENT_ACT_KIND.AGENTS_SHOWN, { agentId: null });

  assert.deepEqual(named, { answer: undefined });
  assert.deepEqual(none, { answer: undefined });
  assert.deepEqual(noted, [`shown:${AGENT_ID}`, "shown:null"]);
  assert.deepEqual(asked, []);
});

it("a panel's Mark as read on an agent clears its unseen dot without naming a page shown, and answers nothing", async () => {
  const { call, asked, noted } = windowPort(PANEL);

  const answer = await call(AGENT_ACT_KIND.AGENTS_SEEN, { agentId: AGENT_ID });

  assert.deepEqual(answer, { answer: undefined });
  assert.deepEqual(noted, [`seen:${AGENT_ID}`]);
  assert.deepEqual(asked, []);
});

it("a noted act whose handler fails, dies, or answers what the kind cannot carry is drawn as unanswered, and nothing is noted", async () => {
  const fallbacks = [
    () => Effect.fail(new Error("refused")),
    () => Effect.die(new Error("secret detail")),
    () => Effect.succeed({ agent: "none" }),
  ];
  for (const fallback of fallbacks) {
    const { call, noted } = windowPort(PANEL, { fallback });
    assert.deepEqual(await call(AGENT_ACT_KIND.AGENTS_STOP, { agentId: AGENT_ID }), {
      answer: UNANSWERED,
    });
    assert.deepEqual(noted, []);
  }
});

it("a word on which agent is shown carrying a key its schema does not name, or naming no agent, is refused in the kind's own words, and nothing is noted", async () => {
  const { call, noted } = windowPort(PANEL);
  assert.deepEqual(await call(AGENT_ACT_KIND.AGENTS_SHOWN, { agentId: AGENT_ID, stray: true }), {
    refused: REFUSAL[AGENT_ACT_KIND.AGENTS_SHOWN],
  });
  assert.deepEqual(await call(AGENT_ACT_KIND.AGENTS_SHOWN, { agentId: " " }), {
    refused: REFUSAL[AGENT_ACT_KIND.AGENTS_SHOWN],
  });
  assert.deepEqual(noted, []);
});
