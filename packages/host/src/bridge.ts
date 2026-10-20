import {
  isProductExchangeKind,
  isProductSurfaceEventName,
  type ProductEventPropertiesFor,
  type ProductExchangeKind,
  type ProductSurfaceEventName,
  productEventFromWire,
} from "@luke/features/analytics";
import { type AgentWireTrace, isAgentWireTrace } from "@luke/gateway/devtrace";
import { liveExchangeActive } from "@luke/live";
import { type AvatarFeed, avatarFeedFromWire } from "@luke/voice/avatar";
import { type AvatarViewSignal, avatarViewSignalFromWire } from "@luke/voice/avatar-view";
import { isVoiceView, type VoiceView } from "@luke/voice/voice-view";
import { isWireBoolean, type UnparsedWireValue } from "@luke/wire";
import { wireResult as result, type WireGuard } from "@luke/wire/wire-guard";
import { type AppStateSnapshot, isAppStateSnapshot } from "./app-state.js";
import type { PUSH_METHOD, PushMethod, PushPayload } from "./contract/pushes.js";

/** The act port's handshake, which the page and the preload each take their half of. */
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
    // SAFETY: Array.isArray established the structured-clone argument envelope; the field guards parse every member.
    return guard(value as UnparsedWireValue[]);
  };
}

const noArgs = args<[]>((values) => values.length === 0);
const oneBoolean = args<[boolean]>((values) => values.length === 1 && isWireBoolean(values[0]));

/**
 * The instant a surface event's guard reads it at. Note that the guard asks
 * only whether the name and properties make an event, and the event that is
 * counted is stamped by the analytics sender's own clock, so any valid
 * instant will do and none is read from this machine here.
 */
const GUARD_EVENT_AT = 0;

type SurfaceEventArguments = {
  [Name in ProductSurfaceEventName]: [name: Name, properties: ProductEventPropertiesFor<Name>];
}[ProductSurfaceEventName];

export const BRIDGE = {
  /**
   * The document as this window stands: every slice, and this window's own
   * facts beside them. Read once at mount, before the subscription below has
   * anything to say, so a window is never drawn over a state it has not been
   * told.
   */
  requestAppState: entry({
    kind: "invoke",
    channel: "app:state-request",
    args: noArgs,
    result: result<AppStateSnapshot>(isAppStateSnapshot),
  }),
  /**
   * The voice window's whole snapshot of the live conversation, reported on
   * every edge of its own and on none of anything else's: the main process
   * writes it into the document that same window reads, so a report the view
   * did not move would be answered by a delivery asking for another. From
   * there every panel draws it, a panel that opens later bootstraps from it,
   * and the exchange level the media duck follows is derived from it. The
   * count of exchanges rides beside it: a kind travels only on the edge that
   * opened an exchange, named by the one window that knows who opened it, so
   * a turn walking from connecting to responding is counted once.
   */
  reportVoiceView: entry({
    kind: "send",
    channel: "app:report-voice-view",
    args: args<[VoiceView, ProductExchangeKind | undefined]>(
      (v) =>
        v.length === 2 &&
        isVoiceView(v[0]) &&
        (v[1] === undefined || (liveExchangeActive(v[0]) && isProductExchangeKind(v[1]))),
    ),
  }),
  /**
   * Whether a panel is recording a new shortcut, during which the talk key it
   * is capturing must not open a turn. Panel state gating a global key the
   * main process routes, so the main process is told rather than the window.
   */
  setShortcutCapturing: entry({
    kind: "send",
    channel: "app:set-shortcut-capturing",
    args: oneBoolean,
  }),
  /**
   * One tapped live event for the development trace. Fire-and-forget on
   * purpose: the tap must cost the conversation nothing, and the main process
   * simply drops it when no traced run is on — which is every packaged run,
   * because the writer only exists behind the unpackaged `LUKE_TRACE_DIR`
   * gate.
   */
  recordAgentTrace: entry({
    kind: "send",
    channel: "app:record-agent-trace",
    args: args<[AgentWireTrace]>((v) => v.length === 1 && isAgentWireTrace(v[0])),
  }),
  /**
   * One message of Luke's voice feed for his avatar, from the voice window
   * alone, which main relays to the panel while the avatar is starting
   * or live. A send rather than an act: it is 25 messages a second, and
   * nothing reads an answer.
   */
  feedAvatar: entry({
    kind: "send",
    channel: "app:feed-avatar",
    args: args<[AvatarFeed]>((v) => v.length === 1 && avatarFeedFromWire(v[0]) !== undefined),
  }),
  /**
   * One signal of the call window's view of Luke's avatar: the call window's
   * offer and close, which main relays to the panel, or the panel's answer,
   * which main relays to the call window. A send rather than an act: it is
   * a relay between two windows, and nothing reads an answer.
   */
  signalAvatarView: entry({
    kind: "send",
    channel: "app:signal-avatar-view",
    args: args<[AvatarViewSignal]>(
      (v) => v.length === 1 && avatarViewSignalFromWire(v[0]) !== undefined,
    ),
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

/**
 * What the preload exposes as `window.luke`: the invokes and the sends. What
 * main pushes reaches the window on its act port instead (`contract/pushes.ts`).
 */
export type PreloadBridge = Omit<DerivedAppBridge, "recordSurfaceEvent"> & {
  recordSurfaceEvent<Name extends ProductSurfaceEventName>(
    name: Name,
    properties: ProductEventPropertiesFor<Name>,
  ): void;
};

/** What the push a window hears on `Method` carries. */
export type PushPayloadFor<Method extends PushMethod> = PushPayload<(typeof PUSH_METHOD)[Method]>;

/** Each push a window hears, on the method it hears it on: a listener in, its unsubscribe out. */
export type PushListeners = {
  readonly [Method in PushMethod]: (
    callback: (payload: PushPayloadFor<Method>) => void,
  ) => () => void;
};

/** Everything a window reaches main through: the preload's bridge, and the pushes it hears. */
export type AppBridge = PreloadBridge & PushListeners;

export function bridgeEntries(): ReadonlyArray<[BridgeMethod, Bridge[BridgeMethod]]> {
  // SAFETY: Object.entries only erases the literal keys already declared by BRIDGE.
  return Object.entries(BRIDGE) as Array<[BridgeMethod, Bridge[BridgeMethod]]>;
}
