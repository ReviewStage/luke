import { TASK_BOUNDS } from "@luke/features/task-wire";
import type { Workspace } from "@luke/features/workspace-wire";
import { workspaceReaches } from "@luke/ui/tasks-model";
import { useId, useRef, useState } from "react";
import { SHORTCUT_KEY, type ShortcutChord, shortcutAria } from "#shared/shortcuts";
import { WorkspaceTile } from "../desktop/workspace-tile";
import { ModalShell } from "../modal-shell";
import { PICKER_ALIGN, Picker } from "../settings/picker-row";
import { Shortcut } from "../shortcut";
import { BusyLabel } from "../spinner";
import { Switch } from "../switch";
import { Tooltip } from "../tooltip";
import { useNewTaskPlanning } from "./new-task-planning";
import { CHIP_PLACE, RepositoryChip } from "./repository-chip";
import type { PlansControl } from "./use-plans-tab";

/**
 * new-plan-dialog.tsx -- New plan as a small modal over the window: the plan's name, the GitHub repository it is about, Cancel and Create task.
 *
 * The window asks the way Linear's and Notion's "New …" ask: it dims over
 * whatever stood open, and a card holds the one field and the repository
 * chip. Its title says where the plan will start, "New plan in Acme", the
 * workspace a chip there that chooses another, as Linear's team chip and
 * GitHub's Owner do; the repository chip then lists that workspace's
 * repositories. Both chips are the app's one picker, Settings' bordered chip
 * and its menu, which hangs from the chip's leading edge here because each
 * chip leads its line. The repository chip leads the card's foot with Cancel
 * and Create task at its end, as the feedback dialog's screenshot button
 * leads its own. The field
 * takes focus, Tab stays inside the card, and focus goes back to whatever
 * opened it. The name is optional: a plan started with none stands as
 * "Untitled" until the developer renames it. The name is one
 * line, so Return creates the plan with any modifier held; Escape, Cancel, and a press on the dimmed window put the
 * card away with nothing started, its words with it. Nothing typed here
 * reaches the model as conversation. The repository starts on the one the
 * press chose (a repository group's +), else the one the newest plan in the
 * workspace was about, either only where the workspace's GitHub reaches it;
 * the chip offers the other recent ones, a search over every repository the
 * workspace's GitHub reaches, and the page where the developer chooses which
 * ones Luke can see. A workspace with no GitHub connected offers none, and
 * the plan starts with none, to be given one later. A
 * refusal keeps the card with the reason under the field, and Create task
 * can be pressed again; a plan started closes the card and opens as the
 * host's open plan, its call with it. The Plan switch at the title's end starts
 * the task without its planning phase where it is turned off: an empty plan
 * rather than the template, and no call. The switch is kept as it was left
 * for the next New task (`new-task-planning.ts`).
 */

/** Create task's chord: Return alone, from the name field. */
const CREATE_CHORD: ShortcutChord = { key: SHORTCUT_KEY.ENTER, bare: true };

/** What the Plan switch's description says the start will do, by its state. */
const PLANNING_NOTE = {
  ON: "Starts from your plan template and opens a call with Luke.",
  OFF: "Starts with an empty plan and no call.",
} as const;

/** What the workspace picker's menu says where no workspace matches; its list is short enough to read whole, so it is never searched. */
const NO_WORKSPACE_MATCH = "No workspaces match";

/**
 * The title's workspace: the one the plan starts in, by its tile and name, a
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
      disabled={disabled}
      onPick={onChoose}
    />
  );
}

/**
 * The card with its own state, mounted afresh on each opening so a
 * cancelled name is never offered again: the name, the repository chosen
 * over the press's or the last one used, and the start under way. The
 * chosen repository is null where it was let go, and undefined while the
 * workspace's last one used stands.
 */
