import type { UnparsedWireValue } from "@sidecar/core";
import { Effect } from "effect";
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
  ) => Value | SettingsRefusal | Effect.Effect<Value | SettingsRefusal, unknown, unknown>;
  save: (value: Value) => Effect.Effect<SettingsUpdateResult, unknown, unknown>;
  apply?: (
    result: SettingsUpdateResult,
    value: Value,
    event: IpcMainInvokeEvent,
  ) => void | Effect.Effect<void, unknown, unknown>;
  refusal: string;
}

export interface SettingsHandlerDeps {
  trustedSender: (event: IpcMainInvokeEvent) => boolean;
  snapshot: () => Effect.Effect<AppSettings, unknown, unknown>;
  broadcast: (settings: AppSettings, except?: Electron.WebContents) => void;
  runEffect: <A, E>(effect: Effect.Effect<A, E, unknown>) => Promise<A>;
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

function isEffect<A, E, R>(value: unknown): value is Effect.Effect<A, E, R> {
  return Effect.isEffect(value);
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
    handle(channel, (event, ...args: UnparsedWireValue[]): Promise<SettingsUpdateResult> => {
      if (!deps.trustedSender(event)) throw new Error("Untrusted renderer");
      const validated = spec.validate(...args);
      const validatedEffect = isEffect(validated) ? validated : Effect.succeed(validated);
      return deps.runEffect(
        Effect.gen(function* () {
          const value = yield* validatedEffect;
          if (value instanceof SettingsRefusal) {
            return value.result;
          }
          const result = yield* spec.save(value).pipe(
            Effect.catchAll(() =>
              Effect.gen(function* () {
                return {
                  settings: yield* deps.snapshot(),
                  reason: spec.refusal,
                };
              }),
            ),
          );
          const applied = spec.apply?.(result, value, event);
          if (isEffect(applied)) yield* applied;
          deps.broadcast(result.settings, event.sender);
          return result;
        }),
      );
    });
  };
}
