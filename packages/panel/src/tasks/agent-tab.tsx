import { AGENT_TOOL } from "@repo/features/agent-tools";
import { TRANSCRIPT_KIND } from "@repo/features/agent-view";
import {
  AGENT_BRIEF,
  AGENT_FAILURE,
  AGENT_SENDER,
  AGENT_STATUS,
  type AgentBrief,
  type AgentFailure,
  type AgentOrigin,
  type AgentPullRequestAnswer,
  type AgentStatus,
  type AgentSubagentStanding,
  type AgentSummary,
  type AgentTodos,
  type AgentTranscriptMessage,
  agentMessageWords,
  QUEUE_CHANGE,
} from "@repo/features/agent-wire";
import { DEVICE_LAUNCH_UNSTARTED } from "@repo/features/device-agent-wire";
import { FAILURE_REASON, type FailureReason, remedyLabel } from "@repo/features/failure-remedy";
import { threadLineWords } from "@repo/features/inbox-wire";
import type { CatalogModel, ModelChoice, ModelProvider } from "@repo/features/models-wire";
import type { KnownNames } from "@repo/features/place-chip-model";
import {
  FAILURE_CONDITION,
  FAILURE_SURFACE,
  type FailureAbout,
} from "@repo/features/shown-failure";
import type { TaskStatus } from "@repo/features/task-wire";
import { workingTime } from "@repo/features/time-format";
import {
  CALL_KIND,
  CALL_WORDS,
  isMadeCallKind,
  sameFieldsBy,
  sameShape,
} from "@repo/features/turn-rows";
import { replyFromWords } from "@repo/features/words";
import type { AppStateSnapshot } from "@repo/host/app-state";
import { AGENT_ENTER } from "@repo/settings";
import {
  ANNOUNCE,
  announce,
  BUTTON_VARIANT,
  Button,
  CodeCard,
  DisclosureChevron,
  DocumentIcon,
  ERROR_STATE_PLACEMENT,
  ErrorState,
  FAILURE_NOTE_TIME,
  FailureNote,
  GlyphSlot,
  INLINE_REF_LOOK,
  InlineRef,
  LineSummary,
  MESSAGE_LINE_ALIGN,
  MESSAGE_LINE_INSET,
  MessageHead,
  MessageLine,
  NOTE_LINE_LOOK,
  NoteLine,
  OneLine,
  STATUS_TONE,
  SUBJECT_FIT,
  SubjectLine,
  TaskStatusMark,
  TEXT_ELEMENT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  useAnnounce,
} from "@repo/ui";
import { ACTOR_KIND, ACTOR_STATE, type Actor } from "@repo/ui/actor-model";
import { AlarmClockCheckIcon, ICON_SIZE } from "@repo/ui/icons";
import { skillWord } from "@repo/ui/skill-mention";
import { pullRequestLabelOf } from "@repo/ui/tab-strip-model";
import { useDisclosure } from "@repo/ui/use-disclosure";
import type { VirtualRowsHandle } from "@repo/ui/virtual-rows";
import { type GitHubLineMetadata, MESSAGE_ROLE, type WireValue } from "@repo/wire";
import { useQuery } from "@tanstack/react-query";
import { BotIcon, WebhookIcon, ZapIcon } from "lucide-react";
import {
  createContext,
  memo,
  type ReactNode,
  type RefObject,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ActorLine, ActorRef, AutomationCard, automationActor } from "../actor-ref.js";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationRows,
  ConversationScrollButton,
  FLOATING_OVER_LOG_CLASS,
} from "../ai-elements/conversation.js";
import { Fold, FoldBody } from "../ai-elements/fold.js";
import {
  Message,
  MessageBeside,
  MessageContent,
  RECEIVED_MESSAGE_CLASS,
} from "../ai-elements/message.js";
import { Plan, PlanContent, PlanHeader, PlanIcon, PlanTitle } from "../ai-elements/plan.js";
import { TOOL_BLOCK, TOOL_STATE } from "../ai-elements/tool.js";
import { appPlatform } from "../app-platform.js";
import { AutomationsWanted, useAutomation } from "../automation-directory.js";
import { useConnected } from "../connection.js";
import { copyThroughShell, useCopyToast } from "../copy-feedback.js";
import { failureShown, unreadShown } from "../failure-report.js";
import { useFindOpen } from "../find-in-tab.js";
import { useMemberDirectory, usePerson } from "../member-directory.js";
import { TOAST_HOLD, useToast } from "../toast.js";
import { appStateQuery, selectAppSettingsView } from "../use-app-state.js";
import { type FindRow, useVirtualFind } from "../virtual-find.js";
import { AgentComposer, COMPOSER_DOCK_CLASS, LOG_OVER_COMPOSER_CLASS } from "./agent-composer.js";
import { AgentForward } from "./agent-forward.js";
import {
  AGENT_PART,
  type AgentPart,
  type AgentPartCut,
  agentLines,
  agentMessageOf,
  agentName,
  agentPart,
  agentParts,
  agentRows,
  agentStillWriting,
  agentWorkingPhase,
  agentWorkingSince,
  archivedByReading,
  CONTINUE_AGAIN_LABEL,
  CONTINUE_LABEL,
  commentLineOf,
  commentLineWords,
  continuedByIds,
  continuedByTitles,
  delegates,
  type EndLineParts,
  endLineOffersContinue,
  endLineParts,
  endLineReason,
  finishedReplyLead,
  githubLineOf,
  isTodos,
  isWakeupLine,
  lineSender,
  macOwnerOf,
  messageSender,
  messageWords,
  nativeSubagent,
  offersContinue,
  offersStop,
  type PlacedMessage,
  pilotTarget,
  placedMessages,
  planPayerOf,
  providerOf,
  SENT_LINE_STATE,
  type SentLine,
  type StartingLaunch,
  slackLineOf,
  type TurnStretch,
  teammateStarter,
  threadLineOf,
  transcriptRowKey,
  turnStretches,
  unreadOpeningLine,
  wakeupDelayOf,
  workerLines,
  workerStatusOf,
  workerToolState,
  workingLineWords,
} from "./agent-model.js";
import {
  AgentPicturesProvider,
  CallPictures,
  MessageFileChips,
  ShownPictures,
  useAgentPictureDoor,
} from "./agent-pictures.js";
import { AgentPlace } from "./agent-place.js";
import { type PublishedDoors, PublishedRow } from "./agent-published.js";
import { AgentQueueDock } from "./agent-queue-dock.js";
import { SendingAgent } from "./agent-ref.js";
import type { AgentServersControl } from "./agent-servers.js";
import type { HeldTranscript } from "./agent-tab-card.js";
import { AgentTabFoot, AgentTabFrame } from "./agent-tab-frame.js";
import {
  AgentTabSkeleton,
  type ComposerModel,
  ComposerSkeleton,
  TranscriptSkeleton,
} from "./agent-tab-skeleton.js";
import { dockedTodos, newestTodos, taskTodos, todosOfPart } from "./agent-todos.js";
import { ArchivedComposerNote } from "./archived-note.js";
import { ConnectionNames, useServerName } from "./connection-names.js";
import { ContinueAgent, ContinuedComposerNote, ContinuedTrail } from "./continue-agent.js";
import { CopyMessageAction } from "./copy-message.js";
import { DescriptionPictures } from "./description-pictures.js";
import { EditComposer } from "./edit-composer.js";
import { ForkedToLine, useForkOffered } from "./fork-action.js";
import { type ForkCut, forkCutOf, openReply } from "./fork-model.js";
import { GitHubSignInCard, type GitHubSignInDoors, RETRY_LINE } from "./github-sign-in-card.js";
import {
  CommentLineHead,
  GitHubLineCard,
  SlackLineHead,
  ThreadLineHead,
  TranscriptAgent,
} from "./line-cards.js";
import { CHIP_OR_LINK_FRAME, ChipOrLink, linkChip } from "./mention-chip.js";
import type { MentionHolder } from "./mention-holder.js";
import {
  agentMessagePlace,
  MESSAGE_GONE,
  MessagePlaceProvider,
  useMessageReveal,
} from "./message-links.js";
import { useMoveToCloud } from "./move-agent.js";
import { PilotComposerNote } from "./pilot-note.js";
import { ReplayCard, type ReplayPlace, replayPlace } from "./replay-card.js";
import { briefAgent, replayOpening } from "./replay-card-model.js";
import { REPLY_SCOPE, ReplyDoorProvider, ReplyToSelection } from "./reply-to-selection.js";
import { REWIND_ACTION, RewindProvider, rewindPoints, useMessageEdit } from "./rewind-action.js";
import { MentionedServers, SentToAgent } from "./server-card.js";
import { ShownPage } from "./shown-page.js";
import { SentWords, useSkill } from "./skill-chip.js";
import type { SkillSource } from "./skill-picker.js";
import { SkillCard } from "./skill-ref.js";
import { PlanGlyph } from "./tab-look.js";
import { useMentionDoors } from "./task-mentions.js";
import { type AgentThreads, ThreadsDock } from "./threads-dock.js";
import {
  calledAgent,
  cardTitle,
  delegationView,
  isServerCallTool,
  loadedSkill,
  sentWords,
  shownPageVersion,
  TARGET_HINT,
  TOOL_TARGET,
  type ToolTarget,
  targetLink,
  todoFocus,
  todosSummary,
  toolCallView,
  toolTarget,
  type WorkerJobs,
} from "./tool-call-model.js";
import {
  MacOwnerProvider,
  TranscriptNote,
  TranscriptOpeningCall,
  TranscriptReasoning,
  TranscriptRows,
  TranscriptSubagent,
  TranscriptTodos,
  TranscriptTodosDock,
  TranscriptTool,
  type TranscriptToolProps,
  TranscriptWords,
} from "./transcript-blocks.js";
import { drawnMessageWords, drawnRowsWords } from "./transcript-copy.js";
import { keptPieces, PIECE_ROWS, pieceKey, type TurnPiece, turnPieces } from "./turn-pieces.js";
import {
  UndeliveredLines,
  UndeliveredMark,
  useLineMarked,
  useLineSending,
  useLineStatus,
  useUndeliveredLines,
  useUnsentLines,
} from "./undelivered-mark.js";
import { type HeldComposer, useAgentComposer } from "./use-agent-composer.js";
import { type AgentModelControl, useAgentModel } from "./use-agent-model.js";
import { useAgentPullRequest } from "./use-agent-pull-request.js";
import { useAgentQueue, useQueueEditing } from "./use-agent-queue.js";
import { useAgentServers } from "./use-agent-servers.js";
import { type AgentTranscriptControl, useAgentTranscript } from "./use-agent-transcript.js";
import type { AgentsControl } from "./use-agents.js";
import { useKnownNames, useTaskStatus } from "./use-known-names.js";
import { type CutBody, useWholePart, useWholePartDoor, WholePartsProvider } from "./whole-parts.js";
import { WorkedFor, WorkingLine } from "./working-time.js";

interface TranscriptLead {
  label: string;
  icon: ReactNode;
  description?: true;
  startingLine: string;
}

export const AGENT_LEAD: TranscriptLead = {
  label: "Description",
  icon: <DocumentIcon />,
  description: true,
  startingLine: "The agent is starting.",
};

const TASK_TARGET: ToolTarget = { kind: TOOL_TARGET.DESCRIPTION };

const selectEnterQueues = (state: AppStateSnapshot): boolean =>
  selectAppSettingsView(state)?.agentEnter === AGENT_ENTER.QUEUE;

const ROW_ESTIMATE_PX = 172;

const TURN_FAILURE_CAUSE: ReadonlyMap<AgentFailure, { readonly code: AgentFailure }> = new Map(
  Object.values(AGENT_FAILURE).map((failure) => [failure, { code: failure }]),
);

const TRANSCRIPT_FAILED_LINE = "The transcript could not be read.";
const OLDER_FAILED_LINE = "Earlier messages could not be read.";

const WORKER_LEAD: TranscriptLead = {
  label: "Subagent task",
  icon: <BotIcon />,
  startingLine: "The worker is starting.",
};

