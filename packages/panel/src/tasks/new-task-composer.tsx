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
import { TASK_BOUNDS } from "@luke/features/task-wire";
import { ACT_KIND } from "@luke/host/acts";
import { SHORTCUT_KEY, type ShortcutChord, shortcutMatches } from "@luke/settings/shortcuts";
import { CHIP_WIDTH, TEXT_ELEMENT, TEXT_TONE, TEXT_VARIANT, Text } from "@luke/ui";
import { agentPromptOf, taskNameOfIssue, workspaceReaches } from "@luke/ui/tasks-model";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAct } from "../act.js";
import { appPlatform } from "../app-platform.js";
import {
  DRAFT_PLACE,
  type DraftPlace,
  EMPTY_DRAFT,
  useDraft,
  useDraftWriter,
} from "../composer-drafts.js";
import { automationAgentBrief } from "../desktop/automation-agent-brief.js";
import { PICKER_ALIGN } from "../settings/picker-row.js";
import { AgentComposer, type ComposerWords } from "./agent-composer.js";
import { ISSUE_CHORD, IssuePickerChip } from "./issue-picker-chip.js";
import type { MentionMenuSide } from "./mention-picker.js";
import {
  choiceOf,
  linkedElsewhere,
  linkIdOf,
  linkIssueOf,
  type NewTaskLink,
  NewTaskLinks,
} from "./new-task-links.js";
import { NEW_TASK_PURPOSE, type NewTaskPurpose } from "./new-task-purpose.js";
import { CHIP_PLACE, RepositoryChip } from "./repository-chip.js";
import { keptSkills } from "./repository-skills.js";
import { SkillFiles } from "./skill-chip.js";
import type { SkillWithFile } from "./skill-ref.js";
import { TaskMentions, tasklessMentions, useMentionAgentsReader } from "./task-mentions.js";
import type { AgentComposerControl } from "./use-agent-composer.js";
import type { NewTaskAgent, NewTaskStart, TasksControl } from "./use-tasks-tab.js";

/**
 * new-task-composer.tsx -- New task's composer card: the words a coding agent starts on, and the chips that say where and how the task starts.
 *
 * The card is the agent box's own (`agent-composer.tsx`): the words field,
 * the "+" that attaches files, with an image pasted or files dropped taken
 * too, dictation, the model chip, and the round Start button, with File for
 * later before it, drawing the backlog's mark alone where the card is too
 * narrow for its words, as on a phone, where the model chip's words are cut
 * short too, so Start stays at the row's end in the card.
 * New task's own chips stand in a head row over the card, the same in the
 * dialog and on a new account's welcome: the title, "New task", then the repository the task
 * is about (`repository-chip.tsx`), and at the row's right end the Issue
 * chip, where the workspace has GitHub or Linear connected
 * (`issue-picker-chip.tsx`, ⌘L from the card). The repository chip starts on the one the press chose
 * (a repository group's +), else the one the newest task in the workspace
 * was about, either only where the workspace's GitHub reaches it.
 *
 * The words are a coding agent's prompt. Start stands once there are
 * words, files, or an issue, and a repository, without which it is held and
 * the card says so under it. It starts the task with an empty plan and no
 * call, named by the issue where one was picked and else Untitled until the
 * agent names it, and the agent on the words, the files, and the model on
 * the chip, in the one start (`use-tasks-tab.ts`), then opens the task on
 * the agent's tab; an agent refused opens it on a draft agent's tab holding
 * the words, why under the box, and Retry (`draft-agent-tab.tsx`). The
 * model chip starts on the account's default, and a pick here runs this one
 * agent alone: only Settings changes the default. A call starts only from an
 * agent's own tab, so starting a task never opens one.
 *
 * Choosing a GitHub or a Linear issue links it, as a chip over the words
 * (`new-task-links.tsx`) with its key, its title, its Closes / Part of
 * switch, and the × that lets it go, rather than starting anything; the
 * card links up to as many as a task may, GitHub's and Linear's mixed, and
 * starting the task links each with its relation. A GitHub issue is the
 * chosen repository's: picking one of another repository, or with none
 * chosen, makes its repository the task's, and a change of repository lets
 * go the GitHub issues of the one before. The owner's workspace changing,
 * as the welcome's does, lets every one go. The task is named by the first issue
 * picked, and the agent is handed a mention of each, by its page, before the
 * words (`agentPromptOf`), so an issue picked and Return starts an agent on
 * it.
 *
 * An agent's start carries a key the card mints, and a press asking the
 * same again, as Retry after a start the service never answered does,
 * carries the same key, so a service that made the task and its agent
 * answers them rather than a second pair; a press asking anything else
 * mints another, and so does the card mounted afresh.
 *
 * Return starts, Shift+Return is a new line, and ⌘Return on a box with
 * neither words nor files starts a bare task: an empty plan, no call, and
 * no agent, which needs no repository. Escape closes a menu or a
 * dictation standing first,
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
 * its link, so the agent's prompt holds it as any message does.
 *
 * The words and files are New task's draft in the workspace it starts in,
 * kept apart from the card (`../composer-drafts.ts`), so a card put away
 * and opened again, or the welcome's, finds them where they were left, the words
 * after a relaunch too; a task started lets them go, as emptying the box
 * does. The card holds its own issues, repository, and model, so the owner
 * mounts it afresh to start those over; the workspace it starts in is the
 * owner's.
 *
 * The Automations page's Create with an agent opens this same card for the
 * agent that makes an automation (`NEW_TASK_PURPOSE.AUTOMATION`), so making
 * one looks and works as starting any agent does. Its title and placeholder
 * say so, its words are kept as a draft of their own, and the agent is handed
 * the fixed brief with the words fenced after it (`automation-agent-brief.ts`),
 * refused here where that would pass an agent's first message's bound. It
 * starts on words alone: it offers no Issue chip, and
 * ⌘Return on an empty box starts no bare task. A start refused after the card
 * closed opens it again for the same purpose.
 */

