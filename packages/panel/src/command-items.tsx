/**
 * command-items.tsx -- the window's commands as every place offering one words, marks, and keys it: the one list ⌘K and the action menus both read.
 *
 * A command is a verb, the noun it acts on where a place must say it, the
 * glyph it wears, and the chord that runs it where it has one. A menu on a
 * row that already names its thing says the verb alone ("Pin", "Permanently
 * delete"), and ⌘K, whose row names nothing, says the verb and the noun
 * ("Pin task", "Permanently delete task"). A command a chord reaches takes
 * its words from the shortcuts table (`@luke/settings/shortcuts`), whose
 * label is its verb and noun, so the menu bar, the Keyboard shortcuts page,
 * ⌘K, and the menus never word it apart; a command no chord reaches is
 * worded here alone.
 *
 * Note that the item is no `@luke/ui/command` `CommandItem`, which is one row
 * of the dialog, its words to search and what choosing it does: a place
 * draws its row from a `PanelCommand` and says what choosing it does there.
 */

import { TASK_STATUS } from "@luke/features/task-wire";
import {
  APP_COMMAND,
  type AppCommand,
  appCommandLabel,
  type KeyedCommand,
} from "@luke/settings/shortcuts";
import { TaskStatusMark } from "@luke/ui";
import {
  ClockIcon,
  GLYPH,
  HistoryIcon,
  ListIcon,
  ListXIcon,
  MailIcon,
  MailOpenIcon,
  ScrollTextIcon,
  UserCheckIcon,
  UsersIcon,
} from "@luke/ui/icons";
import type { MenuAction } from "./desktop/action-menu.js";

/** Where a command is offered: a menu on a row that names its thing, or ⌘K, whose row names nothing. */
export const COMMAND_PLACE = {
  MENU: "menu",
  PALETTE: "palette",
} as const;

type CommandPlace = (typeof COMMAND_PLACE)[keyof typeof COMMAND_PLACE];

/** One command as every place draws it: its verb, the noun ⌘K says after it, its glyph, and the chord that runs it. */
export interface PanelCommand {
  readonly verb: string;
  readonly noun: string | undefined;
  readonly icon: React.JSX.Element;
  readonly command: KeyedCommand | undefined;
}

/** What a command acts on, where ⌘K says it after the verb. */
const NOUN = {
  TASK: "task",
  AGENT: "agent",
  TAB: "tab",
} as const;

/**
 * A command a chord reaches, worded as the shortcuts table labels it: its
 * label is the verb, then the noun where one is named. Note that a label not
 * ending in its noun is refused as the module loads, because the menus would
 * otherwise say a verb the table never wrote.
 */
function keyed(command: KeyedCommand, icon: React.JSX.Element, noun?: string): PanelCommand {
  const label = appCommandLabel(command);
  const ending = noun === undefined ? "" : ` ${noun}`;
  if (!label.endsWith(ending)) throw new Error(`"${label}" does not end in its noun "${noun}"`);
  return { verb: label.slice(0, label.length - ending.length), noun, icon, command };
}

/** A command no chord reaches, worded here. */
function unkeyed(verb: string, icon: React.JSX.Element, noun?: string): PanelCommand {
  return { verb, noun, icon, command: undefined };
}

