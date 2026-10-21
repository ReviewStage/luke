import { AGENT_TOOL } from "@luke/features/agent-tools";
import { TRANSCRIPT_KIND } from "@luke/features/coding-agent-view";
import {
  CODING_AGENT_BRIEF,
  CODING_AGENT_RUNTIME,
  CODING_AGENT_STATUS,
  type CodingAgentBrief,
  type CodingAgentMessage,
  type CodingAgentOrigin,
  type CodingAgentPullRequestAnswer,
  type CodingAgentStatus,
  type CodingAgentSubagentStanding,
  type CodingAgentSummary,
} from "@luke/features/coding-agent-wire";
import { FAILURE_REASON, type FailureReason, remedyLabel } from "@luke/features/failure-remedy";
import { inboxLineWords } from "@luke/features/inbox-wire";
import type { CatalogModel, ModelChoice } from "@luke/features/models-wire";
import type { KnownNames } from "@luke/features/place-chip-model";
import type { TaskStatus } from "@luke/features/task-wire";
import { TRANSCRIPT_PART_TYPE } from "@luke/features/transcript-wire";
import { CALL_KIND, CALL_WORDS } from "@luke/features/turn-rows";
import { ACT_KIND } from "@luke/host/acts";
import {
  BUTTON_VARIANT,
  Button,
  DisclosureChevron,
  DocumentIcon,
  ERROR_STATE_PLACEMENT,
  ErrorState,
  INLINE_REF_LOOK,
  TaskStatusMark,
  TEXT_LINK_LOOK,
  TEXT_TONE,
  Text,
  TextLink,
} from "@luke/ui";
import { ACTOR_KIND, ACTOR_STATE, type Actor } from "@luke/ui/actor-model";
import type { VirtualRowsHandle } from "@luke/ui/virtual-rows";
import {
  callEndedLine,
  callOfLine,
  callPlaces,
  type TranscriptCallRow,
} from "@luke/voice/transcript-model";
import { MESSAGE_ROLE, type WireValue } from "@luke/wire";
import type { UIMessage } from "ai";
import { BotIcon, WebhookIcon, ZapIcon } from "lucide-react";
import {
  createContext,
  Fragment,
  memo,
  type ReactNode,
  type RefObject,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
import { useAct } from "../act.js";
import { ActorLine, ActorRef, AutomationCard, automationActor } from "../actor-ref.js";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationRows,
  ConversationScrollButton,
} from "../ai-elements/conversation.js";
import { Fold, FoldBody, FoldSummary } from "../ai-elements/fold.js";
import { MESSAGE_ACTIONS_PLACEMENT, Message, MessageContent } from "../ai-elements/message.js";
import { Plan, PlanContent, PlanHeader, PlanIcon, PlanTitle } from "../ai-elements/plan.js";
import { TOOL_STATE } from "../ai-elements/tool.js";
import { appPlatform } from "../app-platform.js";
import { useAutomation } from "../automation-directory.js";
import { useCopyToast } from "../copy-feedback.js";
import { FadingWords } from "../fading-words.js";
import { useFindOpen } from "../find-in-tab.js";
import { InlineRef } from "../inline-ref.js";
import { useMemberDirectory, usePerson } from "../member-directory.js";
import { SPINNER_SIZE, Spinner } from "../spinner.js";
import { GLYPH_STATE, stateEndMark } from "../state-glyph.js";
import { TOAST_HOLD, TOAST_TONE, useToast } from "../toast.js";
import {
  AgentCallControls,
  type AgentCallDoors,
  AgentCallFoot,
  takesCalls,
  useAgentOnCall,
} from "./agent-call.js";
import { AgentComposer } from "./agent-composer.js";
import {
  AgentPicturesProvider,
  CallPictures,
  ShownPictures,
  useAgentPictureDoor,
} from "./agent-pictures.js";
import { type PublishedDoors, PublishedRow } from "./agent-published.js";
import { SendingAgent } from "./agent-ref.js";
import type { AgentServersControl } from "./agent-servers.js";
import type { HeldTranscript } from "./agent-tab-card.js";
import { ArchivedComposerNote } from "./archived-task.js";
import { AttachedFileChips, messageFileChips } from "./attached-file-chips.js";
import { CallEndMarker, CallStartMarker } from "./call-card.js";
import { useChatOn } from "./chat-gate.js";
import { ChatNoticeCard, type ChatNoticeDoors } from "./chat-notice.js";
import {
  AGENT_PART,
  type AgentPart,
  type AgentPartCut,
  agentLines,
  agentListCallIds,
  agentPart,
  agentParts,
  agentRows,
  agentStillWriting,
  agentTabLabel,
  agentWorkingPhase,
  archivedByReading,
  CONTINUE_AGAIN_LABEL,
  CONTINUE_LABEL,
  chatNoticeOf,
  continuedByIds,
  continuedByTitles,
  delegates,
  dockedTodos,
  type EndLineParts,
  endLineOffersContinue,
  endLineParts,
  endLineReason,
  lineSender,
  macOwnerOf,
  messageWords,
  newestTodos,
  placedMessages,
  planPayerOf,
  providerOf,
  type SpokenMessage,
  settledPlanEdits,
  sidebarCallIds,
  spokenMessages,
  type TurnRead,
  teammateStarter,
  turnStretches,
  WORKING_PHASE_WORDS,
  workerLines,
  workerStatusOf,
  workerToolState,
} from "./coding-agent-model.js";
import { ContinueAgent, ContinuedComposerNote, ContinuedTrail } from "./continue-agent.js";
import { CopyMessageAction } from "./copy-message.js";
import { ForkedToLine, useForkOffered } from "./fork-action.js";
import { type ForkCut, forkCutOf, openReply } from "./fork-model.js";
import { linkChip } from "./mention-chip.js";
import {
  agentMessagePlace,
  MESSAGE_GONE,
  MessagePlaceProvider,
  useMessageReveal,
} from "./message-links.js";
import { ChatGptPlanLabel, ClaudePlanLabel } from "./plan-label.js";
import { PlanPictures } from "./plan-pictures.js";
import { ReplayCard, type ReplayPlace, replayPlace } from "./replay-card.js";
import { briefAgent, replayOpening } from "./replay-card-model.js";
import { REPLY_SCOPE, ReplyToSelection } from "./reply-to-selection.js";
import { SentTime } from "./sent-time.js";
import { MentionedServers, SentToAgent } from "./server-card.js";
import { SentWords, useSkill } from "./skill-chip.js";
import type { SkillSource } from "./skill-picker.js";
import { SkillCard } from "./skill-ref.js";
import { PlanGlyph } from "./tab-look.js";
import { useMentionDoors } from "./task-mentions.js";
import { useMinute } from "./task-time.js";
import {
  calledAgent,
  cardTitle,
  delegationView,
  loadedSkill,
  sentWords,
  TARGET_HINT,
  TOOL_TARGET,
  type ToolTarget,
  todoFocus,
  todosSummary,
  todosView,
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
  TranscriptWords,
} from "./transcript-blocks.js";
import { type FindRow, useTranscriptFind } from "./transcript-find.js";
import { UndeliveredLines, UndeliveredMark, useUndeliveredLines } from "./undelivered-mark.js";
import { useAgentCalls } from "./use-agent-calls.js";
import { type AgentComposerControl, useAgentComposer } from "./use-agent-composer.js";
import { type AgentModelControl, useAgentModel } from "./use-agent-model.js";
import { useAgentPullRequest } from "./use-agent-pull-request.js";
import { useAgentServers } from "./use-agent-servers.js";
import { type AgentTranscriptControl, useAgentTranscript } from "./use-agent-transcript.js";
import type { CodingAgentsControl } from "./use-coding-agents.js";
import { useKnownNames, useTaskStatus } from "./use-known-names.js";
import { type CutBody, useWholePart, useWholePartDoor, WholePartsProvider } from "./whole-parts.js";
import { WorkedFor, WorkingLine } from "./working-time.js";

/**
 * agent-tab.tsx -- one coding agent's tab in the task's column: its transcript live, and the message box under it wearing what it runs on and what it published.
 *
 * The transcript is drawn as every transcript is (`transcript-blocks.tsx`
 * over `../ai-elements/`), the Call tab alike, from the
 * agent's stored `UIMessage`s as they are, and reads as a devtool's agent
 * pane: what it was handed opens it as a message sent to it, at a sent
 * message's measure under the line naming who sent it, a card folded under
 * its title: the plan, sent by its task, which opens the plan, beside the
 * teammate who started the agent; an automation's prompt alone, sent by the
 * automation, which opens its page where the window can, with the pull
 * request its event named, who ran it now, and a webhook's body folded
 * inside the card; and a worker's task, sent by the agent that delegated it.
 * Each of its own turns runs the column's width with its text as
 * markdown, its reasoning folded under one quiet line, each tool call one
 * collapsible row saying what it did (`tool-call-model.ts`), with the
 * input and the answer under the row once opened and a call that ended in
 * an error marked in red, each delegation to a worker a subagent's row on
 * a line of its own, as the Call tab draws its worker's, saying the task
 * and the model and effort the worker runs on, the whole line the one
 * button that opens the worker's own tab in the side panel (`AgentSubagentTab`),
 * each call about something the window draws in a tab of its own, a page,
 * the board, an agent, code shown, the plan, or the Inbox, the one
 * button that opens that tab (`toolTarget`), each write
 * of its to-do list the list on a row of its own where it landed, open
 * while it is the newest and folded once a newer one stands, the newest
 * docked over the composer instead while the agent works through it, and its
 * runs of calls and its finished lead folded as the Call tab folds Luke's; a message the developer sent it after the plan
 * is the developer's bubble, as the Call tab draws one, each skill it
 * names the chip that opens the skill's file (`skill-chip.tsx`), as a
 * "Loaded skill" row opens it too, hanging the same card; and while
 * the agent may still write, a shimmering line stands at the end saying
 * what it is doing, "Starting…" until its turn opens, "Thinking…" until
 * the turn draws its first row, and "Working…" after (`agentWorkingPhase`),
 * counting how long the run has gone where the service said when it began
 * (`working-time.tsx`), as a running worker's row counts beside its
 * spinner, gone the moment it ends, so a finished turn ends on its own
 * last line and then one quiet line saying how long it worked and when it
 * ended; a
 * turn that was stopped or failed ends on one quiet line saying so, with
 * why where the service said. A call into the agent stands between a
 * plain divider saying when it began and a line saying it ended, and on it
 * each exchange reads as a conversation: the developer's line, what the
 * voice said, and the turn whose words it read aloud folded closed under
 * that, its reasoning, calls, written answer, and how long it worked one
 * press away (`spokenMessages`), so an answer is not read twice; on a call
 * into a busy agent, only the work after the ask joined its turn. The list
 * keeps to its newest line while it is scrolled there. A link in the
 * transcript opens in the browser where it is a page on GitHub, which is
 * where the pull request the agent opened lives; every other address is
 * drawn and goes nowhere. No line here names a price: a price in the
 * window is the whole run's, said only at the model menu's foot
 * (`agentUsageLine`). Every word here is the agent's or the plan's, so the
 * root is left out of the screen recording (`ph-no-capture`) as a second
 * line behind the recording's text masking. Under the transcript stands
 * the composer (`agent-composer.tsx`), with no head above either: where
 * the agent stands is its tab's glyph and the transcript's own lines, what
 * it runs on is the model chip at the box's foot, and what it published
 * is the pull request's row pinned over the box, under the docked to-do
 * list, or the branch's chip at the box's foot before a pull request
 * stands (`agent-published.tsx`). A line the developer sends joins the transcript at
 * once as theirs and is read back from the service's own row, and the
 * Stop is the composer's, the one the tab has. A worker's tab draws the
 * worker's transcript the same way, under the agent and the call that
 * started it, with the task it was handed in the plan card's place and no
 * composer, since nothing is sent to a worker. Either tab says what it
 * holds to the task's page each time it moves (`onHeld`), which its tab's hover
 * card previews (`agent-tab-card.tsx`).
 */