/** ⌘Return: a bare task from a box with nothing in it. */
const BARE_CHORD: ShortcutChord = { key: SHORTCUT_KEY.ENTER };

/** Each purpose's head row title, before the repository's chip. */
const PURPOSE_HEADING = {
  [NEW_TASK_PURPOSE.TASK]: "New task",
  [NEW_TASK_PURPOSE.AUTOMATION]: "Create with an agent",
} as const satisfies Record<NewTaskPurpose, string>;

/** What each purpose's card asks for, calls its field, and calls its round button. */
const PURPOSE_WORDS = {
  [NEW_TASK_PURPOSE.TASK]: {
    placeholder: "Describe the change for a coding agent…",
    label: "Task prompt",
    send: "Start agent",
  },
  [NEW_TASK_PURPOSE.AUTOMATION]: {
    placeholder: "Describe what to automate for a coding agent…",
    label: "What to automate",
    send: "Start agent",
  },
} as const satisfies Record<NewTaskPurpose, ComposerWords>;

/** Why an automation's agent did not start where the brief and the words pass an agent's first message's bound. */
const TOO_LONG = "That request is too long.";

/** Why Start is held without a repository. */
const COMPOSER_WORDS = {
  NEEDS_REPOSITORY: "An agent needs a repository to work in. Choose one.",
} as const;

/** What one Agent-mode press asked beside its key: the task's name, repository, workspace, and issues, and the agent's words, files, and model. */
interface AgentAsk {
  readonly name: string;
  readonly repository: string | null;
  readonly workspaceId: string | undefined;
  readonly issues: readonly TaskIssueChoice[];
  readonly agent: Omit<NewTaskAgent, "idempotencyKey">;
}

