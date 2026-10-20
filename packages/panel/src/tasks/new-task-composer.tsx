import {
  CODING_AGENT_BOUNDS,
  CODING_AGENT_STATUS,
  hasWordsOrFiles,
} from "@luke/features/coding-agent-wire";
import { FAILURE_REASON, type Failure } from "@luke/features/failure-remedy";
import type { GitHubIssuePick } from "@luke/features/github-repositories-wire";
import type { LinearIssueSummary } from "@luke/features/linear-wire";
import { encodeMention, MENTION_KIND } from "@luke/features/mention-link";
import type { ModelChoice } from "@luke/features/models-wire";
import {
  TASK_ISSUE_PROVIDER,
  TASK_ISSUE_RELATION,
  type TaskIssueChoice,
} from "@luke/features/task-issue-wire";
import { TASK_BOUNDS, TASK_STATUS } from "@luke/features/task-wire";
import { ACT_KIND } from "@luke/host/acts";
import { SHORTCUT_KEY, type ShortcutChord, shortcutMatches } from "@luke/settings/shortcuts";
import {
  BUTTON_SIZE,
  BUTTON_VARIANT,
  Button,
  CHIP_LOOK,
  CHIP_WIDTH,
  Chip,
  ChipName,
  PencilIcon,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
} from "@luke/ui";
import type { SkillOption } from "@luke/ui/skill-mention";
import { agentPromptOf, taskNameOfIssue, workspaceReaches } from "@luke/ui/tasks-model";
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
import { MENTION_MENU_SIDE } from "./mention-picker.js";
import {
  choiceOf,
  linkedElsewhere,
  linkIdOf,
  linkIssueOf,
  type NewTaskLink,
  NewTaskLinks,
} from "./new-task-links.js";
import { NEW_TASK_MODE, type NewTaskMode, useNewTaskMode } from "./new-task-mode.js";
import { CHIP_PLACE, RepositoryChip } from "./repository-chip.js";
import { keptSkills } from "./repository-skills.js";
import { SkillFiles } from "./skill-chip.js";
import { TaskMentions, tasklessMentions, useMentionAgentsReader } from "./task-mentions.js";
import type { AgentComposerControl } from "./use-agent-composer.js";
import type { NewTaskAgent, NewTaskStart, TasksControl } from "./use-tasks-tab.js";

/**
 * new-task-composer.tsx -- New task's composer card: the words a coding agent starts on, or Luke plans with, and the chips that say where and how the task starts.
 *
 * The card is the agent box's own (`agent-composer.tsx`): the words field,
 * the "+" that attaches files, with an image pasted or files dropped taken
 * too, dictation, the model chip, and the round Start button, with the
 * Plan toggle at the foot's right, before the model chip, drawing its
 * pencil alone where the card is too narrow for its word, as on a phone.
 * New task's own chips stand in a head row over the card where the owner
 * hands a title, as
 * the dialog does (`heading`): the title, then the repository the task is
 * about (`repository-chip.tsx`), and at the row's right end the Issue
 * chip, where the workspace has GitHub or Linear connected
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
 * Choosing a GitHub or a Linear issue links it, as a chip over the words
 * (`new-task-links.tsx`) with its key, its title, its Closes / Part of
 * switch, and the × that lets it go, rather than starting anything; the
 * card links up to as many as a task may, GitHub's and Linear's mixed, and
 * starting the task links each with its relation. A GitHub issue is the
 * chosen repository's: picking one of another repository, or with none
 * chosen, makes its repository the task's, and a change of repository lets
 * go the GitHub issues of the one before. The owner's workspace changing,
 * as Home's does, lets every one go. The task is named by the first issue
 * picked, Luke researches them in Plan mode beside the brief, and in Agent
 * mode the agent is handed a mention of each, by its page, before the words
 * (`agentPromptOf`), so an issue picked and Return starts an agent on it.
 *
 * An agent's start carries a key the card mints, and a press asking the
 * same again, as Retry after a start the service never answered does,
 * carries the same key, so a service that made the task and its agent
 * answers them rather than a second pair; a press asking anything else
 * mints another, and so does the card mounted afresh.
 *
 * Return starts, Shift+Return is a new line, and ⌘Return on an Agent-mode
 * box with neither words nor files starts a bare task: an empty plan, no
 * call, and no agent. File for later, beside Start in either mode, files
 * the task in the backlog instead:
 * no call and no agent, named by its issue where one was picked and else
 * by the words' first line, the words kept as its brief for whoever takes
 * it up; it stands once there are words or an issue. Start's task starts
 * to do. Escape closes a menu or a dictation standing first,
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
 * kept apart from the card (`../composer-drafts.ts`), so a card put away
 * and opened again, or Home's, finds them where they were left, the words
 * after a relaunch too; a task started lets them go, as emptying the box
 * does. The card holds its own issues, repository, and model, so the owner
 * mounts it afresh to start those over; the workspace it starts in is the
 * owner's.
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
  NEEDS_REPOSITORY: "An agent needs a repository to work in. Choose one, or turn on Plan.",
  FILE: "File for later",
  FILE_HINT: "Add it to the backlog without starting it",
} as const;

/**
 * The name a task filed for later stands under: its issue's, else its
 * words' first line, cut to a name's bound. Note that the bound counts
 * UTF-16 units, as the wire does, and the cut falls between characters, so
 * an emoji is kept whole or left out rather than split.
 */