/** How a transcript opens: what its first row, the developer's, is drawn as, and what stands before any row has landed. */
interface TranscriptLead {
  /** The word before the card's title. */
  label: string;
  icon: ReactNode;
  /** Whether the card is its task's plan, which wears the task's status's mark in place of `icon` where the window lists the task. */
  plan?: true;
  /** What the tab says before the first message lands; a turn that ended before one says how instead. */
  startingLine: string;
}

/** An agent's transcript: the plan it was handed, and the agent starting; the brain's turns on the Call tab, which open on no card, alike. */
export const AGENT_LEAD: TranscriptLead = {
  label: "Plan",
  icon: <DocumentIcon />,
  plan: true,
  startingLine: "The agent is starting.",
};

/** The plan's own tab, which a task's name over its plan's card opens. */
const TASK_TARGET: ToolTarget = { kind: TOOL_TARGET.PLAN };

/** The height a transcript's row is taken to have before it is drawn and measured, in pixels: a short turn's. */
const ROW_ESTIMATE_PX = 160;

/** The room between two of the log's rows, in pixels: the log's own step between lines (`--luke-space-12`, tasks.css). */
const ROW_GAP_PX = 12;

/** What the tab says where its transcript could not be read. */
const TRANSCRIPT_FAILED_LINE = "The transcript could not be read.";

/** A worker's transcript: the subagent task it was handed, and the worker starting. */
const WORKER_LEAD: TranscriptLead = {
  label: "Subagent task",
  icon: <BotIcon />,
  startingLine: "The worker is starting.",
};

/** An automation's run: the prompt it handed the agent, and the agent starting. */
const AUTOMATION_LEAD: TranscriptLead = {
  label: "Prompt",
  icon: <ZapIcon />,
  startingLine: "The agent is starting.",
};

/** What a webhook call's body is called, folded under the prompt it rode in with. */
const WEBHOOK_BODY_LABEL = "Webhook body";

/** What an automation's sender line says beside its name once it is deleted. */
const DELETED_WORDS = "(deleted)";

/** What an automation's sender line names it where no name was kept, as an agent started before it was is. */
const AUTOMATION_WORDS = "Automation";

/**
 * What a transcript opens on where something handed it its first message:
 * the sender line under the card, naming who, the card's kind where it is not
 * the transcript's own lead, and the card's words where they are not the
 * message's own, an automation's prompt without the lines Luke adds of its
 * firing, with the webhook body that rode in with it.
 */
export interface TranscriptOrigin {
  readonly sender: ReactNode;
  readonly lead?: TranscriptLead | undefined;
  readonly text?: string | undefined;
  readonly body?: string | undefined;
}

/** The task an agent's plan is the plan of, as its card's sender line names it: its name, its status, whose mark it wears, and the card its sidebar row hangs. */
export interface BriefTask {
  readonly name: string;
  readonly status: TaskStatus | undefined;
  readonly card: ReactNode;
}

/** A worker as its delegation's row knows it: the call that started it, the task it was handed, and where it stands. */
interface DelegatedWorker {
  readonly callId: string;
  readonly task: string;
  readonly status: CodingAgentStatus;
}

/**
 * The cards a transcript's rows hang in their hints' place, each the card
 * the tab the row opens hangs: an agent's for a call about one, a worker's
 * for a delegation's row (`agent-ref.tsx`); none where that tab hangs
 * none, when the row's hint says what it opens.
 */
export interface TranscriptCards {
  readonly target: (target: ToolTarget) => ReactNode;
  readonly worker: (worker: DelegatedWorker) => ReactNode;
  /** One of the place's agents as its tab wears it, which a call about the agent names it by (`calledAgentActor`); none where the place does not list it. */
  readonly agent?: ((agentId: string) => Actor | undefined) | undefined;
  /** The task whose plan an agent was handed, which its card's sender line names; none where the place knows no task. */
  readonly task?: BriefTask | undefined;
}

/** What a delegation's row draws from beyond its part: the catalog its pair is named from, the agent's own pair for a half the agent left to its own, when each running worker began, and the press that opens the worker's tab. */
export interface DelegationDoors {
  models: readonly CatalogModel[] | undefined;
  own?: ModelChoice | undefined;
  /** When each running worker began, by the call that started it, which its row counts from; none while the tab is off screen, so nothing counts unseen. */
  starts?: ReadonlyMap<string, number> | undefined;
  /** Opens the worker's tab, by the call that started it, with the task and where the worker stands as the row knows it; none where the row stands in a tab that opens no tab. */
  onOpen?: ((callId: string, task: string, status: CodingAgentStatus) => void) | undefined;
  /** Opens what a call is about in the tab that draws it (`toolTarget`), which the row of such a call asks for; none where nothing opens one, when every such call folds open in place. */
  onOpenTarget?: ((target: ToolTarget) => void) | undefined;
  /** The cards the rows that open a tab hang, as those tabs hang them; none where the rows hang their hints. */
  cards?: TranscriptCards | undefined;
  /** Where each worker stands as its own session reads, by the call that started it, which its row says over the call's own state; none from a service older than it. */
  standings?: ReadonlyMap<string, CodingAgentSubagentStanding> | undefined;
  /** The job of each worker by its task, which a stop's row names in the task's place; none where the transcript knows no task's job. */
  jobs?: WorkerJobs | undefined;
  /** The chat a chat notice's card reads its message from and opens in; none where the window holds no chat. */
  chat?: ChatNoticeDoors | undefined;
  /** Whether the window offers Chat (`chat-gate.ts`), without which a chat notice is drawn as the plain line it is. */
  chatOn?: boolean;
}

/**
 * The doors a transcript's rows read as the window draws them now: the
 * cards they hang and the chat a notice reads. The window hands both anew
 * on every draw, so they ride beside the messages rather than in them, and
 * a message kept as it was (`sameMessageDraw`) still hangs today's cards.
 */
const LiveDoors = createContext<Pick<DelegationDoors, "cards" | "chat"> | undefined>(undefined);

/** The live doors where a transcript hands them, else what `doors` carries. */
function useLiveDoors(
  doors: Pick<DelegationDoors, "cards" | "chat"> | undefined,
): Pick<DelegationDoors, "cards" | "chat"> | undefined {
  return useContext(LiveDoors) ?? doors;
}

/** A chat notice's card, at the moment the window's clock says. */
function NoticeRow({
  message,
  doors,
}: {
  message: CodingAgentMessage;
  doors: ChatNoticeDoors | undefined;
}): ReactNode {
  const now = useMinute();
  const live = useLiveDoors({ chat: doors });
  const notice = chatNoticeOf(message);
  if (notice === undefined) return null;
  // Another coding agent who posted is named by its own chip, which opens it, as its line's sender is.
  const sender = lineSender(message.sentBy, undefined, undefined);
  const from =
    sender?.kind === ACTOR_KIND.AGENT && sender.agentId !== undefined ? (
      <SendingAgent actor={sender} agentId={sender.agentId} />
    ) : undefined;
  return (
    <ChatNoticeCard
      messageId={message.id}
      notice={notice}
      words={messageWords(message)}
      from={from}
      doors={live?.chat}
      now={now}
    />
  );
}

/**
 * The agent a call about one names, as its row's chip wears it: its tab's
 * own tile and name where the place lists the agent, else the title the
 * call's answer gives it on the mark of its harness, read off the model
 * the answer says it runs on, or the one the window last read it running
 * on (`useKnownNames`), as an agent of another task is named; nothing
 * where neither is known, as a start's before it answers, whose row keeps
 * its own words.
 */
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

/** One tool call: its row, and its input and answer under it once opened, a stop naming the worker it stopped by its job where `jobs` knows it, and a call about an agent naming it by its chip where `cards` or its answer know it; an answer its page carried cut drawn as `cut` says. */
function ToolCallView({
  part,
  jobs,
  cards,
  cut,
}: {
  part: Extract<AgentPart, { kind: typeof AGENT_PART.TOOL }>;
  jobs?: WorkerJobs | undefined;
  cards?: TranscriptCards | undefined;
  cut?: CutBody | undefined;
}): ReactNode {
  const view = toolCallView({ ...part, jobs });
  const known = useKnownNames();
  return (
    <>
      <TranscriptTool
        data-call-id={part.callId}
        state={part.state}
        kind={view.kind}
        provider={view.provider}
        subject={view.subject}
        description={view.description}
        agent={calledAgentActor(part, cards, known)}
        input={view.input}
        output={view.output}
        errorText={part.errorText}
        cut={cut}
      />
      <CallPictures tool={part.tool} input={part.input} output={part.output} />
    </>
  );
}

/** A call about an agent, naming it by the cards the window hands now, so a message kept as it was names the agent as its tab does today. */
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

/** The workers their own session says still run. */
function runningStandings(
  standings: ReadonlyMap<string, CodingAgentSubagentStanding> | undefined,
): readonly CodingAgentSubagentStanding[] {
  return [...(standings?.values() ?? [])].filter(
    (standing) => workerToolState(standing.status) === TOOL_STATE.INPUT_AVAILABLE,
  );
}

/** When each running worker began: the newest turn's waits, and every worker its own session says still runs. */
function workerStarts(
  waits: ReadonlyMap<string, number>,
  standings: ReadonlyMap<string, CodingAgentSubagentStanding>,
): ReadonlyMap<string, number> {
  return new Map([
    ...waits,
    ...runningStandings(standings).map(
      (standing) => [standing.callId, standing.startedAt] as const,
    ),
  ]);
}

/** One delegation: a subagent's row saying the task and the pair, the one button into its tab. */
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
  // The worker's own session says where it stands, since the call may settle the moment it is under way.
  const standing = doors?.standings?.get(part.callId);
  const choice =
    standing === undefined ? view.choice : { model: standing.model, effort: standing.effort };
  const status = standing?.status ?? workerStatusOf(part.state);
  return (
    <TranscriptSubagent
      callId={part.callId}
      job={cardTitle(view.task) || CALL_WORDS[CALL_KIND.WORKER].verb}
      pair={choice === undefined ? undefined : { choice, models: doors?.models ?? [] }}
      state={standing === undefined ? part.state : workerToolState(standing.status)}
      startedAt={doors?.starts?.get(part.callId)}
      errorText={part.errorText}
      onOpen={onOpen === undefined ? undefined : () => onOpen(part.callId, view.task, status)}
      card={live?.cards?.worker({ callId: part.callId, task: view.task, status })}
    />
  );
}

