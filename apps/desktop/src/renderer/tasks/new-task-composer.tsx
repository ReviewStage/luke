import {
  CODING_AGENT_STATUS,
  type CodingAgentAttachment,
  hasWordsOrFiles,
} from "@luke/features/coding-agent-wire";
import { FAILURE_REASON, type Failure } from "@luke/features/failure-remedy";
import { INTEGRATION_PROVIDER } from "@luke/features/integration-wire";
import type { LinearIssueSummary } from "@luke/features/linear-wire";
import type { ModelChoice } from "@luke/features/models-wire";
import { PICKER_ALIGN } from "@luke/panel/settings/picker-row";
import { NEW_TASK_MODE, type NewTaskMode, useNewTaskMode } from "@luke/panel/tasks/new-task-mode";
import { CHIP_PLACE, RepositoryChip } from "@luke/panel/tasks/repository-chip";
import { Tooltip } from "@luke/panel/tooltip";
import { SHORTCUT_KEY, type ShortcutChord, shortcutMatches } from "@luke/settings/shortcuts";
import {
  CHIP_LOOK,
  CHIP_WIDTH,
  Chip,
  ChipName,
  CloseIcon,
  IconButton,
  PencilIcon,
  PROVIDER_MARK_SIZE,
  ProviderMark,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
} from "@luke/ui";
import {
  agentPromptOf,
  taskNameOfIssue,
  taskNameOfWords,
  workspaceReaches,
} from "@luke/ui/tasks-model";
import { useEffect, useRef, useState } from "react";
import { AgentComposer, type ComposerWords } from "./agent-composer";
import { LINEAR_CHORD, LinearIssueChip } from "./linear-issue-chip";
import type { AgentComposerControl } from "./use-agent-composer";
import type { NewTaskAgent, NewTaskIssue, NewTaskStart, TasksControl } from "./use-tasks-tab";

/**
 * new-task-composer.tsx -- New task's composer card: the words a coding agent starts on, or Luke plans with, and the chips that say where and how the task starts.
 *
 * The card is the agent box's own (`agent-composer.tsx`): the words field,
 * the "+" that attaches files, with an image pasted or files dropped taken
 * too, dictation, the model chip, and the round Start button. Its foot holds
 * New task's own chips beside them: after the "+", the repository the task
 * is about (`repository-chip.tsx`), which starts on the one the press chose
 * (a repository group's +), else the one the newest task in the workspace
 * was about, either only where the workspace's GitHub reaches it, and then
 * the Linear chip, where the workspace has Linear connected
 * (`linear-issue-chip.tsx`, ⌘L from the card); at the right, before the model
 * chip, the Plan toggle.
 *
 * The card is in one of two modes (`new-task-mode.ts`), kept for the next
 * New task, and Shift+Tab from the field turns it as the toggle does:
 *
 * - Agent mode, the default: the words are a coding agent's prompt. Start
 *   stands once there are words, files, or a Linear issue, and a
 *   repository, without which it is held and the card says so under it. It
 *   starts the task with an empty plan and no call, named by the issue where
 *   one was picked and else Untitled until the agent names it, and the agent
 *   on the words, the files, and the model on the chip, in the one start
 *   (`use-tasks-tab.ts`), then opens the task on the agent's tab; an agent
 *   refused opens it on a draft agent's tab holding the words, why under
 *   the box, and Retry (`draft-agent-tab.tsx`). The model chip starts on the
 *   account's default, and a pick here runs this one agent alone: only
 *   Settings changes the default.
 * - Plan mode: the task starts from the plan template and opens its call
 *   with Luke, as New task always did. Start always stands, an empty box
 *   starting today's blank plan, and the model chip stands down, since the
 *   call runs on no model of the developer's. Note that until Luke is
 *   handed the words as the task's brief, they name the task: their first
 *   line, cut to a name's bound.
 *
 * Choosing a Linear issue lays it over the words as a chip, its key, title,
 * and state, with the × that lets it go, rather than starting anything; a
 * switch of workspace lets it go too. The task is linked to it in either
 * mode and named by it, Luke researches it in Plan mode as he always did,
 * and in Agent mode the agent is handed a mention of it before the words
 * (`agentPromptOf`), so an issue picked and Return starts an agent on it.
 *
 * Opened on one of the workspace's own issues, the task is named by it and
 * linked to it, and Agent mode's Start stands with nothing written, which
 * starts an agent on the task's plan at once, the issue's, rather than on
 * words. Opened from that issue's Start agent…, the card stands in Agent mode
 * and offers no Plan toggle.
 *
 * An agent's start carries a key the card mints, and a press asking the
 * same again, as Retry after a start the service never answered does,
 * carries the same key, so a service that made the task and its agent
 * answers them rather than a second pair; a press asking anything else
 * mints another, and so does the card mounted afresh.
 *
 * Return starts, Shift+Return is a new line, and ⌘Return on an Agent-mode
 * box with neither words nor files starts a bare task: an empty plan, no
 * call, and no agent. Escape closes a menu or a dictation standing first,
 * and then whatever the owner says (`onLeave`), the dialog's card. A start
 * that was refused keeps the card and its words, with why under it and
 * Retry. Nothing typed here reaches the model as conversation.
 *
 * The card holds its own words, files, issue, repository, and model, so the
 * owner mounts it afresh to start over; the workspace it starts in is the
 * owner's, as is a workspace's own issue it was opened from, which names
 * the task and offers no Linear chip.
 */

