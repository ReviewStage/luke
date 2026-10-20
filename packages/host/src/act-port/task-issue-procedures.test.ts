import assert from "node:assert/strict";
import { afterEach, it } from "@effect/vitest";
import { TASK_ISSUE_PROVIDER, TASK_ISSUE_RELATION } from "@luke/features/task-issue-wire";
import { TASK_CALL_FAILURE } from "@luke/features/tasks-view";
import { createORPCClient, ORPCError } from "@orpc/client";
import { RPCLink } from "@orpc/client/message-port";
import { Context, Effect } from "effect";
import type { ActSender } from "../act-router/router.js";
import {
  ACT_ERROR,
  type ActPortClient,
  type PortActKind,
  type PortActPayload,
  type PortActResult,
  TASK_ISSUE_ACT_KIND,
} from "../contract/index.js";
import {
  type ActPortDependencies,
  createActPortHandler,
  type PlatformActProcedures,
  type TaskIssueProceduresDependencies,
  type TasksProceduresDependencies,
  WindowPushes,
  type WorkspaceProceduresDependencies,
} from "./index.js";

/**
 * A task page's acts on the issues the task links, through the act port as
 * a window calls them: only a panel of this build's own renderer asks; the voice and call windows, and
 * a frame this build does not trust, are refused in each kind's own words
 * before the host is asked; a panel's ask reaches the host with its payload
 * as the panel sent it; and a host that fails answers the kind's own
 * sentence rather than what the failure held.
 */

// The platform's handle on the window that asked, which no procedure here reads.
const SENDER = Symbol("window");

const PANEL: ActSender = { sender: SENDER, panel: true, voice: false, call: false };
const VOICE: ActSender = { ...PANEL, panel: false, voice: true };
const CALL: ActSender = { ...PANEL, panel: false, call: true };

const TASK_ID = "3f0e6f5c-7d1a-4f6e-9a55-1b2c3d4e5f60";
const LINK_ID = "9a0e6f5c-7d1a-4f6e-9a55-1b2c3d4e5f61";

/** Each kind's refusal, in its own words. */
const REFUSAL = {
  [TASK_ISSUE_ACT_KIND.TASK_ISSUES_READ]: "Could not read the task's issues on this system.",
  [TASK_ISSUE_ACT_KIND.TASK_ISSUES_LINK]: "Could not link that issue on this system.",
  [TASK_ISSUE_ACT_KIND.TASK_ISSUES_RELATE]: "Could not change that issue's keyword on this system.",
  [TASK_ISSUE_ACT_KIND.TASK_ISSUES_UNLINK]: "Could not unlink that issue on this system.",
} as const;

const ACTS = [
  { kind: TASK_ISSUE_ACT_KIND.TASK_ISSUES_READ, payload: { taskId: TASK_ID } },
  {
    kind: TASK_ISSUE_ACT_KIND.TASK_ISSUES_LINK,
    payload: {
      taskId: TASK_ID,
      issue: { provider: TASK_ISSUE_PROVIDER.GITHUB, repository: "acme/relay", number: 7 },
    },
  },
  {
    kind: TASK_ISSUE_ACT_KIND.TASK_ISSUES_RELATE,
    payload: { taskId: TASK_ID, linkId: LINK_ID, relation: TASK_ISSUE_RELATION.PART_OF },
  },
  { kind: TASK_ISSUE_ACT_KIND.TASK_ISSUES_UNLINK, payload: { taskId: TASK_ID, linkId: LINK_ID } },
] as const;

type HostAsk = TaskIssueProceduresDependencies["host"];

/** The params any one of the host's task issue asks takes. */
type TaskIssueParams = Parameters<HostAsk[keyof HostAsk]>[0];

/** The workspace procedures' host, never asked here. */
const NO_WORKSPACES: WorkspaceProceduresDependencies = {
  // SAFETY: no test here calls a workspace kind, so no method of this host is ever read.
  host: {} as WorkspaceProceduresDependencies["host"],
  openExternal: () => Promise.resolve(),
};

const opened: MessagePort[] = [];

afterEach(() => {
  for (const port of opened.splice(0)) port.close();
});

/**
 * A window's act port, opened as the bridge opens one: the host's answer
 * given by `answer`, and the window standing as `actor`, trusted or not.
 */
