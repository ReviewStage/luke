import type { LinearIssueSummary } from "@luke/features/linear-wire";
import { TASK_BOUNDS } from "@luke/features/task-wire";
import type { Workspace } from "@luke/features/workspace-wire";
import { WorkspaceTile } from "@luke/panel/desktop/workspace-tile";
import { Shortcut } from "@luke/panel/shortcut";
import { useNewTaskPlanning } from "@luke/panel/tasks/new-task-planning";
import { Tooltip } from "@luke/panel/tooltip";
import {
  SHORTCUT_KEY,
  type ShortcutChord,
  shortcutAria,
  shortcutMatches,
} from "@luke/settings/shortcuts";
import {
  BUTTON_VARIANT,
  Button,
  CHIP_WIDTH,
  DIALOG_SIZE,
  Dialog,
  ErrorState,
  Switch,
  TEXT_ELEMENT,
  TEXT_VARIANT,
  Text,
  TextField,
} from "@luke/ui";
import { taskNameOfIssue, workspaceReaches } from "@luke/ui/tasks-model";
import { useId, useRef, useState } from "react";
import { PICKER_ALIGN, Picker } from "../settings/picker-row";
import { LINEAR_CHORD, LinearIssueChip } from "./linear-issue-chip";
import { CHIP_PLACE, RepositoryChip } from "./repository-chip";
import type { TasksControl } from "./use-tasks-tab";

/**
 * new-task-dialog.tsx -- New task as a small modal over the window: the task's name, the GitHub repository it is about, Cancel and Create task.
 *
 * The window asks the way Linear's and Notion's "New …" ask: it dims over
 * whatever stood open, and a card holds the one field and the repository
 * chip. Its title says where the task will start, "New task in Acme", the
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
 * press chose (a repository group's +), else the one the newest task in the
 * workspace was about, either only where the workspace's GitHub reaches it;
 * the chip offers the other recent ones, a search over every repository the
 * workspace's GitHub reaches, and the page where the developer chooses which
 * ones Luke can see. A workspace with no GitHub connected offers none, and
 * the task starts with none, to be given one later. A
 * refusal keeps the card with the reason under the field, and Create task
 * can be pressed again; a plan started closes the card and opens as the
 * host's open plan, its call with it. The Plan switch at the title's end starts
 * the task without its planning phase where it is turned off: an empty plan
 * rather than the template, and no call. The switch is kept as it was left
 * for the next New task (`new-task-planning.ts`).
 *
 * The name field is only ever the name: typing in it searches nothing.
 * Where the workspace the task starts in has Linear connected, a Linear
 * chip stands after the repository chip in the card's foot
 * (`linear-issue-chip.tsx`), and a press on it, or ⌘L from the card, opens
 * a search over that workspace's issues, read as the card opens and again
 * on a switch of workspace, which closes the search. With nothing typed it
 * lists the issues read; typing narrows them at once, and once the typing
 * rests Linear itself is searched, so an issue older than those read is
 * found too, and a key or a link to an issue pasted asks Linear for that one
 * issue. The arrows move through them, Return chooses, and Escape closes the
 * search and leaves the card. Choosing an issue starts its task at once,
 * named by its title, on the repository, in the workspace, and with the
 * planning the card shows, and Luke is handed the issue to research.
 *
 * Opened from one of the workspace's own issues (its Start task…), the card
 * says so in its title, its name starts as the issue's title, it starts in
 * the issue's workspace and no other, and it offers no Linear chip; the
 * task it starts is linked to that issue, which the issue's page lists it
 * under. Opened from the issue's Start agent…, the card is a new agent's:
 * it offers no Plan switch, since the task starts without its planning
 * phase, asks for a repository for the agent to work in, and its Start
 * agent starts the task and an agent on it at once, which opens on its tab.
 */

/** Create task's chord: Return alone, from the name field. */
const CREATE_CHORD: ShortcutChord = { key: SHORTCUT_KEY.ENTER, bare: true };

/** What the name field says before anything is typed. */
const NAME_PLACEHOLDER = "Task name (optional)";

/** The card's title, before the workspace's chip: an agent's where one starts at once, the issue it starts from where there is one, and "in" where the chip stands after it. */
function newTaskHeading(issue: string | undefined, inWorkspace: boolean, agent: boolean): string {
  const what = agent ? "New agent" : "New task";
  const heading = issue === undefined ? what : `${what} from ${issue}`;
  return inWorkspace ? `${heading} in` : heading;
}

/** What the card says where an agent is asked to start with no repository chosen for it to work in. */
const AGENT_NEEDS_REPOSITORY = "Choose a repository for the agent to work in.";

/** What the Plan switch's description says the start will do, by its state. */
const PLANNING_NOTE = {
  ON: "Starts from your plan template and opens a call with Luke.",
  OFF: "Starts with an empty plan and no call.",
} as const;

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
 * The card with its own state, mounted afresh on each opening so a
 * cancelled name is never offered again: the name, the repository chosen
 * over the press's or the last one used, and the start under way. The
 * chosen repository is null where it was let go, and undefined while the
 * workspace's last one used stands.
 */
