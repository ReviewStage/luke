import assert from "node:assert/strict";
import test from "node:test";
import {
  CONNECTION_ID,
  type ConnectionId,
  type ConnectionRegistration,
  connectionDeclaration,
  INTERACTIVE_SIGN_IN_STAGE,
  type InteractiveSignInSnapshot,
  SIGN_IN_EDGE,
  type SignInEdge,
} from "@sidecar/credentials";
import { ACT_RESULT_STATUS, type UnparsedWireValue } from "@sidecar/wire";
import type { IpcMain } from "electron";
import { BRIDGE } from "#shared/bridge";
import type { AppSettings } from "#shared/contracts";
import { invokeEvent } from "../../testing/ipc-fixtures";
import { createSettingsHandler } from "../settings-handler";
import type { SettingsStore } from "../settings-store";
import { registerConnectionIpc } from "./connections";

// SAFETY: the handlers under test hand the snapshot back unread; nothing here
// inspects a setting, so an empty object stands for the settings wire.
const SETTINGS = {} as AppSettings;

const IDLE: InteractiveSignInSnapshot = { stage: INTERACTIVE_SIGN_IN_STAGE.IDLE, scopes: [] };

interface Harness {
  invoke: (channel: string, ...args: readonly UnparsedWireValue[]) => Promise<UnparsedWireValue>;
  send: (channel: string, ...args: readonly UnparsedWireValue[]) => void;
  edges: Array<{ providerId: ConnectionId; edge: SignInEdge }>;
  log: string[];
}

function harness(
  rows: Partial<Record<ConnectionId, Omit<ConnectionRegistration, "declaration">>>,
): Harness {
  type InvokeHandler = Parameters<IpcMain["handle"]>[1];
  type SendHandler = Parameters<IpcMain["on"]>[1];
  const invokes = new Map<string, InvokeHandler>();
  const sends = new Map<string, SendHandler>();
  // SAFETY: a recorder of `handle` and `on` is the whole of the IpcMain the
  // registrations reach.
  const ipcMain = {
    handle: (channel: string, handler: InvokeHandler) => {
      invokes.set(channel, handler);
    },
    on: (channel: string, handler: SendHandler) => {
      sends.set(channel, handler);
      return ipcMain;
    },
  } as unknown as Pick<IpcMain, "handle" | "on">;
  const edges: Harness["edges"] = [];
  const log: string[] = [];
  // SAFETY: every connection id is mapped exactly once from the declared set.
  const connections = Object.fromEntries(
    Object.values(CONNECTION_ID).map((id) => [
      id,
      {
        declaration: connectionDeclaration(id),
        ...rows[id],
        countSignInEdge: (edge: SignInEdge) => {
          edges.push({ providerId: id, edge });
        },
      },
    ]),
  ) as Readonly<Record<ConnectionId, ConnectionRegistration>>;
  // SAFETY: the handlers read `snapshot` alone.
  const settingsStore = { snapshot: async () => SETTINGS } as unknown as SettingsStore;
  const trustedSender = () => true;
  registerConnectionIpc({
    ipcMain,
    trustedSender,
    registerSetting: createSettingsHandler({
      ipcMain,
      trustedSender,
      snapshot: async () => SETTINGS,
      broadcast: () => {
        log.push("broadcast");
      },
    }),
    settingsStore,
    connections,
  });
  return {
    invoke: async (channel, ...args) => {
      const handler = invokes.get(channel);
      assert.ok(handler, `no handler for ${channel}`);
      // SAFETY: the bridge's result guard already parsed this value; it is
      // read back as unparsed wire data only to be asserted on.
      return (await handler(invokeEvent(1), ...args)) as UnparsedWireValue;
    },
    send: (channel, ...args) => {
      const handler = sends.get(channel);
      assert.ok(handler, `no handler for ${channel}`);
      // SAFETY: the send handlers take the invoke event's sender shape alone.
      handler(invokeEvent(1) as unknown as Parameters<SendHandler>[0], ...args);
    },
    edges,
    log,
  };
}

test("a sign-in begun on a row without an interactive sign-in is unsupported and counts nothing", async () => {
  const { invoke, edges } = harness({});
  const result = await invoke(BRIDGE.beginProviderSignIn.channel, CONNECTION_ID.CONDUCTOR);
  assert.deepEqual(result, {
    status: ACT_RESULT_STATUS.UNSUPPORTED,
    reason: "That connection has no sign-in Luke can run.",
  });
  assert.deepEqual(edges, []);
});