function NewPlanCard({ newPlan }: { newPlan: PlansControl["newPlan"] }): React.JSX.Element {
  const [name, setName] = useState("");
  const [chosen, setChosen] = useState<string | null | undefined>(newPlan.preset?.repository);
  // The workspace the plan starts in: the one listed, until the title's chip chooses another.
  const [workspaceId, setWorkspaceId] = useState(newPlan.workspaceId);
  const startsIn = workspaceId ?? newPlan.workspaceId;
  const repositories = newPlan.repositoriesIn(startsIn);
  const workspace = newPlan.workspaces.find((each) => each.id === startsIn);
  // A repository picked in one workspace is none of another's, so a switch
  // lets the pick go, in the render that brings it; the scope first
  // resolving keeps a pick made before the workspaces were read.
  const [scope, setScope] = useState(repositories.scope);
  if (repositories.scope !== scope) {
    if (scope !== undefined) setChosen(undefined);
    setScope(repositories.scope);
  }
  const [planning, setPlanning] = useNewTaskPlanning();
  const [starting, setStarting] = useState(false);
  const [note, setNote] = useState<string | undefined>(undefined);
  const field = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const planningId = useId();
  const planningNoteId = useId();
  const planningNote = planning ? PLANNING_NOTE.ON : PLANNING_NOTE.OFF;
  // Note that a press's repository the workspace's GitHub does not reach is
  // not started on, because the service would refuse it.
  const pick =
    chosen != null && workspace !== undefined && !workspaceReaches(workspace, chosen)
      ? null
      : chosen;
  const repository = pick === undefined ? (repositories.recent[0] ?? null) : pick;
  const canStart = !starting;

  const start = () => {
    if (!canStart) return;
    setStarting(true);
    setNote(undefined);
    newPlan
      .start(name.trim(), repository, startsIn, planning)
      .then(setNote)
      .finally(() => setStarting(false));
  };
  const close = () => {
    if (!starting) newPlan.onClose();
  };

  // Return creates the plan with any modifier held, since the name has no
  // second line to begin.
  const fieldKey = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    start();
  };

  return (
    <ModalShell
      className="confirm-dialog new-plan-dialog ph-no-capture"
      labelledBy={titleId}
      busy={starting}
      initialFocus={field}
      onDismiss={close}
    >
      <div className="new-plan-head">
        <div className="new-plan-title">
          <h2 id={titleId} className="confirm-dialog-title">
            {startsIn === undefined ? "New task" : "New task in"}
          </h2>
          <WorkspaceChip
            workspaces={newPlan.workspaces}
            chosen={startsIn}
            disabled={starting}
            onChoose={setWorkspaceId}
          />
        </div>
        {/* Note that the word labels the switch, so a press on it turns the switch too. */}
        <Tooltip label={planningNote}>
          <span className="new-plan-planning">
            <label htmlFor={planningId}>Plan</label>
            <Switch
              id={planningId}
              checked={planning}
              label="Plan with Luke"
              describedBy={planningNoteId}
              disabled={starting}
              onChange={setPlanning}
            />
            <span id={planningNoteId} hidden>
              {planningNote}
            </span>
          </span>
        </Tooltip>
      </div>
      <input
        ref={field}
        type="text"
        className="dialog-name-field"
        aria-label="Task name"
        aria-keyshortcuts={shortcutAria(CREATE_CHORD)}
        placeholder="Task name (optional)"
        maxLength={TASK_BOUNDS.MAX_NAME_CHARS}
        spellCheck
        value={name}
        disabled={starting}
        onChange={(event) => setName(event.currentTarget.value)}
        onKeyDown={fieldKey}
      />
      {note === undefined ? null : (
        <p className="error-message" role="alert">
          {note}
        </p>
      )}
      <div className="confirm-dialog-actions">
        <RepositoryChip
          key={repositories.scope}
          place={CHIP_PLACE.FIELD}
          align={PICKER_ALIGN.START}
          value={repository}
          chooser={repositories}
          onChoose={setChosen}
          onUnreached={() => setChosen(null)}
        />
        <button type="button" className="toolbar-button" disabled={starting} onClick={close}>
          Cancel
        </button>
        <button
          type="button"
          className="primary-button"
          aria-keyshortcuts={shortcutAria(CREATE_CHORD)}
          aria-busy={starting}
          disabled={!canStart}
          onClick={start}
        >
          <BusyLabel busy={starting} label="Creating">
            Create task
          </BusyLabel>
          <Shortcut chord={CREATE_CHORD} />
        </button>
      </div>
    </ModalShell>
  );
}

/** The card over the window while New plan is asked, in the window's one modal frame (`../modal-shell.tsx`); nothing otherwise. */
export function NewPlanDialog({
  newPlan,
}: {
  newPlan: PlansControl["newPlan"];
}): React.JSX.Element | null {
  if (!newPlan.open) return null;
  return <NewPlanCard newPlan={newPlan} />;
}
