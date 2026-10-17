import type { TaskSummary } from "@luke/features/task-wire";
import type { Workspace } from "@luke/features/workspace-wire";
import { type DialogConfirm, useConfirmDialog } from "@luke/ui";
import { CONFIRM_STAGE, confirmAsked } from "@luke/ui/confirm-state";
import { strandedTaskHome, workspaceReaches } from "@luke/ui/tasks-model";
import { ACTION_RESULT_STATUS, type ActionResult } from "@luke/wire";
import { useId, useRef, useState } from "react";
import { ModalShell } from "../modal-shell";
import { BusyLabel } from "../spinner";
import type { TasksControl } from "../tasks/use-tasks-tab";
import { sharedWords, WORKSPACE_REF_SIZE, WorkspaceRef } from "./workspace-ref";

/**
 * move-task-dialog.tsx -- Move to workspace, from a task's ⋯: the account's other workspaces to move the task to, and what the move does.
 *
 * The menu offers it on a task the reader started, while the account is in
 * another workspace, because the service lets only a task's owner move it.
 * Where the list does not say who started a task (a service before it), or
 * the window does not know who is signed in, it is offered all the same,
 * and the service's refusal says the rest.
 *
 * The dialog lists every other workspace with its tile, its name, and who
 * shares it. One whose GitHub cannot reach the task's repository is listed
 * disabled, saying why, because the service refuses that move as it would a
 * change of repository; a task with no repository can go anywhere. The
 * first that can take it is chosen. Under the list it says what the move
 * does for the one chosen: who in the task's workspace loses it, who in the
 * other gains it, and that its agents go with it. The dialog is the move's
 * confirmation, so its act is the move itself. The question goes with its
 * task and its surface (`@luke/ui`'s `useConfirmDialog`), a move
 * landed puts it away, and a refused one keeps it up saying so under the
 * list, the toast the move would raise held back in its favour.
 */

/** The keys that step along the list, and which way. */
const STEP_KEYS = new Map([
  ["ArrowDown", 1],
  ["ArrowRight", 1],
  ["ArrowUp", -1],
  ["ArrowLeft", -1],
]);

/** What the dialog says under its list when the service refused the move. */
const MOVE_REFUSED = "The task could not be moved. Try again.";

/** The workspaces a task may be moved to: every one the account is in but its own. */
function otherWorkspaces(tasks: TasksControl, task: TaskSummary): readonly Workspace[] {
  return tasks.workspaces.filter((workspace) => workspace.id !== task.workspaceId);
}

/** Whether the reader may be the one to move the task: its owner, or nobody the window can tell is not. */
function ownsTask(tasks: Pick<TasksControl, "me">, task: TaskSummary): boolean {
  return task.ownerId === undefined || tasks.me === undefined || task.ownerId === tasks.me;
}

/** Whether the workspace's GitHub reaches the task's repository (`workspaceReaches`); a task with no repository goes anywhere. */
function reaches(workspace: Workspace, repository: string | null): boolean {
  return repository === null || workspaceReaches(workspace, repository);
}

/** A row's line: who shares the workspace, or why it cannot take the task. */
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
  return `${github} · can’t reach ${repository}`;
}

/**
 * Who in the task's workspace loses it: nobody where the reader is alone,
 * else its members who are not in the workspace chosen too. Note that they
 * are not counted, because the window knows how many each workspace holds
 * but not who is in both, and one in both keeps the task.
 */
function lossLine(from: Workspace | undefined, to: Workspace): string {
  const losing = "lose access to it, its calls, and its agents.";
  if (from === undefined) return `Members of its workspace who aren't in ${to.name} ${losing}`;
  if (from.memberCount !== undefined && from.memberCount <= 1) {
    return `Nobody loses access: only you are in ${from.name}.`;
  }
  return `Members of ${from.name} who aren't in ${to.name} ${losing}`;
}

/** Who in the workspace chosen gains it: its members counted, or named as its members where they are not. */
function gainLine(to: Workspace): string {
  const { memberCount, name } = to;
  if (memberCount === undefined) return `Members of ${name} can read and edit it.`;
  if (memberCount <= 1) return `Only you can read and edit it in ${name}.`;
  return `${memberCount} people in ${name} can read and edit it.`;
}

