import { AGENT_BOUNDS, AGENT_STATUS, hasWordsOrFiles } from "@repo/features/agent-wire";
import { FAILURE_REASON, type Failure } from "@repo/features/failure-remedy";
import { encodeMention, MENTION_KIND } from "@repo/features/mention-link";
import type { MacOffer, ModelChoice } from "@repo/features/models-wire";
import { PRODUCT_NAME } from "@repo/features/product-name";
import {
  TASK_CREATE_RELATION_KIND,
  TASK_MODE,
  type TaskCreateRelation,
  type TaskCreateRelationKind,
  type TaskMode,
} from "@repo/features/task-wire";
import { TERM } from "@repo/features/words";
import { EXPERIMENT } from "@repo/settings";
import { SETTINGS_VIEW } from "@repo/settings/settings-views";
import { SHORTCUT_KEY, type ShortcutChord, shortcutMatches } from "@repo/settings/shortcuts";
import {
  CHIP_WIDTH,
  CHOICE_BAR_LOOK,
  CHOICE_BAR_SIZE,
  ChoiceBar,
  type ChoiceItem,
  POPOVER_ALIGN,
  TEXT_ELEMENT,
  TEXT_VARIANT,
  Text,
  VisuallyHidden,
} from "@repo/ui";
import { workspaceReaches } from "@repo/ui/tasks-model";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useAgentDefault } from "../account-choices.js";
import { appPlatform } from "../app-platform.js";
import {
  DRAFT_PLACE,
  type DraftPlace,
  EMPTY_DRAFT,
  useDraft,
  useDraftWriter,
} from "../composer-drafts.js";
import { automationAgentBrief } from "../desktop/automation-agent-brief.js";
import { useOpenSettings } from "../open-settings.js";
import { appStateQuery, selectExperiment } from "../use-app-state.js";
import { AgentComposer, COMPOSER_DOCK_CLASS, type ComposerWords } from "./agent-composer.js";
import { unrunnableChoice } from "./agent-model.js";
import { repositorySkillsQueryOptions } from "./agent-reads.js";
import type { AgentServersControl } from "./agent-servers.js";
import { ConnectAgentBanner, NOTICE_LOOK, type NoticeLook } from "./connect-agent-banner.js";
import type { MentionMenuSide } from "./mention-picker.js";
import { NEW_TASK_PURPOSE, type NewTaskPurpose } from "./new-task-purpose.js";
import {
  type NewTaskRelation,
  NewTaskRelationRows,
  type NewTaskRelations,
  relationMenuPanel,
  relationsAsked,
  treeKind,
  treeRelationOf,
} from "./new-task-relation.js";
import { NoRepositoriesBanner } from "./no-repositories-banner.js";
import { CHIP_PLACE, RepositoryChip } from "./repository-chip.js";
import { keptSkills } from "./repository-skills.js";
import { NewTaskRunsOnChip, newTaskRunsOn, useNewTaskRunsOn } from "./runs-on.js";
import { SkillFiles } from "./skill-chip.js";
import type { SkillWithFile } from "./skill-ref.js";
import { TaskMentions, tasklessMentions, useMentionAgentsReader } from "./task-mentions.js";
import type { AgentComposerControl } from "./use-agent-composer.js";
import { MODELS_READ } from "./use-agents.js";
import type { NewTaskAgent, NewTaskStart, TasksControl } from "./use-tasks-tab.js";

const BARE_CHORD: ShortcutChord = { key: SHORTCUT_KEY.ENTER };

const PURPOSE_HEADING = {
  [NEW_TASK_PURPOSE.TASK]: "New task",
  [NEW_TASK_PURPOSE.AUTOMATION]: "Create with an agent",
} as const satisfies Record<NewTaskPurpose, string>;

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

const BARE_WORDS: ComposerWords = {
  ...PURPOSE_WORDS[NEW_TASK_PURPOSE.TASK],
  send: `Start a ${TERM.TASK.one} with no ${TERM.AGENT.one}`,
  chord: BARE_CHORD,
};

const MODE_CHOICES: readonly ChoiceItem<TaskMode>[] = [
  {
    value: TASK_MODE.PILOT,
    label: "Pilot",
    hint: `One pilot plans the ${TERM.TASK.one}, splits it into child ${TERM.TASK.many}, and runs ${TERM.AGENT.many} on them`,
  },
  { value: TASK_MODE.AGENT, label: "Agent" },
];

