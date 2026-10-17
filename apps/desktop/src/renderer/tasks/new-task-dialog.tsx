import { useAtom } from "@effect/atom-react";
import { INTEGRATION_PROVIDER } from "@luke/features/integration-wire";
import type { LinearIssueSummary } from "@luke/features/linear-wire";
import { TASK_BOUNDS } from "@luke/features/task-wire";
import type { Workspace } from "@luke/features/workspace-wire";
import {
  BUTTON_VARIANT,
  Button,
  Combobox,
  ComposeIcon,
  DIALOG_SIZE,
  Dialog,
  ErrorState,
  ProviderMark,
  Switch,
  TEXT_ELEMENT,
  TEXT_VARIANT,
  Text,
} from "@luke/ui";
import { searchTokens } from "@luke/ui/search-tokens";
import {
  type LinearIssuesAsk,
  linearIssuesAskOf,
  offeredIssues,
  taskNameOfIssue,
  workspaceReaches,
} from "@luke/ui/tasks-model";
import { Duration, Effect } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { useEffect, useId, useRef, useState } from "react";
import { SHORTCUT_KEY, type ShortcutChord, shortcutAria } from "#shared/shortcuts";
import { WorkspaceTile } from "../desktop/workspace-tile";
import { rendererRuntime } from "../renderer-runtime";
import { Highlighted } from "../search-field";
import { PICKER_ALIGN, Picker } from "../settings/picker-row";
import { Shortcut } from "../shortcut";
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
 * again on a switch of workspace. As soon as anything is typed, the issues
 * whose title or key holds every word stand under the field, and once the
 * typing rests Linear itself is searched for the words, so an issue older
 * than those read is found too;
 * a key typed whole or a link to an issue pasted asks Linear for that one
 * issue instead. They stand nearest first, the top one highlighted, and the
 * arrows move the highlight on through them to the last row, which creates
 * the task under the name as typed.
 * Return, or Create, does what the highlight says: an issue starts its task
 * at once, named by its title, on the repository, in the workspace, and with
 * the planning the card shows, and Luke is handed the issue to research.
 * Command-Return creates the task under the name as typed whatever is
 * highlighted, and Escape puts the issues away before it puts the card away.
 * The field and its issues are `@luke/ui`'s `Combobox`, which reads those
 * keys; with no issues standing, Return creates the task with any modifier
 * held, since the name has no second line to begin.
 * With no issue matching, or no Linear connected, or its issues not read,
 * the field is the plain name it always was.
 */

/** Create task's chord: Return alone, from the name field. */
const CREATE_CHORD: ShortcutChord = { key: SHORTCUT_KEY.ENTER, bare: true };

/** The chord that creates the task under the name as typed while Linear's issues stand under the field. */
const TYPED_CHORD: ShortcutChord = { key: SHORTCUT_KEY.ENTER };

/** The key of the last option under the field, which creates the task under the name as typed. */
const TYPED_OPTION = "typed";

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

/** How long the typing rests before Linear is searched for the name as typed. */
const SEARCH_PAUSE = Duration.millis(250);

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

/** One search of a workspace's Linear for the name as typed, and the read that asks it. */
interface IssueSearch {
  readonly workspaceId: string | undefined;
  readonly typed: string;
  readonly ask: LinearIssuesAsk;
  readonly read: (ask: LinearIssuesAsk) => Promise<readonly LinearIssueSummary[]>;
}

/** What one search found, and the workspace and the name it was for. */
interface IssueSearchAnswer {
  readonly workspaceId: string | undefined;
  readonly typed: string;
  readonly issues: readonly LinearIssueSummary[];
}

/**
 * A search once the typing has rested, as an atom whose work is the wait and
 * then the read: setting it again starts the wait over and lets go of the
 * read still out, so only the newest name is answered. A refused read
 * finds nothing.
 */
const issueSearchAtom = () =>
  rendererRuntime.fn((search: IssueSearch) =>
    Effect.gen(function* () {
      yield* Effect.sleep(SEARCH_PAUSE);
      const issues = yield* Effect.tryPromise(() => search.read(search.ask)).pipe(
        Effect.orElseSucceed((): readonly LinearIssueSummary[] => []),
      );
      return { workspaceId: search.workspaceId, typed: search.typed, issues };
    }),
  );

/**
 * Linear searched for the name as typed in the workspace given, once the
 * typing rests: the last answer, whichever name and workspace it was for,
 * and the search to ask as the name or the workspace changes.
 */
