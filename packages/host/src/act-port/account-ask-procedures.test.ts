import assert from "node:assert/strict";
import { afterEach, it } from "@effect/vitest";
import { CODING_AGENT_CALL_FAILURE } from "@luke/features/coding-agent-view";
import { PROVIDER_KEY_PROVIDER } from "@luke/features/provider-key-wire";
import { createORPCClient, ORPCError } from "@orpc/client";
import { RPCLink } from "@orpc/client/message-port";
import { Context, Effect } from "effect";
import type { ActSender } from "../act-router/router.js";
import {
  ACCOUNT_ASK_ACT_KIND,
  ACT_ERROR,
  type ActPortClient,
  type PortActKind,
  type PortActPayload,
  type PortActResult,
} from "../contract/index.js";
import {
  type AccountAskProceduresDependencies,
  type ActPortDependencies,
  createActPortHandler,
  type IssueProceduresDependencies,
  type PlatformActProcedures,
  type TasksProceduresDependencies,
  type WorkspaceProceduresDependencies,
} from "./index.js";

/**
 * The account's own asks, through the act port as a window calls them: only
 * a panel of this build's own renderer asks; the voice and call windows, and
 * a frame this build does not trust, are refused in each kind's own words
 * before the host is asked; a panel's ask reaches the host with its payload
 * as the panel sent it, and a kind that carries nothing with nothing; a
 * provider key crosses once and never comes back in a refusal; and a host
 * that fails answers the kind's own sentence rather than what the failure held.
 */

// The platform's handle on the window that asked, which no procedure here reads.
const SENDER = Symbol("window");

const PANEL: ActSender = { sender: SENDER, panel: true, voice: false, call: false };
const VOICE: ActSender = { ...PANEL, panel: false, voice: true };
const CALL: ActSender = { ...PANEL, panel: false, call: true };

/** A synthetic provider key, as Settings carries it once. */
const PROVIDER_KEY = "sk-proj-synthetic-00000000000000000000abcd";

/** Each kind's refusal, as the window drew it before the kinds moved onto the port. */
const REFUSAL = {
  [ACCOUNT_ASK_ACT_KIND.PROVIDER_KEYS_READ]: "Could not read your API keys on this system.",
  [ACCOUNT_ASK_ACT_KIND.PROVIDER_KEYS_SAVE]: "Could not save your API key on this system.",
  [ACCOUNT_ASK_ACT_KIND.PROVIDER_KEYS_REMOVE]: "Could not remove your API key on this system.",
  [ACCOUNT_ASK_ACT_KIND.PLAN_TEMPLATE_READ]: "Could not read your plan template on this system.",
  [ACCOUNT_ASK_ACT_KIND.PLAN_TEMPLATE_WRITE]: "Could not save your plan template on this system.",
  [ACCOUNT_ASK_ACT_KIND.PLAN_TEMPLATE_REVISIONS]:
    "Could not read your plan template's history on this system.",
  [ACCOUNT_ASK_ACT_KIND.PLAN_TEMPLATE_REVISION]: "Could not read that version on this system.",
  [ACCOUNT_ASK_ACT_KIND.PLAN_TEMPLATE_RESTORE]: "Could not restore that version on this system.",
  [ACCOUNT_ASK_ACT_KIND.DICTATION_TRANSCRIBE]: "Could not transcribe the recording on this system.",
} as const;

/** Every kind, each with a payload its schema admits and the host ask it reaches. */
const ACTS = [
  { kind: ACCOUNT_ASK_ACT_KIND.PROVIDER_KEYS_READ, payload: undefined, ask: "providerKeysRead" },
  {
    kind: ACCOUNT_ASK_ACT_KIND.PROVIDER_KEYS_SAVE,
    payload: { provider: PROVIDER_KEY_PROVIDER.OPENAI, key: PROVIDER_KEY },
    ask: "providerKeySave",
  },
  {
    kind: ACCOUNT_ASK_ACT_KIND.PROVIDER_KEYS_REMOVE,
    payload: { provider: PROVIDER_KEY_PROVIDER.OPENAI },
    ask: "providerKeyRemove",
  },
  { kind: ACCOUNT_ASK_ACT_KIND.PLAN_TEMPLATE_READ, payload: undefined, ask: "planTemplateRead" },
  {
    kind: ACCOUNT_ASK_ACT_KIND.PLAN_TEMPLATE_WRITE,
    payload: { template: "## Why\n" },
    ask: "planTemplateWrite",
  },
  {
    kind: ACCOUNT_ASK_ACT_KIND.PLAN_TEMPLATE_REVISIONS,
    payload: { before: 4 },
    ask: "planTemplateRevisions",
  },
  {
    kind: ACCOUNT_ASK_ACT_KIND.PLAN_TEMPLATE_REVISION,
    payload: { seq: 3 },
    ask: "planTemplateRevision",
  },
  {
    kind: ACCOUNT_ASK_ACT_KIND.PLAN_TEMPLATE_RESTORE,
    payload: { seq: 3 },
    ask: "planTemplateRestore",
  },
  {
    kind: ACCOUNT_ASK_ACT_KIND.DICTATION_TRANSCRIBE,
    payload: { audio: "GkXfow==", durationMs: 1200, keywords: ["Luke"] },
    ask: "dictationTranscribe",
  },
] as const;