/**
 * One write of the agent's to-do list: the list, open while it is the
 * newest and folded once a newer one stands, or a call's row where its
 * input does not read as a list. Note that the row is keyed by whether it
 * is open, because the fold reads `defaultOpen` once.
 */
function TodosRow({
  part,
  open,
  live,
}: {
  part: Extract<AgentPart, { kind: typeof AGENT_PART.TOOL }>;
  open: boolean;
  live: boolean;
}): ReactNode {
  const todos = todosView(part.input);
  if (todos === undefined) return <ToolCallView part={part} />;
  return (
    <TranscriptTodos
      key={String(open)}
      data-call-id={part.callId}
      defaultOpen={open}
      state={part.state}
      subject={todosSummary(todos)}
      todos={todos}
      errorText={part.errorText}
      live={live}
    />
  );
}

/** Where the transcript draws the agent's to-do lists: the call whose list stays out of a finished turn's fold, the call whose list is drawn open, none while the list is docked above the composer, and the call whose list the agent is at, none once it stops. */
interface TodosPlace {
  readonly kept: string | undefined;
  readonly open: string | undefined;
  readonly live: string | undefined;
}

/** A transcript that holds no to-do list, as the brain's does not. */
const NO_TODOS: TodosPlace = { kept: undefined, open: undefined, live: undefined };

/** Where the to-do lists are drawn for the transcript given: the newest kept and open, unless it is docked while the agent works on it, and live while the agent works. */
function todosPlace(messages: readonly CodingAgentMessage[], working: boolean): TodosPlace {
  const standing = newestTodos(messages);
  const docked = dockedTodos(standing, working);
  return {
    kept: standing?.callId,
    open: docked === undefined ? standing?.callId : undefined,
    live: working ? standing?.callId : undefined,
  };
}

/** The list the agent is working through, docked above the composer; nothing where none is (`dockedTodos`). */
function TodosDock({
  messages,
  working,
}: {
  messages: readonly CodingAgentMessage[];
  working: boolean;
}): ReactNode {
  const docked = dockedTodos(newestTodos(messages), working);
  if (docked === undefined) return null;
  return (
    <div className="agent-todos-dock">
      <TranscriptTodosDock
        key={docked.callId}
        todos={docked.todos}
        summary={todosSummary(docked.todos)}
        focus={todoFocus(docked.todos)}
      />
    </div>
  );
}

/** The agent's pull request, pinned over the box under the to-do list for as long as it stands, whether the agent works or has ended; nothing before one does. */
function PublishedDock({
  published,
  doors,
}: {
  published: CodingAgentPullRequestAnswer | undefined;
  doors: PublishedDoors;
}): ReactNode {
  if (published === undefined || published.pullRequest === null) return null;
  return (
    <div className="agent-published-dock">
      <PublishedRow pullRequest={published.pullRequest} branch={published.branch} doors={doors} />
    </div>
  );
}

/**
 * A call that loaded a skill: the one button that opens the skill's
 * `SKILL.md`, hanging the card a sent message's chip of the skill hangs
 * (`skill-ref.tsx`), where it is one of the task's skills, and a call's row
 * otherwise. Note that a load that failed keeps the call's row, because the
 * row is where its error is read.
 */
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
      hint={subject.skill.path}
      card={<SkillCard subject={subject} />}
      onOpen={subject.onOpen}
    />
  );
}

/** A call about something drawn in a tab of its own: the one button that opens that tab, saying what it did, its hover saying what it opens. */
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
  /** What names an agent a call is about by its chip; none where only the call's answer does. */
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

/** A call about something a tab of its own draws, hanging that tab's card as the window draws it now (`LiveDoors`). */
function TargetCallView({
  part,
  target,
  doors,
  onOpen,
}: {
  part: Extract<AgentPart, { kind: typeof AGENT_PART.TOOL }>;
  target: ToolTarget;
  doors: DelegationDoors | undefined;
  onOpen: () => void;
}): ReactNode {
  const cards = useLiveDoors(doors)?.cards;
  return (
    <OpeningCallView
      part={part}
      hint={TARGET_HINT[target.kind]}
      card={cards?.target(target)}
      cards={cards}
      onOpen={onOpen}
    />
  );
}

/**
 * A call whose answer its page carried cut: its row as any call's, its body
 * reading the answer whole as it opens and then drawing it as the call's own.
 * Note that both are the one row, so the fold stays open as the answer lands.
 */
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

/** Whether a part read is a thought, which a cut thought's whole read must be. */
function isThought(read: WireValue): boolean {
  return agentPart(read).kind === AGENT_PART.REASONING;
}

/** A thought its page carried cut: its line as any thought's, its body reading the words whole as it opens. */
function CutReasoningView({ cut }: { cut: AgentPartCut }): ReactNode {
  const read = useWholePart(cut, isThought);
  if ("body" in read) return <TranscriptReasoning text="" cut={read.body} />;
  const whole = agentPart(read.part);
  return <TranscriptReasoning text={whole.kind === AGENT_PART.REASONING ? whole.text : ""} />;
}

/** One part of the agent's turn, drawn by its kind. */
function AgentPartView({
  part,
  delegation,
  todos,
  moving = false,
}: {
  part: AgentPart;
  delegation: DelegationDoors | undefined;
  todos: TodosPlace;
  /** Whether the agent may still write to the message the part is of, whose words are then read as they stream. */
  moving?: boolean;
}): ReactNode {
  switch (part.kind) {
    case AGENT_PART.TEXT:
      // The agent's words alone may be replied to, never a call's output or a thought.
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
      // Only an answer the window draws as words is cut (`part-cut.ts`), so the call draws as any call's row.
      if (part.cut !== undefined) {
        return <CutToolCallView part={part} cut={part.cut} jobs={delegation?.jobs} />;
      }
      // A set of pictures the agent showed, or is showing, is drawn as itself; one refused keeps its row, where its error is read.
      if (part.tool === AGENT_TOOL.SHOW_IMAGE && part.state !== TOOL_STATE.OUTPUT_ERROR) {
        return <ShownPictures input={part.input} output={part.output} />;
      }
      if (delegates(part)) return <DelegationRow part={part} doors={delegation} />;
      // A call that failed keeps its row, because the row is where its error is read.
      // A chat call opens Chat only while the window offers it; otherwise its row folds open as any call's does.
      const called = part.state === TOOL_STATE.OUTPUT_ERROR ? undefined : toolTarget(part);
      const target =
        called?.kind === TOOL_TARGET.CHAT && delegation?.chatOn !== true ? undefined : called;
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
      if (part.tool === AGENT_TOOL.WRITE_TODOS) {
        return (
          <TodosRow
            part={part}
            open={part.callId === todos.open}
            live={part.callId === todos.live}
          />
        );
      }
      return toolCallView(part).kind === CALL_KIND.LOAD_SKILL ? (
        <LoadedSkillView part={part} />
      ) : // A call about an agent names it by the cards the window hands now (`LiveDoors`).
      calledAgent(part) === undefined ? (
        <ToolCallView part={part} jobs={delegation?.jobs} />
      ) : (
        <AgentCallView part={part} jobs={delegation?.jobs} doors={delegation} />
      );
    }
    // A step boundary is the model's own pacing, and the parts keep one rhythm across it.
    case AGENT_PART.STEP_START:
    case AGENT_PART.OTHER:
    // A line that reached the turn is drawn as the developer's own message between the turn's stretches (`turnStretches`), never inside one.
    case AGENT_PART.ARRIVED:
      return null;
  }
}

/** A webhook call's body inside the card of the prompt it rode in with, folded again under its own line, as the caller sent it. */
function OriginBody({ body }: { body: string }): React.JSX.Element {
  return (
    <Fold className="agent-origin-body">
      <FoldSummary className="agent-origin-body-line">
        <DisclosureChevron />
        <WebhookIcon aria-hidden="true" />
        {WEBHOOK_BODY_LABEL}
      </FoldSummary>
      <FoldBody>
        <pre className="agent-origin-body-text">{body}</pre>
      </FoldBody>
    </Fold>
  );
}

/**
 * What the transcript opens on: the plan the agent was handed, an
 * automation's prompt, or the task a worker was, as a message sent to the
 * agent, at a sent message's measure over the line naming who sent it and
 * when, as a sent message's bubble stands over its own: a card folded under
 * its title, and a webhook's body folded again inside it. Where the agent
 * works on a task, the plan's own pictures are drawn in the card as its
 * page draws them (`plan-pictures.tsx`), read only once the card is opened.
 */
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
  /** The message the card draws, which a link to it is brought into view by; none where it draws no message of the transcript's. */
  messageId?: string | undefined;
  /** The card's line: the text's first line as plain words, unless the transcript names it otherwise. */
  title?: string | undefined;
  /** The line naming who sent it (`TranscriptOrigin`); none where the transcript names nobody. */
  sender?: ReactNode;
  /** When it was sent, named after who sent it; none where the transcript does not know. */
  sentAt?: number | undefined;
  /** A webhook call's body, which rode in with an automation's prompt. */
  body?: string | undefined;
  /** The task the agent works on, whose plan's pictures the card draws; none where it works on none. */
  taskId?: string | undefined;
}): ReactNode {
  const named = sender != null;
  const words = <TranscriptWords text={text} />;
  // The task's status as the list holds it, else as the window hands the open task live (`LiveDoors`), as its sender reads it.
  const listed = useTaskStatus(lead.plan ? taskId : undefined);
  const handed = useContext(LiveDoors)?.cards?.task?.status;
  const status = lead.plan ? (listed ?? handed) : undefined;
  return (
    <Message from={MESSAGE_ROLE.USER} className="agent-origin" data-message-id={messageId}>
      <Plan data-task-card="" aria-label={lead.label}>
        <PlanHeader>
          <PlanIcon>
            {status === undefined ? lead.icon : <TaskStatusMark status={status} />}
          </PlanIcon>
          <PlanTitle label={lead.label}>{title}</PlanTitle>
        </PlanHeader>
        <PlanContent>
          {taskId === undefined ? (
            words
          ) : (
            <PlanPictures taskId={taskId} text={text}>
              {words}
            </PlanPictures>
          )}
          {body === undefined ? null : <OriginBody body={body} />}
        </PlanContent>
      </Plan>
      {!named && sentAt === undefined ? null : (
        <div className="message-meta">
          {named ? <span className="message-sender">{sender}</span> : null}
          {sentAt === undefined ? null : <SentTime at={sentAt} named={named} />}
        </div>
      )}
    </Message>
  );
}

/** A task named as the sender of its plan: its status's mark and its name as one target, hanging its card and opening its plan where the place can. */
function TaskRef({ task, onOpen }: { task: BriefTask; onOpen?: (() => void) | undefined }) {
  return (
    <InlineRef
      look={INLINE_REF_LOOK.WASH}
      glyph={
        <span className="agent-origin-glyph">
          <PlanGlyph status={task.status} />
        </span>
      }
      label={task.name}
      onPress={onOpen === undefined ? undefined : () => onOpen()}
      card={task.card}
      data-task-ref=""
    />
  );
}

