import type { TaskSummary } from "@repo/features/task-wire";
import { ReplayMask, ReplayUnmask } from "@repo/ui/session-replay-marks";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { strandedHome, useMoveTaskDialog } from "./move-task-dialog.js";
import { TaskBanner } from "./task-banner.js";
import { WorkspaceCard, WorkspaceRef } from "./workspace-ref.js";

interface StrandedTaskNotice {
  readonly banner: React.JSX.Element | null;
  readonly dialog: React.JSX.Element | null;
}

export function useStrandedTaskBanner(
  tasks: TasksControl,
  task: TaskSummary | undefined,
): StrandedTaskNotice {
  const moving = useMoveTaskDialog(tasks, task);
  const home = task === undefined ? undefined : strandedHome(tasks, task);
  const { ask } = moving;
  if (home === undefined || ask === undefined) return { banner: null, dialog: moving.dialog };
  const personal = tasks.workspaces[0]?.id === home.id;
  const moveWords = (
    <ReplayUnmask>
      Move to <ReplayMask>{home.name}</ReplayMask>
    </ReplayUnmask>
  );
  return {
    banner: (
      <TaskBanner action={{ label: moveWords, onPress: ask }}>
        <ReplayUnmask>
          This task's repository belongs to{" "}
          <ReplayMask>
            <WorkspaceRef
              workspace={home}
              card={<WorkspaceCard workspace={home} personal={personal} />}
            />
          </ReplayMask>
        </ReplayUnmask>
      </TaskBanner>
    ),
    dialog: moving.dialog,
  };
}
