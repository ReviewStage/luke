import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import type { TaskSummary } from "@repo/features/task-wire";
import { countWords, TERM } from "@repo/features/words";
import type { Workspace } from "@repo/features/workspace-wire";
import {
  ChoiceList,
  DIALOG_SIZE,
  DIALOG_TONE,
  Dialog,
  DialogActions,
  type DialogConfirm,
  ErrorState,
  SCROLL_SIZE,
  ScrollArea,
  useConfirmDialog,
} from "@repo/ui";
import { CONFIRM_STAGE, confirmAsked } from "@repo/ui/confirm-state";
import { ReplayMask, ReplayUnmask } from "@repo/ui/session-replay-marks";
import { strandedTaskHome, workspaceReaches } from "@repo/ui/tasks-model";
import { ACTION_RESULT_STATUS, type ActionResult } from "@repo/wire";
import { useMutation } from "@tanstack/react-query";
import { type ReactNode, useRef, useState } from "react";
import { useConfirmAct } from "../confirm-act.js";
import { confirmFailure } from "../failure-report.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { sharedWords } from "./workspace-ref.js";
import { TILE_SIZE, WorkspaceTile } from "./workspace-tile.js";

const MOVE_REFUSED = "The task could not be moved. Try again.";

function otherWorkspaces(
  tasks: Pick<TasksControl, "workspaces">,
  task: TaskSummary,
): readonly Workspace[] {
  return tasks.workspaces.filter((workspace) => workspace.id !== task.workspaceId);
}

function ownsTask(tasks: Pick<TasksControl, "me">, task: TaskSummary): boolean {
  return task.ownerId === undefined || tasks.me === undefined || task.ownerId === tasks.me;
}

function reaches(workspace: Workspace, repository: string | null): boolean {
  return repository === null || workspaceReaches(workspace, repository);
}

function rowLine(
  workspace: Workspace,
  repository: string | null,
  personalId: string | undefined,
): string | undefined {
  if (reaches(workspace, repository)) {
    return sharedWords(workspace.memberCount, workspace.id === personalId);
  }
  const github =
    workspace.github === null ? "No GitHub connected" : `${workspace.github.login} on GitHub`;
  return `${github} · cannot reach ${repository}`;
}

function named(workspace: Workspace): ReactNode {
  return <ReplayMask>{workspace.name}</ReplayMask>;
}

function lossLine(from: Workspace | undefined, to: Workspace): ReactNode {
  const losing = " lose access to it, its calls, and its agents.";
  if (from === undefined) {
    return (
      <>
        {"Members of its workspace who are not in "}
        {named(to)}
        {losing}
      </>
    );
  }
  if (from.memberCount !== undefined && from.memberCount <= 1) {
    return (
      <>
        {"Nobody loses access: only you are in "}
        {named(from)}.
      </>
    );
  }
  return (
    <>
      {"Members of "}
      {named(from)}
      {" who are not in "}
      {named(to)}
      {losing}
    </>
  );
}

function gainLine(to: Workspace): ReactNode {
  const { memberCount } = to;
  if (memberCount === undefined) {
    return (
      <>
        {"Members of "}
        {named(to)}
        {" can read and edit it."}
      </>
    );
  }
  if (memberCount <= 1) {
    return (
      <>
        {"Only you can read and edit it in "}
        {named(to)}.
      </>
    );
  }
  return (
    <>
      {`${countWords(memberCount, TERM.MEMBER)} in `}
      {named(to)}
      {" can read and edit it."}
    </>
  );
}

function WorkspaceChoices({
  workspaces,
  personalId,
  repository,
  chosen,
  disabled,
  first,
  onChoose,
}: {
  workspaces: readonly Workspace[];
  personalId: string | undefined;
  repository: string | null;
  chosen: Workspace | undefined;
  disabled: boolean;
  first: React.RefObject<HTMLButtonElement | null>;
  onChoose: (workspaceId: string) => void;
}): React.JSX.Element {
  const options = workspaces.map((workspace) => ({
    value: workspace.id,
    label: workspace.name,
    detail: rowLine(workspace, repository, personalId),
    mark: (
      <ReplayMask>
        <WorkspaceTile workspace={workspace} size={TILE_SIZE.ROW} />
      </ReplayMask>
    ),
    disabled: !reaches(workspace, repository),
    replayMasked: true,
  }));
  return (
    <ScrollArea size={SCROLL_SIZE.CONTENT}>
      <ChoiceList
        legend="Workspace"
        options={options}
        value={chosen === undefined ? [] : [chosen.id]}
        disabled={disabled}
        focusRef={first}
        onChange={([workspaceId]) => {
          if (workspaceId !== undefined) onChoose(workspaceId);
        }}
      />
    </ScrollArea>
  );
}

