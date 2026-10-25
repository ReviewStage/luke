/**
 * pushes.ts -- what main pushes to a window, as one ordered stream on its act port: each push's name, its payload's guard, and the bridge method a window hears it on.
 *
 * Every push to a window rides one event-iterator procedure, `pushes`, in the
 * order main sent them, as they rode one IPC pipe before: a document is
 * never overtaken by an ask resolved against it. A window opens the stream once, before its first read, and
 * hears each push through its bridge's `on…` method; the payload is read by
 * the push's own guard there, as the preload read it, and one that fails is
 * dropped. The event is declared with oRPC's `type`, not a schema, because
 * the guards are the declaration the pushes have.
 */

import { type AvatarGrant, avatarGrantFromWire } from "@luke/features/avatar-grant";
import { isLinkPlace, type ReadLink } from "@luke/features/link-grammar";
import { type VoiceLiveSessionChanged, voiceLiveSessionChangedSchema } from "@luke/gateway";
import { type AppCommand, isAppCommand } from "@luke/settings/shortcuts";
import { type AvatarFeed, avatarFeedFromWire } from "@luke/voice/avatar";
import { type AvatarViewSignal, avatarViewSignalFromWire } from "@luke/voice/avatar-view";
import { isVoiceCommand, type VoiceCommand } from "@luke/voice/voice-view";
import { EXCESS_KEYS, isRecord, isWireString } from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import { wireResult as result, type WireGuard, type WireGuardValue } from "@luke/wire/wire-guard";
import { eventIterator, type } from "@orpc/contract";
import { Result } from "effect";
import { type AppStateDelivery, isAppStateDelivery } from "../app-state.js";
import { actProcedure } from "./base.js";

/** Every push main sends a window, by the name it crosses under. */
export const PUSH = {
  APP_STATE: "app:state",
  MENU_COMMAND: "app:menu-command",
  VOICE_LIVE_SESSION_CHANGED: "app:voice-live-session-changed",
  TASKS_TALK: "app:task-talk-forwarded",
  SHOW_AGENT: "app:show-agent",
  CALL_WINDOW_MOVED: "app:call-window-moved",
  AVATAR_SESSION: "app:avatar-session",
  AVATAR_FEED: "app:avatar-feed",
  AVATAR_VIEW_SIGNAL: "app:avatar-view-signal",
  SHOW_LINK: "app:show-link",
  VOICE_COMMAND: "app:voice-command-forwarded",
} as const;

export type PushName = (typeof PUSH)[keyof typeof PUSH];

/** Every push but the document's, which a window's stream works out from the document itself rather than carrying as handed. */
export type EventPushName = Exclude<PushName, typeof PUSH.APP_STATE>;

/** Each push's guard, which the window reads its payload with before any listener hears it. */
export const PUSH_GUARD = {
  /**
   * The one way a window learns what main holds after its first read: what
   * moved in the document since the last delivery this stream sent, every
   * entry of it on the stream's first. Each carries a version at least as
   * high as the one before, so there is no per-field push channel and no
   * "which arrived first" for a reader to answer. A delivery whose version
   * repeats the one held is this window's own facts having moved — its mode,
   * or the display it stands on — which the document does not number.
   */
  [PUSH.APP_STATE]: result<AppStateDelivery>(isAppStateDelivery),
  /** A command chosen from the menu bar, for the focused window to run as its shortcut would. */
  [PUSH.MENU_COMMAND]: result<AppCommand>(isAppCommand),
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
   * An agent's Call press, forwarded by the main process to the voice window
   * alone, carrying the agent pressed for and the task it is on where it is
   * on one, and nothing else.
   */
  [PUSH.TASKS_TALK]: result<{ agentId: string; taskId?: string | undefined }>(
    (value) =>
      isRecord(value) &&
      (value.taskId === undefined || isWireString(value.taskId)) &&
      isWireString(value.agentId),
  ),
  /**
   * The call card's way back to its agent pressed: the panel is to open the
   * task on that agent's tab, or the agent's own page for an agent with no
   * task. An event rather than a slice of the document, because a press is an
   * ask the window answers once, not a state it bootstraps from.
   */
  [PUSH.SHOW_AGENT]: result<{ taskId: string | null; agentId: string }>(
    (value) =>
      isRecord(value) &&
      (value.taskId === null || isWireString(value.taskId)) &&
      isWireString(value.agentId),
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
   * A Luke link the system handed the app: the panel is to open the place it
   * names, in the workspace it was written under. An event, as a click is,
   * because it is an ask the window answers once.
   */
  [PUSH.SHOW_LINK]: result<ReadLink>(
    (value) => isRecord(value) && isWireString(value.workspace) && isLinkPlace(value.place),
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
  onMenuCommand: PUSH.MENU_COMMAND,
  onVoiceLiveSessionChanged: PUSH.VOICE_LIVE_SESSION_CHANGED,
  onTasksTalk: PUSH.TASKS_TALK,
  onShowAgent: PUSH.SHOW_AGENT,
  onCallWindowMoved: PUSH.CALL_WINDOW_MOVED,
  onAvatarSession: PUSH.AVATAR_SESSION,
  onAvatarFeed: PUSH.AVATAR_FEED,
  onAvatarViewSignal: PUSH.AVATAR_VIEW_SIGNAL,
  onShowLink: PUSH.SHOW_LINK,
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