/** Every command a menu offers beside ⌘K, by what it does. */
export const PANEL_COMMAND = {
  COPY_PLAN: keyed(APP_COMMAND.COPY_PLAN, <GLYPH.COPY />),
  COPY_LINK: keyed(APP_COMMAND.COPY_LINK, <GLYPH.LINK />),
  MARK_TASK_DONE: keyed(APP_COMMAND.MARK_TASK_DONE, <GLYPH.DONE />),
  DELETE_TASK: keyed(APP_COMMAND.DELETE_TASK, <GLYPH.DELETE />, NOUN.TASK),
  PIN_TASK: unkeyed("Pin", <GLYPH.PIN />, NOUN.TASK),
  UNPIN_TASK: unkeyed("Unpin", <GLYPH.UNPIN />, NOUN.TASK),
  PIN_AGENT: unkeyed("Pin", <GLYPH.PIN />, NOUN.AGENT),
  UNPIN_AGENT: unkeyed("Unpin", <GLYPH.UNPIN />, NOUN.AGENT),
  MARK_UNREAD: unkeyed("Mark as unread", <MailIcon />),
  MARK_READ: unkeyed("Mark as read", <MailOpenIcon />),
  RENAME: unkeyed("Rename", <GLYPH.RENAME />),
  RENAME_TASK: unkeyed("Rename", <GLYPH.RENAME />, NOUN.TASK),
  VERSION_HISTORY: unkeyed("Version history", <HistoryIcon />),
  CLOSE_TAB: keyed(APP_COMMAND.CLOSE_TAB, <GLYPH.CLOSE />, NOUN.TAB),
  CLOSE_OTHER_TABS: unkeyed("Close others", <ListXIcon />),
  SHOW_TERMINAL: keyed(APP_COMMAND.SHOW_TERMINAL, <GLYPH.TERMINAL />),
  COPY_CONCISE_TRANSCRIPT: unkeyed("Copy concise transcript", <GLYPH.COPY />),
  COPY_FULL_TRANSCRIPT: unkeyed("Copy full transcript", <ScrollTextIcon />),
  ARCHIVE_AGENT: unkeyed("Archive", <GLYPH.ARCHIVE />, NOUN.AGENT),
  UNARCHIVE_AGENT: unkeyed("Unarchive", <GLYPH.UNARCHIVE />, NOUN.AGENT),
  DELETE_AGENT: unkeyed("Permanently delete", <GLYPH.DELETE />, NOUN.AGENT),
  MOVE_TO_SECTION: unkeyed("Move to section", <GLYPH.MOVE />),
  GROUP_BY: unkeyed("Group by", <ListIcon />),
  ORDER_BY: unkeyed("Order by", <ClockIcon />),
  ASSIGNED_TO: unkeyed("Assigned to", <UserCheckIcon />),
  CREATED_BY: unkeyed("Created by", <UsersIcon />),
  CANCEL_TASK: unkeyed("Cancel task", <TaskStatusMark status={TASK_STATUS.CANCELED} />),
  CHANGE_REPOSITORY: unkeyed("Change repository", <GLYPH.REPOSITORY />),
  MOVE_TO_WORKSPACE: unkeyed("Move to workspace", <GLYPH.MOVE />),
  OPEN_ON_GITHUB: unkeyed("Open on GitHub", <GLYPH.OPEN_ON_GITHUB />),
} as const satisfies Record<string, PanelCommand>;

/** Each command a chord reaches, by that chord's command. */
const BY_COMMAND: ReadonlyMap<AppCommand, PanelCommand> = new Map(
  Object.values(PANEL_COMMAND).flatMap((item): [AppCommand, PanelCommand][] =>
    item.command === undefined ? [] : [[item.command, item]],
  ),
);

/** The list's item for a command the window runs, where the list holds one. */
export function panelCommandOf(command: AppCommand): PanelCommand | undefined {
  return BY_COMMAND.get(command);
}

/** What a command says where it is offered: the verb on a row's menu, the verb and its noun in ⌘K. */
export function commandWords(item: PanelCommand, place: CommandPlace): string {
  if (place === COMMAND_PLACE.MENU || item.noun === undefined) return item.verb;
  return `${item.verb} ${item.noun}`;
}

/** The command's verb and glyph as a row's menu draws them, for a submenu or a row's mark, which hold or run it some way of their own. */
export function commandHead(item: PanelCommand): { label: string; icon: React.JSX.Element } {
  return { label: commandWords(item, COMMAND_PLACE.MENU), icon: item.icon };
}

/**
 * The command as an action menu draws it, on a row that names its thing:
 * its verb and glyph, and its chord where `keyed` says the chord acts on
 * what the menu does, as on the open task's menu and on no other task's.
 */
export function commandAction(
  item: PanelCommand,
  onSelect: () => void,
  keyed: boolean,
): MenuAction {
  const action: MenuAction = { ...commandHead(item), onSelect };
  return keyed && item.command !== undefined ? { ...action, command: item.command } : action;
}
