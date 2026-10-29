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

import { isLinkPlace, type ReadLink } from "@luke/features/link-grammar";
import { type AppCommand, isAppCommand } from "@luke/settings/shortcuts";
import { isRecord, isWireString } from "@luke/wire";
import { wireResult as result, type WireGuard, type WireGuardValue } from "@luke/wire/wire-guard";
import { eventIterator, type } from "@orpc/contract";
import { type AppStateDelivery, isAppStateDelivery } from "../app-state.js";
import { actProcedure } from "./base.js";

/** Every push main sends a window, by the name it crosses under. */
export const PUSH = {
  APP_STATE: "app:state",
  MENU_COMMAND: "app:menu-command",
  SHOW_LINK: "app:show-link",
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
   * A Luke link the system handed the app: the panel is to open the place it
   * names, in the workspace it was written under. An event, as a click is,
   * because it is an ask the window answers once.
   */
  [PUSH.SHOW_LINK]: result<ReadLink>(
    (value) => isRecord(value) && isWireString(value.workspace) && isLinkPlace(value.place),
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
  onShowLink: PUSH.SHOW_LINK,
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