/** Who sent a task's agent its plan: the task, then the teammate who started the agent, never the reader. */
function TaskSender({
  task,
  onOpen,
  starter,
}: {
  task: BriefTask | undefined;
  onOpen: (() => void) | undefined;
  starter: Actor | undefined;
}): React.JSX.Element {
  // The window hands the task anew on every draw, so a transcript's sender reads it live (`LiveDoors`), and the plan's card is not drawn again for it.
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

/**
 * The issue or pull request an automation's GitHub event named, by number
 * and title: where the event gave its address, its chip, as the transcript
 * draws a link to it, wearing GitHub's mark for where it stands, called by
 * its number once GitHub answers for it, and opening it on GitHub
 * (`mention-chip.tsx`); a link opening on GitHub where the
 * address names no chip; and its words alone where the event gave none.
 */
function OriginSubject({
  subject,
  openGitHub,
}: {
  subject: NonNullable<CodingAgentOrigin["subject"]>;
  openGitHub: (url: string) => void;
}): React.JSX.Element {
  const doors = useMentionDoors();
  const words =
    subject.title === undefined ? `#${subject.number}` : `#${subject.number} ${subject.title}`;
  const { url } = subject;
  if (url === undefined) return <FadingWords className="agent-origin-subject" words={words} />;
  const chip = linkChip(url, words, doors);
  if (chip !== undefined) return <span className="agent-origin-chip">{chip}</span>;
  return (
    <FadingWords className="agent-origin-subject" words={words}>
      <TextLink
        href={url}
        look={TEXT_LINK_LOOK.UNDERLINED}
        onClick={(event) => {
          event.preventDefault();
          openGitHub(url);
        }}
      >
        {words}
      </TextLink>
    </FadingWords>
  );
}

/**
 * Who sent an automation's agent its prompt: the automation, hanging its
 * card and opening its page where the window can open it, and named plainly
 * where it cannot, deleted, someone else's personal one, or the Automations
 * experiment off; then the issue or pull request its GitHub event named,
 * and who asked for a run now. A webhook's body is the card's, never this
 * line's. Each part after the first is a line of its own, separator and
 * all, so a narrow line breaks between the parts (desktop.css).
 */
function AutomationSender({
  automationId,
  name,
  run,
  openGitHub,
}: {
  automationId: string | undefined;
  /** The automation's name as the run started it, which a deleted one is still named by. */
  name: string | undefined;
  run: CodingAgentOrigin | undefined;
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

/**
 * What an agent's transcript opens on: an automation's prompt, from the
 * automation, where an automation's run started it; the plan, from its task
 * and the teammate who started the agent, where it was handed the plan; and
 * nothing for an agent handed a prompt by hand, whose prompt is the
 * developer's message as any other.
 */
function agentOrigin(input: {
  agent: CodingAgentSummary;
  run: CodingAgentOrigin | undefined;
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
  if (agent.brief === CODING_AGENT_BRIEF.PROMPT || agent.brief === CODING_AGENT_BRIEF.BLANK) {
    return undefined;
  }
  return {
    sender:
      task === undefined && starter === undefined ? undefined : (
        <TaskSender task={task} onOpen={input.onOpenTask} starter={starter} />
      ),
  };
}

/** Who wrote or said a message: their mark and their name, hanging their card. */
function MessageSender({ actor }: { actor: Actor }): React.JSX.Element {
  return (
    <span className="message-sender">
      {actor.kind === ACTOR_KIND.AGENT && actor.agentId !== undefined ? (
        <SendingAgent actor={actor} agentId={actor.agentId} />
      ) : (
        <ActorRef actor={actor} />
      )}
    </span>
  );
}

/** One of the developer's lines that reached a turn while it ran, with who sent it, named over it as any line of theirs is. */
export interface ArrivedLine {
  readonly message: CodingAgentMessage;
  readonly sender: Actor | undefined;
}

/** No line reached the turn while it ran. */
const NO_ARRIVED: readonly ArrivedLine[] = [];

/** A transcript with no calls into its agent, as a worker's is. */
const NO_CALLS: readonly TranscriptCallRow[] = [];

/** The divider a call begins at, before the first of its lines the transcript draws; nothing where none begins there. */
function CallOpen({
  call,
  now,
}: {
  call: TranscriptCallRow | undefined;
  now: number;
}): React.JSX.Element | null {
  if (call === undefined) return null;
  return (
    <CallStartMarker startedAt={call.startedAt} live={call.live} now={now} caller={call.caller} />
  );
}

/** The line a call that ended closes with, after the last of its lines; nothing where none ends there. */
function CallClose({ call }: { call: TranscriptCallRow | undefined }): React.ReactNode {
  const line = call === undefined ? undefined : callEndedLine(call);
  if (call === undefined || line === undefined) return null;
  return <CallEndMarker line={line} startedAt={call.startedAt} record={call.record} />;
}

/** A line heard on a call that no row holds yet, drawn as the row it will be: the speaker's words, one text part. */
function heardLine(line: UIMessage): CodingAgentMessage {
  return {
    id: line.id,
    role: line.role,
    parts: line.parts.flatMap((part) =>
      part.type === TRANSCRIPT_PART_TYPE.TEXT ? [{ type: part.type, text: part.text }] : [],
    ),
  };
}

/**
 * The line a finished turn ends on: how long it worked and when it ended,
 * then its Copy and Copy link beside it, set as a sent message's are under
 * its bubble rather than floated over the turn's corner. A turn still
 * running offers no Copy, because its words are not yet whole.
 */
function TurnFoot({ workedFor, copy }: { workedFor: ReactNode; copy: ReactNode }): ReactNode {
  if (workedFor === null && copy === null) return null;
  return (
    <div className="agent-turn-foot" data-turn-foot="">
      {workedFor}
      {copy}
    </div>
  );
}

/**
 * One message: the plan the agent was handed, as a card; a message the
 * developer sent it since, as the developer's bubble, with a quiet line
 * under it holding its Copy and Copy link and, at the bubble's edge, who
 * sent it and when; or one of the agent's own turns, ending once it has
 * finished on a line saying how long it worked and when it ended, with the
 * Copy and Copy link of its words beside it where it has any. A line that
 * reached a turn while it ran is drawn inside it, as its own bubble between
 * the work before it and the work after it.
 */
export function AgentMessage({
  message,
  plan,
  lead,
  moving,
  delegation,
  todos = NO_TODOS,
  briefTitle,
  said,
  sender,
  origin,
  arrived = NO_ARRIVED,
  taskId,
  forkable = true,
  forkCut,
}: {
  message: CodingAgentMessage;
  /** Whether its tab may offer to fork at it. */
  forkable?: boolean;
  /** Where a fork cuts it, where it is the reply a running turn is still writing (`forkCutOf`), which offers no fork before its first step; none for a settled message, kept whole. */
  forkCut?: ForkCut | undefined;
  /** Whether this is the plan the agent was handed, which is the first of the developer's messages. */
  plan: boolean;
  /** The task the agent works on, whose plan's pictures its plan's card draws; none where it works on none. */
  taskId?: string | undefined;
  /** Who handed the agent the plan or the prompt it opens on, and the card's words where they are not the message's own. */
  origin?: TranscriptOrigin | undefined;
  /** The plan's or task's card line, where the transcript names it otherwise than by its first line. */
  briefTitle?: string | undefined;
  lead: TranscriptLead;
  /** Whether the agent may still write to this message: it is the last, and the agent still works. */
  moving: boolean;
  delegation: DelegationDoors | undefined;
  todos?: TodosPlace;
  /** How much of it the voice read aloud on a call (`spokenMessages`): all of it, its lines drawn ahead of it, or the work after a call's ask joined it, its lines drawn where the ask arrived; once it has finished that much folds closed under them, its words and how long it worked inside the fold. None where the voice read nothing of it. */
  said?: TurnRead | undefined;
  /** Who wrote or said the message, named over it: a teammate, Luke, or an automation; none for the reader's own, or where nobody is named. */
  sender?: Actor | undefined;
  /** The developer's lines that reached this turn while it ran (`placedMessages`), each drawn where it arrived. */
  arrived?: readonly ArrivedLine[];
}): ReactNode {
  const words = messageWords(message);
  const forkOffered = useForkOffered();
  if (plan) {
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
  // A line a chat notice wrote is the sender's message, never the developer's bubble, while the window offers Chat.
  if (delegation?.chatOn === true && chatNoticeOf(message) !== undefined) {
    return <NoticeRow message={message} doors={delegation.chat} />;
  }
  const named = sender === undefined ? null : <MessageSender actor={sender} />;
  if (message.role === MESSAGE_ROLE.USER) {
    const sentAt = message.sentAt;
    // An inbox answer or thread message reads back without the item's key, which is the agent's.
    const shown = inboxLineWords(words);
    return (
      <Message from={message.role} data-message-id={message.id}>
        <AttachedFileChips files={messageFileChips(message)} />
        {words === "" ? null : (
          <MessageContent>
            <SentToAgent id={message.id} arrived={message.arrivedIn !== undefined}>
              <SentWords text={shown} />
            </SentToAgent>
          </MessageContent>
        )}
        <UndeliveredMark messageId={message.id} />
        {words === "" && named === null && sentAt === undefined ? null : (
          <div className="message-meta">
            {words === "" ? null : (
              <CopyMessageAction
                words={shown}
                messageId={message.id}
                placement={MESSAGE_ACTIONS_PLACEMENT.INLINE}
              />
            )}
            {named}
            {sentAt === undefined ? null : <SentTime at={sentAt} named={named !== null} />}
          </div>
        )}
      </Message>
    );
  }
  const { startedAt, finishedAt } = message;
  const workers = new Map(
    [...(delegation?.standings?.values() ?? [])].map(
      (standing) => [standing.callId, workerToolState(standing.status)] as const,
    ),
  );
  const workedFor =
    moving || startedAt === undefined || finishedAt === undefined ? null : (
      <WorkedFor
        startedAt={startedAt}
        endedAt={finishedAt}
        record={message}
        models={delegation?.models}
      />
    );
  const stretches = turnStretches(
    agentRows(message, moving, {
      newestTodos: todos.kept,
      workers,
      said,
      arrived: arrived.map((line) => line.message),
    }),
  );
  const last = stretches.findLastIndex((stretch) => stretch.line === undefined);
  // Note that Copy waits for whole words, while Fork takes a turn of no words, or one still running, as it stands.
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
            placement={MESSAGE_ACTIONS_PLACEMENT.INLINE}
          />
        ) : null
      }
    />
  );
  // A spoken turn's foot, how long it worked with its Copy and Fork, stays inside its fold, under the words it holds.
  return stretches.map((stretch, index) => {
    if (stretch.line !== undefined) {
      const line = stretch.line;
      return (
        <AgentMessage
          key={line.id}
          message={line}
          plan={false}
          lead={lead}
          moving={false}
          delegation={delegation}
          sender={arrived.find((each) => each.message.id === line.id)?.sender}
        />
      );
    }
    // Note that only the turn's first stretch carries its id and its sender, because a link to the turn brings its start into view.
    const ends = index === last;
    return (
      <Message
        key={index === 0 ? message.id : (stretch.rows[0]?.key ?? message.id)}
        from={message.role}
        data-message-id={index === 0 ? message.id : undefined}
      >
        {index === 0 ? named : null}
        <MessageContent>
          <TranscriptRows
            rows={stretch.rows}
            trailer={said !== undefined && ends ? foot : undefined}
          >
            {(part) => (
              <AgentPartView part={part} delegation={delegation} todos={todos} moving={moving} />
            )}
          </TranscriptRows>
        </MessageContent>
        {said !== undefined || !ends ? null : foot}
        {ends ? <ForkedToLine messageId={message.id} /> : null}
      </Message>
    );
  });
}

/**
 * The line a transcript ends on once its turn was stopped or failed: a
 * failure's mark and its words in the danger ink; a stop's words quiet.
 * A turn failed on the reader's own refused key offers its API keys after
 * them.
 */
function AgentEndLine({
  ended,
  endReason,
  onOpenApiKeys,
}: {
  ended: EndLineParts;
  endReason: FailureReason | undefined;
  onOpenApiKeys: (() => void) | undefined;
}): React.JSX.Element {
  const mark = ended.failed ? stateEndMark(GLYPH_STATE.FAILED, false) : null;
  // Note that a key refused is mended in Settings, so its line offers the API keys after the words.
  const remedy =
    endReason === FAILURE_REASON.API_KEY
      ? remedyLabel({ reason: FAILURE_REASON.API_KEY, text: ended.words })
      : undefined;
  return (
    <p
      className="agent-end-line"
      data-ended=""
      data-failed={ended.failed ? "" : undefined}
      aria-live="polite"
    >
      {mark}
      <span className="agent-end-words">{ended.words}</span>
      {remedy === undefined ? null : (
        <span className="agent-end-remedy">
          <Button variant={BUTTON_VARIANT.OUTLINE} onClick={onOpenApiKeys}>
            {remedy}
          </Button>
        </span>
      )}
    </p>
  );
}

/**
 * The end line's row: the line, then the press it ends on (Continue in new
 * agent), on one row, centred on the line's words, which wraps the press
 * under them only where the column is too narrow for both.
 */
function AgentEndRow({
  ended,
  endReason,
  onOpenApiKeys,
  press,
}: {
  ended: EndLineParts;
  endReason: FailureReason | undefined;
  onOpenApiKeys: (() => void) | undefined;
  press: ReactNode;
}): React.JSX.Element {
  return (
    <div className="agent-end-row">
      <AgentEndLine ended={ended} endReason={endReason} onOpenApiKeys={onOpenApiKeys} />
      {press}
    </div>
  );
}

type AgentMessageProps = Parameters<typeof AgentMessage>[0];

/**
 * A press that stays the same function from draw to draw and calls the one
 * handed last, so what is drawn with it need not be drawn again when only
 * the closure changed; none where none is handed.
 */
function useSteady<A extends unknown[]>(
  press: ((...args: A) => void) | undefined,
): ((...args: A) => void) | undefined {
  const latest = useRef(press);
  latest.current = press;
  const steady = useCallback((...args: A) => latest.current?.(...args), []);
  return press === undefined ? undefined : steady;
}

/**
 * The value handed, or the one handed before where `same` reads them alike,
 * so what a transcript hands down stays the same value from draw to draw,
 * and the messages kept as they were are not drawn again for it.
 */
function useKept<T>(value: T, same: (a: T, b: T) => boolean): T {
  const kept = useRef(value);
  if (!same(kept.current, value)) kept.current = value;
  return kept.current;
}

/** Whether two lists hold the same ids in the same order. */
function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

/** Whether two sets hold the same members. */
function sameSet<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const member of a) if (!b.has(member)) return false;
  return true;
}

