import type { WireValue } from "@sidecar/wire";
import type { IpcMain, IpcMainEvent, IpcMainInvokeEvent } from "electron";
import { BRIDGE, type Bridge, type BridgeMethod, bridgeEntries } from "#shared/bridge";
import { registerBridgeEntry } from "./register-bridge";

interface ActionHandlerHost {
  ipcMain: Pick<IpcMain, "handle" | "on">;
  trustedSender: (event: IpcMainEvent | IpcMainInvokeEvent) => boolean;
}

interface ActionHandler<TArguments extends unknown[], TResult> {
  act: (...args: TArguments) => Promise<TResult>;
  failure: (error: Error) => TResult;
}

type InvokedBridgeEntry = Bridge[BridgeMethod] & { kind: "invoke" };

export function createActionHandler(host: ActionHandlerHost) {
  return <TArguments extends unknown[], TResult extends WireValue>(
    definition: InvokedBridgeEntry,
    action: ActionHandler<TArguments, TResult>,
  ): void => {
    const method = bridgeEntries().find(([, candidate]) => candidate === definition)?.[0];
    if (!method) throw new Error("Unknown bridge method");
    const handler = async (...received: unknown[]): Promise<TResult> => {
      received.pop();
      try {
        // SAFETY: registerBridge has applied this definition's argument guard before calling the handler.
        return await action.act(...(received as TArguments));
      } catch (error) {
        return action.failure(error instanceof Error ? error : new Error(String(error)));
      }
    };
    registerBridgeEntry(BRIDGE, definition, handler, host);
  };
}
