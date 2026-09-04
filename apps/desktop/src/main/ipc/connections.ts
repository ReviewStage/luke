import { type ConnectionId, type ConnectionRegistration, SIGN_IN_EDGE } from "@sidecar/credentials";
import { ACT_RESULT_STATUS } from "@sidecar/wire";
import type { IpcMain, IpcMainEvent, IpcMainInvokeEvent } from "electron";
import { BRIDGE } from "#shared/bridge";
import type { ProviderSignInResult } from "#shared/contracts";
import { registerBridge } from "../register-bridge";
import { type createSettingsHandler, SettingsRefusal } from "../settings-handler";
import type { SettingsStore } from "../settings-store";

export interface ConnectionIpcDependencies {
  ipcMain: Pick<IpcMain, "handle" | "on">;
  trustedSender: (event: IpcMainEvent | IpcMainInvokeEvent) => boolean;
  registerSetting: ReturnType<typeof createSettingsHandler>;
  settingsStore: SettingsStore;
  connections: Readonly<Record<ConnectionId, ConnectionRegistration>>;
}

const NO_CONSENT_SIGN_IN = "That connection has no sign-in page to open.";
const NO_INTERACTIVE_SIGN_IN = "That connection has no sign-in Luke can run.";
const NO_DISCONNECT = "That connection has nothing to disconnect.";

/**
 * The bridge entries every connection row shares. Each hands the ask to the
 * named row's own seam and answers unsupported where the row declares none,
 * so a renderer can ask nothing of a connection its declaration does not
 * give it: a key row has no sign-in to begin, a local row nothing to
 * disconnect. Counting stays with the row: the handler names an edge, and
 * the row's own closure reads its vocabulary.
 */
export function registerConnectionIpc(dependencies: ConnectionIpcDependencies): void {
  const { registerSetting, settingsStore, connections } = dependencies;

  const unsupported = (reason: string): ProviderSignInResult => ({
    status: ACT_RESULT_STATUS.UNSUPPORTED,
    reason,
  });

  // The consent sign-in runs whole inside `save`, exactly as the calendar's
  // does: the browser trip, the loopback redirect, the exchange, and the
  // storing of the grant all happen in the main process, and the renderer's
  // reply is the settings snapshot alone. A refusal or a closed browser tab
  // comes back as the reason the row shows.
  registerSetting(BRIDGE.connectProvider, {
    async validate(providerId) {
      const row = connections[providerId];
      if (!row.consentSignIn) {
        return new SettingsRefusal({
          status: ACT_RESULT_STATUS.UNSUPPORTED,
          settings: await settingsStore.snapshot(),
          reason: NO_CONSENT_SIGN_IN,
        });
      }
      return row;
    },
    async save(row) {
      const refusal = await row.consentSignIn?.connect();
      if (refusal) {
        return {
          status: ACT_RESULT_STATUS.REJECTED,
          settings: await settingsStore.snapshot(),
          reason: refusal.reason,
        };
      }
      return { status: ACT_RESULT_STATUS.ACCEPTED, settings: await settingsStore.snapshot() };
    },
    async apply(result, row) {
      if (result.reason) return;
      // A row that just connected and shows nothing reads as a connection
      // that failed, so what the credential moves is moved at once.
      await row.onCredentialChanged?.();
      row.countSignInEdge?.(SIGN_IN_EDGE.COMPLETE);
    },
    refusal: "Could not connect on this system.",
  });

  registerSetting(BRIDGE.disconnectProvider, {
    async validate(providerId) {
      const row = connections[providerId];
      if (!row.disconnect) {
        return new SettingsRefusal({
          status: ACT_RESULT_STATUS.UNSUPPORTED,
          settings: await settingsStore.snapshot(),
          reason: NO_DISCONNECT,
        });
      }
      return row;
    },
    async save(row) {
      const outcome = await row.disconnect?.();
      if (!outcome || outcome.status !== ACT_RESULT_STATUS.ACCEPTED) {
        return {
          status: ACT_RESULT_STATUS.REJECTED,
          settings: await settingsStore.snapshot(),
          reason: outcome?.reason ?? NO_DISCONNECT,
        };
      }
      return { status: ACT_RESULT_STATUS.ACCEPTED, settings: await settingsStore.snapshot() };
    },
    async apply(result, row) {
      if (result.reason) return;
      // What the connection bought goes with it rather than sitting there
      // until the next pass: a tracker's roster, or the rows a CLI login
      // was buying.
      await row.onCredentialChanged?.();
      row.onConnectionChanged?.();
      row.countSignInEdge?.(SIGN_IN_EDGE.DISCONNECT);
    },
    refusal: "Could not disconnect on this system.",
  });

  registerBridge(
    BRIDGE,
    {
      async beginProviderSignIn(_context, providerId) {
        const row = connections[providerId];
        if (!row.interactiveSignIn) return unsupported(NO_INTERACTIVE_SIGN_IN);
        row.countSignInEdge?.(SIGN_IN_EDGE.START);
        return {
          status: ACT_RESULT_STATUS.ACCEPTED,
          snapshot: await row.interactiveSignIn.begin(),
        };
      },
      submitProviderSignInCode(_context, providerId, code) {
        const row = connections[providerId];
        if (!row.interactiveSignIn) return unsupported(NO_INTERACTIVE_SIGN_IN);
        return {
          status: ACT_RESULT_STATUS.ACCEPTED,
          snapshot: row.interactiveSignIn.submitCode(code),
        };
      },
      async chooseProviderSignInScope(_context, providerId, slug) {
        const row = connections[providerId];
        if (!row.interactiveSignIn) return unsupported(NO_INTERACTIVE_SIGN_IN);
        return {
          status: ACT_RESULT_STATUS.ACCEPTED,
          snapshot: await row.interactiveSignIn.chooseScope(slug),
        };
      },
      reopenProviderSignIn(_context, providerId) {
        connections[providerId].interactiveSignIn?.reopen();
      },
      cancelProviderSignIn(_context, providerId) {
        const row = connections[providerId];
        if (!row.interactiveSignIn) return;
        row.interactiveSignIn.cancel();
        row.countSignInEdge?.(SIGN_IN_EDGE.CANCEL);
      },
    },
    { ipcMain: dependencies.ipcMain, trustedSender: dependencies.trustedSender },
  );
}
