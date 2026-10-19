import {
  CODING_AGENT_BOUNDS,
  CODING_AGENT_STATUS,
  hasWordsOrFiles,
} from "@luke/features/coding-agent-wire";
import { FAILURE_REASON, type Failure } from "@luke/features/failure-remedy";
import { INTEGRATION_PROVIDER } from "@luke/features/integration-wire";
import type { LinearIssueSummary } from "@luke/features/linear-wire";
import { LINK_PLACE, linkOf } from "@luke/features/luke-link";
import { encodeMention, MENTION_KIND } from "@luke/features/mention-link";
import type { ModelChoice } from "@luke/features/models-wire";
import { TASK_BOUNDS } from "@luke/features/task-wire";
import { ACT_KIND } from "@luke/host/acts";
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
import type { SkillOption } from "@luke/ui/skill-mention";
import { agentPromptOf, taskNameOfIssue, workspaceReaches } from "@luke/ui/tasks-model";
import { ListTodoIcon } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useAct } from "../act.js";
import { appPlatform } from "../app-platform.js";
import {
  DRAFT_PLACE,
  type DraftPlace,
  EMPTY_DRAFT,
  useDraft,
  useDraftWriter,
} from "../composer-drafts.js";
import { PICKER_ALIGN } from "../settings/picker-row.js";
import { Tooltip } from "../tooltip.js";
import { AgentComposer, type ComposerWords } from "./agent-composer.js";
import { ISSUE_CHORD, IssuePickerChip } from "./issue-picker-chip.js";
import { NEW_TASK_MODE, type NewTaskMode, useNewTaskMode } from "./new-task-mode.js";
import { CHIP_PLACE, RepositoryChip } from "./repository-chip.js";
import { keptSkills } from "./repository-skills.js";
import { SkillFiles } from "./skill-chip.js";
import {
  TaskMentions,
  tasklessMentions,
  useMentionAgentsReader,
  useMentionIssuesReader,
} from "./task-mentions.js";
import type { AgentComposerControl } from "./use-agent-composer.js";
import type { NewTaskAgent, NewTaskIssue, NewTaskStart, TasksControl } from "./use-tasks-tab.js";

/**
 * new-task-composer.tsx -- New task's composer card: the words a coding agent starts on, or Luke plans with, and the chips that say where and how the task starts.
 *
 * The card is the agent box's own (`agent-composer.tsx`): the words field,
 * the "+" that attaches files, with an image pasted or files dropped taken
 * too, dictation, the model chip, and the round Start button, with the
 * Plan toggle at the foot's right, before the model chip. New task's own
 * chips stand in a head row over the card where the owner hands a title, as
 * the dialog does (`heading`): the title, then the repository the task is
 * about (`repository-chip.tsx`), and at the row's right end the Issue
 * chip, where the workspace offers its own issues or has Linear connected
 * (`issue-picker-chip.tsx`, ⌘L from the card). With no title, as on Home, both stand in the foot after
 * the "+" instead. The repository chip starts on the one the press chose
 * (a repository group's +), else the one the newest task in the workspace
 * was about, either only where the workspace's GitHub reaches it.
 *
 * The card is in one of two modes (`new-task-mode.ts`), kept for the next
 * New task, and Shift+Tab from the field turns it as the toggle does:
 *
 * - Agent mode, the default: the words are a coding agent's prompt. Start
 *   stands once there are words, files, or an issue, and a
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
 *   call runs on no model of the developer's. The words are handed to Luke
 *   as the task's brief, which he reads beside the plan, bounded as a brief
 *   is (`TASK_BOUNDS.MAX_BRIEF_CHARS`), and name nothing: the task is named
 *   by its issue where one was picked, and else stands Untitled until Luke
 *   names it, as a planned task always has.
 *
 * Choosing an issue, a Linear one or one of the workspace's own, lays it
 * over the words as a chip, its mark, key, title, and a Linear issue's
 * state, with the × that lets it go, rather than starting anything; one
 * issue stands at a time, and the owner's workspace changing, as Home's
 * does, lets it go too. The task is linked to it in either mode and named
 * by it, Luke researches it in Plan mode as he always did, beside the
 * brief, and in Agent mode the agent is handed a mention of it before the
 * words (`agentPromptOf`), a Linear issue's by its link and the workspace's
 * own by its Luke link, so an issue picked and Return starts an agent on
 * it. A workspace's own issue with nothing written starts an agent on the
 * task's plan instead, which hands it the issue whole, as opening the card
 * on that issue does.
 *
 * Opened on one of the workspace's own issues, the task is named by it and
 * linked to it as though it were picked, and the card offers no Issue chip.
 * Opened from that issue's Start agent…, the card stands in Agent mode and
 * offers no Plan toggle.
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
 * An `@` offers what it offers on the page of an agent no task holds
 * (`task-mentions.tsx`'s `tasklessMentions`): the servers and the
 * workspace's coding agents, and, once a repository is chosen, its files,
 * folders, and skills; a `/` offers its skills too, whose chip opens the
 * skill's `SKILL.md` on GitHub. Note that the box takes mentions with or
 * without a repository, because its editor reads that as it mounts, and a
 * repository is often chosen after. A mention is written into the words as
 * its link, so the agent's prompt or Luke's brief holds it as any message
 * does.
 *
 * The words and files are New task's draft in the workspace it starts in,
 * or on the workspace's own issue it was opened from, kept apart from the
 * card (`../composer-drafts.ts`), so a card put away and opened again, or
 * Home's, finds them where they were left, the words after a relaunch too;
 * a task started lets them go, as emptying the box does. The card holds
 * its own issue, repository, and model, so the owner mounts it afresh to
 * start those over; the workspace it starts in is the owner's, as is a
 * workspace's own issue it was opened from, which names the task and
 * offers no Issue chip.
 */

