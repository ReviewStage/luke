import { AGENT_CALL_FAILURE } from "@repo/features/agent-view";
import {
  type AgentAttachment,
  type AgentChangesPeople,
  type AgentOrigin,
  type AgentPullRequest,
  type AgentRunsOnRequest,
  type AgentSummary,
  CONTEXT_WINDOW,
  type TasklessAgent,
} from "@repo/features/agent-wire";
import { FAILURE_REASON, type Failure } from "@repo/features/failure-remedy";
import type {
  CatalogModel,
  MacOffer,
  ModelChoice,
  ModelProvider,
} from "@repo/features/models-wire";
import {
  PULL_REQUEST_CHAPTERS_CALL_FAILURE,
  type PullRequestChaptersAnswerView,
} from "@repo/features/pull-request-chapters-view";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import type { ListedPullRequest, TaskMode } from "@repo/features/task-wire";
import { ACT_KIND } from "@repo/host/acts";
import { OWN_PULL_REQUEST } from "@repo/host/app-state";
import type { PortActPayload } from "@repo/host/contract";
import { EXPERIMENT } from "@repo/settings";
import { STATUS_TONE } from "@repo/ui";
import { ACTION_RESULT_STATUS, type ActionResult } from "@repo/wire";
import {
  mutationOptions,
  type QueryClient,
  useIsMutating,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useOfferedModels } from "../account-choices.js";
import {
  type ActedResult,
  type ActResult,
  type AgentActAnswer,
  askAct,
  sendAct,
  type Unreached,
  unreachedAs,
} from "../act.js";
import { actMutation } from "../act-mutations.js";
import {
  DRAFT_PLACE,
  type Draft,
  type KeptDraft,
  type NewAgentPlace,
  useDraftWriter,
  useNewAgentDraft,
} from "../composer-drafts.js";
import type { ShownFailure } from "../failure-report.js";
import { modelsRetryMutation } from "../live-reads.js";
import type { RenameShape } from "../rename-write.js";
import { rendererPause } from "../renderer-runtime.js";
import { useSteadyDoor, useSteadyDoors } from "../steady-door.js";
import { TOAST_HOLD, undoToast, useToast, useWithdrawToast } from "../toast.js";
import { pressRows, ROW_WRITE, type RowDoors } from "../undo-stack.js";
import {
  appStateQuery,
  memoizedSelect,
  selectExperiment,
  selectPullRequestPublished,
} from "../use-app-state.js";
import {
  ARCHIVE_NOT_READY,
  archiveWords,
  choiceRequest,
  continueFailureNote,
  DELETE_WORDS,
  openingLineOf,
  RENAME_FAILED,
  SERVERS_FAILED,
  type SentLine,
  START_FAILED_AWAY,
  START_NEEDS_TASK,
  STOP_FAILED,
  startFailureNote,
} from "./agent-model.js";
import {
  agentMessagesQueryOptions,
  agentPageQueryOptions,
  repositorySkillsQueryOptions,
} from "./agent-reads.js";
import { type AgentFork, continueFork, forkStart } from "./fork-model.js";
import { type ByPullRequestTab, pullRequestAsked } from "./pull-request-number.js";
import { keptSkills } from "./repository-skills.js";
import type { SkillSource } from "./skill-picker.js";
import type { MessageSender } from "./use-agent-composer.js";
import type { ChoiceWriter } from "./use-agent-model.js";
import { useListedPullRequests } from "./use-agent-pull-request.js";
import type { ServersWriter } from "./use-agent-servers.js";
import type { TranscriptReader } from "./use-agent-transcript.js";
import type {
  InboxAnswerer,
  InboxImageReader,
  InboxMessenger,
  InboxThreadStarter,
} from "./use-task-inbox.js";

const CHAPTERS_UNANSWERED: PullRequestChaptersAnswerView = {
  failure: PULL_REQUEST_CHAPTERS_CALL_FAILURE.UNANSWERED,
};

type StartFailure = Failure & { readonly cause?: unknown };

const agentUnreached = unreachedAs(AGENT_CALL_FAILURE.UNANSWERED);

interface AgentRenameAsk {
  readonly agentId: string;
  readonly title: string;
}

export function agentRenameMutation(send: (asked: AgentRenameAsk) => Promise<AgentActAnswer>) {
  return mutationOptions({ mutationKey: [ACT_KIND.AGENTS_RENAME], mutationFn: send });
}

type AgentDeleteAnswer =
  | ActResult<typeof ACT_KIND.AGENTS_DELETE>
  | Unreached<typeof AGENT_CALL_FAILURE.UNANSWERED>;

function deleteAnswered(answer: AgentDeleteAnswer): ActedResult {
  if (!("failure" in answer)) return { status: ACTION_RESULT_STATUS.ACCEPTED };
  const notReady = answer.failure === AGENT_CALL_FAILURE.AGENT_NOT_READY;
  return {
    status: ACTION_RESULT_STATUS.REJECTED,
    reason: notReady ? ARCHIVE_NOT_READY : DELETE_WORDS.refused,
    cause: answer,
  };
}

export function agentDeleteMutation(send: (agentId: string) => Promise<AgentDeleteAnswer>) {
  return mutationOptions({
    mutationKey: [ACT_KIND.AGENTS_DELETE],
    mutationFn: (agentId: string) => send(agentId).then(deleteAnswered),
  });
}

type AgentDeleteMutation = ReturnType<typeof agentDeleteMutation>;

interface RepositoryAdded {
  readonly agentId: string;
  readonly repository: string;
}

export function agentAddRepositoryMutation(
  send: (added: RepositoryAdded) => Promise<AgentActAnswer>,
) {
  return mutationOptions({ mutationKey: [ACT_KIND.AGENTS_ADD_REPOSITORY], mutationFn: send });
}

type AgentAddRepositoryMutation = ReturnType<typeof agentAddRepositoryMutation>;

type AgentRenameMutation = ReturnType<typeof agentRenameMutation>;

