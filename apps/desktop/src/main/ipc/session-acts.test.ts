import assert from "node:assert/strict";
import test from "node:test";
import { type ActEnvelope, APP_TOOL_KIND, SESSION_TOOL_KIND } from "@sidecar/acts";
import { PRODUCT_EVENT, PRODUCT_SESSION_ACT, type RecordProductEvent } from "@sidecar/analytics";
import type { WorkspaceHostRegistration } from "@sidecar/providers";
import {
  InMemorySessionRegistry,
  PROVIDER_ID,
  type ProviderControlRequest,
  type ProviderControlResult,
  type ProviderMessageResult,
  type ProviderSessionMessage,
  type ProviderSessionObservation,
  SESSION_STATUS,
  SessionProviderAdapterBase,
} from "@sidecar/session";
import { ACT_RESULT_STATUS, type UnparsedWireValue } from "@sidecar/wire";
import type { IpcMain } from "electron";
import { BRIDGE } from "#shared/bridge";
import { invokeEvent } from "../../testing/ipc-fixtures";
import type { SettingsStore } from "../settings-store";
import {
  authorizeActEnvelope,
  forgetRememberedFact,
  registerSessionActsIpc,
  saveRememberedFact,
} from "./session-acts";

const identity = { providerId: "claude-code", providerSessionId: "session-a" } as const;
const openSession = {
  id: "open_session",
  armed: true,
  act: { kind: SESSION_TOOL_KIND.OPEN, identity },
} satisfies ActEnvelope;

function authorization(registry = new InMemorySessionRegistry()) {
  return {
    sessionRegistry: registry,
    adapterFor: () => undefined,
    trackedIssues: () => undefined,
    rememberedFacts: () => [],
  };
}

test("main authorization requires the developer-opened turn flag", () => {
  const result = authorizeActEnvelope({ ...openSession, armed: false }, authorization());
  assert.equal(result.status, ACT_RESULT_STATUS.REJECTED);
  assert.match(
    result.status === ACT_RESULT_STATUS.REJECTED ? result.reason : "",
    /developer opened/,
  );
});

test("main authorization revalidates a session against its latest roster", () => {
  const registry = new InMemorySessionRegistry();
  const missing = authorizeActEnvelope(openSession, authorization(registry));
  assert.equal(missing.status, ACT_RESULT_STATUS.REJECTED);
  assert.match(
    missing.status === ACT_RESULT_STATUS.REJECTED ? missing.reason : "",
    /observed session/,
  );

  registry.upsert(
    { id: identity.providerId, displayName: "Claude Code" },
    {
      providerSessionId: identity.providerSessionId,
      title: "Checkout service",
      status: SESSION_STATUS.WORKING,
      lastActivityAt: 1_800_000_000_000,
    },
  );
  assert.deepEqual(authorizeActEnvelope(openSession, authorization(registry)), {
    status: ACT_RESULT_STATUS.ACCEPTED,
  });
});

test("main authorization refuses an act id outside the registry", () => {
  // SAFETY: This deliberately bypasses the renderer-side wire guard to exercise
  // the main process's independent unknown-id refusal.
  const unknown = { ...openSession, id: "not_an_act" } as ActEnvelope;
  const result = authorizeActEnvelope(unknown, authorization());
  assert.equal(result.status, ACT_RESULT_STATUS.REJECTED);
  assert.match(result.status === ACT_RESULT_STATUS.REJECTED ? result.reason : "", /No such act/);
});

test("main authorization revalidates a remembered entry against the store it will write", () => {
  const held = [{ id: "fact-one", words: "stop telling me about CI" }];
  const facts = { ...authorization(), rememberedFacts: () => held };

  const forgetting = {
    id: "forget_fact",
    armed: true,
    act: { kind: APP_TOOL_KIND.FORGET, id: "fact-one" },
  } satisfies ActEnvelope;
  assert.deepEqual(authorizeActEnvelope(forgetting, facts), {
    status: ACT_RESULT_STATUS.ACCEPTED,
  });

  // The renderer validated against the list it was shown; a list that moved
  // between the showing and the act is what this second check is for.
  assert.equal(
    authorizeActEnvelope(forgetting, authorization()).status,
    ACT_RESULT_STATUS.REJECTED,
  );

  // A new fact names nothing, and needs no entry to exist.
  assert.deepEqual(
    authorizeActEnvelope(
      { id: "remember_fact", armed: true, act: { kind: APP_TOOL_KIND.REMEMBER, words: "new" } },
      authorization(),
    ),
    { status: ACT_RESULT_STATUS.ACCEPTED },
  );
});