/** One Agent-mode press: what it asked, and the key it carried. */
export interface NewTaskPress {
  readonly ask: AgentAsk;
  readonly key: string;
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

/** A card's draft place: its purpose's, in its workspace, none before the workspaces are read. */
function newTaskPlace(workspaceId: string | undefined, purpose: NewTaskPurpose): DraftPlace {
  const kind =
    purpose === NEW_TASK_PURPOSE.AUTOMATION ? DRAFT_PLACE.NEW_AUTOMATION : DRAFT_PLACE.NEW_TASK;
  return { kind, workspaceId: workspaceId ?? null };
}

/** The account's default model as read, and the chip's pick, which runs this one agent and leaves the default as it stands. */
function useDefaultChoice(
  newTask: TasksControl["newTask"],
  kept: ModelChoice | undefined,
): readonly [ModelChoice | undefined, (next: ModelChoice) => void] {
  const [choice, setChoice] = useState<ModelChoice | undefined>(kept);
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

/** Whether a card's draft for `purpose` in `workspaceId` holds words or files, which its card keeps from a stray dismissal. */
export function useNewTaskHolding(
  workspaceId: string | undefined,
  purpose: NewTaskPurpose = NEW_TASK_PURPOSE.TASK,
): boolean {
  const { text, attachments } = useDraft(newTaskPlace(workspaceId, purpose)).draft;
  return hasWordsOrFiles(text, attachments);
}

export function NewTaskComposer({
  newTask,
  workspaceId,
  onStarting,
  onLeave,
  focusedByOwner = false,
  titleId,
  listSide,
  purpose = NEW_TASK_PURPOSE.TASK,
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
  /** The id the head row's title stands under, which names the dialog's card. */
  titleId?: string | undefined;
  /** Which side of the caret's line an `@` or `/` list opens: over it in the dialog, under it on the welcome, whose card stands near the page's top, where a list risen over it is cut off under the page's head. */
  listSide: MentionMenuSide;
  /** What the card starts; a task's agent where none is named. */
  purpose?: NewTaskPurpose | undefined;
}): React.JSX.Element {
  const forAutomation = purpose === NEW_TASK_PURPOSE.AUTOMATION;
  const draft = useDraft(newTaskPlace(workspaceId, purpose));
  const { text: words, attachments } = draft.draft;
  // Words typed before the workspaces were read become the workspace's
  // draft once it is known, over one it kept, as the words written last win.
  const loose = useDraft(newTaskPlace(undefined, purpose)).draft;
  const writer = useDraftWriter();
  useEffect(() => {
    if (workspaceId === undefined || !hasWordsOrFiles(loose.text, loose.attachments)) return;
    writer.update(newTaskPlace(workspaceId, purpose), () => loose);
    writer.update(newTaskPlace(undefined, purpose), () => EMPTY_DRAFT);
  }, [workspaceId, loose, writer, purpose]);
  // A card opened again on a start refused after it closed starts where it was left, saying why.
  const refused = newTask.preset?.refused;
  // The GitHub and Linear issues picked from the Issue chip, in the order picked.
  const [picks, setLinks] = useState<readonly NewTaskLink[]>(refused?.card.links ?? []);
  const [chosen, setChosen] = useState<string | null | undefined>(
    refused === undefined ? newTask.preset?.repository : refused.card.repository,
  );
  const [choice, choose] = useDefaultChoice(newTask, refused?.card.choice);
  const [starting, setStarting] = useState(false);
  const [note, setNote] = useState<Failure | undefined>(
    refused === undefined ? undefined : { reason: FAILURE_REASON.OTHER, text: refused.note },
  );
  // The last agent press's key and what it asked, until a start lands.
  const pressed = useRef<NewTaskPress | undefined>(refused?.card.press);
  // How many times ⌘L asked the Issue chip to open its menu.
  const [issueAsks, setIssueAsks] = useState(0);
  const { linearIssuesIn, githubIssuesIn } = newTask;
  const offersIssues =
    !forAutomation &&
    (linearIssuesIn(workspaceId) !== undefined || githubIssuesIn(workspaceId) !== undefined);
  const repositories = newTask.repositoriesIn(workspaceId);
  const workspace = newTask.workspaces.find((each) => each.id === workspaceId);
  // The repositories the chip's last read listed, an App's and a member's token's alike.
  const [listed, setListed] = useState<readonly string[] | undefined>(undefined);
  // A repository or an issue picked in one workspace is none of another's,
  // so the owner's switch, as the welcome's, lets them go, in the render that brings it; the scope first
  // resolving keeps a pick made before the workspaces were read.
  const [scope, setScope] = useState(repositories.scope);
  if (repositories.scope !== scope) {
    setListed(undefined);
    if (scope !== undefined) {
      setChosen(undefined);
      setLinks([]);
    }
    setScope(repositories.scope);
  }
  const isListed = (name: string) =>
    listed === undefined || listed.some((each) => each.toLowerCase() === name.toLowerCase());
  // A pick or the recent default a read does not list is let go, so a later read listing it does
  // not bring it back; a read made before the workspace resolved, or for the
  // one before a switch still under way, judges none.
  const judged = repositories.scope !== undefined && repositories.scope === scope;
  const candidate = chosen === undefined ? (repositories.recent[0] ?? null) : chosen;
  if (candidate !== null && !isListed(candidate) && judged) setChosen(null);
  // Note that a repository is not started on before the read lands unless
  // the workspace's GitHub reaches it, because the service would refuse it.
  const repository =
    candidate !== null &&
    (!isListed(candidate) ||
      (listed === undefined && workspace !== undefined && !workspaceReaches(workspace, candidate)))
      ? null
      : candidate;
  // A change of repository lets go the GitHub issues of the one before, in the render that brings it.
  const [linkedFor, setLinkedFor] = useState(repository);
  if (linkedFor !== repository) {
    setLinkedFor(repository);
    setLinks((was) => was.filter((link) => !linkedElsewhere(link, repository)));
  }
  const links = picks.filter((link) => !linkedElsewhere(link, repository));
  const said = words.trim();
  // Note that an automation's agent starts on words alone, since the brief fences them as the request.
  const filled = forAutomation ? said !== "" : hasWordsOrFiles(said, attachments);
  // An agent needs a repository to work in, and something to work on:
  // words, files, or a GitHub or Linear issue.
  const onIssue = links.length > 0;
  const blocked = repository === null;
  const canStart = !blocked && (filled || onIssue);
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
      workspaceId === undefined
        ? undefined
        : keptSkills(() =>
            act(
              ACT_KIND.TASKS_SKILLS,
              repository === null ? { workspaceId } : { workspaceId, repository },
            ),
          ),
    [act, workspaceId, repository],
  );
  // A skill's chip opens its `SKILL.md` on GitHub, as on an agent's page no task holds, since no File tab stands here.
  const openSkill = (skill: SkillWithFile) => {
    if (mentions === undefined || repository === null) return;
    appPlatform().openGitHub(
      encodeMention({ kind: MENTION_KIND.FILE, path: skill.path }, mentions.doors.place),
    );
  };

  const begin = (name: string, handing: Pick<NewTaskStart, "handed" | "card"> = {}) => {
    if (starting) return;
    setStarting(true);
    onStarting?.(true);
    setNote(undefined);
    newTask
      .start(name, repository, workspaceId, {
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
  const start = () => {
    if (!canStart) return;
    const name = issueName ?? "";
    const prompt = forAutomation ? automationAgentBrief(said) : agentPromptOf(linkedIssues, said);
    if (forAutomation && prompt.length > CODING_AGENT_BOUNDS.MAX_MESSAGE_CHARS) {
      setNote({ reason: FAILURE_REASON.OTHER, text: TOO_LONG });
      return;
    }
    const ask: AgentAsk = {
      name,
      repository,
      workspaceId,
      issues,
      agent: { prompt, attachments, choice },
    };
    const held = pressed.current;
    const key = held !== undefined && sameAsk(held.ask, ask) ? held.key : crypto.randomUUID();
    const press = { ask, key };
    pressed.current = press;
    begin(name, {
      handed: { idempotencyKey: key, ...ask.agent },
      card: { ...(forAutomation ? { purpose } : undefined), repository, links, choice, press },
    });
  };
  // ⌘Return on a box with nothing in it starts a bare task: no call and no agent.
  const bare = () => begin(issueName ?? "");

  const onKey = (event: KeyboardEvent): boolean => {
    if (!shortcutMatches(BARE_CHORD, event)) return false;
    if (filled) start();
    else if (!forAutomation) bare();
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
      onUnreached={judged ? () => setChosen(null) : undefined}
      onListed={setListed}
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
      align={PICKER_ALIGN.END}
      onChoose={chooseIssue}
      onChooseGitHub={chooseGitHub}
    />
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
    <div className="new-task-composer" onKeyDown={onCardKey}>
      <div className="new-task-head">
        <div className="new-task-title">
          <Text variant={TEXT_VARIANT.DIALOG} as={TEXT_ELEMENT.H2} id={titleId}>
            {PURPOSE_HEADING[purpose]}
          </Text>
          {repositoryChip}
        </div>
        {forAutomation ? null : issueChip}
      </div>
      <AgentComposer
        status={CODING_AGENT_STATUS.STARTING}
        composer={composer}
        wording={PURPOSE_WORDS[purpose]}
        sendsEmpty={onIssue}
        // Note that an automation's agent is held without words, since its brief fences them as the request, files alone saying none.
        sendable={!blocked && (!forAutomation || said !== "")}
        model={choice === undefined ? undefined : { choice, note: undefined, choose }}
        models={newTask.models}
        modelsFailed={newTask.modelsFailed}
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
        listSide={listSide}
        above={
          links.length === 0 ? undefined : (
            <NewTaskLinks links={links} disabled={starting} onChange={setLinks} />
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