const AUTOMATION_LEAD: TranscriptLead = {
  label: "Prompt",
  icon: <ZapIcon />,
  startingLine: "The agent is starting.",
};

const WEBHOOK_BODY_LABEL = "Webhook body";

const WEBHOOK_BODY_KIND = "body";

const DELETED_WORDS = "(deleted)";

const AUTOMATION_WORDS = "Automation";

export interface TranscriptOrigin {
  readonly sender: ReactNode;
  readonly lead?: TranscriptLead | undefined;
  readonly text?: string | undefined;
  readonly body?: string | undefined;
}

export interface BriefTask {
  readonly name: string;
  readonly status: TaskStatus | undefined;
  readonly card: ReactNode;
}

interface DelegatedWorker {
  readonly callId: string;
  readonly task: string;
  readonly status: AgentStatus;
}

export interface TranscriptCards {
  readonly target: (target: ToolTarget, name?: string) => ReactNode;
  readonly worker: (worker: DelegatedWorker) => ReactNode;
  readonly agent?: ((agentId: string) => Actor | undefined) | undefined;
  readonly task?: BriefTask | undefined;
  readonly standsOn?: MentionHolder | undefined;
}

export interface DelegationDoors {
  models: readonly CatalogModel[] | undefined;
  own?: ModelChoice | undefined;
  starts?: ReadonlyMap<string, number> | undefined;
  onOpen?: ((callId: string, task: string, status: AgentStatus) => void) | undefined;
  onOpenTarget?: ((target: ToolTarget) => void) | undefined;
  cards?: TranscriptCards | undefined;
  standings?: ReadonlyMap<string, AgentSubagentStanding> | undefined;
  jobs?: WorkerJobs | undefined;
}

const LiveDoors = createContext<Pick<DelegationDoors, "cards"> | undefined>(undefined);

function useLiveDoors(
  doors: Pick<DelegationDoors, "cards"> | undefined,
): Pick<DelegationDoors, "cards"> | undefined {
  return useContext(LiveDoors) ?? doors;
}

function AgentMessageRow({ message }: { message: AgentTranscriptMessage }): ReactNode {
  const sent = agentMessageOf(message);
  if (sent === undefined) return null;
  const text = messageWords(message);
  const words = agentMessageWords(text) ?? text;
  const sender = lineSender(message.sentBy, undefined, undefined);
  return (
    <Message
      from={MESSAGE_ROLE.ASSISTANT}
      className={RECEIVED_MESSAGE_CLASS}
      data-agent-message=""
      data-message-id={message.id}
    >
      <MessageHead
        sender={
          sender?.kind === ACTOR_KIND.AGENT && sender.agentId !== undefined ? (
            <SendingAgent actor={sender} agentId={sender.agentId} />
          ) : (
            <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.INHERIT} truncate>
              {message.sentBy?.name}
            </Text>
          )
        }
      />
      {words === "" ? null : (
        <MessageContent>
          <TranscriptWords text={words} />
        </MessageContent>
      )}
      <MessageLine
        align={MESSAGE_LINE_ALIGN.START}
        at={message.sentAt}
        actions={<CopyMessageAction words={words} copyable={words !== ""} messageId={message.id} />}
      />
    </Message>
  );
}

function GitHubLineRow({
  message,
  line,
  sender,
}: {
  message: AgentTranscriptMessage;
  line: GitHubLineMetadata;
  sender: ReactNode;
}): React.JSX.Element {
  const words = line.words ?? "";
  return (
    <Message
      from={MESSAGE_ROLE.ASSISTANT}
      className={RECEIVED_MESSAGE_CLASS}
      data-message-id={message.id}
    >
      <GitHubLineCard line={line} words={messageWords(message)} sender={sender} />
      <MessageLine
        align={MESSAGE_LINE_ALIGN.START}
        at={message.sentAt}
        actions={<CopyMessageAction words={words} copyable={words !== ""} messageId={message.id} />}
      />
    </Message>
  );
}

function calledAgentActor(
  part: Extract<AgentPart, { kind: typeof AGENT_PART.TOOL }>,
  cards: TranscriptCards | undefined,
  known: KnownNames,
): Actor | undefined {
  const called = calledAgent(part);
  if (called === undefined) return undefined;
  const listed = called.id === undefined ? undefined : cards?.agent?.(called.id);
  if (listed !== undefined || called.title === undefined) return listed;
  const model =
    called.model ?? (called.id === undefined ? undefined : known.agentModels.get(called.id));
  return {
    kind: ACTOR_KIND.AGENT,
    agentId: called.id,
    name: called.title,
    provider: model === undefined ? undefined : providerOf(model),
    state: ACTOR_STATE.REST,
  };
}

function ToolCallView({
  part,
  jobs,
  cards,
  made,
  cut,
}: {
  part: Extract<AgentPart, { kind: typeof AGENT_PART.TOOL }>;
  jobs?: WorkerJobs | undefined;
  cards?: TranscriptCards | undefined;
  made?: TranscriptToolProps["made"];
  cut?: CutBody | undefined;
}): ReactNode {
  const view = toolCallView({ ...part, jobs });
  const server = useServerName(view);
  const known = useKnownNames();
  const called = calledAgent(part);
  const agentCard =
    called?.id === undefined
      ? undefined
      : cards?.target({ kind: TOOL_TARGET.AGENT, agent: called.id }, called.title);
  return (
    <>
      <TranscriptTool
        data-call-id={part.callId}
        state={part.state}
        kind={view.kind}
        provider={view.provider}
        server={server}
        subject={view.subject}
        description={view.description}
        files={view.files}
        page={view.page}
        agent={calledAgentActor(part, cards, known)}
        agentCard={agentCard}
        made={made}
        input={view.input}
        output={view.output}
        errorText={part.errorText}
        cut={cut}
      />
      <CallPictures tool={part.tool} input={part.input} output={part.output} />
    </>
  );
}

function AgentCallView({
  part,
  jobs,
  doors,
}: {
  part: Extract<AgentPart, { kind: typeof AGENT_PART.TOOL }>;
  jobs: WorkerJobs | undefined;
  doors: DelegationDoors | undefined;
}): ReactNode {
  const cards = useLiveDoors(doors)?.cards;
  return <ToolCallView part={part} jobs={jobs} cards={cards} />;
}

function runningStandings(
  standings: ReadonlyMap<string, AgentSubagentStanding> | undefined,
): readonly AgentSubagentStanding[] {
  return [...(standings?.values() ?? [])].filter(
    (standing) => workerToolState(standing.status) === TOOL_STATE.INPUT_AVAILABLE,
  );
}

function workerStarts(
  waits: ReadonlyMap<string, number>,
  standings: ReadonlyMap<string, AgentSubagentStanding>,
): ReadonlyMap<string, number> {
  return new Map([
    ...waits,
    ...runningStandings(standings).map(
      (standing) => [standing.callId, standing.startedAt] as const,
    ),
  ]);
}

function DelegationRow({
  part,
  doors,
}: {
  part: Extract<AgentPart, { kind: typeof AGENT_PART.TOOL }>;
  doors: DelegationDoors | undefined;
}): ReactNode {
  const view = delegationView(part, doors?.own);
  const live = useLiveDoors(doors);
  const onOpen = doors?.onOpen;
  const standing = doors?.standings?.get(part.callId);
  const choice =
    standing === undefined ? view.choice : { model: standing.model, effort: standing.effort };
  const status = standing?.status ?? workerStatusOf(part.state);
  const native = nativeSubagent(part);
  const opens = onOpen !== undefined && !native;
  const call = toolCallView(part);
  const body = native
    ? { input: call.input, output: call.output }
    : opens
      ? undefined
      : {
          input: { kind: TOOL_BLOCK.TEXT, text: view.task },
          output:
            view.result === undefined ? undefined : { kind: TOOL_BLOCK.TEXT, text: view.result },
        };
  return (
    <TranscriptSubagent
      callId={part.callId}
      job={view.title ?? (cardTitle(view.task) || CALL_WORDS[CALL_KIND.WORKER].verb)}
      pair={choice === undefined ? undefined : { choice, models: doors?.models ?? [] }}
      state={standing === undefined ? part.state : workerToolState(standing.status)}
      startedAt={doors?.starts?.get(part.callId)}
      errorText={part.errorText}
      onOpen={opens ? () => onOpen(part.callId, view.task, status) : undefined}
      card={
        opens ? live?.cards?.worker({ callId: part.callId, task: view.task, status }) : undefined
      }
      body={body}
    />
  );
}

function TodosRow({
  part,
  todos,
  live,
}: {
  part: Extract<AgentPart, { kind: typeof AGENT_PART.TOOL }>;
  todos: AgentTodos["todos"] | undefined;
  live: boolean;
}): ReactNode {
  if (todos === undefined) return <ToolCallView part={part} />;
  return (
    <TranscriptTodos
      data-call-id={part.callId}
      state={part.state}
      subject={todosSummary(todos)}
      todos={todos}
      errorText={part.errorText}
      live={live}
    />
  );
}

interface TodosPlace {
  readonly kept: string | undefined;
  readonly live: string | undefined;
  readonly lists: ReadonlyMap<string, AgentTodos["todos"]>;
}

const NO_TODOS: TodosPlace = {
  kept: undefined,
  live: undefined,
  lists: new Map(),
};

function sameTodosPlace(a: TodosPlace | undefined, b: TodosPlace | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.kept === b.kept && a.live === b.live && sameEntries(a.lists, b.lists);
}

function todosPlace(messages: readonly AgentTranscriptMessage[], working: boolean): TodosPlace {
  const lists = taskTodos(messages);
  const standing = newestTodos(messages, lists);
  return {
    kept: standing?.callId,
    live: working ? standing?.callId : undefined,
    lists,
  };
}

function TodosDock({
  messages,
  working,
}: {
  messages: readonly AgentTranscriptMessage[];
  working: boolean;
}): ReactNode {
  const docked = dockedTodos(newestTodos(messages, taskTodos(messages)), working);
  if (docked === undefined) return null;
  return (
    <div className={`agent-todos-dock ${COMPOSER_DOCK_CLASS}`}>
      <TranscriptTodosDock todos={docked.todos} focus={todoFocus(docked.todos)} />
    </div>
  );
}

function PublishedDock({
  published,
  doors,
}: {
  published: AgentPullRequestAnswer | undefined;
  doors: PublishedDoors;
}): ReactNode {
  if (published === undefined || published.pullRequest === null) return null;
  return (
    <div className={`agent-published-dock ${COMPOSER_DOCK_CLASS}`}>
      <PublishedRow pullRequest={published.pullRequest} branch={published.branch} doors={doors} />
    </div>
  );
}

function LoadedSkillView({
  part,
}: {
  part: Extract<AgentPart, { kind: typeof AGENT_PART.TOOL }>;
}): ReactNode {
  const subject = useSkill(loadedSkill(part.input));
  if (subject === undefined || part.state === TOOL_STATE.OUTPUT_ERROR) {
    return <ToolCallView part={part} />;
  }
  return (
    <OpeningCallView
      part={part}
      hint={subject.skill.path ?? skillWord(subject.skill.name)}
      card={<SkillCard subject={subject} />}
      onOpen={subject.onOpen}
    />
  );
}

function OpeningCallView({
  part,
  hint,
  card,
  cards,
  onOpen,
}: {
  part: Extract<AgentPart, { kind: typeof AGENT_PART.TOOL }>;
  hint: string;
  card?: ReactNode;
  cards?: TranscriptCards | undefined;
  onOpen: () => void;
}): ReactNode {
  const view = toolCallView(part);
  const known = useKnownNames();
  return (
    <TranscriptOpeningCall
      callId={part.callId}
      kind={view.kind}
      subject={view.subject}
      agent={calledAgentActor(part, cards, known)}
      state={part.state}
      hint={hint}
      card={card}
      sent={sentWords(part.tool, part.input)}
      onOpen={onOpen}
    />
  );
}

