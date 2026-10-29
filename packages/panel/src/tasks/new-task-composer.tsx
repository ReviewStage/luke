import { AGENT_BOUNDS, AGENT_STATUS, hasWordsOrFiles } from "@luke/features/agent-wire";
import { FAILURE_REASON, type Failure } from "@luke/features/failure-remedy";
import { encodeMention, MENTION_KIND } from "@luke/features/mention-link";
import type { ModelChoice } from "@luke/features/models-wire";
import { TASK_MODE, type TaskMode } from "@luke/features/task-wire";
import { TERM } from "@luke/features/words";
import { ACT_KIND } from "@luke/host/acts";
import { EXPERIMENT } from "@luke/settings";
import { SHORTCUT_KEY, type ShortcutChord, shortcutMatches } from "@luke/settings/shortcuts";
import {
  CHIP_WIDTH,
  CHOICE_BAR_LOOK,
  CHOICE_BAR_SIZE,
  ChoiceBar,
  type ChoiceItem,
  POPOVER_ALIGN,
  TEXT_ELEMENT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  VisuallyHidden,
} from "@luke/ui";
import { workspaceReaches } from "@luke/ui/tasks-model";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
import { useExperiment } from "../use-app-state.js";
import { AgentComposer, type ComposerWords } from "./agent-composer.js";
import type { MentionMenuSide } from "./mention-picker.js";
import { NEW_TASK_PURPOSE, type NewTaskPurpose } from "./new-task-purpose.js";
import { CHIP_PLACE, RepositoryChip } from "./repository-chip.js";
import { keptSkills } from "./repository-skills.js";
import { NewTaskRunsOnChip, newTaskRunsOn, useNewTaskRunsOn } from "./runs-on.js";
import { SkillFiles } from "./skill-chip.js";
import type { SkillWithFile } from "./skill-ref.js";
import { TaskMentions, tasklessMentions, useMentionAgentsReader } from "./task-mentions.js";
import type { AgentComposerControl } from "./use-agent-composer.js";
import { MODELS_READ } from "./use-agents.js";
import type { NewTaskAgent, NewTaskParent, NewTaskStart, TasksControl } from "./use-tasks-tab.js";