/** The workspaces as a radio group: a tile, a name, and a line each, the chosen one checked and the keyboard's one stop. */
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
  /** The account's own first workspace, which a row calls personal while no one else is in it. */
  personalId: string | undefined;
  repository: string | null;
  chosen: Workspace | undefined;
  disabled: boolean;
  /** The chosen row, which takes focus as the dialog opens. */
  first: React.RefObject<HTMLButtonElement | null>;
  onChoose: (workspaceId: string) => void;
}): React.JSX.Element {
  const open = workspaces.filter((workspace) => reaches(workspace, repository));
  // An arrow chooses the next workspace that can take the task and takes the keyboard there, wrapping at either end.
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = STEP_KEYS.get(event.key);
    if (step === undefined || open.length === 0 || disabled) return;
    event.preventDefault();
    const at = open.findIndex((workspace) => workspace.id === chosen?.id);
    const next = open[(Math.max(at, 0) + step + open.length) % open.length];
    if (next === undefined) return;
    onChoose(next.id);
    event.currentTarget
      .querySelectorAll<HTMLButtonElement>('[role="radio"]')
      [workspaces.indexOf(next)]?.focus();
  };
  return (
    <div className="move-list" role="radiogroup" aria-label="Workspace" onKeyDown={onKeyDown}>
      {workspaces.map((workspace) => {
        const line = rowLine(workspace, repository, personalId);
        const checked = workspace.id === chosen?.id;
        return (
          // biome-ignore lint/a11y/useSemanticElements: a row is drawn as a button holding a tile and two lines, which a native radio cannot be, and speaks as the radio it behaves as.
          <button
            key={workspace.id}
            ref={checked ? first : undefined}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            className="move-row"
            disabled={disabled || !reaches(workspace, repository)}
            onClick={() => onChoose(workspace.id)}
          >
            <WorkspaceRef workspace={workspace} size={WORKSPACE_REF_SIZE.ROW} line={line} />
          </button>
        );
      })}
    </div>
  );
}

/** The dialog over the window while the move is asked, running, or refused, and nothing otherwise. */
function MoveTaskCard({
  confirm,
  task,
  from,
  workspaces,
  personalId,
  chosen,
  onChoose,
}: {
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
  const titleId = useId();
  const dismiss = () => {
    if (moving) return;
    confirm.keep();
    confirm.clear();
  };
  return (
    <ModalShell
      className="move-dialog"
      labelledBy={titleId}
      busy={moving}
      initialFocus={chosen === undefined ? cancel : first}
      onDismiss={dismiss}
    >
      <h2 id={titleId} className="confirm-dialog-title">
        Move “{task.name}” to another workspace
      </h2>
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
        <ul className="move-effects">
          <li>{lossLine(from, chosen)}</li>
          <li>{gainLine(chosen)}</li>
          <li>{`Its agents keep running, now in ${chosen.name}.`}</li>
        </ul>
      )}
      {rejection !== undefined && !moving ? (
        <p className="error-message" role="alert">
          {rejection}
        </p>
      ) : null}
      <div className="confirm-dialog-actions">
        <button
          type="button"
          ref={cancel}
          className="toolbar-button"
          disabled={moving}
          onClick={dismiss}
        >
          Cancel
        </button>
        <button
          type="button"
          className="primary-button"
          disabled={moving || chosen === undefined}
          onClick={() => confirm.run()}
        >
          <BusyLabel busy={moving} label="Moving">
            {chosen === undefined ? "Move" : `Move to ${chosen.name}`}
          </BusyLabel>
        </button>
      </div>
    </ModalShell>
  );
}

/**
 * The workspace a task's repository belongs to, where the reader may move
 * the task there: a task they own, not archived, its own workspace's GitHub
 * not reaching its repository and another of the account's reaching it
 * (`strandedTaskHome`). None for any other task. The task's banner
 * (`stranded-task-banner.tsx`), its sidebar row's mark, and its card read it.
 */
export function strandedHome(
  tasks: Pick<TasksControl, "me" | "workspaces">,
  task: TaskSummary,
): Workspace | undefined {
  if (task.archivedAt !== undefined || !ownsTask(tasks, task)) return undefined;
  return strandedTaskHome(task, tasks.workspaces);
}

/** One task's Move to workspace as a door holds it. */
interface MoveTaskDoor {
  /** The menu item's press; absent where the menu does not offer the move. */
  ask: (() => void) | undefined;
  /** The dialog to draw beside the menu, while the move is asked, running, or refused. */
  dialog: React.JSX.Element | null;
}

/** One task's Move to workspace, held for whichever door offers its menu. */
export function useMoveTaskDialog(
  tasks: TasksControl,
  task: TaskSummary | undefined,
): MoveTaskDoor {
  const others = task === undefined ? [] : otherWorkspaces(tasks, task);
  const offered =
    task !== undefined &&
    task.archivedAt === undefined &&
    others.length > 0 &&
    ownsTask(tasks, task);
  const [picked, setPicked] = useState<string | undefined>(undefined);
  const repository = task?.repository ?? null;
  const chosen =
    others.find((workspace) => workspace.id === picked && reaches(workspace, repository)) ??
    others.find((workspace) => reaches(workspace, repository));
  const move = (): Promise<ActionResult> => {
    if (task === undefined || chosen === undefined) {
      return Promise.resolve({
        status: ACTION_RESULT_STATUS.REJECTED,
        reason: "Choose a workspace.",
      });
    }
    return tasks
      .onMoveTask(task.id, chosen.id, { quiet: true })
      .then((moved) =>
        moved
          ? { status: ACTION_RESULT_STATUS.ACCEPTED }
          : { status: ACTION_RESULT_STATUS.REJECTED, reason: MOVE_REFUSED },
      );
  };
  const confirm = useConfirmDialog({ subject: offered, surfaceOpen: tasks.shown }, move);
  const open = confirm.standing && (confirmAsked(confirm.stage) || confirm.rejection !== undefined);
  return {
    ask: offered
      ? () => {
          setPicked(undefined);
          confirm.ask();
        }
      : undefined,
    dialog:
      open && task !== undefined ? (
        <MoveTaskCard
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