type AgentTarget = Extract<ToolTarget, { readonly kind: typeof TOOL_TARGET.AGENT }>;

function TargetCallView({
  part,
  target,
  doors,
  onOpen,
}: {
  part: Extract<AgentPart, { kind: typeof AGENT_PART.TOOL }>;
  target: AgentTarget;
  doors: DelegationDoors | undefined;
  onOpen: () => void;
}): ReactNode {
  const cards = useLiveDoors(doors)?.cards;
  return (
    <OpeningCallView
      part={part}
      hint={TARGET_HINT[target.kind]}
      card={cards?.target(target, toolCallView(part).subject)}
      cards={cards}
      onOpen={onOpen}
    />
  );
}

const UNTITLED_PAGE = "Page";

function madeLabel(target: ToolTarget, subject: string | undefined, href: string): string {
  const bare = target.kind === TOOL_TARGET.DESCRIPTION || target.kind === TOOL_TARGET.PULL_REQUEST;
  return bare || subject === undefined || subject === "" ? href : subject;
}

function MadeCallView({
  part,
  target,
  doors,
}: {
  part: Extract<AgentPart, { kind: typeof AGENT_PART.TOOL }>;
  target: ToolTarget | undefined;
  doors: DelegationDoors | undefined;
}): ReactNode {
  const mentions = useMentionDoors();
  const standsOn = useLiveDoors(doors)?.cards?.standsOn;
  const agentId = useContext(TranscriptAgent);
  const { kind, subject } = toolCallView(part);
  const holder = mentions.holder ?? standsOn;
  const href =
    target === undefined
      ? undefined
      : targetLink(target, { workspace: mentions.place.workspace, holder, agentId });
  const chip =
    target === undefined || href === undefined
      ? undefined
      : linkChip(href, madeLabel(target, subject, href), mentions);
  const shown = target?.kind === TOOL_TARGET.PAGE ? shownPageVersion(part) : undefined;
  return (
    <>
      <ToolCallView
        part={part}
        jobs={doors?.jobs}
        made={chip === undefined || !isMadeCallKind(kind) ? undefined : { kind, chip }}
      />
      {shown === undefined || holder === undefined ? null : (
        <ShownPage
          place={holder}
          pageId={shown.page}
          version={shown.version}
          title={subject === undefined || subject === "" ? UNTITLED_PAGE : subject}
        />
      )}
    </>
  );
}

function CutToolCallView({
  part,
  cut,
  jobs,
}: {
  part: Extract<AgentPart, { kind: typeof AGENT_PART.TOOL }>;
  cut: AgentPartCut;
  jobs: WorkerJobs | undefined;
}): ReactNode {
  const { callId } = part;
  const isCall = useCallback(
    (read: WireValue) => {
      const whole = agentPart(read);
      return whole.kind === AGENT_PART.TOOL && whole.callId === callId;
    },
    [callId],
  );
  const read = useWholePart(cut, isCall);
  if ("body" in read) return <ToolCallView part={part} jobs={jobs} cut={read.body} />;
  const whole = agentPart(read.part);
  return <ToolCallView part={whole.kind === AGENT_PART.TOOL ? whole : part} jobs={jobs} />;
}

function isThought(read: WireValue): boolean {
  return agentPart(read).kind === AGENT_PART.REASONING;
}

function CutReasoningView({ cut }: { cut: AgentPartCut }): ReactNode {
  const read = useWholePart(cut, isThought);
  if ("body" in read) return <TranscriptReasoning text="" cut={read.body} />;
  const whole = agentPart(read.part);
  return <TranscriptReasoning text={whole.kind === AGENT_PART.REASONING ? whole.text : ""} />;
}

function AgentPartView({
  part,
  delegation,
  todos,
  moving = false,
}: {
  part: AgentPart;
  delegation: DelegationDoors | undefined;
  todos: TodosPlace;
  moving?: boolean;
}): ReactNode {
  switch (part.kind) {
    case AGENT_PART.TEXT:
      return (
        <div {...{ [REPLY_SCOPE]: "" }}>
          <TranscriptWords text={part.text} streaming={moving} />
        </div>
      );
    case AGENT_PART.REASONING:
      return part.cut === undefined ? (
        <TranscriptReasoning text={part.text} />
      ) : (
        <CutReasoningView cut={part.cut} />
      );
    case AGENT_PART.TOOL: {
      if (part.cut !== undefined) {
        return <CutToolCallView part={part} cut={part.cut} jobs={delegation?.jobs} />;
      }
      if (part.tool === AGENT_TOOL.SHOW_IMAGE && part.state !== TOOL_STATE.OUTPUT_ERROR) {
        return <ShownPictures input={part.input} output={part.output} />;
      }
      if (delegates(part)) return <DelegationRow part={part} doors={delegation} />;
      const target = part.state === TOOL_STATE.OUTPUT_ERROR ? undefined : toolTarget(part);
      if (target !== undefined && target.kind !== TOOL_TARGET.AGENT) {
        return <MadeCallView part={part} target={target} doors={delegation} />;
      }
      const openTarget = delegation?.onOpenTarget;
      if (target !== undefined && openTarget !== undefined) {
        return (
          <TargetCallView
            part={part}
            target={target}
            doors={delegation}
            onOpen={() => openTarget(target)}
          />
        );
      }
      if (isTodos(part)) {
        return (
          <TodosRow
            part={part}
            todos={todosOfPart(part, todos.lists)}
            live={part.callId === todos.live}
          />
        );
      }
      return toolCallView(part).kind === CALL_KIND.LOAD_SKILL ? (
        <LoadedSkillView part={part} />
      ) : calledAgent(part) === undefined ? (
        <MadeCallView part={part} target={undefined} doors={delegation} />
      ) : (
        <AgentCallView part={part} jobs={delegation?.jobs} doors={delegation} />
      );
    }
    case AGENT_PART.STEP_START:
    case AGENT_PART.OTHER:
    case AGENT_PART.ARRIVED:
      return null;
  }
}

const SteadyAgentPart = memo(AgentPartView, (a, b) =>
  sameFieldsBy(a, b, { part: (ours, theirs) => sameShape(ours, theirs, 1) }),
);

function OriginBody({ body }: { body: string }): React.JSX.Element {
  return (
    <Fold className="agent-origin-body text-caption-inline">
      <LineSummary brightens>
        <DisclosureChevron />
        <GlyphSlot size={ICON_SIZE.MEDIUM}>
          <WebhookIcon />
        </GlyphSlot>
        {WEBHOOK_BODY_LABEL}
      </LineSummary>
      <FoldBody>
        <CodeCard title={WEBHOOK_BODY_KIND} code={body} copy={copyThroughShell} />
      </FoldBody>
    </Fold>
  );
}

function PlanCard({
  text,
  lead,
  title = cardTitle(text),
  sender,
  sentAt,
  body,
  messageId,
  taskId,
}: {
  text: string;
  lead: TranscriptLead;
  messageId?: string | undefined;
  title?: string | undefined;
  sender?: ReactNode;
  sentAt?: number | undefined;
  body?: string | undefined;
  taskId?: string | undefined;
}): ReactNode {
  const named = sender != null;
  const words = <TranscriptWords text={text} />;
  const listed = useTaskStatus(lead.description ? taskId : undefined);
  const handed = useContext(LiveDoors)?.cards?.task?.status;
  const status = lead.description ? (listed ?? handed) : undefined;
  return (
    <Message from={MESSAGE_ROLE.USER} className="agent-origin" data-message-id={messageId}>
      <Plan data-origin-description="" aria-label={lead.label}>
        <PlanHeader>
          <PlanIcon>
            {status === undefined ? lead.icon : <TaskStatusMark status={status} />}
          </PlanIcon>
          <PlanTitle label={lead.label} previews={title === cardTitle(text)}>
            {title}
          </PlanTitle>
        </PlanHeader>
        <PlanContent>
          {taskId === undefined ? (
            words
          ) : (
            <DescriptionPictures taskId={taskId} text={text}>
              {words}
            </DescriptionPictures>
          )}
          {body === undefined ? null : <OriginBody body={body} />}
        </PlanContent>
      </Plan>
      <MessageLine
        sender={named ? sender : undefined}
        at={sentAt}
        wrap
        actions={<CopyMessageAction words={text} messageId={messageId} />}
      />
    </Message>
  );
}

function TaskRef({ task, onOpen }: { task: BriefTask; onOpen?: (() => void) | undefined }) {
  return (
    <InlineRef
      look={INLINE_REF_LOOK.WASH}
      glyph={
        <GlyphSlot size={ICON_SIZE.MEDIUM} inset>
          <PlanGlyph status={task.status} />
        </GlyphSlot>
      }
      label={task.name}
      onPress={onOpen === undefined ? undefined : () => onOpen()}
      card={task.card}
      data-task-ref=""
    />
  );
}

function TaskSender({
  task,
  onOpen,
  starter,
}: {
  task: BriefTask | undefined;
  onOpen: (() => void) | undefined;
  starter: Actor | undefined;
}): React.JSX.Element {
  const live = useContext(LiveDoors);
  const named = live === undefined ? task : live.cards?.task;
  return (
    <ActorLine>
      {named === undefined ? null : <TaskRef task={named} onOpen={onOpen} />}
      {starter === undefined ? null : (
        <ActorLine>
          {named === undefined ? "Started by " : " · started by "}
          <ActorRef actor={starter} sentence />
        </ActorLine>
      )}
    </ActorLine>
  );
}

function OriginSubject({
  subject,
  openGitHub,
}: {
  subject: NonNullable<AgentOrigin["subject"]>;
  openGitHub: (url: string) => void;
}): React.JSX.Element {
  const doors = useMentionDoors();
  const words =
    subject.title === undefined
      ? `#${subject.number}`
      : pullRequestLabelOf({ number: subject.number, title: subject.title });
  const { url } = subject;
  if (url === undefined)
    return (
      <OneLine className="agent-origin-subject" words={words}>
        {words}
      </OneLine>
    );
  return (
    <ChipOrLink
      href={url}
      words={words}
      doors={doors}
      onOpen={openGitHub}
      frame={CHIP_OR_LINK_FRAME.SUBJECT}
    />
  );
}

function AutomationSender({
  automationId,
  name,
  run,
  openGitHub,
}: {
  automationId: string | undefined;
  name: string | undefined;
  run: AgentOrigin | undefined;
  openGitHub: (url: string) => void;
}): React.JSX.Element {
  const known = useAutomation(automationId);
  const runner = usePerson(run?.runBy);
  const plain =
    automationId === undefined && name !== undefined
      ? `${name} ${DELETED_WORDS}`
      : (name ?? AUTOMATION_WORDS);
  const subject = run?.subject;
  return (
    <ActorLine>
      {known === undefined ? (
        <ActorRef actor={{ kind: ACTOR_KIND.AUTOMATION, name: plain, state: ACTOR_STATE.REST }} />
      ) : (
        <ActorRef
          actor={automationActor(known.automation)}
          card={
            <AutomationCard automation={known.automation} workspaceName={known.workspaceName} />
          }
          onOpen={known.onOpen}
        />
      )}
      {subject === undefined ? null : (
        <ActorLine>
          {" · "}
          <OriginSubject subject={subject} openGitHub={openGitHub} />
        </ActorLine>
      )}
      {run?.runBy === undefined ? null : (
        <ActorLine>
          {" · Run by "}
          <ActorRef actor={runner} sentence />
        </ActorLine>
      )}
    </ActorLine>
  );
}

function agentOrigin(input: {
  agent: AgentSummary;
  run: AgentOrigin | undefined;
  task: BriefTask | undefined;
  onOpenTask: (() => void) | undefined;
  starter: Actor | undefined;
  openGitHub: (url: string) => void;
}): TranscriptOrigin | undefined {
  const { agent, run, task, starter } = input;
  if (agent.automationId !== undefined || agent.automationName !== undefined) {
    return {
      lead: AUTOMATION_LEAD,
      sender: (
        <AutomationSender
          automationId={agent.automationId}
          name={agent.automationName}
          run={run}
          openGitHub={input.openGitHub}
        />
      ),
      text: run?.prompt,
      body: run?.body,
    };
  }
  if (agent.brief === AGENT_BRIEF.PROMPT || agent.brief === AGENT_BRIEF.BLANK) {
    return undefined;
  }
  return {
    sender:
      task === undefined && starter === undefined ? undefined : (
        <TaskSender task={task} onOpen={input.onOpenTask} starter={starter} />
      ),
  };
}