const TOO_LONG = "That request is too long.";

const REPOSITORY_HELD = "A sub-task and its parent share one repository";

const DEVICES_UNREAD: Failure = {
  reason: FAILURE_REASON.OTHER,
  text: `Couldn't read your devices, so ${PRODUCT_NAME} can't tell where this task should run.`,
};

const NONE_OFF: readonly string[] = [];

const NONE_ALSO: readonly string[] = [];

const NONE_DROPPED: readonly string[] = [];

const NO_DEVICES: readonly MacOffer[] = [];

interface AgentAsk {
  readonly repository: string | null;
  readonly workspaceId: string | undefined;
  readonly deviceId?: string | undefined;
  readonly mode?: TaskMode | undefined;
  readonly relations: readonly TaskCreateRelation[];
  readonly agent: Omit<NewTaskAgent, "idempotencyKey">;
}

export interface NewTaskPress {
  readonly ask: AgentAsk;
  readonly key: string;
}

function sameAsk(a: AgentAsk, b: AgentAsk): boolean {
  return (
    a.repository === b.repository &&
    a.workspaceId === b.workspaceId &&
    a.deviceId === b.deviceId &&
    a.mode === b.mode &&
    a.relations.length === b.relations.length &&
    a.relations.every(
      (relation, index) =>
        relation.kind === b.relations[index]?.kind &&
        relation.taskId === b.relations[index]?.taskId,
    ) &&
    a.agent.prompt === b.agent.prompt &&
    a.agent.attachments.length === b.agent.attachments.length &&
    a.agent.attachments.every((file, index) => file === b.agent.attachments[index]) &&
    a.agent.choice?.model === b.agent.choice?.model &&
    a.agent.choice?.effort === b.agent.choice?.effort &&
    a.agent.choice?.contextWindow === b.agent.choice?.contextWindow &&
    a.agent.disabledServers.length === b.agent.disabledServers.length &&
    a.agent.disabledServers.every((server) => b.agent.disabledServers.includes(server)) &&
    sameInOrder(a.agent.alsoRepositories ?? [], b.agent.alsoRepositories ?? [])
  );
}

function sameRepository(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function sameInOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((each, index) => each === b[index]);
}

function newTaskPlace(workspaceId: string | undefined, purpose: NewTaskPurpose): DraftPlace {
  const kind =
    purpose === NEW_TASK_PURPOSE.AUTOMATION ? DRAFT_PLACE.NEW_AUTOMATION : DRAFT_PLACE.NEW_TASK;
  return { kind, workspaceId: workspaceId ?? null };
}

function useDefaultChoice(
  kept: ModelChoice | undefined,
): readonly [ModelChoice | undefined, ModelChoice | undefined, (next: ModelChoice) => void] {
  const [picked, setPicked] = useState<ModelChoice | undefined>(kept);
  const { choice } = useAgentDefault();
  return [picked ?? choice, picked, setPicked];
}

