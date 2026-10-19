import {
  isProductExchangeKind,
  isProductSurfaceEventName,
  type ProductEventPropertiesFor,
  type ProductExchangeKind,
  type ProductSurfaceEventName,
  productEventFromWire,
} from "@luke/features/analytics";
import { type AvatarGrant, avatarGrantFromWire } from "@luke/features/avatar-grant";
import {
  type BrowserFocus,
  type BrowserKey,
  type BrowserPage,
  isBrowserFocus,
  isBrowserKey,
  isBrowserPage,
} from "@luke/features/browser-acts";
import { isLinkPlace, type ReadLink } from "@luke/features/luke-link";
import { type VoiceLiveSessionChanged, voiceLiveSessionChangedSchema } from "@luke/gateway";
import { type AgentWireTrace, isAgentWireTrace } from "@luke/gateway/devtrace";
import { liveExchangeActive } from "@luke/live";
import { type AppCommand, isAppCommand } from "@luke/settings/shortcuts";
import { type AvatarFeed, avatarFeedFromWire } from "@luke/voice/avatar";
import { type AvatarViewSignal, avatarViewSignalFromWire } from "@luke/voice/avatar-view";
import {
  isVoiceCommand,
  isVoiceView,
  type VoiceCommand,
  type VoiceView,
} from "@luke/voice/voice-view";
import {
  EXCESS_KEYS,
  isRecord,
  isWireBoolean,
  isWireString,
  type UnparsedWireValue,
} from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import { wireResult as result, type WireGuard } from "@luke/wire/wire-guard";
import { Result } from "effect";
import { type Act, type ActOutcome, isActOutcome, parsedAct } from "./acts.js";
import { type AppStateSnapshot, isAppStateSnapshot } from "./app-state.js";