function AutomationLineSender({
  actor,
}: {
  actor: Extract<Actor, { kind: typeof ACTOR_KIND.AUTOMATION }>;
}): React.JSX.Element {
  const known = useAutomation(actor.automationId);
  return known === undefined ? (
    <ActorRef actor={actor} />
  ) : (
    <ActorRef
      actor={automationActor(known.automation)}
      card={<AutomationCard automation={known.automation} workspaceName={known.workspaceName} />}
      onOpen={known.onOpen}
    />
  );
}

function MessageSender({ actor }: { actor: Actor }): React.JSX.Element {
  if (actor.kind === ACTOR_KIND.AUTOMATION) return <AutomationLineSender actor={actor} />;
  return actor.kind === ACTOR_KIND.AGENT && actor.agentId !== undefined ? (
    <SendingAgent actor={actor} agentId={actor.agentId} />
  ) : (
    <ActorRef actor={actor} />
  );
}

const WAKEUP_LEAD = "woke up";

function WakeupHead({ delay }: { delay: number | undefined }): React.JSX.Element {
  return (
    <SubjectLine lead={WAKEUP_LEAD} fit={SUBJECT_FIT.OWN}>
      {delay === undefined ? null : (
        <InlineRef
          look={INLINE_REF_LOOK.PILL}
          glyph={<AlarmClockCheckIcon />}
          label={`${workingTime(delay)} wakeup`}
        />
      )}
    </SubjectLine>
  );
}

export interface ArrivedLine {
  readonly message: AgentTranscriptMessage;
  readonly sender: Actor | undefined;
}

const NO_ARRIVED: readonly ArrivedLine[] = [];

function TurnFoot({ workedFor, copy }: { workedFor: ReactNode; copy: ReactNode }): ReactNode {
  if (workedFor === null && copy === null) return null;
  return (
    <div className="agent-turn-foot mt-tight-gap" data-turn-foot="">
      <MessageLine
        align={MESSAGE_LINE_ALIGN.START}
        inset={MESSAGE_LINE_INSET.FLUSH}
        sender={workedFor}
        actions={copy}
      />
    </div>
  );
}

interface StretchPlace {
  readonly todos: TodosPlace;
  readonly standings: ReadonlyMap<string, AgentSubagentStanding> | undefined;
  readonly arrived: readonly ArrivedLine[];
}

function turnStretchesOf(
  message: AgentTranscriptMessage,
  moving: boolean,
  { todos, standings, arrived }: StretchPlace,
): readonly TurnStretch[] {
  const workers = new Map(
    [...(standings?.values() ?? [])].map(
      (standing) => [standing.callId, workerToolState(standing.status)] as const,
    ),
  );
  return turnStretches(
    agentRows(message, moving, {
      newestTodos: todos.kept,
      workers,
      arrived: arrived.map((line) => line.message),
    }),
  );
}

export function AgentMessage({
  message,
  description,
  lead,
  moving,
  delegation,
  todos = NO_TODOS,
  briefTitle,
  sender,
  origin,
  arrived = NO_ARRIVED,
  wakeupDelay,
  taskId,
  forkable = true,
  forkCut,
  piece,
}: {
  message: AgentTranscriptMessage;
  piece?: TurnPiece | undefined;
  forkable?: boolean;
  forkCut?: ForkCut | undefined;
  description: boolean;
  taskId?: string | undefined;
  origin?: TranscriptOrigin | undefined;
  briefTitle?: string | undefined;
  lead: TranscriptLead;
  moving: boolean;
  delegation: DelegationDoors | undefined;
  todos?: TodosPlace;
  sender?: Actor | undefined;
  arrived?: readonly ArrivedLine[];
  wakeupDelay?: number | undefined;
}): ReactNode {
  const words = messageWords(message);
  const forkOffered = useForkOffered();
  const sending = useLineSending(message.id);
  const marked = useLineMarked(message.id);
  const status = useLineStatus(message.id);
  const editor = useMessageEdit(message.id);
  const editing = useDisclosure(editor !== undefined);
  const lastEditor = useRef(editor);
  if (editor !== undefined) lastEditor.current = editor;
  const drawnEditor = editor ?? (editing.mounted ? lastEditor.current : undefined);
  const doors = useKept(delegation, sameDoors);
  const todosKept = useKept(todos, sameTodosPlace);
  const drawPart = useCallback(
    (part: AgentPart) => (
      <SteadyAgentPart part={part} delegation={doors} todos={todosKept} moving={moving} />
    ),
    [doors, todosKept, moving],
  );
  if (description) {
    return (
      <PlanCard
        text={origin?.text ?? words}
        lead={origin?.lead ?? lead}
        title={briefTitle}
        sender={origin?.sender}
        sentAt={message.sentAt}
        body={origin?.body}
        messageId={message.id}
        taskId={taskId}
      />
    );
  }
  if (agentMessageOf(message) !== undefined) return <AgentMessageRow message={message} />;
  const named = sender === undefined ? null : <MessageSender actor={sender} />;
  const github = githubLineOf(message);
  if (github !== undefined) return <GitHubLineRow message={message} line={github} sender={named} />;
  if (message.role === MESSAGE_ROLE.USER) {
    const sentAt = message.sentAt;
    const thread = threadLineOf(message);
    const comment = commentLineOf(message);
    const slack = slackLineOf(message);
    const shown =
      comment !== undefined
        ? commentLineWords(comment)
        : slack !== undefined
          ? slack.words
          : thread === undefined
            ? words
            : threadLineWords(words, thread.event);
    if (drawnEditor !== undefined) {
      return (
        <Message from={message.role} data-message-id={message.id} data-editing="">
          <div
            ref={editing.ref}
            className="edit-composer origin-top-right animate-edit-composer-in data-leaving:animate-edit-composer-out"
            data-leaving={editing.leaving ? "" : undefined}
            inert={editing.leaving}
          >
            <EditComposer message={message} words={shown} edit={drawnEditor} />
          </div>
        </Message>
      );
    }
    const received = sender !== undefined;
    const threadHead =
      comment !== undefined ? (
        <CommentLineHead line={comment} received={received} fit={SUBJECT_FIT.OWN} />
      ) : slack !== undefined ? (
        <SlackLineHead line={slack} received={received} />
      ) : thread === undefined ? null : (
        <ThreadLineHead line={thread} words={words} received={received} fit={SUBJECT_FIT.OWN} />
      );
    const subject = isWakeupLine(message) ? <WakeupHead delay={wakeupDelay} /> : threadHead;
    const content = (
      <MessageContent>
        <SentToAgent id={message.id} arrived={message.arrivedIn !== undefined}>
          <SentWords text={shown} />
        </SentToAgent>
      </MessageContent>
    );
    return (
      <Message
        from={received ? MESSAGE_ROLE.ASSISTANT : message.role}
        className={received ? RECEIVED_MESSAGE_CLASS : undefined}
        data-message-id={message.id}
        data-undelivered={marked ? "" : undefined}
      >
        {received ? <MessageHead sender={named}>{subject}</MessageHead> : subject}
        <MessageFileChips message={message} sending={sending} />
        {shown === "" ? null : marked ? (
          <MessageBeside mark={<UndeliveredMark messageId={message.id} />}>{content}</MessageBeside>
        ) : (
          content
        )}
        {shown === "" && marked ? (
          <MessageBeside mark={<UndeliveredMark messageId={message.id} />}>{null}</MessageBeside>
        ) : null}
        <MessageLine
          align={received ? MESSAGE_LINE_ALIGN.START : MESSAGE_LINE_ALIGN.END}
          status={status}
          at={sentAt}
          actions={
            <CopyMessageAction
              words={shown}
              copyable={shown !== ""}
              messageId={message.id}
              rewind={
                shown === "" || comment !== undefined || slack !== undefined
                  ? undefined
                  : REWIND_ACTION.EDIT
              }
            />
          }
        />
      </Message>
    );
  }
  const { startedAt, finishedAt } = message;
  const workedFor =
    moving || startedAt === undefined || finishedAt === undefined ? null : (
      <WorkedFor
        startedAt={startedAt}
        endedAt={finishedAt}
        record={message}
        models={delegation?.models}
      />
    );
  const stretches =
    piece?.stretches ??
    turnStretchesOf(message, moving, { todos, standings: delegation?.standings, arrived });
  const first = piece?.first ?? true;
  const last =
    piece?.last === false ? -1 : stretches.findLastIndex((stretch) => stretch.line === undefined);
  const copyable = words !== "" && !moving;
  const forks = forkable && forkCut?.messageSteps !== 0;
  const foot = (
    <TurnFoot
      workedFor={workedFor}
      copy={
        copyable || (forks && forkOffered) ? (
          <CopyMessageAction
            words={words}
            copyable={copyable}
            messageId={message.id}
            forkable={forks}
            forkCut={forkCut}
            rewind={REWIND_ACTION.REVERT}
          />
        ) : null
      }
    />
  );
  return stretches.map((stretch, index) => {
    if (stretch.line !== undefined) {
      const line = stretch.line;
      return (
        <SteadyAgentMessage
          key={line.id}
          message={line}
          description={false}
          lead={lead}
          moving={false}
          delegation={delegation}
          sender={arrived.find((each) => each.message.id === line.id)?.sender}
        />
      );
    }
    const ends = index === last;
    const opens = index === 0 && first;
    return (
      <Message
        key={index === 0 ? message.id : (stretch.rows[0]?.key ?? message.id)}
        from={message.role}
        data-message-id={opens ? message.id : undefined}
      >
        {opens ? named : null}
        <MessageContent>
          <TranscriptRows rows={stretch.rows}>{drawPart}</TranscriptRows>
        </MessageContent>
        {ends ? foot : null}
        {ends ? <ForkedToLine messageId={message.id} /> : null}
      </Message>
    );
  });
}

function AgentEndLine({
  ended,
  endReason,
  keyProvider,
  onOpenApiKeys,
  about,
}: {
  ended: EndLineParts;
  endReason: FailureReason | undefined;
  keyProvider: ModelProvider | undefined;
  onOpenApiKeys: (() => void) | undefined;
  about: FailureAbout;
}): React.JSX.Element {
  const remedy =
    endReason === FAILURE_REASON.API_KEY
      ? remedyLabel({ reason: FAILURE_REASON.API_KEY, text: ended.words, provider: keyProvider })
      : undefined;
  const remedyButton =
    remedy === undefined ? null : (
      <span className="ml-control-gap align-middle">
        <Button variant={BUTTON_VARIANT.OUTLINE} onClick={onOpenApiKeys}>
          {remedy}
        </Button>
      </span>
    );
  if (ended.failed) {
    return (
      <div className={END_LINE_CLASS} data-ended="" data-failed="">
        <FailureNote
          failure={failureShown({
            surface: FAILURE_SURFACE.AGENT_TURN,
            cause:
              (ended.failure === undefined ? undefined : TURN_FAILURE_CAUSE.get(ended.failure)) ??
              FAILURE_CONDITION.UNREAD,
            about,
          })}
          time={FAILURE_NOTE_TIME.PAST}
        >
          {ended.words}
          {remedyButton}
        </FailureNote>
      </div>
    );
  }
  return (
    <NoteLine look={NOTE_LINE_LOOK.INSET} data-ended="">
      <span className="agent-end-words">{ended.words}</span>
      {remedyButton}
    </NoteLine>
  );
}

const END_LINE_CLASS = "agent-end-line m-0 text-caption text-muted-foreground";

