/**
 * pushes.ts -- what main pushes to a window, as one ordered stream on its act port: each push's name, its payload's guard, and the bridge method a window hears it on.
 *
 * Every push to a window rides one event-iterator procedure, `pushes`, in the
 * order main sent them, as they rode one IPC pipe before: the talk key's
 * press is never overtaken by its release, nor a document by an ask resolved
 * against it. A window opens the stream once, before its first read, and
 * hears each push through its bridge's `on…` method; the payload is read by
 * the push's own guard there, as the preload read it, and one that fails is
 * dropped. The event is declared with oRPC's `type`, not a schema, because
 * the guards are the declaration the pushes have.
 */

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
import { type AppCommand, isAppCommand } from "@luke/settings/shortcuts";
import { type AvatarFeed, avatarFeedFromWire } from "@luke/voice/avatar";
import { type AvatarViewSignal, avatarViewSignalFromWire } from "@luke/voice/avatar-view";
import { isVoiceCommand, type VoiceCommand } from "@luke/voice/voice-view";
import { EXCESS_KEYS, isRecord, isWireBoolean, isWireString } from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import { wireResult as result, type WireGuard, type WireGuardValue } from "@luke/wire/wire-guard";
import { eventIterator, type } from "@orpc/contract";
import { Result } from "effect";
import { type AppStateSnapshot, isAppStateSnapshot } from "../app-state.js";
import { actProcedure } from "./base.js";

/** Every push main sends a window, by the name it crosses under. */
export const PUSH = {
  APP_STATE: "app:state",
  LIFECYCLE: "app:lifecycle",
  MENU_COMMAND: "app:menu-command",
  VOICE_HOTKEY_PRESS: "app:voice-hotkey-press",
  VOICE_HOTKEY_RELEASE: "app:voice-hotkey-release",
  STOP_HOTKEY_PRESS: "app:stop-hotkey-press",
  VOICE_LIVE_SESSION_CHANGED: "app:voice-live-session-changed",
  TASKS_TALK: "app:task-talk-forwarded",
  SHOW_AGENT: "app:show-agent",
  SHOW_INBOX: "app:show-inbox",
  SHOW_INBOX_ITEM: "app:show-inbox-item",
  SHOW_FAILED_RUN: "app:show-failed-run",
  SHOW_CHAT: "app:show-chat",
  CALL_WINDOW_MOVED: "app:call-window-moved",
  AVATAR_SESSION: "app:avatar-session",
  AVATAR_FEED: "app:avatar-feed",
  AVATAR_VIEW_SIGNAL: "app:avatar-view-signal",
  SHOW_TASK: "app:show-task",
  BROWSER_STATE: "app:browser-state",
  BROWSER_KEY: "app:browser-key",
  BROWSER_FOCUS: "app:browser-focus",
  SHOW_LINK: "app:show-link",
  AGENT_ENDED: "app:agent-ended",
  INBOX_ITEM_OPENED: "app:inbox-item-opened",
  RUN_FAILED: "app:run-failed",
  CHAT_MESSAGE_WAITING: "app:chat-message-waiting",
  VOICE_COMMAND: "app:voice-command-forwarded",
} as const;

export type PushName = (typeof PUSH)[keyof typeof PUSH];

