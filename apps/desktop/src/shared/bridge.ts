import {
  isProductExchangeKind,
  isProductSurfaceEventName,
  type ProductEventPropertiesFor,
  type ProductExchangeKind,
  type ProductSurfaceEventName,
  productEventFromWire,
} from "@sidecar/analytics";
import { type AgentWireTrace, isAgentWireTrace } from "@sidecar/devtrace/vocabulary";
import { type VoiceLiveSessionChanged, voiceLiveSessionChangedSchema } from "@sidecar/gateway";
import { liveExchangeActive } from "@sidecar/live";
import {
  EXCESS_KEYS,
  isRecord,
  isWireBoolean,
  isWireString,
  type UnparsedWireValue,
} from "@sidecar/wire";
import { readEither } from "@sidecar/wire/effect";
import { Result } from "effect";
import { type Act, type ActOutcome, isActOutcome, parsedAct } from "./messages/acts";
import { type AppStateSnapshot, isAppStateSnapshot } from "./messages/app-state";
import {
  isVoiceCommand,
  isVoiceLevels,
  isVoiceView,
  type VoiceCommand,
  type VoiceLevels,
  type VoiceView,
} from "./messages/voice-view";
import { wireResult as result, type WireGuard } from "./messages/wire-guard";

type BridgeArguments = readonly unknown[];
type BridgeKind = "invoke" | "send" | "subscribe";
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

type SurfaceEventArguments = {
  [Name in ProductSurfaceEventName]: [name: Name, properties: ProductEventPropertiesFor<Name>];
}[ProductSurfaceEventName];