/**
 * new-task-composer.tsx -- New task's composer card: the words a coding agent starts on, and the chips that say where and how the task starts.
 *
 * The card is the agent box's own (`agent-composer.tsx`): the words field,
 * the "+" that attaches files, with an image pasted or files dropped taken
 * too, dictation, the model chip, and the round Start button, with File for
 * later before it, drawing the backlog's mark alone where the card is too
 * narrow for its words, as on a phone, where the model chip's words are cut
 * short too, so Start stays at the row's end in the card.
 * New task's repository chip stands in a head row over the card, the same in the
 * dialog and on a new account's welcome: the repository the task is about
 * (`repository-chip.tsx`), its title, "New task", named to a reader alone,
 * since the card says what it is, and an automation's drawn before it. While local agents are on
 * and the member has a device, the Runs on chip stands after the box's "+",
 * as an agent's box draws where its agent runs: Cloud or one of their devices, which the task's agents run on
 * (`runs-on.tsx`); an automation's card draws none. Note that while local
 * agents are on the card reads the member's devices as it opens and holds
 * Start, saying so, until that read lands, a list read before it opened not
 * counting, and says a read that failed, or one still out past its bound,
 * with Retry, because a start sent before the list is read names no device, and
 * the service creates such a task in the cloud for good: Cloud is only ever
 * where a task runs because the chip said Cloud. The repository chip starts on the one the press chose
 * (a repository group's +), else the one the newest task in the workspace
 * was about, either only where the workspace's GitHub reaches it.
 *
 * While the Pilot experiment is on, a task's card offers Pilot or Agent at
 * the head row's end, set to Pilot: how the task is worked, kept on the task
 * as it starts (`TASK_MODE`). A pick holds for this card alone, and a refused
 * card opened again holds the one it was pressed with. A bare task takes
 * the mode picked too, so one started as a pilot task stands as one before
 * any agent is started on it. An automation's card offers none.
 *
 * The words are a coding agent's prompt. Start stands once there are
 * words or files, and a repository, without which it is held and
 * the card says so under it. It starts the task with an empty plan and no
 * call, Untitled until the
 * agent names it, and the agent on the words, the files, and the model on
 * the chip, in the one start (`use-tasks-tab.ts`), then opens the task on
 * the agent's tab; an agent refused opens it on a draft agent's tab holding
 * the words, why under the box, and Retry (`draft-agent-tab.tsx`). The
 * model chip starts on the account's default, and a pick here runs this one
 * agent alone: only Settings changes the default. A call starts only from an
 * agent's own tab, so starting a task never opens one.
 *
 * An agent's start carries a key the card mints, and a press asking the
 * same again, as Retry after a start the service never answered does,
 * carries the same key, so a service that made the task and its agent
 * answers them rather than a second pair; a press asking anything else
 * mints another, and so does the card mounted afresh.
 *
 * Return starts, Shift+Return is a new line, and ⌘Return on a box with
 * neither words nor files starts a bare task: an empty plan, no call, and
 * no agent, which needs no repository. While the box holds nothing,
 * the round button's hint says so, with its chord, since
 * nothing else on screen would. Escape closes a menu or a
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
 * does, an agent's start as it is pressed, so a New task opened while it is
 * out opens empty, and a refused card opened again brings its own words
 * back. The card holds its own repository and model, so the owner
 * mounts it afresh to start those over; the workspace it starts in is the
 * owner's.
 *
 * New child task, from a task's menu or ⌘K, opens this same card for a
 * child of that task (`parent`): its head row says "New child task" and
 * names the parent where the repository chip stands, and it draws no Runs
 * on, because a child works in its parent's workspace and repository and
 * runs where its parent runs, which the service holds it to. Its start names
 * the parent and leaves the repository and the place to run to the service.
 *
 * The Automations page's Create with an agent opens this same card for the
 * agent that makes an automation (`NEW_TASK_PURPOSE.AUTOMATION`), so making
 * one looks and works as starting any agent does. Its title and placeholder
 * say so, its words are kept as a draft of their own, and the agent is handed
 * the fixed brief with the words fenced after it (`automation-agent-brief.ts`),
 * refused here where that would pass an agent's first message's bound. It
 * starts on words alone, and
 * ⌘Return on an empty box starts no bare task, so its hint never names one.
 * A start refused after the card closed opens it again for the same purpose.
 */

/** ⌘Return: a bare task from a box with nothing in it. */
const BARE_CHORD: ShortcutChord = { key: SHORTCUT_KEY.ENTER };

/** Each purpose's head row title, before the repository's chip: drawn for an automation's, and named to a reader alone for a task's. */
const PURPOSE_HEADING = {
  [NEW_TASK_PURPOSE.TASK]: "New task",
  [NEW_TASK_PURPOSE.AUTOMATION]: "Create with an agent",
} as const satisfies Record<NewTaskPurpose, string>;

/** What each purpose's card asks for, calls its field, and calls its round button. */
const PURPOSE_WORDS = {
  [NEW_TASK_PURPOSE.TASK]: {
    placeholder: "Describe the task",
    label: "Task prompt",
    send: "Start agent",
  },
  [NEW_TASK_PURPOSE.AUTOMATION]: {
    placeholder: "Describe what to automate",
    label: "What to automate",
    send: "Start agent",
  },
} as const satisfies Record<NewTaskPurpose, ComposerWords>;

/** A task's card while its box holds nothing: the round button's hint names what ⌘Return does there. */
const BARE_WORDS: ComposerWords = {
  ...PURPOSE_WORDS[NEW_TASK_PURPOSE.TASK],
  send: `Start a ${TERM.TASK.one} with no ${TERM.AGENT.one}`,
  chord: BARE_CHORD,
};

/** New task's ways of working a task, while the Pilot experiment is on: Pilot first, the one the card starts on. */
const MODE_CHOICES: readonly ChoiceItem<TaskMode>[] = [
  {
    value: TASK_MODE.PILOT,
    label: "Pilot",
    hint: `One pilot plans the ${TERM.TASK.one}, splits it into child ${TERM.TASK.many}, and runs ${TERM.AGENT.many} on them`,
  },
  {
    value: TASK_MODE.AGENT,
    label: "Agent",
    hint: `One ${TERM.AGENT.one} works on the ${TERM.TASK.one}`,
  },
];