/** ⌘Return: a bare task from an Agent-mode box with nothing in it. */
const BARE_CHORD: ShortcutChord = { key: SHORTCUT_KEY.ENTER };

/** The field's name in either mode; note that it is one name, because the editor mounts afresh on a new one. */
const FIELD_LABEL = "Task prompt";

/** What the card says in each mode. */
const MODE_WORDS = {
  [NEW_TASK_MODE.AGENT]: {
    placeholder: "Describe the change for a coding agent…",
    label: FIELD_LABEL,
    send: "Start agent",
  },
  [NEW_TASK_MODE.PLAN]: {
    placeholder: "What should you and Luke plan? (optional)",
    label: FIELD_LABEL,
    send: "Start planning",
  },
} as const satisfies Record<NewTaskMode, ComposerWords>;

/** The Plan toggle's words, and why Agent mode's Start is held without a repository. */
const COMPOSER_WORDS = {
  PLAN: "Plan",
  TOGGLE_LABEL: "Plan with Luke first",
  TOGGLE_KEYS: "Shift+Tab",
  DROP_ISSUE: "Remove issue",
  NEEDS_REPOSITORY: "An agent needs a repository to work in. Choose one, or turn on Plan.",
} as const;

/** What one Agent-mode press asked beside its key: the task's name, repository, workspace, and issues, and the agent's words, files, and model. */
interface AgentAsk {
  readonly name: string;
  readonly repository: string | null;
  readonly workspaceId: string | undefined;
  readonly linearIssueId: string | undefined;
  readonly issueId: string | undefined;
  readonly agent: Omit<NewTaskAgent, "idempotencyKey">;
}

/** Whether two presses ask the same: the same task, words, files in the same order, and model. */
function sameAsk(a: AgentAsk, b: AgentAsk): boolean {
  return (
    a.name === b.name &&
    a.repository === b.repository &&
    a.workspaceId === b.workspaceId &&
    a.linearIssueId === b.linearIssueId &&
    a.issueId === b.issueId &&
    a.agent.prompt === b.agent.prompt &&
    a.agent.attachments.length === b.agent.attachments.length &&
    a.agent.attachments.every((file, index) => file === b.agent.attachments[index]) &&
    a.agent.choice?.model === b.agent.choice?.model &&
    a.agent.choice?.effort === b.agent.choice?.effort &&
    a.agent.choice?.contextWindow === b.agent.choice?.contextWindow
  );
}

/** Whether a key press is Shift+Tab alone, which turns the mode from the field. */
function turnsMode(event: KeyboardEvent): boolean {
  return event.key === "Tab" && event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey;
}

/** The Linear issue picked, over the words: its key, title, and state, and the × that lets it go. */
function IssueChip({
  issue,
  disabled,
  onDrop,
}: {
  issue: LinearIssueSummary;
  disabled: boolean;
  onDrop: () => void;
}): React.JSX.Element {
  return (
    <div className="new-task-issue" data-issue-chip="">
      <ProviderMark provider={INTEGRATION_PROVIDER.LINEAR} size={PROVIDER_MARK_SIZE.CAPTION} />
      <span className="new-task-issue-key">{issue.identifier}</span>
      <span className="new-task-issue-title">{issue.title}</span>
      {issue.state === undefined ? null : (
        <span className="new-task-issue-state">{issue.state}</span>
      )}
      <span className="new-task-issue-drop">
        <Tooltip label={COMPOSER_WORDS.DROP_ISSUE}>
          <IconButton
            icon={<CloseIcon />}
            label={COMPOSER_WORDS.DROP_ISSUE}
            disabled={disabled}
            onClick={onDrop}
          />
        </Tooltip>
      </span>
    </div>
  );
}

