import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { encodeMention, MENTION_KIND, type MentionPlace } from "@luke/features/mention-link";
import type { TaskSummary } from "@luke/features/task-wire";
import type { Workspace } from "@luke/features/workspace-wire";
import { Atom } from "effect/reactivity";
import { useEffect } from "react";
import { commandAction, PANEL_COMMAND } from "../command-items.js";
import { LINK_COPY } from "../copy-feedback.js";
import type { MenuAction } from "../desktop/action-menu.js";

/**
 * task-menu-items.tsx -- the items a task's ⋯ menu and the ⋯ beside its title both offer: Copy link, Mark as unread, Rename, and Version history, and the open task's one rename door ⌘K reaches.
 *
 * Each menu says what pressing one does where it is drawn, so the sidebar's
 * Rename edits the row and the title's edits the title, but both draw the
 * item the same way, as the window's one list words and marks it
 * (`command-items.tsx`). The link is the task's own address on tryluke.dev,
 * written by the mention encoder (`@luke/features/mention-link`) as a mention
 * of the task is, so it opens the task in the app as a mention's chip does.
 * Mark as unread turns to Mark as read on a task already unread, as Mail,
 * Slack, and Linear offer it (`use-plan-looks.ts`).
 */

/** Where a task's links are written: its workspace by slug, or by id until the workspaces are read, and its repository. */
export function taskLinkPlace(
  workspaces: readonly Workspace[],
  task: Pick<TaskSummary, "workspaceId" | "repository">,
): MentionPlace {
  const home = workspaces.find((each) => each.id === task.workspaceId);
  return { workspace: home?.slug ?? task.workspaceId, repository: task.repository };
}

/**
 * Copy link, the plan's, through `copy`, the window's menu copy
 * (`useCopyToast`), which says so in a toast. Note that it prints no ⌥⌘C,
 * because the chord copies the most specific link at hand, an agent's tab's
 * over its task's (`links-at-hand.ts`), so it need not copy this one.
 */
export function copyTaskLinkItem(
  copy: (words: string, label: string) => void,
  taskId: string,
  place: MentionPlace,
): MenuAction {
  return commandAction(
    PANEL_COMMAND.COPY_LINK,
    () => copy(encodeMention({ kind: MENTION_KIND.TASK, taskId: taskId }, place), LINK_COPY.COPIED),
    false,
  );
}

/** Whether a task is unread, as its sidebar row's weight says, and the mark that makes it unread or read. */
export interface ReadMark {
  readonly unread: boolean;
  readonly onMark: (unread: boolean) => void;
}

/** Mark as unread, or Mark as read on a task already unread. */
export function markReadItem({ unread, onMark }: ReadMark): MenuAction {
  return unread
    ? commandAction(PANEL_COMMAND.MARK_READ, () => onMark(false), false)
    : commandAction(PANEL_COMMAND.MARK_UNREAD, () => onMark(true), false);
}

/** Rename, editing the name where the menu's door draws it. */
export function renameTaskItem(rename: () => void): MenuAction {
  return commandAction(PANEL_COMMAND.RENAME_TASK, rename, false);
}

/** The open task's rename door, by the task it renames: what its page offers while it stands. */
export interface OpenTaskRename {
  readonly taskId: string;
  readonly begin: () => void;
}

/** The rename door the open task's page offers, none while no task's page stands. */
const openTaskRenameAtom = Atom.keepAlive(Atom.make<OpenTaskRename | undefined>(undefined));

/**
 * Offers the open task's rename door for as long as its page stands, so a
 * place drawn apart from the page, ⌘K, asks for the name where the page
 * draws it, as the page's own ⋯ and its title's do. Note that `begin` is
 * read as it is called, so it should be a steady door.
 */
export function useOfferTaskRename(taskId: string | undefined, begin: () => void): void {
  const offer = useAtomSet(openTaskRenameAtom);
  useEffect(() => {
    if (taskId === undefined) return;
    const offered = { taskId, begin };
    offer(offered);
    return () => offer((held) => (held === offered ? undefined : held));
  }, [taskId, begin, offer]);
}

/** The rename door the open task's page offers now, none while no task's page stands. */
export function useTaskRenameOffer(): OpenTaskRename | undefined {
  return useAtomValue(openTaskRenameAtom);
}

/** Version history, opening the plan's versions over the window. */
export function versionHistoryItem(open: () => void): MenuAction {
  return commandAction(PANEL_COMMAND.VERSION_HISTORY, open, false);
}
