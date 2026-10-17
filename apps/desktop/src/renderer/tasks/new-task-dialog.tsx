import { INTEGRATION_PROVIDER } from "@luke/features/integration-wire";
import type { LinearIssueSummary } from "@luke/features/linear-wire";
import { TASK_BOUNDS } from "@luke/features/task-wire";
import type { Workspace } from "@luke/features/workspace-wire";
import { ComposeIcon, ProviderMark } from "@luke/ui";
import { searchTokens } from "@luke/ui/search-tokens";
import { matchingIssues, taskNameOfIssue, workspaceReaches } from "@luke/ui/tasks-model";
import { useEffect, useId, useRef, useState } from "react";
import { SHORTCUT_KEY, type ShortcutChord, shortcutAria } from "#shared/shortcuts";
import { WorkspaceTile } from "../desktop/workspace-tile";
import { ModalShell } from "../modal-shell";
import { Highlighted } from "../search-field";
import { PICKER_ALIGN, Picker } from "../settings/picker-row";
import { Shortcut } from "../shortcut";
import { BusyLabel } from "../spinner";
import { Switch } from "../switch";
import { Tooltip } from "../tooltip";
import { useNewTaskPlanning } from "./new-task-planning";
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
 * Where the workspace the task starts in has Linear connected, the name
 * field is also the search over its issues, read as the card opens and
 * again on a switch of workspace: as soon as anything is typed, the issues
 * whose title or key holds every word stand under the field, nearest first,
 * the top one highlighted, and the arrows move the highlight on through
 * them to the last row, which creates the task under the name as typed.
 * Return, or Create, does what the highlight says: an issue starts its task
 * at once, named by its title, on the repository, in the workspace, and with
 * the planning the card shows, and Luke is handed the issue to research.
 * Command-Return creates the task under the name as typed whatever is
 * highlighted, and Escape puts the issues away before it puts the card away.
 * With no issue matching, or no Linear connected, or its issues not read,
 * the field is the plain name it always was.
 */

/** Create task's chord: Return alone, from the name field. */
const CREATE_CHORD: ShortcutChord = { key: SHORTCUT_KEY.ENTER, bare: true };

/** The chord that creates the task under the name as typed while Linear's issues stand under the field. */
const TYPED_CHORD: ShortcutChord = { key: SHORTCUT_KEY.ENTER };

/** What the name field says before anything is typed, by whether it also searches Linear. */
const NAME_PLACEHOLDER = {
  PLAIN: "Task name (optional)",
  LINEAR: "Task name, or search Linear issues",
} as const;

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
      disabled={disabled}
      onPick={onChoose}
    />
  );
}

/**
 * The Linear issues of the workspace the task starts in, read as the card
 * opens and again for another workspace; none while they are read, where
 * that workspace has no Linear connected, or where the read was refused,
 * which leaves the name a plain field rather than a search that failed.
 */