/** Whether two plain records hold the same values, key by key, as an actor or a pair does. */
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

/** Whether two maps hold the same values under the same keys. */
function sameEntries<V>(
  a: ReadonlyMap<string, V> | undefined,
  b: ReadonlyMap<string, V> | undefined,
): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined || a.size !== b.size) return false;
  for (const [key, value] of a) if (!b.has(key) || !Object.is(b.get(key), value)) return false;
  return true;
}

/**
 * Whether two delegations' doors draw a message alike. The cards and the
 * chat are left out, because the window hands them anew on every draw and
 * the rows read them live (`LiveDoors`); the presses are steadied by the
 * tab (`useSteady`), so a new one is a new door.
 */
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
    a.jobs === b.jobs &&
    a.chatOn === b.chatOn
  );
}

/** Whether two lists of lines that reached a turn are the same lines from the same senders. */
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

/**
 * Whether a transcript's message would be drawn as it was: the same
 * message, as a page that did not touch it leaves it, in the same place
 * and through the same doors. A running agent's tab hears a page up to
 * twice a second, which touches its newest reply alone, so every other
 * message is kept as it was drawn rather than read through again.
 */
function sameMessageDraw(a: AgentMessageProps, b: AgentMessageProps): boolean {
  return (
    a.message === b.message &&
    a.plan === b.plan &&
    a.taskId === b.taskId &&
    a.moving === b.moving &&
    a.said === b.said &&
    a.briefTitle === b.briefTitle &&
    a.forkable === b.forkable &&
    a.lead === b.lead &&
    a.origin === b.origin &&
    sameFields(a.todos, b.todos) &&
    sameFields(a.forkCut, b.forkCut) &&
    sameFields(a.sender, b.sender) &&
    sameArrived(a.arrived, b.arrived) &&
    sameDoors(a.delegation, b.delegation)
  );
}

/** A transcript's message, drawn again only where `sameMessageDraw` says it changed. */
const SteadyAgentMessage = memo(AgentMessage, sameMessageDraw);

/** The door that brings a message whose row is not drawn into view, handing its row to `then` once drawn; false where no row draws it. */
type MessageBringer = (messageId: string, then: (row: HTMLElement) => void) => boolean;

/** A row placed in a transcript: its message, the lines that reached it, and the voice's lines drawn ahead of it. */
type PlacedRow = SpokenMessage;

/** No rows to find in, while no find bar stands open. */
const NO_FIND_ROWS: readonly FindRow[] = [];

/** Whether a row draws the message with `messageId`: its own, a line that reached it, or one said ahead of it. */
function drawsMessage(row: PlacedRow, messageId: string): boolean {
  return (
    row.message.id === messageId ||
    row.arrived.some((line) => line.id === messageId) ||
    row.said.some((line) => line.id === messageId)
  );
}

/** Each message's words as a find counts them, kept by the message, so a page that leaves it reads them once. */
const wordsFound = new WeakMap<CodingAgentMessage, string>();

/** The words a message draws that a find counts before its row is drawn: its text and its reasoning. */
function findWordsOf(message: CodingAgentMessage): string {
  const kept = wordsFound.get(message);
  if (kept !== undefined) return kept;
  const words = agentParts(message)
    .flatMap((part) =>
      part.kind === AGENT_PART.TEXT || part.kind === AGENT_PART.REASONING ? [part.text] : [],
    )
    .join("\n");
  wordsFound.set(message, words);
  return words;
}

/** A row as a find reads it before it is drawn: its messages' words. */
function findRowOf(row: PlacedRow): FindRow {
  return {
    key: row.message.id,
    words: [...row.said, row.message, ...row.arrived].map(findWordsOf).join("\n"),
  };
}

/** Whether two runs of lines are the same lines in the same order. */
function sameLines(a: readonly CodingAgentMessage[], b: readonly CodingAgentMessage[]): boolean {
  return a === b || (a.length === b.length && a.every((line, index) => line === b[index]));
}

/** A row as the calls are placed among the rows, kept by its message while the lines drawn in it stand as they did. */
const callRows = new WeakMap<
  CodingAgentMessage,
  { readonly lines: readonly CodingAgentMessage[]; readonly row: CallPlacedRow }
>();

/** A row placed for the calls into the agent, as `callPlaces` reads it: the message, and every line drawn inside it. */
type CallPlacedRow = CodingAgentMessage & { readonly arrived: readonly CodingAgentMessage[] };

/** A row as the calls are placed among the rows: read anew only for a message a page touched, or whose lines moved. */
function callRowOf({ message, arrived, said }: PlacedRow): CallPlacedRow {
  const lines = said.length === 0 ? arrived : [...arrived, ...said];
  const kept = callRows.get(message);
  if (kept !== undefined && sameLines(kept.lines, lines)) return kept.row;
  const row = { ...message, arrived: lines };
  callRows.set(message, { lines, row });
  return row;
}

/**
 * Each line that reached a turn, with who sent it, by the turn's message:
 * named anew only for a message a page touched or whose lines moved, or
 * once the people it names by are read again, so a page's naming costs as
 * much as its own messages.
 */
function useArrivals(
  placed: readonly PlacedRow[],
  readerId: string | undefined,
  members: Parameters<typeof lineSender>[2],
  former: Parameters<typeof lineSender>[3],
): ReadonlyMap<string, readonly ArrivedLine[]> {
  const kept = useRef<{
    readonly by: readonly unknown[];
    readonly named: WeakMap<
      CodingAgentMessage,
      { readonly lines: readonly CodingAgentMessage[]; readonly arrived: readonly ArrivedLine[] }
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
                sender: lineSender(line.sentBy, readerId, members, former),
              }));
        named.set(message, { lines: arrived, arrived: lines });
        return [message.id, lines];
      }),
    );
  }, [placed, readerId, members, former]);
}

/**
 * How a transcript's messages are placed, read once for the messages held
 * rather than on every draw: where the to-do lists stand, which message
 * opens it, the replay it opens on, each message with the lines that
 * reached it, and the reply a running turn is still writing.
 */
function transcriptPlacing(
  messages: readonly CodingAgentMessage[],
  working: boolean,
  undelivered: ReadonlySet<string>,
  replayed: boolean,
) {
  const todos = todosPlace(messages, working);
  const first = messages.find(
    (message) =>
      message.role === MESSAGE_ROLE.USER &&
      chatNoticeOf(message) === undefined &&
      !undelivered.has(message.id),
  );
  // An agent started from another opens on the brief as its source's did, then the replay's card, then the note.
  const opening = !replayed || first === undefined ? undefined : replayOpening(first);
  // A line that reached a turn while it ran is drawn inside that turn, where it arrived, and the
  // voice's line reading a turn aloud on a call ahead of it, the turn folded behind it.
  const placed = spokenMessages(placedMessages(messages));
  const open = openReply(messages, working);
  return { todos, first, opening, placed, open };
}

