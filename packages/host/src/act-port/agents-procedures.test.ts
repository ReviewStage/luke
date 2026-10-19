import assert from "node:assert/strict";
import { afterEach, it } from "@effect/vitest";
import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentAgentAnswer,
} from "@luke/features/coding-agent-view";
import { CODING_AGENT_STATUS } from "@luke/features/coding-agent-wire";
import type { WireBoundaryInput } from "@luke/wire";
import { createORPCClient, ORPCError } from "@orpc/client";
import { RPCLink } from "@orpc/client/message-port";
import { Context, Effect } from "effect";
import type { ActSender } from "../act-router/router.js";
import {
  ACT_ERROR,
  type ActPortClient,
  AGENT_ACT_KIND,
  type PortActKind,
  type PortActPayload,
  type PortActResult,
} from "../contract/index.js";
import {
  type AccountAskProceduresDependencies,
  type AgentProceduresDependencies,
  createActPortHandler,
  type IssueProceduresDependencies,
} from "./index.js";

/**
 * The Tasks tab's core asks about a task's coding agents, through the act
 * port as a window calls them: only a panel of this build's own renderer
 * asks; the voice and call windows, and a frame this build does not trust,
 * are refused in each kind's own words before the host is asked or anything
 * noted; a panel's ask reaches the host with its payload as the panel sent
 * it, and what the host answers is noted on its way, as it was on `app:act`;
 * and a host that fails answers the kind's own sentence.
 */

// The platform's handle on the window that asked, which no procedure here reads.
const SENDER = Symbol("window");

const PANEL: ActSender = { sender: SENDER, panel: true, voice: false, call: false };
const VOICE: ActSender = { ...PANEL, panel: false, voice: true };
const CALL: ActSender = { ...PANEL, panel: false, call: true };

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
    status: CODING_AGENT_STATUS.STARTING,
    turnId: null,
  },
} satisfies CodingAgentAgentAnswer;

const UNANSWERED = { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED } as const;

/** Each kind's refusal, as the window drew it before the kinds moved onto the port. */
const REFUSAL = {
  [AGENT_ACT_KIND.CODING_AGENTS_MODELS]: "Could not read the models on this system.",
  [AGENT_ACT_KIND.CODING_AGENTS_DEFAULT_READ]: "Could not read the default model on this system.",
  [AGENT_ACT_KIND.CODING_AGENTS_DEFAULT_WRITE]:
    "Could not change the default model on this system.",
  [AGENT_ACT_KIND.CODING_AGENTS_LIST]: "Could not read the task's agents on this system.",
  [AGENT_ACT_KIND.CODING_AGENTS_WORKSPACE_LIST]:
    "Could not read the workspace's agents on this system.",
  [AGENT_ACT_KIND.CODING_AGENTS_START]: "Could not start an agent on this system.",
  [AGENT_ACT_KIND.CODING_AGENTS_MESSAGES]: "Could not read the agent's transcript on this system.",
  [AGENT_ACT_KIND.CODING_AGENTS_MESSAGE]: "Could not message the agent on this system.",
  [AGENT_ACT_KIND.CODING_AGENTS_CHOOSE]: "Could not change the agent's model on this system.",
  [AGENT_ACT_KIND.CODING_AGENTS_RENAME]: "Could not rename the agent on this system.",
  [AGENT_ACT_KIND.CODING_AGENTS_SERVERS]:
    "Could not switch the agent's MCP servers on this system.",
  [AGENT_ACT_KIND.CODING_AGENTS_STOP]: "Could not stop the agent on this system.",
  [AGENT_ACT_KIND.CODING_AGENTS_ARCHIVE]: "Could not archive the agent on this system.",
  [AGENT_ACT_KIND.CODING_AGENTS_PIN]: "Could not pin the agent on this system.",
  [AGENT_ACT_KIND.CODING_AGENTS_SHOWN]: "Could not note which agent is shown on this system.",
  [AGENT_ACT_KIND.CODING_AGENTS_PAGE]: "Could not read the agent on this system.",
} as const;

type HostAsk = AgentProceduresDependencies["host"];