function filedName(issueName: string | undefined, said: string): string {
  if (issueName !== undefined) return issueName;
  const line = said.split("\n", 1)[0]?.trim() ?? "";
  let name = "";
  for (const character of line) {
    if (name.length + character.length > TASK_BOUNDS.MAX_NAME_CHARS) break;
    name += character;
  }
  return name;
}

/** What one Agent-mode press asked beside its key: the task's name, repository, workspace, and issues, and the agent's words, files, and model. */
interface AgentAsk {
  readonly name: string;
  readonly repository: string | null;
  readonly workspaceId: string | undefined;
  readonly issues: readonly TaskIssueChoice[];
  readonly agent: Omit<NewTaskAgent, "idempotencyKey">;
}

/** Whether two presses link the same issues, in the same order and with the same relations. */
function sameIssues(a: readonly TaskIssueChoice[], b: readonly TaskIssueChoice[]): boolean {
  return a.length === b.length && a.every((issue, index) => sameChoice(issue, b[index]));
}

function sameChoice(a: TaskIssueChoice, b: TaskIssueChoice | undefined): boolean {
  if (b === undefined || a.relation !== b.relation) return false;
  if (a.provider === TASK_ISSUE_PROVIDER.LINEAR || b.provider === TASK_ISSUE_PROVIDER.LINEAR) {
    return a.provider === b.provider && "id" in a && "id" in b && a.id === b.id;
  }
  return a.repository === b.repository && a.number === b.number;
}

/** Whether two presses ask the same: the same task, words, files in the same order, and model. */
function sameAsk(a: AgentAsk, b: AgentAsk): boolean {
  return (
    a.name === b.name &&
    a.repository === b.repository &&
    a.workspaceId === b.workspaceId &&
    sameIssues(a.issues, b.issues) &&
    a.agent.prompt === b.agent.prompt &&
    a.agent.attachments.length === b.agent.attachments.length &&
    a.agent.attachments.every((file, index) => file === b.agent.attachments[index]) &&
    a.agent.choice?.model === b.agent.choice?.model &&
    a.agent.choice?.effort === b.agent.choice?.effort &&
    a.agent.choice?.contextWindow === b.agent.choice?.contextWindow
  );
}

/** New task's draft place: its workspace, none before the workspaces are read. */
function newTaskPlace(workspaceId: string | undefined): DraftPlace {
  return { kind: DRAFT_PLACE.NEW_TASK, workspaceId: workspaceId ?? null };
}

