import type { Effect } from "effect";
import type { IpcMainEvent, IpcMainInvokeEvent } from "electron";
import type { Bridge, BridgeArgumentsFor, BridgeMethod, BridgeResultFor } from "#shared/bridge";
import { bridgeEntries } from "#shared/bridge";
import type { BridgeContext, BridgeHandlers } from "./register-bridge";
import { registerBridge } from "./register-bridge";

interface BridgeRegistrationHost {
  ipcMain: Parameters<typeof registerBridge>[2]["ipcMain"];
  trustedSender: (event: IpcMainEvent | IpcMainInvokeEvent) => boolean;
}

type EffectBridgeHandler<Method extends BridgeMethod> = (
  context: BridgeContext,
  ...args: BridgeArgumentsFor<Method>
) => Effect.Effect<BridgeResultFor<Method>>;

export type EffectBridgeHandlers<Method extends BridgeMethod = BridgeMethod> = {
  [Name in Method]: EffectBridgeHandler<Name>;
};

/**
 * Effect IPC seam: trusted-sender admission and predicate guards stay synchronous
 * and run before any Effect work. Schema decode/encode lands here once wire
 * workers expose argsSchema/resultSchema on BRIDGE entries.
 */
export function registerBridgeEffects<const Method extends BridgeMethod>(
  bridge: Bridge,
  handlers: Pick<EffectBridgeHandlers, Method>,
  host: BridgeRegistrationHost,
  run: <A>(effect: Effect.Effect<A>) => Promise<A>,
): void {
  const promiseHandlers = {} as Pick<BridgeHandlers, Method>;
  for (const method of Object.keys(handlers) as Method[]) {
    const effectHandler = handlers[method];
    // SAFETY: handlers is keyed only by Method; the erased bridge host consumes the guarded registrar.
    promiseHandlers[method] = ((context, ...args) =>
      run(effectHandler(context, ...args))) as BridgeHandlers[Method];
  }
  registerBridge(bridge, promiseHandlers, host);
}

export function registerBridgeEffectEntry(
  bridge: Bridge,
  definition: Bridge[BridgeMethod],
  handler: (context: BridgeContext, ...args: never[]) => Effect.Effect<unknown>,
  host: BridgeRegistrationHost,
  run: <A>(effect: Effect.Effect<A>) => Promise<A>,
): void {
  const method = bridgeEntries().find(([, candidate]) => candidate === definition)?.[0];
  if (!method) throw new Error("Unknown bridge method");
  registerBridgeEffects(
    bridge,
    // SAFETY: method was recovered by identity from this BRIDGE and definition; registerBridgeEffects performs its runtime guards.
    // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- Object construction erases the recovered literal key before the guarded registrar consumes it.
    { [method]: handler } as unknown as Pick<EffectBridgeHandlers, typeof method>,
    host,
    run,
  );
}

export type { BridgeContext };