/** Why an automation's agent did not start where the brief and the words pass an agent's first message's bound. */
const TOO_LONG = "That request is too long.";

/** Why Start is held without a repository, which a child's card cannot choose, since a child takes its parent's. */
const COMPOSER_WORDS = {
  NEEDS_REPOSITORY: "Choose a repository",
  PARENT_HAS_NO_REPOSITORY: "Its parent task has no repository",
} as const;

/** A child's head row title, drawn before the parent it is made under. */
const CHILD_HEADING = "New child task";

/** What the card says where the member's devices could not be read, with Retry, rather than starting the task in the cloud. */
const DEVICES_UNREAD: Failure = {
  reason: FAILURE_REASON.OTHER,
  text: "Couldn't read your devices, so Luke can't tell where this task should run.",
};

/** What one Agent-mode press asked beside its key: the task's repository and workspace, and where its agents run, and the agent's words, files, and model. */
interface AgentAsk {
  readonly repository: string | null;
  readonly workspaceId: string | undefined;
  /** The device the task's agents run on, by its id; none for the cloud. */
  readonly deviceId?: string | undefined;
  /** How the task is worked, where the card offered the choice; none while the Pilot experiment is off. */
  readonly mode?: TaskMode | undefined;
  readonly agent: Omit<NewTaskAgent, "idempotencyKey">;
}

/** One Agent-mode press: what it asked, and the key it carried. */
export interface NewTaskPress {
  readonly ask: AgentAsk;
  readonly key: string;
}