/** The act port's handshake, which the page and the preload each take their half of. */
export { ACT_PORT, actPortForwarder } from "./contract/kinds.js";

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
  /** A command chosen from the menu bar, for the focused window to run as its shortcut would. */
  onMenuCommand: entry({
    kind: "subscribe",
    channel: "app:menu-command",
    args: noArgs,
    result: result<AppCommand>(isAppCommand),
  }),
  /**
   * The talk key going down, carrying the panel's open task while one is open
   * and nothing otherwise.
   */
  onVoiceHotkeyPress: entry({
    kind: "subscribe",
    channel: "app:voice-hotkey-press",
    args: noArgs,
    result: result<{ taskId: string } | undefined>(
      (value) => value === undefined || (isRecord(value) && isWireString(value.taskId)),
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
   * The Tasks tab's microphone press, forwarded by the main process to the
   * voice window alone, carrying the task the panel had open when it was
   * pressed and nothing else.
   */
  onTasksTalk: entry({
    kind: "subscribe",
    channel: "app:task-talk-forwarded",
    args: noArgs,
    result: result<{ taskId: string }>((value) => isRecord(value) && isWireString(value.taskId)),
  }),
  /**
   * A coding agent's notification clicked: the panel is to open the task on
   * that agent's tab, or the agent's own page for an agent with no task. An
   * event rather than a slice of the document, because a click is an ask the
   * window answers once, not a state it bootstraps from.
   */
  onShowAgent: entry({
    kind: "subscribe",
    channel: "app:show-agent",
    args: noArgs,
    result: result<{ taskId: string | null; agentId: string }>(
      (value) =>
        isRecord(value) &&
        (value.taskId === null || isWireString(value.taskId)) &&
        isWireString(value.agentId),
    ),
  }),
  /**
   * An inbox notification clicked: the panel is to open the task on its
   * Inbox tab. An event, as an agent's notification's click is, because it
   * is an ask the window answers once.
   */
  onShowInbox: entry({
    kind: "subscribe",
    channel: "app:show-inbox",
    args: noArgs,
    result: result<{ taskId: string }>((value) => isRecord(value) && isWireString(value.taskId)),
  }),
  /**
   * A notification of an item of an agent with no task clicked: the panel is
   * to open the window's Inbox with that item chosen, where it is answered.
   * An event, as an inbox notification's click is.
   */
  onShowInboxItem: entry({
    kind: "subscribe",
    channel: "app:show-inbox-item",
    args: noArgs,
    result: result<{ agentId: string; itemId: string; workspaceId?: string }>(
      (value) =>
        isRecord(value) &&
        isWireString(value.agentId) &&
        isWireString(value.itemId) &&
        (value.workspaceId === undefined || isWireString(value.workspaceId)),
    ),
  }),
  /**
   * A failed run's notification clicked: the panel is to open the run, in
   * its automation's workspace. An event, as an agent's notification's click
   * is, because it is an ask the window answers once.
   */
  onShowFailedRun: entry({
    kind: "subscribe",
    channel: "app:show-failed-run",
    args: noArgs,
    result: result<{ automationId: string; runId: string; workspaceId: string }>(
      (value) =>
        isRecord(value) &&
        isWireString(value.automationId) &&
        isWireString(value.runId) &&
        isWireString(value.workspaceId),
    ),
  }),
  /**
   * A chat notification clicked: the panel is to open the Chat of the
   * workspace its message waits in. An event, as an inbox notification's
   * click is, because it is an ask the window answers once.
   */
  onShowChat: entry({
    kind: "subscribe",
    channel: "app:show-chat",
    args: noArgs,
    result: result<{ workspaceId: string }>(
      (value) => isRecord(value) && isWireString(value.workspaceId),
    ),
  }),
  /**
   * The floating call window moved under a pointer that did not: a drag of
   * its own. The page is told so the hover its buttons were left with is not
   * believed, since the engine keeps the hover the pointer had before.
   */
  onCallWindowMoved: entry({
    kind: "subscribe",
    channel: "app:call-window-moved",
    args: noArgs,
    result: result<void>((v) => v === undefined),
  }),
  /**
   * Keyframe's grant for the call's own avatar, sent to the panel window
   * alone, or nothing once the session is to close. A one-shot rather
   * than a slice of the document, because the document reaches every window
   * and the grant may reach this one only.
   */
  onAvatarSession: entry({
    kind: "subscribe",
    channel: "app:avatar-session",
    args: noArgs,
    result: result<AvatarGrant | undefined>(
      (value) => value === undefined || avatarGrantFromWire(value) !== undefined,
    ),
  }),
  /**
   * One message of Luke's voice feed, relayed to the panel window alone for
   * the avatar to lip-sync. A reading that expires as the next
   * chunk arrives, so nothing bootstraps from it.
   */
  onAvatarFeed: entry({
    kind: "subscribe",
    channel: "app:avatar-feed",
    args: noArgs,
    result: result<AvatarFeed>((value) => avatarFeedFromWire(value) !== undefined),
  }),
  /**
   * One signal of the call window's view of Luke's avatar, relayed from the
   * other end: the call window's offer or close to the panel, the panel's
   * answer to the call window. An event, as the feed is, because a signal is
   * read once and never bootstrapped from.
   */
  onAvatarViewSignal: entry({
    kind: "subscribe",
    channel: "app:avatar-view-signal",
    args: noArgs,
    result: result<AvatarViewSignal>((value) => avatarViewSignalFromWire(value) !== undefined),
  }),
  /**
   * The call card's way back pressed, in the floating window or a panel's
   * own card: the panel is to show the call's task. An event, as a notification's click is, because it is an
   * ask the window answers once.
   */
  onShowTask: entry({
    kind: "subscribe",
    channel: "app:show-task",
    args: noArgs,
    result: result<{ taskId: string }>((value) => isRecord(value) && isWireString(value.taskId)),
  }),
  /**
   * How one of this panel's Browser tabs' pages stands now, each time it
   * moves: loading, loaded, titled, sent elsewhere, or failed. An event
   * rather than a slice of the document, because a page is this window's
   * alone and nothing of it is kept (`docs/proposals/browser-tab.md`).
   */
  onBrowserState: entry({
    kind: "subscribe",
    channel: "app:browser-state",
    args: noArgs,
    result: result<BrowserPage>(isBrowserPage),
  }),
  /**
   * A Command chord pressed while a Browser tab's page held the keyboard,
   * handed back so the panel's keymap answers it as over any tab.
   */
  onBrowserKey: entry({
    kind: "subscribe",
    channel: "app:browser-key",
    args: noArgs,
    result: result<BrowserKey>(isBrowserKey),
  }),
  /**
   * A Browser tab's page took the keyboard, which no focus event of the
   * panel's own page hears, so the panel hands its keys to the column the
   * page stands in.
   */
  onBrowserFocus: entry({
    kind: "subscribe",
    channel: "app:browser-focus",
    args: noArgs,
    result: result<BrowserFocus>(isBrowserFocus),
  }),
  /**
   * A Luke link the system handed the app: the panel is to open the place it
   * names, in the workspace it was written under. An event, as a click is,
   * because it is an ask the window answers once.
   */
  onShowLink: entry({
    kind: "subscribe",
    channel: "app:show-link",
    args: noArgs,
    result: result<ReadLink>(
      (value) => isRecord(value) && isWireString(value.workspace) && isLinkPlace(value.place),
    ),
  }),
  /**
   * A coding agent's turn ended while the window was focused: the panel says
   * so in its toast, whose View opens the plan on that agent's tab, or the
   * agent's own page for one with no plan. An event, as a click is, because
   * it is said once and never bootstrapped from.
   */
  onAgentEnded: entry({
    kind: "subscribe",
    channel: "app:agent-ended",
    args: noArgs,
    result: result<{
      taskId: string | null;
      agentId: string;
      words: string;
      detail: string;
      failed: boolean;
    }>(
      (value) =>
        isRecord(value) &&
        (value.taskId === null || isWireString(value.taskId)) &&
        isWireString(value.agentId) &&
        isWireString(value.words) &&
        isWireString(value.detail) &&
        isWireBoolean(value.failed),
    ),
  }),
  /**
   * An inbox item opened while the window was focused away from its task's
   * Inbox tab: the panel says so in its toast, whose View opens that tab.
   * An event, as an agent's end is, because it is said once and never
   * bootstrapped from.
   */
  onInboxItemOpened: entry({
    kind: "subscribe",
    channel: "app:inbox-item-opened",
    args: noArgs,
    result: result<{ taskId: string; itemId: string; words: string; detail: string }>(
      (value) =>
        isRecord(value) &&
        isWireString(value.taskId) &&
        isWireString(value.itemId) &&
        isWireString(value.words) &&
        isWireString(value.detail),
    ),
  }),
  /**
   * A run of one of the account's automations failed to start while the
   * window was focused: the panel says so in its toast, in the failed tone,
   * whose View opens the run. An event, as an agent's end is.
   */
  onRunFailed: entry({
    kind: "subscribe",
    channel: "app:run-failed",
    args: noArgs,
    result: result<{
      automationId: string;
      runId: string;
      workspaceId: string;
      words: string;
      detail: string;
    }>(
      (value) =>
        isRecord(value) &&
        isWireString(value.automationId) &&
        isWireString(value.runId) &&
        isWireString(value.workspaceId) &&
        isWireString(value.words) &&
        isWireString(value.detail),
    ),
  }),
  /**
   * A chat message came to wait while the window was focused away from its
   * Chat: the panel says so in its toast, whose View opens Chat. An event,
   * as an opened inbox item is.
   */
  onChatMessageWaiting: entry({
    kind: "subscribe",
    channel: "app:chat-message-waiting",
    args: noArgs,
    result: result<{
      messageId: string;
      workspaceId: string;
      taskId: string | null;
      words: string;
      detail: string;
    }>(
      (value) =>
        isRecord(value) &&
        isWireString(value.messageId) &&
        isWireString(value.workspaceId) &&
        (value.taskId === null || isWireString(value.taskId)) &&
        isWireString(value.words) &&
        isWireString(value.detail),
    ),
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