/** Each push's guard, which the window reads its payload with before any listener hears it. */
export const PUSH_GUARD = {
  /**
   * The one way a window learns what main holds. Its first delivery is this
   * window's bootstrap and every later one carries a version at least as
   * high, so there is no per-field push channel and no "which arrived first"
   * for a reader to answer. A delivery whose version repeats the one held is
   * this window's own facts having moved — its mode, or the display it stands
   * on — which the document does not number.
   */
  [PUSH.APP_STATE]: result<AppStateSnapshot>(isAppStateSnapshot),
  [PUSH.LIFECYCLE]: result<string>(isWireString),
  /** A command chosen from the menu bar, for the focused window to run as its shortcut would. */
  [PUSH.MENU_COMMAND]: result<AppCommand>(isAppCommand),
  /**
   * The talk key going down, carrying the panel's open task while one is open
   * and nothing otherwise.
   */
  [PUSH.VOICE_HOTKEY_PRESS]: result<{ taskId: string } | undefined>(
    (value) => value === undefined || (isRecord(value) && isWireString(value.taskId)),
  ),
  [PUSH.VOICE_HOTKEY_RELEASE]: result<void>((v) => v === undefined),
  [PUSH.STOP_HOTKEY_PRESS]: result<void>((v) => v === undefined),
  /**
   * The host's word on its one live session, relayed to the voice window as
   * the event it is: wanted asks the window to open a session muted for what
   * Luke has to say, closing asks it to hang up, and a repeated wanted is a
   * new ask a version of the document could not carry.
   */
  [PUSH.VOICE_LIVE_SESSION_CHANGED]: result<VoiceLiveSessionChanged>((value) =>
    Result.isSuccess(
      readEither(voiceLiveSessionChangedSchema, { excess: EXCESS_KEYS.DROP })(value),
    ),
  ),
  /**
   * The Tasks tab's microphone press, forwarded by the main process to the
   * voice window alone, carrying the task the panel had open when it was
   * pressed and nothing else.
   */
  [PUSH.TASKS_TALK]: result<{ taskId: string }>(
    (value) => isRecord(value) && isWireString(value.taskId),
  ),
  /**
   * A coding agent's notification clicked: the panel is to open the task on
   * that agent's tab, or the agent's own page for an agent with no task. An
   * event rather than a slice of the document, because a click is an ask the
   * window answers once, not a state it bootstraps from.
   */
  [PUSH.SHOW_AGENT]: result<{ taskId: string | null; agentId: string }>(
    (value) =>
      isRecord(value) &&
      (value.taskId === null || isWireString(value.taskId)) &&
      isWireString(value.agentId),
  ),
  /**
   * An inbox notification clicked: the panel is to open the task on its
   * Inbox tab. An event, as an agent's notification's click is, because it
   * is an ask the window answers once.
   */
  [PUSH.SHOW_INBOX]: result<{ taskId: string }>(
    (value) => isRecord(value) && isWireString(value.taskId),
  ),
  /**
   * A notification of an item of an agent with no task clicked: the panel is
   * to open the window's Inbox with that item chosen, where it is answered.
   * An event, as an inbox notification's click is.
   */
  [PUSH.SHOW_INBOX_ITEM]: result<{ agentId: string; itemId: string; workspaceId?: string }>(
    (value) =>
      isRecord(value) &&
      isWireString(value.agentId) &&
      isWireString(value.itemId) &&
      (value.workspaceId === undefined || isWireString(value.workspaceId)),
  ),
  /**
   * A failed run's notification clicked: the panel is to open the run, in
   * its automation's workspace. An event, as an agent's notification's click
   * is, because it is an ask the window answers once.
   */
  [PUSH.SHOW_FAILED_RUN]: result<{ automationId: string; runId: string; workspaceId: string }>(
    (value) =>
      isRecord(value) &&
      isWireString(value.automationId) &&
      isWireString(value.runId) &&
      isWireString(value.workspaceId),
  ),
  /**
   * A chat notification clicked: the panel is to open the Chat of the
   * workspace its message waits in. An event, as an inbox notification's
   * click is, because it is an ask the window answers once.
   */
  [PUSH.SHOW_CHAT]: result<{ workspaceId: string }>(
    (value) => isRecord(value) && isWireString(value.workspaceId),
  ),
  /**
   * The floating call window moved under a pointer that did not: a drag of
   * its own. The page is told so the hover its buttons were left with is not
   * believed, since the engine keeps the hover the pointer had before.
   */
  [PUSH.CALL_WINDOW_MOVED]: result<void>((v) => v === undefined),
  /**
   * Keyframe's grant for the call's own avatar, sent to the panel window
   * alone, or nothing once the session is to close. A one-shot rather
   * than a slice of the document, because the document reaches every window
   * and the grant may reach this one only.
   */
  [PUSH.AVATAR_SESSION]: result<AvatarGrant | undefined>(
    (value) => value === undefined || avatarGrantFromWire(value) !== undefined,
  ),
  /**
   * One message of Luke's voice feed, relayed to the panel window alone for
   * the avatar to lip-sync. A reading that expires as the next
   * chunk arrives, so nothing bootstraps from it.
   */
  [PUSH.AVATAR_FEED]: result<AvatarFeed>((value) => avatarFeedFromWire(value) !== undefined),
  /**
   * One signal of the call window's view of Luke's avatar, relayed from the
   * other end: the call window's offer or close to the panel, the panel's
   * answer to the call window. An event, as the feed is, because a signal is
   * read once and never bootstrapped from.
   */
  [PUSH.AVATAR_VIEW_SIGNAL]: result<AvatarViewSignal>(
    (value) => avatarViewSignalFromWire(value) !== undefined,
  ),
  /**
   * The call card's way back pressed, in the floating window or a panel's
   * own card: the panel is to show the call's task. An event, as a notification's click is, because it is an
   * ask the window answers once.
   */
  [PUSH.SHOW_TASK]: result<{ taskId: string }>(
    (value) => isRecord(value) && isWireString(value.taskId),
  ),
  /**
   * How one of this panel's Browser tabs' pages stands now, each time it
   * moves: loading, loaded, titled, sent elsewhere, or failed. An event
   * rather than a slice of the document, because a page is this window's
   * alone and nothing of it is kept.
   */
  [PUSH.BROWSER_STATE]: result<BrowserPage>(isBrowserPage),
  /**
   * A Command chord pressed while a Browser tab's page held the keyboard,
   * handed back so the panel's keymap answers it as over any tab.
   */
  [PUSH.BROWSER_KEY]: result<BrowserKey>(isBrowserKey),
  /**
   * A Browser tab's page took the keyboard, which no focus event of the
   * panel's own page hears, so the panel hands its keys to the column the
   * page stands in.
   */
  [PUSH.BROWSER_FOCUS]: result<BrowserFocus>(isBrowserFocus),
  /**
   * A Luke link the system handed the app: the panel is to open the place it
   * names, in the workspace it was written under. An event, as a click is,
   * because it is an ask the window answers once.
   */
  [PUSH.SHOW_LINK]: result<ReadLink>(
    (value) => isRecord(value) && isWireString(value.workspace) && isLinkPlace(value.place),
  ),
  /**
   * A coding agent's turn ended while the window was focused: the panel says
   * so in its toast, whose View opens the plan on that agent's tab, or the
   * agent's own page for one with no plan. An event, as a click is, because
   * it is said once and never bootstrapped from.
   */
  [PUSH.AGENT_ENDED]: result<{
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
  /**
   * An inbox item opened while the window was focused away from its task's
   * Inbox tab: the panel says so in its toast, whose View opens that tab.
   * An event, as an agent's end is, because it is said once and never
   * bootstrapped from.
   */
  [PUSH.INBOX_ITEM_OPENED]: result<{
    taskId: string;
    itemId: string;
    words: string;
    detail: string;
  }>(
    (value) =>
      isRecord(value) &&
      isWireString(value.taskId) &&
      isWireString(value.itemId) &&
      isWireString(value.words) &&
      isWireString(value.detail),
  ),
  /**
   * A run of one of the account's automations failed to start while the
   * window was focused: the panel says so in its toast, in the failed tone,
   * whose View opens the run. An event, as an agent's end is.
   */
  [PUSH.RUN_FAILED]: result<{
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
  /**
   * A chat message came to wait while the window was focused away from its
   * Chat: the panel says so in its toast, whose View opens Chat. An event,
   * as an opened inbox item is.
   */
  [PUSH.CHAT_MESSAGE_WAITING]: result<{
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
  /**
   * A panel's validated command, forwarded by the main process to the voice
   * window alone, carrying the command and nothing else.
   */
  [PUSH.VOICE_COMMAND]: result<{ command: VoiceCommand }>(
    (value) => isRecord(value) && isVoiceCommand(value.command),
  ),
} as const satisfies { readonly [Name in PushName]: WireGuard<unknown> };

/** What one push carries. */
export type PushPayload<Name extends PushName> = WireGuardValue<(typeof PUSH_GUARD)[Name]>;

/** One push as it crosses the stream: its name and its payload. */
export type PushEvent = {
  [Name in PushName]: { readonly push: Name; readonly payload: PushPayload<Name> };
}[PushName];

/** The bridge method a window hears each push on, as it did when each push was a channel of its own. */
export const PUSH_METHOD = {
  onAppState: PUSH.APP_STATE,
  onLifecycle: PUSH.LIFECYCLE,
  onMenuCommand: PUSH.MENU_COMMAND,
  onVoiceHotkeyPress: PUSH.VOICE_HOTKEY_PRESS,
  onVoiceHotkeyRelease: PUSH.VOICE_HOTKEY_RELEASE,
  onStopHotkeyPress: PUSH.STOP_HOTKEY_PRESS,
  onVoiceLiveSessionChanged: PUSH.VOICE_LIVE_SESSION_CHANGED,
  onTasksTalk: PUSH.TASKS_TALK,
  onShowAgent: PUSH.SHOW_AGENT,
  onShowInbox: PUSH.SHOW_INBOX,
  onShowInboxItem: PUSH.SHOW_INBOX_ITEM,
  onShowFailedRun: PUSH.SHOW_FAILED_RUN,
  onShowChat: PUSH.SHOW_CHAT,
  onCallWindowMoved: PUSH.CALL_WINDOW_MOVED,
  onAvatarSession: PUSH.AVATAR_SESSION,
  onAvatarFeed: PUSH.AVATAR_FEED,
  onAvatarViewSignal: PUSH.AVATAR_VIEW_SIGNAL,
  onShowTask: PUSH.SHOW_TASK,
  onBrowserState: PUSH.BROWSER_STATE,
  onBrowserKey: PUSH.BROWSER_KEY,
  onBrowserFocus: PUSH.BROWSER_FOCUS,
  onShowLink: PUSH.SHOW_LINK,
  onAgentEnded: PUSH.AGENT_ENDED,
  onInboxItemOpened: PUSH.INBOX_ITEM_OPENED,
  onRunFailed: PUSH.RUN_FAILED,
  onChatMessageWaiting: PUSH.CHAT_MESSAGE_WAITING,
  onVoiceCommand: PUSH.VOICE_COMMAND,
} as const;

export type PushMethod = keyof typeof PUSH_METHOD;

/** The procedure a window opens its push stream with, keyed beside the act kinds. */
export const PUSH_PROCEDURE = "pushes" as const;

/** The push stream: every push main sends the window that opened it, in the order sent. */
export const pushesContract = {
  [PUSH_PROCEDURE]: actProcedure("Could not hear what this system says.").output(
    eventIterator(type<PushEvent>()),
  ),
};
