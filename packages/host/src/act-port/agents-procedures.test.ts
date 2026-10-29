/**
 * agents-procedures.test.ts -- the Tasks tab's agent acts, and what an agent published, through the act port.
 *
 * The Tasks tab's core asks about a task's coding agents, through the act
 * port as a window calls them: only a panel of this build's own renderer
 * asks; any other window, and a frame this build does not trust,
 * are refused in each kind's own words before the host is asked or anything
 * noted; a panel's ask reaches the host with its payload as the panel sent
 * it, and what the host answers is noted on its way; and a host that fails answers the kind's own sentence.
 */

import assert from "node:assert/strict";
import { setImmediate as nextTurn } from "node:timers/promises";
import { afterEach, it } from "@effect/vitest";
import {
  AGENT_CALL_FAILURE,
  type AgentAgentAnswer,
  type AgentTranscriptChanged,
  type AgentTranscriptKey,
  type AgentTranscriptPage,
  TRANSCRIPT_KIND,
} from "@luke/features/agent-view";
import { AGENT_STATUS } from "@luke/features/agent-wire";
import {
  FILE_VIEWED_STATE,
  PULL_REQUEST_ACTION,
  PULL_REQUEST_WRITE_OUTCOME,
} from "@luke/features/pull-request-write-wire";
import type { WireBoundaryInput } from "@luke/wire";
import { Effect } from "effect";
import { AGENT_ACT_KIND, type PortActKind } from "../contract/index.js";
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

/** Each kind's refusal, as the window drew it before the kinds moved onto the port. */
const REFUSAL = {
  [AGENT_ACT_KIND.AGENTS_MODELS]: "Could not read the models on this system.",
  [AGENT_ACT_KIND.AGENTS_DEFAULT_READ]: "Could not read the default model on this system.",
  [AGENT_ACT_KIND.AGENTS_DEFAULT_WRITE]: "Could not change the default model on this system.",
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
  [AGENT_ACT_KIND.AGENTS_STOP]: "Could not stop the agent on this system.",
  [AGENT_ACT_KIND.AGENTS_ARCHIVE]: "Could not archive the agent on this system.",
  [AGENT_ACT_KIND.AGENTS_PIN]: "Could not pin the agent on this system.",
  [AGENT_ACT_KIND.AGENTS_ENSURE_OPERATOR]: "Could not reach Luke on this system.",
  [AGENT_ACT_KIND.AGENTS_DELETE]: "Could not delete the agent on this system.",
  [AGENT_ACT_KIND.AGENTS_SHOWN]: "Could not note which agent is shown on this system.",
  [AGENT_ACT_KIND.AGENTS_SEEN]: "Could not mark the agent as read on this system.",
  [AGENT_ACT_KIND.AGENTS_PAGE]: "Could not read the agent on this system.",
  [AGENT_ACT_KIND.AGENTS_PULL_REQUEST]: "Could not read the agent's pull request on this system.",
  [AGENT_ACT_KIND.AGENTS_CHANGES]: "Could not read the agent's changes on this system.",
  [AGENT_ACT_KIND.AGENTS_OVERVIEW_PULL_REQUEST]:
    "Could not read the agent's pull request on this system.",
  [AGENT_ACT_KIND.AGENTS_REVIEW_OPTIONS]:
    "Could not read the repository's reviewers and labels on this system.",
  [AGENT_ACT_KIND.AGENTS_OVERVIEW_CHECKS]:
    "Could not read the pull request's checks on this system.",
  [AGENT_ACT_KIND.AGENTS_OVERVIEW_CONVERSATION]:
    "Could not read the pull request's conversation on this system.",
  [AGENT_ACT_KIND.AGENTS_GITHUB_IMAGE]: "Could not read the pull request's image on this system.",
  [AGENT_ACT_KIND.AGENTS_PULL_REQUEST_ACTION]: "Could not change the pull request on this system.",
  [AGENT_ACT_KIND.AGENTS_PULL_REQUEST_VIEWED]:
    "Could not read which files you viewed on this system.",
} as const;

type HostAsk = AgentProceduresDependencies["host"];

