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

export interface MenuAction extends Omit<SharedMenuAction, "hint" | "pressedBy"> {
  command?: KeyedCommand;
}

export interface MenuSubmenu {
  label: string;
  icon?: React.JSX.Element;
  items: readonly MenuAction[];
  command?: KeyedCommand;
}

export type MenuEntry = MenuAction | MenuSubmenu | MenuPanel;

export interface MenuEnds {
  readonly subject?: MenuSubject | undefined;
  readonly footer?: React.ReactNode;
}

function keyedBy(command: KeyedCommand): { hint: React.ReactNode; pressedBy: MenuKeyMatch } {
  const { chord } = APP_SHORTCUTS[command];
  return { hint: <Shortcut chord={chord} />, pressedBy: (event) => shortcutMatches(chord, event) };
}

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

export function rowMenu(
  thing: string,
  groups: readonly (readonly MenuEntry[])[],
  shown?: boolean,
  replayUnmasked?: boolean,
): ListRowMenu {
  return { thing, groups: groups.map((group) => group.map(sharedEntry)), shown, replayUnmasked };
}

export function ActionMenu({
  groups,
  ...props
}: MenuEnds & {
  label: string;
  menu: DrawnMenu;
  heading?: React.ReactNode;
  groups: readonly (readonly MenuEntry[])[];
  onClose: (returnFocus: boolean) => void;
  replayUnmasked?: boolean | undefined;
}): React.JSX.Element {
  return <Menu {...props} groups={groups.map((group) => group.map(sharedEntry))} />;
}