function useTurnEndSaid(ended: EndLineParts | undefined, pageRuns: boolean): void {
  const [sawRunning, setSawRunning] = useState(false);
  if (!sawRunning && pageRuns && ended === undefined) setSawRunning(true);
  useAnnounce(ANNOUNCE.POLITE, sawRunning ? (ended?.words ?? "") : "");
}

function AgentEndRow({
  ended,
  endReason,
  keyProvider,
  onOpenApiKeys,
  about,
  press,
  centered = false,
}: {
  ended: EndLineParts;
  endReason: FailureReason | undefined;
  keyProvider: ModelProvider | undefined;
  onOpenApiKeys: (() => void) | undefined;
  about: FailureAbout;
  press: ReactNode;
  centered?: boolean;
}): React.JSX.Element {
  return (
    <div
      className={`agent-end-row flex max-w-full flex-wrap items-center gap-control-gap${centered ? " justify-center" : ""}`}
    >
      <AgentEndLine
        ended={ended}
        endReason={endReason}
        keyProvider={keyProvider}
        onOpenApiKeys={onOpenApiKeys}
        about={about}
      />
      {press}
    </div>
  );
}

type AgentMessageProps = Parameters<typeof AgentMessage>[0];

function useSteady<A extends unknown[]>(
  press: ((...args: A) => void) | undefined,
): ((...args: A) => void) | undefined {
  const latest = useRef(press);
  latest.current = press;
  const steady = useCallback((...args: A) => latest.current?.(...args), []);
  return press === undefined ? undefined : steady;
}

function useKept<T>(value: T, same: (a: T, b: T) => boolean): T {
  const kept = useRef(value);
  if (!same(kept.current, value)) kept.current = value;
  return kept.current;
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

function sameNotes<T>(a: ReadonlyMap<string, T>, b: ReadonlyMap<string, T>): boolean {
  return a.size === b.size && [...a].every(([id, note]) => b.get(id) === note);
}

function sameSet<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const member of a) if (!b.has(member)) return false;
  return true;
}

function sameFields<T extends object>(a: T | undefined, b: T | undefined): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  const ours = Object.entries(a);
  const theirs = new Map(Object.entries(b));
  return (
    ours.length === theirs.size &&
    ours.every(([key, value]) => theirs.has(key) && Object.is(theirs.get(key), value))
  );
}

function sameEntries<V>(
  a: ReadonlyMap<string, V> | undefined,
  b: ReadonlyMap<string, V> | undefined,
): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined || a.size !== b.size) return false;
  for (const [key, value] of a) if (!b.has(key) || !Object.is(b.get(key), value)) return false;
  return true;
}

function sameDoors(a: DelegationDoors | undefined, b: DelegationDoors | undefined): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  return (
    a.models === b.models &&
    sameFields(a.own, b.own) &&
    sameEntries(a.starts, b.starts) &&
    a.onOpen === b.onOpen &&
    a.onOpenTarget === b.onOpenTarget &&
    a.standings === b.standings &&
    a.jobs === b.jobs
  );
}

function sameArrived(
  a: readonly ArrivedLine[] | undefined,
  b: readonly ArrivedLine[] | undefined,
): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined || a.length !== b.length) return false;
  return a.every(
    (line, index) =>
      line.message === b[index]?.message && sameFields(line.sender, b[index]?.sender),
  );
}

function sameMessageDraw(a: AgentMessageProps, b: AgentMessageProps): boolean {
  return sameFieldsBy(a, b, {
    message: (ours, theirs) => ours === theirs || sameHeldPiece(a, b),
    todos: sameTodosPlace,
    forkCut: sameFields,
    sender: sameFields,
    arrived: sameArrived,
    delegation: sameDoors,
  });
}

function sameHeldPiece(a: AgentMessageProps, b: AgentMessageProps): boolean {
  return (
    a.piece !== undefined && a.piece === b.piece && !a.piece.last && a.message.id === b.message.id
  );
}

const SteadyAgentMessage = memo(AgentMessage, sameMessageDraw);

type MessageBringer = (messageId: string, then: (row: HTMLElement) => void) => boolean;

type PlacedRow = PlacedMessage;

const NO_FIND_ROWS: readonly FindRow[] = [];

function drawsMessage(row: PlacedRow, messageId: string): boolean {
  return row.message.id === messageId || row.arrived.some((line) => line.id === messageId);
}

const wordsFound = new WeakMap<AgentTranscriptMessage, string>();

function findWordsOf(message: AgentTranscriptMessage): string {
  const kept = wordsFound.get(message);
  if (kept !== undefined) return kept;
  const words = drawnMessageWords(message);
  wordsFound.set(message, words);
  return words;
}

function findRowOf(row: PlacedRow): FindRow {
  return {
    key: transcriptRowKey(row.message),
    words: [row.message, ...row.arrived].map(findWordsOf).join("\n"),
  };
}

const LOG_ROW_CLASS = "agent-log-row";

interface LogEntry {
  readonly key: string;
  readonly row: PlacedRow;
  readonly index: number;
  readonly piece?: TurnPiece | undefined;
}

function entryDraws(entry: LogEntry, messageId: string): boolean {
  const { piece, row } = entry;
  if (piece === undefined) return drawsMessage(row, messageId);
  const holds = piece.stretches.some((stretch) => stretch.line?.id === messageId);
  return holds || (piece.first && drawsMessage(row, messageId) && !heldElsewhere(row, messageId));
}

function heldElsewhere(row: PlacedRow, messageId: string): boolean {
  return row.arrived.some((line) => line.id === messageId);
}

const pieceWords = new WeakMap<TurnPiece, string>();

function findEntryOf(entry: LogEntry): FindRow {
  const { piece, row } = entry;
  if (piece === undefined) return findRowOf(row);
  let own = pieceWords.get(piece);
  if (own === undefined) {
    own = piece.stretches
      .map((stretch) =>
        stretch.line !== undefined ? findWordsOf(stretch.line) : drawnRowsWords(stretch.rows),
      )
      .join("\n");
    pieceWords.set(piece, own);
  }
  return { key: entry.key, words: own };
}

interface PiecesRead {
  readonly message: AgentTranscriptMessage;
  readonly moving: boolean;
  readonly place: StretchPlace;
  readonly pieces: readonly TurnPiece[];
}

function sameRead(
  read: PiecesRead,
  message: AgentTranscriptMessage,
  moving: boolean,
  place: StretchPlace,
): boolean {
  return (
    read.message === message &&
    read.moving === moving &&
    read.place.todos === place.todos &&
    read.place.standings === place.standings &&
    read.place.arrived === place.arrived
  );
}

function useLogEntries(
  placing: ReturnType<typeof transcriptPlacing>,
  working: boolean,
  standings: ReadonlyMap<string, AgentSubagentStanding> | undefined,
  arrivals: ReadonlyMap<string, readonly ArrivedLine[]>,
): readonly LogEntry[] {
  const reads = useRef(new Map<string, PiecesRead>());
  const todos = useKept(placing.todos, sameTodosPlace);
  return useMemo(() => {
    const held = reads.current;
    const next = new Map<string, PiecesRead>();
    const { placed } = placing;
    const entries = placed.flatMap((row, index): LogEntry[] => {
      const { message } = row;
      const key = transcriptRowKey(message);
      const arrived = arrivals.get(message.id) ?? NO_ARRIVED;
      if (
        message.role !== MESSAGE_ROLE.ASSISTANT ||
        message.parts.length + arrived.length <= PIECE_ROWS * 2
      ) {
        return [{ key, row, index }];
      }
      const moving = working && index === placed.length - 1;
      const place: StretchPlace = { todos, standings, arrived };
      const was = held.get(message.id);
      const read =
        was !== undefined && sameRead(was, message, moving, place)
          ? was
          : {
              message,
              moving,
              place,
              pieces: keptPieces(was?.pieces, turnPieces(turnStretchesOf(message, moving, place))),
            };
      next.set(message.id, read);
      return read.pieces.map((piece, at) => ({ key: pieceKey(key, at), row, index, piece }));
    });
    reads.current = next;
    return entries;
  }, [placing, working, standings, arrivals, todos]);
}

function sameLines(
  a: readonly AgentTranscriptMessage[],
  b: readonly AgentTranscriptMessage[],
): boolean {
  return a === b || (a.length === b.length && a.every((line, index) => line === b[index]));
}

function useArrivals(
  placed: readonly PlacedRow[],
  readerId: string | undefined,
  members: Parameters<typeof lineSender>[2],
  former: Parameters<typeof lineSender>[3],
): ReadonlyMap<string, readonly ArrivedLine[]> {
  const kept = useRef<{
    readonly by: readonly unknown[];
    readonly named: WeakMap<
      AgentTranscriptMessage,
      {
        readonly lines: readonly AgentTranscriptMessage[];
        readonly arrived: readonly ArrivedLine[];
      }
    >;
  }>(undefined);
  return useMemo(() => {
    const by = [readerId, members, former];
    if (kept.current === undefined || !kept.current.by.every((each, at) => each === by[at])) {
      kept.current = { by, named: new WeakMap() };
    }
    const { named } = kept.current;
    return new Map(
      placed.map(({ message, arrived }) => {
        const was = named.get(message);
        if (was !== undefined && sameLines(was.lines, arrived)) return [message.id, was.arrived];
        const lines =
          arrived.length === 0
            ? NO_ARRIVED
            : arrived.map((line) => ({
                message: line,
                sender: messageSender(line, readerId, members, former),
              }));
        named.set(message, { lines: arrived, arrived: lines });
        return [message.id, lines];
      }),
    );
  }, [placed, readerId, members, former]);
}

function useReplySaid({
  messages,
  status,
  name,
  tab,
}: {
  messages: readonly AgentTranscriptMessage[];
  status: AgentStatus | undefined;
  name: string;
  tab: RefObject<HTMLElement | null>;
}): void {
  const writing = useRef<boolean | undefined>(undefined);
  const said = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (status === undefined) return;
    const was = writing.current;
    writing.current = agentStillWriting(status);
    if (was !== true || status !== AGENT_STATUS.COMPLETED) return;
    const reply = finishedReplyLead(messages);
    if (reply === undefined || reply.messageId === said.current) return;
    said.current = reply.messageId;
    const log = tab.current?.querySelector('[role="log"]');
    const reading = log?.contains(document.activeElement) === true;
    announce(ANNOUNCE.POLITE, replyFromWords(name, reading ? undefined : reply.lead));
  }, [messages, status, name, tab]);
}

function transcriptPlacing(
  messages: readonly AgentTranscriptMessage[],
  working: boolean,
  undelivered: ReadonlySet<string>,
  unsent: ReadonlySet<string>,
  replayed: boolean,
) {
  const todos = todosPlace(messages, working);
  const first = messages.find(
    (message) =>
      message.role === MESSAGE_ROLE.USER &&
      agentMessageOf(message) === undefined &&
      !undelivered.has(message.id),
  );
  const opening = !replayed || first === undefined ? undefined : replayOpening(first);
  const placed = placedMessages(messages, (id) => undelivered.has(id) || unsent.has(id));
  const open = openReply(messages, working);
  return { todos, first, opening, placed, open };
}