function useLinearIssues(
  readIn: TasksControl["newTask"]["linearIssuesIn"],
  workspaceId: string | undefined,
): readonly LinearIssueSummary[] {
  const [issues, setIssues] = useState<readonly LinearIssueSummary[]>([]);
  // Note that the reader is held through a ref, because the tab hands a new
  // one on every render and a read is owed to a workspace, not a render.
  const latest = useRef(readIn);
  latest.current = readIn;
  const connected = readIn(workspaceId) !== undefined;
  useEffect(() => {
    setIssues([]);
    const reading = connected ? latest.current(workspaceId) : undefined;
    if (reading === undefined) return;
    let current = true;
    reading().then(
      (listed) => {
        if (current) setIssues(listed);
      },
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [connected, workspaceId]);
  return issues;
}

/** One issue under the name field: Linear's mark, its title with the words typed marked, then its key and state. */
function IssueOption({
  id,
  issue,
  tokens,
  highlighted,
  onHighlight,
  onPick,
}: {
  id: string;
  issue: LinearIssueSummary;
  tokens: readonly string[];
  highlighted: boolean;
  onHighlight: () => void;
  onPick: () => void;
}): React.JSX.Element {
  return (
    <button
      id={id}
      type="button"
      role="option"
      tabIndex={-1}
      className="menu-item"
      aria-selected={highlighted}
      onMouseMove={onHighlight}
      onClick={onPick}
    >
      <span className="menu-item-glyph">
        <ProviderMark provider={INTEGRATION_PROVIDER.LINEAR} />
      </span>
      <span className="task-compose-menu-name">
        <Highlighted text={issue.title} tokens={tokens} />
      </span>
      <span className="task-compose-menu-detail">
        {issue.state === undefined ? issue.identifier : `${issue.identifier} · ${issue.state}`}
      </span>
    </button>
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
  const [name, setName] = useState("");
  const [chosen, setChosen] = useState<string | null | undefined>(newTask.preset?.repository);
  // The workspace the task starts in: the one listed, until the title's chip chooses another.
  const [workspaceId, setWorkspaceId] = useState(newTask.workspaceId);
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
  const searchesLinear = newTask.linearIssuesIn(startsIn) !== undefined;
  const issues = useLinearIssues(newTask.linearIssuesIn, startsIn);
  // The row the arrows stand on among the issues and, after them, the name as typed; and whether Escape put the issues away until the next keystroke.
  const [highlight, setHighlight] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const matches = dismissed ? [] : matchingIssues(issues, name);
  const matching = matches.length > 0;
  const at = Math.min(highlight, matches.length);
  const picked = matching ? matches[at] : undefined;
  const tokens = searchTokens(name);
  const field = useRef<HTMLInputElement>(null);
  const listId = useId();
  const optionId = useId();
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
    setStarting(true);
    setNote(undefined);
    newTask
      .start(taskName, repository, startsIn, planning, issue?.id)
      .then(setNote)
      .finally(() => setStarting(false));
  };
  const startTyped = () => begin(name.trim());
  const startIssue = (issue: LinearIssueSummary) => begin(taskNameOfIssue(issue), issue);
  // Create does what Return does: the highlighted issue, else the name as typed.
  const start = () => (picked === undefined ? startTyped() : startIssue(picked));
  const close = () => {
    if (!starting) newTask.onClose();
  };

  // Return starts what is highlighted, and Command-Return the name as typed;
  // with no issues standing, Return creates the task with any modifier held,
  // since the name has no second line to begin. The arrows wrap through the
  // issues and the typed name's row after them.
  const fieldKey = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (matching && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      const rows = matches.length + 1;
      setHighlight((at + (event.key === "ArrowDown" ? 1 : -1) + rows) % rows);
      return;
    }
    // Note that Escape goes no further while issues stand, because the card
    // would put itself away with the name when only the issues were meant.
    if (matching && event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setDismissed(true);
      return;
    }
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (event.metaKey || event.ctrlKey) startTyped();
    else start();
  };

  return (
    <ModalShell
      className="confirm-dialog new-task-dialog ph-no-capture"
      labelledBy={titleId}
      busy={starting}
      initialFocus={field}
      onDismiss={close}
    >
      <div className="new-plan-head">
        <div className="new-task-title">
          <h2 id={titleId} className="confirm-dialog-title">
            {startsIn === undefined ? "New task" : "New task in"}
          </h2>
          <WorkspaceChip
            workspaces={newTask.workspaces}
            chosen={startsIn}
            disabled={starting}
            onChoose={(chosenId) => {
              setWorkspaceId(chosenId);
              setHighlight(0);
              setDismissed(false);
            }}
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
      <div className="new-task-name" data-matching={String(matching)}>
        <input
          ref={field}
          type="text"
          className="dialog-name-field"
          role="combobox"
          aria-label="Task name"
          aria-keyshortcuts={shortcutAria(CREATE_CHORD)}
          aria-expanded={matching}
          aria-controls={matching ? listId : undefined}
          aria-autocomplete={searchesLinear ? "list" : undefined}
          aria-activedescendant={matching ? `${optionId}-${at}` : undefined}
          autoComplete="off"
          placeholder={searchesLinear ? NAME_PLACEHOLDER.LINEAR : NAME_PLACEHOLDER.PLAIN}
          maxLength={TASK_BOUNDS.MAX_NAME_CHARS}
          spellCheck
          value={name}
          disabled={starting}
          onChange={(event) => {
            setName(event.currentTarget.value);
            setHighlight(0);
            setDismissed(false);
          }}
          onKeyDown={fieldKey}
        />
        {/* Note that a press on a row is kept from taking focus, because the
            field is where the keys are read. */}
        {matching ? (
          <div
            id={listId}
            className="new-task-matches"
            role="listbox"
            aria-label="Linear issues"
            onMouseDown={(event) => event.preventDefault()}
          >
            <div className="menu-heading" aria-hidden="true">
              Linear issues
            </div>
            {matches.map((issue, index) => (
              <IssueOption
                key={issue.id}
                id={`${optionId}-${index}`}
                issue={issue}
                tokens={tokens}
                highlighted={index === at}
                onHighlight={() => setHighlight(index)}
                onPick={() => startIssue(issue)}
              />
            ))}
            <button
              id={`${optionId}-${matches.length}`}
              type="button"
              role="option"
              tabIndex={-1}
              className="menu-item"
              aria-selected={at === matches.length}
              onMouseMove={() => setHighlight(matches.length)}
              onClick={startTyped}
            >
              <span className="menu-item-glyph">
                <ComposeIcon />
              </span>
              <span className="task-compose-menu-name">Create task “{name.trim()}”</span>
              <Shortcut chord={TYPED_CHORD} className="menu-item-hint" />
            </button>
          </div>
        ) : null}
      </div>
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
          <BusyLabel busy={starting} label={picked === undefined ? "Creating" : "Starting"}>
            {picked === undefined ? "Create task" : `Start ${picked.identifier}`}
          </BusyLabel>
          <Shortcut chord={CREATE_CHORD} />
        </button>
      </div>
    </ModalShell>
  );
}

/** The card over the window while New task is asked, in the window's one modal frame (`../modal-shell.tsx`); nothing otherwise. */
export function NewTaskDialog({
  newTask,
}: {
  newTask: TasksControl["newTask"];
}): React.JSX.Element | null {
  if (!newTask.open) return null;
  return <NewTaskCard newTask={newTask} />;
}
