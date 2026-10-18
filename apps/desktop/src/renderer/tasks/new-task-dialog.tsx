import type { Workspace } from "@luke/features/workspace-wire";
import { CHIP_WIDTH, DIALOG_SIZE, Dialog, TEXT_ELEMENT, TEXT_VARIANT, Text } from "@luke/ui";
import { type RefObject, useId, useMemo, useRef, useState } from "react";
import { WorkspaceTile } from "../desktop/workspace-tile";
import { PICKER_ALIGN, Picker } from "../settings/picker-row";
import { NewTaskComposer } from "./new-task-composer";
import type { TasksControl } from "./use-tasks-tab";

/**
 * new-task-dialog.tsx -- New task as a small modal over the window: where the task starts, and the composer card whose words start a coding agent on it, or a plan with Luke.
 *
 * The window asks the way Linear's and Notion's "New …" ask: it dims over
 * whatever stood open, and a card holds the title and New task's composer
 * (`new-task-composer.tsx`), which takes focus. Its title says where the
 * task will start, "New task in Acme", the workspace a chip there that
 * chooses another, as Linear's team chip and GitHub's Owner do: the app's
 * one picker, Settings' bordered chip and its menu, hung from the chip's
 * leading edge. The composer then lists that workspace's repositories and
 * its Linear issues, and a switch lets go of a repository or an issue
 * picked in the other.
 *
 * What the composer starts is its own to say: in Agent mode a task with an
 * empty plan and a coding agent on the words, opened on the agent's tab; in
 * Plan mode the plan template and a call with Luke. Tab stays inside the
 * card, and focus goes back to whatever opened it. Escape, with no menu or
 * dictation standing in the card, and a press on the dimmed window put the
 * card away with nothing started, its words with it; a start under way
 * holds the card. A refusal keeps the card with the reason under the
 * composer, and Start can be pressed again; a task started closes the card
 * and opens as the host's open task.
 *
 * Opened from one of the workspace's own issues (its Start task…), the card
 * says so in its title, starts in the issue's workspace and no other, names
 * the task by the issue, and offers no Linear chip; the task it starts is
 * linked to that issue, which the issue's page lists it under.
 */

/** The card's title, before the workspace's chip: the issue it starts from where there is one, and "in" where the chip stands after it. */
function newTaskHeading(issue: string | undefined, inWorkspace: boolean): string {
  const heading = issue === undefined ? "New task" : `New task from ${issue}`;
  return inWorkspace ? `${heading} in` : heading;
}

/** The composer's words field, the editor's own textbox, which the card hands focus to. */
const FIELD_SELECTOR = '[role="textbox"]';

/** What the workspace picker's menu says where no workspace matches; its list is short enough to read whole, so it is never searched. */
const NO_WORKSPACE_MATCH = "No workspaces match";

/**
 * The title's workspace: the one the task starts in, by its tile and name, a
 * press away from the picker's menu of every workspace the account is in,
 * the one chosen checked; nothing before the workspaces are read.
 */
function WorkspaceChip({
  workspaces,
  chosen,
  disabled,
  onChoose,
}: {
  workspaces: readonly Workspace[];
  chosen: string | undefined;
  disabled: boolean;
  onChoose: (workspaceId: string) => void;
}): React.JSX.Element | null {
  const workspace = workspaces.find((each) => each.id === chosen);
  if (workspace === undefined) return null;
  return (
    <Picker
      label="Workspace"
      value={workspace.id}
      valueLabel={workspace.name}
      valueIcon={<WorkspaceTile workspace={workspace} />}
      rows={workspaces.map((each) => ({
        id: each.id,
        label: each.name,
        icon: <WorkspaceTile workspace={each} />,
      }))}
      noMatch={NO_WORKSPACE_MATCH}
      align={PICKER_ALIGN.START}
      width={CHIP_WIDTH.AUTO}
      disabled={disabled}
      onPick={onChoose}
    />
  );
}

/**
 * The card with its own state, mounted afresh on each opening so cancelled
 * words are never offered again: the workspace chosen, and whether a start
 * is under way, which holds the card.
 */
function NewTaskCard({ newTask }: { newTask: TasksControl["newTask"] }): React.JSX.Element {
  // The workspace's own issue the task starts from, where the card was opened on one: it names the task, and its workspace is the one the task starts in.
  const from = newTask.preset?.issue;
  // The workspace the task starts in: the one listed, or the issue's, until the title's chip chooses another.
  const [workspaceId, setWorkspaceId] = useState(from?.workspaceId ?? newTask.workspaceId);
  const startsIn = workspaceId ?? newTask.workspaceId;
  const [starting, setStarting] = useState(false);
  const titleId = useId();
  const body = useRef<HTMLDivElement>(null);
  // Note that the field is the editor the composer mounts once its bundle
  // has landed, so the card hands focus to it by where it stands rather than
  // by a ref of its own; before it lands the field takes the caret itself.
  const field = useMemo(
    (): RefObject<HTMLElement | null> => ({
      get current() {
        return body.current?.querySelector<HTMLElement>(FIELD_SELECTOR) ?? null;
      },
    }),
    [],
  );
  const close = () => {
    if (!starting) newTask.onClose();
  };

  return (
    <Dialog
      size={DIALOG_SIZE.WIDE}
      labelledBy={titleId}
      busy={starting}
      initialFocus={field}
      onDismiss={close}
    >
      <div className="new-task ph-no-capture" ref={body}>
        <div className="new-task-head">
          <div className="new-task-title">
            <Text variant={TEXT_VARIANT.DIALOG} as={TEXT_ELEMENT.H2} id={titleId}>
              {newTaskHeading(from?.identifier, startsIn !== undefined)}
            </Text>
            <WorkspaceChip
              workspaces={newTask.workspaces}
              chosen={startsIn}
              disabled={starting || from !== undefined}
              onChoose={setWorkspaceId}
            />
          </div>
        </div>
        <NewTaskComposer
          newTask={newTask}
          workspaceId={startsIn}
          from={from}
          onStarting={setStarting}
          onLeave={close}
          focusedByOwner
        />
      </div>
    </Dialog>
  );
}

/** The card over the window while New task is asked, in `@luke/ui`'s shared `Dialog`; nothing otherwise. */
export function NewTaskDialog({
  newTask,
}: {
  newTask: TasksControl["newTask"];
}): React.JSX.Element | null {
  if (!newTask.open) return null;
  return <NewTaskCard newTask={newTask} />;
}