function MoveTaskCard({
  open,
  confirm,
  task,
  from,
  workspaces,
  personalId,
  chosen,
  onChoose,
}: {
  open: boolean;
  confirm: DialogConfirm;
  task: TaskSummary;
  from: Workspace | undefined;
  workspaces: readonly Workspace[];
  personalId: string | undefined;
  chosen: Workspace | undefined;
  onChoose: (workspaceId: string) => void;
}): React.JSX.Element {
  const { stage, rejection } = confirm;
  const moving = stage === CONFIRM_STAGE.ACTING;
  const first = useRef<HTMLButtonElement | null>(null);
  const cancel = useRef<HTMLButtonElement | null>(null);
  const dismiss = () => {
    if (moving) return;
    confirm.keep();
    confirm.clear();
  };
  return (
    <Dialog
      open={open}
      size={DIALOG_SIZE.CONFIRM}
      title={`Move “${task.name}” to another workspace`}
      busy={moving}
      initialFocus={chosen === undefined ? cancel : first}
      onDismiss={dismiss}
      actions={
        <DialogActions
          onCancel={dismiss}
          cancelRef={cancel}
          act={{
            verb: chosen === undefined ? "Move" : `Move to ${chosen.name}`,
            tone: DIALOG_TONE.PRIMARY,
            running: "Moving",
            busy: moving,
            disabled: chosen === undefined,
            onPress: () => confirm.run(),
          }}
        />
      }
    >
      <div className="move-dialog flex min-h-0 flex-col gap-block-gap">
        <ReplayUnmask>
          <WorkspaceChoices
            workspaces={workspaces}
            personalId={personalId}
            repository={task.repository}
            chosen={chosen}
            disabled={moving}
            first={first}
            onChoose={onChoose}
          />
          {chosen === undefined ? null : (
            <ul className="move-effects m-0 grid gap-tight-gap rounded-control bg-muted p-card-inset-snug pl-ui-24 text-body-foreground text-caption">
              <li>{lossLine(from, chosen)}</li>
              <li>{gainLine(chosen)}</li>
              <li>
                {"Its agents keep running, now in "}
                {named(chosen)}.
              </li>
            </ul>
          )}
          {rejection !== undefined && !moving ? (
            <ErrorState failure={rejection.failure}>
              <ReplayMask>{rejection.words}</ReplayMask>
            </ErrorState>
          ) : null}
        </ReplayUnmask>
      </div>
    </Dialog>
  );
}

export function strandedHome(
  tasks: Pick<TasksControl, "me" | "workspaces">,
  task: TaskSummary,
): Workspace | undefined {
  if (!ownsTask(tasks, task)) return undefined;
  return strandedTaskHome(task, tasks.workspaces);
}

interface MoveTaskDoor {
  ask: (() => void) | undefined;
  dialog: React.JSX.Element | null;
}

export function useMoveTaskDialog(
  tasks: Pick<TasksControl, "shown" | "me" | "workspaces" | "moveTask">,
  task: TaskSummary | undefined,
): MoveTaskDoor {
  const others = task === undefined ? [] : otherWorkspaces(tasks, task);
  const offered = task !== undefined && others.length > 0 && ownsTask(tasks, task);
  const [picked, setPicked] = useState<string | undefined>(undefined);
  const moving = useMutation(tasks.moveTask);
  const repository = task?.repository ?? null;
  const chosen =
    others.find((workspace) => workspace.id === picked && reaches(workspace, repository)) ??
    others.find((workspace) => reaches(workspace, repository));
  const moveAct = useConfirmAct(moving, {
    send: () =>
      task === undefined || chosen === undefined
        ? Promise.resolve()
        : moving.mutateAsync({ taskId: task.id, workspaceId: chosen.id, quiet: true }),
    answered: (moved): ActionResult =>
      moved
        ? { status: ACTION_RESULT_STATUS.ACCEPTED }
        : { status: ACTION_RESULT_STATUS.REJECTED, reason: MOVE_REFUSED },
    refusedFirst: () =>
      task === undefined || chosen === undefined
        ? { status: ACTION_RESULT_STATUS.REJECTED, reason: "Choose a workspace." }
        : undefined,
  });
  const confirm = useConfirmDialog(
    { subject: offered, surfaceOpen: tasks.shown },
    moveAct,
    confirmFailure(FAILURE_SURFACE.TASK_MOVE),
  );
  const open = confirm.standing && (confirmAsked(confirm.stage) || confirm.rejection !== undefined);
  return {
    ask: offered
      ? () => {
          setPicked(undefined);
          confirm.ask();
        }
      : undefined,
    dialog:
      task !== undefined ? (
        <MoveTaskCard
          open={open}
          confirm={confirm}
          task={task}
          from={tasks.workspaces.find((workspace) => workspace.id === task.workspaceId)}
          workspaces={others}
          personalId={tasks.workspaces[0]?.id}
          chosen={chosen}
          onChoose={setPicked}
        />
      ) : null,
  };
}
