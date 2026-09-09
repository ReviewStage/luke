import { OPEN_REFUSAL, type SessionActPerformer } from "@sidecar/host";
import type { SessionApplicationId, SessionIdentity, SessionOpenResult } from "@sidecar/session";
import { ACT_RESULT_STATUS, type WireValue } from "@sidecar/wire";
import type { IpcMain, IpcMainEvent, IpcMainInvokeEvent } from "electron";
import { BRIDGE, type Bridge, type BridgeMethod } from "#shared/bridge";
import { type BridgeContext, registerBridgeEntry } from "../register-bridge";

export interface SessionActsIpcDependencies {
  ipcMain: Pick<IpcMain, "handle" | "on">;
  trustedSender: (event: IpcMainEvent | IpcMainInvokeEvent) => boolean;
  /** The opens alone: a press is not a write, and the writes reach the performer only through the brain in the host. */
  performer: Pick<
    SessionActPerformer,
    "openSession" | "openSessionApplication" | "openSessionChange"
  >;
}

/**
 * The presses that need no brain: a row, an app mark, and the pull-request
 * chip each hand an address the roster reported to the system.
 * Opening is not a write, so these stay on the bridge for the renderer to
 * call directly.
 */
export function registerSessionActsIpc(dependencies: SessionActsIpcDependencies): void {
  const { ipcMain, trustedSender, performer } = dependencies;
  /** One invoked bridge entry, whose refusal is an answer of the act's own kind rather than a rejected promise. */
  const registerAction = <TArguments extends unknown[], TResult extends WireValue>(
    definition: Bridge[BridgeMethod] & { kind: "invoke" },
    action: { act: (...args: TArguments) => Promise<TResult>; failure: (error: Error) => TResult },
  ): void => {
    registerBridgeEntry(
      BRIDGE,
      definition,
      async (_context: BridgeContext, ...received: unknown[]): Promise<TResult> => {
        try {
          // SAFETY: registerBridge applied this definition's argument guard before calling the handler.
          return await action.act(...(received as TArguments));
        } catch (error) {
          return action.failure(error instanceof Error ? error : new Error(String(error)));
        }
      },
      { ipcMain, trustedSender },
    );
  };
  const failure = (reason: string) => (): SessionOpenResult => ({
    status: ACT_RESULT_STATUS.REJECTED,
    reason,
  });
  registerAction<[SessionIdentity], SessionOpenResult>(BRIDGE.openSession, {
    act: (identity) => performer.openSession(identity),
    failure: failure(OPEN_REFUSAL.SESSION),
  });
  registerAction<[SessionIdentity, SessionApplicationId], SessionOpenResult>(
    BRIDGE.openSessionApplication,
    {
      act: (identity, applicationId) => performer.openSessionApplication(identity, applicationId),
      failure: failure(OPEN_REFUSAL.APPLICATION),
    },
  );
  registerAction<[SessionIdentity], SessionOpenResult>(BRIDGE.openSessionChange, {
    act: (identity) => performer.openSessionChange(identity),
    failure: failure(OPEN_REFUSAL.CHANGE),
  });
}