/** Every kind, each with a payload its schema admits and the host ask it reaches, where it asks one. */
const ACTS: readonly {
  kind: keyof typeof REFUSAL;
  payload: WireBoundaryInput;
  ask?: keyof HostAsk;
}[] = [
  { kind: AGENT_ACT_KIND.CODING_AGENTS_MODELS, payload: undefined, ask: "codingAgentModels" },
  {
    kind: AGENT_ACT_KIND.CODING_AGENTS_DEFAULT_READ,
    payload: undefined,
    ask: "codingAgentDefaultRead",
  },
  {
    kind: AGENT_ACT_KIND.CODING_AGENTS_DEFAULT_WRITE,
    payload: { model: "anthropic/claude-opus-5.5", effort: "high" },
    ask: "codingAgentDefaultWrite",
  },
  { kind: AGENT_ACT_KIND.CODING_AGENTS_LIST, payload: { taskId: TASK_ID }, ask: "codingAgentList" },
  {
    kind: AGENT_ACT_KIND.CODING_AGENTS_WORKSPACE_LIST,
    payload: { workspaceId: WORKSPACE_ID },
    ask: "codingAgentWorkspaceList",
  },
  {
    kind: AGENT_ACT_KIND.CODING_AGENTS_START,
    payload: { taskId: TASK_ID, idempotencyKey: "press-1" },
    ask: "codingAgentStart",
  },
  {
    kind: AGENT_ACT_KIND.CODING_AGENTS_MESSAGES,
    payload: { agentId: AGENT_ID, after: "0" },
    ask: "codingAgentMessages",
  },
  {
    kind: AGENT_ACT_KIND.CODING_AGENTS_MESSAGE,
    payload: { agentId: AGENT_ID, text: "Carry on.", clientKey: "send-1" },
    ask: "codingAgentMessage",
  },
  {
    kind: AGENT_ACT_KIND.CODING_AGENTS_CHOOSE,
    payload: { agentId: AGENT_ID, model: "anthropic/claude-opus-5.5", effort: "low" },
    ask: "codingAgentChoose",
  },
  {
    kind: AGENT_ACT_KIND.CODING_AGENTS_RENAME,
    payload: { agentId: AGENT_ID, title: "Triage" },
    ask: "codingAgentRename",
  },
  {
    kind: AGENT_ACT_KIND.CODING_AGENTS_SERVERS,
    payload: { agentId: AGENT_ID, disabledServers: ["linear"] },
    ask: "codingAgentServers",
  },
  {
    kind: AGENT_ACT_KIND.CODING_AGENTS_STOP,
    payload: { agentId: AGENT_ID },
    ask: "codingAgentStop",
  },
  {
    kind: AGENT_ACT_KIND.CODING_AGENTS_ARCHIVE,
    payload: { agentId: AGENT_ID, archived: true },
    ask: "codingAgentArchive",
  },
  {
    kind: AGENT_ACT_KIND.CODING_AGENTS_PIN,
    payload: { agentId: AGENT_ID, pinned: true },
    ask: "codingAgentPin",
  },
  {
    kind: AGENT_ACT_KIND.CODING_AGENTS_SHOWN,
    payload: { agentId: AGENT_ID, inboxTaskId: null },
  },
  {
    kind: AGENT_ACT_KIND.CODING_AGENTS_PAGE,
    payload: { agentId: AGENT_ID },
    ask: "codingAgentPage",
  },
];

const opened: MessagePort[] = [];

afterEach(() => {
  for (const port of opened.splice(0)) port.close();
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
    observeTitle: (agentId, title) => {
      noted.push(`title:${agentId}=${title}`);
    },
    observeMessaged: (agent) => {
      noted.push(`messaged:${agent.id}=${agent.status}`);
    },
    observeModels: (models) => {
      noted.push(`models:${models.length}`);
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
      noted.push(`chat:${JSON.stringify(shown)}`);
    },
  };
  // SAFETY: no account ask is called here, so the account asks' host is never reached.
  const accountAsks = { host: {} } as AccountAskProceduresDependencies;
  // SAFETY: no issue act is called here, so the issues' host is never reached.
  const issues = { host: {} } as IssueProceduresDependencies;
  const handler = createActPortHandler({ accountAsks, agents: { host, notices }, issues });
  const { port1, port2 } = new MessageChannel();
  opened.push(port1, port2);
  handler.upgrade(port1, {
    context: () => ({
      actor,
      trusted: options.trusted ?? true,
      "effect/context": Context.empty(),
    }),
  });
  port1.start();
  const client: ActPortClient = createORPCClient(new RPCLink({ port: port2 }));
  port2.start();
  return { client, asked, noted };
}

/** Any port kind's procedure, erased to the union of what every one takes and answers. */
type PortCall = (payload: PortActPayload<PortActKind>) => Promise<PortActResult<PortActKind>>;