function AgentTranscriptView({
  messages,
  brief,
  lead = AGENT_LEAD,
  delegation,
  reading,
  failed,
  failedWith,
  working,
  pageRuns = false,
  sessionStarting = false,
  starting,
  rewindOut = false,
  startedAt,
  ended,
  endReason = FAILURE_REASON.OTHER,
  keyProvider,
  onOpenApiKeys,
  onRetry,
  onOlder,
  olderFailed = false,
  overComposer = false,
  earlierOmitted = false,
  briefTitle,
  briefSender,
  origin,
  readerId,
  agentId,
  taskId,
  failureAbout,
  replay,
  endPress,
  endTrail,
  signIn,
  bringIn,
  holding = false,
}: {
  messages: readonly AgentTranscriptMessage[];
  holding?: boolean;
  bringIn?: RefObject<MessageBringer | undefined> | undefined;
  brief?: AgentBrief | undefined;
  lead?: TranscriptLead;
  delegation?: DelegationDoors | undefined;
  reading: boolean;
  failed: boolean;
  failedWith?: unknown;
  working: boolean;
  pageRuns?: boolean;
  sessionStarting?: boolean;
  starting?: StartingLaunch | undefined;
  rewindOut?: boolean;
  startedAt?: number | undefined;
  ended?: EndLineParts | undefined;
  endReason?: FailureReason;
  keyProvider?: ModelProvider | undefined;
  onOpenApiKeys?: (() => void) | undefined;
  onRetry: () => void;
  onOlder?: (() => void) | undefined;
  olderFailed?: boolean;
  overComposer?: boolean;
  earlierOmitted?: boolean;
  briefTitle?: string | undefined;
  briefSender?: Actor | undefined;
  origin?: TranscriptOrigin | undefined;
  readerId?: string | undefined;
  agentId?: string | undefined;
  taskId?: string | undefined;
  failureAbout?: FailureAbout | undefined;
  replay?: ReplayPlace | undefined;
  endPress?: ReactNode;
  endTrail?: ReactNode;
  signIn?: GitHubSignInDoors | undefined;
}): React.JSX.Element {
  const connected = useConnected();
  const { members, former } = useMemberDirectory();
  const undelivered = useUndeliveredLines();
  const unsent = useUnsentLines();
  useTurnEndSaid(ended, pageRuns);
  const signInCard =
    ended?.unstarted === DEVICE_LAUNCH_UNSTARTED.GITHUB_SIGN_IN && signIn !== undefined ? (
      <div className="agent-sign-in self-stretch">
        <GitHubSignInCard {...signIn} />
      </div>
    ) : undefined;
  const replayed = replay !== undefined;
  const placing = useMemo(
    () => transcriptPlacing(messages, working, undelivered, unsent, replayed),
    [messages, working, undelivered, unsent, replayed],
  );
  const arrivals = useArrivals(placing.placed, readerId, members, former);
  const cards = delegation?.cards;
  const live = useMemo(() => ({ cards }), [cards]);
  const callsServer = useMemo(
    () =>
      messages.some((message) =>
        agentParts(message).some(
          (part) => part.kind === AGENT_PART.TOOL && isServerCallTool(part.tool),
        ),
      ),
    [messages],
  );
  const entries = useLogEntries(placing, working, delegation?.standings, arrivals);
  const rowKeys = useKept(
    entries.map((entry) => entry.key),
    sameIds,
  );
  const log = useRef<HTMLDivElement>(null);
  const rowsHandle = useRef<VirtualRowsHandle>(null);
  const finding = useFindOpen();
  const findRows = useMemo(
    () => (finding ? entries.map(findEntryOf) : NO_FIND_ROWS),
    [finding, entries],
  );
  const rowClassOf = useCallback(
    (index: number) => {
      if (index === 0) return LOG_ROW_CLASS;
      return entries[index]?.piece?.continues === true
        ? `${LOG_ROW_CLASS} agent-log-row-continued`
        : `${LOG_ROW_CLASS} agent-log-row-next`;
    },
    [entries],
  );
  useVirtualFind({
    root: log,
    rows: findRows,
    handle: rowsHandle,
    findable: rowKeys.length > 0,
  });
  useLayoutEffect(() => {
    if (bringIn === undefined) return;
    bringIn.current = (messageId, then) => {
      const entry = entries.find((each) => entryDraws(each, messageId));
      return entry !== undefined && rowsHandle.current?.bringIn(entry.key, then) === true;
    };
  });
  if (!holding && messages.length > 0) {
    const { todos, first, opening, placed, open } = placing;
    const blank = brief === AGENT_BRIEF.BLANK && origin === undefined;
    const carded = !blank && (brief !== AGENT_BRIEF.PROMPT || origin !== undefined);
    const description = carded ? first : undefined;
    const task = carded || blank ? undefined : first;
    return (
      <TranscriptAgent value={agentId}>
        <LiveDoors value={live}>
          <ConnectionNames needed={callsServer}>
            <Conversation list={log} onNearTop={onOlder}>
              {olderFailed && onOlder !== undefined ? (
                <div
                  className={`${FLOATING_OVER_LOG_CLASS} top-ui-8 z-1 max-w-conversation-older bg-well px-list-inset py-tight-gap`}
                >
                  <ErrorState
                    failure={unreadShown(FAILURE_SURFACE.AGENT_TRANSCRIPT_OLDER_READ)}
                    onRetry={onOlder}
                  >
                    {OLDER_FAILED_LINE}
                  </ErrorState>
                </div>
              ) : null}
              <ConversationContent
                className={overComposer ? LOG_OVER_COMPOSER_CLASS : undefined}
                streams
              >
                <ConversationRows
                  keys={rowKeys}
                  estimate={ROW_ESTIMATE_PX}
                  gap={0}
                  rowClassName={rowClassOf}
                  handle={rowsHandle}
                >
                  {(at) => {
                    const entry = entries[at];
                    if (entry === undefined) return null;
                    const { row, index, piece } = entry;
                    const { message } = row;
                    const tails = piece === undefined || piece.last;
                    return (
                      <>
                        <SteadyAgentMessage
                          message={
                            message === first && opening !== undefined ? opening.brief : message
                          }
                          description={message === description}
                          taskId={message === description ? taskId : undefined}
                          lead={lead}
                          moving={working && index === placed.length - 1}
                          forkCut={forkCutOf(message, open)}
                          delegation={delegation}
                          todos={todos}
                          briefTitle={briefTitle}
                          origin={message === description ? origin : undefined}
                          sender={
                            message === task
                              ? briefSender
                              : messageSender(message, readerId, members, former)
                          }
                          wakeupDelay={
                            isWakeupLine(message)
                              ? wakeupDelayOf(placed[index - 1]?.message)
                              : undefined
                          }
                          arrived={arrivals.get(message.id) ?? NO_ARRIVED}
                          piece={piece}
                        />
                        {!tails ? null : message === first &&
                          opening !== undefined &&
                          replay !== undefined ? (
                          <>
                            <ReplayCard
                              replay={opening.replay}
                              sentAt={first.sentAt}
                              place={replay}
                              taskId={taskId}
                            />
                            {opening.note === undefined ? null : (
                              <SteadyAgentMessage
                                message={opening.note}
                                description={false}
                                lead={lead}
                                moving={false}
                                delegation={delegation}
                                sender={briefSender}
                              />
                            )}
                          </>
                        ) : null}
                        {earlierOmitted && message === description ? (
                          <TranscriptNote>Earlier steps are not shown.</TranscriptNote>
                        ) : null}
                      </>
                    );
                  }}
                </ConversationRows>
                {working ? (
                  <WorkingLine
                    startedAt={startedAt}
                    words={workingLineWords(
                      agentWorkingPhase(messages, sessionStarting, rewindOut),
                      starting,
                    )}
                  />
                ) : null}
                {ended === undefined && endTrail === undefined ? null : (
                  <div
                    className="agent-end flex flex-col items-start gap-control-gap"
                    data-ended={ended === undefined ? undefined : ""}
                  >
                    {ended === undefined
                      ? null
                      : (signInCard ?? (
                          <AgentEndRow
                            ended={ended}
                            endReason={endReason}
                            keyProvider={keyProvider}
                            onOpenApiKeys={onOpenApiKeys}
                            about={failureAbout ?? { agentId, taskId }}
                            press={endPress}
                          />
                        ))}
                    {endTrail}
                  </div>
                )}
                {failed && connected ? (
                  <ErrorState
                    failure={failureShown({
                      surface: FAILURE_SURFACE.AGENT_TRANSCRIPT_READ,
                      cause: failedWith ?? FAILURE_CONDITION.UNREAD,
                      about: { agentId },
                    })}
                    onRetry={onRetry}
                  >
                    {TRANSCRIPT_FAILED_LINE}
                  </ErrorState>
                ) : null}
              </ConversationContent>
              <ConversationScrollButton />
            </Conversation>
          </ConnectionNames>
        </LiveDoors>
      </TranscriptAgent>
    );
  }
  if (failed) {
    return (
      <ErrorState
        failure={failureShown({
          surface: FAILURE_SURFACE.AGENT_TRANSCRIPT_READ,
          cause: failedWith ?? FAILURE_CONDITION.UNREAD,
          about: { agentId },
        })}
        onRetry={onRetry}
        placement={ERROR_STATE_PLACEMENT.CENTERED}
      >
        {TRANSCRIPT_FAILED_LINE}
      </ErrorState>
    );
  }
  if (holding || (reading && ended === undefined)) return <TranscriptSkeleton />;
  return (
    <ConversationEmptyState wide>
      {
        <>
          {ended === undefined ? (
            <Text tone={TEXT_TONE.MUTED}>{lead.startingLine}</Text>
          ) : signInCard !== undefined ? (
            signInCard
          ) : (
            <AgentEndRow
              ended={ended}
              endReason={endReason}
              keyProvider={keyProvider}
              onOpenApiKeys={onOpenApiKeys}
              about={failureAbout ?? { agentId, taskId }}
              press={endPress}
              centered
            />
          )}
          {endTrail}
        </>
      }
    </ConversationEmptyState>
  );
}

