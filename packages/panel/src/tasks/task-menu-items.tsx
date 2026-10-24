import { encodeMention, MENTION_KIND, type MentionPlace } from "@luke/features/mention-link";
import type { TaskSummary } from "@luke/features/task-wire";
import type { Workspace } from "@luke/features/workspace-wire";
import { commandAction, PANEL_COMMAND } from "../command-items.js";
import { LINK_COPY } from "../copy-feedback.js";
import type { MenuAction } from "../desktop/action-menu.js";

/**
 * task-menu-items.tsx -- the items a task's ⋯ menu and the ⋯ beside its title both offer: Copy link, Mark as unread, Rename, and Version history.
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
  return commandAction(PANEL_COMMAND.RENAME, rename, false);
}

/** Version history, opening the plan's versions over the window. */
export function versionHistoryItem(open: () => void): MenuAction {
  return commandAction(PANEL_COMMAND.VERSION_HISTORY, open, false);
}