/** The transcript as the tab draws it: the messages, or what stands in their place. */
function AgentTranscriptView({
  messages,
  brief,
  lead = AGENT_LEAD,
  delegation,
  reading,
  failed,
  working,
  sessionStarting = false,
  startedAt,
  ended,
  endReason = FAILURE_REASON.OTHER,
  onOpenApiKeys,
  onRetry,
  onOlder,
  overComposer = false,
  earlierOmitted = false,
  briefTitle,
  briefSender,
  origin,
  readerId,
  taskId,
  replay,
  endPress,
  endTrail,
  calls = NO_CALLS,
  bringIn,
  holding = false,
}: {
  messages: readonly CodingAgentMessage[];
  /** Whether the log waits to draw for what stands around it, saying it is loading meanwhile. */
  holding?: boolean;
  /** Where the transcript hands the door that brings a message whose row is not drawn into view, which a link to the message asks through; none where nothing asks. */
  bringIn?: RefObject<MessageBringer | undefined> | undefined;
  /** The calls into the agent, oldest first, which the transcript places among its rows by the call each spoken line names (`callPlaces`); none on a worker's. */
  calls?: readonly TranscriptCallRow[];
  /** What the agent was handed first: the plan, drawn as the plan's card, a prompt, drawn as the developer's message, or nothing, for one started blank, whose first line is drawn as any other; unsaid reads as the plan. */
  brief?: CodingAgentBrief | undefined;
  /** Whose transcript this is: an agent's, with its plan, unless said otherwise. */
  lead?: TranscriptLead;
  /** What a delegation's row draws from; with none, a row says the pair its part carries and opens no tab. */
  delegation?: DelegationDoors | undefined;
  reading: boolean;
  failed: boolean;
  /** Whether the agent may still write, which is when the transcript ends on a working line. */
  working: boolean;
  /** Whether the agent's session has not run its first turn yet, which its working line says. */
  sessionStarting?: boolean;
  /** When the run under way began, which the working line counts from; none where unknown, when the line only shimmers. */
  startedAt?: number | undefined;
  /** The line the transcript ends on once its turn was stopped or failed (`endLineParts`); nothing otherwise. */
  ended?: EndLineParts | undefined;
  /** What mends the turn the end line tells of (`endLineReason`): an API key looked at, or nothing the line offers. */
  endReason?: FailureReason;
  /** Turns to the page holding the API keys, which an end line telling of a key refused offers. */
  onOpenApiKeys?: (() => void) | undefined;
  onRetry: () => void;
  /** Reads the messages older than the first held, which the log asks for as the reader nears its top; none where none stand. */
  onOlder?: (() => void) | undefined;
  /** Whether the composer stands right under the log, which the log's foot then fades into. */
  overComposer?: boolean;
  /** Whether older steps than these were left out, which a note says after the card. */
  earlierOmitted?: boolean;
  /** The plan's or task's card line, where it is named otherwise than by its first line, as a brain's worker is by its job. */
  briefTitle?: string | undefined;
  /** The teammate who handed the agent its task, named over the task's message; none for the reader's own agent. */
  briefSender?: Actor | undefined;
  /** Who handed the agent what it opens on, which is then its card under their line, a prompt among them; none where only a plan is, whose card names nobody. */
  origin?: TranscriptOrigin | undefined;
  /** The reader's own account id, whose messages are drawn with no name over them (`lineSender`). */
  readerId?: string | undefined;
  /** The task the agent works on, whose plan's pictures its plan's card draws; none where it works on none. */
  taskId?: string | undefined;
  /** Where a replay its first message holds is drawn as its own card, between the brief and the note (`replay-card.tsx`); none where no replay is read, as on a worker's tab. */
  replay?: ReplayPlace | undefined;
  /** What the end line's row ends on, after its words: Continue in new agent (`continue-agent.tsx`); nothing where it has no end line. */
  endPress?: ReactNode;
  /** The row under the end line, or at the transcript's end where it has none: the agents that continued it, where an archive took the box (`continue-agent.tsx`). */
  endTrail?: ReactNode;
}): React.JSX.Element {
  const { members, former } = useMemberDirectory();
  const undelivered = useUndeliveredLines();
  // Whether a replay opens the transcript is all its placing reads; the place itself is handed anew on every draw.
  const replayed = replay !== undefined;
  // Read through once for the messages held, so a draw that brings no page reads none of them again.
  const placing = useMemo(
    () => transcriptPlacing(messages, working, undelivered, replayed),
    [messages, working, undelivered, replayed],
  );
  // Each line that reached a turn, with who sent it, kept from draw to draw while neither moved.
  const arrivals = useArrivals(placing.placed, readerId, members, former);
  const cards = delegation?.cards;
  const chat = delegation?.chat;
  const live = useMemo(() => ({ cards, chat }), [cards, chat]);
  // Where each call begins and ends among the rows drawn, a line that reached a turn drawn inside it, and what of the calls heard here no row holds yet.
  const places = useMemo(() => callPlaces(placing.placed.map(callRowOf), calls), [placing, calls]);
  // Note that the clock is the minute's own, so a call's day moves on with it while the rows hold.
  const now = useMinute();
  const heard = places.heard;
  // Each row is keyed by the message it draws, which its measured height is kept by.
  const rowKeys = useKept(
    placing.placed.map(({ message }) => message.id),
    sameIds,
  );
  const log = useRef<HTMLDivElement>(null);
  const rowsHandle = useRef<VirtualRowsHandle>(null);
  // Note that the rows' words are read only while a find bar stands open over the tab.
  const finding = useFindOpen();
  const findRows = useMemo(
    () => (finding ? placing.placed.map(findRowOf) : NO_FIND_ROWS),
    [finding, placing],
  );
  useTranscriptFind({
    root: log,
    rows: findRows,
    handle: rowsHandle,
    findable: rowKeys.length > 0,
  });
  useLayoutEffect(() => {
    if (bringIn === undefined) return;
    bringIn.current = (messageId, then) => {
      const row = placing.placed.find((placed) => drawsMessage(placed, messageId));
      return row !== undefined && rowsHandle.current?.bringIn(row.message.id, then) === true;
    };
  });
  if (!holding && (messages.length > 0 || heard.length > 0)) {
    const { todos, first, opening, placed, open } = placing;
    // The plan is the first of the developer's messages, unless the agent
    // was handed a prompt in its place, which is the developer's message as
    // any other is, but where something sent it, an automation, when it is
    // that sender's card; the rest the developer sent since. An agent
    // started blank was handed nothing, so its first line, typed or spoken,
    // is a line as any other is, under whoever sent it.
    const blank = brief === CODING_AGENT_BRIEF.BLANK && origin === undefined;
    const carded = !blank && (brief !== CODING_AGENT_BRIEF.PROMPT || origin !== undefined);
    const plan = carded ? first : undefined;
    const task = carded || blank ? undefined : first;
    return (
      <LiveDoors value={live}>
        <Conversation list={log} onNearTop={onOlder}>
          {/* The plan's card stands off the tab row by the gap between a column's groups; lines fade under the bar or banner above. */}
          <ConversationContent className={overComposer ? "agent-log-over-composer" : undefined}>
            <ConversationRows
              keys={rowKeys}
              estimate={ROW_ESTIMATE_PX}
              gap={ROW_GAP_PX}
              rowClassName="agent-log-row"
              handle={rowsHandle}
            >
              {(index) => {
                const row = placed[index];
                if (row === undefined) return null;
                const { message, said, read } = row;
                return (
                  <>
                    {(places.opens.get(message.id) ?? NO_CALLS).map((call) => (
                      <CallOpen key={call.key} call={call} now={now} />
                    ))}
                    {said.map((line) => (
                      <SteadyAgentMessage
                        key={line.id}
                        message={line}
                        plan={false}
                        lead={lead}
                        moving={false}
                        forkCut={forkCutOf(line, open)}
                        delegation={delegation}
                        sender={lineSender(line.sentBy, readerId, members, former)}
                      />
                    ))}
                    <SteadyAgentMessage
                      message={message === first && opening !== undefined ? opening.brief : message}
                      plan={message === plan}
                      taskId={message === plan ? taskId : undefined}
                      lead={lead}
                      moving={working && index === placed.length - 1}
                      said={working && index === placed.length - 1 ? undefined : read}
                      forkCut={forkCutOf(message, open)}
                      delegation={delegation}
                      todos={todos}
                      briefTitle={briefTitle}
                      origin={message === plan ? origin : undefined}
                      sender={
                        message === task
                          ? briefSender
                          : lineSender(message.sentBy, readerId, members, former)
                      }
                      arrived={arrivals.get(message.id) ?? NO_ARRIVED}
                    />
                    {message === first && opening !== undefined && replay !== undefined ? (
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
                            plan={false}
                            lead={lead}
                            moving={false}
                            delegation={delegation}
                            sender={briefSender}
                          />
                        )}
                      </>
                    ) : null}
                    {earlierOmitted && message === plan ? (
                      <TranscriptNote>Earlier steps are not shown.</TranscriptNote>
                    ) : null}
                    {(places.closes.get(message.id) ?? NO_CALLS).map((call) => (
                      <CallClose key={call.key} call={call} />
                    ))}
                  </>
                );
              }}
            </ConversationRows>
            {heard.map((tail) => (
              <Fragment key={tail.call.key}>
                <CallOpen call={tail.opened ? undefined : tail.call} now={now} />
                {tail.lines.map((line) => (
                  <SteadyAgentMessage
                    key={line.id}
                    message={heardLine(line)}
                    plan={false}
                    lead={lead}
                    moving={false}
                    delegation={delegation}
                  />
                ))}
                <CallClose call={tail.call.live ? undefined : tail.call} />
              </Fragment>
            ))}
            {working ? (
              <WorkingLine
                startedAt={startedAt}
                words={WORKING_PHASE_WORDS[agentWorkingPhase(messages, sessionStarting)]}
              />
            ) : null}
            {ended === undefined && endTrail === undefined ? null : (
              <div className="agent-end" data-ended={ended === undefined ? undefined : ""}>
                {ended === undefined ? null : (
                  <AgentEndRow
                    ended={ended}
                    endReason={endReason}
                    onOpenApiKeys={onOpenApiKeys}
                    press={endPress}
                  />
                )}
                {endTrail}
              </div>
            )}
            {failed ? <ErrorState onRetry={onRetry}>{TRANSCRIPT_FAILED_LINE}</ErrorState> : null}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>
      </LiveDoors>
    );
  }
  if (failed) {
    return (
      <ErrorState onRetry={onRetry} placement={ERROR_STATE_PLACEMENT.CENTRED}>
        {TRANSCRIPT_FAILED_LINE}
      </ErrorState>
    );
  }
  // Note that the centred column is wider than the empty state's own, so a one-line failure stays one line.
  return (
    <ConversationEmptyState wide>
      {holding || (reading && ended === undefined) ? (
        <Spinner label="Loading transcript" size={SPINNER_SIZE.REGION} />
      ) : (
        <>
          {ended === undefined ? (
            <Text tone={TEXT_TONE.MUTED}>{lead.startingLine}</Text>
          ) : (
            <AgentEndRow
              ended={ended}
              endReason={endReason}
              onOpenApiKeys={onOpenApiKeys}
              press={endPress}
            />
          )}
          {endTrail}
        </>
      )}
    </ConversationEmptyState>
  );
}

/**
 * The tab as drawn from what it holds: the transcript with the lines sent
 * and not yet read back at its end, and the composer under it, or, while
 * the task is archived, the note that offers Unarchive in its place, with
 * the Stop of a turn still running.
 */