function AgentTabView({
  agent,
  models,
  modelsFailed,
  readModels,
  transcript,
  composer,
  model,
  servers,
  published,
  threads,
  doors,
  startedAt,
  counts,
  delegationStarts,
  onStop,
  onUnarchive,
  onOpenSubagent,
  onOpenTarget,
  cards,
  openGitHub,
  onOpenApiKeys,
  keywords,
  skills,
  starter,
  readerId,
  run,
  replay,
  endPress,
  endTrail,
  closedRemedy,
  continuedNote,
  pilotNote,
  continuable = false,
  onMoveToCloud,
  bringIn,
  holding = false,
}: {
  agent: AgentSummary;
  holding?: boolean;
  bringIn?: RefObject<MessageBringer | undefined> | undefined;
  replay?: ReplayPlace | undefined;
  run?: AgentOrigin | undefined;
  models: readonly CatalogModel[] | undefined;
  modelsFailed: boolean;
  readModels: () => void;
  transcript: AgentTranscriptControl;
  composer: HeldComposer;
  model: AgentModelControl;
  servers: AgentServersControl;
  published: AgentPullRequestAnswer | undefined;
  threads?: AgentThreads | undefined;
  doors: PublishedDoors;
  startedAt: number | undefined;
  counts: boolean;
  delegationStarts: ReadonlyMap<string, number> | undefined;
  onStop: () => Promise<boolean>;
  onUnarchive?: (() => void | Promise<void>) | undefined;
  onOpenSubagent?: DelegationDoors["onOpen"];
  onOpenTarget?: DelegationDoors["onOpenTarget"];
  cards?: TranscriptCards | undefined;
  openGitHub: (url: string) => void;
  onOpenApiKeys?: ((provider: ModelProvider | undefined) => void) | undefined;
  keywords?: readonly string[] | undefined;
  skills?: SkillSource | undefined;
  starter?: string | undefined;
  readerId?: string | undefined;
  endPress?: ReactNode;
  endTrail?: ReactNode;
  closedRemedy?: ReactNode;
  continuedNote?: ReactNode;
  pilotNote?: ReactNode;
  continuable?: boolean;
  onMoveToCloud?: (() => void) | undefined;
}): React.JSX.Element {
  const { cut } = composer;
  const kept = useMemo(
    () =>
      cut === undefined
        ? transcript.messages
        : transcript.messages.filter((message) => !cut.has(message.id)),
    [transcript.messages, cut],
  );
  const lines = useMemo(() => agentLines(kept, composer.sent), [kept, composer.sent]);
  const queue = useAgentQueue(agent.id, transcript.queue);
  const pictures = useAgentPictureDoor(agent.id);
  const queueEditing = useQueueEditing(composer, queue, pictures);
  const enterQueues = useQuery({ ...appStateQuery, select: selectEnterQueues }).data === true;
  const controlsQueue = starter === undefined;
  const boxOpen =
    pilotNote === undefined &&
    onUnarchive === undefined &&
    continuedNote === undefined &&
    composer.closed === undefined;
  const onEdit = useSteady(boxOpen ? composer.edit : undefined);
  const onCancelEdit = useSteady(composer.dropEdit);
  const onSendEdit = useSteady(boxOpen ? composer.sendEdit : undefined);
  const onRevert = useSteady(boxOpen ? composer.revert : undefined);
  const pending = composer.sent.length > 0;
  const going = useKept(composer.going, sameSet);
  const points = useKept(
    useMemo(() => rewindPoints(kept, pending, readerId, going), [kept, pending, readerId, going]),
    (a, b) =>
      sameSet(a.editable, b.editable) &&
      sameEntries(a.revertsAt, b.revertsAt) &&
      sameSet(a.followed, b.followed) &&
      sameEntries(a.revertTakes, b.revertTakes) &&
      sameEntries(a.editTakes, b.editTakes),
  );
  const editorNow = { agentId: agent.id, doors, keywords, skills };
  const editorProps = useRef(editorNow);
  editorProps.current = editorNow;
  const editor = useCallback(() => editorProps.current, []);
  const rewind = useMemo(
    () =>
      onEdit === undefined ||
      onCancelEdit === undefined ||
      onSendEdit === undefined ||
      onRevert === undefined
        ? undefined
        : {
            editing: composer.editing,
            onEdit,
            onCancelEdit,
            onSendEdit,
            onRevert,
            editor,
            ...points,
          },
    [composer.editing, onEdit, onCancelEdit, onSendEdit, onRevert, points, editor],
  );
  const lineGoing = composer.sent.some((line) => line.state === SENT_LINE_STATE.PENDING);
  const pageRuns = transcript.pageStatus !== undefined && agentStillWriting(transcript.pageStatus);
  const working = agentStillWriting(agent.status) || pageRuns || lineGoing;
  const signIn: GitHubSignInDoors | undefined =
    pilotNote === undefined &&
    onUnarchive === undefined &&
    continuedNote === undefined &&
    composer.closed === undefined
      ? {
          host: agent.mac?.name,
          repository: published?.repository ?? undefined,
          onRetry: () => composer.sendWords(RETRY_LINE),
          onMoveToCloud,
          copy: copyThroughShell,
        }
      : undefined;
  const name = agentName(agent, models);
  const keyProvider = providerOf(agent.model);
  const tab = useRef<HTMLElement>(null);
  useReplySaid({
    messages: transcript.messages,
    status: transcript.pageStatus,
    name,
    tab,
  });
  const steering = useKept(
    new Set(composer.sent.filter((line) => line.steers).map((line) => line.id)),
    sameSet,
  );
  const undelivered = useKept(
    new Set(
      composer.sent
        .filter((line) => line.state === SENT_LINE_STATE.UNDELIVERED)
        .map((line) => line.id),
    ),
    sameSet,
  );
  const unsent = useKept(
    new Set(
      composer.sent.filter((line) => line.state === SENT_LINE_STATE.FAILED).map((line) => line.id),
    ),
    sameSet,
  );
  const sending = useKept(
    new Set(
      composer.sent.filter((line) => line.state === SENT_LINE_STATE.PENDING).map((line) => line.id),
    ),
    sameSet,
  );
  const retryLine = useSteady(composer.retryLine);
  const takeBackLine = useSteady(composer.takeBackLine);
  const dropLine = useSteady(composer.dropLine);
  const failedNotes = useKept(composer.failedNotes, sameNotes);
  const marks = useMemo(
    () => ({
      undelivered,
      closed: composer.closed,
      unsent,
      notes: failedNotes,
      sending,
      retry: (id: string) => retryLine?.(id),
      takeBack: (id: string) => takeBackLine?.(id),
      drop: (id: string) => dropLine?.(id),
    }),
    [undelivered, composer.closed, unsent, failedNotes, sending, retryLine, takeBackLine, dropLine],
  );
  const starterActor = usePerson(agent.startedBy);
  const wholeParts = useWholePartDoor(agent.id);
  const { members, former } = useMemberDirectory();
  const replyDoor = useRef<((words: string) => void) | undefined>(undefined);
  const replyThroughBox = useCallback((words: string) => replyDoor.current?.(words), []);
  const replies =
    pilotNote === undefined &&
    onUnarchive === undefined &&
    continuedNote === undefined &&
    composer.closed === undefined &&
    !composer.sending;
  const macOwner = useKept(macOwnerOf(agent.startedBy, members, readerId, former), sameFields);
  const disabledServers = servers.disabled;
  const mentioned = useMemo(
    () => ({ disabled: disabledServers, steering }),
    [disabledServers, steering],
  );
  const openSubagent = useSteady(onOpenSubagent);
  const openTarget = useSteady(onOpenTarget);
  const steadyGitHub = useSteady(openGitHub) ?? openGitHub;
  const briefed = replay === undefined ? agent : briefAgent(agent, replay.agents);
  const { automationId, automationName, brief } = briefed;
  const briefTask = cards?.task;
  const tasked = briefTask !== undefined;
  const originStarter = useKept(starter === undefined ? undefined : starterActor, sameFields);
  const origin = useMemo(
    () =>
      agentOrigin({
        agent: briefed,
        run,
        task: briefTask,
        onOpenTask: openTarget === undefined ? undefined : () => openTarget(TASK_TARGET),
        starter: originStarter,
        openGitHub: steadyGitHub,
      }),
    [automationId, automationName, brief, run, tasked, openTarget, originStarter, steadyGitHub],
  );
  const automationLines = useMemo(
    () =>
      lines.some(
        (line) =>
          line.sentBy?.kind === AGENT_SENDER.AUTOMATION && line.sentBy.automationId !== undefined,
      ),
    [lines],
  );
  return (
    <AgentTabFrame ref={tab} label={name}>
      <MacOwnerProvider value={macOwner}>
        <AgentPicturesProvider value={pictures}>
          <WholePartsProvider value={wholeParts}>
            <MentionedServers value={mentioned}>
              <UndeliveredLines value={marks}>
                <RewindProvider value={rewind}>
                  <ReplyDoorProvider value={replies ? replyThroughBox : undefined}>
                    <AutomationsWanted wanted={automationLines}>
                      <AgentTranscriptView
                        messages={lines}
                        brief={agent.brief}
                        briefSender={starter === undefined ? undefined : starterActor}
                        origin={origin}
                        readerId={readerId}
                        agentId={agent.id}
                        taskId={agent.planId ?? undefined}
                        replay={replay}
                        delegation={{
                          models,
                          own: { model: agent.model, effort: agent.effort },
                          starts:
                            delegationStarts &&
                            workerStarts(delegationStarts, transcript.subagents),
                          onOpen: openSubagent,
                          onOpenTarget: openTarget,
                          cards,
                          standings: transcript.subagents,
                        }}
                        reading={transcript.reading || holding}
                        holding={holding}
                        failed={transcript.failed}
                        failedWith={transcript.failedWith}
                        working={working || composer.rewinding}
                        pageRuns={pageRuns}
                        rewindOut={composer.rewindOut}
                        sessionStarting={agent.status === AGENT_STATUS.STARTING}
                        starting={
                          transcript.launch === undefined
                            ? undefined
                            : {
                                launch: transcript.launch,
                                host: agent.mac?.name,
                                runtime: agent.runtime,
                              }
                        }
                        startedAt={
                          !counts
                            ? undefined
                            : composer.rewinding
                              ? composer.rewoundAt
                              : (agentWorkingSince(lines) ?? startedAt)
                        }
                        ended={
                          transcript.pages === 0 ||
                          transcript.pageStatus === undefined ||
                          agentStillWriting(transcript.pageStatus) ||
                          lineGoing
                            ? undefined
                            : endLineParts(
                                agent.status,
                                transcript.failure,
                                starter,
                                continuable,
                                transcript.hostLost,
                                transcript.launchStopped === undefined
                                  ? undefined
                                  : {
                                      step: transcript.launchStopped,
                                      runtime: agent.runtime,
                                      unstarted: transcript.launchUnstarted,
                                    },
                              )
                        }
                        endReason={endLineReason(transcript.failure, starter)}
                        keyProvider={keyProvider}
                        onOpenApiKeys={
                          onOpenApiKeys === undefined ? undefined : () => onOpenApiKeys(keyProvider)
                        }
                        endPress={endPress}
                        endTrail={endTrail}
                        signIn={signIn}
                        onRetry={transcript.onRetry}
                        onOlder={transcript.hasOlder ? transcript.loadOlder : undefined}
                        olderFailed={transcript.olderFailed}
                        overComposer
                        bringIn={bringIn}
                      />
                    </AutomationsWanted>
                  </ReplyDoorProvider>
                </RewindProvider>
              </UndeliveredLines>
            </MentionedServers>
          </WholePartsProvider>
        </AgentPicturesProvider>
      </MacOwnerProvider>
      <AgentTabFoot>
        <TodosDock messages={lines} working={working} />
        <PublishedDock published={published} doors={doors} />
        <ThreadsDock threads={threads} />
        <AgentPicturesProvider value={pictures}>
          <AgentQueueDock
            messages={queue.messages}
            controls={controlsQueue}
            paused={queue.paused}
            editing={queueEditing.editing}
            onMove={queue.move}
            onSteer={(message) =>
              queue.change({ change: QUEUE_CHANGE.STEER, messageId: message.id })
            }
            onEdit={queueEditing.edit}
            onCancelEdit={queueEditing.cancelRow}
            onDelete={queue.remove}
            onResume={() => queue.change({ change: QUEUE_CHANGE.RESUME })}
          />
        </AgentPicturesProvider>
        {pilotNote !== undefined ? (
          pilotNote
        ) : onUnarchive !== undefined ? (
          <ArchivedComposerNote
            onUnarchive={onUnarchive}
            stop={offersStop(agent) ? onStop : undefined}
            archivedBy={
              agent.archivedAt === undefined || agent.archivedBy === undefined
                ? undefined
                : archivedByReading(agent.archivedBy, readerId)
            }
          />
        ) : continuedNote !== undefined ? (
          continuedNote
        ) : (
          <AgentComposer
            agentId={agent.id}
            status={agent.status}
            stoppable={offersStop(agent)}
            composer={composer}
            model={model}
            models={models}
            modelsFailed={modelsFailed}
            readModels={readModels}
            usage={transcript.usage}
            payer={transcript.payer}
            servers={servers}
            context={transcript.context}
            brief={agent.brief}
            published={published}
            doors={doors}
            tools={(narrow) => (
              <>
                <AgentPlace agent={agent} narrow={narrow} />
                <AgentForward agent={agent} narrow={narrow} />
              </>
            )}
            onStop={onStop}
            followsUp
            keywords={keywords}
            skills={skills}
            replyDoor={replyDoor}
            closedRemedy={closedRemedy}
            queueing={
              agent.runtime === undefined || !controlsQueue
                ? undefined
                : {
                    working,
                    enterQueues,
                    onQueue: queueEditing.queue,
                    editing: queueEditing.editing !== undefined,
                    onSave: queueEditing.save,
                    onSteer: queueEditing.steer,
                    onCancel: queueEditing.cancel,
                  }
            }
          />
        )}
      </AgentTabFoot>
      {replies ? <ReplyToSelection scope={tab} onReply={replyThroughBox} /> : null}
    </AgentTabFrame>
  );
}

interface AgentTabDoors {
  run?: AgentOrigin | undefined;
  threads?: AgentThreads | undefined;
  control: AgentsControl;
  shown: boolean;
  onOpenSubagent: (callId: string, task: string, status: AgentStatus) => void;
  onOpenTarget?: DelegationDoors["onOpenTarget"];
  cards?: TranscriptCards | undefined;
  onOpenPullRequest?: (() => void) | undefined;
  onHeld: (agentId: string, held: HeldTranscript) => void;
}

