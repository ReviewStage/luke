import { INTEGRATION_PROVIDER } from "@repo/features/integration-wire";
import { TASK_STATUS } from "@repo/features/task-wire";
import {
  APP_COMMAND,
  type AppCommand,
  appCommandLabel,
  type KeyedCommand,
} from "@repo/settings/shortcuts";
import { ProviderMark, TaskStatusMark } from "@repo/ui";
import {
  ClockIcon,
  GLYPH,
  HistoryIcon,
  ListIcon,
  ListXIcon,
  MailIcon,
  MailOpenIcon,
  NetworkIcon,
  ScrollTextIcon,
  UnlinkIcon,
  UserCheckIcon,
} from "@repo/ui/icons";
import type { MenuAction } from "./desktop/action-menu.js";

export const COMMAND_PLACE = {
  MENU: "menu",
  PALETTE: "palette",
} as const;

type CommandPlace = (typeof COMMAND_PLACE)[keyof typeof COMMAND_PLACE];

export interface PanelCommand {
  readonly verb: string;
  readonly noun: string | undefined;
  readonly icon: React.JSX.Element;
  readonly command: KeyedCommand | undefined;
}

const NOUN = {
  TASK: "task",
  AGENT: "agent",
  TAB: "tab",
} as const;

function keyed(command: KeyedCommand, icon: React.JSX.Element, noun?: string): PanelCommand {
  const label = appCommandLabel(command);
  const ending = noun === undefined ? "" : ` ${noun}`;
  if (!label.endsWith(ending)) throw new Error(`"${label}" does not end in its noun "${noun}"`);
  return { verb: label.slice(0, label.length - ending.length), noun, icon, command };
}

function keyedAs(
  command: KeyedCommand,
  verb: string,
  icon: React.JSX.Element,
  noun?: string,
): PanelCommand {
  return { verb, noun, icon, command };
}

function unkeyed(verb: string, icon: React.JSX.Element, noun?: string): PanelCommand {
  return { verb, noun, icon, command: undefined };
}

export const PANEL_COMMAND = {
  COPY_CONTENT: keyed(APP_COMMAND.COPY_CONTENT, <GLYPH.COPY />),
  COPY_DESCRIPTION: keyedAs(APP_COMMAND.COPY_CONTENT, "Copy description", <GLYPH.COPY />),
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
  SHOW_LOCAL: unkeyed("Show local", <GLYPH.TERMINAL />),
  SHOW_BROWSER: unkeyed("Show browser", <GLYPH.WEBSITE />),
  OPEN_IN_TASK: keyed(APP_COMMAND.OPEN_IN_TASK, <GLYPH.TASK />),
  OPEN_IN_SLACK: unkeyed("Open in Slack", <ProviderMark provider={INTEGRATION_PROVIDER.SLACK} />),
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
  CANCEL_TASK: unkeyed("Cancel task", <TaskStatusMark status={TASK_STATUS.CANCELED} />),
  CHANGE_REPOSITORY: unkeyed("Change repository", <GLYPH.REPOSITORY />),
  MOVE_TO_WORKSPACE: unkeyed("Move to workspace", <GLYPH.MOVE />),
  MOVE_AGENT: unkeyed("Move to", <GLYPH.MOVE />),
  NEW_CHILD_TASK: unkeyed("New sub-task", <GLYPH.ADD />),
  ADD_RELATION: unkeyed("Add task relation", <NetworkIcon />),
  REMOVE_PARENT: unkeyed("Remove parent", <UnlinkIcon />),
  OPEN_ON_GITHUB: keyed(APP_COMMAND.OPEN_ON_GITHUB, <GLYPH.OPEN_ON_GITHUB />),
  COPY_GITHUB_LINK: unkeyed("Copy GitHub link", <GLYPH.LINK />),
} as const satisfies Record<string, PanelCommand>;

const BY_COMMAND: ReadonlyMap<AppCommand, PanelCommand> = new Map(
  Object.values(PANEL_COMMAND).flatMap((item): [AppCommand, PanelCommand][] =>
    item.command === undefined ||
    commandWords(item, COMMAND_PLACE.PALETTE) !== appCommandLabel(item.command)
      ? []
      : [[item.command, item]],
  ),
);

export function panelCommandOf(command: AppCommand): PanelCommand | undefined {
  return BY_COMMAND.get(command);
}

export function commandWords(item: PanelCommand, place: CommandPlace): string {
  if (place === COMMAND_PLACE.MENU || item.noun === undefined) return item.verb;
  return `${item.verb} ${item.noun}`;
}

export function commandHead(item: PanelCommand): { label: string; icon: React.JSX.Element } {
  return { label: commandWords(item, COMMAND_PLACE.MENU), icon: item.icon };
}

export function commandAction(
  item: PanelCommand,
  onSelect: () => void,
  keyed: boolean,
): MenuAction {
  const action: MenuAction = { ...commandHead(item), onSelect };
  return keyed && item.command !== undefined ? { ...action, command: item.command } : action;
}