export function NewTaskComposer({
  newTask,
  workspaceId,
  onStarting,
  onLeave,
  focusedByOwner = false,
  takesFocus = true,
  titleId,
  listSide,
  purpose = NEW_TASK_PURPOSE.TASK,
  notices = NOTICE_LOOK.INSET,
}: {
  newTask: TasksControl["newTask"];
  workspaceId: string | undefined;
  onStarting?: ((starting: boolean) => void) | undefined;
  onLeave: () => void;
  focusedByOwner?: boolean;
  takesFocus?: boolean;
  titleId?: string | undefined;
  listSide: MentionMenuSide;
  purpose?: NewTaskPurpose | undefined;
  notices?: NoticeLook | undefined;
}): React.JSX.Element {
  const forAutomation = purpose === NEW_TASK_PURPOSE.AUTOMATION;
  const draft = useDraft(newTaskPlace(workspaceId, purpose));
  const { text: words, attachments } = draft.draft;
  const loose = useDraft(newTaskPlace(undefined, purpose)).draft;
  const writer = useDraftWriter();
  useEffect(() => {
    if (workspaceId === undefined || !hasWordsOrFiles(loose.text, loose.attachments)) return;
    writer.update(newTaskPlace(workspaceId, purpose), () => loose);
    writer.update(newTaskPlace(undefined, purpose), () => EMPTY_DRAFT);
  }, [workspaceId, loose, writer, purpose]);
  const refused = newTask.preset?.refused;
  const presetRelation = newTask.preset?.relation;
  const [chosen, setChosen] = useState<string | null | undefined>(
    refused !== undefined
      ? refused.card.repository
      : presetRelation !== undefined && treeKind(presetRelation.kind)
        ? presetRelation.task.repository
        : newTask.preset?.repository,
  );
  const [choice, pickedModel, choose] = useDefaultChoice(refused?.card.choice);
  const [alsoChosen, setAlsoChosen] = useState<readonly string[]>(
    refused?.card.press.ask.agent.alsoRepositories ?? NONE_ALSO,
  );
  const [pickedByHand, setPickedByHand] = useState(refused !== undefined);
  const [disabledServers, setDisabledServers] = useState<readonly string[]>(
    refused?.card.press.ask.agent.disabledServers ?? NONE_OFF,
  );
  const openSettings = useOpenSettings();
  const servers: AgentServersControl = {
    disabled: disabledServers,
    onSwitch: setDisabledServers,
    onOpenSettings: () => openSettings({ page: SETTINGS_VIEW.INTEGRATIONS }),
  };
  const [starting, setStarting] = useState(false);
  const [note, setNote] = useState<Failure | undefined>(refused?.note);
  const offersPilot =
    useQuery({ ...appStateQuery, select: selectExperiment(EXPERIMENT.PILOT) }).data === true &&
    !forAutomation;
  const [mode, setMode] = useState<TaskMode>(refused?.card.press.ask.mode ?? TASK_MODE.PILOT);
  const asked = offersPilot ? mode : undefined;
  const [related, setRelated] = useState<readonly NewTaskRelation[]>(
    refused?.card.relations ?? (presetRelation === undefined ? [] : [presetRelation]),
  );
  const [relationKind, setRelationKind] = useState<TaskCreateRelationKind>(
    TASK_CREATE_RELATION_KIND.SUB_TASK_OF,
  );
  const relationSearchId = useId();
  const relations = forAutomation
    ? []
    : related.filter((each) => each.task.workspaceId === workspaceId);
  const treeRelation = treeRelationOf(relations);
  const tree = treeRelation !== undefined;
  const relate = (next: readonly NewTaskRelation[]) => {
    setRelated(next);
    const nextTree = treeRelationOf(next);
    if (nextTree !== undefined) setChosen(nextTree.task.repository);
  };
  useLayoutEffect(() => {
    if (refused === undefined) return;
    const { words: kept, press } = refused.card;
    draft.update((now) =>
      hasWordsOrFiles(now.text, now.attachments)
        ? now
        : { ...now, text: kept, attachments: press.ask.agent.attachments },
    );
  }, []);
  const pressed = useRef<NewTaskPress | undefined>(refused?.card.press);
  const repositories = newTask.repositoriesIn(workspaceId);
  const workspace = newTask.workspaces.find((each) => each.id === workspaceId);
  const relatable = useMemo(
    () => newTask.tasks.filter((each) => each.workspaceId === workspaceId),
    [newTask.tasks, workspaceId],
  );
  const runsOnStands = !forAutomation;
  const asksDevices =
    useQuery({ ...appStateQuery, select: selectExperiment(EXPERIMENT.BRING_YOUR_OWN_HOST) })
      .data === true && runsOnStands;
  const readModels = useRef(newTask.readModels);
  readModels.current = newTask.readModels;
  useEffect(() => {
    if (asksDevices) readModels.current();
  }, [asksDevices]);
  const devices = (asksDevices ? newTask.devices : undefined) ?? NO_DEVICES;
  const [device, chooseDevice, keptDevice] = useNewTaskRunsOn(devices);
  const { modelsRead } = newTask;
  const [readAsOpened] = useState(modelsRead.generation);
  const readSinceOpened = modelsRead.generation > readAsOpened;
  const [devicesLanded, setDevicesLanded] = useState(false);
  if (!devicesLanded && readSinceOpened && modelsRead.state === MODELS_READ.READ) {
    setDevicesLanded(true);
  }
  const devicesUnread = asksDevices && keptDevice && !devicesLanded;
  const devicesFailed = devicesUnread && readSinceOpened && modelsRead.state === MODELS_READ.FAILED;
  const runsOn = runsOnStands ? newTaskRunsOn(device) : undefined;
  const [listed, setListed] = useState<readonly string[] | undefined>(undefined);
  const [dropped, setDropped] = useState<readonly string[]>(NONE_DROPPED);
  const [scope, setScope] = useState(repositories.scope);
  if (repositories.scope !== scope) {
    setListed(undefined);
    if (scope !== undefined) {
      setChosen(undefined);
      setAlsoChosen(NONE_ALSO);
      setPickedByHand(false);
      setDropped(NONE_DROPPED);
    }
    setScope(repositories.scope);
  }
  const isListed = (name: string) =>
    listed === undefined || listed.some((each) => sameRepository(each, name));
  const kept = (name: string) => !dropped.some((each) => sameRepository(each, name));
  const fallback =
    repositories.recent.find((each) => kept(each) && isListed(each)) ?? listed?.find(kept) ?? null;
  const candidate = chosen === undefined ? fallback : chosen;
  const judged = repositories.scope !== undefined && repositories.scope === scope;
  const drop = (name: string) => {
    setDropped((was) => (was.some((each) => sameRepository(each, name)) ? was : [...was, name]));
    setChosen(undefined);
  };
  const unlisted = [candidate, ...repositories.recent].filter(
    (each): each is string => each !== null && kept(each) && !isListed(each),
  );
  if (judged && unlisted.length > 0) {
    setDropped([...dropped, ...unlisted]);
    if (chosen !== undefined && chosen !== null) setChosen(undefined);
  }
  const picked =
    candidate !== null &&
    (!isListed(candidate) ||
      (listed === undefined && workspace !== undefined && !workspaceReaches(workspace, candidate)))
      ? null
      : candidate;
  const repository = treeRelation === undefined ? picked : treeRelation.task.repository;
  const offersAlso = !forAutomation && device === undefined && !(tree && repository === null);
  const also =
    !offersAlso || repository === null
      ? NONE_ALSO
      : alsoChosen.filter((each) => !sameRepository(each, repository) && isListed(each));
  const togglePick = (name: string) => {
    if (tree) {
      if (repository !== null && sameRepository(repository, name)) return;
      setAlsoChosen(
        also.some((each) => sameRepository(each, name))
          ? also.filter((each) => !sameRepository(each, name))
          : [...also, name],
      );
      return;
    }
    const picks = repository === null || !pickedByHand ? [] : [repository, ...also];
    const next = picks.some((each) => sameRepository(each, name))
      ? picks.filter((each) => !sameRepository(each, name))
      : [...picks, name];
    const [first = null, ...rest] = next;
    setChosen(first);
    setAlsoChosen(rest);
    setPickedByHand(true);
  };
  const said = words.trim();
  const filled = forAutomation ? said !== "" : hasWordsOrFiles(said, attachments);
  const unpaid =
    newTask.models === undefined || choice === undefined
      ? undefined
      : unrunnableChoice(newTask.models, choice);
  const canStart = !devicesUnread && unpaid === undefined && filled;
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
  const queryClient = useQueryClient();
  const skillsOn =
    useQuery({ ...appStateQuery, select: selectExperiment(EXPERIMENT.SKILLS) }).data === true;
  const skills = useMemo(
    () =>
      workspaceId === undefined || !skillsOn
        ? undefined
        : keptSkills(() =>
            queryClient.fetchQuery(
              repositorySkillsQueryOptions(
                repository === null ? { workspaceId } : { workspaceId, repository },
              ),
            ),
          ),
    [queryClient, workspaceId, repository, skillsOn],
  );
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
    const agentStart = handing.handed !== undefined;
    if (agentStart) draft.update(() => EMPTY_DRAFT);
    newTask
      .start("", tree ? null : repository, workspaceId, {
        ...(runsOn === undefined ? undefined : { runsOn }),
        ...(device === undefined ? undefined : { device }),
        ...(relations.length === 0 ? undefined : { relations: relationsAsked(relations) }),
        ...handing,
      })
      .then((refused) => {
        if (refused === undefined) {
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
      relations: relationsAsked(relations),
      agent: {
        prompt,
        attachments,
        choice: pickedModel,
        disabledServers,
        ...(also.length === 0 ? undefined : { alsoRepositories: also }),
      },
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
        relations,
        repository,
        choice: pickedModel,
        press,
        words,
      },
    });
  };
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
      onChoose={(name) => {
        setChosen(name);
        setPickedByHand(true);
      }}
      onUnreached={judged && repository !== null ? () => drop(repository) : undefined}
      onClear={
        tree
          ? undefined
          : () => {
              setChosen(null);
              setAlsoChosen(NONE_ALSO);
              setPickedByHand(true);
            }
      }
      onListed={setListed}
      pending={!tree && chosen !== null && repository === null}
      held={tree && !offersAlso ? REPOSITORY_HELD : undefined}
      several={
        offersAlso
          ? {
              also,
              onToggle: togglePick,
              held: tree ? REPOSITORY_HELD : undefined,
              standIn: !tree && !pickedByHand,
            }
          : undefined
      }
    />
  );
  const composer: AgentComposerControl = {
    draft: words,
    setDraft: (text) => {
      if (text === words) return;
      draft.update((was) => ({ ...was, text }));
      setNote(undefined);
    },
    attachments,
    setAttachments: (next) =>
      draft.update((was) => ({ ...was, attachments: next(was.attachments) })),
    sending: starting,
    note: devicesFailed ? DEVICES_UNREAD : note,
    closed: undefined,
    send: start,
    retry: devicesFailed ? () => readModels.current() : start,
    sent: [],
  };

  const relationControl: NewTaskRelations = {
    relations,
    tasks: relatable,
    workspaceName: workspace?.name ?? "",
    repository,
    disabled: starting,
    onChange: relate,
  };
  const relationPlus = forAutomation
    ? undefined
    : [relationMenuPanel(relationSearchId, relationControl, relationKind, setRelationKind)];

  const agentNotice =
    unpaid === undefined || newTask.models === undefined ? null : (
      <ConnectAgentBanner models={newTask.models} unpaid={unpaid} look={notices} />
    );
  const carded = notices === NOTICE_LOOK.CARD;
  const card = (
    <div className="new-task-composer flex min-w-0 flex-col gap-control-gap">
      {carded ? (
        <div className="new-task-notices mb-control-gap flex min-w-0 flex-col gap-control-gap empty:hidden">
          {agentNotice}
          <NoRepositoriesBanner chooser={repositories} />
        </div>
      ) : null}
      <div className="new-task-head flex min-w-0 flex-wrap items-center gap-item-gap">
        <div className="new-task-title flex min-w-0 max-w-full items-center gap-item-gap">
          {forAutomation ? (
            <Text
              variant={TEXT_VARIANT.DIALOG}
              as={TEXT_ELEMENT.H2}
              id={titleId}
              className="max-w-new-task-title shrink-0"
            >
              {PURPOSE_HEADING[purpose]}
            </Text>
          ) : (
            <VisuallyHidden id={titleId}>{PURPOSE_HEADING[purpose]}</VisuallyHidden>
          )}
          {repositoryChip}
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
      {relations.length === 0 ? null : (
        <div className={`new-task-relations-dock ${COMPOSER_DOCK_CLASS}`}>
          <NewTaskRelationRows control={relationControl} />
        </div>
      )}
      {carded ? null : agentNotice}
      <AgentComposer
        status={AGENT_STATUS.STARTING}
        composer={composer}
        wording={startsBare ? BARE_WORDS : PURPOSE_WORDS[purpose]}
        sendable={
          !devicesUnread && (startsBare || unpaid === undefined) && (!forAutomation || said !== "")
        }
        model={choice === undefined ? undefined : { choice, note: undefined, choose }}
        models={newTask.models}
        modelsFailed={newTask.modelsFailed}
        readModels={newTask.readModels}
        usage={undefined}
        servers={servers}
        plus={relationPlus}
        skills={skills}
        published={undefined}
        doors={{ openGitHub: () => undefined, copy: () => undefined }}
        onStop={() => Promise.resolve(false)}
        followsUp={false}
        onKey={onKey}
        onLeave={onLeave}
        focusedByOwner={focusedByOwner}
        takesFocus={takesFocus}
        listSide={listSide}
        tools={
          runsOnStands
            ? (narrow) => (
                <NewTaskRunsOnChip
                  devices={devices}
                  device={device}
                  disabled={starting}
                  narrow={narrow}
                  onChoose={chooseDevice}
                />
              )
            : undefined
        }
      />
    </div>
  );
  return (
    <TaskMentions value={mentions}>
      <SkillFiles source={skills} onOpen={openSkill}>
        {card}
      </SkillFiles>
    </TaskMentions>
  );
}
