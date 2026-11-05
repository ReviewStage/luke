import { APP_SHORTCUTS, type KeyedCommand, shortcutMatches } from "@repo/settings/shortcuts";
import {
  type DrawnMenu,
  type ListRowMenu,
  Menu,
  type MenuKeyMatch,
  type MenuPanel,
  type MenuSubject,
  type MenuAction as SharedMenuAction,
  type MenuEntry as SharedMenuEntry,
  Shortcut,
} from "@repo/ui";

/**
 * action-menu.tsx -- the window's own drop-down menu: a task's actions, a repository's, a side panel tab's, and the account's.
 *
 * The one menu the task's ⋯ and right-click, a repository header's ⋯ and
 * right-click, a tab's right-click, and the sidebar's account row draw, whose
 * items the empty side panel also lists as buttons of their own. It is
 * drawn rather than asked of the system so that every door draws it the same
 * way and an action can be drawn red. The menu itself, how it hangs, its
 * keys, submenus, the panels an item opens beside it, and exit, is
 * `@repo/ui`'s `Menu`, opened through
 * `useMenu`; what is the window's own is an item's shortcut, named by the
 * command it takes and printed as the menu bar prints its chord, which
 * chooses the item while the menu stands, so a row's menu's P pins that
 * row's task rather than the one the window has open.
 */

/** One of the window's menu items: the shared item, its shortcut named by the command that takes the same action. */
export interface MenuAction extends Omit<SharedMenuAction, "hint" | "pressedBy"> {
  /** The shortcut that takes the same action, printed muted at the item's end. */
  command?: KeyedCommand;
}

/** An item that opens a menu of the window's own items beside it rather than acting. */
export interface MenuSubmenu {
  label: string;
  icon?: React.JSX.Element;
  items: readonly MenuAction[];
  /** The shortcut that opens it, printed muted before its chevron. */
  command?: KeyedCommand;
}

/** One line of a menu: an action, a submenu of them, or a panel its owner draws beside it as its submenu (`@repo/ui`'s `MenuPanel`). */
export type MenuEntry = MenuAction | MenuSubmenu | MenuPanel;

/** What a menu draws beyond its items: what it acts on, which heads it as a phone's sheet, and a foot under the items, as a task's menu says who created and last edited it. */
export interface MenuEnds {
  readonly subject?: MenuSubject | undefined;
  readonly footer?: React.ReactNode;
}

/** A command's chord as a shared item prints it and hears it: muted at its end, and choosing it while the menu stands. */
function keyedBy(command: KeyedCommand): { hint: React.ReactNode; pressedBy: MenuKeyMatch } {
  const { chord } = APP_SHORTCUTS[command];
  return { hint: <Shortcut chord={chord} />, pressedBy: (event) => shortcutMatches(chord, event) };
}

/** The shared item for one of the window's, its command's chord as its hint. */
function sharedAction({ command, ...action }: MenuAction): SharedMenuAction {
  if (command === undefined) return action;
  return { ...action, ...keyedBy(command) };
}

function sharedEntry(entry: MenuEntry): SharedMenuEntry {
  if ("panel" in entry) return entry;
  if (!("items" in entry)) return sharedAction(entry);
  const { command, ...submenu } = entry;
  const items = submenu.items.map(sharedAction);
  return command === undefined ? { ...submenu, items } : { ...submenu, items, ...keyedBy(command) };
}

/** A row's menu (`ListRow`'s `menu`) of the window's items, each item's chord at its end; `thing` is what the row is, which names its ⋯ and the menu, `shown` whether the surface the row stands on is, which the menu does not outlive, and `replayUnmasked` whether its items' words are the app's own, which a screen recording shows as they read. */
export function rowMenu(
  thing: string,
  groups: readonly (readonly MenuEntry[])[],
  shown?: boolean,
  replayUnmasked?: boolean,
): ListRowMenu {
  return { thing, groups: groups.map((group) => group.map(sharedEntry)), shown, replayUnmasked };
}

/** The window's menu, drawn by the shared one with each item's chord at its end. */
export function ActionMenu({
  groups,
  ...props
}: MenuEnds & {
  label: string;
  /** Where it hangs, and whether it is on its way out (`useMenu`'s `drawn`). */
  menu: DrawnMenu;
  heading?: React.ReactNode;
  groups: readonly (readonly MenuEntry[])[];
  /** Closes the menu, handing focus back to its opener where nothing else has taken it. */
  onClose: (returnFocus: boolean) => void;
  /** Whether its items' words are the app's own, which a screen recording shows as they read, but for an item that is `replayMasked` (`Menu`'s `replayUnmasked`). */
  replayUnmasked?: boolean | undefined;
}): React.JSX.Element {
  return <Menu {...props} groups={groups.map((group) => group.map(sharedEntry))} />;
}