/** One kind called on the port with `payload`, settled to its answer or the sentence of its refusal. */
async function settled(client: ActPortClient, kind: PortActKind, payload: WireBoundaryInput) {
  // SAFETY: each test pairs a kind with the payload its own procedure takes, or one it refuses on purpose.
  const call = client[kind] as PortCall;
  try {
    // SAFETY: as above; a window's payload crosses as a structured-clone value.
    return { answer: await call(payload as PortActPayload<PortActKind>) };
  } catch (error) {
    assert.ok(error instanceof ORPCError);
    assert.equal(error.code, ACT_ERROR.REFUSED);
    return { refused: error.message };
  }
}

it("the voice and call windows are refused every agent act in the kind's own words, and the host is not asked nor anything noted", async () => {
  for (const actor of [VOICE, CALL]) {
    const { client, asked, noted } = windowPort(actor);
    for (const act of ACTS) {
      assert.deepEqual(await settled(client, act.kind, act.payload), {
        refused: REFUSAL[act.kind],
      });
    }
    assert.deepEqual(asked, []);
    assert.deepEqual(noted, []);
  }
});

it("a frame this build does not trust is refused every agent act, even as a panel, and the host is not asked nor anything noted", async () => {
  const { client, asked, noted } = windowPort(PANEL, { trusted: false });
  for (const act of ACTS) {
    assert.deepEqual(await settled(client, act.kind, act.payload), {
      refused: REFUSAL[act.kind],
    });
  }
  assert.deepEqual(asked, []);
  assert.deepEqual(noted, []);
});

