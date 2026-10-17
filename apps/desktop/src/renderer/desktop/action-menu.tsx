import {
  type DrawnMenu,
  Menu,
  type MenuAction as SharedMenuAction,
  type MenuEntry as SharedMenuEntry,
} from "@luke/ui";
import { APP_SHORTCUTS, type KeyedCommand } from "#shared/shortcuts";
import { Shortcut } from "../shortcut";

/**
 * action-menu.tsx -- the window's own drop-down menu: a task's actions, a repository's, a side panel tab's, and the account's.
 *
 * The one menu the task's ⋯ and right-click, a repository header's ⋯ and
 * right-click, a tab's right-click, and the sidebar's account row draw, whose
 * items the empty side panel also lists as buttons of their own. It is
 * drawn rather than asked of the system so that every door draws it the same
 * way and an action can be drawn red. The menu itself, how it hangs, its
 * keys, submenus, and exit, is `@luke/ui`'s `Menu`, opened through
 * `useMenu`; what is the window's own is an item's shortcut, named by the
 * command it takes and printed as the menu bar prints its chord.
 */

/** One of the window's menu items: the shared item, its shortcut named by the command that takes the same action. */
export interface MenuAction extends Omit<SharedMenuAction, "hint"> {
  /** The shortcut that takes the same action, printed muted at the item's end. */
  command?: KeyedCommand;
}

/** An item that opens a menu of the window's own items beside it rather than acting. */
interface MenuSubmenu {
  label: string;
  icon?: React.JSX.Element;
  items: readonly MenuAction[];
}

/** One line of a menu: an action, or a submenu of them. */
export type MenuEntry = MenuAction | MenuSubmenu;

/** The shared item for one of the window's, its command's chord as its hint. */
function sharedAction({ command, ...action }: MenuAction): SharedMenuAction {
  if (command === undefined) return action;
  return { ...action, hint: <Shortcut chord={APP_SHORTCUTS[command].chord} /> };
}

function sharedEntry(entry: MenuEntry): SharedMenuEntry {
  return "items" in entry
    ? { ...entry, items: entry.items.map(sharedAction) }
    : sharedAction(entry);
}

/** The window's menu, drawn by the shared one with each item's chord at its end. */
export function ActionMenu({
  groups,
  ...props
}: {
  label: string;
  /** Where it hangs, and whether it is on its way out (`useMenu`'s `drawn`). */
  menu: DrawnMenu;
  heading?: React.ReactNode;
  footer?: React.ReactNode;
  groups: readonly (readonly MenuEntry[])[];
  /** Closes the menu, handing focus back to its opener where nothing else has taken it. */
  onClose: (returnFocus: boolean) => void;
}): React.JSX.Element {
  return <Menu {...props} groups={groups.map((group) => group.map(sharedEntry))} />;
}