function windowPort(
  actor: ActSender,
  options: { trusted?: boolean; answer?: (name: string) => Effect.Effect<unknown> } = {},
) {
  const asked: unknown[] = [];
  const answer =
    options.answer ?? (() => Effect.succeed({ failure: TASK_CALL_FAILURE.UNANSWERED }));
  const ask = (name: string) => (params: TaskIssueParams) =>
    Effect.suspend(() => {
      asked.push([name, params]);
      return answer(name);
    });
  // SAFETY: each fake answers what its test hands it; the port's output schema checks it.
  const host = {
    tasksIssueLinks: ask("read"),
    tasksIssueLink: ask("link"),
    tasksIssueRelate: ask("relate"),
    tasksIssueUnlink: ask("unlink"),
  } as HostAsk;
  // SAFETY: no account, account ask, or settings act is called here, so none of their dependencies is reached.
  const unreached = { accountAsks: { host: {} }, account: {}, settings: {} } as unknown as Pick<
    ActPortDependencies,
    "account" | "accountAsks" | "settings"
  >;
  // SAFETY: these tests call the task issue kinds alone, so no platform procedure is reached.
  const platform = {} as PlatformActProcedures<unknown>;
  // SAFETY: no task act is called here, so the tasks' host and doors are never reached.
  const tasks = { host: {} } as TasksProceduresDependencies;
  // SAFETY: no agent, inbox, chat, automation, factory, or integration act is called here, so their hosts are never reached.
  const elsewhere = {
    agentInbox: { host: {} },
    agents: { host: {}, notices: {} },
    automations: { host: {} },
    factory: { host: {} },
    integrations: { host: {} },
  } as Pick<
    ActPortDependencies,
    "agentInbox" | "agents" | "automations" | "factory" | "integrations"
  >;
  const handler = createActPortHandler(
    {
      ...unreached,
      ...elsewhere,
      pushes: new WindowPushes(),
      taskIssues: { host },
      tasks,
      workspaces: NO_WORKSPACES,
    },
    platform,
  );
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
  return { client, asked };
}

/** Any port kind's procedure, erased to the union of what every one takes and answers. */
type PortCall = (payload: PortActPayload<PortActKind>) => Promise<PortActResult<PortActKind>>;

function portCall(client: ActPortClient, kind: PortActKind): PortCall {
  // SAFETY: each test pairs a kind with the payload its own procedure takes, or one it refuses on purpose.
  return client[kind] as PortCall;
}

/** One act called on the port, settled to its answer or the sentence of its refusal. */
async function settled(client: ActPortClient, act: (typeof ACTS)[number]) {
  const call = portCall(client, act.kind);
  try {
    return { answer: await call(act.payload) };
  } catch (error) {
    assert.ok(error instanceof ORPCError);
    assert.equal(error.code, ACT_ERROR.REFUSED);
    return { refused: error.message };
  }
}

it("the voice and call windows are refused every task issue act in the kind's own words, and the host is not asked", async () => {
  for (const actor of [VOICE, CALL]) {
    const { client, asked } = windowPort(actor);
    for (const act of ACTS) {
      assert.deepEqual(await settled(client, act), { refused: REFUSAL[act.kind] });
    }
    assert.deepEqual(asked, []);
  }
});

it("a frame this build does not trust is refused every task issue act, even as a panel, and the host is not asked", async () => {
  const { client, asked } = windowPort(PANEL, { trusted: false });
  for (const act of ACTS) {
    assert.deepEqual(await settled(client, act), { refused: REFUSAL[act.kind] });
  }
  assert.deepEqual(asked, []);
});

it("a panel's ask reaches the host with its payload, and the host's answer is the panel's", async () => {
  const { client, asked } = windowPort(PANEL);
  for (const act of ACTS) {
    assert.deepEqual(await settled(client, act), {
      answer: { failure: TASK_CALL_FAILURE.UNANSWERED },
    });
  }
  assert.deepEqual(
    asked,
    ACTS.map((act, index) => [["read", "link", "relate", "unlink"][index], act.payload]),
  );
});

it("a host that dies, or answers what the kind cannot carry, is refused in the kind's own words", async () => {
  const died = windowPort(PANEL, { answer: () => Effect.die(new Error("secret detail")) });
  const malformed = windowPort(PANEL, { answer: () => Effect.succeed({ issues: "none" }) });
  for (const { client } of [died, malformed]) {
    for (const act of ACTS) {
      assert.deepEqual(await settled(client, act), { refused: REFUSAL[act.kind] });
    }
  }
});

it("a payload its kind's schema refuses is refused in the kind's own words, and the host is not asked", async () => {
  const { client, asked } = windowPort(PANEL);
  const call = portCall(client, TASK_ISSUE_ACT_KIND.TASK_ISSUES_LINK);
  // SAFETY: the provider no task links is the point; a window's payload crosses as a structured-clone value.
  const jira = {
    taskId: TASK_ID,
    issue: { provider: "jira", id: "JRA-1" },
  } as unknown as PortActPayload<PortActKind>;
  await assert.rejects(
    call(jira),
    (error) =>
      error instanceof ORPCError &&
      error.code === ACT_ERROR.REFUSED &&
      error.message === REFUSAL[TASK_ISSUE_ACT_KIND.TASK_ISSUES_LINK],
  );
  assert.deepEqual(asked, []);
});
