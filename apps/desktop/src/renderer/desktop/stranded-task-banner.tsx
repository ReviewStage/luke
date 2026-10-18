import type { TaskSummary } from "@luke/features/task-wire";
import { TaskBanner } from "@luke/panel/desktop/task-banner";
import { WorkspaceCard, WorkspaceRef } from "@luke/panel/desktop/workspace-ref";
import type { TasksControl } from "../tasks/use-tasks-tab";
import { strandedHome, useMoveTaskDialog } from "./move-task-dialog";

/**
 * stranded-task-banner.tsx -- the task-wide banner of a task whose repository its own workspace cannot reach and another of the account's can: which one, and Move to it.
 *
 * Since #2524 a workspace reaches only its own GitHub installation's
 * repositories, so a task written before then in a workspace with no GitHub
 * connected, or one on another account, still names a repository nothing
 * there can work in: an agent will not start on it and its files will not
 * open. Where another workspace the account is in reaches that repository,
 * moving the task there is what mends it, so the task says so before
 * anything is refused, over every tab of it (`task-banner.tsx`), naming
 * that workspace by its tile and name, with the press that opens Move to
 * workspace (#2761) on it. The dialog is the move's confirmation and says
 * who gains the task, since a task moved from a workspace of the reader's own
 * into a team's is read by that team. Note that the task is never moved
 * without the press, for that same reason. The banner stands only where the
 * menu offers the move: a task the reader owns, not archived.
 */

/** A stranded task's banner, drawn wherever the task places it, and the Move dialog it opens, drawn once beside the task. */
interface StrandedTaskNotice {
  readonly banner: React.JSX.Element | null;
  readonly dialog: React.JSX.Element | null;
}

/** The open task's banner while it is stranded, nothing otherwise, and the dialog its press opens. */
export function useStrandedTaskBanner(
  tasks: TasksControl,
  task: TaskSummary | undefined,
): StrandedTaskNotice {
  const moving = useMoveTaskDialog(tasks, task);
  const home = task === undefined ? undefined : strandedHome(tasks, task);
  const { ask } = moving;
  if (home === undefined || ask === undefined) return { banner: null, dialog: moving.dialog };
  const personal = tasks.workspaces[0]?.id === home.id;
  return {
    banner: (
      <TaskBanner action={{ label: `Move to ${home.name}`, onPress: ask }}>
        This task's repository belongs to{" "}
        <WorkspaceRef
          workspace={home}
          card={<WorkspaceCard workspace={home} personal={personal} />}
        />
      </TaskBanner>
    ),
    dialog: moving.dialog,
  };
}
