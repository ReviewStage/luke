import type { IpcMain, IpcMainEvent, IpcMainInvokeEvent } from "electron";
import {
  BRIDGE,
  type Bridge,
  type BridgeArgumentsFor,
  type BridgeMethod,
  bridgeEntries,
} from "#shared/bridge";
import type { AppSettings, SettingsUpdateResult } from "#shared/contracts";
import { type BridgeContext, registerBridgeEntry } from "./register-bridge";

export class SettingsRefusal {
  constructor(readonly result: SettingsUpdateResult) {}
}

export interface SettingsHandlerSpec<Arguments extends readonly unknown[], Value> {
  validate: (...args: Arguments) => Value | SettingsRefusal | Promise<Value | SettingsRefusal>;
  save: (value: Value) => Promise<SettingsUpdateResult>;
  apply?: (
    result: SettingsUpdateResult,
    value: Value,
    context: BridgeContext,
  ) => void | Promise<void>;
  refusal: string;
}

export interface SettingsHandlerDeps {
  ipcMain: Pick<IpcMain, "handle" | "on">;
  trustedSender: (event: IpcMainEvent | IpcMainInvokeEvent) => boolean;
  snapshot: () => Promise<AppSettings>;
  broadcast: (settings: AppSettings, except?: Electron.WebContents) => void;
}

type InvokeMethod = {
  [Method in BridgeMethod]: Bridge[Method]["kind"] extends "invoke" ? Method : never;
}[BridgeMethod];
type MethodForChannel<Channel extends string> = {
  [Method in InvokeMethod]: Bridge[Method]["channel"] extends Channel ? Method : never;
}[InvokeMethod];

export function createSettingsHandler(deps: SettingsHandlerDeps) {
  return function registerSettingHandler<Definition extends Bridge[InvokeMethod], Value>(
    definition: Definition,
    spec: SettingsHandlerSpec<BridgeArgumentsFor<MethodForChannel<Definition["channel"]>>, Value>,
  ): void {
    const method = bridgeEntries().find(([, candidate]) => candidate === definition)?.[0];
    if (!method) throw new Error("Unknown bridge method");
    const handler = async (...received: unknown[]): Promise<SettingsUpdateResult> => {
      // SAFETY: registerBridge appends exactly one BridgeContext after validated domain arguments.
      const context = received.pop() as BridgeContext;
      // SAFETY: registerBridge has applied this definition's argument guard before calling the handler.
      const argumentsForMethod = received as BridgeArgumentsFor<
        MethodForChannel<Definition["channel"]>
      >;
      const value = await spec.validate(...argumentsForMethod);
      if (value instanceof SettingsRefusal) return value.result;
      try {
        const saved = await spec.save(value);
        await spec.apply?.(saved, value, context);
        deps.broadcast(saved.settings, context.sender);
        return saved;
      } catch {
        return { settings: await deps.snapshot(), reason: spec.refusal };
      }
    };
    registerBridgeEntry(BRIDGE, definition, handler, deps);
  };
}