type AgentTabProps = AgentTabDoors &
  (
    | { agent: AgentSummary; agentId?: undefined }
    | { agent: AgentSummary | undefined; agentId: string }
  );

const NO_RETRY = () => undefined;

export function StartingAgentTab({
  line,
  model,
}: {
  line?: SentLine | undefined;
  model?: ComposerModel | undefined;
}): React.JSX.Element {
  const messages = useMemo(() => (line === undefined ? [] : agentLines([], [line])), [line]);
  return (
    <AgentTabFrame>
      <AgentTranscriptView
        messages={messages}
        brief={line === undefined ? AGENT_BRIEF.DESCRIPTION : AGENT_BRIEF.PROMPT}
        reading={false}
        failed={false}
        working
        sessionStarting
        startedAt={line?.sentAt}
        onRetry={NO_RETRY}
        overComposer
      />
      <AgentTabFoot>
        <ComposerSkeleton model={model} />
      </AgentTabFoot>
    </AgentTabFrame>
  );
}

export function AgentTab(props: AgentTabProps): React.JSX.Element {
  const { agent, control, shown, onHeld, agentId: _agentId, ...rest } = props;
  const agentId = props.agentId === undefined ? props.agent.id : props.agentId;
  const transcript = useAgentTranscript({
    transcript: useMemo(() => ({ kind: TRANSCRIPT_KIND.AGENT, agentId }), [agentId]),
    shown,
  });
  const { messages, pageStatus, runStartedAt, subagentTitles } = transcript;
  useEffect(() => {
    if (pageStatus === undefined || messages.length === 0) return;
    const status = pageStatus;
    onHeld(agentId, { messages, status, runStartedAt, title: undefined, subagentTitles });
  }, [onHeld, agentId, messages, pageStatus, runStartedAt, subagentTitles]);
  if (agent === undefined) return <AgentTabSkeleton />;
  return (
    <AgentTabBody {...rest} agent={agent} control={control} shown={shown} transcript={transcript} />
  );
}

function AgentTabBody({
  agent,
  control,
  shown,
  transcript,
  onOpenSubagent,
  onOpenPullRequest,
  onOpenTarget,
  cards,
  run,
  threads,
}: Omit<AgentTabDoors, "onHeld"> & {
  agent: AgentSummary;
  transcript: AgentTranscriptControl;
}): React.JSX.Element {
  const { messages } = transcript;
  const starter = teammateStarter(agent.startedBy, control.me);
  const composer = useAgentComposer({
    agentId: agent.id,
    taskId: agent.planId,
    messages: transcript.messages,
    running: agent.status === AGENT_STATUS.RUNNING,
    send: control.onMessage,
    rewind: control.onRewind,
    payer: planPayerOf(agent.runtime),
    starter,
    shown,
    onOpen:
      onOpenTarget === undefined
        ? undefined
        : () => onOpenTarget({ kind: TOOL_TARGET.AGENT, agent: agent.id }),
  });
  const model = useAgentModel({ agent, choose: control.onChoose });
  const servers = useAgentServers({
    agent,
    write: control.onSwitchServers,
    onOpenSettings: control.onOpenIntegrations,
    me: control.me,
  });
  const { published } = useAgentPullRequest({
    agentId: agent.id,
    shown,
    known: control.pullRequests.get(agent.id),
  });
  const moveToCloud = useMoveToCloud(agent, control);
  const surroundsLanded = messages.length > 0;
  const opening = unreadOpeningLine(
    control.opening?.agentId === agent.id ? control.opening.line : undefined,
    messages,
  );
  const sent = useMemo(
    () => (opening === undefined ? composer.sent : [opening, ...composer.sent]),
    [opening, composer.sent],
  );
  const opened = useRef(false);
  if (surroundsLanded || opening !== undefined) opened.current = true;
  const holding = messages.length > 0 && !opened.current;
  const copyWithToast = useCopyToast();
  const openGitHub = (url: string) => appPlatform().openGitHub(url);
  const toast = useToast();
  const bringIn = useRef<MessageBringer | undefined>(undefined);
  useMessageReveal({
    agentId: agent.id,
    shown,
    caughtUp: transcript.caughtUp,
    whole: !transcript.hasOlder,
    olderFailed: transcript.olderFailed,
    loadOlder: transcript.loadOlder,
    pages: transcript.pages,
    settled: !agentStillWriting(agent.status),
    drawn: (messageId) => messages.some((message) => message.id === messageId),
    bringIn: (messageId, then) => bringIn.current?.(messageId, then) === true,
    gone: () =>
      toast({
        replayUnmasked: true,
        words: MESSAGE_GONE,
        tone: STATUS_TONE.DANGER,
        hold: TOAST_HOLD.FAILED,
        failure: {
          surface: FAILURE_SURFACE.MESSAGE_REVEAL,
          cause: FAILURE_CONDITION.GONE,
          about: { agentId: agent.id },
          refused: true,
        },
      }),
  });
  const openAgent =
    onOpenTarget === undefined
      ? undefined
      : (agentId: string) => onOpenTarget({ kind: TOOL_TARGET.AGENT, agent: agentId });
  const pilot = agent.startedByPilot;
  const reportsTo = pilotTarget(agent);
  const continued = continuedByIds(agent, control.agents, control.archived);
  const continuedDoors = {
    agentIds: continued,
    titles: continuedByTitles(agent),
    control,
    onOpenAgent: openAgent,
  };
  const carry = {
    words: composer.unsent.words,
    attachments: composer.unsent.attachments,
    taskId: agent.planId,
  };
  const continues = offersContinue(control.mode, agent);
  const pressed = endLineOffersContinue({
    status: agent.status,
    endReason: endLineReason(transcript.failure, starter),
    failure: transcript.failure,
    continued: continued.length > 0,
    boxClosed: composer.closed !== undefined,
  });
  const readIds = useKept(
    messages.map((message) => message.id),
    sameIds,
  );
  const messagePlace = useMemo(
    () =>
      agentMessagePlace(
        agent.id,
        readIds.map((id) => ({ id })),
      ),
    [agent.id, readIds],
  );
  return (
    <MessagePlaceProvider value={messagePlace}>
      <AgentTabView
        agent={agent}
        bringIn={bringIn}
        holding={holding}
        models={control.models}
        modelsFailed={control.modelsFailed}
        readModels={control.readModels}
        transcript={transcript}
        composer={sent === composer.sent ? composer : { ...composer, sent }}
        model={model}
        servers={servers}
        published={published}
        threads={threads}
        doors={{
          openGitHub,
          copy: copyWithToast,
          openPullRequest: onOpenPullRequest,
        }}
        startedAt={agent.runStartedAt}
        counts={shown}
        delegationStarts={shown ? transcript.delegations : undefined}
        onStop={() => control.onStop(agent.id)}
        onUnarchive={control.onUnarchive}
        onOpenSubagent={onOpenSubagent}
        onOpenTarget={onOpenTarget}
        cards={cards}
        openGitHub={openGitHub}
        onOpenApiKeys={control.onOpenApiKeys}
        keywords={control.keywords}
        skills={control.readSkills}
        starter={starter}
        readerId={control.me}
        run={run}
        replay={replayPlace({
          agent,
          control,
          tile: cards?.agent,
          target: cards?.target,
          onOpenTarget,
          openGitHub,
        })}
        endPress={
          pressed ? (
            <ContinueAgent
              agentId={agent.id}
              control={control}
              carry={continued.length > 0 ? carry : undefined}
              offers={continues}
              label={continued.length > 0 ? CONTINUE_AGAIN_LABEL : CONTINUE_LABEL}
            />
          ) : undefined
        }
        continuable={continued.length > 0 || (continues && control.continueAgent !== undefined)}
        onMoveToCloud={moveToCloud}
        endTrail={
          continued.length === 0 || control.onUnarchive === undefined ? undefined : (
            <ContinuedTrail {...continuedDoors} />
          )
        }
        continuedNote={
          continued.length === 0 ? undefined : (
            <ContinuedComposerNote
              agent={agent}
              doors={continuedDoors}
              stop={offersStop(agent) ? () => control.onStop(agent.id) : undefined}
              control={control}
              shown={shown}
            />
          )
        }
        closedRemedy={
          <ContinueAgent agentId={agent.id} control={control} carry={carry} offers={continues} />
        }
        pilotNote={
          pilot === undefined || reportsTo === undefined ? undefined : (
            <PilotComposerNote
              pilot={pilot}
              target={reportsTo}
              control={control}
              onOpenTarget={onOpenTarget}
              stop={offersStop(agent) ? () => control.onStop(agent.id) : undefined}
            />
          )
        }
      />
    </MessagePlaceProvider>
  );
}

export function AgentSubagentTab({
  agentId,
  callId,
  task,
  status,
  control,
  shown,
  onStatus,
  onHeld,
  sender,
  onOpenTarget,
  cards,
}: {
  agentId: string;
  callId: string;
  task: string;
  onOpenTarget?: DelegationDoors["onOpenTarget"];
  cards?: TranscriptCards | undefined;
  sender?: ReactNode;
  status: AgentStatus;
  control: AgentsControl;
  shown: boolean;
  onStatus: (status: AgentStatus) => void;
  onHeld: (callId: string, held: HeldTranscript) => void;
}): React.JSX.Element {
  const transcript = useAgentTranscript({
    transcript: useMemo(
      () => ({ kind: TRANSCRIPT_KIND.AGENT, agentId, callId }),
      [agentId, callId],
    ),
    shown,
    onStatus: (_agentId, next) => onStatus(next.status),
  });
  const { messages, pageStatus, runStartedAt, pageTitle } = transcript;
  const owner =
    control.agents?.find((each) => each.id === agentId) ??
    control.archived?.find((each) => each.id === agentId);
  const pictures = useAgentPictureDoor(agentId, callId);
  const wholeParts = useWholePartDoor(agentId, callId);
  const { members, former } = useMemberDirectory();
  const macOwner = useKept(macOwnerOf(owner?.startedBy, members, control.me, former), sameFields);
  const lines = useMemo(() => workerLines(task, transcript.messages), [task, transcript.messages]);
  const models = control.models;
  const openTarget = useSteady(onOpenTarget);
  const delegation = useMemo(
    () => ({ models, onOpenTarget: openTarget, cards }),
    [models, openTarget, cards],
  );
  const origin = useMemo(() => (sender === undefined ? undefined : { sender }), [sender]);
  useEffect(() => {
    if (pageStatus === undefined || messages.length === 0) return;
    const held = { messages, status: pageStatus, runStartedAt, title: pageTitle };
    onHeld(callId, { ...held, subagentTitles: new Map() });
  }, [onHeld, callId, messages, pageStatus, runStartedAt, pageTitle]);
  const name = cardTitle(task);
  const tab = useRef<HTMLElement>(null);
  useReplySaid({ messages, status: pageStatus, name, tab });
  return (
    <AgentTabFrame ref={tab} label={name}>
      <MacOwnerProvider value={macOwner}>
        <AgentPicturesProvider value={pictures}>
          <WholePartsProvider value={wholeParts}>
            <AgentTranscriptView
              messages={lines}
              lead={WORKER_LEAD}
              origin={origin}
              delegation={delegation}
              reading={transcript.reading}
              failed={transcript.failed}
              failedWith={transcript.failedWith}
              working={agentStillWriting(status)}
              pageRuns={
                transcript.pageStatus !== undefined && agentStillWriting(transcript.pageStatus)
              }
              sessionStarting={status === AGENT_STATUS.STARTING}
              startedAt={shown ? transcript.runStartedAt : undefined}
              ended={transcript.pages === 0 ? undefined : endLineParts(status, transcript.failure)}
              failureAbout={{ agentId, taskId: owner?.planId ?? undefined, callId }}
              onRetry={transcript.onRetry}
              onOlder={transcript.hasOlder ? transcript.loadOlder : undefined}
              olderFailed={transcript.olderFailed}
            />
          </WholePartsProvider>
        </AgentPicturesProvider>
      </MacOwnerProvider>
    </AgentTabFrame>
  );
}
