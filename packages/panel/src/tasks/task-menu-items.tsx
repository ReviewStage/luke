import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { LINK_PLACE, linkOf, taskLinkStep } from "@repo/features/link-grammar";
import type { MentionPlace } from "@repo/features/mention-link";
import type { TaskSummary } from "@repo/features/task-wire";
import type { Workspace } from "@repo/features/workspace-wire";
import { Atom } from "effect/reactivity";
import { useEffect } from "react";
import { commandAction, PANEL_COMMAND } from "../command-items.js";
import { copyLinkItem } from "../copy-link-item.js";
import type { MenuAction } from "../desktop/action-menu.js";

export function taskLinkPlace(
  workspaces: readonly Workspace[],
  task: Pick<TaskSummary, "workspaceId" | "repository">,
): MentionPlace {
  const home = workspaces.find((each) => each.id === task.workspaceId);
  return { workspace: home?.slug ?? task.workspaceId, repository: task.repository };
}

export function copyTaskLinkItem(
  copy: (words: string, label: string) => void,
  task: Pick<TaskSummary, "id" | "number">,
  place: MentionPlace,
  chord: readonly string[],
): MenuAction {
  const link = linkOf({ kind: LINK_PLACE.TASK, planId: taskLinkStep(task) }, place.workspace);
  return copyLinkItem(copy, link, chord);
}

export interface ReadMark {
  readonly unread: boolean;
  readonly onMark: (unread: boolean) => void;
}

export function markReadItem({ unread, onMark }: ReadMark, keyed = false): MenuAction {
  return unread
    ? commandAction(PANEL_COMMAND.MARK_READ, () => onMark(false), keyed)
    : commandAction(PANEL_COMMAND.MARK_UNREAD, () => onMark(true), keyed);
}

export function renameTaskItem(rename: () => void): MenuAction {
  return commandAction(PANEL_COMMAND.RENAME_TASK, rename, false);
}

export interface OpenTaskRename {
  readonly taskId: string;
  readonly begin: () => void;
}

const openTaskRenameAtom = Atom.keepAlive(Atom.make<OpenTaskRename | undefined>(undefined));

export function useOfferTaskRename(taskId: string | undefined, begin: () => void): void {
  const offer = useAtomSet(openTaskRenameAtom);
  useEffect(() => {
    if (taskId === undefined) return;
    const offered = { taskId, begin };
    offer(offered);
    return () => offer((held) => (held === offered ? undefined : held));
  }, [taskId, begin, offer]);
}

export function useTaskRenameOffer(): OpenTaskRename | undefined {
  return useAtomValue(openTaskRenameAtom);
}

export function versionHistoryItem(open: () => void, keyed = false): MenuAction {
  return commandAction(PANEL_COMMAND.VERSION_HISTORY, open, keyed);
}