export const AGENT_RENAME_SHAPE = {
  ask: (agentId: string, title: string): AgentRenameAsk => ({ agentId, title }),
  asked: ({ agentId, title }: AgentRenameAsk) => ({ subjectId: agentId, name: title }),
  refused: (answer: AgentActAnswer) => "failure" in answer,
} satisfies RenameShape<AgentActAnswer, AgentRenameAsk>;

const NO_KEYWORDS: readonly string[] = [];

const NO_LISTED_AGENTS: readonly AgentSummary[] = [];

const NO_NUMBERED_PULL_REQUESTS: ByPullRequestTab<AgentPullRequest> = new Map();

const selectNumberedPullRequests = memoizedSelect(
  (state) => [selectPullRequestPublished(state)],
  (held): ByPullRequestTab<AgentPullRequest> => {
    const numbered = new Map<string, Map<number | undefined, AgentPullRequest>>();
    for (const [agentId, ofAgent] of Object.entries(held ?? {})) {
      for (const [number, read] of Object.entries(ofAgent)) {
        const rows = read.rows;
        if (number === OWN_PULL_REQUEST || rows === undefined || "failure" in rows) continue;
        if (rows.pullRequest === null) continue;
        const kept = numbered.get(agentId) ?? new Map<number | undefined, AgentPullRequest>();
        numbered.set(agentId, kept.set(Number(number), rows.pullRequest));
      }
    }
    return numbered.size === 0 ? NO_NUMBERED_PULL_REQUESTS : numbered;
  },
);

const MODELS_READ_BOUND_MS = 15_000;

interface StartedWords {
  readonly key: string;
  readonly prompt: string;
  readonly attachments: readonly AgentAttachment[];
  readonly sentAt: number;
}

interface OpeningLine {
  readonly agentId: string;
  readonly line: SentLine;
}

interface ArchivePress {
  readonly asked?: true;
}

interface ArchiveAsk extends ArchivePress {
  readonly agentId: string;
  readonly archived: boolean;
}

export function agentArchiveMutation(run: (asked: ArchiveAsk) => Promise<ActedResult>) {
  return mutationOptions({ mutationKey: [ROW_WRITE.AGENT_ARCHIVE.kind], mutationFn: run });
}

type AgentArchiveMutation = ReturnType<typeof agentArchiveMutation>;

export interface HeldPeople {
  readonly url: string;
  readonly people: AgentChangesPeople;
}

export interface AgentsControl {
  me: string | undefined;
  agents: readonly AgentSummary[] | undefined;
  archived: readonly AgentSummary[] | undefined;
  listed?: readonly AgentSummary[] | undefined;
  workspaceId?: string | undefined;
  agentRepository?: string | undefined;
  origin?: AgentOrigin | undefined;
  agentIds: readonly string[] | undefined;
  heldIds: readonly string[] | undefined;
  listFailed: boolean;
  listMissing: boolean;
  onRetryList: () => void;
  models: readonly CatalogModel[] | undefined;
  modelsFailed: boolean;
  modelsRead: ModelsRead;
  macs: readonly MacOffer[] | undefined;
  readModels: () => void;
  mode: TaskMode | undefined;
  draft: AgentDraft | undefined;
  onNewDraft: () => string;
  onForkDraft: (fork: AgentFork) => string;
  onContinueDraft: (
    sourceId: string,
    words: string,
    attachments: readonly AgentAttachment[],
  ) => string;
  onDropFork: () => void;
  onDraftChange: (
    change: Partial<
      Pick<AgentDraft, "prompt" | "choice" | "disabledServers" | "runsOn" | "refused">
    >,
  ) => void;
  onHandDraft: (taskId: string, handed: HandedDraft) => void;
  onTaskStarted: (taskId: string, agent: AgentSummary, words: StartedWords) => void;
  opening: OpeningLine | undefined;
  onDraftAttachments: (
    next: (held: readonly AgentAttachment[]) => readonly AgentAttachment[],
  ) => void;
  onDiscardDraft: (draftId: string) => void;
  startPrompt: (
    draftId: string,
    prompt: string,
    choice: ModelChoice | undefined,
    attachments: readonly AgentAttachment[],
    disabledServers?: readonly string[],
    runsOn?: AgentRunsOnRequest,
  ) => Promise<StartFailure | undefined>;
  startFork: (
    draftId: string,
    fork: AgentFork,
    words: string,
    choice: ModelChoice | undefined,
    attachments: readonly AgentAttachment[],
    disabledServers?: readonly string[],
    runsOn?: AgentRunsOnRequest,
  ) => Promise<StartFailure | undefined>;
  onUnarchive: (() => void | Promise<void>) | undefined;
  continueAgent: AgentContinuer | undefined;
  start: {
    available: boolean;
    busy: boolean;
    onPress: (choice?: ModelChoice) => Promise<StartFailure | undefined>;
    pending?: StartingAgent | undefined;
  };
  onStop: (agentId: string) => Promise<boolean>;
  onRewind: (agentId: string, messageId: string) => Promise<AgentActAnswer>;
  onMessage: MessageSender;
  onChoose: ChoiceWriter;
  onSwitchServers: ServersWriter;
  addRepository?: AgentAddRepositoryMutation | undefined;
  onOpenIntegrations: () => void;
  onOpenApiKeys: (provider: ModelProvider | undefined) => void;
  archiving: boolean;
  rename: RenameShape<AgentActAnswer, AgentRenameAsk> & { readonly options: AgentRenameMutation };
  onArchive: (agentId: string, archived: boolean, how?: ArchivePress) => Promise<ActedResult>;
  archiveAgent: AgentArchiveMutation;
  deleteAgent: AgentDeleteMutation;
  readAgent: (agentId: string) => Promise<AgentSummary | undefined>;
  readTranscript: TranscriptReader;
  pullRequests: ReadonlyMap<string, AgentPullRequest>;
  numberedPullRequests: ByPullRequestTab<AgentPullRequest>;
  generateChapters: (agentId: string, number?: number) => Promise<PullRequestChaptersAnswerView>;
  keywords: readonly string[];
  readSkills: SkillSource | undefined;
  answerInbox: InboxAnswerer;
  messageInbox: InboxMessenger;
  startInboxThread: InboxThreadStarter;
  readInboxImage: InboxImageReader;
}