function useLinearSearch(
  readIn: TasksControl["newTask"]["linearIssuesIn"],
): readonly [
  IssueSearchAnswer | undefined,
  (typed: string, workspaceId: string | undefined) => void,
] {
  const [atom] = useState(issueSearchAtom);
  const [answer, search] = useAtom(atom);
  const ask = (typed: string, workspaceId: string | undefined) => {
    const read = readIn(workspaceId);
    const asked = linearIssuesAskOf(typed);
    if (read === undefined || asked === undefined) return;
    search({ workspaceId, typed: typed.trim(), ask: asked, read });
  };
  return [AsyncResult.isSuccess(answer) ? answer.value : undefined, ask];
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
  const [searched, searchLinear] = useLinearSearch(newTask.linearIssuesIn);
  // What Linear found for the name as it now stands is offered whatever it
  // holds; what it found for an earlier name stands with the issues read,
  // offered only where it holds the words, until the newer search answers.
  const answered = searched?.workspaceId === startsIn ? searched : undefined;
  const current = answered !== undefined && answered.typed === name.trim();
  const found = current ? answered.issues : [];
  const known = current || answered === undefined ? issues : [...issues, ...answered.issues];
  // The row the arrows stand on among the issues and, after them, the name as typed; and whether Escape put the issues away until the next keystroke.
  const [highlight, setHighlight] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const matches = dismissed ? [] : offeredIssues(known, name, found);
  const matching = matches.length > 0;
  const at = Math.min(highlight, matches.length);
  const picked = matching ? matches[at] : undefined;
  const tokens = searchTokens(name);
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

  return (
    <Dialog
      size={DIALOG_SIZE.WIDE}
      labelledBy={titleId}
      busy={starting}
      initialFocus={field}
      onDismiss={close}
    >
      <div className="new-task ph-no-capture">
        <div className="new-task-head">
          <div className="new-task-title">
            <Text variant={TEXT_VARIANT.DIALOG} as={TEXT_ELEMENT.H2} id={titleId}>
              {startsIn === undefined ? "New task" : "New task in"}
            </Text>
            <WorkspaceChip
              workspaces={newTask.workspaces}
              chosen={startsIn}
              disabled={starting}
              onChoose={(chosenId) => {
                setWorkspaceId(chosenId);
                setHighlight(0);
                setDismissed(false);
                searchLinear(name, chosenId);
              }}
            />
          </div>
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
        </div>
        <Combobox
          ref={field}
          label="Task name"
          listLabel="Linear issues"
          keyShortcuts={shortcutAria(CREATE_CHORD)}
          placeholder={searchesLinear ? NAME_PLACEHOLDER.LINEAR : NAME_PLACEHOLDER.PLAIN}
          maxLength={TASK_BOUNDS.MAX_NAME_CHARS}
          spellCheck
          value={name}
          disabled={starting}
          onChange={(typed) => {
            setName(typed);
            setHighlight(0);
            setDismissed(false);
            searchLinear(typed, startsIn);
          }}
          groups={[
            {
              label: "Linear issues",
              options: matches.map((issue) => ({
                id: issue.id,
                label: <Highlighted text={issue.title} tokens={tokens} />,
                icon: <ProviderMark provider={INTEGRATION_PROVIDER.LINEAR} />,
                detail:
                  issue.state === undefined
                    ? issue.identifier
                    : `${issue.identifier} · ${issue.state}`,
              })),
            },
            {
              options: [
                {
                  id: TYPED_OPTION,
                  label: `Create task “${name.trim()}”`,
                  icon: <ComposeIcon />,
                  hint: <Shortcut chord={TYPED_CHORD} />,
                },
              ],
            },
          ]}
          open={matching}
          active={at}
          onActiveChange={setHighlight}
          onChoose={(index) => {
            const issue = matches[index];
            if (issue === undefined) startTyped();
            else startIssue(issue);
          }}
          onEnter={startTyped}
          onEscape={() => setDismissed(true)}
        />
        {note === undefined ? null : <ErrorState>{note}</ErrorState>}
        <div className="new-task-actions">
          <RepositoryChip
            key={repositories.scope}
            place={CHIP_PLACE.FIELD}
            align={PICKER_ALIGN.START}
            value={repository}
            chooser={repositories}
            onChoose={setChosen}
            onUnreached={() => setChosen(null)}
          />
          <div className="new-task-answers">
            <Button disabled={starting} onClick={close}>
              Cancel
            </Button>
            <Button
              variant={BUTTON_VARIANT.PRIMARY}
              aria-keyshortcuts={shortcutAria(CREATE_CHORD)}
              busy={starting}
              busyLabel={picked === undefined ? "Creating" : "Starting"}
              onClick={start}
            >
              {picked === undefined ? "Create task" : `Start ${picked.identifier}`}
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
