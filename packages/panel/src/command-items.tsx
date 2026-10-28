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
 * worded here alone. A chord that acts on whichever thing is focused, as
 * ⌥⌘C copies the plan or an agent's transcript and ⌘⌫ deletes a task or an
 * agent, keeps its own words in the table, which ⌘K and the menu bar say,
 * and each thing's item says its own verb (`keyedAs`).
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

/**
 * One thing's item for a chord several kinds of thing share, worded here,
 * since the table's label names them all: "Copy plan" and "Copy concise
 * transcript" for the one ⌥⌘C. Note that it is not what ⌘K finds the
 * command by, which is the table's own item (`keyed`).
 */
function keyedAs(
  command: KeyedCommand,
  verb: string,
  icon: React.JSX.Element,
  noun?: string,
): PanelCommand {
  return { verb, noun, icon, command };
}

/** A command no chord reaches, worded here. */
function unkeyed(verb: string, icon: React.JSX.Element, noun?: string): PanelCommand {
  return { verb, noun, icon, command: undefined };
}

/** Every command a menu offers beside ⌘K, by what it does. */
export const PANEL_COMMAND = {
  COPY_CONTENT: keyed(APP_COMMAND.COPY_CONTENT, <GLYPH.COPY />),
  COPY_PLAN: keyedAs(APP_COMMAND.COPY_CONTENT, "Copy plan", <GLYPH.COPY />),
  COPY_LINK: keyed(APP_COMMAND.COPY_LINK, <GLYPH.LINK />),
  MARK_TASK_DONE: unkeyed("Mark done", <GLYPH.DONE />),
  DELETE: keyed(APP_COMMAND.DELETE, <GLYPH.DELETE />),
  DELETE_TASK: keyedAs(APP_COMMAND.DELETE, "Permanently delete", <GLYPH.DELETE />, NOUN.TASK),
  PIN: keyed(APP_COMMAND.PIN, <GLYPH.PIN />),
  PIN_TASK: keyedAs(APP_COMMAND.PIN, "Pin", <GLYPH.PIN />, NOUN.TASK),
  UNPIN_TASK: keyedAs(APP_COMMAND.PIN, "Unpin", <GLYPH.UNPIN />, NOUN.TASK),
  PIN_AGENT: keyedAs(APP_COMMAND.PIN, "Pin", <GLYPH.PIN />, NOUN.AGENT),
  UNPIN_AGENT: keyedAs(APP_COMMAND.PIN, "Unpin", <GLYPH.UNPIN />, NOUN.AGENT),
  TOGGLE_READ: keyed(APP_COMMAND.TOGGLE_READ, <MailIcon />),
  MARK_UNREAD: keyedAs(APP_COMMAND.TOGGLE_READ, "Mark as unread", <MailIcon />),
  MARK_READ: keyedAs(APP_COMMAND.TOGGLE_READ, "Mark as read", <MailOpenIcon />),
  RENAME: unkeyed("Rename", <GLYPH.RENAME />),
  RENAME_TASK: unkeyed("Rename", <GLYPH.RENAME />, NOUN.TASK),
  VERSION_HISTORY: keyed(APP_COMMAND.VERSION_HISTORY, <HistoryIcon />),
  PIN_TAB: unkeyed("Pin", <GLYPH.PIN />, NOUN.TAB),
  UNPIN_TAB: unkeyed("Unpin", <GLYPH.UNPIN />, NOUN.TAB),
  CLOSE_TAB: keyed(APP_COMMAND.CLOSE_TAB, <GLYPH.CLOSE />, NOUN.TAB),
  CLOSE_OTHER_TABS: keyedAs(APP_COMMAND.CLOSE_OTHER_TABS, "Close others", <ListXIcon />),
  SHOW_TERMINAL: keyed(APP_COMMAND.SHOW_TERMINAL, <GLYPH.TERMINAL />),
  OPEN_IN_TASK: keyed(APP_COMMAND.OPEN_IN_TASK, <GLYPH.TASK />),
  COPY_CONCISE_TRANSCRIPT: keyedAs(
    APP_COMMAND.COPY_CONTENT,
    "Copy concise transcript",
    <GLYPH.COPY />,
  ),
  COPY_FULL_TRANSCRIPT: keyed(APP_COMMAND.COPY_FULL_TRANSCRIPT, <ScrollTextIcon />),
  ARCHIVE_AGENT: unkeyed("Archive", <GLYPH.ARCHIVE />, NOUN.AGENT),
  UNARCHIVE_AGENT: unkeyed("Unarchive", <GLYPH.UNARCHIVE />, NOUN.AGENT),
  DELETE_AGENT: keyedAs(APP_COMMAND.DELETE, "Permanently delete", <GLYPH.DELETE />, NOUN.AGENT),
  MOVE_TO_SECTION: unkeyed("Move to section", <GLYPH.MOVE />),
  GROUP_BY: unkeyed("Group by", <ListIcon />),
  ORDER_BY: unkeyed("Order by", <ClockIcon />),
  ASSIGNED_TO: unkeyed("Assigned to", <UserCheckIcon />),
  CREATED_BY: unkeyed("Created by", <UsersIcon />),
  CANCEL_TASK: unkeyed("Cancel task", <TaskStatusMark status={TASK_STATUS.CANCELED} />),
  CHANGE_REPOSITORY: unkeyed("Change repository", <GLYPH.REPOSITORY />),
  MOVE_TO_WORKSPACE: unkeyed("Move to workspace", <GLYPH.MOVE />),
  OPEN_ON_GITHUB: keyed(APP_COMMAND.OPEN_ON_GITHUB, <GLYPH.OPEN_ON_GITHUB />),
  COPY_GITHUB_LINK: unkeyed("Copy GitHub link", <GLYPH.LINK />),
} as const satisfies Record<string, PanelCommand>;

/**
 * Each command a chord reaches, by that chord's command: the item worded as
 * the table labels it, never one thing's own item for a chord several share.
 */
const BY_COMMAND: ReadonlyMap<AppCommand, PanelCommand> = new Map(
  Object.values(PANEL_COMMAND).flatMap((item): [AppCommand, PanelCommand][] =>
    item.command === undefined ||
    commandWords(item, COMMAND_PLACE.PALETTE) !== appCommandLabel(item.command)
      ? []
      : [[item.command, item]],
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