/** Every kind, each with a payload its schema admits and the host ask it reaches, where it asks one. */
const ACTS: readonly {
  kind: keyof typeof REFUSAL;
  payload: WireBoundaryInput;
  ask?: keyof HostAsk;
}[] = [
  { kind: AGENT_ACT_KIND.AGENTS_MODELS, payload: undefined, ask: "agentModels" },
  {
    kind: AGENT_ACT_KIND.AGENTS_DEFAULT_READ,
    payload: undefined,
    ask: "agentDefaultRead",
  },
  {
    kind: AGENT_ACT_KIND.AGENTS_DEFAULT_WRITE,
    payload: { model: "anthropic/claude-opus-5.5", effort: "high" },
    ask: "agentDefaultWrite",
  },
  { kind: AGENT_ACT_KIND.AGENTS_LIST, payload: { taskId: TASK_ID }, ask: "agentList" },
  {
    kind: AGENT_ACT_KIND.AGENTS_WORKSPACE_LIST,
    payload: { workspaceId: WORKSPACE_ID },
    ask: "agentWorkspaceList",
  },
  {
    kind: AGENT_ACT_KIND.AGENTS_START,
    payload: { taskId: TASK_ID, idempotencyKey: "press-1" },
    ask: "agentStart",
  },
  {
    kind: AGENT_ACT_KIND.AGENTS_MESSAGES,
    payload: { agentId: AGENT_ID, after: "0" },
    ask: "agentMessages",
  },
  {
    kind: AGENT_ACT_KIND.AGENTS_PART,
    payload: { agentId: AGENT_ID, messageId: "message-1", index: 1 },
    ask: "agentPart",
  },
  {
    kind: AGENT_ACT_KIND.AGENTS_TRANSCRIPT_OLDER,
    payload: { kind: TRANSCRIPT_KIND.AGENT, agentId: AGENT_ID, before: "40" },
    ask: "transcriptOlder",
  },
  {
    kind: AGENT_ACT_KIND.AGENTS_MESSAGE,
    payload: { agentId: AGENT_ID, text: "Carry on.", clientKey: "send-1" },
    ask: "agentMessage",
  },
  {
    kind: AGENT_ACT_KIND.AGENTS_CHOOSE,
    payload: { agentId: AGENT_ID, model: "anthropic/claude-opus-5.5", effort: "low" },
    ask: "agentChoose",
  },
  {
    kind: AGENT_ACT_KIND.AGENTS_RENAME,
    payload: { agentId: AGENT_ID, title: "Triage" },
    ask: "agentRename",
  },
  {
    kind: AGENT_ACT_KIND.AGENTS_SERVERS,
    payload: { agentId: AGENT_ID, disabledServers: ["linear"] },
    ask: "agentServers",
  },
  {
    kind: AGENT_ACT_KIND.AGENTS_STOP,
    payload: { agentId: AGENT_ID },
    ask: "agentStop",
  },
  {
    kind: AGENT_ACT_KIND.AGENTS_ARCHIVE,
    payload: { agentId: AGENT_ID, archived: true },
    ask: "agentArchive",
  },
  {
    kind: AGENT_ACT_KIND.AGENTS_PIN,
    payload: { agentId: AGENT_ID, pinned: true },
    ask: "agentPin",
  },
  {
    kind: AGENT_ACT_KIND.AGENTS_ENSURE_OPERATOR,
    payload: { workspaceId: WORKSPACE_ID },
    ask: "agentEnsureOperator",
  },
  {
    kind: AGENT_ACT_KIND.AGENTS_DELETE,
    payload: { agentId: AGENT_ID },
    ask: "agentDelete",
  },
  {
    kind: AGENT_ACT_KIND.AGENTS_SHOWN,
    payload: { agentId: AGENT_ID },
  },
  {
    kind: AGENT_ACT_KIND.AGENTS_SEEN,
    payload: { agentId: AGENT_ID },
  },
  {
    kind: AGENT_ACT_KIND.AGENTS_PAGE,
    payload: { agentId: AGENT_ID },
    ask: "agentPage",
  },
  {
    kind: AGENT_ACT_KIND.AGENTS_PULL_REQUEST,
    payload: { agentId: AGENT_ID },
    ask: "agentPullRequest",
  },
  {
    kind: AGENT_ACT_KIND.AGENTS_CHANGES,
    payload: { agentId: AGENT_ID, number: 41 },
    ask: "agentChanges",
  },
  {
    kind: AGENT_ACT_KIND.AGENTS_OVERVIEW_PULL_REQUEST,
    payload: { agentId: AGENT_ID },
    ask: "agentOverviewPullRequest",
  },
  {
    kind: AGENT_ACT_KIND.AGENTS_REVIEW_OPTIONS,
    payload: { agentId: AGENT_ID },
    ask: "agentReviewOptions",
  },
  {
    kind: AGENT_ACT_KIND.AGENTS_OVERVIEW_CHECKS,
    payload: { agentId: AGENT_ID },
    ask: "agentOverviewChecks",
  },
  {
    kind: AGENT_ACT_KIND.AGENTS_OVERVIEW_CONVERSATION,
    payload: { agentId: AGENT_ID },
    ask: "agentOverviewConversation",
  },
  {
    kind: AGENT_ACT_KIND.AGENTS_GITHUB_IMAGE,
    payload: { agentId: AGENT_ID, src: "https://github.com/user-attachments/assets/seats.png" },
    ask: "agentGitHubImage",
  },
  {
    kind: AGENT_ACT_KIND.AGENTS_PULL_REQUEST_ACTION,
    payload: { agentId: AGENT_ID, request: { action: PULL_REQUEST_ACTION.CONVERT_TO_DRAFT } },
    ask: "agentPullRequestAction",
  },
  {
    kind: AGENT_ACT_KIND.AGENTS_PULL_REQUEST_VIEWED,
    payload: { agentId: AGENT_ID },
    ask: "agentPullRequestViewed",
  },
];