it("a panel's ask reaches the host once with its payload, a kind that carries nothing with nothing, and the host's answer is the panel's", async () => {
  const { client, asked } = windowPort(PANEL);
  for (const act of ACTS) {
    assert.deepEqual(await settled(client, act.kind, act.payload), {
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

it("a panel's Start reaches the host with the plan and the press's own key, hears the agent, and the agent is noted", async () => {
  const { client, asked, noted } = windowPort(PANEL, {
    answers: { codingAgentStart: () => Effect.succeed(STARTED) },
  });

  const started = await settled(client, AGENT_ACT_KIND.CODING_AGENTS_START, {
    taskId: TASK_ID,
    idempotencyKey: "press-1",
  });

  assert.deepEqual(started, { answer: STARTED });
  assert.deepEqual(asked, [["codingAgentStart", { taskId: TASK_ID, idempotencyKey: "press-1" }]]);
  assert.deepEqual(noted, [`agents:${AGENT_ID}=${CODING_AGENT_STATUS.STARTING}`]);
});

it("a rename, an archive, or a pin answering an agent with no plan reads the plan list again, which lists it, and one on a plan does not", async () => {
  const unplaced = { agent: { ...STARTED.agent, planId: null } };
  const answered = () => Effect.succeed(unplaced);
  const taskless = windowPort(PANEL, {
    answers: {
      codingAgentRename: answered,
      codingAgentArchive: answered,
      codingAgentPin: answered,
    },
  });
  const onTask = windowPort(PANEL, {
    answers: { codingAgentRename: () => Effect.succeed(STARTED) },
  });
  const rename = { agentId: AGENT_ID, title: "Triage" };

  await settled(taskless.client, AGENT_ACT_KIND.CODING_AGENTS_RENAME, rename);
  await settled(taskless.client, AGENT_ACT_KIND.CODING_AGENTS_ARCHIVE, {
    agentId: AGENT_ID,
    archived: true,
  });
  await settled(taskless.client, AGENT_ACT_KIND.CODING_AGENTS_PIN, {
    agentId: AGENT_ID,
    pinned: true,
  });
  await settled(onTask.client, AGENT_ACT_KIND.CODING_AGENTS_RENAME, rename);

  assert.deepEqual(taskless.asked, [
    ["codingAgentRename", rename],
    ["tasksRefresh"],
    ["codingAgentArchive", { agentId: AGENT_ID, archived: true }],
    ["tasksRefresh"],
    ["codingAgentPin", { agentId: AGENT_ID, pinned: true }],
    ["tasksRefresh"],
  ]);
  assert.deepEqual(onTask.asked, [["codingAgentRename", rename]]);
});

it("a panel's reads are noted on their way: the models, a task's agents or the task gone, and an agent's title before its status, but a worker's page is no word on the agent", async () => {
  const { client, noted } = windowPort(PANEL, {
    answers: {
      codingAgentModels: () => Effect.succeed({ models: [] }),
      codingAgentList: () => Effect.succeed({ failure: CODING_AGENT_CALL_FAILURE.NOT_FOUND }),
      codingAgentMessages: () =>
        Effect.succeed({
          messages: [],
          cursor: "0",
          status: CODING_AGENT_STATUS.RUNNING,
          title: "Triage",
        }),
      codingAgentMessage: () => Effect.succeed(STARTED),
    },
  });

  await settled(client, AGENT_ACT_KIND.CODING_AGENTS_MODELS, undefined);
  await settled(client, AGENT_ACT_KIND.CODING_AGENTS_LIST, { taskId: TASK_ID });
  await settled(client, AGENT_ACT_KIND.CODING_AGENTS_MESSAGES, { agentId: AGENT_ID, after: "0" });
  await settled(client, AGENT_ACT_KIND.CODING_AGENTS_MESSAGES, {
    agentId: AGENT_ID,
    after: "0",
    callId: "call-worker",
  });
  await settled(client, AGENT_ACT_KIND.CODING_AGENTS_MESSAGE, {
    agentId: AGENT_ID,
    text: "Carry on.",
    clientKey: "send-1",
  });

  assert.deepEqual(noted, [
    "models:0",
    `gone:${TASK_ID}`,
    `title:${AGENT_ID}=Triage`,
    `status:${AGENT_ID}=${CODING_AGENT_STATUS.RUNNING}`,
    `messaged:${AGENT_ID}=${CODING_AGENT_STATUS.STARTING}`,
  ]);
});

it("a panel's word on what it shows is noted whole, the Chat as none where it names none, and answers nothing", async () => {
  const { client, asked, noted } = windowPort(PANEL);
  const chat = { workspaceId: WORKSPACE_ID, taskId: TASK_ID };

  const named = await settled(client, AGENT_ACT_KIND.CODING_AGENTS_SHOWN, {
    agentId: AGENT_ID,
    inboxTaskId: TASK_ID,
    chatShown: chat,
  });
  const none = await settled(client, AGENT_ACT_KIND.CODING_AGENTS_SHOWN, {
    agentId: null,
    inboxTaskId: null,
  });

  assert.deepEqual(named, { answer: undefined });
  assert.deepEqual(none, { answer: undefined });
  assert.deepEqual(noted, [
    `shown:${AGENT_ID}`,
    `inbox:${TASK_ID}`,
    `chat:${JSON.stringify(chat)}`,
    "shown:null",
    "inbox:null",
    "chat:null",
  ]);
  assert.deepEqual(asked, []);
});

it("a host that dies, or answers what the kind cannot carry, is refused in the kind's own words", async () => {
  const died = windowPort(PANEL, { fallback: () => Effect.die(new Error("secret detail")) });
  const malformed = windowPort(PANEL, { fallback: () => Effect.succeed({ agents: "none" }) });
  for (const { client } of [died, malformed]) {
    for (const act of ACTS) {
      if (act.ask === undefined) continue;
      assert.deepEqual(await settled(client, act.kind, act.payload), {
        refused: REFUSAL[act.kind],
      });
    }
  }
});

it("a payload carrying a key its kind's schema does not name is refused in the kind's own words, and the host is not asked nor anything noted", async () => {
  const { client, asked, noted } = windowPort(PANEL);
  assert.deepEqual(
    await settled(client, AGENT_ACT_KIND.CODING_AGENTS_STOP, { agentId: AGENT_ID, stray: true }),
    { refused: REFUSAL[AGENT_ACT_KIND.CODING_AGENTS_STOP] },
  );
  assert.deepEqual(
    await settled(client, AGENT_ACT_KIND.CODING_AGENTS_SHOWN, {
      agentId: AGENT_ID,
      inboxTaskId: null,
      stray: true,
    }),
    { refused: REFUSAL[AGENT_ACT_KIND.CODING_AGENTS_SHOWN] },
  );
  assert.deepEqual(asked, []);
  assert.deepEqual(noted, []);
});

it("a payload its kind's schema refuses, or one sent to a kind that carries none, is refused in the kind's own words, and the host is not asked nor anything noted", async () => {
  const { client, asked, noted } = windowPort(PANEL);
  assert.deepEqual(
    await settled(client, AGENT_ACT_KIND.CODING_AGENTS_SHOWN, { agentId: " ", inboxTaskId: null }),
    { refused: REFUSAL[AGENT_ACT_KIND.CODING_AGENTS_SHOWN] },
  );
  assert.deepEqual(await settled(client, AGENT_ACT_KIND.CODING_AGENTS_LIST, { taskId: "" }), {
    refused: REFUSAL[AGENT_ACT_KIND.CODING_AGENTS_LIST],
  });
  assert.deepEqual(
    await settled(client, AGENT_ACT_KIND.CODING_AGENTS_MODELS, { workspaceId: WORKSPACE_ID }),
    { refused: REFUSAL[AGENT_ACT_KIND.CODING_AGENTS_MODELS] },
  );
  assert.deepEqual(asked, []);
  assert.deepEqual(noted, []);
});