test("memory writes deduplicate and leave state unchanged when persistence fails", () => {
  const held = [{ id: "fact-one", words: "prefers concise answers" }];
  let writes = 0;
  const write = () => {
    writes += 1;
    return false;
  };

  assert.equal(
    saveRememberedFact(held, "prefers concise answers", undefined, "duplicate", write),
    held,
  );
  assert.equal(writes, 0);
  assert.equal(saveRememberedFact(held, "works on macOS", undefined, "new", write), held);
  assert.equal(forgetRememberedFact(held, "fact-one", write), held);
  assert.equal(writes, 2);
});

test("replacing a fact with existing wording removes the contradicted entry", () => {
  const held = [
    { id: "fact-one", words: "prefers detailed answers" },
    { id: "fact-two", words: "prefers concise answers" },
  ];
  let written: readonly { id: string; words: string }[] | undefined;

  const next = saveRememberedFact(
    held,
    "prefers concise answers",
    "fact-one",
    "replacement",
    (facts) => {
      written = facts;
      return true;
    },
  );

  assert.deepEqual(next, [held[1]]);
  assert.deepEqual(written, next);
});

// --- The performer routes a hosted session's acts to its host ---

class RecordingAdapter extends SessionProviderAdapterBase {
  readonly provider = { id: PROVIDER_ID.CODEX, displayName: "Codex" };
  readonly sent: string[] = [];
  readonly controls: string[] = [];
  observations = 0;

  async observe(): Promise<readonly ProviderSessionObservation[]> {
    this.observations += 1;
    return [];
  }

  override async sendMessage(message: ProviderSessionMessage): Promise<ProviderMessageResult> {
    this.sent.push(message.text);
    return { status: ACT_RESULT_STATUS.ACCEPTED };
  }

  override async executeControl(request: ProviderControlRequest): Promise<ProviderControlResult> {
    this.controls.push(request.control.id);
    return { status: ACT_RESULT_STATUS.ACCEPTED };
  }
}

interface PerformerHarness {
  invoke: (channel: string, ...args: readonly UnparsedWireValue[]) => Promise<UnparsedWireValue>;
  adapter: RecordingAdapter;
  hostCalls: string[];
  events: Array<{ event: string; properties: Record<string, string> }>;
}

const HOSTED = { providerId: PROVIDER_ID.CODEX, providerSessionId: "hosted" } as const;
const UNHOSTED = { providerId: PROVIDER_ID.CODEX, providerSessionId: "unhosted" } as const;
const HOST_CONTROL = "host-delete";
const PROVIDER_CONTROL = "cancel";