const ports: TestActPort<unknown>[] = [];

afterEach(() => {
  for (const port of ports.splice(0)) port.close();
});

/** What the host is asked to answer, by its ask, where a test answers one otherwise than unanswered. */
type Answers = Partial<Record<keyof HostAsk, () => Effect.Effect<unknown>>>;

/**
 * A window's act port, opened as the bridge opens one: the host answering
 * each ask unanswered unless `answers` says otherwise, the notices writing
 * down what they were told, and the window standing as `actor`.
 */
function windowPort(
  actor: ActSender,
  options: { trusted?: boolean; answers?: Answers; fallback?: () => Effect.Effect<unknown> } = {},
) {
  const asked: unknown[] = [];
  const noted: string[] = [];
  const ask =
    (name: keyof HostAsk) =>
    (...params: unknown[]) =>
      Effect.suspend(() => {
        asked.push(params.length === 0 ? [name] : [name, params[0]]);
        const answer =
          options.answers?.[name] ?? options.fallback ?? (() => Effect.succeed(UNANSWERED));
        return answer();
      });
  const names: (keyof HostAsk)[] = [
    ...ACTS.flatMap((act) => (act.ask === undefined ? [] : [act.ask])),
    "tasksRefresh",
  ];
  // SAFETY: each fake answers what its test hands it; the port's output schema checks it.
  const host = Object.fromEntries(names.map((name) => [name, ask(name)])) as unknown as HostAsk;
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
  const port = testActPort(agentProcedures({ host, notices }));
  ports.push(port);
  const trusted = options.trusted ?? true;
  /** One kind called as this window, settled to its answer or the sentence of its refusal. */
  const call = (kind: PortActKind, payload: WireBoundaryInput) =>
    port.call(actor, kind, payload, { trusted });
  return { call, asked, noted };
}

it("a window that is not a panel is refused every agent act in the kind's own words, and the host is not asked nor anything noted", async () => {
  const { call, asked, noted } = windowPort(OTHER_WINDOW);
  for (const act of ACTS) {
    assert.deepEqual(await call(act.kind, act.payload), {
      refused: REFUSAL[act.kind],
    });
  }
  assert.deepEqual(asked, []);
  assert.deepEqual(noted, []);
});

it("a frame this build does not trust is refused every agent act, even as a panel, and the host is not asked nor anything noted", async () => {
  const { call, asked, noted } = windowPort(PANEL, { trusted: false });
  for (const act of ACTS) {
    assert.deepEqual(await call(act.kind, act.payload), {
      refused: REFUSAL[act.kind],
    });
  }
  assert.deepEqual(asked, []);
  assert.deepEqual(noted, []);
});

it("a panel's ask reaches the host once with its payload, a kind that carries nothing with nothing, and the host's answer is the panel's", async () => {
  const { call, asked } = windowPort(PANEL);
  for (const act of ACTS) {
    assert.deepEqual(await call(act.kind, act.payload), {
      answer: act.ask === undefined ? undefined : UNANSWERED,
    });
  }
  assert.deepEqual(
    asked,
    ACTS.flatMap((act) =>
      act.ask === undefined ? [] : [act.payload === undefined ? [act.ask] : [act.ask, act.payload]],
    ),
  );
});