export const BRIDGE = {
  /**
   * Every effect a window asks for, on one channel. The argument is one
   * `{kind, payload}` from `ACT_KIND`, parsed here by that kind's own schema
   * before it leaves the window and again by the router that carries it, and
   * the answer is that act's outcome — done with its kind's value, refused
   * with a sentence, or a kind this build does not know. There is no second
   * way to cause anything: an effect with no kind reaches nothing.
   */
  act: entry({
    kind: "invoke",
    channel: "app:act",
    args: args<[Act]>((v) => v.length === 1 && parsedAct(v[0]) !== undefined),
    result: result<ActOutcome>(isActOutcome),
  }),
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
  setPointerInterception: entry({
    kind: "send",
    channel: "app:set-pointer-interception",
    args: oneBoolean,
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
   * How loud each speaker is right now, in the unit interval, reported by the
   * voice window at a bounded rate while a session stands. Both readings ride
   * one report because either may be talking under the other, and they ride
   * their own channel so the snapshot stays edge-driven.
   */
  reportVoiceLevel: entry({
    kind: "send",
    channel: "app:report-voice-level",
    args: args<[VoiceLevels]>((v) => v.length === 1 && isVoiceLevels(v[0])),
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
  notifyReady: entry({ kind: "send", channel: "app:renderer-ready", args: noArgs }),
  recordSurfaceEvent: entry({
    kind: "send",
    channel: "app:record-surface-event",
    args: args<SurfaceEventArguments>(
      (v) =>
        v.length === 2 &&
        isProductSurfaceEventName(v[0]) &&
        productEventFromWire({ name: v[0], at: Date.now(), properties: v[1] ?? {} }) !== undefined,
    ),
  }),
  /**
   * The one way a window learns what main holds. Its first delivery is this
   * window's bootstrap and every later one carries a version at least as
   * high, so there is no per-field push channel and no "which arrived first"
   * for a reader to answer. A delivery whose version repeats the one held is
   * this window's own facts having moved — its mode, or the display it stands
   * on — which the document does not number.
   */
  onAppState: entry({
    kind: "subscribe",
    channel: "app:state",
    args: noArgs,
    result: result<AppStateSnapshot>(isAppStateSnapshot),
  }),
  onLifecycle: entry({
    kind: "subscribe",
    channel: "app:lifecycle",
    args: noArgs,
    result: result<string>(isWireString),
  }),
  /**
   * The talk key going down, carrying the planning window's open plan while
   * that window holds the keyboard and nothing otherwise.
   */
  onVoiceHotkeyPress: entry({
    kind: "subscribe",
    channel: "app:voice-hotkey-press",
    args: noArgs,
    result: result<{ planId: string } | undefined>(
      (value) => value === undefined || (isRecord(value) && isWireString(value.planId)),
    ),
  }),
  onVoiceHotkeyRelease: entry({
    kind: "subscribe",
    channel: "app:voice-hotkey-release",
    args: noArgs,
    result: result<void>((v) => v === undefined),
  }),
  onStopHotkeyPress: entry({
    kind: "subscribe",
    channel: "app:stop-hotkey-press",
    args: noArgs,
    result: result<void>((v) => v === undefined),
  }),
  /**
   * The host's word on its one live session, relayed to the voice window as
   * the event it is: wanted asks the window to open a session muted for what
   * Luke has to say, closing asks it to hang up, and a repeated wanted is a
   * new ask a version of the document could not carry.
   */
  onVoiceLiveSessionChanged: entry({
    kind: "subscribe",
    channel: "app:voice-live-session-changed",
    args: noArgs,
    result: result<VoiceLiveSessionChanged>((value) =>
      Result.isSuccess(
        readEither(voiceLiveSessionChangedSchema, { excess: EXCESS_KEYS.DROP })(value),
      ),
    ),
  }),
  /**
   * How loud both speakers are, relayed to every panel as the stream it is:
   * twenty readings a second, each expiring in fifty milliseconds, so it is
   * an event rather than a slice of the document a panel bootstraps from.
   */
  onVoiceLevelChanged: entry({
    kind: "subscribe",
    channel: "app:voice-level-changed",
    args: noArgs,
    result: result<VoiceLevels>(isVoiceLevels),
  }),
  /**
   * The planning window's microphone press, forwarded by the main process to
   * the voice window alone, carrying the plan the window had open when it was
   * pressed and nothing else.
   */
  onPlanningTalk: entry({
    kind: "subscribe",
    channel: "app:planning-talk-forwarded",
    args: noArgs,
    result: result<{ planId: string }>((value) => isRecord(value) && isWireString(value.planId)),
  }),
  /**
   * A panel's validated command, forwarded by the main process to the voice
   * window alone, carrying the command and nothing else.
   */
  onVoiceCommand: entry({
    kind: "subscribe",
    channel: "app:voice-command-forwarded",
    args: noArgs,
    result: result<{ command: VoiceCommand }>(
      (value) => isRecord(value) && isVoiceCommand(value.command),
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
    : Bridge[Method]["kind"] extends "send"
      ? (...args: ArgumentsOf<Bridge[Method]>) => void
      : (callback: (payload: ResultOf<Bridge[Method]>) => void) => () => void;
};

export type AppBridge = Omit<DerivedAppBridge, "recordSurfaceEvent"> & {
  recordSurfaceEvent<Name extends ProductSurfaceEventName>(
    name: Name,
    properties: ProductEventPropertiesFor<Name>,
  ): void;
};

const channelTable = Object.fromEntries(
  Object.entries(BRIDGE).map(([method, definition]) => [method, definition.channel]),
);

function typedChannels(): { readonly [Method in BridgeMethod]: Bridge[Method]["channel"] } {
  // SAFETY: every pair is projected from BRIDGE without changing its method or channel.
  return channelTable as { readonly [Method in BridgeMethod]: Bridge[Method]["channel"] };
}

export const channels = typedChannels();

export function bridgeEntries(): ReadonlyArray<[BridgeMethod, Bridge[BridgeMethod]]> {
  // SAFETY: Object.entries only erases the literal keys already declared by BRIDGE.
  return Object.entries(BRIDGE) as Array<[BridgeMethod, Bridge[BridgeMethod]]>;
}