function AgentTabView({
  agent,
  models,
  readModels,
  transcript,
  composer,
  model,
  servers,
  published,
  doors,
  startedAt,
  delegationStarts,
  onStop,
  onUnarchive,
  onOpenSubagent,
  onOpenTarget,
  cards,
  chat,
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
  continuable = false,
  calls,
  call: offeredCall,
  bringIn,
  holding = false,
}: {
  agent: CodingAgentSummary;
  /** Whether the log waits to draw for what stands around it, while it says it is loading. */
  holding?: boolean;
  /** Where the transcript hands the door that brings a message whose row is not drawn into view. */
  bringIn?: RefObject<MessageBringer | undefined> | undefined;
  /** The calls into the agent, which its transcript places among its rows (`useAgentCalls`). */
  calls: readonly TranscriptCallRow[];
  /** What the tab takes calls through; none where the platform has no voice. */
  call?: AgentCallDoors | undefined;
  /** Where a replay the agent opens on is drawn (`replay-card.tsx`); none where none is read. */
  replay?: ReplayPlace | undefined;
  /** The automation's run that started the agent, as its page reads it; none on a plan's tab, and for an agent started by hand. */
  run?: CodingAgentOrigin | undefined;
  models: readonly CatalogModel[] | undefined;
  readModels: () => void;
  transcript: AgentTranscriptControl;
  composer: AgentComposerControl;
  model: AgentModelControl;
  servers: AgentServersControl;
  /** What the agent published, once the service has said; nothing before. */
  published: CodingAgentPullRequestAnswer | undefined;
  doors: PublishedDoors;
  /** When the agent's run began, as the working line counts from it; none while the tab is off screen, so nothing counts unseen. */
  startedAt: number | undefined;
  /** When each of its running workers began, as their rows count from it; none while the tab is off screen. */
  delegationStarts: ReadonlyMap<string, number> | undefined;
  onStop: () => Promise<void>;
  /** Brings the task back from the archive; present exactly while it is archived, when no message is sent. */
  onUnarchive?: (() => void) | undefined;
  /** Opens one of the agent's workers in a tab of the panel's own; none where the view stands in no panel. */
  onOpenSubagent?: DelegationDoors["onOpen"];
  /** Opens what one of its calls is about; none where nothing opens it. */
  onOpenTarget?: DelegationDoors["onOpenTarget"];
  /** The cards its rows that open a tab hang; none where they hang their hints. */
  cards?: TranscriptCards | undefined;
  /** The chat a chat notice's card reads and opens; none where the window holds none. */
  chat?: ChatNoticeDoors | undefined;
  openGitHub: (url: string) => void;
  /** Turns to Settings › Agents, which a turn failed on a refused key offers. */
  onOpenApiKeys?: (() => void) | undefined;
  /** The words a dictation into the box is likely to say. */
  keywords?: readonly string[] | undefined;
  /** Where the skills a `/` in the box offers are read from; nothing where it offers none. */
  skills?: SkillSource | undefined;
  /** The teammate who started the agent (`teammateStarter`), whose key and task the tab names; none for the reader's own. */
  starter?: string | undefined;
  /** The reader's own account id, whose messages the transcript names nobody over, and whose Mac its Mac commands say is theirs. */
  readerId?: string | undefined;
  /** What a failed turn's end line ends on, on its row (`continue-agent.tsx`); none where it ends on its words. */
  endPress?: ReactNode;
  /** The row under the end line, or at the transcript's end: the agents that continued it, where an archive took the box. */
  endTrail?: ReactNode;
  /** What mends the box once it closed for good (`continue-agent.tsx`). */
  closedRemedy?: ReactNode;
  /** What stands in the box's place once another agent continued this one (`ContinuedComposerNote`); none while none has. */
  continuedNote?: ReactNode;
  /** Whether the tab offers Continue somewhere, or another agent continued this one, so the end line tells no one to start a new one. */
  continuable?: boolean;
}): React.JSX.Element {
  // Note that an agent on a provider's own harness takes no call, so its tab draws neither the button nor the foot.
  const call = takesCalls(agent) ? offeredCall : undefined;
  const onCall = useAgentOnCall(agent.id) && call !== undefined;
  const lines = useMemo(
    () => agentLines(transcript.messages, composer.sent),
    [transcript.messages, composer.sent],
  );
  const chatOn = useChatOn();
  const working = agentStillWriting(agent.status);
  const steering = useKept(
    new Set(composer.sent.filter((line) => line.steers).map((line) => line.id)),
    sameSet,
  );
  const undelivered = useKept(
    new Set(composer.sent.filter((line) => line.undelivered === true).map((line) => line.id)),
    sameSet,
  );
  const starterActor = usePerson(agent.startedBy);
  const pictures = useAgentPictureDoor(agent.id);
  const wholeParts = useWholePartDoor(agent.id);
  const { members, former } = useMemberDirectory();
  const tab = useRef<HTMLElement>(null);
  // The door the box hands Reply, which lays a quote in at its caret.
  const replyDoor = useRef<((words: string) => void) | undefined>(undefined);
  const macOwner = useKept(macOwnerOf(agent.startedBy, members, readerId, former), sameFields);
  const disabledServers = servers.disabled;
  const mentioned = useMemo(
    () => ({ disabled: disabledServers, steering }),
    [disabledServers, steering],
  );
  // The presses the transcript's rows hand on are the same door from draw to draw, so a message kept as it was opens what the window opens now.
  const openSubagent = useSteady(onOpenSubagent);
  const openTarget = useSteady(onOpenTarget);
  const steadyGitHub = useSteady(openGitHub) ?? openGitHub;
  // An agent started from an automation's run opens on the run's prompt under the automation.
  const briefed = replay === undefined ? agent : briefAgent(agent, replay.agents);
  const { automationId, automationName, brief } = briefed;
  // The task's line reads the task live (`TaskSender`), so whether there is one is all the card's sender hangs on here.
  const briefTask = cards?.task;
  const tasked = briefTask !== undefined;
  const originStarter = useKept(starter === undefined ? undefined : starterActor, sameFields);
  // The plan's card is drawn again only when who handed it, or what, changed, not with each page.
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
    // Note that the agent is read for how it was briefed alone, which these name.
    [automationId, automationName, brief, run, tasked, openTarget, originStarter, steadyGitHub],
  );
  return (
    <section
      ref={tab}
      className="agent-tab ph-no-capture"
      aria-label={agentTabLabel(agent, models)}
    >
      <MacOwnerProvider value={macOwner}>
        <AgentPicturesProvider value={pictures}>
          <WholePartsProvider value={wholeParts}>
            <MentionedServers value={mentioned}>
              <UndeliveredLines value={undelivered}>
                <AgentTranscriptView
                  messages={lines}
                  brief={agent.brief}
                  briefSender={starter === undefined ? undefined : starterActor}
                  origin={origin}
                  readerId={readerId}
                  taskId={agent.planId ?? undefined}
                  replay={replay}
                  delegation={{
                    models,
                    own: { model: agent.model, effort: agent.effort },
                    starts:
                      delegationStarts && workerStarts(delegationStarts, transcript.subagents),
                    onOpen: openSubagent,
                    onOpenTarget: openTarget,
                    cards,
                    standings: transcript.subagents,
                    chat,
                    chatOn,
                  }}
                  reading={transcript.reading || holding}
                  holding={holding}
                  failed={transcript.failed}
                  working={working}
                  sessionStarting={agent.status === CODING_AGENT_STATUS.STARTING}
                  startedAt={startedAt}
                  ended={
                    // Note that the end line waits for a page, so a stopped agent's tab never draws it over nothing.
                    transcript.pages === 0
                      ? undefined
                      : endLineParts(agent.status, transcript.failure, starter, continuable)
                  }
                  endReason={endLineReason(transcript.failure, starter)}
                  onOpenApiKeys={onOpenApiKeys}
                  endPress={endPress}
                  endTrail={endTrail}
                  onRetry={transcript.onRetry}
                  onOlder={transcript.hasOlder ? transcript.loadOlder : undefined}
                  overComposer
                  calls={calls}
                  bringIn={bringIn}
                />
              </UndeliveredLines>
            </MentionedServers>
          </WholePartsProvider>
        </AgentPicturesProvider>
      </MacOwnerProvider>
      <footer className="agent-tab-foot">
        {call === undefined ? null : <AgentCallFoot agentId={agent.id} />}
        <TodosDock messages={lines} working={working} />
        <PublishedDock published={published} doors={doors} />
        {onUnarchive !== undefined ? (
          <ArchivedComposerNote
            onUnarchive={onUnarchive}
            stop={agent.status === CODING_AGENT_STATUS.RUNNING ? onStop : undefined}
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
            composer={composer}
            model={model}
            models={models}
            readModels={readModels}
            usage={transcript.usage}
            servers={servers}
            context={transcript.context}
            brief={agent.brief}
            published={published}
            doors={doors}
            onStop={onStop}
            // Note that a started agent's conversation always opens on its plan or
            // task, so the box takes a follow up even before the transcript is read.
            followsUp
            keywords={keywords}
            skills={skills}
            replyDoor={replyDoor}
            closedRemedy={closedRemedy}
            payer={
              agent.runtime === CODING_AGENT_RUNTIME.CODEX ? (
                <ChatGptPlanLabel
                  starter={readerId !== undefined && agent.startedBy?.userId === readerId}
                  status={agent.status}
                />
              ) : agent.runtime === CODING_AGENT_RUNTIME.CLAUDE_CODE ? (
                <ClaudePlanLabel
                  starter={readerId !== undefined && agent.startedBy?.userId === readerId}
                  status={agent.status}
                />
              ) : undefined
            }
            call={
              call === undefined ? undefined : (
                <AgentCallControls
                  agentId={agent.id}
                  archived={onUnarchive !== undefined}
                  doors={call}
                />
              )
            }
            // Note that a call holds the microphone, so its own mute stands where Dictate would.
            dictates={!onCall}
          />
        )}
      </footer>
      {/* Note that Reply stands only while the box takes a change, as a file's + does. */}
      {onUnarchive !== undefined ||
      continuedNote !== undefined ||
      composer.closed !== undefined ||
      composer.sending ? null : (
        <ReplyToSelection scope={tab} onReply={(words) => replyDoor.current?.(words)} />
      )}
    </section>
  );
}