function performer(): PerformerHarness {
  type InvokeHandler = Parameters<IpcMain["handle"]>[1];
  const handlers = new Map<string, InvokeHandler>();
  const registry = new InMemorySessionRegistry();
  const adapter = new RecordingAdapter();
  for (const identity of [HOSTED, UNHOSTED]) {
    registry.upsert(adapter.provider, {
      providerSessionId: identity.providerSessionId,
      title: identity.providerSessionId,
      status: SESSION_STATUS.WORKING,
      lastActivityAt: 1_800_000_000_000,
      canReceiveMessage: true,
      controls: [
        { id: HOST_CONTROL, label: "Delete workspace" },
        { id: PROVIDER_CONTROL, label: "Cancel" },
      ],
    });
  }
  const hostCalls: string[] = [];
  const host: WorkspaceHostRegistration = {
    observationFailureLabel: "Test host",
    read: async () => (_providerId, observations) => observations,
    emptyEnrichment: (_providerId, observations) => observations,
    claim: (identity) =>
      identity.providerSessionId === HOSTED.providerSessionId
        ? {
            sendMessage: async (text) => {
              hostCalls.push(`message:${text}`);
              return { status: ACT_RESULT_STATUS.ACCEPTED };
            },
            executeControl: async (controlId) => {
              hostCalls.push(`control:${controlId}`);
              return { status: ACT_RESULT_STATUS.ACCEPTED };
            },
            spawnAgent: async (agent) => {
              hostCalls.push(`agent:${agent}`);
              return { status: ACT_RESULT_STATUS.ACCEPTED };
            },
            renameWorkspace: async (name) => {
              hostCalls.push(`rename:${name}`);
              return { status: ACT_RESULT_STATUS.ACCEPTED };
            },
          }
        : undefined,
    ownsControl: (controlId) => controlId === HOST_CONTROL,
  };
  const events: PerformerHarness["events"] = [];
  // SAFETY: the performer registers invoke handlers alone; `on` is never
  // reached, so a recorder of `handle` is the whole of the IpcMain it needs.
  const ipcMain = {
    handle: (channel: string, handler: InvokeHandler) => {
      handlers.set(channel, handler);
    },
    on: () => ipcMain,
  } as unknown as Pick<IpcMain, "handle" | "on">;
  registerSessionActsIpc({
    ipcMain,
    trustedSender: () => true,
    sessionRegistry: registry,
    lastReportedSessionLink: () => undefined,
    openExternal: async () => undefined,
    adapterFor: () => adapter,
    sendsNetwork: true,
    // SAFETY: the acts under test never read a setting; the store is reached
    // only by workspace creation and agent defaults, which this test never asks for.
    settingsStore: {} as SettingsStore,
    rememberWorkspaceDefaults: async () => undefined,
    expectCreatedWorkspace: () => undefined,
    openCreatedWorkspaces: () => undefined,
    trackedIssues: () => undefined,
    issueTrackers: [],
    refreshIssues: () => undefined,
    workspaceHosts: [host],
    // SAFETY: the recorder keeps the allowlisted names and values the performer
    // hands it; nothing here composes an event from them.
    recordProductEvent: ((event: string, properties: Record<string, string>) => {
      events.push({ event, properties });
    }) as RecordProductEvent,
    rememberedFacts: () => [],
    writeRememberedFacts: () => false,
  });
  return {
    invoke: async (channel, ...args) => {
      const handler = handlers.get(channel);
      assert.ok(handler, `no handler registered for ${channel}`);
      // SAFETY: the bridge's result guard already parsed this value; it is
      // read back as unparsed wire data only to be asserted on.
      return (await handler(invokeEvent(1), ...args)) as UnparsedWireValue;
    },
    adapter,
    hostCalls,
    events,
  };
}

async function settled(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

test("a hosted session's message goes to its host, counted under the session's provider, with no roster refresh", async () => {
  const { invoke, adapter, hostCalls, events } = performer();
  const result = await invoke(BRIDGE.sendSessionMessage.channel, HOSTED, "hello");
  await settled();

  assert.deepEqual(result, { status: ACT_RESULT_STATUS.ACCEPTED });
  assert.deepEqual(hostCalls, ["message:hello"]);
  assert.deepEqual(adapter.sent, []);
  assert.equal(adapter.observations, 0);
  assert.deepEqual(events, [
    {
      event: PRODUCT_EVENT.SESSION_ACT_SEND,
      properties: {
        provider_id: PROVIDER_ID.CODEX,
        session_act: PRODUCT_SESSION_ACT.MESSAGE_SEND,
      },
    },
  ]);
});

test("a host-owned control on a hosted session goes to its host; a provider's control still reaches the adapter", async () => {
  const { invoke, adapter, hostCalls } = performer();
  await invoke(BRIDGE.executeSessionControl.channel, HOSTED, HOST_CONTROL);
  await invoke(BRIDGE.executeSessionControl.channel, HOSTED, PROVIDER_CONTROL);
  await settled();

  assert.deepEqual(hostCalls, [`control:${HOST_CONTROL}`]);
  assert.deepEqual(adapter.controls, [PROVIDER_CONTROL]);
});

test("an unhosted session's acts reach the adapter and refresh its roster", async () => {
  const { invoke, adapter, hostCalls } = performer();
  await invoke(BRIDGE.sendSessionMessage.channel, UNHOSTED, "hello");
  await settled();

  assert.deepEqual(hostCalls, []);
  assert.deepEqual(adapter.sent, ["hello"]);
  assert.equal(adapter.observations, 1);
});
