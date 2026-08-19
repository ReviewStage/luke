import type { UnparsedWireValue } from "@sidecar/core";
import { type IpcMainInvokeEvent, ipcMain } from "electron";
import type { AppSettings, SettingsUpdateResult } from "./shared/contracts";

/**
 * A validate step that answers with words instead of a value. The refusal is
 * its own type so the factory can tell it from anything a setting might one
 * day validate to — a shape sniffed for a `settings` key would turn such a
 * value into a silent no-op the day the two collide.
 */
export class SettingsRefusal {
  constructor(readonly result: SettingsUpdateResult) {}
}

export interface SettingsHandlerSpec<Value> {
  validate: (
    ...args: UnparsedWireValue[]
  ) => Value | SettingsRefusal | Promise<Value | SettingsRefusal>;
  save: (value: Value) => Promise<SettingsUpdateResult>;
  apply?: (
    result: SettingsUpdateResult,
    value: Value,
    event: IpcMainInvokeEvent,
  ) => void | Promise<void>;
  refusal: string;
}

export interface SettingsHandlerDeps {
  trustedSender: (event: IpcMainInvokeEvent) => boolean;
  snapshot: () => Promise<AppSettings>;
  broadcast: (settings: AppSettings, except?: Electron.WebContents) => void;
  /**
   * Injectable so the factory can be exercised without standing up Electron's
   * IPC bus. Production uses `ipcMain.handle`.
   */
  handle?: (
    channel: string,
    listener: (
      event: IpcMainInvokeEvent,
      ...args: UnparsedWireValue[]
    ) => Promise<SettingsUpdateResult>,
  ) => void;
}

/**
 * One write path for every settings change the renderer can ask for. Trust,
 * catch, snapshot, and broadcast are identical on every channel — only what
 * is valid, what is stored, and what the write sets in motion differ. A
 * malformed request still throws: that is a broken caller, not a choice the
 * user can correct.
 */
export function createSettingsHandler(deps: SettingsHandlerDeps) {
  const handle = deps.handle ?? ipcMain.handle.bind(ipcMain);
  return function registerSettingHandler<Value>(
    channel: string,
    spec: SettingsHandlerSpec<Value>,
  ): void {
    handle(channel, async (event, ...args: UnparsedWireValue[]): Promise<SettingsUpdateResult> => {
      if (!deps.trustedSender(event)) throw new Error("Untrusted renderer");
      const value = await spec.validate(...args);
      // A validate step that already answered — a chord spoken for, refused with
      // words — leaves without a write, a side effect, or a broadcast.
      if (value instanceof SettingsRefusal) {
        return value.result;
      }
      try {
        const result = await spec.save(value);
        await spec.apply?.(result, value, event);
        deps.broadcast(result.settings, event.sender);
        return result;
      } catch {
        // A filesystem failure is not something the user can act on, so it is
        // reported as one line rather than as a raw system error.
        return {
          settings: await deps.snapshot(),
          reason: spec.refusal,
        };
      }
    });
  };
}