/** Whether a key press is Shift+Tab alone, which turns the mode from the field. */
function turnsMode(event: KeyboardEvent): boolean {
  return event.key === "Tab" && event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey;
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
  onStarting,
  onLeave,
  focusedByOwner = false,
  heading,
}: {
  newTask: TasksControl["newTask"];
  /** The workspace the task starts in, the owner's to choose; none before the workspaces are read. */
  workspaceId: string | undefined;
  /** Hears whether a start is out, during which the owner holds what it draws around the card. */
  onStarting?: ((starting: boolean) => void) | undefined;
  /** What Escape in the field does where nothing in the card takes it. */
  onLeave: () => void;
  /** Whether the owner hands the words focus as the card first draws, as the dialog does; the words take it themselves otherwise. */
  focusedByOwner?: boolean;
  /** The owner's title, drawn in a head row over the card with the repository chip after it and the Issue chip at its right end; with none, as on Home, both chips stand in the card's foot. */
  heading?: ReactNode;
}): React.JSX.Element {
  const [mode, setMode] = useNewTaskMode();
  const draft = useDraft(newTaskPlace(workspaceId));
  const { text: words, attachments } = draft.draft;
  // Words typed before the workspaces were read become the workspace's
  // draft once it is known, over one it kept, as the words written last win.
  const loose = useDraft(newTaskPlace(undefined)).draft;
  const writer = useDraftWriter();
  useEffect(() => {
    if (workspaceId === undefined || !hasWordsOrFiles(loose.text, loose.attachments)) return;
    writer.update(newTaskPlace(workspaceId), () => loose);
    writer.update(newTaskPlace(undefined), () => EMPTY_DRAFT);
  }, [workspaceId, loose, writer]);
  // The GitHub and Linear issues picked from the Issue chip, in the order picked.
  const [picks, setLinks] = useState<readonly NewTaskLink[]>([]);
  const [chosen, setChosen] = useState<string | null | undefined>(newTask.preset?.repository);
  const [choice, choose] = useDefaultChoice(newTask);
  const [starting, setStarting] = useState(false);
  const [note, setNote] = useState<Failure | undefined>(undefined);
  // The last agent press's key and what it asked, until a start lands.
  const pressed = useRef<{ ask: AgentAsk; key: string } | undefined>(undefined);
  // How many times ⌘L asked the Issue chip to open its menu.
  const [issueAsks, setIssueAsks] = useState(0);
  const { linearIssuesIn, githubIssuesIn } = newTask;
  const offersIssues =
    linearIssuesIn(workspaceId) !== undefined || githubIssuesIn(workspaceId) !== undefined;
  const repositories = newTask.repositoriesIn(workspaceId);
  const workspace = newTask.workspaces.find((each) => each.id === workspaceId);
  // A repository or an issue picked in one workspace is none of another's,
  // so the owner's switch, as Home's, lets them go, in the render that brings it; the scope first
  // resolving keeps a pick made before the workspaces were read.
  const [scope, setScope] = useState(repositories.scope);
  if (repositories.scope !== scope) {
    if (scope !== undefined) {
      setChosen(undefined);
      setLinks([]);
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
  // A change of repository lets go the GitHub issues of the one before, in the render that brings it.
  const [linkedFor, setLinkedFor] = useState(repository);
  if (linkedFor !== repository) {
    setLinkedFor(repository);
    setLinks((was) => was.filter((link) => !linkedElsewhere(link, repository)));
  }
  const links = picks.filter((link) => !linkedElsewhere(link, repository));
  const planning = mode === NEW_TASK_MODE.PLAN;
  const said = words.trim();
  const filled = hasWordsOrFiles(said, attachments);
  // Agent mode needs a repository to work in, and something to work on:
  // words, files, or a GitHub or Linear issue.
  const onIssue = links.length > 0;
  const blocked = !planning && repository === null;
  const canStart = planning || (!blocked && (filled || onIssue));
  const linkedIssues = links.map(linkIssueOf);
  const named = linkedIssues[0];
  const issueName = named === undefined ? undefined : taskNameOfIssue(named);
  const issues = links.map(choiceOf);
  // What an `@` and a `/` offer: the chosen repository's, read through the workspace, as on an agent's page no task holds.
  const { act } = useAct();
  const readMentionAgents = useMentionAgentsReader(workspaceId, newTask.tasks, newTask.models);
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
          ),
    [workspaceId, slug, repository, onShowMention, readMentionAgents],
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
    handing: Pick<NewTaskStart, "handed" | "brief" | "status"> = {},
  ) => {
    if (starting) return;
    setStarting(true);
    onStarting?.(true);
    setNote(undefined);
    newTask
      .start(name, repository, workspaceId, withCall, {
        ...(issues.length === 0 ? undefined : { issues }),
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
  // Which press a Retry repeats: Start's, or File for later's.
  const filing = useRef(false);
  const start = () => {
    if (!canStart) return;
    filing.current = false;
    if (planning) begin(issueName ?? "", true, said === "" ? {} : { brief: said });
    else {
      const name = issueName ?? "";
      const ask: AgentAsk = {
        name,
        repository,
        workspaceId,
        issues,
        agent: { prompt: agentPromptOf(linkedIssues, said), attachments, choice },
      };
      const held = pressed.current;
      const key = held !== undefined && sameAsk(held.ask, ask) ? held.key : crypto.randomUUID();
      pressed.current = { ask, key };
      begin(name, false, { handed: { idempotencyKey: key, ...ask.agent } });
    }
  };
  // ⌘Return on an Agent-mode box with nothing in it starts a bare task: no call and no agent.
  const bare = () => {
    filing.current = false;
    begin(issueName ?? "", false);
  };
  // File for later is a bare task in the backlog, its words kept as its brief.
  const filable = said !== "" || named !== undefined;
  const file = () => {
    if (!filable) return;
    filing.current = true;
    begin(filedName(issueName, said), false, {
      status: TASK_STATUS.BACKLOG,
      ...(said === "" ? undefined : { brief: said }),
    });
  };

  const onKey = (event: KeyboardEvent): boolean => {
    if (turnsMode(event)) {
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
  const full = links.length >= TASK_BOUNDS.MAX_ISSUES;
  const link = (linked: NewTaskLink) => {
    if (full || links.some((each) => linkIdOf(each) === linkIdOf(linked))) return;
    setLinks([...links, linked]);
    setNote(undefined);
  };
  const chooseIssue = (chosenIssue: LinearIssueSummary) =>
    link({
      provider: TASK_ISSUE_PROVIDER.LINEAR,
      issue: chosenIssue,
      relation: TASK_ISSUE_RELATION.CLOSES,
    });
  // Note that a GitHub issue of another repository, or picked with none chosen, makes its repository the task's.
  const chooseGitHub = (chosenIssue: GitHubIssuePick) => {
    if (chosenIssue.repository.toLowerCase() !== repository?.toLowerCase()) {
      setChosen(chosenIssue.repository);
    }
    link({
      provider: TASK_ISSUE_PROVIDER.GITHUB,
      issue: chosenIssue,
      relation: TASK_ISSUE_RELATION.CLOSES,
    });
  };
  // Note that the chip at the head row's right end hangs its menu from its trailing edge.
  const issueChip = (
    <IssuePickerChip
      linearIn={linearIssuesIn}
      githubIn={githubIssuesIn}
      workspaceId={workspaceId}
      repository={repository}
      linked={new Set(links.map(linkIdOf))}
      full={full}
      disabled={starting}
      openRequest={issueAsks}
      align={heading === undefined ? PICKER_ALIGN.START : PICKER_ALIGN.END}
      onChoose={chooseIssue}
      onChooseGitHub={chooseGitHub}
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
    retry: () => (filing.current ? file() : start()),
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
        // Note that Home's card stands at the top of its page, where a list risen over it is cut off under the page's head.
        listSide={heading === undefined ? MENTION_MENU_SIDE.BELOW : MENTION_MENU_SIDE.ABOVE}
        above={
          links.length === 0 ? undefined : (
            <NewTaskLinks links={links} disabled={starting} onChange={setLinks} />
          )
        }
        tools={heading === undefined ? chips : undefined}
        beforeSend={
          <Tooltip label={COMPOSER_WORDS.FILE_HINT}>
            <Button
              variant={BUTTON_VARIANT.OUTLINE}
              size={BUTTON_SIZE.COMPACT}
              disabled={starting || !filable}
              onClick={file}
            >
              {COMPOSER_WORDS.FILE}
            </Button>
          </Tooltip>
        }
        actions={(narrow) => (
          <span className="new-task-plan-toggle">
            <Tooltip label={COMPOSER_WORDS.TOGGLE_LABEL}>
              <Chip
                look={CHIP_LOOK.FILTER}
                iconOnly={narrow}
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
        )}
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
