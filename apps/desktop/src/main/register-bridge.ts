import type { IpcMain, IpcMainEvent, IpcMainInvokeEvent, WebContents } from "electron";
import type { Bridge, BridgeArgumentsFor, BridgeMethod, BridgeResultFor } from "#shared/bridge";
import { bridgeEntries } from "#shared/bridge";

export interface BridgeContext {
  sender: WebContents;
}

type BridgeHandler<Method extends BridgeMethod> = (
  context: BridgeContext,
  ...args: BridgeArgumentsFor<Method>
) => BridgeResultFor<Method> | Promise<BridgeResultFor<Method>>;

export type BridgeHandlers<Method extends BridgeMethod = BridgeMethod> = {
  [Name in Method]: BridgeHandler<Name>;
};

interface BridgeRegistrationHost {
  ipcMain: Pick<IpcMain, "handle" | "on">;
  trustedSender: (event: IpcMainEvent | IpcMainInvokeEvent) => boolean;
}

// oxlint-disable-next-line anti-slop/no-unknown-returns -- This is the erased callable shape at Electron's IPC boundary.
type RuntimeHandler = (context: BridgeContext, ...args: never[]) => unknown;

export function registerBridge<const Method extends BridgeMethod>(
  bridge: Bridge,
  handlers: Pick<BridgeHandlers, Method>,
  host: BridgeRegistrationHost,
): void {
  // SAFETY: handlers is keyed only by Method; Object.keys erases those literal keys.
  for (const method of Object.keys(handlers) as Method[]) {
    const definition = bridge[method];
    if (definition.kind === "subscribe") throw new Error(`Cannot register subscription ${method}`);
    // SAFETY: definition.args validates the erased IPC arguments before this typed handler runs.
    // oxlint-disable-next-line anti-slop/no-unknown-returns -- The response is parsed by definition.result below.
    const handler = handlers[method] as (...args: unknown[]) => unknown;
    if (definition.kind === "invoke") {
      host.ipcMain.handle(definition.channel, async (event, ...rawArgs) => {
        if (!host.trustedSender(event) || !definition.args(rawArgs)) {
          throw new Error("Invalid bridge request");
        }
        const value = await handler({ sender: event.sender }, ...rawArgs);
        if (definition.result?.(value) === false) throw new Error("Invalid bridge response");
        return value;
      });
      continue;
    }
    host.ipcMain.on(definition.channel, (event, ...rawArgs) => {
      if (!host.trustedSender(event) || !definition.args(rawArgs)) return;
      void handler({ sender: event.sender }, ...rawArgs);
    });
  }
}

export function registerBridgeEntry(
  bridge: Bridge,
  definition: Bridge[BridgeMethod],
  handler: RuntimeHandler,
  host: BridgeRegistrationHost,
): void {
  const method = bridgeEntries().find(([, candidate]) => candidate === definition)?.[0];
  if (!method) throw new Error("Unknown bridge method");
  const entryHandlers = { [method]: handler };
  // SAFETY: method was recovered by identity from this BRIDGE and definition; registerBridge performs its runtime guards.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- Object construction erases the recovered literal key before the guarded registrar consumes it.
  const typedHandlers = entryHandlers as unknown as Pick<BridgeHandlers, typeof method>;
  registerBridge(bridge, typedHandlers, host);
}