export interface AgentDraft {
  readonly id: string;
  readonly prompt: string;
  readonly attachments: readonly AgentAttachment[];
  readonly choice: ModelChoice | undefined;
  readonly disabledServers: readonly string[];
  readonly fork?: AgentFork | undefined;
  readonly runsOn?: AgentRunsOnRequest | undefined;
  readonly refused?: StartFailure | undefined;
}

type DraftChoices = Pick<
  AgentDraft,
  "id" | "choice" | "disabledServers" | "fork" | "runsOn" | "refused"
>;

function taskDraft(
  held: DraftChoices | undefined,
  kept: KeptDraft<NewAgentPlace> | undefined,
): AgentDraft | undefined {
  const id = held?.id ?? kept?.place.draftId;
  if (id === undefined) return undefined;
  return {
    id,
    prompt: kept?.text ?? "",
    attachments: kept?.attachments ?? [],
    choice: held?.choice,
    disabledServers: held?.disabledServers ?? [],
    ...forkOf(held === undefined ? kept?.place.fork : held.fork),
    ...runsOnOf(held?.runsOn),
    ...(held?.refused === undefined ? undefined : { refused: held.refused }),
  };
}

interface HandedDraft {
  readonly id: string;
  readonly prompt: string;
  readonly attachments: readonly AgentAttachment[];
  readonly choice: ModelChoice | undefined;
  readonly disabledServers: readonly string[];
  readonly refused: StartFailure;
}

function forkOf(fork: AgentFork | undefined): { readonly fork?: AgentFork } {
  return fork === undefined ? {} : { fork };
}

function runsOnOf(runsOn: AgentRunsOnRequest | undefined): {
  readonly runsOn?: AgentRunsOnRequest;
} {
  return runsOn === undefined ? {} : { runsOn };
}

const NOTHING_CARRIED: Pick<Draft, "text" | "attachments"> = { text: "", attachments: [] };

export interface StartingAgent {
  readonly key: string;
  readonly model: string | undefined;
}

const DRAFT_CLOSED = "Draft closed";

interface ClosedDraft {
  readonly on: string;
  readonly choices: DraftChoices;
  readonly words: Pick<Draft, "text" | "attachments">;
}

function choicesOf(draft: AgentDraft): DraftChoices {
  const { id, choice, disabledServers, fork, runsOn, refused } = draft;
  return {
    id,
    choice,
    disabledServers,
    ...forkOf(fork),
    ...runsOnOf(runsOn),
    ...(refused === undefined ? undefined : { refused }),
  };
}

function holdsNoWords(draft: AgentDraft): boolean {
  return draft.prompt === "" && draft.attachments.length === 0;
}

export function holdsNothing(draft: AgentDraft): boolean {
  return (
    holdsNoWords(draft) &&
    draft.fork === undefined &&
    draft.choice === undefined &&
    draft.disabledServers.length === 0 &&
    draft.runsOn === undefined &&
    draft.refused === undefined
  );
}

function closedDraft(on: string, draft: AgentDraft): ClosedDraft | undefined {
  if (holdsNoWords(draft)) return undefined;
  return {
    on,
    choices: choicesOf(draft),
    words: { text: draft.prompt, attachments: draft.attachments },
  };
}

interface PendingStart {
  taskId: string;
  key: string;
  choice: ModelChoice | undefined;
}

export type AgentContinuer = (
  agentId: string,
  note?: string,
  attachments?: readonly AgentAttachment[],
  runsOn?: AgentRunsOnRequest,
) => Promise<Failure | undefined>;

interface PendingContinue {
  on: string;
  key: string;
  note: string | undefined;
  attachments: readonly AgentAttachment[];
  runsOn: AgentRunsOnRequest | undefined;
}

function samePlace(a: AgentRunsOnRequest | undefined, b: AgentRunsOnRequest | undefined): boolean {
  const deviceOf = (place: AgentRunsOnRequest | undefined) =>
    place !== undefined && "deviceId" in place ? place.deviceId : undefined;
  return a?.machine === b?.machine && deviceOf(a) === deviceOf(b);
}

function sameFiles(a: readonly AgentAttachment[], b: readonly AgentAttachment[]): boolean {
  return a.length === b.length && a.every((file, index) => file === b[index]);
}

export function readAgentById(
  queryClient: QueryClient,
  agentId: string,
): Promise<AgentSummary | undefined> {
  return queryClient.fetchQuery(agentPageQueryOptions(agentId)).then(
    (answer) => {
      if ("failure" in answer) return undefined;
      const {
        automationId,
        origin: _origin,
        workspaceId: _workspaceId,
        repository: _repository,
        ...agent
      } = answer.agent;
      return automationId === null ? agent : { ...agent, automationId };
    },
    () => undefined,
  );
}

const AGENT_LOOKUP = {
  FOUND: "found",
  MISSING: "missing",
  FAILED: "failed",
} as const;

type AgentLookup = (typeof AGENT_LOOKUP)[keyof typeof AGENT_LOOKUP];

function lookUpAgent(queryClient: QueryClient, agentId: string): Promise<AgentLookup> {
  return queryClient.fetchQuery(agentPageQueryOptions(agentId)).then(
    (answer) => {
      if (!("failure" in answer)) return AGENT_LOOKUP.FOUND;
      return answer.failure === AGENT_CALL_FAILURE.NOT_FOUND
        ? AGENT_LOOKUP.MISSING
        : AGENT_LOOKUP.FAILED;
    },
    () => AGENT_LOOKUP.FAILED,
  );
}

function sameChoice(a: ModelChoice | undefined, b: ModelChoice | undefined): boolean {
  return (
    a?.model === b?.model &&
    a?.effort === b?.effort &&
    (a?.contextWindow === CONTEXT_WINDOW.STANDARD) ===
      (b?.contextWindow === CONTEXT_WINDOW.STANDARD)
  );
}