type HostAsk = AccountAskProceduresDependencies["host"];

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
  options: { trusted?: boolean; answer?: () => Effect.Effect<unknown> } = {},
) {
  const asked: unknown[] = [];
  const answer =
    options.answer ?? (() => Effect.succeed({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED }));
  const ask =
    (name: keyof HostAsk) =>
    (...params: unknown[]) =>
      Effect.suspend(() => {
        asked.push(params.length === 0 ? [name] : [name, params[0]]);
        return answer();
      });
  // SAFETY: each fake answers what its test hands it; the port's output schema checks it.
  const host = Object.fromEntries(ACTS.map((act) => [act.ask, ask(act.ask)])) as HostAsk;
  // SAFETY: no issue act is called here, so the issues' host is never reached.
  const issues = { host: {} } as IssueProceduresDependencies;
  // SAFETY: no workspace act is called here, so the workspaces' host is never reached.
  const workspaces = { host: {} } as WorkspaceProceduresDependencies;
  // SAFETY: no platform act is called here, so no platform procedure is reached.
  const platform = {} as PlatformActProcedures<unknown>;
  // SAFETY: no task act is called here, so the tasks' host and doors are never reached.
  const tasks = { host: {} } as TasksProceduresDependencies;
  // SAFETY: no account or settings act is called here, so neither's dependencies are reached.
  const unreached = { account: {}, settings: {} } as unknown as Pick<
    ActPortDependencies,
    "account" | "settings"
  >;
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
    { ...unreached, ...elsewhere, accountAsks: { host }, issues, tasks, workspaces },
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

/** One kind called on the port with `payload`, settled to its answer or the sentence of its refusal. */
async function settled(
  client: ActPortClient,
  kind: PortActKind,
  payload: PortActPayload<PortActKind>,
) {
  const call = portCall(client, kind);
  try {
    return { answer: await call(payload) };
  } catch (error) {
    assert.ok(error instanceof ORPCError);
    assert.equal(error.code, ACT_ERROR.REFUSED);
    return { refused: error.message };
  }
}

it("the voice and call windows are refused every account ask in the kind's own words, a provider key among them, and the host is not asked", async () => {
  for (const actor of [VOICE, CALL]) {
    const { client, asked } = windowPort(actor);
    const refused = [];
    for (const act of ACTS) {
      const outcome = await settled(client, act.kind, act.payload);
      assert.deepEqual(outcome, { refused: REFUSAL[act.kind] });
      refused.push(outcome);
    }
    assert.deepEqual(asked, []);
    assert.ok(!JSON.stringify(refused).includes(PROVIDER_KEY));
  }
});

it("a frame this build does not trust is refused every account ask, even as a panel, and the host is not asked", async () => {
  const { client, asked } = windowPort(PANEL, { trusted: false });
  for (const act of ACTS) {
    assert.deepEqual(await settled(client, act.kind, act.payload), {
      refused: REFUSAL[act.kind],
    });
  }
  assert.deepEqual(asked, []);
});

it("a panel's ask reaches the host once with its payload, a kind that carries nothing with nothing, and the host's answer is the panel's", async () => {
  const { client, asked } = windowPort(PANEL);
  for (const act of ACTS) {
    assert.deepEqual(await settled(client, act.kind, act.payload), {
      answer: { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED },
    });
  }
  assert.deepEqual(
    asked,
    ACTS.map((act) => (act.payload === undefined ? [act.ask] : [act.ask, act.payload])),
  );
});

it("a host that dies, or answers what the kind cannot carry, is refused in the kind's own words", async () => {
  const died = windowPort(PANEL, { answer: () => Effect.die(new Error("secret detail")) });
  const malformed = windowPort(PANEL, { answer: () => Effect.succeed({ keys: "none" }) });
  for (const { client } of [died, malformed]) {
    for (const act of ACTS) {
      assert.deepEqual(await settled(client, act.kind, act.payload), {
        refused: REFUSAL[act.kind],
      });
    }
  }
});

it("a payload carrying a key its kind's schema does not name is refused in the kind's own words, and the host is not asked", async () => {
  const { client, asked } = windowPort(PANEL);
  // SAFETY: the stray key is the point; a window's payload crosses as a structured-clone value.
  const strayed = { seq: 3, stray: true } as PortActPayload<PortActKind>;
  assert.deepEqual(await settled(client, ACCOUNT_ASK_ACT_KIND.PLAN_TEMPLATE_RESTORE, strayed), {
    refused: REFUSAL[ACCOUNT_ASK_ACT_KIND.PLAN_TEMPLATE_RESTORE],
  });
  assert.deepEqual(asked, []);
});

it("a payload its kind's schema refuses, or one sent to a kind that carries none, is refused in the kind's own words, and the host is not asked", async () => {
  const { client, asked } = windowPort(PANEL);
  assert.deepEqual(
    await settled(client, ACCOUNT_ASK_ACT_KIND.PROVIDER_KEYS_SAVE, {
      provider: PROVIDER_KEY_PROVIDER.OPENAI,
      key: "short",
    }),
    { refused: REFUSAL[ACCOUNT_ASK_ACT_KIND.PROVIDER_KEYS_SAVE] },
  );
  assert.deepEqual(
    await settled(client, ACCOUNT_ASK_ACT_KIND.PLAN_TEMPLATE_READ, { template: "## Why\n" }),
    { refused: REFUSAL[ACCOUNT_ASK_ACT_KIND.PLAN_TEMPLATE_READ] },
  );
  assert.deepEqual(asked, []);
});
