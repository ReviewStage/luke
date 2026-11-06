import {
  isProductSurfaceEventName,
  type ProductEventPropertiesFor,
  type ProductSurfaceEventName,
  productEventFromWire,
} from "@repo/features/analytics";
import type { UnparsedWireValue } from "@repo/wire";
import { wireResult as result, type WireGuard } from "@repo/wire/wire-guard";
import { type AppStateSnapshot, isAppStateSnapshot } from "./app-state.js";
import type { PUSH_METHOD, PushMethod, PushPayload } from "./contract/pushes.js";

export { ACT_PORT, actPortForwarder } from "./contract/kinds.js";

type BridgeArguments = readonly unknown[];
type BridgeKind = "invoke" | "send";
type BridgeEntry<
  Kind extends BridgeKind,
  Channel extends string,
  Arguments extends BridgeArguments,
  Result,
> = {
  readonly kind: Kind;
  readonly channel: Channel;
  readonly args: WireGuard<Arguments>;
  readonly result?: WireGuard<Result>;
};

function entry<
  const Kind extends BridgeKind,
  const Channel extends string,
  Arguments extends BridgeArguments,
  Result,
>(
  definition: BridgeEntry<Kind, Channel, Arguments, Result>,
): BridgeEntry<Kind, Channel, Arguments, Result> {
  return definition;
}

function args<Arguments extends BridgeArguments>(
  guard: (values: readonly UnparsedWireValue[]) => boolean,
): WireGuard<Arguments> {
  return (value) => {
    if (!Array.isArray(value)) return false;
    return guard(value as UnparsedWireValue[]);
  };
}

const noArgs = args<[]>((values) => values.length === 0);

const GUARD_EVENT_AT = 0;

type SurfaceEventArguments = {
  [Name in ProductSurfaceEventName]: [name: Name, properties: ProductEventPropertiesFor<Name>];
}[ProductSurfaceEventName];

export const BRIDGE = {
  requestAppState: entry({
    kind: "invoke",
    channel: "app:state-request",
    args: noArgs,
    result: result<AppStateSnapshot>(isAppStateSnapshot),
  }),
  notifyReady: entry({ kind: "send", channel: "app:renderer-ready", args: noArgs }),
  recordSurfaceEvent: entry({
    kind: "send",
    channel: "app:record-surface-event",
    args: args<SurfaceEventArguments>(
      (v) =>
        v.length === 2 &&
        isProductSurfaceEventName(v[0]) &&
        productEventFromWire({ name: v[0], at: GUARD_EVENT_AT, properties: v[1] ?? {} }) !==
          undefined,
    ),
  }),
} as const;

export type Bridge = typeof BRIDGE;
export type BridgeMethod = keyof Bridge;
type ArgumentsOf<Entry> = Entry extends { args: WireGuard<infer Arguments> } ? Arguments : never;
type ResultOf<Entry> = Entry extends { result?: WireGuard<infer Result> } ? Result : undefined;
export type BridgeArgumentsFor<Method extends BridgeMethod> = ArgumentsOf<Bridge[Method]>;
export type BridgeResultFor<Method extends BridgeMethod> = ResultOf<Bridge[Method]>;

type DerivedAppBridge = {
  [Method in BridgeMethod]: Bridge[Method]["kind"] extends "invoke"
    ? (...args: ArgumentsOf<Bridge[Method]>) => Promise<ResultOf<Bridge[Method]>>
    : (...args: ArgumentsOf<Bridge[Method]>) => void;
};

export type PreloadBridge = Omit<DerivedAppBridge, "recordSurfaceEvent"> & {
  recordSurfaceEvent<Name extends ProductSurfaceEventName>(
    name: Name,
    properties: ProductEventPropertiesFor<Name>,
  ): void;
};

export type PushPayloadFor<Method extends PushMethod> = PushPayload<(typeof PUSH_METHOD)[Method]>;

export type PushListeners = {
  readonly [Method in PushMethod]: (
    callback: (payload: PushPayloadFor<Method>) => void,
  ) => () => void;
};

export type AppBridge = PreloadBridge & PushListeners;

export function bridgeEntries(): ReadonlyArray<[BridgeMethod, Bridge[BridgeMethod]]> {
  return Object.entries(BRIDGE) as Array<[BridgeMethod, Bridge[BridgeMethod]]>;
}