it("a panel's Start from an agent on its own page reaches the host with no task, only the agent it starts from, and the press's own key", async () => {
  const { call, asked } = windowPort(PANEL, {
    answers: { agentStart: () => Effect.succeed(STARTED) },
  });

  const started = await call(AGENT_ACT_KIND.AGENTS_START, {
    idempotencyKey: "press-1",
    from: { agentId: AGENT_ID },
  });

  assert.deepEqual(started, { answer: STARTED });
  assert.deepEqual(asked, [
    ["agentStart", { idempotencyKey: "press-1", from: { agentId: AGENT_ID } }],
  ]);
});

it("a panel's Start reaches the host with the plan and the press's own key, hears the agent, and the agent is noted", async () => {
  const { call, asked, noted } = windowPort(PANEL, {
    answers: { agentStart: () => Effect.succeed(STARTED) },
  });

  const started = await call(AGENT_ACT_KIND.AGENTS_START, {
    taskId: TASK_ID,
    idempotencyKey: "press-1",
  });

  assert.deepEqual(started, { answer: STARTED });
  assert.deepEqual(asked, [["agentStart", { taskId: TASK_ID, idempotencyKey: "press-1" }]]);
  assert.deepEqual(noted, [`agents:${AGENT_ID}=${AGENT_STATUS.STARTING}`]);
});

it("a rename, an archive, or a pin answering an agent with no plan reads the plan list again, which lists it, and one on a plan does not", async () => {
  const unplaced = { agent: { ...STARTED.agent, planId: null } };
  const answered = () => Effect.succeed(unplaced);
  const taskless = windowPort(PANEL, {
    answers: {
      agentRename: answered,
      agentArchive: answered,
      agentPin: answered,
    },
  });
  const onTask = windowPort(PANEL, {
    answers: { agentRename: () => Effect.succeed(STARTED) },
  });
  const rename = { agentId: AGENT_ID, title: "Triage" };

  await taskless.call(AGENT_ACT_KIND.AGENTS_RENAME, rename);
  await taskless.call(AGENT_ACT_KIND.AGENTS_ARCHIVE, {
    agentId: AGENT_ID,
    archived: true,
  });
  await taskless.call(AGENT_ACT_KIND.AGENTS_PIN, {
    agentId: AGENT_ID,
    pinned: true,
  });
  await onTask.call(AGENT_ACT_KIND.AGENTS_RENAME, rename);

  assert.deepEqual(taskless.asked, [
    ["agentRename", rename],
    ["tasksRefresh"],
    ["agentArchive", { agentId: AGENT_ID, archived: true }],
    ["tasksRefresh"],
    ["agentPin", { agentId: AGENT_ID, pinned: true }],
    ["tasksRefresh"],
  ]);
  assert.deepEqual(onTask.asked, [["agentRename", rename]]);
});

it("a delete that took the agent reads the plan list again, so its sidebar row goes, and one refused does not", async () => {
  const deleted = windowPort(PANEL, {
    answers: { agentDelete: () => Effect.succeed({ deleted: true as const }) },
  });
  const refused = windowPort(PANEL, {
    answers: {
      agentDelete: () => Effect.succeed({ failure: AGENT_CALL_FAILURE.AGENT_NOT_READY }),
    },
  });

  assert.deepEqual(await deleted.call(AGENT_ACT_KIND.AGENTS_DELETE, { agentId: AGENT_ID }), {
    answer: { deleted: true },
  });
  assert.deepEqual(await refused.call(AGENT_ACT_KIND.AGENTS_DELETE, { agentId: AGENT_ID }), {
    answer: { failure: AGENT_CALL_FAILURE.AGENT_NOT_READY },
  });

  assert.deepEqual(deleted.asked, [["agentDelete", { agentId: AGENT_ID }], ["tasksRefresh"]]);
  assert.deepEqual(refused.asked, [["agentDelete", { agentId: AGENT_ID }]]);
});