export const MODELS_READ = {
  UNREAD: "unread",
  READING: "reading",
  READ: "read",
  FAILED: "failed",
} as const;

export type ModelsReadState = (typeof MODELS_READ)[keyof typeof MODELS_READ];

export interface ModelsRead {
  readonly state: ModelsReadState;
  readonly generation: number;
}

export function useAgents(input: {
  taskId: string | undefined;
  agentId?: string | undefined;
  repository: string | null;
  modeOf?: ((taskId: string) => TaskMode | undefined) | undefined;
  listedAgents?: readonly AgentSummary[] | undefined;
  listedPage?: Pick<TasklessAgent, "id" | "workspaceId" | "repository"> | undefined;
  list?:
    | { readonly read: boolean; readonly failed: boolean; readonly onRetry: () => void }
    | undefined;
  listedPullRequests?: readonly ListedPullRequest[] | undefined;
  onOpenIntegrations: () => void;
  me?: string | undefined;
  onOpenApiKeys: (provider: ModelProvider | undefined) => void;
  onStarted: (agentId: string) => void;
  onDraftRestored?: (on: string, draftId: string) => void;
  keywords?: readonly string[];
  mintKey?: () => string;
}): AgentsControl {
  const { taskId, agentId, repository } = input;
  const queryClient = useQueryClient();
  const { mutateAsync: sendStart, isPending: starting } = useMutation(
    actMutation(ACT_KIND.AGENTS_START),
  );
  const { mutateAsync: sendStop } = useMutation(actMutation(ACT_KIND.AGENTS_STOP));
  const { mutateAsync: sendRewind } = useMutation(actMutation(ACT_KIND.AGENTS_REWIND));
  const { mutateAsync: sendMessage } = useMutation(actMutation(ACT_KIND.AGENTS_MESSAGE));
  const { mutateAsync: sendChoice } = useMutation(actMutation(ACT_KIND.AGENTS_CHOOSE));
  const { mutateAsync: sendServers } = useMutation(actMutation(ACT_KIND.AGENTS_SERVERS));
  const { mutateAsync: sendArchive } = useMutation(actMutation(ROW_WRITE.AGENT_ARCHIVE.kind));
  const { mutateAsync: sendChapters } = useMutation(actMutation(ACT_KIND.CHAPTERS_GENERATE));
  const { mutateAsync: sendInboxAnswer } = useMutation(actMutation(ACT_KIND.AGENTS_INBOX_ANSWER));
  const { mutateAsync: sendInboxMessage } = useMutation(actMutation(ACT_KIND.AGENTS_INBOX_MESSAGE));
  const { mutateAsync: sendInboxStart } = useMutation(actMutation(ACT_KIND.AGENTS_INBOX_START));
  const archiving = useIsMutating({ mutationKey: [ROW_WRITE.AGENT_ARCHIVE.kind] }) > 0;
  const mintKey = input.mintKey ?? (() => crypto.randomUUID());
  const listedPage =
    taskId === undefined && input.listedPage?.id === agentId ? input.listedPage : undefined;
  const onPage = taskId === undefined && agentId !== undefined;
  const offered = useOfferedModels();
  const [modelsRead, setModelsRead] = useState<ModelsRead>({
    state: MODELS_READ.UNREAD,
    generation: 0,
  });
  const modelsGeneration = useRef(0);
  const startsOn = taskId ?? agentId;
  const [drafts, setDrafts] = useState<ReadonlyMap<string, DraftChoices>>(new Map());
  const heldDraft = startsOn === undefined ? undefined : drafts.get(startsOn);
  const keptDraft = useNewAgentDraft(startsOn, heldDraft?.id);
  const writer = useDraftWriter();
  const draft = startsOn === undefined ? undefined : taskDraft(heldDraft, keptDraft);
  const [started, setStarted] = useState<
    { taskId: string; agent: AgentSummary; line: SentLine } | undefined
  >(undefined);
  const pending = useRef<PendingStart | undefined>(undefined);
  const [pressed, setPressed] = useState<{ taskId: string; starting: StartingAgent } | undefined>(
    undefined,
  );
  const continues = useRef(new Map<string, PendingContinue>());
  const toast = useToast();
  const failed = useCallback(
    (words: string, failure: ShownFailure) =>
      toast({
        replayUnmasked: true,
        words,
        tone: STATUS_TONE.DANGER,
        hold: TOAST_HOLD.FAILED,
        failure,
      }),
    [toast],
  );
  const latest = useRef(input);
  latest.current = input;

  const seed = useMemo(() => (started === undefined ? undefined : [started.agent]), [started]);
  const held = taskId !== undefined && started?.taskId === taskId ? seed : undefined;
  const opening = useMemo(
    () => (started === undefined ? undefined : { agentId: started.agent.id, line: started.line }),
    [started],
  );
  const { listedAgents } = input;
  const listedHere = useMemo(() => {
    if (taskId !== undefined) return listedAgents?.filter((agent) => agent.planId === taskId);
    const page = listedAgents?.filter((agent) => agent.id === agentId);
    return page?.length === 0 ? undefined : page;
  }, [listedAgents, taskId, agentId]);
  const subject = taskId ?? agentId;
  const carried = useRef({ subject, ids: new Set<string>() });
  if (carried.current.subject !== subject) carried.current = { subject, ids: new Set() };
  for (const agent of listedHere ?? []) carried.current.ids.add(agent.id);
  const standing = useMemo(() => {
    if (listedHere === undefined) return held;
    const arriving = held?.filter((agent) => !carried.current.ids.has(agent.id)) ?? [];
    return arriving.length === 0 ? listedHere : [...listedHere, ...arriving];
  }, [listedHere, held]);
  const agents = useMemo(
    () => standing?.filter((agent) => agent.archivedAt === undefined),
    [standing],
  );
  const pressedHere = pressed?.taskId === taskId ? pressed?.starting : undefined;
  const agentIds = useMemo(() => {
    const ids = agents?.map((agent) => agent.id);
    return pressedHere === undefined ? ids : [...(ids ?? []), pressedHere.key];
  }, [agents, pressedHere]);
  const archivedAgents = useMemo(
    () => standing?.filter((agent) => agent.archivedAt !== undefined),
    [standing],
  );
  const modeTask = taskId ?? standing?.[0]?.planId ?? undefined;
  const mode = modeTask === undefined ? undefined : input.modeOf?.(modeTask);
  const { list } = input;
  const absent =
    onPage && list?.read === true && listedAgents !== undefined && listedHere === undefined;
  const dropped = agentId !== undefined && carried.current.ids.has(agentId);
  const [lookedUp, setLookedUp] = useState<
    { readonly agentId: string; readonly outcome: AgentLookup } | undefined
  >(undefined);
  const [lookups, setLookups] = useState(0);
  const lookUp = absent && !dropped ? agentId : undefined;
  useEffect(() => {
    if (lookUp === undefined) return;
    let live = true;
    lookUpAgent(queryClient, lookUp).then((outcome) => {
      if (live) setLookedUp({ agentId: lookUp, outcome });
    });
    return () => {
      live = false;
    };
  }, [lookUp, lookups]);
  const looked =
    lookedUp !== undefined && lookedUp.agentId === agentId ? lookedUp.outcome : undefined;
  const listMissing = absent && (dropped || looked === AGENT_LOOKUP.MISSING);
  const lookupFailed = lookUp !== undefined && looked === AGENT_LOOKUP.FAILED;
  const listFailed = onPage && listedHere === undefined && (list?.failed === true || lookupFailed);
  const retryList = list?.onRetry;
  const onRetryList = useCallback(() => {
    if (list?.failed === true) return retryList?.();
    if (!lookupFailed) return;
    setLookedUp(undefined);
    setLookups((count) => count + 1);
  }, [list?.failed, lookupFailed, retryList]);

  const settleModels = useCallback((generation: number, state: ModelsReadState) => {
    setModelsRead((was) =>
      was.generation === generation &&
      (state === MODELS_READ.READ || was.state === MODELS_READ.READING)
        ? { state, generation }
        : was,
    );
  }, []);
  const [modelsLanded, setModelsLanded] = useState(0);
  const { mutateAsync: retryModels } = useMutation(modelsRetryMutation());
  const readModels = useCallback(() => {
    modelsGeneration.current += 1;
    const generation = modelsGeneration.current;
    setModelsRead({ state: MODELS_READ.READING, generation });
    retryModels()
      .catch(() => undefined)
      .then(() => setModelsLanded(generation));
    rendererPause(MODELS_READ_BOUND_MS).then(() => settleModels(generation, MODELS_READ.FAILED));
  }, [retryModels, settleModels]);
  useEffect(() => {
    if (modelsLanded === 0) return;
    if (offered.data !== undefined) settleModels(modelsLanded, MODELS_READ.READ);
    else if (offered.isError) settleModels(modelsLanded, MODELS_READ.FAILED);
  }, [modelsLanded, offered.data, offered.isError, settleModels]);

  const askStart = (
    on: string,
    asked: Omit<PortActPayload<typeof ACT_KIND.AGENTS_START>, "taskId">,
  ): Promise<AgentActAnswer> => {
    const where = on === taskId ? { taskId: on } : undefined;
    return sendStart({ ...where, ...asked }).catch(agentUnreached);
  };

  const landed = (on: string, agent: AgentSummary) => {
    if ((latest.current.taskId ?? latest.current.agentId) !== on) return;
    latest.current.onStarted(agent.id);
  };

  const pressStart = async (choice?: ModelChoice): Promise<StartFailure | undefined> => {
    if (taskId === undefined || starting) return undefined;
    const held = pending.current;
    const key =
      held !== undefined && held.taskId === taskId && sameChoice(held.choice, choice)
        ? held.key
        : mintKey();
    pending.current = { taskId, key, choice };
    setPressed({ taskId, starting: { key, model: choice?.model } });
    latest.current.onStarted(key);
    const answer = await askStart(taskId, {
      idempotencyKey: key,
      ...(choice === undefined ? undefined : choiceRequest(choice)),
    });
    setPressed((was) => (was?.starting.key === key ? undefined : was));
    if ("failure" in answer) {
      if (answer.failure !== AGENT_CALL_FAILURE.UNANSWERED) pending.current = undefined;
      return { ...startFailureNote(answer, taskId), cause: answer };
    }
    pending.current = undefined;
    landed(taskId, answer.agent);
    return undefined;
  };

  const continueAgent: AgentContinuer = async (sourceId, note, attachments = [], runsOn) => {
    if (startsOn === undefined) return undefined;
    const held = continues.current.get(sourceId);
    const carried = note !== undefined || attachments.length > 0 ? (note ?? "") : undefined;
    const key =
      held !== undefined &&
      held.on === startsOn &&
      held.note === carried &&
      sameFiles(held.attachments, attachments) &&
      samePlace(held.runsOn, runsOn)
        ? held.key
        : mintKey();
    continues.current.set(sourceId, { on: startsOn, key, note: carried, attachments, runsOn });
    const forgetPress = () => {
      if (continues.current.get(sourceId)?.key === key) continues.current.delete(sourceId);
    };
    const answer = await askStart(startsOn, {
      idempotencyKey: key,
      from: { agentId: sourceId },
      ...(carried === undefined ? undefined : { note: carried }),
      ...(attachments.length === 0 ? undefined : { attachments }),
      ...(runsOn === undefined ? undefined : { runsOn }),
    });
    if ("failure" in answer) {
      if (answer.failure !== AGENT_CALL_FAILURE.UNANSWERED) forgetPress();
      const refused = continueFailureNote(answer, taskId ?? null);
      const shown = {
        surface: FAILURE_SURFACE.AGENT_START,
        cause: answer,
        about: { agentId: sourceId },
      };
      if (runsOn !== undefined) failed(refused.text, shown);
      else if ((latest.current.taskId ?? latest.current.agentId) !== startsOn) {
        failed(START_FAILED_AWAY, shown);
      }
      return refused;
    }
    forgetPress();
    landed(startsOn, answer.agent);
    return undefined;
  };

  const withDraft = (on: string, next: DraftChoices | undefined) =>
    setDrafts((was) => {
      const held = new Map(was);
      if (next === undefined) held.delete(on);
      else held.set(on, next);
      return held;
    });

  const letGo = (draftId: string) => {
    for (const [on, held] of drafts) if (held.id === draftId) withDraft(on, undefined);
    writer.drop((place) => place.kind === DRAFT_PLACE.NEW_AGENT && place.draftId === draftId);
  };

  const onNewDraft = (): string => {
    if (draft !== undefined) return draft.id;
    const id = mintKey();
    if (taskId !== undefined) {
      withDraft(taskId, { id, choice: undefined, disabledServers: [] });
    }
    return id;
  };

  const wordsPlace = (on: string, id: string, fork: AgentFork | undefined): NewAgentPlace => ({
    kind: DRAFT_PLACE.NEW_AGENT,
    planId: on,
    draftId: id,
    ...forkOf(fork),
  });

  const moveWords = (
    on: string,
    id: string,
    fork: AgentFork | undefined,
    carried: Pick<Draft, "text" | "attachments"> = NOTHING_CARRIED,
  ) => {
    const text = [draft?.prompt ?? "", carried.text].filter((each) => each !== "").join("\n\n");
    const attachments = [...(draft?.attachments ?? []), ...carried.attachments];
    if (draft !== undefined) {
      const was = draft.id;
      writer.drop((place) => place.kind === DRAFT_PLACE.NEW_AGENT && place.draftId === was);
    }
    writer.update(wordsPlace(on, id, fork), (kept) => ({ ...kept, text, attachments }));
  };

  const onForkDraft = (fork: AgentFork): string => {
    const id = mintKey();
    if (startsOn === undefined) return id;
    const source = standing?.find((agent) => agent.id === fork.agentId);
    moveWords(startsOn, id, fork);
    withDraft(startsOn, {
      id,
      choice: undefined,
      disabledServers: source?.disabledServers ?? [],
      fork,
    });
    return id;
  };

  const onContinueDraft = (
    sourceId: string,
    words: string,
    attachments: readonly AgentAttachment[],
  ): string => {
    const joins = draft?.fork?.agentId === sourceId && draft.fork.messageId === undefined;
    const adds = words.trim() !== "" || attachments.length > 0;
    const id = joins && !adds && draft !== undefined ? draft.id : mintKey();
    if (startsOn === undefined) return id;
    const source = standing?.find((agent) => agent.id === sourceId);
    const fork = continueFork(sourceId);
    moveWords(startsOn, id, fork, { text: words.trim(), attachments });
    withDraft(startsOn, {
      id,
      choice: joins ? draft?.choice : undefined,
      disabledServers: joins ? (draft?.disabledServers ?? []) : (source?.disabledServers ?? []),
      fork,
      ...runsOnOf(joins ? draft?.runsOn : undefined),
    });
    return id;
  };

  const onDropFork = () => {
    if (draft === undefined) return;
    if (taskId === undefined) {
      letGo(draft.id);
      return;
    }
    moveWords(taskId, draft.id, undefined);
    withDraft(taskId, {
      id: draft.id,
      choice: draft.choice,
      disabledServers: draft.disabledServers,
      ...runsOnOf(draft.runsOn),
    });
  };

  const writeWords = (next: (was: Draft) => Draft) => {
    if (startsOn === undefined || draft === undefined) return;
    writer.update(wordsPlace(startsOn, draft.id, draft.fork), next);
  };

  const onDraftChange = (
    change: Partial<
      Pick<AgentDraft, "prompt" | "choice" | "disabledServers" | "runsOn" | "refused">
    >,
  ) => {
    if (startsOn === undefined || draft === undefined) return;
    const { prompt, ...choices } = change;
    if (prompt !== undefined) writeWords((was) => ({ ...was, text: prompt }));
    if (Object.keys(choices).length === 0) return;
    withDraft(startsOn, {
      id: draft.id,
      choice: draft.choice,
      disabledServers: draft.disabledServers,
      ...(draft.fork === undefined ? undefined : { fork: draft.fork }),
      ...runsOnOf(draft.runsOn),
      ...(draft.refused === undefined ? undefined : { refused: draft.refused }),
      ...choices,
    });
  };

  const onHandDraft = (on: string, handed: HandedDraft) => {
    writer.update(wordsPlace(on, handed.id, undefined), (was) => ({
      ...was,
      text: handed.prompt,
      attachments: handed.attachments,
    }));
    withDraft(on, {
      id: handed.id,
      choice: handed.choice,
      disabledServers: handed.disabledServers,
      refused: handed.refused,
    });
  };

  const onTaskStarted = (on: string, agent: AgentSummary, words: StartedWords) => {
    setStarted({ taskId: on, agent, line: openingLineOf(words) });
  };

  const onDraftAttachments = (
    next: (held: readonly AgentAttachment[]) => readonly AgentAttachment[],
  ) => writeWords((was) => ({ ...was, attachments: next(was.attachments) }));

  const onDiscardDraft = (draftId: string) => {
    const closed =
      startsOn === undefined || draft?.id !== draftId ? undefined : closedDraft(startsOn, draft);
    letGo(draftId);
    if (closed === undefined) return;
    undoable.current = closed.choices.id;
    toast({
      ...undoToast(DRAFT_CLOSED, () => restoreNow.current(closed)),
      replayUnmasked: true,
      subject: closed.choices.id,
    });
  };

  const undoable = useRef<string | undefined>(undefined);
  const withdrawToast = useWithdrawToast();
  useEffect(
    () => () => {
      if (undoable.current !== undefined) withdrawToast(undoable.current);
      undoable.current = undefined;
    },
    [startsOn, withdrawToast],
  );

  const restoreDraft = (closed: ClosedDraft) => {
    const { on, choices, words } = closed;
    if (on !== startsOn) return;
    undoable.current = undefined;
    const standing = draft?.id === choices.id ? undefined : draft;
    const keeps = standing !== undefined && !holdsNothing(standing);
    const id = keeps ? mintKey() : choices.id;
    if (keeps) {
      moveWords(on, id, standing.fork, words);
      withDraft(on, { ...choicesOf(standing), id });
    } else {
      if (standing !== undefined) letGo(standing.id);
      writer.update(wordsPlace(on, id, choices.fork), (was) => ({ ...was, ...words }));
      withDraft(on, choices);
    }
    latest.current.onDraftRestored?.(on, id);
  };
  const restoreNow = useRef(restoreDraft);
  restoreNow.current = restoreDraft;

  const startPrompt = async (
    draftId: string,
    prompt: string,
    choice: ModelChoice | undefined,
    attachments: readonly AgentAttachment[],
    disabledServers: readonly string[] = [],
    runsOn?: AgentRunsOnRequest,
  ): Promise<StartFailure | undefined> => {
    if (taskId === undefined) return { reason: FAILURE_REASON.OTHER, text: START_NEEDS_TASK };
    const answer = await askStart(taskId, {
      idempotencyKey: draftId,
      prompt,
      ...(attachments.length === 0 ? undefined : { attachments }),
      ...(disabledServers.length === 0 ? undefined : { disabledServers }),
      ...(choice === undefined ? undefined : choiceRequest(choice)),
      ...runsOnOf(runsOn),
    });
    if ("failure" in answer) return { ...startFailureNote(answer, taskId), cause: answer };
    withDraft(taskId, undefined);
    writer.drop((place) => place.kind === DRAFT_PLACE.NEW_AGENT && place.draftId === draftId);
    landed(taskId, answer.agent);
    return undefined;
  };

  const startFork = async (
    draftId: string,
    fork: AgentFork,
    words: string,
    choice: ModelChoice | undefined,
    attachments: readonly AgentAttachment[],
    disabledServers: readonly string[] = [],
    runsOn?: AgentRunsOnRequest,
  ): Promise<StartFailure | undefined> => {
    if (startsOn === undefined) return { reason: FAILURE_REASON.OTHER, text: START_NEEDS_TASK };
    const asked = forkStart({
      draftId,
      fork,
      words,
      attachments,
      choice,
      disabledServers,
      runsOn,
    });
    const answer = await askStart(startsOn, asked);
    if ("failure" in answer) return { ...startFailureNote(answer, taskId ?? null), cause: answer };
    withDraft(startsOn, undefined);
    writer.drop((kept) => kept.kind === DRAFT_PLACE.NEW_AGENT && kept.draftId === draftId);
    landed(startsOn, answer.agent);
    return undefined;
  };

  const onStop = async (agentId: string): Promise<boolean> => {
    const answer = await sendStop({ agentId }).catch(agentUnreached);
    const took = !("failure" in answer);
    if (!took) {
      failed(STOP_FAILED, {
        surface: FAILURE_SURFACE.AGENT_STOP,
        cause: answer,
        about: { agentId },
      });
    }
    return took;
  };

  const onRewind = useCallback(
    (agentId: string, messageId: string): Promise<AgentActAnswer> =>
      sendRewind({ agentId, messageId }).catch(agentUnreached),
    [sendRewind],
  );

  const onMessage = useCallback<MessageSender>(
    async (agentId, text, clientKey, attachments) => {
      const answer: AgentActAnswer = await sendMessage({
        agentId,
        text,
        clientKey,
        ...(attachments.length === 0 ? undefined : { attachments }),
      }).catch(agentUnreached);
      return answer;
    },
    [sendMessage],
  );

  const onChoose = useCallback<ChoiceWriter>(
    (agentId, choice) => sendChoice({ agentId, ...choiceRequest(choice) }).catch(agentUnreached),
    [sendChoice],
  );

  const switches = useRef(new Map<string, number>());
  const onSwitchServers = useCallback<ServersWriter>(
    async (agentId, disabledServers) => {
      const change = (switches.current.get(agentId) ?? 0) + 1;
      switches.current.set(agentId, change);
      const answer: AgentActAnswer = await sendServers({
        agentId,
        disabledServers,
      }).catch(agentUnreached);
      if ("failure" in answer && switches.current.get(agentId) === change) {
        failed(SERVERS_FAILED, {
          surface: FAILURE_SURFACE.AGENT_SERVERS,
          cause: answer,
          about: { agentId },
        });
      }
      return answer;
    },
    [sendServers, failed],
  );

  const addRepository = agentAddRepositoryMutation(({ agentId, repository }) =>
    sendAct(ACT_KIND.AGENTS_ADD_REPOSITORY, { agentId, addRepository: { repository } }).catch(
      agentUnreached,
    ),
  );

  const rename = {
    ...AGENT_RENAME_SHAPE,
    options: agentRenameMutation((asked) => sendAct(ACT_KIND.AGENTS_RENAME, asked)),
    onRefused: (
      answer: AgentActAnswer | undefined,
      error: Error | null,
      { subjectId }: { readonly subjectId: string },
    ) =>
      failed(RENAME_FAILED, {
        surface: FAILURE_SURFACE.AGENT_RENAME,
        cause: answer ?? error,
        about: { agentId: subjectId },
      }),
  };

  const listedNow = useRef(input.listedAgents ?? NO_LISTED_AGENTS);
  listedNow.current = input.listedAgents ?? NO_LISTED_AGENTS;
  const agentDoors: RowDoors<readonly AgentSummary[], typeof ROW_WRITE.AGENT_ARCHIVE.kind> = {
    rows: () => listedNow.current,
    send: sendArchive,
  };
  const archiveAgent = agentArchiveMutation(async ({ agentId, archived, asked }) => {
    const pressed = pressRows(ROW_WRITE.AGENT_ARCHIVE, agentDoors, [
      { id: agentId, after: { archived } },
    ]);
    const answer: AgentActAnswer = await sendAct(ROW_WRITE.AGENT_ARCHIVE.kind, {
      agentId,
      archived,
    }).catch(agentUnreached);
    const words = archiveWords(archived);
    if ("failure" in answer) {
      const notReady = answer.failure === AGENT_CALL_FAILURE.AGENT_NOT_READY;
      return {
        status: ACTION_RESULT_STATUS.REJECTED,
        reason: notReady ? ARCHIVE_NOT_READY : words.refused,
        cause: answer,
      };
    }
    const undo =
      (asked ? undefined : pressed.keep(words.done)) ??
      (() =>
        void archiveNow.current(agentId, !archived).then((result) => sayRefusal(result, agentId)));
    toast({ ...undoToast(words.done, undo), replayUnmasked: true });
    return { status: ACTION_RESULT_STATUS.ACCEPTED };
  });
  const { mutateAsync: archive } = useMutation(archiveAgent);
  const onArchive = (
    agentId: string,
    archived: boolean,
    how: ArchivePress = {},
  ): Promise<ActedResult> => archive({ agentId, archived, ...how });
  const archiveNow = useRef(onArchive);
  archiveNow.current = onArchive;

  const deleteAgent = agentDeleteMutation((agentId) =>
    sendAct(ACT_KIND.AGENTS_DELETE, { agentId }).catch(agentUnreached),
  );
  const sayRefusal = (result: ActionResult, agentId: string) => {
    if (result.status === ACTION_RESULT_STATUS.ACCEPTED) return;
    failed(result.reason, {
      surface: FAILURE_SURFACE.AGENT_ARCHIVE,
      cause: result,
      about: { agentId },
    });
  };

  const readAgent = useCallback(
    (named: string) => readAgentById(queryClient, named),
    [queryClient],
  );

  const readTranscript = useCallback<TranscriptReader>(
    (params) => queryClient.fetchQuery(agentMessagesQueryOptions(params)),
    [queryClient],
  );

  const pullRequests = useListedPullRequests(
    input.listedPullRequests,
    taskId !== undefined ? { taskId } : agentId !== undefined ? { agentId } : undefined,
  );

  const numberedPullRequests =
    useQuery({ ...appStateQuery, select: selectNumberedPullRequests }).data ??
    NO_NUMBERED_PULL_REQUESTS;

  const generateChapters = useCallback<AgentsControl["generateChapters"]>(
    (agentId, number) =>
      sendChapters(pullRequestAsked(agentId, number)).catch(
        (): PullRequestChaptersAnswerView => CHAPTERS_UNANSWERED,
      ),
    [sendChapters],
  );

  const answerInbox = useCallback<InboxAnswerer>(
    (params) => sendInboxAnswer(params),
    [sendInboxAnswer],
  );

  const messageInbox = useCallback<InboxMessenger>(
    (params) => sendInboxMessage(params),
    [sendInboxMessage],
  );

  const startInboxThread = useCallback<InboxThreadStarter>(
    (params) => sendInboxStart(params),
    [sendInboxStart],
  );

  const workspaceId = listedPage?.workspaceId;
  const agentRepository = listedPage?.repository ?? undefined;
  const skillsOn =
    useQuery({ ...appStateQuery, select: selectExperiment(EXPERIMENT.SKILLS) }).data === true;
  const readSkills = useMemo(() => {
    if (!skillsOn) return undefined;
    if (taskId !== undefined) {
      return keptSkills(() =>
        queryClient.fetchQuery(repositorySkillsQueryOptions({ planId: taskId })),
      );
    }
    if (workspaceId === undefined) return undefined;
    const asked =
      agentRepository === undefined
        ? { workspaceId }
        : { workspaceId, repository: agentRepository };
    return keptSkills(() => queryClient.fetchQuery(repositorySkillsQueryOptions(asked)));
  }, [queryClient, skillsOn, taskId, workspaceId, agentRepository, repository]);

  const steadyStartPrompt = useSteadyDoor(startPrompt);
  const steadyStartFork = useSteadyDoor(startFork);
  const steadyContinueAgent = useSteadyDoor(continueAgent);

  const readInboxImage = useCallback<InboxImageReader>(
    (params) => askAct(ACT_KIND.AGENTS_INBOX_ATTACHMENT, params),
    [],
  );

  return useSteadyDoors({
    agents,
    archived: archivedAgents,
    listed: listedAgents,
    workspaceId,
    agentRepository,
    agentIds,
    heldIds: standing?.map((agent) => agent.id),
    mode,
    draft,
    onNewDraft,
    onForkDraft,
    onContinueDraft,
    onDropFork,
    onDraftChange,
    onHandDraft,
    onTaskStarted,
    opening,
    onDraftAttachments,
    onDiscardDraft,
    startPrompt: steadyStartPrompt,
    startFork: steadyStartFork,
    listFailed,
    listMissing,
    onRetryList,
    models: offered.data?.models,
    modelsFailed: offered.isError || modelsRead.state === MODELS_READ.FAILED,
    modelsRead,
    macs: offered.data === undefined ? undefined : (offered.data.macs ?? []),
    readModels,
    onUnarchive: undefined,
    continueAgent: startsOn === undefined ? undefined : steadyContinueAgent,
    start: {
      available: taskId !== undefined,
      busy: starting,
      onPress: pressStart,
      pending: pressedHere,
    },
    onStop,
    onRewind,
    onMessage,
    onChoose,
    onSwitchServers,
    addRepository,
    onOpenIntegrations: () => latest.current.onOpenIntegrations(),
    me: input.me,
    onOpenApiKeys: (provider) => latest.current.onOpenApiKeys(provider),
    archiving,
    archiveAgent,
    rename,
    onArchive,
    deleteAgent,
    readAgent,
    readTranscript,
    pullRequests,
    numberedPullRequests,
    generateChapters,
    keywords: input.keywords ?? NO_KEYWORDS,
    readSkills,
    answerInbox,
    messageInbox,
    startInboxThread,
    readInboxImage,
  });
}