export function AgentTab({
  agent,
  control,
  shown,
  onOpenSubagent,
  onOpenPullRequest,
  onOpenTarget,
  cards,
  chat,
  onHeld,
  run,
  call,
}: {
  agent: CodingAgentSummary;
  /** The automation's run that started the agent, as its page reads it; none on a plan's tab. */
  run?: CodingAgentOrigin | undefined;
  /** What the tab takes calls through; none where the platform has no voice. */
  call?: AgentCallDoors | undefined;
  control: CodingAgentsControl;
  /** Whether the tab is on screen: the task's column showing it, on the Tasks tab. */
  shown: boolean;
  /** Opens one of the agent's workers in a tab of the side panel's own, by the call that started it. */
  onOpenSubagent: (callId: string, task: string, status: CodingAgentStatus) => void;
  /** Opens what one of its calls is about in the tab that draws it. */
  onOpenTarget?: DelegationDoors["onOpenTarget"];
  /** The cards its rows that open a tab hang, as those tabs hang them. */
  cards?: TranscriptCards | undefined;
  /** Opens the agent's pull request, its checks, description, and conversation, in a tab of the side panel's own. */
  onOpenPullRequest?: (() => void) | undefined;
  /** The chat a chat notice's card reads its message from and opens in; none where the window holds none. */
  chat?: ChatNoticeDoors | undefined;
  /** Hears the transcript the tab holds each time it moves, which the tab's hover card previews once the tab is not shown. */
  onHeld: (agentId: string, held: HeldTranscript) => void;
}): React.JSX.Element {
  const { tell } = useAct();
  const transcript = useAgentTranscript({
    transcript: { kind: TRANSCRIPT_KIND.AGENT, agentId: agent.id },
    shown,
    follower: control.transcripts,
    onStatus: control.onStatus,
    onTitle: control.onTitle,
  });
  const { messages, pageStatus, runStartedAt, subagentTitles } = transcript;
  const { calls, settled: callsSettled } = useAgentCalls({
    agentId: agent.id,
    read: control.readCalls,
    messages,
    readerId: control.me,
  });
  // Note that what is held is dated by the page it was read from, never by
  // the summary, because the summary moves on to a new turn before its
  // messages land; and nothing is said before a page has landed.
  useEffect(() => {
    if (pageStatus === undefined || messages.length === 0) return;
    const status = pageStatus;
    onHeld(agent.id, { messages, status, runStartedAt, title: undefined, subagentTitles });
  }, [onHeld, agent.id, messages, pageStatus, runStartedAt, subagentTitles]);
  // A plan edit that answered has changed the plan the window holds, so the host re-reads it;
  // the edits already on screen when the tab opened are the plan's as it was read.
  const settledEdits = settledPlanEdits(transcript.messages);
  const seenEdits = useRef(settledEdits);
  useEffect(() => {
    if (settledEdits <= seenEdits.current) return;
    seenEdits.current = settledEdits;
    tell(ACT_KIND.TASKS_REFRESH);
  }, [settledEdits, tell]);
  // An agent this one started, archived, or brought back moves in the plan's agents only once
  // they are read again, so a call that answered after the tab opened has them read; those
  // already there were read with the plan.
  const listCalls = useMemo(() => agentListCallIds(transcript.messages), [transcript.messages]);
  const seenListCalls = useRef<ReadonlySet<string>>(new Set(listCalls));
  const readAgents = control.onRetryList;
  useEffect(() => {
    const landed = listCalls.some((id) => !seenListCalls.current.has(id));
    seenListCalls.current = new Set(listCalls);
    if (landed) readAgents();
  }, [listCalls, readAgents]);
  // A start that made a new task, or a call that made, deleted, or filled a section, changes the
  // sidebar only once the tasks are read again.
  const sidebarCalls = useMemo(() => sidebarCallIds(transcript.messages), [transcript.messages]);
  const seenSidebarCalls = useRef<ReadonlySet<string>>(new Set(sidebarCalls));
  useEffect(() => {
    const landed = sidebarCalls.some((id) => !seenSidebarCalls.current.has(id));
    seenSidebarCalls.current = new Set(sidebarCalls);
    if (landed) tell(ACT_KIND.TASKS_REFRESH);
  }, [sidebarCalls, tell]);
  const composer = useAgentComposer({
    agentId: agent.id,
    taskId: agent.planId,
    messages: transcript.messages,
    running: agent.status === CODING_AGENT_STATUS.RUNNING,
    send: control.onMessage,
    payer: planPayerOf(agent.runtime),
    onStatus: control.onStatus,
  });
  const model = useAgentModel({ agent, choose: control.onChoose });
  const servers = useAgentServers({
    agent,
    write: control.onSwitchServers,
    onOpenSettings: control.onOpenIntegrations,
  });
  const { published, settled: publishedSettled } = useAgentPullRequest({
    agentId: agent.id,
    status: agent.status,
    shown,
    messages: transcript.messages,
    read: control.readPullRequest,
    known: control.pullRequests.get(agent.id),
  });
  // Note that the log first draws once what stands around it has landed too: the pull request's dock over the box, and the dividers of calls its lines were said on, so neither moves a line the reader sees.
  const surroundsLanded =
    publishedSettled &&
    (callsSettled || !messages.some((message) => callOfLine(message) !== undefined));
  const opened = useRef(false);
  if (surroundsLanded) opened.current = true;
  const holding = messages.length > 0 && !opened.current;
  const copyWithToast = useCopyToast();
  const openGitHub = (url: string) => appPlatform().openGitHub(url);
  // A link to one of its messages is answered once the transcript has landed, here or by saying it is gone.
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
    gone: () => toast({ words: MESSAGE_GONE, tone: TOAST_TONE.FAILED, hold: TOAST_HOLD.FAILED }),
  });
  const starter = teammateStarter(agent.startedBy, control.me);
  const openAgent =
    onOpenTarget === undefined
      ? undefined
      : (agentId: string) => onOpenTarget({ kind: TOOL_TARGET.AGENT, agent: agentId });
  // The agents that continued this one, as its summary or the task's list names them: a fork is none.
  const continued = continuedByIds(agent, control.agents, control.archived);
  const continuedDoors = {
    agentIds: continued,
    titles: continuedByTitles(agent),
    control,
    onOpenAgent: openAgent,
  };
  // The box's words and files, which a press carries into the continue where it takes the box's place.
  const carry = {
    words: composer.unsent.words,
    attachments: composer.unsent.attachments,
    taskId: agent.planId,
  };
  // The failed end line holds the press, Continue again once another agent continued this one.
  const pressed = endLineOffersContinue({
    status: agent.status,
    endReason: endLineReason(transcript.failure, starter),
    continued: continued.length > 0,
    boxClosed: composer.closed !== undefined,
  });
  // How the messages are named moves only when the agent's place or the messages read do, not with each page.
  const readIds = useKept(
    messages.map((message) => message.id),
    sameIds,
  );
  const planId = agent.planId;
  const messagePlace = useMemo(
    () =>
      agentMessagePlace(
        { id: agent.id, planId },
        readIds.map((id) => ({ id })),
      ),
    [agent.id, planId, readIds],
  );
  return (
    <MessagePlaceProvider value={messagePlace}>
      <AgentTabView
        agent={agent}
        calls={calls}
        call={call}
        bringIn={bringIn}
        holding={holding}
        models={control.models}
        readModels={control.readModels}
        transcript={transcript}
        composer={composer}
        model={model}
        servers={servers}
        published={published}
        doors={{
          openGitHub,
          copy: copyWithToast,
          openPullRequest: onOpenPullRequest,
        }}
        startedAt={shown ? agent.runStartedAt : undefined}
        delegationStarts={shown ? transcript.delegations : undefined}
        onStop={() => control.onStop(agent.id)}
        onUnarchive={control.onUnarchive}
        onOpenSubagent={onOpenSubagent}
        onOpenTarget={onOpenTarget}
        cards={cards}
        chat={chat}
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
            // Note that once continued, the press carries the box's words, which the continued note hides.
            <ContinueAgent
              agentId={agent.id}
              control={control}
              carry={continued.length > 0 ? carry : undefined}
              label={continued.length > 0 ? CONTINUE_AGAIN_LABEL : CONTINUE_LABEL}
            />
          ) : undefined
        }
        continuable={continued.length > 0 || control.continueAgent !== undefined}
        endTrail={
          // Note that the box's note names them while it stands, so the transcript names them only where an archive took the box.
          continued.length === 0 || control.onUnarchive === undefined ? undefined : (
            <ContinuedTrail {...continuedDoors} />
          )
        }
        continuedNote={
          continued.length === 0 ? undefined : (
            <ContinuedComposerNote
              agent={agent}
              doors={continuedDoors}
              stop={
                agent.status === CODING_AGENT_STATUS.RUNNING
                  ? () => control.onStop(agent.id)
                  : undefined
              }
              control={control}
              shown={shown}
            />
          )
        }
        closedRemedy={<ContinueAgent agentId={agent.id} control={control} carry={carry} />}
      />
    </MessagePlaceProvider>
  );
}

/**
 * One of an agent's workers in a tab of the side panel's own: its transcript,
 * read under the agent and the call that started it and followed while
 * the worker runs, drawn as the agent's is with the task it was handed in
 * the plan's place, a working line at its end while it runs, counting
 * from the start its pages say, and no head and no composer, since the
 * tab's own label names the task and nothing is sent to a worker. Where
 * the worker stands is what its pages say, which the panel keeps for the
 * tab's glyph (`onStatus`).
 */
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
}: {
  agentId: string;
  callId: string;
  task: string;
  /** Who handed the worker its task, named under its card: the agent that delegated it, which opens its tab; none where the panel names nobody. */
  sender?: ReactNode;
  status: CodingAgentStatus;
  control: CodingAgentsControl;
  shown: boolean;
  /** A page said where the worker stands now. */
  onStatus: (status: CodingAgentStatus) => void;
  /** Hears the transcript the tab holds each time it moves, by the call that started the worker, as an agent's tab says its own. */
  onHeld: (callId: string, held: HeldTranscript) => void;
}): React.JSX.Element {
  const transcript = useAgentTranscript({
    transcript: { kind: TRANSCRIPT_KIND.AGENT, agentId, callId },
    shown,
    follower: control.transcripts,
    onStatus: (_agentId, next) => onStatus(next.status),
    // A worker's page names the worker's conversation, which is no title of the agent's.
    onTitle: () => undefined,
  });
  const { messages, pageStatus, runStartedAt, pageTitle } = transcript;
  // A worker runs as its agent does, so a command it ran on a Mac ran on its agent's starter's.
  const owner =
    control.agents?.find((each) => each.id === agentId) ??
    control.archived?.find((each) => each.id === agentId);
  const pictures = useAgentPictureDoor(agentId, callId);
  const wholeParts = useWholePartDoor(agentId, callId);
  const { members, former } = useMemberDirectory();
  const macOwner = useKept(macOwnerOf(owner?.startedBy, members, control.me, former), sameFields);
  // The worker's lines, its task first, and what its rows draw from, kept from draw to draw while none of it moved.
  const lines = useMemo(() => workerLines(task, transcript.messages), [task, transcript.messages]);
  const models = control.models;
  const delegation = useMemo(() => ({ models }), [models]);
  const origin = useMemo(() => (sender === undefined ? undefined : { sender }), [sender]);
  // As an agent's: dated by the page it was read from, with the worker's own title.
  useEffect(() => {
    if (pageStatus === undefined || messages.length === 0) return;
    const held = { messages, status: pageStatus, runStartedAt, title: pageTitle };
    onHeld(callId, { ...held, subagentTitles: new Map() });
  }, [onHeld, callId, messages, pageStatus, runStartedAt, pageTitle]);
  return (
    <section className="agent-tab ph-no-capture" aria-label={cardTitle(task)}>
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
              working={agentStillWriting(status)}
              sessionStarting={status === CODING_AGENT_STATUS.STARTING}
              startedAt={shown ? transcript.runStartedAt : undefined}
              ended={transcript.pages === 0 ? undefined : endLineParts(status, transcript.failure)}
              onRetry={transcript.onRetry}
              onOlder={transcript.hasOlder ? transcript.loadOlder : undefined}
            />
          </WholePartsProvider>
        </AgentPicturesProvider>
      </MacOwnerProvider>
    </section>
  );
}
