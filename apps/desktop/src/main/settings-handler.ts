import { ACT_RESULT_STATUS } from "@sidecar/wire";
import type { IpcMain, IpcMainEvent, IpcMainInvokeEvent } from "electron";
import {
  BRIDGE,
  type Bridge,
  type BridgeArgumentsFor,
  type BridgeMethod,
  bridgeEntries,
} from "#shared/bridge";
import type { AppSettings, SettingsUpdateResult } from "#shared/messages/settings";
import { type BridgeContext, registerBridgeEntry } from "./register-bridge";

export class SettingsRefusal {
  constructor(readonly result: SettingsUpdateResult) {}
}

export interface SettingsHandlerSpec<Arguments extends readonly unknown[], Value> {
  validate: (...args: Arguments) => Value | SettingsRefusal | Promise<Value | SettingsRefusal>;
  /** Carries the write to the host; the context names the window that asked, so the host's change event can skip echoing it. */
  save: (value: Value, context: BridgeContext) => Promise<SettingsUpdateResult>;
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
  /** The settings a refusal is worded over; nothing when the host cannot be reached, which makes the refusal a throw. */
  snapshot: () => Promise<AppSettings | undefined>;
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
    const handler = async (
      context: BridgeContext,
      ...received: unknown[]
    ): Promise<SettingsUpdateResult> => {
      // SAFETY: registerBridge has applied this definition's argument guard before calling the handler.
      const argumentsForMethod = received as BridgeArgumentsFor<
        MethodForChannel<Definition["channel"]>
      >;
      const value = await spec.validate(...argumentsForMethod);
      if (value instanceof SettingsRefusal) return value.result;
      try {
        // The host's change event is what every other window hears; the
        // window that asked hears the answer here and is skipped there.
        const saved = await spec.save(value, context);
        await spec.apply?.(saved, value, context);
        return saved;
      } catch {
        const settings = await deps.snapshot();
        if (!settings) throw new Error(spec.refusal);
        return { status: ACT_RESULT_STATUS.REJECTED, settings, reason: spec.refusal };
      }
    };
    registerBridgeEntry(BRIDGE, definition, handler, deps);
  };
}