test("a sign-in begun on a CLI row runs its flow and counts the start once", async () => {
  const calls: string[] = [];
  const { invoke, send, edges } = harness({
    [CONNECTION_ID.SUPERSET]: {
      interactiveSignIn: {
        current: () => IDLE,
        begin: async () => {
          calls.push("begin");
          return { stage: INTERACTIVE_SIGN_IN_STAGE.BROWSER_CODE, scopes: [] };
        },
        submitCode: (code) => {
          calls.push(`code:${code}`);
          return { stage: INTERACTIVE_SIGN_IN_STAGE.EXCHANGING, scopes: [] };
        },
        chooseScope: async (slug) => {
          calls.push(`scope:${slug}`);
          return { stage: INTERACTIVE_SIGN_IN_STAGE.CONNECTED, scopes: [] };
        },
        reopen: () => {
          calls.push("reopen");
        },
        cancel: () => {
          calls.push("cancel");
        },
        shutdown: () => undefined,
      },
    },
  });
  const begun = await invoke(BRIDGE.beginProviderSignIn.channel, CONNECTION_ID.SUPERSET);
  assert.deepEqual(begun, {
    status: ACT_RESULT_STATUS.ACCEPTED,
    snapshot: { stage: INTERACTIVE_SIGN_IN_STAGE.BROWSER_CODE, scopes: [] },
  });
  await invoke(BRIDGE.submitProviderSignInCode.channel, CONNECTION_ID.SUPERSET, "ABCD#1234");
  await invoke(BRIDGE.chooseProviderSignInScope.channel, CONNECTION_ID.SUPERSET, "acme");
  send(BRIDGE.reopenProviderSignIn.channel, CONNECTION_ID.SUPERSET);
  send(BRIDGE.cancelProviderSignIn.channel, CONNECTION_ID.SUPERSET);

  assert.deepEqual(calls, ["begin", "code:ABCD#1234", "scope:acme", "reopen", "cancel"]);
  assert.deepEqual(edges, [
    { providerId: CONNECTION_ID.SUPERSET, edge: SIGN_IN_EDGE.START },
    { providerId: CONNECTION_ID.SUPERSET, edge: SIGN_IN_EDGE.CANCEL },
  ]);
});

test("a consent connect stores the grant through the row and counts the completion", async () => {
  const calls: string[] = [];
  const { invoke, edges } = harness({
    [CONNECTION_ID.LINEAR]: {
      consentSignIn: {
        connect: async () => {
          calls.push("connect");
          return undefined;
        },
        cancel: () => undefined,
        reopen: () => undefined,
      },
      onCredentialChanged: () => {
        calls.push("credential-changed");
      },
    },
  });
  const result = await invoke(BRIDGE.connectProvider.channel, CONNECTION_ID.LINEAR);
  assert.deepEqual(result, { status: ACT_RESULT_STATUS.ACCEPTED, settings: SETTINGS });
  assert.deepEqual(calls, ["connect", "credential-changed"]);
  assert.deepEqual(edges, [{ providerId: CONNECTION_ID.LINEAR, edge: SIGN_IN_EDGE.COMPLETE }]);
});

test("a refused consent connect is the row's reason and counts nothing", async () => {
  const { invoke, edges } = harness({
    [CONNECTION_ID.LINEAR]: {
      consentSignIn: {
        connect: async () => ({ reason: "The browser tab was closed." }),
        cancel: () => undefined,
        reopen: () => undefined,
      },
    },
  });
  const result = await invoke(BRIDGE.connectProvider.channel, CONNECTION_ID.LINEAR);
  assert.deepEqual(result, {
    status: ACT_RESULT_STATUS.REJECTED,
    settings: SETTINGS,
    reason: "The browser tab was closed.",
  });
  assert.deepEqual(edges, []);
});

test("a connect asked of a row without a consent sign-in is unsupported", async () => {
  const { invoke } = harness({});
  const result = await invoke(BRIDGE.connectProvider.channel, CONNECTION_ID.SUPERSET);
  assert.deepEqual(result, {
    status: ACT_RESULT_STATUS.UNSUPPORTED,
    settings: SETTINGS,
    reason: "That connection has no sign-in page to open.",
  });
});

test("a rejected disconnect counts nothing and moves nothing", async () => {
  const calls: string[] = [];
  const { invoke, edges } = harness({
    [CONNECTION_ID.SUPERSET]: {
      disconnect: async () => ({
        status: ACT_RESULT_STATUS.REJECTED,
        reason: "Superset could not sign out.",
      }),
      onConnectionChanged: () => {
        calls.push("connection-changed");
      },
    },
  });
  const result = await invoke(BRIDGE.disconnectProvider.channel, CONNECTION_ID.SUPERSET);
  assert.deepEqual(result, {
    status: ACT_RESULT_STATUS.REJECTED,
    settings: SETTINGS,
    reason: "Superset could not sign out.",
  });
  assert.deepEqual(calls, []);
  assert.deepEqual(edges, []);
});

test("an accepted disconnect moves what the connection bought and counts the edge", async () => {
  const calls: string[] = [];
  const { invoke, edges } = harness({
    [CONNECTION_ID.SUPERSET]: {
      disconnect: async () => ({ status: ACT_RESULT_STATUS.ACCEPTED }),
      onConnectionChanged: () => {
        calls.push("connection-changed");
      },
    },
  });
  const result = await invoke(BRIDGE.disconnectProvider.channel, CONNECTION_ID.SUPERSET);
  assert.deepEqual(result, { status: ACT_RESULT_STATUS.ACCEPTED, settings: SETTINGS });
  assert.deepEqual(calls, ["connection-changed"]);
  assert.deepEqual(edges, [{ providerId: CONNECTION_ID.SUPERSET, edge: SIGN_IN_EDGE.DISCONNECT }]);
});

test("a disconnect asked of a row with nothing to disconnect is unsupported", async () => {
  const { invoke } = harness({});
  const result = await invoke(BRIDGE.disconnectProvider.channel, CONNECTION_ID.CONDUCTOR_LOCAL);
  assert.deepEqual(result, {
    status: ACT_RESULT_STATUS.UNSUPPORTED,
    settings: SETTINGS,
    reason: "That connection has nothing to disconnect.",
  });
});
