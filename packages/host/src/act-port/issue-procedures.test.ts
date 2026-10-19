import assert from "node:assert/strict";
import { afterEach, it } from "@effect/vitest";
import { ISSUE_CALL_FAILURE } from "@luke/features/issue-view";
import { createORPCClient, ORPCError } from "@orpc/client";
import { RPCLink } from "@orpc/client/message-port";
import { Context, Effect } from "effect";
import type { ActSender } from "../act-router/router.js";
import {
  ACT_ERROR,
  type ActPortClient,
  ISSUE_ACT_KIND,
  type PortActKind,
  type PortActPayload,
  type PortActResult,
} from "../contract/index.js";
import {
  type AccountAskProceduresDependencies,
  createActPortHandler,
  type IssueProceduresDependencies,
  type PlatformActProcedures,
  type WorkspaceProceduresDependencies,
} from "./index.js";

/**
 * The Issues page's acts, through the act port as a window calls them: only
 * a panel of this build's own renderer asks; the voice and call windows, and
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

const ISSUE_ID = "3f0e6f5c-7d1a-4f6e-9a55-1b2c3d4e5f60";
const WORKSPACE_ID = "workspace-1";

/** Each kind's refusal, as the window drew it before the kinds moved onto the port. */
const REFUSAL = {
  [ISSUE_ACT_KIND.ISSUES_LIST]: "Could not read the issues on this system.",
  [ISSUE_ACT_KIND.ISSUES_READ]: "Could not read the issue on this system.",
  [ISSUE_ACT_KIND.ISSUES_CREATE]: "Could not create the issue on this system.",
  [ISSUE_ACT_KIND.ISSUES_CHANGE]: "Could not change the issue on this system.",
} as const;

const ACTS = [
  { kind: ISSUE_ACT_KIND.ISSUES_LIST, payload: { workspaceId: WORKSPACE_ID } },
  { kind: ISSUE_ACT_KIND.ISSUES_READ, payload: { issueId: ISSUE_ID } },
  { kind: ISSUE_ACT_KIND.ISSUES_CREATE, payload: { workspaceId: WORKSPACE_ID, title: "Bug" } },
  { kind: ISSUE_ACT_KIND.ISSUES_CHANGE, payload: { issueId: ISSUE_ID, change: { title: "Bug" } } },
] as const;

type HostAsk = IssueProceduresDependencies["host"];

/** The params any one of the host's issue asks takes. */
type IssueParams = Parameters<HostAsk[keyof HostAsk]>[0];

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
    options.answer ?? (() => Effect.succeed({ failure: ISSUE_CALL_FAILURE.UNANSWERED }));
  const ask = (name: string) => (params: IssueParams) =>
    Effect.suspend(() => {
      asked.push([name, params]);
      return answer(name);
    });
  // SAFETY: each fake answers what its test hands it; the port's output schema checks it.
  const host = {
    issueList: ask("list"),
    issueRead: ask("read"),
    issueCreate: ask("create"),
    issueChange: ask("change"),
  } as HostAsk;
  // SAFETY: no account ask is called here, so the account asks' host is never reached.
  const accountAsks = { host: {} } as AccountAskProceduresDependencies;
  // SAFETY: these tests call the issue kinds alone, so no platform procedure is reached.
  const platform = {} as PlatformActProcedures<unknown>;
  const handler = createActPortHandler(
    { accountAsks, issues: { host }, workspaces: NO_WORKSPACES },
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

it("the voice and call windows are refused every issue act in the kind's own words, and the host is not asked", async () => {
  for (const actor of [VOICE, CALL]) {
    const { client, asked } = windowPort(actor);
    for (const act of ACTS) {
      assert.deepEqual(await settled(client, act), { refused: REFUSAL[act.kind] });
    }
    assert.deepEqual(asked, []);
  }
});

it("a frame this build does not trust is refused every issue act, even as a panel, and the host is not asked", async () => {
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
      answer: { failure: ISSUE_CALL_FAILURE.UNANSWERED },
    });
  }
  assert.deepEqual(
    asked,
    ACTS.map((act, index) => [["list", "read", "create", "change"][index], act.payload]),
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
  const call = portCall(client, ISSUE_ACT_KIND.ISSUES_CREATE);
  await assert.rejects(
    call({ workspaceId: WORKSPACE_ID, title: " " }),
    (error) =>
      error instanceof ORPCError &&
      error.code === ACT_ERROR.REFUSED &&
      error.message === REFUSAL[ISSUE_ACT_KIND.ISSUES_CREATE],
  );
  assert.deepEqual(asked, []);
});

it("a payload carrying a key its kind's schema does not name is refused in the kind's own words, and the host is not asked", async () => {
  const { client, asked } = windowPort(PANEL);
  const call = portCall(client, ISSUE_ACT_KIND.ISSUES_LIST);
  // SAFETY: the stray key is the point; a window's payload crosses as a structured-clone value.
  const strayed = { workspaceId: WORKSPACE_ID, stray: true } as PortActPayload<PortActKind>;
  await assert.rejects(
    call(strayed),
    (error) =>
      error instanceof ORPCError &&
      error.code === ACT_ERROR.REFUSED &&
      error.message === REFUSAL[ISSUE_ACT_KIND.ISSUES_LIST],
  );
  assert.deepEqual(asked, []);
});
