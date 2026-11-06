import { isAccountPlace, isLinkPlace, type ShownLink } from "@repo/features/link-grammar";
import { type AppCommand, isAppCommand } from "@repo/settings/shortcuts";
import { isRecord, isWireString } from "@repo/wire";
import { wireResult as result, type WireGuard, type WireGuardValue } from "@repo/wire/wire-guard";
import { eventIterator, type } from "@orpc/contract";
import { type AppStateDelivery, isAppStateDelivery } from "../app-state.js";
import { actProcedure } from "./base.js";

export const PUSH = {
  APP_STATE: "app:state",
  MENU_COMMAND: "app:menu-command",
  SHOW_LINK: "app:show-link",
} as const;

export type PushName = (typeof PUSH)[keyof typeof PUSH];

export type EventPushName = Exclude<PushName, typeof PUSH.APP_STATE>;

export const PUSH_GUARD = {
  [PUSH.APP_STATE]: result<AppStateDelivery>(isAppStateDelivery),
  [PUSH.MENU_COMMAND]: result<AppCommand>(isAppCommand),
  [PUSH.SHOW_LINK]: result<ShownLink>(
    (value) =>
      isRecord(value) &&
      ((isWireString(value.workspace) && isLinkPlace(value.place)) ||
        (value.workspace === undefined && isAccountPlace(value.place))),
  ),
} as const satisfies { readonly [Name in PushName]: WireGuard<unknown> };

export type PushPayload<Name extends PushName> = WireGuardValue<(typeof PUSH_GUARD)[Name]>;

export type PushEvent = {
  [Name in PushName]: { readonly push: Name; readonly payload: PushPayload<Name> };
}[PushName];

export const PUSH_METHOD = {
  onAppState: PUSH.APP_STATE,
  onMenuCommand: PUSH.MENU_COMMAND,
  onShowLink: PUSH.SHOW_LINK,
} as const;

export type PushMethod = keyof typeof PUSH_METHOD;

export const PUSH_PROCEDURE = "pushes" as const;

export const pushesContract = {
  [PUSH_PROCEDURE]: actProcedure("Could not hear what this system says.").output(
    eventIterator(type<PushEvent>()),
  ),
};