/** Whether two presses ask the same: the same task, device, mode, words, files in the same order, and model. */
function sameAsk(a: AgentAsk, b: AgentAsk): boolean {
  return (
    a.repository === b.repository &&
    a.workspaceId === b.workspaceId &&
    a.deviceId === b.deviceId &&
    a.mode === b.mode &&
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
  parent,
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
  /** The task the card makes its task a child of, whose workspace `workspaceId` names; none for a task at the top. */
  parent?: NewTaskParent | undefined;
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
  const [chosen, setChosen] = useState<string | null | undefined>(
    refused === undefined ? newTask.preset?.repository : refused.card.repository,
  );
  const [choice, choose] = useDefaultChoice(newTask, refused?.card.choice);
  const [starting, setStarting] = useState(false);
  const [note, setNote] = useState<Failure | undefined>(refused?.note);
  // Pilot or Agent stands on a task's card while the Pilot experiment is on, set to Pilot.
  const offersPilot = useExperiment(EXPERIMENT.PILOT) && !forAutomation;
  const [mode, setMode] = useState<TaskMode>(refused?.card.press.ask.mode ?? TASK_MODE.PILOT);
  const asked = offersPilot ? mode : undefined;
  // A refused card opened again holds the words it was pressed with, where the box holds nothing since.
  useLayoutEffect(() => {
    if (refused === undefined) return;
    const { words: kept, press } = refused.card;
    draft.update((now) =>
      hasWordsOrFiles(now.text, now.attachments)
        ? now
        : { ...now, text: kept, attachments: press.ask.agent.attachments },
    );
  }, []);
  // The last agent press's key and what it asked, until a start lands.
  const pressed = useRef<NewTaskPress | undefined>(refused?.card.press);
  const repositories = newTask.repositoriesIn(workspaceId);
  const workspace = newTask.workspaces.find((each) => each.id === workspaceId);
  // Runs on stands while local agents are on and the member has a device, never for an automation's agent or a child, which runs where its parent runs.
  const localAgents = useExperiment(EXPERIMENT.LOCAL_AGENTS);
  const asksDevices = localAgents && !forAutomation && parent === undefined;
  // Note that the devices are read as the card opens rather than when the
  // model chip first draws, which waits on the default's read, so Start is held for as short as can be.
  const readModels = useRef(newTask.readModels);
  readModels.current = newTask.readModels;
  useEffect(() => {
    if (asksDevices) readModels.current();
  }, [asksDevices]);
  // Start is held until a read made since the card opened lands, since a start before then would
  // name none. Note that a list read before the card opened does not count, because it may be one
  // read before a device was added, and a failed read leaves it standing; a read is told by the
  // generation it took, never by its list, which a read listing the same devices hands back as it was.
  const { modelsRead } = newTask;
  const [readAsOpened] = useState(modelsRead.generation);
  const readSinceOpened = modelsRead.generation > readAsOpened;
  const [devicesLanded, setDevicesLanded] = useState(false);
  if (!devicesLanded && readSinceOpened && modelsRead.state === MODELS_READ.READ) {
    setDevicesLanded(true);
  }
  const devicesUnread = asksDevices && !devicesLanded;
  const devicesFailed = devicesUnread && readSinceOpened && modelsRead.state === MODELS_READ.FAILED;
  const devices =
    asksDevices && newTask.devices !== undefined && newTask.devices.length > 0
      ? newTask.devices
      : undefined;
  const [device, chooseDevice] = useNewTaskRunsOn(devices);
  const runsOn = devices === undefined ? undefined : newTaskRunsOn(device);
  // The repositories the chip's last read listed, an App's and a member's token's alike.
  const [listed, setListed] = useState<readonly string[] | undefined>(undefined);
  // A repository picked in one workspace is none of another's,
  // so the owner's switch, as the welcome's, lets it go, in the render that brings it; the scope first
  // resolving keeps a pick made before the workspaces were read.
  const [scope, setScope] = useState(repositories.scope);
  if (repositories.scope !== scope) {
    setListed(undefined);
    if (scope !== undefined) setChosen(undefined);
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
  const picked =
    candidate !== null &&
    (!isListed(candidate) ||
      (listed === undefined && workspace !== undefined && !workspaceReaches(workspace, candidate)))
      ? null
      : candidate;
  // A child works in its parent's repository, which no chip offers to change.
  const repository = parent === undefined ? picked : parent.repository;
  const said = words.trim();
  // Note that an automation's agent starts on words alone, since the brief fences them as the request.
  const filled = forAutomation ? said !== "" : hasWordsOrFiles(said, attachments);
  // An agent needs a repository to work in, and something to work on: words or files.
  const blocked = repository === null;
  const canStart = !blocked && !devicesUnread && filled;
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

  const begin = (handing: Pick<NewTaskStart, "handed" | "mode" | "card"> = {}) => {
    if (starting || devicesUnread) return;
    setStarting(true);
    onStarting?.(true);
    setNote(undefined);
    // Note that an agent's start lets its words go as it is pressed, because the card closes at
    // once and a New task opened before the service answers must open empty; a refused card
    // opened again brings its own words back (`refused.card.words`).
    const agentStart = handing.handed !== undefined;
    if (agentStart) draft.update(() => EMPTY_DRAFT);
    // Note that a child's start names its parent and no repository, because the service gives a child its parent's.
    newTask
      .start("", parent === undefined ? repository : null, workspaceId, {
        ...(runsOn === undefined ? undefined : { runsOn }),
        ...(device === undefined ? undefined : { device }),
        ...(parent === undefined ? undefined : { parentTaskId: parent.taskId }),
        ...handing,
      })
      .then((refused) => {
        if (refused === undefined) {
          // A task started lets its words go, so the next New task opens empty.
          pressed.current = undefined;
          if (!agentStart) draft.update(() => EMPTY_DRAFT);
        }
        setNote(refused);
      })
      .finally(() => {
        setStarting(false);
        onStarting?.(false);
      });
  };
  const start = () => {
    if (!canStart) return;
    const prompt = forAutomation ? automationAgentBrief(said) : said;
    if (forAutomation && prompt.length > AGENT_BOUNDS.MAX_MESSAGE_CHARS) {
      setNote({ reason: FAILURE_REASON.OTHER, text: TOO_LONG });
      return;
    }
    const ask: AgentAsk = {
      repository,
      workspaceId,
      deviceId: device?.deviceId,
      mode: asked,
      agent: { prompt, attachments, choice },
    };
    const held = pressed.current;
    const key = held !== undefined && sameAsk(held.ask, ask) ? held.key : crypto.randomUUID();
    const press = { ask, key };
    pressed.current = press;
    begin({
      handed: { idempotencyKey: key, ...ask.agent },
      ...(asked === undefined ? undefined : { mode: asked }),
      card: {
        ...(forAutomation ? { purpose } : undefined),
        ...(parent === undefined ? undefined : { parent }),
        repository,
        choice,
        press,
        words,
      },
    });
  };
  // ⌘Return on a box with nothing in it starts a bare task: no call and no agent, in the mode picked.
  const bare = () => begin(asked === undefined ? {} : { mode: asked });
  const startsBare = !forAutomation && !filled;

  const onKey = (event: KeyboardEvent): boolean => {
    if (!shortcutMatches(BARE_CHORD, event)) return false;
    if (filled) start();
    else if (!forAutomation) bare();
    return true;
  };

  const repositoryChip = (
    <RepositoryChip
      key={repositories.scope}
      place={CHIP_PLACE.FIELD}
      width={CHIP_WIDTH.AUTO}
      align={POPOVER_ALIGN.START}
      value={repository}
      chooser={repositories}
      onChoose={setChosen}
      onUnreached={judged ? () => setChosen(null) : undefined}
      onListed={setListed}
    />
  );
  const composer: AgentComposerControl = {
    draft: words,
    // Note that the words handed back as they stand, as the field echoes the words a refused card opens on, take no note down.
    setDraft: (text) => {
      if (text === words) return;
      draft.update((was) => ({ ...was, text }));
      setNote(undefined);
    },
    attachments,
    setAttachments: (next) =>
      draft.update((was) => ({ ...was, attachments: next(was.attachments) })),
    sending: starting,
    // Note that a read of the devices that failed is said over any note before it, and read again by its Retry.
    note: devicesFailed ? DEVICES_UNREAD : note,
    closed: undefined,
    send: start,
    retry: devicesFailed ? () => readModels.current() : start,
    sent: [],
  };

  const card = (
    <div className="new-task-composer flex min-w-0 flex-col gap-control-gap">
      <div className="new-task-head flex min-w-0 items-center gap-block-gap">
        <div className="new-task-title flex min-w-0 items-center gap-item-gap">
          {forAutomation || parent !== undefined ? (
            <Text
              variant={TEXT_VARIANT.DIALOG}
              as={TEXT_ELEMENT.H2}
              id={titleId}
              className="max-w-new-task-title shrink-0"
            >
              {parent === undefined ? PURPOSE_HEADING[purpose] : CHILD_HEADING}
            </Text>
          ) : (
            <VisuallyHidden id={titleId}>{PURPOSE_HEADING[purpose]}</VisuallyHidden>
          )}
          {parent === undefined ? (
            repositoryChip
          ) : (
            <Text tone={TEXT_TONE.MUTED} truncate>
              {parent.name}
            </Text>
          )}
        </div>
        {offersPilot ? (
          <div className="new-task-mode ml-auto shrink-0">
            <ChoiceBar<TaskMode>
              label={`How the ${TERM.TASK.one} is worked`}
              items={MODE_CHOICES}
              value={mode}
              look={CHOICE_BAR_LOOK.SEGMENTED}
              size={CHOICE_BAR_SIZE.COMPACT}
              disabled={starting}
              onChange={setMode}
            />
          </div>
        ) : null}
      </div>
      <AgentComposer
        status={AGENT_STATUS.STARTING}
        composer={composer}
        wording={startsBare ? BARE_WORDS : PURPOSE_WORDS[purpose]}
        // Note that an automation's agent is held without words, since its brief fences them as the request, files alone saying none.
        sendable={!blocked && !devicesUnread && (!forAutomation || said !== "")}
        model={choice === undefined ? undefined : { choice, note: undefined, choose }}
        models={newTask.models}
        modelsFailed={newTask.modelsFailed}
        readModels={newTask.readModels}
        usage={undefined}
        servers={undefined}
        skills={skills}
        published={undefined}
        doors={{ openGitHub: () => undefined, copy: () => undefined }}
        onStop={() => Promise.resolve(false)}
        followsUp={false}
        onKey={onKey}
        onLeave={onLeave}
        focusedByOwner={focusedByOwner}
        listSide={listSide}
        tools={
          devices === undefined ? undefined : (
            <NewTaskRunsOnChip
              devices={devices}
              device={device}
              disabled={starting}
              onChoose={chooseDevice}
            />
          )
        }
      />
      {blocked ? (
        <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
          {parent === undefined
            ? COMPOSER_WORDS.NEEDS_REPOSITORY
            : COMPOSER_WORDS.PARENT_HAS_NO_REPOSITORY}
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