/** ⌘Return: a bare task from an Agent-mode box with nothing in it. */
const BARE_CHORD: ShortcutChord = { key: SHORTCUT_KEY.ENTER };

/** The most the words may spell in each mode: an agent's prompt's bound, or a brief's. */
const MODE_MAX_CHARS = {
  [NEW_TASK_MODE.AGENT]: CODING_AGENT_BOUNDS.MAX_MESSAGE_CHARS,
  [NEW_TASK_MODE.PLAN]: TASK_BOUNDS.MAX_BRIEF_CHARS,
} as const satisfies Record<NewTaskMode, number>;

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

/** New task's draft place: its workspace, none before the workspaces are read, and the issue it was opened on. */
function newTaskPlace(workspaceId: string | undefined, from: NewTaskIssue | undefined): DraftPlace {
  return {
    kind: DRAFT_PLACE.NEW_TASK,
    workspaceId: workspaceId ?? null,
    ...(from === undefined ? undefined : { issueId: from.id }),
  };
}

/** Whether a key press is Shift+Tab alone, which turns the mode from the field. */
function turnsMode(event: KeyboardEvent): boolean {
  return event.key === "Tab" && event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey;
}

/** The issue picked, over the words: its mark, key, title, and state where it has one, and the × that lets it go. */
function IssueChip({
  issue,
  disabled,
  onDrop,
}: {
  issue: LinearIssueSummary | NewTaskIssue;
  disabled: boolean;
  onDrop: () => void;
}): React.JSX.Element {
  const linear = "url" in issue;
  return (
    <div className="new-task-issue" data-issue-chip="">
      {linear ? (
        <ProviderMark provider={INTEGRATION_PROVIDER.LINEAR} size={PROVIDER_MARK_SIZE.CAPTION} />
      ) : (
        <ListTodoIcon />
      )}
      <span className="new-task-issue-key">{issue.identifier}</span>
      <span className="new-task-issue-title">{issue.title}</span>
      {!linear || issue.state === undefined ? null : (
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
  heading,
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
  /** The owner's title, drawn in a head row over the card with the repository chip after it and the Issue chip at its right end; with none, as on Home, both chips stand in the card's foot. */
  heading?: ReactNode;
}): React.JSX.Element {
  const [kept, setMode] = useNewTaskMode();
  // An issue's Start agent… asks for an agent alone, so its card stands in Agent mode and offers no Plan toggle.
  const agentOnly = newTask.preset?.agent === true;
  const mode = agentOnly ? NEW_TASK_MODE.AGENT : kept;
  const draft = useDraft(newTaskPlace(workspaceId, from));
  const { text: words, attachments } = draft.draft;
  // Words typed before the workspaces were read become the workspace's
  // draft once it is known, over one it kept, as the words written last win.
  const loose = useDraft(newTaskPlace(undefined, from)).draft;
  const writer = useDraftWriter();
  useEffect(() => {
    if (workspaceId === undefined || !hasWordsOrFiles(loose.text, loose.attachments)) return;
    writer.update(newTaskPlace(workspaceId, from), () => loose);
    writer.update(newTaskPlace(undefined, from), () => EMPTY_DRAFT);
  }, [workspaceId, from, loose, writer]);
  const [issue, setIssue] = useState<LinearIssueSummary | undefined>(undefined);
  // One of the workspace's own issues picked from the Issue chip; one issue, Linear's or this, at a time.
  const [picked, setPicked] = useState<NewTaskIssue | undefined>(undefined);
  const [chosen, setChosen] = useState<string | null | undefined>(newTask.preset?.repository);
  const [choice, choose] = useDefaultChoice(newTask);
  const [starting, setStarting] = useState(false);
  const [note, setNote] = useState<Failure | undefined>(undefined);
  // The last agent press's key and what it asked, until a start lands.
  const pressed = useRef<{ ask: AgentAsk; key: string } | undefined>(undefined);
  // How many times ⌘L asked the Issue chip to open its menu.
  const [issueAsks, setIssueAsks] = useState(0);
  // Note that a task from one of the workspace's issues starts from that issue alone, so it offers no Issue chip.
  const linearIssuesIn: TasksControl["newTask"]["linearIssuesIn"] =
    from === undefined ? newTask.linearIssuesIn : () => undefined;
  const issuesIn: TasksControl["newTask"]["issuesIn"] =
    from === undefined ? newTask.issuesIn : () => undefined;
  const offersIssues =
    linearIssuesIn(workspaceId) !== undefined || issuesIn(workspaceId) !== undefined;
  // The workspace's own issue the task starts from: the one the card was opened on, else the one picked.
  const own = from ?? picked;
  const repositories = newTask.repositoriesIn(workspaceId);
  const workspace = newTask.workspaces.find((each) => each.id === workspaceId);
  // A repository or an issue picked in one workspace is none of another's,
  // so the owner's switch, as Home's, lets them go, in the render that brings it; the scope first
  // resolving keeps a pick made before the workspaces were read.
  const [scope, setScope] = useState(repositories.scope);
  if (repositories.scope !== scope) {
    if (scope !== undefined) {
      setChosen(undefined);
      setIssue(undefined);
      setPicked(undefined);
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
  // words, files, a Linear issue, or one of the workspace's own issues.
  const onIssue = issue !== undefined || own !== undefined;
  const blocked = !planning && repository === null;
  const canStart = planning || (!blocked && (filled || onIssue));
  const named = issue ?? own;
  // The issue the Issue chip picked, which stands over the words.
  const pickedIssue = issue ?? picked;
  const issueName = named === undefined ? undefined : taskNameOfIssue(named);
  // A workspace's own issue is mentioned to an agent by its Luke link, as Linear's is by its own.
  const ownWorkspace = newTask.workspaces.find((each) => each.id === own?.workspaceId);
  const mentioned =
    issue ??
    (own === undefined
      ? undefined
      : {
          ...own,
          url: linkOf(
            { kind: LINK_PLACE.ISSUE, issueId: own.id },
            ownWorkspace?.slug ?? own.workspaceId,
          ),
        });
  // What an `@` and a `/` offer: the chosen repository's, read through the workspace, as on an agent's page no task holds.
  const { act } = useAct();
  const readMentionAgents = useMentionAgentsReader(workspaceId, newTask.tasks, newTask.models);
  const readMentionIssues = useMentionIssuesReader(workspace);
  const slug = workspace?.slug;
  const { onShowMention } = newTask;
  const mentions = useMemo(
    () =>
      workspaceId === undefined
        ? undefined
        : tasklessMentions(
            { workspace: slug ?? workspaceId, workspaceId, repository },
            onShowMention,
            readMentionAgents,
            readMentionIssues,
          ),
    [workspaceId, slug, repository, onShowMention, readMentionAgents, readMentionIssues],
  );
  const skills = useMemo(
    () =>
      workspaceId === undefined || repository === null
        ? undefined
        : keptSkills(() => act(ACT_KIND.TASKS_SKILLS, { workspaceId, repository })),
    [act, workspaceId, repository],
  );
  // A skill's chip opens its `SKILL.md` on GitHub, as on an agent's page no task holds, since no File tab stands here.
  const openSkill = (skill: SkillOption) => {
    if (mentions === undefined || repository === null) return;
    appPlatform().openGitHub(
      encodeMention({ kind: MENTION_KIND.FILE, path: skill.path }, mentions.doors.place),
    );
  };

  const begin = (
    name: string,
    withCall: boolean,
    handing: Pick<NewTaskStart, "agent" | "handed" | "brief"> = {},
  ) => {
    if (starting) return;
    setStarting(true);
    onStarting?.(true);
    setNote(undefined);
    newTask
      .start(name, repository, workspaceId, withCall, {
        ...(issue === undefined ? undefined : { linearIssueId: issue.id }),
        ...(own === undefined ? undefined : { issueId: own.id }),
        ...handing,
      })
      .then((refused) => {
        if (refused === undefined) {
          // A task started lets its words go, so the next New task opens empty.
          pressed.current = undefined;
          draft.update(() => EMPTY_DRAFT);
        }
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
    if (planning) begin(issueName ?? "", true, said === "" ? {} : { brief: said });
    else if (!filled && issue === undefined) begin(issueName ?? "", false, { agent: true });
    else {
      const name = issueName ?? "";
      const ask: AgentAsk = {
        name,
        repository,
        workspaceId,
        linearIssueId: issue?.id,
        issueId: own?.id,
        agent: { prompt: agentPromptOf(mentioned, said), attachments, choice },
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
  // ⌘L from the card opens the Issue chip's menu, where the chip stands.
  const onCardKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    // Note that a key an input method is composing with is its own, Safari's last one (229) among them.
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (starting || !offersIssues) return;
    if (!shortcutMatches(ISSUE_CHORD, event)) return;
    event.preventDefault();
    setIssueAsks((asks) => asks + 1);
  };

  const repositoryChip = (
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
  );
  const chooseIssue = (chosenIssue: LinearIssueSummary) => {
    setIssue(chosenIssue);
    setPicked(undefined);
    setNote(undefined);
  };
  const chooseOwn = (chosenIssue: NewTaskIssue) => {
    setPicked(chosenIssue);
    setIssue(undefined);
    setNote(undefined);
  };
  // Note that the chip at the head row's right end hangs its menu from its trailing edge.
  const issueChip = (
    <IssuePickerChip
      linearIn={linearIssuesIn}
      issuesIn={issuesIn}
      workspaceId={workspaceId}
      disabled={starting}
      openRequest={issueAsks}
      align={heading === undefined ? PICKER_ALIGN.START : PICKER_ALIGN.END}
      onChoose={chooseIssue}
      onChooseOwn={chooseOwn}
    />
  );
  const chips = (
    <>
      {repositoryChip}
      {issueChip}
    </>
  );

  const composer: AgentComposerControl = {
    draft: words,
    setDraft: (text) => {
      draft.update((was) => ({ ...was, text }));
      setNote(undefined);
    },
    attachments,
    setAttachments: (next) =>
      draft.update((was) => ({ ...was, attachments: next(was.attachments) })),
    sending: starting,
    note,
    closed: undefined,
    send: start,
    retry: start,
    sent: [],
  };

  const card = (
    // biome-ignore lint/a11y/noStaticElementInteractions: ⌘L is read as it bubbles from the card's own controls, the field first, which are what take the keys.
    <div className="new-task-composer" data-mode={mode} onKeyDown={onCardKey}>
      {heading === undefined ? null : (
        <div className="new-task-head">
          <div className="new-task-title">
            {heading}
            {repositoryChip}
          </div>
          {issueChip}
        </div>
      )}
      <AgentComposer
        status={CODING_AGENT_STATUS.STARTING}
        composer={composer}
        wording={MODE_WORDS[mode]}
        maxLength={MODE_MAX_CHARS[mode]}
        sendsEmpty={planning || onIssue}
        sendable={!blocked}
        model={planning || choice === undefined ? undefined : { choice, note: undefined, choose }}
        models={newTask.models}
        readModels={newTask.readModels}
        usage={undefined}
        servers={undefined}
        skills={skills}
        published={undefined}
        doors={{ openGitHub: () => undefined, copy: () => undefined }}
        onStop={() => Promise.resolve()}
        followsUp={false}
        onKey={onKey}
        onLeave={onLeave}
        focusedByOwner={focusedByOwner}
        above={
          // Note that the issue the card was opened on is named in the owner's title instead.
          pickedIssue === undefined ? undefined : (
            <IssueChip
              issue={pickedIssue}
              disabled={starting}
              onDrop={() => {
                setIssue(undefined);
                setPicked(undefined);
              }}
            />
          )
        }
        tools={heading === undefined ? chips : undefined}
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
  // Note that the card stands under the providers with or without a repository, so one chosen or let go keeps the card mounted.
  return (
    <TaskMentions value={mentions}>
      <SkillFiles source={skills} onOpen={openSkill}>
        {card}
      </SkillFiles>
    </TaskMentions>
  );
}