function NewTaskCard({ newTask }: { newTask: TasksControl["newTask"] }): React.JSX.Element {
  // The workspace's own issue the task starts from, where the card was opened on one: it names the task, and its workspace is the one the task starts in.
  const from = newTask.preset?.issue;
  // Whether an agent starts on the task at once, without its planning phase: what an issue's Start agent… asks.
  const agent = newTask.preset?.agent === true;
  const [name, setName] = useState(from?.title ?? "");
  const [chosen, setChosen] = useState<string | null | undefined>(newTask.preset?.repository);
  // The workspace the task starts in: the one listed, or the issue's, until the title's chip chooses another.
  const [workspaceId, setWorkspaceId] = useState(from?.workspaceId ?? newTask.workspaceId);
  // Note that a task from one of the workspace's issues starts from that issue alone, so it offers no Linear chip.
  const linearIssuesIn: TasksControl["newTask"]["linearIssuesIn"] =
    from === undefined ? newTask.linearIssuesIn : () => undefined;
  const startsIn = workspaceId ?? newTask.workspaceId;
  const repositories = newTask.repositoriesIn(startsIn);
  const workspace = newTask.workspaces.find((each) => each.id === startsIn);
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
  const searchesLinear = linearIssuesIn(startsIn) !== undefined;
  // How many times ⌘L asked the Linear chip to open its menu.
  const [linearAsks, setLinearAsks] = useState(0);
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

  const begin = (taskName: string, issue?: LinearIssueSummary) => {
    if (!canStart) return;
    // Note that an agent works in a repository, so one asked to start with none is not asked for.
    if (agent && repository === null) {
      setNote(AGENT_NEEDS_REPOSITORY);
      return;
    }
    setStarting(true);
    setNote(undefined);
    newTask
      .start(taskName, repository, startsIn, agent ? false : planning, {
        ...(issue === undefined ? undefined : { linearIssueId: issue.id }),
        ...(from === undefined ? undefined : { issueId: from.id }),
        ...(agent ? { agent } : undefined),
      })
      .then(setNote)
      .finally(() => setStarting(false));
  };
  const start = () => begin(name.trim());
  const startIssue = (issue: LinearIssueSummary) => begin(taskNameOfIssue(issue), issue);
  // ⌘L from the card opens the Linear chip's menu, where the chip stands.
  const onCardKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    // Note that a key an input method is composing with is its own, Safari's last one (229) among them.
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (!searchesLinear || starting || !shortcutMatches(LINEAR_CHORD, event)) return;
    event.preventDefault();
    setLinearAsks((asks) => asks + 1);
  };
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
      {/* biome-ignore lint/a11y/noStaticElementInteractions: ⌘L is read as it bubbles from the card's own controls, the name field first, which are what take the keys. */}
      <div className="new-task ph-no-capture" onKeyDown={onCardKey}>
        <div className="new-task-head">
          <div className="new-task-title">
            <Text variant={TEXT_VARIANT.DIALOG} as={TEXT_ELEMENT.H2} id={titleId}>
              {newTaskHeading(from?.identifier, startsIn !== undefined, agent)}
            </Text>
            <WorkspaceChip
              workspaces={newTask.workspaces}
              chosen={startsIn}
              disabled={starting || from !== undefined}
              onChoose={setWorkspaceId}
            />
          </div>
          {/* Note that an agent started at once starts without planning, so its card offers no Plan switch. */}
          {agent ? null : (
            <>
              {/* Note that the word labels the switch, so a press on it turns the switch too. */}
              <Tooltip label={planningNote}>
                <span className="new-task-planning">
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
            </>
          )}
        </div>
        <TextField
          ref={field}
          label="Task name"
          keyShortcuts={shortcutAria(CREATE_CHORD)}
          placeholder={NAME_PLACEHOLDER}
          maxLength={TASK_BOUNDS.MAX_NAME_CHARS}
          spellCheck
          value={name}
          disabled={starting}
          onChange={setName}
          onEnter={start}
        />
        {note === undefined ? null : <ErrorState>{note}</ErrorState>}
        <div className="new-task-actions">
          <RepositoryChip
            key={repositories.scope}
            place={CHIP_PLACE.FIELD}
            width={CHIP_WIDTH.AUTO}
            align={PICKER_ALIGN.START}
            value={repository}
            chooser={repositories}
            onChoose={setChosen}
            onUnreached={() => setChosen(null)}
          />
          <LinearIssueChip
            readIn={linearIssuesIn}
            workspaceId={startsIn}
            disabled={starting}
            openRequest={linearAsks}
            onChoose={startIssue}
          />
          <div className="new-task-answers">
            <Button disabled={starting} onClick={close}>
              Cancel
            </Button>
            <Button
              variant={BUTTON_VARIANT.PRIMARY}
              aria-keyshortcuts={shortcutAria(CREATE_CHORD)}
              busy={starting}
              busyLabel={agent ? "Starting" : "Creating"}
              onClick={start}
            >
              {agent ? "Start agent" : "Create task"}
              <Shortcut chord={CREATE_CHORD} />
            </Button>
          </div>
        </div>
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
