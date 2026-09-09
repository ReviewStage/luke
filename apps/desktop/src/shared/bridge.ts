import { ACTION_KIND } from "@sidecar/actions";
import {
  isProductExchangeKind,
  isProductSurfaceEventName,
  type ProductEventPropertiesFor,
  type ProductExchangeKind,
  type ProductSurfaceEventName,
  productEventFromWire,
} from "@sidecar/analytics";
import {
  type BrainAppActionAnswer,
  type BrainAppActionRequest,
  type BrainReplyOffer,
  isBrainReplyOffer,
  isReceiverEpoch,
} from "@sidecar/brain/requests-wire";
import { type AgentWireTrace, isAgentWireTrace } from "@sidecar/devtrace/vocabulary";
import { type AppGuideSnapshot, isAppGuideSnapshot } from "@sidecar/guide";
import { voiceExchangeActive } from "@sidecar/realtime";
import {
  isSpeechOffer,
  isSpeechOutcome,
  isSpeechWithdrawal,
  type SpeechOffer,
  type SpeechOutcome,
  type SpeechWithdrawal,
} from "@sidecar/realtime/speech";
import { type ConversationEntry, storedConversationEntry } from "@sidecar/session";
import {
  isRecord,
  isUnitLevel,
  isWireBoolean,
  isWireNumber,
  isWireString,
  type UnparsedWireValue,
} from "@sidecar/wire";
import { type Act, type ActOutcome, isActOutcome, parsedAct } from "./messages/acts";
import { type AppStateSnapshot, isAppStateSnapshot } from "./messages/app-state";
import { isSessionIdentity } from "./messages/session";
import {
  isVoiceCommand,
  isVoiceView,
  type VoiceCommand,
  type VoiceView,
} from "./messages/voice-view";
import { isWireValue, wireResult as result, type WireGuard } from "./messages/wire-guard";

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
   * The voice window reporting the claimed reply it held done with — its reply
   * ended or cut short, or shown where it could not be spoken — under the
   * epoch it was granted to. The next owed reply is offered only after this.
   */
  ackBrainReply: entry({
    kind: "send",
    channel: "app:ack-brain-reply",
    args: args<[string, string, number]>(
      (v) => v.length === 3 && isWireString(v[0]) && isWireString(v[1]) && isReceiverEpoch(v[2]),
    ),
  }),
  /**
   * The voice window reporting it can receive: its bootstrap applied and its
   * subscriptions standing, under the receiver epoch the bootstrap named. The
   * main process accepts it only from the current voice renderer for the
   * current epoch, and answers whether this report made the receiver ready.
   */
  reportVoiceReady: entry({
    kind: "invoke",
    channel: "app:report-voice-ready",
    args: args<[number]>((v) => v.length === 1 && isWireNumber(v[0]) && Number.isInteger(v[0])),
    result: result<boolean>(isWireBoolean),
  }),
  /**
   * The renderer's guide snapshot, pushed whenever it changes, so the main
   * process can validate an app act against the settings the panel actually
   * describes and hand the brain the same text.
   */
  reportAppGuide: entry({
    kind: "send",
    channel: "app:report-app-guide",
    args: args<[AppGuideSnapshot]>((v) => v.length === 1 && isAppGuideSnapshot(v[0])),
  }),
  /**
   * The renderer's answer to one app act the brain asked it to perform,
   * matched to the request by id. The answer is the outcome record the brain
   * reads, as the renderer's own carrier produced it.
   */
  answerBrainAppAction: entry({
    kind: "send",
    channel: "app:answer-brain-app-action",
    args: args<[string, BrainAppActionAnswer]>(
      (v) => v.length === 2 && isWireString(v[0]) && isRecord(v[1]) && isWireValue(v[1]),
    ),
  }),
  /**
   * The mouth reporting what became of one speech offer, by the id the offer
   * carried: spoken, refused, held, or stale. The arbiter offers the next turn
   * only once this lands, and an id it no longer knows — withdrawn, or past
   * its deadline — is ignored rather than acted on.
   */
  settleSpeech: entry({
    kind: "invoke",
    channel: "app:settle-speech",
    args: args<[string, SpeechOutcome]>(
      (v) => v.length === 2 && isWireString(v[0]) && isSpeechOutcome(v[1]),
    ),
    result: result<void>(),
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
        (v[1] === undefined ||
          (voiceExchangeActive(v[0].voiceStatus) && isProductExchangeKind(v[1]))),
    ),
  }),
  /**
   * How loud whoever is talking is right now, in the unit interval, reported
   * by the voice window at a bounded rate only while a turn is listening or
   * responding. It rides its own channel so the snapshot stays edge-driven.
   */
  reportVoiceLevel: entry({
    kind: "send",
    channel: "app:report-voice-level",
    args: args<[number]>((v) => v.length === 1 && isUnitLevel(v[0])),
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
   * The lines one window has appended to the conversation since its last
   * report, each with the id the window minted for it. The main process
   * appends them to the thread it owns — idempotently, so a line delivered
   * twice is one line — and relays the thread whole to every other panel
   * window, so the Conversation tab reads the same on every display; a window's own
   * report is not echoed back to it. A report never replaces the thread: what
   * the store holds is authoritative, and a window can only add to it. The
   * relay never leaves the machine, and every line in it is one the reporting
   * window already held on the terms the history's own module states. The
   * answer says whether the store took them, so the window marks a line
   * reported only then and sends a refused one again.
   */
  appendConversationLines: entry({
    kind: "invoke",
    channel: "app:append-conversation-lines",
    args: args<[readonly ConversationEntry[]]>(
      (v) =>
        v.length === 1 &&
        Array.isArray(v[0]) &&
        v[0].every((entry) => {
          const stored = storedConversationEntry(entry);
          if (stored === undefined) return false;
          // The identity is read back off the wire rather than out of the
          // parsed line, because it is the arriving value this guard admits.
          return (
            stored.identity === undefined || (isRecord(entry) && isSessionIdentity(entry.identity))
          );
        }),
    ),
    result: result<boolean>(isWireBoolean),
  }),
  /**
   * One tapped realtime event for the development trace. Fire-and-forget on
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
  /** The takeover surface reporting it mounted, which its abandon deadline measures. */
  introductionMounted: entry({
    kind: "send",
    channel: "app:introduction-mounted",
    args: noArgs,
  }),
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
  onVoiceHotkeyPress: entry({
    kind: "subscribe",
    channel: "app:voice-hotkey-press",
    args: noArgs,
    result: result<void>((v) => v === undefined),
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
   * One proactive turn the speech arbiter decided to voice now — a briefing
   * or an onboarding beat — with its id and the deadline past which it is
   * stale. At most one is outstanding: the next is offered only after the
   * mouth settles this one.
   */
  onSpeechOffered: entry({
    kind: "subscribe",
    channel: "app:speech-offered",
    args: noArgs,
    result: result<SpeechOffer>(isSpeechOffer),
  }),
  /** The arbiter taking back an offer the mouth has not yet begun to speak. */
  onSpeechWithdrawn: entry({
    kind: "subscribe",
    channel: "app:speech-withdrawn",
    args: noArgs,
    result: result<SpeechWithdrawal>(isSpeechWithdrawal),
  }),
  /**
   * How loud whoever is talking is, relayed to every panel as the stream it
   * is: twenty readings a second, each expiring in fifty milliseconds, so it
   * is an event rather than a slice of the document a panel bootstraps from.
   */
  onVoiceLevelChanged: entry({
    kind: "subscribe",
    channel: "app:voice-level-changed",
    args: noArgs,
    result: result<number>(isUnitLevel),
  }),
  /**
   * A panel's validated command, forwarded by the main process to the voice
   * window alone; a typed ask arrives with its words and the request id its
   * outcome is answered under, every other command with neither.
   */
  onVoiceCommand: entry({
    kind: "subscribe",
    channel: "app:voice-command-forwarded",
    args: noArgs,
    result: result<{ command: VoiceCommand }>(
      (value) => isRecord(value) && isVoiceCommand(value.command),
    ),
  }),
  /**
   * One ended run whose reply the main process offers the voice window to
   * speak. The words come with the grant, not the offer: the window claims
   * through `claimBrainReply` before a word is said.
   */
  onBrainReplyOffered: entry({
    kind: "subscribe",
    channel: "app:brain-reply-offered",
    args: noArgs,
    result: result<BrainReplyOffer>(isBrainReplyOffer),
  }),
  /**
   * The brain's generation ended — cleared, expired, or replaced — so every
   * reply offered or granted from it is withdrawn: an offer in hand is
   * dropped unclaimed, and words granted but not yet spoken are not spoken.
   * Carries the receiver epoch it was sent under.
   */
  onBrainRepliesWithdrawn: entry({
    kind: "subscribe",
    channel: "app:brain-replies-withdrawn",
    args: noArgs,
    result: result<number>(isReceiverEpoch),
  }),
  /**
   * An app act the brain decided that only the renderer can perform, already
   * validated in the main process against the guide the renderer reported.
   */
  onBrainAppAction: entry({
    kind: "subscribe",
    channel: "app:brain-app-action",
    args: noArgs,
    result: result<BrainAppActionRequest>(
      (v) =>
        isRecord(v) &&
        isWireString(v.requestId) &&
        isRecord(v.action) &&
        isWireString(v.action.kind) &&
        v.action.kind !== ACTION_KIND.REMEMBER &&
        v.action.kind !== ACTION_KIND.FORGET,
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