it("an ensure of the operator that made one reads the plan list again, so its sidebar row stands, and one that found it standing does not", async () => {
  const made = windowPort(PANEL, {
    answers: {
      agentEnsureOperator: () => Effect.succeed({ agentId: AGENT_ID, txid: "9103" }),
    },
  });
  const standing = windowPort(PANEL, {
    answers: { agentEnsureOperator: () => Effect.succeed({ agentId: AGENT_ID }) },
  });
  const ensure = { workspaceId: WORKSPACE_ID, reset: true };

  assert.deepEqual(await made.call(AGENT_ACT_KIND.AGENTS_ENSURE_OPERATOR, ensure), {
    answer: { agentId: AGENT_ID, txid: "9103" },
  });
  await standing.call(AGENT_ACT_KIND.AGENTS_ENSURE_OPERATOR, { workspaceId: WORKSPACE_ID });

  assert.deepEqual(made.asked, [["agentEnsureOperator", ensure], ["tasksRefresh"]]);
  assert.deepEqual(standing.asked, [["agentEnsureOperator", { workspaceId: WORKSPACE_ID }]]);
});

it("a panel's reads are noted on their way: a task's agents or the task gone, and an agent's status, but a worker's page is no word on the agent", async () => {
  const { call, noted } = windowPort(PANEL, {
    answers: {
      agentList: () => Effect.succeed({ failure: AGENT_CALL_FAILURE.NOT_FOUND }),
      agentMessages: () =>
        Effect.succeed({
          messages: [],
          cursor: "0",
          status: AGENT_STATUS.RUNNING,
          title: "Triage",
        }),
      agentMessage: () => Effect.succeed(STARTED),
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

it("a panel's change to an agent's pull request reaches the host as asked and hears how GitHub took it, and its read of which files it viewed hears each file's mark", async () => {
  const viewed = {
    outcome: PULL_REQUEST_WRITE_OUTCOME.DONE,
    files: [{ path: "src/seats.ts", state: FILE_VIEWED_STATE.VIEWED }],
  };
  const { call, asked, noted } = windowPort(PANEL, {
    answers: {
      agentPullRequestAction: () => Effect.succeed({ outcome: PULL_REQUEST_WRITE_OUTCOME.DONE }),
      agentPullRequestViewed: () => Effect.succeed(viewed),
    },
  });
  const change = {
    agentId: AGENT_ID,
    number: 41,
    request: { action: PULL_REQUEST_ACTION.CONVERT_TO_DRAFT },
  };

  assert.deepEqual(await call(AGENT_ACT_KIND.AGENTS_PULL_REQUEST_ACTION, change), {
    answer: { outcome: PULL_REQUEST_WRITE_OUTCOME.DONE },
  });
  assert.deepEqual(await call(AGENT_ACT_KIND.AGENTS_PULL_REQUEST_VIEWED, { agentId: AGENT_ID }), {
    answer: viewed,
  });
  assert.deepEqual(asked, [
    ["agentPullRequestAction", change],
    ["agentPullRequestViewed", { agentId: AGENT_ID }],
  ]);
  assert.deepEqual(noted, []);
});

it("a host that dies, or answers what the kind cannot carry, is refused in the kind's own words", async () => {
  const died = windowPort(PANEL, { fallback: () => Effect.die(new Error("secret detail")) });
  const malformed = windowPort(PANEL, { fallback: () => Effect.succeed({ agents: "none" }) });
  for (const { call } of [died, malformed]) {
    for (const act of ACTS) {
      if (act.ask === undefined) continue;
      assert.deepEqual(await call(act.kind, act.payload), {
        refused: REFUSAL[act.kind],
      });
    }
  }
});

it("a payload carrying a key its kind's schema does not name is refused in the kind's own words, and the host is not asked nor anything noted", async () => {
  const { call, asked, noted } = windowPort(PANEL);
  assert.deepEqual(await call(AGENT_ACT_KIND.AGENTS_STOP, { agentId: AGENT_ID, stray: true }), {
    refused: REFUSAL[AGENT_ACT_KIND.AGENTS_STOP],
  });
  assert.deepEqual(
    await call(AGENT_ACT_KIND.AGENTS_SHOWN, {
      agentId: AGENT_ID,
      stray: true,
    }),
    { refused: REFUSAL[AGENT_ACT_KIND.AGENTS_SHOWN] },
  );
  assert.deepEqual(
    await call(AGENT_ACT_KIND.AGENTS_PULL_REQUEST, { agentId: AGENT_ID, stray: true }),
    { refused: REFUSAL[AGENT_ACT_KIND.AGENTS_PULL_REQUEST] },
  );
  assert.deepEqual(
    await call(AGENT_ACT_KIND.AGENTS_PULL_REQUEST_ACTION, {
      agentId: AGENT_ID,
      request: { action: PULL_REQUEST_ACTION.CONVERT_TO_DRAFT, stray: true },
    }),
    { refused: REFUSAL[AGENT_ACT_KIND.AGENTS_PULL_REQUEST_ACTION] },
  );
  assert.deepEqual(asked, []);
  assert.deepEqual(noted, []);
});

it("a payload its kind's schema refuses, or one sent to a kind that carries none, is refused in the kind's own words, and the host is not asked nor anything noted", async () => {
  const { call, asked, noted } = windowPort(PANEL);
  assert.deepEqual(await call(AGENT_ACT_KIND.AGENTS_SHOWN, { agentId: " " }), {
    refused: REFUSAL[AGENT_ACT_KIND.AGENTS_SHOWN],
  });
  assert.deepEqual(await call(AGENT_ACT_KIND.AGENTS_LIST, { taskId: "" }), {
    refused: REFUSAL[AGENT_ACT_KIND.AGENTS_LIST],
  });
  assert.deepEqual(await call(AGENT_ACT_KIND.AGENTS_MODELS, { workspaceId: WORKSPACE_ID }), {
    refused: REFUSAL[AGENT_ACT_KIND.AGENTS_MODELS],
  });
  assert.deepEqual(
    await call(AGENT_ACT_KIND.AGENTS_GITHUB_IMAGE, {
      agentId: AGENT_ID,
      src: "",
    }),
    { refused: REFUSAL[AGENT_ACT_KIND.AGENTS_GITHUB_IMAGE] },
  );
  assert.deepEqual(await call(AGENT_ACT_KIND.AGENTS_CHANGES, { agentId: AGENT_ID, number: 0 }), {
    refused: REFUSAL[AGENT_ACT_KIND.AGENTS_CHANGES],
  });
  assert.deepEqual(asked, []);
  assert.deepEqual(noted, []);
});

/** Turns the event loop until `ready` holds, as a page waits on its port. */
async function until(ready: () => boolean): Promise<void> {
  for (let turn = 0; turn < 200 && !ready(); turn += 1) await nextTurn();
}

it("a panel's transcript stream follows the transcript at the host, hears each page told of it alone, and lets it go once its last stream closes", async () => {
  const asked: string[] = [];
  const listeners = new Set<(changed: AgentTranscriptChanged) => void>();
  const transcripts: Pick<
    HostAsk,
    "transcriptFollow" | "transcriptUnfollow" | "onTranscriptChanged"
  > = {
    transcriptFollow: () => Effect.sync(() => void asked.push("follow")),
    transcriptUnfollow: () => Effect.sync(() => void asked.push("unfollow")),
    onTranscriptChanged: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  // SAFETY: the stream reaches the transcript asks alone.
  const host = transcripts as HostAsk;
  const noted: string[] = [];
  // SAFETY: the stream notes an agent's status alone.
  const notices = {
    observeStatus: (_agentId: string, status: string) => noted.push(`status:${status}`),
  } as unknown as AgentProceduresDependencies["notices"];
  const port = testActPort(agentProcedures({ host, notices }));
  ports.push(port);
  const client = port.as(PANEL);
  const transcript: AgentTranscriptKey = { kind: TRANSCRIPT_KIND.AGENT, agentId: AGENT_ID };
  const page: AgentTranscriptPage = {
    messages: [],
    cursor: "1:0",
    status: AGENT_STATUS.RUNNING,
    title: "Invites",
    caughtUp: false,
  };

  const one = await client[AGENT_ACT_KIND.AGENTS_TRANSCRIPT](transcript);
  const two = await client[AGENT_ACT_KIND.AGENTS_TRANSCRIPT](transcript);
  const first = one.next();
  const second = two.next();
  await until(() => asked.length === 2);
  for (const listener of [...listeners]) {
    listener({ transcript: { ...transcript, callId: "call-7" }, page: { ...page, title: null } });
    listener({ transcript, page });
  }
  assert.deepEqual((await first).value, page);
  assert.deepEqual((await second).value, page);
  assert.deepEqual(noted, ["status:running", "status:running"]);

  await one.return(undefined);
  await until(() => listeners.size === 1);
  assert.deepEqual(asked, ["follow", "follow"]);
  await two.return(undefined);
  await until(() => asked.length === 3);
  assert.deepEqual(asked, ["follow", "follow", "unfollow"]);
});