/** The account's default model as read, and the chip's pick, which runs this one agent and leaves the default as it stands. */
function useDefaultChoice(
  newTask: TasksControl["newTask"],
): readonly [ModelChoice | undefined, (next: ModelChoice) => void] {
  const [choice, setChoice] = useState<ModelChoice | undefined>(undefined);
  // Note that the control is read through a ref, because the tab hands a
  // new one on every render and the default is read once, as the card opens.
  const latest = useRef(newTask);
  latest.current = newTask;
  useEffect(() => {
    let live = true;
    latest.current.readDefault().then((answer) => {
      if (live && !("failure" in answer)) setChoice((picked) => picked ?? answer.choice);
    });
    return () => {
      live = false;
    };
  }, []);
  return [choice, setChoice];
}

export function NewTaskComposer({
  newTask,
  workspaceId,
  from,
  onStarting,
  onLeave,
  focusedByOwner = false,
}: {
  newTask: TasksControl["newTask"];
  /** The workspace the task starts in, the owner's to choose; none before the workspaces are read. */
  workspaceId: string | undefined;
  /** The workspace's own issue the card was opened on, which names the task and links it; none otherwise. */
  from: NewTaskIssue | undefined;
  /** Hears whether a start is out, during which the owner holds what it draws around the card. */
  onStarting?: ((starting: boolean) => void) | undefined;
  /** What Escape in the field does where nothing in the card takes it. */
  onLeave: () => void;
  /** Whether the owner hands the words focus as the card first draws, as the dialog does; the words take it themselves otherwise. */
  focusedByOwner?: boolean;
}): React.JSX.Element {
  const [kept, setMode] = useNewTaskMode();
  // An issue's Start agent… asks for an agent alone, so its card stands in Agent mode and offers no Plan toggle.
  const agentOnly = newTask.preset?.agent === true;
  const mode = agentOnly ? NEW_TASK_MODE.AGENT : kept;
  const [words, setWords] = useState("");
  const [attachments, setAttachments] = useState<readonly CodingAgentAttachment[]>([]);
  const [issue, setIssue] = useState<LinearIssueSummary | undefined>(undefined);
  const [chosen, setChosen] = useState<string | null | undefined>(newTask.preset?.repository);
  const [choice, choose] = useDefaultChoice(newTask);
  const [starting, setStarting] = useState(false);
  const [note, setNote] = useState<Failure | undefined>(undefined);
  // The last agent press's key and what it asked, until a start lands.
  const pressed = useRef<{ ask: AgentAsk; key: string } | undefined>(undefined);
  // How many times ⌘L asked the Linear chip to open its menu.
  const [linearAsks, setLinearAsks] = useState(0);
  // Note that a task from one of the workspace's issues starts from that issue alone, so it offers no Linear chip.
  const linearIssuesIn: TasksControl["newTask"]["linearIssuesIn"] =
    from === undefined ? newTask.linearIssuesIn : () => undefined;
  const repositories = newTask.repositoriesIn(workspaceId);
  const workspace = newTask.workspaces.find((each) => each.id === workspaceId);
  // A repository or an issue picked in one workspace is none of another's,
  // so a switch lets them go, in the render that brings it; the scope first
  // resolving keeps a pick made before the workspaces were read.
  const [scope, setScope] = useState(repositories.scope);
  if (repositories.scope !== scope) {
    if (scope !== undefined) {
      setChosen(undefined);
      setIssue(undefined);
    }
    setScope(repositories.scope);
  }
  // Note that a press's repository the workspace's GitHub does not reach is
  // not started on, because the service would refuse it.
  const pick =
    chosen != null && workspace !== undefined && !workspaceReaches(workspace, chosen)
      ? null
      : chosen;
  const repository = pick === undefined ? (repositories.recent[0] ?? null) : pick;
  const planning = mode === NEW_TASK_MODE.PLAN;
  const said = words.trim();
  const filled = hasWordsOrFiles(said, attachments);
  // Agent mode needs a repository to work in, and something to work on:
  // words, files, a Linear issue, or the workspace's own issue it was opened on.
  const onIssue = issue !== undefined || from !== undefined;
  const blocked = !planning && repository === null;
  const canStart = planning || (!blocked && (filled || onIssue));
  const issueName = issue === undefined ? from?.title : taskNameOfIssue(issue);

  const begin = (
    name: string,
    withCall: boolean,
    agent: Pick<NewTaskStart, "agent" | "handed"> = {},
  ) => {
    if (starting) return;
    setStarting(true);
    onStarting?.(true);
    setNote(undefined);
    newTask
      .start(name, repository, workspaceId, withCall, {
        ...(issue === undefined ? undefined : { linearIssueId: issue.id }),
        ...(from === undefined ? undefined : { issueId: from.id }),
        ...agent,
      })
      .then((refused) => {
        if (refused === undefined) pressed.current = undefined;
        setNote(
          refused === undefined ? undefined : { reason: FAILURE_REASON.OTHER, text: refused },
        );
      })
      .finally(() => {
        setStarting(false);
        onStarting?.(false);
      });
  };
  // Note that an agent on the workspace's own issue with nothing written is
  // started on the task's plan, the issue's, as its Start agent… starts one.
  const start = () => {
    if (!canStart) return;
    if (planning) begin(issueName ?? taskNameOfWords(said), true);
    else if (!filled && issue === undefined) begin(issueName ?? "", false, { agent: true });
    else {
      const name = issueName ?? "";
      const ask: AgentAsk = {
        name,
        repository,
        workspaceId,
        linearIssueId: issue?.id,
        issueId: from?.id,
        agent: { prompt: agentPromptOf(issue, said), attachments, choice },
      };
      const held = pressed.current;
      const key = held !== undefined && sameAsk(held.ask, ask) ? held.key : crypto.randomUUID();
      pressed.current = { ask, key };
      begin(name, false, { handed: { idempotencyKey: key, ...ask.agent } });
    }
  };
  // ⌘Return on an Agent-mode box with nothing in it starts a bare task: no call and no agent.
  const bare = () => begin(issueName ?? "", false);

  const onKey = (event: KeyboardEvent): boolean => {
    if (turnsMode(event) && !agentOnly) {
      // Note that the dialog's card traps Tab, so the turn is the field's alone.
      event.preventDefault();
      event.stopPropagation();
      setMode(planning ? NEW_TASK_MODE.AGENT : NEW_TASK_MODE.PLAN);
      return true;
    }
    if (!shortcutMatches(BARE_CHORD, event)) return false;
    if (planning || filled) start();
    else bare();
    return true;
  };
  // ⌘L from the card opens the Linear chip's menu, where the chip stands.
  const onCardKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    // Note that a key an input method is composing with is its own, Safari's last one (229) among them.
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (starting || linearIssuesIn(workspaceId) === undefined) return;
    if (!shortcutMatches(LINEAR_CHORD, event)) return;
    event.preventDefault();
    setLinearAsks((asks) => asks + 1);
  };

  const composer: AgentComposerControl = {
    draft: words,
    setDraft: (next) => {
      setWords(next);
      setNote(undefined);
    },
    attachments,
    setAttachments,
    sending: starting,
    note,
    closed: undefined,
    send: start,
    retry: start,
    sent: [],
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: ⌘L is read as it bubbles from the card's own controls, the field first, which are what take the keys.
    <div className="new-task-composer" data-mode={mode} onKeyDown={onCardKey}>
      <AgentComposer
        status={CODING_AGENT_STATUS.STARTING}
        composer={composer}
        wording={MODE_WORDS[mode]}
        sendsEmpty={planning || onIssue}
        sendable={!blocked}
        model={planning || choice === undefined ? undefined : { choice, note: undefined, choose }}
        models={newTask.models}
        readModels={newTask.readModels}
        usage={undefined}
        servers={undefined}
        published={undefined}
        doors={{ openGitHub: () => undefined, copy: () => undefined }}
        onStop={() => Promise.resolve()}
        followsUp={false}
        onKey={onKey}
        onLeave={onLeave}
        focusedByOwner={focusedByOwner}
        above={
          issue === undefined ? undefined : (
            <IssueChip issue={issue} disabled={starting} onDrop={() => setIssue(undefined)} />
          )
        }
        tools={
          <>
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
              workspaceId={workspaceId}
              disabled={starting}
              openRequest={linearAsks}
              onChoose={(picked) => {
                setIssue(picked);
                setNote(undefined);
              }}
            />
          </>
        }
        actions={
          agentOnly ? undefined : (
            <span className="new-task-plan-toggle">
              <Tooltip label={COMPOSER_WORDS.TOGGLE_LABEL}>
                <Chip
                  look={CHIP_LOOK.FILTER}
                  aria-label={COMPOSER_WORDS.TOGGLE_LABEL}
                  aria-pressed={planning}
                  aria-keyshortcuts={COMPOSER_WORDS.TOGGLE_KEYS}
                  disabled={starting}
                  onClick={() => setMode(planning ? NEW_TASK_MODE.AGENT : NEW_TASK_MODE.PLAN)}
                >
                  <PencilIcon />
                  <ChipName>{COMPOSER_WORDS.PLAN}</ChipName>
                </Chip>
              </Tooltip>
            </span>
          )
        }
      />
      {blocked ? (
        <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
          {COMPOSER_WORDS.NEEDS_REPOSITORY}
        </Text>
      ) : null}
    </div>
  );
}
