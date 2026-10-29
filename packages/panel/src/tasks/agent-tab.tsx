import { AGENT_TOOL } from "@luke/features/agent-tools";
import { TRANSCRIPT_KIND } from "@luke/features/agent-view";
import {
  AGENT_BRIEF,
  AGENT_KIND,
  AGENT_STATUS,
  type AgentBrief,
  type AgentOrigin,
  type AgentPullRequestAnswer,
  type AgentStatus,
  type AgentSubagentStanding,
  type AgentSummary,
  type AgentTodos,
  type AgentTranscriptMessage,
  agentMessageWords,
} from "@luke/features/agent-wire";
import { FAILURE_REASON, type FailureReason, remedyLabel } from "@luke/features/failure-remedy";
import { threadLineWords } from "@luke/features/inbox-wire";
import type { CatalogModel, ModelChoice, ModelProvider } from "@luke/features/models-wire";
import type { KnownNames } from "@luke/features/place-chip-model";
import { FAILURE_CONDITION, FAILURE_SURFACE } from "@luke/features/shown-failure";
import type { TaskStatus } from "@luke/features/task-wire";
import {
  CALL_KIND,
  CALL_WORDS,
  isMadeCallKind,
  sameFieldsBy,
  sameShape,
} from "@luke/features/turn-rows";
import { replyFromWords } from "@luke/features/words";
import { ACT_KIND } from "@luke/host/acts";
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
  INLINE_REF_LOOK,
  InlineRef,
  LineSummary,
  MESSAGE_LINE_ALIGN,
  MessageHead,
  MessageLine,
  OneLine,
  STATUS_TONE,
  SUBJECT_FIT,
  TaskStatusMark,
  TEXT_ELEMENT,
  TEXT_LINK_LOOK,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  TextLink,
  useAnnounce,
} from "@luke/ui";
import { ACTOR_KIND, ACTOR_STATE, type Actor } from "@luke/ui/actor-model";
import { skillWord } from "@luke/ui/skill-mention";
import { pullRequestLabelOf } from "@luke/ui/tab-strip-model";
import { useDisclosure } from "@luke/ui/use-disclosure";
import type { VirtualRowsHandle } from "@luke/ui/virtual-rows";
import { type GitHubLineMetadata, MESSAGE_ROLE, type WireValue } from "@luke/wire";
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
import { useAct } from "../act.js";
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
import { Message, MessageContent, RECEIVED_MESSAGE_CLASS } from "../ai-elements/message.js";
import { Plan, PlanContent, PlanHeader, PlanIcon, PlanTitle } from "../ai-elements/plan.js";
import { TOOL_BLOCK, TOOL_STATE } from "../ai-elements/tool.js";
import { appPlatform } from "../app-platform.js";
import { useAutomation } from "../automation-directory.js";
import { copyThroughShell, useCopyToast } from "../copy-feedback.js";
import { failureShown, unreadShown } from "../failure-report.js";
import { useFindOpen } from "../find-in-tab.js";
import { useMemberDirectory, usePerson } from "../member-directory.js";
import { TOAST_HOLD, useToast } from "../toast.js";
import { AgentComposer, COMPOSER_DOCK_CLASS, LOG_OVER_COMPOSER_CLASS } from "./agent-composer.js";
import {
  AGENT_PART,
  type AgentPart,
  type AgentPartCut,
  agentLines,
  agentListCallIds,
  agentMessageOf,
  agentName,
  agentPart,
  agentParts,
  agentRows,
  agentStillWriting,
  agentWorkingPhase,
  archivedByReading,
  CONTINUE_AGAIN_LABEL,
  CONTINUE_LABEL,
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
  lineSender,
  macOwnerOf,
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
  settledPlanEdits,
  sidebarCallIds,
  type TurnStretch,
  teammateStarter,
  threadLineOf,
  transcriptRowKey,
  turnStretches,
  unreadOpeningLine,
  WORKING_PHASE_WORDS,
  workerLines,
  workerStatusOf,
  workerToolState,
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
import { SendingAgent } from "./agent-ref.js";
import type { AgentServersControl } from "./agent-servers.js";
import type { HeldTranscript } from "./agent-tab-card.js";
import { AgentTabFoot, AgentTabFrame } from "./agent-tab-frame.js";
import { AgentTabSkeleton, ComposerSkeleton, TranscriptSkeleton } from "./agent-tab-skeleton.js";
import { dockedTodos, newestTodos, taskTodos, todosOfPart } from "./agent-todos.js";
import { ArchivedComposerNote } from "./archived-note.js";
import { ConnectionNames, useServerName } from "./connection-names.js";
import { ContinueAgent, ContinuedComposerNote, ContinuedTrail } from "./continue-agent.js";
import { CopyMessageAction } from "./copy-message.js";
import { EditComposer } from "./edit-composer.js";
import { ForkedToLine, useForkOffered } from "./fork-action.js";
import { type ForkCut, forkCutOf, openReply } from "./fork-model.js";
import { GitHubLineCard, ThreadLineHead, TranscriptAgent } from "./line-cards.js";
import { linkChip } from "./mention-chip.js";
import type { MentionHolder } from "./mention-holder.js";
import {
  agentMessagePlace,
  MESSAGE_GONE,
  MessagePlaceProvider,
  useMessageReveal,
} from "./message-links.js";
import { PilotComposerNote } from "./pilot-note.js";
import { PlanPictures } from "./plan-pictures.js";
import { ORIGIN_CHIP, ReplayCard, type ReplayPlace, replayPlace } from "./replay-card.js";
import { briefAgent, replayOpening } from "./replay-card-model.js";
import { REPLY_SCOPE, ReplyToSelection } from "./reply-to-selection.js";
import { REWIND_ACTION, RewindProvider, rewindPoints, useMessageEdit } from "./rewind-action.js";
import { MentionedServers, SentToAgent } from "./server-card.js";
import { SentWords, useSkill } from "./skill-chip.js";
import type { SkillSource } from "./skill-picker.js";
import { SkillCard } from "./skill-ref.js";
import { PlanGlyph } from "./tab-look.js";
import { useMentionDoors } from "./task-mentions.js";
import {
  calledAgent,
  cardTitle,
  delegationView,
  isServerCallTool,
  loadedSkill,
  sentWords,
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
import { type FindRow, useTranscriptFind } from "./transcript-find.js";
import { keptPieces, PIECE_ROWS, pieceKey, type TurnPiece, turnPieces } from "./turn-pieces.js";
import {
  UndeliveredLines,
  UndeliveredMark,
  useLineMarked,
  useLineSending,
  useUndeliveredLines,
} from "./undelivered-mark.js";
import { type HeldComposer, useAgentComposer } from "./use-agent-composer.js";
import { type AgentModelControl, useAgentModel } from "./use-agent-model.js";
import { useAgentPullRequest } from "./use-agent-pull-request.js";
import { useAgentServers } from "./use-agent-servers.js";
import { type AgentTranscriptControl, useAgentTranscript } from "./use-agent-transcript.js";
import type { AgentsControl } from "./use-agents.js";
import { useKnownNames, useTaskStatus } from "./use-known-names.js";
import { type CutBody, useWholePart, useWholePartDoor, WholePartsProvider } from "./whole-parts.js";
import { WorkedFor, WorkingLine } from "./working-time.js";

/**
 * agent-tab.tsx -- one coding agent's tab in the task's column: its transcript live, and the message box under it wearing what it runs on and what it published.
 *
 * The transcript is drawn as every transcript is (`transcript-blocks.tsx`
 * over `../ai-elements/`), from the agent's stored `UIMessage`s as they
 * are, and reads as a devtool's agent pane: what it was handed opens it as a message sent to it, at a sent
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
 * a line of its own, saying the task
 * and the model and effort the worker runs on, the whole line the one
 * button that opens the worker's own tab in the side panel (`AgentSubagentTab`),
 * each call about something the window draws in a tab of its own, a page,
 * an agent, code shown, the plan, or the Inbox, the one
 * button that opens that tab (`toolTarget`), each write
 * of its to-do list the list on a row of its own where it landed, open
 * while it is the newest and folded once a newer one stands, the newest
 * docked over the composer instead while the agent works through it, and its
 * runs of calls and its finished lead folded (`turn-rows.ts`); a message
 * the developer sent it after the plan is the developer's bubble, each skill it
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
 * why where the service said. The list keeps to its newest line while it
 * is scrolled there. A link in the
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

/** An agent's transcript: the plan it was handed, and the agent starting. */
export const AGENT_LEAD: TranscriptLead = {
  label: "Plan",
  icon: <DocumentIcon />,
  plan: true,
  startingLine: "The agent is starting.",
};

/** The plan's own tab, which a task's name over its plan's card opens. */
const TASK_TARGET: ToolTarget = { kind: TOOL_TARGET.PLAN };

/** The height a transcript's row is taken to have before it is drawn and measured, in pixels: a short turn's, with the log's step before it (`--luke-space-12`), which a row holds itself (tasks.css's `.agent-log-row-next`). */
const ROW_ESTIMATE_PX = 172;

/** What the tab says where its transcript could not be read. */
const TRANSCRIPT_FAILED_LINE = "The transcript could not be read.";
const OLDER_FAILED_LINE = "Earlier messages could not be read.";

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

/** What the header of a webhook body's card names it: the body is whatever the caller sent, so it is named for what it is rather than a language. */
const WEBHOOK_BODY_KIND = "body";

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
  readonly status: AgentStatus;
}

/**
 * The cards a transcript's rows hang in their hints' place, each the card
 * the tab the row opens hangs: an agent's for a call about one, a worker's
 * for a delegation's row (`agent-ref.tsx`); none where that tab hangs
 * none, when the row's hint says what it opens.
 */
export interface TranscriptCards {
  /** The card the tab `target` opens hangs, `name` being what the row calls it, which a card not yet read names it by. */
  readonly target: (target: ToolTarget, name?: string) => ReactNode;
  readonly worker: (worker: DelegatedWorker) => ReactNode;
  /** One of the place's agents as its tab wears it, which a call about the agent names it by (`calledAgentActor`); none where the place does not list it. */
  readonly agent?: ((agentId: string) => Actor | undefined) | undefined;
  /** The task whose plan an agent was handed, which its card's sender line names; none where the place knows no task. */
  readonly task?: BriefTask | undefined;
  /** What the transcript stands on, its task or its agent on no task, under which the plan and a page a call made are linked where the place's mentions hold neither, as an agent's own page does not hold its task; none where the place does not say. */
  readonly standsOn?: MentionHolder | undefined;
}

/** What a delegation's row draws from beyond its part: the catalog its pair is named from, the agent's own pair for a half the agent left to its own, when each running worker began, and the press that opens the worker's tab. */
export interface DelegationDoors {
  models: readonly CatalogModel[] | undefined;
  own?: ModelChoice | undefined;
  /** When each running worker began, by the call that started it, which its row counts from; none while the tab is off screen, so nothing counts unseen. */
  starts?: ReadonlyMap<string, number> | undefined;
  /** Opens the worker's tab, by the call that started it, with the task and where the worker stands as the row knows it; none where the row stands in a tab that opens no tab. */
  onOpen?: ((callId: string, task: string, status: AgentStatus) => void) | undefined;
  /** Opens what a call is about in the tab that draws it (`toolTarget`), which the row of such a call asks for; none where nothing opens one, when every such call folds open in place. */
  onOpenTarget?: ((target: ToolTarget) => void) | undefined;
  /** The cards the rows that open a tab hang, as those tabs hang them; none where the rows hang their hints. */
  cards?: TranscriptCards | undefined;
  /** Where each worker stands as its own session reads, by the call that started it, which its row says over the call's own state; none from a service older than it. */
  standings?: ReadonlyMap<string, AgentSubagentStanding> | undefined;
  /** The job of each worker by its task, which a stop's row names in the task's place; none where the transcript knows no task's job. */
  jobs?: WorkerJobs | undefined;
}

/**
 * The doors a transcript's rows read as the window draws them now: the
 * cards they hang. The window hands them anew on every draw, so they ride
 * beside the messages rather than in them, and a message kept as it was
 * (`sameMessageDraw`) still hangs today's cards.
 */
const LiveDoors = createContext<Pick<DelegationDoors, "cards"> | undefined>(undefined);

/**
 * The parts of a transcript the reader opened on, as its follow's first page
 * drew them (`standing`), which a text part reads as it is first drawn: words
 * written before the reader looked stand, and only the words written after
 * fade in. Note that the parts are the reads the rows draw (`agentParts`),
 * so a part is looked up as itself, and the set moves only when a follow
 * opens, never with a page. Where a transcript hands none, every part stands.
 */
const StandingParts = createContext<ReadonlySet<AgentPart> | undefined>(undefined);

/** The live doors where a transcript hands them, else what `doors` carries. */
function useLiveDoors(
  doors: Pick<DelegationDoors, "cards"> | undefined,
): Pick<DelegationDoors, "cards"> | undefined {
  return useContext(LiveDoors) ?? doors;
}

/**
 * Another coding agent's message, sent with `message_agent`, as its
 * sender's bubble at the column's left: the sender over it by its own chip,
 * which opens it, or by the name its row kept where the sender is gone, its
 * words as a person reads them, without the lines that are the agent's
 * alone (`agentMessageWords`), then when it arrived, and Copy and Copy link.
 */
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

/**
 * What GitHub said on the agent's pull request, at the column's left as
 * another's line stands: its card (`GitHubLineCard`) in a bubble's place, then who said it by their
 * login, when it arrived, and Copy, which copies their words.
 */
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
      <GitHubLineCard line={line} />
      <MessageLine
        align={MESSAGE_LINE_ALIGN.START}
        sender={sender}
        at={message.sentAt}
        actions={<CopyMessageAction words={words} copyable={words !== ""} messageId={message.id} />}
      />
    </Message>
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
  made,
  cut,
}: {
  part: Extract<AgentPart, { kind: typeof AGENT_PART.TOOL }>;
  jobs?: WorkerJobs | undefined;
  cards?: TranscriptCards | undefined;
  /** The chip of what the call made, which its row names it by (`MadeCallView`). */
  made?: TranscriptToolProps["made"];
  cut?: CutBody | undefined;
}): ReactNode {
  const view = toolCallView({ ...part, jobs });
  const server = useServerName(view);
  const known = useKnownNames();
  // Note that the chip of the agent a call is about hangs the card its tab hangs, which the place hands over by the agent's id.
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
  standings: ReadonlyMap<string, AgentSubagentStanding> | undefined,
): readonly AgentSubagentStanding[] {
  return [...(standings?.values() ?? [])].filter(
    (standing) => workerToolState(standing.status) === TOOL_STATE.INPUT_AVAILABLE,
  );
}

/** When each running worker began: the newest turn's waits, and every worker its own session says still runs. */
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
  // A native harness's subagent has no worker's tab to open yet.
  const native = nativeSubagent(part);
  const opens = onOpen !== undefined && !native;
  // Note that a row that opens no tab folds its task and answer open under its line instead: a native subagent's as
  // its call's own body reads them, and a worker's own worker's, whose transcript no tab reads, as its delegation says.
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

/**
 * One call carrying the agent's to-do list, a write of the whole list or a
 * call on Claude Code's task list (`agent-todos.ts`): the list as it stood
 * after the call, open while it is the newest and folded once a newer one
 * stands, or a call's row where no list reads from it. Note that the row is
 * keyed by whether it is open, because the fold reads `defaultOpen` once.
 */
function TodosRow({
  part,
  todos,
  open,
  live,
}: {
  part: Extract<AgentPart, { kind: typeof AGENT_PART.TOOL }>;
  todos: AgentTodos["todos"] | undefined;
  open: boolean;
  live: boolean;
}): ReactNode {
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

/** Where the transcript draws the agent's to-do lists: the call whose list stays out of a finished turn's fold, the call whose list is drawn open, none while the list is docked above the composer, the call whose list the agent is at, none once it stops, and the list as it stood after each of Claude Code's task calls (`taskTodos`). */
interface TodosPlace {
  readonly kept: string | undefined;
  readonly open: string | undefined;
  readonly live: string | undefined;
  readonly lists: ReadonlyMap<string, AgentTodos["todos"]>;
}

/** A transcript that holds no to-do list, as the brain's does not. */
const NO_TODOS: TodosPlace = {
  kept: undefined,
  open: undefined,
  live: undefined,
  lists: new Map(),
};

/** Whether two places draw the to-do lists alike: the same calls kept, open, and live, and each task call's list the one it was; none alike only with none. */
function sameTodosPlace(a: TodosPlace | undefined, b: TodosPlace | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return (
    a.kept === b.kept && a.open === b.open && a.live === b.live && sameEntries(a.lists, b.lists)
  );
}

/** Where the to-do lists are drawn for the transcript given: the newest kept and open, unless it is docked while the agent works on it, and live while the agent works. */
function todosPlace(messages: readonly AgentTranscriptMessage[], working: boolean): TodosPlace {
  const lists = taskTodos(messages);
  const standing = newestTodos(messages, lists);
  const docked = dockedTodos(standing, working);
  return {
    kept: standing?.callId,
    open: docked === undefined ? standing?.callId : undefined,
    live: working ? standing?.callId : undefined,
    lists,
  };
}

/** The list the agent is working through, docked above the composer; nothing where none is (`dockedTodos`). */
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

/** The agent's pull request, pinned over the box under the to-do list for as long as it stands, whether the agent works or has ended; nothing before one does. */
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
      hint={subject.skill.path ?? skillWord(subject.skill.name)}
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

/** A call's target where it is an agent. */
type AgentTarget = Extract<ToolTarget, { readonly kind: typeof TOOL_TARGET.AGENT }>;

/** A call about an agent, whose tab of its own the row opens, hanging that tab's card as the window draws it now (`LiveDoors`). */
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

/**
 * What the chip of what a call made is labelled with until the window
 * holds its name: the call's own title, a page's or a thread's or a task's;
 * and the link bare for the plan and a pull request, which the chip then
 * calls by the plan's name and the pull request's number.
 */
function madeLabel(target: ToolTarget, subject: string | undefined, href: string): string {
  const bare = target.kind === TOOL_TARGET.PLAN || target.kind === TOOL_TARGET.PULL_REQUEST;
  return bare || subject === undefined || subject === "" ? href : subject;
}

/**
 * A call's row, naming what the call made or is about, a page, the plan, a
 * thread, a task, or a pull request, after its verb by the chip and hover
 * card the window draws for its link anywhere, whose press alone opens it.
 * Note that a call still running, one that made nothing, and one whose
 * place cannot link what it made draw any call's row through this same
 * view, so a row opened while it runs stays open as its answer lands.
 */
function MadeCallView({
  part,
  target,
  doors,
}: {
  part: Extract<AgentPart, { kind: typeof AGENT_PART.TOOL }>;
  /** What the call made or is about; none where it made nothing. */
  target: ToolTarget | undefined;
  doors: DelegationDoors | undefined;
}): ReactNode {
  const mentions = useMentionDoors();
  const standsOn = useLiveDoors(doors)?.cards?.standsOn;
  const agentId = useContext(TranscriptAgent);
  const { kind, subject } = toolCallView(part);
  const href =
    target === undefined
      ? undefined
      : targetLink(target, {
          workspace: mentions.place.workspace,
          holder: mentions.holder ?? standsOn,
          agentId,
        });
  const chip =
    target === undefined || href === undefined
      ? undefined
      : linkChip(href, madeLabel(target, subject, href), mentions);
  return (
    <ToolCallView
      part={part}
      jobs={doors?.jobs}
      made={chip === undefined || !isMadeCallKind(kind) ? undefined : { kind, chip }}
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
  const standing = useContext(StandingParts);
  switch (part.kind) {
    case AGENT_PART.TEXT:
      // The agent's words alone may be replied to, never a call's output or a thought.
      return (
        <div {...{ [REPLY_SCOPE]: "" }}>
          <TranscriptWords
            text={part.text}
            streaming={moving}
            standing={standing?.has(part) ?? true}
          />
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
            open={part.callId === todos.open}
            live={part.callId === todos.live}
          />
        );
      }
      return toolCallView(part).kind === CALL_KIND.LOAD_SKILL ? (
        <LoadedSkillView part={part} />
      ) : // A call about an agent names it by the cards the window hands now (`LiveDoors`).
      calledAgent(part) === undefined ? (
        <MadeCallView part={part} target={undefined} doors={delegation} />
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

/** A part of a turn, drawn again only where it reads otherwise, as a part read again from the same stored part does not (`agentParts`). */
const SteadyAgentPart = memo(AgentPartView, (a, b) =>
  sameFieldsBy(a, b, { part: (ours, theirs) => sameShape(ours, theirs, 1) }),
);

/** A webhook call's body inside the card of the prompt it rode in with, folded again under its own line, as the caller sent it. */
function OriginBody({ body }: { body: string }): React.JSX.Element {
  return (
    <Fold className="agent-origin-body text-caption-inline">
      <LineSummary brightens>
        <DisclosureChevron />
        <WebhookIcon className="agent-origin-body-icon size-luke-16 shrink-0" aria-hidden="true" />
        {WEBHOOK_BODY_LABEL}
      </LineSummary>
      <FoldBody>
        <CodeCard title={WEBHOOK_BODY_KIND} code={body} copy={copyThroughShell} />
      </FoldBody>
    </Fold>
  );
}

/**
 * What the transcript opens on: the plan the agent was handed, an
 * automation's prompt, or the task a worker was, as a message sent to the
 * agent, at a sent message's measure over the line naming who sent it and
 * when, as a sent message's bubble stands over its own: a card folded under
 * its title, and a webhook's body folded again inside it. A title that is
 * the text's own first line gives way to the card's label while the text
 * is drawn under it, so an opened plan never says that line twice. Where the agent
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
      <Plan data-origin-plan="" aria-label={lead.label}>
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
            <PlanPictures taskId={taskId} text={text}>
              {words}
            </PlanPictures>
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

/** A task named as the sender of its plan: its status's mark and its name as one target, hanging its card and opening its plan where the place can. */
function TaskRef({ task, onOpen }: { task: BriefTask; onOpen?: (() => void) | undefined }) {
  return (
    <InlineRef
      look={INLINE_REF_LOOK.WASH}
      glyph={
        <span className="agent-origin-glyph inline-grid size-luke-16 flex-none place-items-center text-muted-foreground [&>svg]:size-origin-glyph">
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
  const chip = linkChip(url, words, doors);
  if (chip !== undefined) return <span className={ORIGIN_CHIP}>{chip}</span>;
  return (
    <OneLine className="agent-origin-subject" words={words}>
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
    </OneLine>
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

/**
 * What an agent's transcript opens on: an automation's prompt, from the
 * automation, where an automation's run started it; the plan, from its task
 * and the teammate who started the agent, where it was handed the plan; and
 * nothing for an agent handed a prompt by hand, whose prompt is the
 * developer's message as any other.
 */
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

/** Who wrote or said a message: their mark and their name, hanging their card. */
function MessageSender({ actor }: { actor: Actor }): React.JSX.Element {
  return actor.kind === ACTOR_KIND.AGENT && actor.agentId !== undefined ? (
    <SendingAgent actor={actor} agentId={actor.agentId} />
  ) : (
    <ActorRef actor={actor} />
  );
}

/** One of the developer's lines that reached a turn while it ran, with who sent it, named over it as any line of theirs is. */
export interface ArrivedLine {
  readonly message: AgentTranscriptMessage;
  readonly sender: Actor | undefined;
}

/** No line reached the turn while it ran. */
const NO_ARRIVED: readonly ArrivedLine[] = [];

/**
 * The line a finished turn ends on, the line under every message
 * (`MessageLine`): how long it worked and when it ended as its lead, then
 * its Copy and Copy link beside it, set as any message's are under its
 * bubble rather than floated over the turn's corner. A turn still running
 * offers no Copy, because its words are not yet whole.
 */
function TurnFoot({ workedFor, copy }: { workedFor: ReactNode; copy: ReactNode }): ReactNode {
  if (workedFor === null && copy === null) return null;
  return (
    // Note that the room above is the row's rather than the worked line's, because the buttons are taller than the words and centring them would push the words down.
    <div className="agent-turn-foot mt-tight-gap" data-turn-foot="">
      <MessageLine align={MESSAGE_LINE_ALIGN.START} sender={workedFor} actions={copy} />
    </div>
  );
}

/**
 * One message: the plan the agent was handed, as a card; a message the
 * developer sent it since, as a bubble at the right where it is the
 * reader's own, else at the left under who sent it, with a quiet line under
 * it holding when and its Copy and Copy link; or one of the agent's own turns, ending once it has
 * finished on a line saying how long it worked and when it ended, with the
 * Copy and Copy link of its words beside it where it has any. A line that
 * reached a turn while it ran is drawn inside it, as its own bubble between
 * the work before it and the work after it.
 */
/** Where a turn's stretches are read from beside the message: its to-do lists, its workers' standings, and the lines that reached it. */
interface StretchPlace {
  readonly todos: TodosPlace;
  readonly standings: ReadonlyMap<string, AgentSubagentStanding> | undefined;
  readonly arrived: readonly ArrivedLine[];
}

/** A turn's rows as its message draws them, cut at every line that reached it (`turnStretches`). */
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
  plan,
  lead,
  moving,
  delegation,
  todos = NO_TODOS,
  briefTitle,
  sender,
  origin,
  arrived = NO_ARRIVED,
  taskId,
  forkable = true,
  forkCut,
  piece,
}: {
  message: AgentTranscriptMessage;
  /** The piece of a long turn this draws (`turn-pieces.ts`), its stretches read for it; the whole message where none. */
  piece?: TurnPiece | undefined;
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
  /** Who wrote or said the message, named over it: a teammate, Luke, or an automation; none for the reader's own, or where nobody is named. */
  sender?: Actor | undefined;
  /** The developer's lines that reached this turn while it ran (`placedMessages`), each drawn where it arrived. */
  arrived?: readonly ArrivedLine[];
}): ReactNode {
  const words = messageWords(message);
  const forkOffered = useForkOffered();
  const sending = useLineSending(message.id);
  const marked = useLineMarked(message.id);
  const editor = useMessageEdit(message.id);
  // Note that a box let go stays drawn, on the doors it was last handed, until its exit has played.
  const editing = useDisclosure(editor !== undefined);
  const lastEditor = useRef(editor);
  if (editor !== undefined) lastEditor.current = editor;
  const drawnEditor = editor ?? (editing.mounted ? lastEditor.current : undefined);
  // Note that the doors and the to-do lists a page hands anew are kept while they draw alike, so the rows a page did not touch stand as drawn (`TranscriptRows`).
  const doors = useKept(delegation, sameDoors);
  const todosKept = useKept(todos, sameTodosPlace);
  const drawPart = useCallback(
    (part: AgentPart) => (
      <SteadyAgentPart part={part} delegation={doors} todos={todosKept} moving={moving} />
    ),
    [doors, todosKept, moving],
  );
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
  // A line another agent sent is that agent's message, never the developer's bubble.
  if (agentMessageOf(message) !== undefined) return <AgentMessageRow message={message} />;
  const named = sender === undefined ? null : <MessageSender actor={sender} />;
  // What GitHub said on the pull request is drawn as its card, never as the prompt the agent read.
  const github = githubLineOf(message);
  if (github !== undefined) return <GitHubLineRow message={message} line={github} sender={named} />;
  if (message.role === MESSAGE_ROLE.USER) {
    const sentAt = message.sentAt;
    // A thread's line is headed by what the member did and the thread's chip, its words without the header that names the item to the agent.
    const thread = threadLineOf(message);
    const shown = thread === undefined ? words : threadLineWords(words, thread.event);
    // A line open for writing again is written where it stands.
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
    // A line anyone but the reader sent (a teammate's, an automation's, Luke's) stands at the left under its sender, as another agent's message does, so the reader's own alone stands at the right.
    const received = sender !== undefined;
    const threadHead =
      thread === undefined ? null : (
        <ThreadLineHead line={thread} words={words} fit={received ? SUBJECT_FIT.OWN : undefined} />
      );
    return (
      <Message
        from={received ? MESSAGE_ROLE.ASSISTANT : message.role}
        className={received ? RECEIVED_MESSAGE_CLASS : undefined}
        data-message-id={message.id}
        data-undelivered={marked ? "" : undefined}
      >
        {received ? <MessageHead sender={named}>{threadHead}</MessageHead> : threadHead}
        <MessageFileChips message={message} sending={sending} />
        {shown === "" ? null : (
          <MessageContent>
            <SentToAgent id={message.id} arrived={message.arrivedIn !== undefined}>
              <SentWords text={shown} />
            </SentToAgent>
          </MessageContent>
        )}
        <UndeliveredMark messageId={message.id} />
        <MessageLine
          align={received ? MESSAGE_LINE_ALIGN.START : MESSAGE_LINE_ALIGN.END}
          at={sentAt}
          // Note that a line of no words, files alone, still offers its Copy link, though it has nothing to copy or edit.
          actions={
            <CopyMessageAction
              words={shown}
              copyable={shown !== ""}
              messageId={message.id}
              rewind={shown === "" ? undefined : REWIND_ACTION.EDIT}
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

/**
 * The line a transcript ends on once its turn was stopped or failed: a
 * failure is a `FailureNote`; a stop's words are quiet. A turn failed on
 * the reader's own refused key offers its API keys after the words, inside
 * the note.
 */
function AgentEndLine({
  ended,
  endReason,
  keyProvider,
  onOpenApiKeys,
}: {
  ended: EndLineParts;
  endReason: FailureReason | undefined;
  keyProvider: ModelProvider | undefined;
  onOpenApiKeys: (() => void) | undefined;
}): React.JSX.Element {
  // Note that a key refused is mended at its harness's row in Settings, so its line offers that row after the words.
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
            cause: endReason ?? FAILURE_CONDITION.UNREAD,
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
    <p className={END_LINE_CLASS} data-ended="">
      <span className="agent-end-words">{ended.words}</span>
      {remedyButton}
    </p>
  );
}

/**
 * The end line: a failure's mark, its words, then what the turn cost after
 * a dot, flowing as one sentence in the caption role, so a long failure
 * wraps under its own words. Only a failure is drawn in the danger ink
 * (`FailureNote`): a stop is the developer's own doing.
 */
const END_LINE_CLASS = "agent-end-line m-0 text-caption text-muted-foreground";

/**
 * The end line's row: the line, then the press it ends on (Continue in new
 * agent), on one row, centred on the line's words, which wraps the press
 * under them only where the column is too narrow for both.
 */
/**
 * Says the turn's end, a stop or a failure, once, as it lands. Note that it
 * is said by the transcript rather than its end line, because the line
 * mounts with its words and its failure is history, no alert; and that only
 * an end that follows a page saying the turn runs is said, never a row's
 * word alone, which may be stale, so the end a tab opens on is history too,
 * while a turn that fails before writing a word is still heard.
 */
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
  press,
  centred = false,
}: {
  ended: EndLineParts;
  endReason: FailureReason | undefined;
  keyProvider: ModelProvider | undefined;
  onOpenApiKeys: (() => void) | undefined;
  press: ReactNode;
  /** Whether it stands in the empty state's own centred column, centred as its column is. */
  centred?: boolean;
}): React.JSX.Element {
  // Note that the line is one flex item, so a failure too long to share the row takes it whole and the press wraps under it, never between its words.
  return (
    <div
      className={`agent-end-row flex max-w-full flex-wrap items-center gap-control-gap${centred ? " justify-center" : ""}`}
    >
      <AgentEndLine
        ended={ended}
        endReason={endReason}
        keyProvider={keyProvider}
        onOpenApiKeys={onOpenApiKeys}
      />
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
 * Whether two delegations' doors draw a message alike. The cards are left
 * out, because the window hands them anew on every draw and
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
    a.jobs === b.jobs
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
  // Note that every prop is compared, each the same value unless named here, so a prop added later is never missed.
  return sameFieldsBy(a, b, {
    message: (ours, theirs) => ours === theirs || sameHeldPiece(a, b),
    todos: sameTodosPlace,
    forkCut: sameFields,
    sender: sameFields,
    arrived: sameArrived,
    delegation: sameDoors,
  });
}

/**
 * Whether two draws are of the same piece of a turn that is not its last,
 * which reads nothing of its message past its id and the rows the piece
 * holds: a running turn's page touches its end alone, so every earlier
 * piece stands as drawn though the message is a new one.
 */
function sameHeldPiece(a: AgentMessageProps, b: AgentMessageProps): boolean {
  return (
    a.piece !== undefined && a.piece === b.piece && !a.piece.last && a.message.id === b.message.id
  );
}

/** A transcript's message, drawn again only where `sameMessageDraw` says it changed. */
const SteadyAgentMessage = memo(AgentMessage, sameMessageDraw);

/** The door that brings a message whose row is not drawn into view, handing its row to `then` once drawn; false where no row draws it. */
type MessageBringer = (messageId: string, then: (row: HTMLElement) => void) => boolean;

/** A row placed in a transcript: its message, and the lines that reached it. */
type PlacedRow = PlacedMessage;

/** No rows to find in, while no find bar stands open. */
const NO_FIND_ROWS: readonly FindRow[] = [];

/** Whether a row draws the message with `messageId`: its own, or a line that reached it. */
function drawsMessage(row: PlacedRow, messageId: string): boolean {
  return row.message.id === messageId || row.arrived.some((line) => line.id === messageId);
}

/** Each message's words as a find counts them, kept by the message, so a page that leaves it reads them once. */
const wordsFound = new WeakMap<AgentTranscriptMessage, string>();

/** The words a message draws that a find counts before its row is drawn: its text, its reasoning, and each call's line, input, answer and error, as its rows draw them (`drawnMessageWords`). */
function findWordsOf(message: AgentTranscriptMessage): string {
  const kept = wordsFound.get(message);
  if (kept !== undefined) return kept;
  const words = drawnMessageWords(message);
  wordsFound.set(message, words);
  return words;
}

/** A row as a find reads it before it is drawn: its messages' words. */
function findRowOf(row: PlacedRow): FindRow {
  return {
    key: transcriptRowKey(row.message),
    words: [row.message, ...row.arrived].map(findWordsOf).join("\n"),
  };
}

/** The class every row of the log wears (tasks.css). */
const LOG_ROW_CLASS = "agent-log-row";

/** One row of the log: a placed message, or one piece of a turn too long to draw at once (`turn-pieces.ts`). */
interface LogEntry {
  readonly key: string;
  readonly row: PlacedRow;
  /** Where the message stands among the placed rows. */
  readonly index: number;
  readonly piece?: TurnPiece | undefined;
}

/** Whether a row of the log draws the message with `messageId`: a piece only the lines it holds, and its turn's own id on its first. */
function entryDraws(entry: LogEntry, messageId: string): boolean {
  const { piece, row } = entry;
  if (piece === undefined) return drawsMessage(row, messageId);
  const holds = piece.stretches.some((stretch) => stretch.line?.id === messageId);
  return holds || (piece.first && drawsMessage(row, messageId) && !heldElsewhere(row, messageId));
}

/** Whether a line that reached a turn is drawn in a piece of its own rather than the turn's first. */
function heldElsewhere(row: PlacedRow, messageId: string): boolean {
  return row.arrived.some((line) => line.id === messageId);
}

/** Each piece's own words as a find counts them, kept by the piece. */
const pieceWords = new WeakMap<TurnPiece, string>();

/** A row as a find reads it before it is drawn: its messages' words, or a piece's own. */
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

/** What a long turn's pieces are read from, so a draw that changed none of it reads none of it again. */
interface PiecesRead {
  readonly message: AgentTranscriptMessage;
  readonly moving: boolean;
  readonly place: StretchPlace;
  readonly pieces: readonly TurnPiece[];
}

/** Whether two reads of a turn's pieces were made from the same things. */
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

/**
 * The log's rows: each placed message, but a turn too long to draw at once
 * as its pieces (`turnPieces`), read again only for a turn a page touched,
 * and each piece that draws as it did kept the value it was, so the pieces
 * a running turn's page did not reach stand as they were drawn.
 */
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
      // Note that only an agent's turn holding more parts than two pieces' worth can be cut, so no other is read again here.
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

/** Whether two runs of lines are the same lines in the same order. */
function sameLines(
  a: readonly AgentTranscriptMessage[],
  b: readonly AgentTranscriptMessage[],
): boolean {
  return a === b || (a.length === b.length && a.every((line, index) => line === b[index]));
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
                sender: lineSender(line.sentBy, readerId, members, former),
              }));
        named.set(message, { lines: arrived, arrived: lines });
        return [message.id, lines];
      }),
    );
  }, [placed, readerId, members, former]);
}

/**
 * Says an agent's reply once its turn is whole, since its log is no live
 * region (`ConversationContent`'s `streams`) and a reply read as it
 * streamed would be heard in fragments. The rule: a page that says the turn
 * completed, after one that said it was still writing, says its newest
 * reply once, politely, as "Reply from {agent}: {its first sentence}"; a
 * reader whose focus stands in the log is already at the reply, so they
 * hear only who it is from. A tab opened on a finished turn says nothing,
 * and a stop or a failure says its own end line instead.
 */
function useReplySaid({
  messages,
  status,
  name,
  quiet,
  tab,
}: {
  messages: readonly AgentTranscriptMessage[];
  /** Where the agent stood as the page holding `messages` said; none before a page landed. */
  status: AgentStatus | undefined;
  name: string;
  /** Whether a quiet reply leaves the reader nothing to hear, as an operator's does. */
  quiet: boolean;
  tab: RefObject<HTMLElement | null>;
}): void {
  const writing = useRef<boolean | undefined>(undefined);
  const said = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (status === undefined) return;
    const was = writing.current;
    writing.current = agentStillWriting(status);
    if (was !== true || status !== AGENT_STATUS.COMPLETED) return;
    const reply = finishedReplyLead(messages, quiet);
    if (reply === undefined || reply.messageId === said.current) return;
    said.current = reply.messageId;
    const log = tab.current?.querySelector('[role="log"]');
    const reading = log?.contains(document.activeElement) === true;
    announce(ANNOUNCE.POLITE, replyFromWords(name, reading ? undefined : reply.lead));
  }, [messages, status, name, quiet, tab]);
}

/**
 * How a transcript's messages are placed, read once for the messages held
 * rather than on every draw: where the to-do lists stand, which message
 * opens it, the replay it opens on, each message with the lines that
 * reached it, and the reply a running turn is still writing.
 */
function transcriptPlacing(
  messages: readonly AgentTranscriptMessage[],
  working: boolean,
  undelivered: ReadonlySet<string>,
  replayed: boolean,
  quietReplies: boolean,
) {
  const todos = todosPlace(messages, working);
  const first = messages.find(
    (message) =>
      message.role === MESSAGE_ROLE.USER &&
      agentMessageOf(message) === undefined &&
      !undelivered.has(message.id),
  );
  // An agent started from another opens on the brief as its source's did, then the replay's card, then the note.
  const opening = !replayed || first === undefined ? undefined : replayOpening(first);
  // A line that reached a turn while it ran is drawn inside that turn, where it arrived.
  const placed = placedMessages(messages, quietReplies);
  const open = openReply(messages, working);
  return { todos, first, opening, placed, open };
}

/** The transcript as the tab draws it: the messages, or what stands in their place. */
function AgentTranscriptView({
  messages,
  quietReplies = false,
  brief,
  lead = AGENT_LEAD,
  delegation,
  reading,
  failed,
  failedWith,
  working,
  pageRuns = false,
  sessionStarting = false,
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
  replay,
  endPress,
  endTrail,
  bringIn,
  holding = false,
  standing,
}: {
  messages: readonly AgentTranscriptMessage[];
  /** The messages as the transcript's follow first drew them (`standing`), whose words stand while what is written after fades in; none where nothing streams, when every word stands. */
  standing?: readonly AgentTranscriptMessage[] | undefined;
  /** Whether the log waits to draw for what stands around it, saying it is loading meanwhile. */
  holding?: boolean;
  /** Where the transcript hands the door that brings a message whose row is not drawn into view, which a link to the message asks through; none where nothing asks. */
  bringIn?: RefObject<MessageBringer | undefined> | undefined;
  /** What the agent was handed first: the plan, drawn as the plan's card, a prompt, drawn as the developer's message, or nothing, for one started blank, whose first line is drawn as any other; unsaid reads as the plan. */
  brief?: AgentBrief | undefined;
  /** Whether this is a member's operator's transcript, which draws no reply of a heartbeat that found nothing (`placedMessages`). */
  quietReplies?: boolean;
  /** Whose transcript this is: an agent's, with its plan, unless said otherwise. */
  lead?: TranscriptLead;
  /** What a delegation's row draws from; with none, a row says the pair its part carries and opens no tab. */
  delegation?: DelegationDoors | undefined;
  reading: boolean;
  failed: boolean;
  /** Why the transcript could not be read, as its read answered, where it failed. */
  failedWith?: unknown;
  /** Whether the agent may still write, which is when the transcript ends on a working line. */
  working: boolean;
  /** Whether the last page read said the turn runs, after which an end that lands is said; none where no page tells it. */
  pageRuns?: boolean;
  /** Whether the agent's session has not run its first turn yet, which its working line says. */
  sessionStarting?: boolean;
  /** Whether a rewind is out, which its working line says until the service answers. */
  rewindOut?: boolean;
  /** When the run under way began, which the working line counts from; none where unknown, when the line only shimmers. */
  startedAt?: number | undefined;
  /** The line the transcript ends on once its turn was stopped or failed (`endLineParts`); nothing otherwise. */
  ended?: EndLineParts | undefined;
  /** What mends the turn the end line tells of (`endLineReason`): an API key looked at, or nothing the line offers. */
  endReason?: FailureReason;
  /** The provider whose key the agent ran on, whose harness an end line telling of a key refused names. */
  keyProvider?: ModelProvider | undefined;
  /** Turns to the harness's row holding the key, which an end line telling of a key refused offers. */
  onOpenApiKeys?: (() => void) | undefined;
  onRetry: () => void;
  /** Reads the messages older than the first held, which the log asks for as the reader nears its top; none where none stand. */
  onOlder?: (() => void) | undefined;
  /** Whether the last read of older messages did not answer, which a line over the log says with Retry. */
  olderFailed?: boolean;
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
  /** The agent whose transcript this is, whose threads its thread lines are on; none on a worker's, or before the agent stands. */
  agentId?: string | undefined;
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
  useTurnEndSaid(ended, pageRuns);
  // Whether a replay opens the transcript is all its placing reads; the place itself is handed anew on every draw.
  const replayed = replay !== undefined;
  // Read through once for the messages held, so a draw that brings no page reads none of them again.
  const placing = useMemo(
    () => transcriptPlacing(messages, working, undelivered, replayed, quietReplies),
    [messages, working, undelivered, replayed, quietReplies],
  );
  // Each line that reached a turn, with who sent it, kept from draw to draw while neither moved.
  const arrivals = useArrivals(placing.placed, readerId, members, former);
  const cards = delegation?.cards;
  const live = useMemo(() => ({ cards }), [cards]);
  const standingParts = useMemo(
    () => (standing === undefined ? undefined : new Set(standing.flatMap(agentParts))),
    [standing],
  );
  // Whether a call of a server's tool is held, which is all the accounts' names are read for.
  const callsServer = useMemo(
    () =>
      messages.some((message) =>
        agentParts(message).some(
          (part) => part.kind === AGENT_PART.TOOL && isServerCallTool(part.tool),
        ),
      ),
    [messages],
  );
  // A turn too long to draw at once stands in the log as its pieces, each a row of its own.
  const entries = useLogEntries(placing, working, delegation?.standings, arrivals);
  // Each row is keyed by the message it draws, which its measured height is kept by, a
  // developer's line by the id it was written under, so its row lands where the line was drawn.
  const rowKeys = useKept(
    entries.map((entry) => entry.key),
    sameIds,
  );
  const log = useRef<HTMLDivElement>(null);
  const rowsHandle = useRef<VirtualRowsHandle>(null);
  // Note that the rows' words are read only while a find bar stands open over the tab.
  const finding = useFindOpen();
  const findRows = useMemo(
    () => (finding ? entries.map(findEntryOf) : NO_FIND_ROWS),
    [finding, entries],
  );
  // A long turn's pieces after its first are set off from the piece before as the rows of one message are, or as the log's own lines are.
  const rowClassOf = useCallback(
    (index: number) => {
      if (index === 0) return LOG_ROW_CLASS;
      return entries[index]?.piece?.continues === true
        ? `${LOG_ROW_CLASS} agent-log-row-continued`
        : `${LOG_ROW_CLASS} agent-log-row-next`;
    },
    [entries],
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
      const entry = entries.find((each) => entryDraws(each, messageId));
      return entry !== undefined && rowsHandle.current?.bringIn(entry.key, then) === true;
    };
  });
  if (!holding && messages.length > 0) {
    const { todos, first, opening, placed, open } = placing;
    // The plan is the first of the developer's messages, unless the agent
    // was handed a prompt in its place, which is the developer's message as
    // any other is, but where something sent it, an automation, when it is
    // that sender's card; the rest the developer sent since. An agent
    // started blank was handed nothing, so its first line, typed or spoken,
    // is a line as any other is, under whoever sent it.
    const blank = brief === AGENT_BRIEF.BLANK && origin === undefined;
    const carded = !blank && (brief !== AGENT_BRIEF.PROMPT || origin !== undefined);
    const plan = carded ? first : undefined;
    const task = carded || blank ? undefined : first;
    return (
      <TranscriptAgent value={agentId}>
        <LiveDoors value={live}>
          <StandingParts value={standingParts}>
            <ConnectionNames needed={callsServer}>
              <Conversation list={log} onNearTop={onOlder}>
                {/* Note that it floats in a fixed slot over the log's top rather than standing in its flow, so its coming and going moves no row, measured or not. */}
                {olderFailed && onOlder !== undefined ? (
                  <div
                    className={`${FLOATING_OVER_LOG_CLASS} top-luke-8 z-1 max-w-conversation-older bg-well px-list-inset py-tight-gap`}
                  >
                    <ErrorState
                      failure={unreadShown(FAILURE_SURFACE.AGENT_TRANSCRIPT_OLDER_READ)}
                      onRetry={onOlder}
                    >
                      {OLDER_FAILED_LINE}
                    </ErrorState>
                  </div>
                ) : null}
                {/* The plan's card stands off the tab row by the gap between a column's groups; lines fade under the bar or banner above. */}
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
                            plan={message === plan}
                            taskId={message === plan ? taskId : undefined}
                            lead={lead}
                            moving={working && index === placed.length - 1}
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
                        </>
                      );
                    }}
                  </ConversationRows>
                  {working ? (
                    <WorkingLine
                      startedAt={startedAt}
                      words={
                        WORKING_PHASE_WORDS[agentWorkingPhase(messages, sessionStarting, rewindOut)]
                      }
                    />
                  ) : null}
                  {ended === undefined && endTrail === undefined ? null : (
                    <div
                      className="agent-end flex flex-col items-start gap-control-gap"
                      data-ended={ended === undefined ? undefined : ""}
                    >
                      {ended === undefined ? null : (
                        <AgentEndRow
                          ended={ended}
                          endReason={endReason}
                          keyProvider={keyProvider}
                          onOpenApiKeys={onOpenApiKeys}
                          press={endPress}
                        />
                      )}
                      {endTrail}
                    </div>
                  )}
                  {failed ? (
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
          </StandingParts>
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
        placement={ERROR_STATE_PLACEMENT.CENTRED}
      >
        {TRANSCRIPT_FAILED_LINE}
      </ErrorState>
    );
  }
  // The log's first page, and what stands around it, wait in the tab's own placeholder, which it opened on (`AgentTab`).
  if (holding || (reading && ended === undefined)) return <TranscriptSkeleton />;
  // Note that the centred column is wider than the empty state's own, so a one-line failure stays one line.
  return (
    <ConversationEmptyState wide>
      {
        <>
          {ended === undefined ? (
            <Text tone={TEXT_TONE.MUTED}>{lead.startingLine}</Text>
          ) : (
            <AgentEndRow
              ended={ended}
              endReason={endReason}
              keyProvider={keyProvider}
              onOpenApiKeys={onOpenApiKeys}
              press={endPress}
              centred
            />
          )}
          {endTrail}
        </>
      }
    </ConversationEmptyState>
  );
}

/**
 * The tab as drawn from what it holds: the transcript with the lines sent
 * and not yet read back at its end, and the composer under it, or, while
 * the agent is archived, the note that offers Unarchive in its place, with
 * the Stop of a turn still running.
 */
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
  doors,
  startedAt,
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
  bringIn,
  holding = false,
}: {
  agent: AgentSummary;
  /** Whether the log waits to draw for what stands around it, while it says it is loading. */
  holding?: boolean;
  /** Where the transcript hands the door that brings a message whose row is not drawn into view. */
  bringIn?: RefObject<MessageBringer | undefined> | undefined;
  /** Where a replay the agent opens on is drawn (`replay-card.tsx`); none where none is read. */
  replay?: ReplayPlace | undefined;
  /** The automation's run that started the agent, as its page reads it; none on a plan's tab, and for an agent started by hand. */
  run?: AgentOrigin | undefined;
  models: readonly CatalogModel[] | undefined;
  modelsFailed: boolean;
  readModels: () => void;
  transcript: AgentTranscriptControl;
  composer: HeldComposer;
  model: AgentModelControl;
  servers: AgentServersControl;
  /** What the agent published, once the service has said; nothing before. */
  published: AgentPullRequestAnswer | undefined;
  doors: PublishedDoors;
  /** When the agent's run began, as the working line counts from it; none while the tab is off screen, so nothing counts unseen. */
  startedAt: number | undefined;
  /** When each of its running workers began, as their rows count from it; none while the tab is off screen. */
  delegationStarts: ReadonlyMap<string, number> | undefined;
  onStop: () => Promise<boolean>;
  /** Brings the agent back from the archive; present exactly while it is archived, when no message is sent. */
  onUnarchive?: (() => void | Promise<void>) | undefined;
  /** Opens one of the agent's workers in a tab of the panel's own; none where the view stands in no panel. */
  onOpenSubagent?: DelegationDoors["onOpen"];
  /** Opens what one of its calls is about; none where nothing opens it. */
  onOpenTarget?: DelegationDoors["onOpenTarget"];
  /** The cards its rows that open a tab hang; none where they hang their hints. */
  cards?: TranscriptCards | undefined;
  openGitHub: (url: string) => void;
  /** Turns to Settings › Agents at the provider's harness row, which a turn failed on a refused key offers. */
  onOpenApiKeys?: ((provider: ModelProvider | undefined) => void) | undefined;
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
  /** What stands in the box's place, before every other note, once a pilot started the agent (`PilotComposerNote`); none for any other. */
  pilotNote?: ReactNode;
  /** Whether the tab offers Continue somewhere, or another agent continued this one, so the end line tells no one to start a new one. */
  continuable?: boolean;
}): React.JSX.Element {
  // Note that the messages a rewind drops are hidden at once, until the transcript reads back without them.
  const { cut } = composer;
  const kept = useMemo(
    () =>
      cut === undefined
        ? transcript.messages
        : transcript.messages.filter((message) => !cut.has(message.id)),
    [transcript.messages, cut],
  );
  const lines = useMemo(() => agentLines(kept, composer.sent), [kept, composer.sent]);
  // A rewind writes in the box, so it is offered only while the box takes words.
  const boxOpen =
    pilotNote === undefined &&
    onUnarchive === undefined &&
    continuedNote === undefined &&
    composer.closed === undefined;
  const onEdit = useSteady(boxOpen ? composer.edit : undefined);
  const onCancelEdit = useSteady(composer.dropEdit);
  const onSendEdit = useSteady(boxOpen ? composer.sendEdit : undefined);
  const onRevert = useSteady(boxOpen ? composer.revert : undefined);
  // Note that the rewind doors stand as they were while what they say is unchanged, because every message
  // reads them, and a page that moved no rewind point must draw no message again.
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
  // Note that a line on its way counts as work from the press, because the agent's status turns
  // running only once the service takes the line, which may take seconds.
  const lineGoing = composer.sent.some((line) => line.state === SENT_LINE_STATE.PENDING);
  const working = agentStillWriting(agent.status) || lineGoing;
  const name = agentName(agent, models);
  const keyProvider = providerOf(agent.model);
  const tab = useRef<HTMLElement>(null);
  useReplySaid({
    messages: transcript.messages,
    status: transcript.pageStatus,
    name,
    quiet: agent.kind === AGENT_KIND.OPERATOR,
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
  const marks = useMemo(
    () => ({ undelivered, unsent, sending, retry: (id: string) => retryLine?.(id) }),
    [undelivered, unsent, sending, retryLine],
  );
  const starterActor = usePerson(agent.startedBy);
  const pictures = useAgentPictureDoor(agent.id);
  const wholeParts = useWholePartDoor(agent.id);
  const { members, former } = useMemberDirectory();
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
    <AgentTabFrame ref={tab} label={name}>
      <MacOwnerProvider value={macOwner}>
        <AgentPicturesProvider value={pictures}>
          <WholePartsProvider value={wholeParts}>
            <MentionedServers value={mentioned}>
              <UndeliveredLines value={marks}>
                <RewindProvider value={rewind}>
                  <AgentTranscriptView
                    messages={lines}
                    standing={transcript.standing}
                    quietReplies={agent.kind === AGENT_KIND.OPERATOR}
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
                        delegationStarts && workerStarts(delegationStarts, transcript.subagents),
                      onOpen: openSubagent,
                      onOpenTarget: openTarget,
                      cards,
                      standings: transcript.subagents,
                    }}
                    reading={transcript.reading || holding}
                    holding={holding}
                    failed={transcript.failed}
                    failedWith={transcript.failedWith}
                    // Note that a rewind draws the working line from its press until its line reads back, however slow its stop and relaunch.
                    working={working || composer.rewinding}
                    pageRuns={
                      transcript.pageStatus !== undefined &&
                      agentStillWriting(transcript.pageStatus)
                    }
                    rewindOut={composer.rewindOut}
                    sessionStarting={agent.status === AGENT_STATUS.STARTING}
                    // Note that while a rewind goes the line counts from its press, never from the run before it, which is the agent's start until a new turn begins.
                    startedAt={
                      composer.rewinding && startedAt !== undefined ? composer.rewoundAt : startedAt
                    }
                    ended={
                      // Note that the end line waits for a page, so a stopped agent's tab never draws it over nothing, and gives way to a line on its way, which the working line stands for.
                      transcript.pages === 0 || lineGoing
                        ? undefined
                        : endLineParts(
                            agent.status,
                            transcript.failure,
                            starter,
                            continuable,
                            transcript.ranDirectly,
                          )
                    }
                    endReason={endLineReason(transcript.failure, starter)}
                    keyProvider={keyProvider}
                    onOpenApiKeys={
                      onOpenApiKeys === undefined ? undefined : () => onOpenApiKeys(keyProvider)
                    }
                    endPress={endPress}
                    endTrail={endTrail}
                    onRetry={transcript.onRetry}
                    onOlder={transcript.hasOlder ? transcript.loadOlder : undefined}
                    olderFailed={transcript.olderFailed}
                    overComposer
                    bringIn={bringIn}
                  />
                </RewindProvider>
              </UndeliveredLines>
            </MentionedServers>
          </WholePartsProvider>
        </AgentPicturesProvider>
      </MacOwnerProvider>
      <AgentTabFoot>
        <TodosDock messages={lines} working={working} />
        <PublishedDock published={published} doors={doors} />
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
            tools={<AgentPlace agent={agent} />}
            onStop={onStop}
            // Note that a started agent's conversation always opens on its plan or
            // task, so the box takes a follow up even before the transcript is read.
            followsUp
            keywords={keywords}
            skills={skills}
            replyDoor={replyDoor}
            closedRemedy={closedRemedy}
          />
        )}
      </AgentTabFoot>
      {/* Note that Reply stands only while the box takes a change, as a file's + does. */}
      {pilotNote !== undefined ||
      onUnarchive !== undefined ||
      continuedNote !== undefined ||
      composer.closed !== undefined ||
      composer.sending ? null : (
        <ReplyToSelection scope={tab} onReply={(words) => replyDoor.current?.(words)} />
      )}
    </AgentTabFrame>
  );
}

/** What an agent's tab is handed beside the agent. */
interface AgentTabDoors {
  /** The automation's run that started the agent, as its page reads it; none on a plan's tab. */
  run?: AgentOrigin | undefined;
  control: AgentsControl;
  /** Whether the tab is on screen: the task's column showing it, on the Tasks tab. */
  shown: boolean;
  /** Opens one of the agent's workers in a tab of the side panel's own, by the call that started it. */
  onOpenSubagent: (callId: string, task: string, status: AgentStatus) => void;
  /** Opens what one of its calls is about in the tab that draws it. */
  onOpenTarget?: DelegationDoors["onOpenTarget"];
  /** The cards its rows that open a tab hang, as those tabs hang them. */
  cards?: TranscriptCards | undefined;
  /** Opens the agent's pull request, its checks, description, and conversation, in a tab of the side panel's own. */
  onOpenPullRequest?: (() => void) | undefined;
  /** Hears the transcript the tab holds each time it moves, which the tab's hover card previews once the tab is not shown. */
  onHeld: (agentId: string, held: HeldTranscript) => void;
}

/**
 * The agent an agent's tab is: read already, or named by its id alone while
 * the task's list of agents, which reads it, is on its way.
 */
type AgentTabProps = AgentTabDoors &
  (
    | { agent: AgentSummary; agentId?: undefined }
    | { agent: AgentSummary | undefined; agentId: string }
  );

/** Nothing to retry on a tab whose agent is not made yet. */
const NO_RETRY = () => undefined;

/**
 * The tab of an agent New task or a Start is still starting, before the
 * service has made it: the developer's words as its first line, where it was
 * started on some, as the agent's own transcript will draw them, and its
 * working line saying it is starting, over the composer's card, which the
 * agent's own tab takes the place of once the start answers, its first line
 * drawn in the same place. One started on no words is briefed on the plan.
 */
export function StartingAgentTab({ line }: { line?: SentLine | undefined }): React.JSX.Element {
  const messages = useMemo(() => (line === undefined ? [] : agentLines([], [line])), [line]);
  return (
    <AgentTabFrame>
      <AgentTranscriptView
        messages={messages}
        brief={line === undefined ? AGENT_BRIEF.PLAN : AGENT_BRIEF.PROMPT}
        reading={false}
        failed={false}
        working
        sessionStarting
        onRetry={NO_RETRY}
        overComposer
      />
      <AgentTabFoot>
        <ComposerSkeleton />
      </AgentTabFoot>
    </AgentTabFrame>
  );
}

/**
 * An agent's tab, by the agent's id alone: its transcript is followed from
 * the moment the tab stands, while the agent itself may still be on its way with the task's list of agents. What needs
 * the agent, its composer, its model, its pull request, and how its log is
 * headed, waits for it, the tab standing in its own shape meanwhile
 * (`AgentTabSkeleton`): the log's placeholder lines, which stand on until
 * the first page lands, over the composer's card, which the composer then
 * takes the place of. So a task opened on an agent reads its transcript
 * beside the list rather than after it, and nothing moves as either lands.
 */
export function AgentTab(props: AgentTabProps): React.JSX.Element {
  const { agent, control, shown, onHeld, agentId: _agentId, ...rest } = props;
  const agentId = props.agentId === undefined ? props.agent.id : props.agentId;
  const { tell } = useAct();
  const transcript = useAgentTranscript({
    transcript: { kind: TRANSCRIPT_KIND.AGENT, agentId },
    shown,
    follower: control.transcripts,
  });
  const { messages, pageStatus, runStartedAt, subagentTitles } = transcript;
  // Note that what is held is dated by the page it was read from, never by
  // the summary, because the summary moves on to a new turn before its
  // messages land; and nothing is said before a page has landed.
  useEffect(() => {
    if (pageStatus === undefined || messages.length === 0) return;
    const status = pageStatus;
    onHeld(agentId, { messages, status, runStartedAt, title: undefined, subagentTitles });
  }, [onHeld, agentId, messages, pageStatus, runStartedAt, subagentTitles]);
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
  // The tab stands in its own shape until the agent is here; its log stands the same lines until its first page is (`TranscriptSkeleton`).
  if (agent === undefined) return <AgentTabSkeleton />;
  return (
    <AgentTabBody {...rest} agent={agent} control={control} shown={shown} transcript={transcript} />
  );
}

/** The tab once the agent is read: its composer, model, servers, and pull request, over the transcript its id followed (`AgentTab`). */
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
    status: agent.status,
    shown,
    messages: transcript.messages,
    read: control.readPullRequest,
    known: control.pullRequests.get(agent.id),
  });
  // Note that the log never waits on the pull request's dock over the box, because its read asks GitHub and would hold every tab's first draw for a second or more.
  // Note that nothing counts as landed before the first page.
  const surroundsLanded = messages.length > 0;
  // An agent New task just started draws the words it was started on as its
  // first line until its transcript reads one back (`unreadOpeningLine`).
  const opening = unreadOpeningLine(
    control.opening?.agentId === agent.id ? control.opening.line : undefined,
    messages,
  );
  const sent = useMemo(
    () => (opening === undefined ? composer.sent : [opening, ...composer.sent]),
    [opening, composer.sent],
  );
  const opened = useRef(false);
  // Note that a log already drawn on its opening line is never held back again, because
  // an agent just started has published nothing and been called by no one, so nothing would move it.
  if (surroundsLanded || opening !== undefined) opened.current = true;
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
    gone: () =>
      toast({
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
  // An agent a pilot started reports to it and takes no member's message, so its box names the pilot instead.
  const pilot = agent.startedByPilot;
  const reportsTo = pilotTarget(agent);
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
  // On a pilot task only its pilot continues, so a coding agent there offers no Continue anywhere.
  const continues = offersContinue(control.mode, agent);
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
              offers={continues}
              label={continued.length > 0 ? CONTINUE_AGAIN_LABEL : CONTINUE_LABEL}
            />
          ) : undefined
        }
        continuable={continued.length > 0 || (continues && control.continueAgent !== undefined)}
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

/**
 * One of an agent's workers in a tab of the side panel's own: its transcript,
 * read under the agent and the call that started it and followed while
 * the worker runs, drawn as the agent's is with the task it was handed in
 * the plan's place, a working line at its end while it runs, counting
 * from the start its pages say, and no head and no composer, since the
 * tab's own label names the task and nothing is sent to a worker. Its
 * rows open and hang what an agent's rows do, through the task's own doors
 * (`onOpenTarget`, `cards`), but a worker of its own opens no tab, and no
 * message of its is edited or reverted. Where the worker stands is what its
 * pages say, which the panel keeps for the tab's glyph (`onStatus`).
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
  onOpenTarget,
  cards,
}: {
  agentId: string;
  callId: string;
  task: string;
  /** Opens what one of its calls is about, as its agent's tab does; none where nothing opens it. */
  onOpenTarget?: DelegationDoors["onOpenTarget"];
  /** The cards its rows that open a tab hang, its agent's own; none where they hang their hints. */
  cards?: TranscriptCards | undefined;
  /** Who handed the worker its task, named under its card: the agent that delegated it, which opens its tab; none where the panel names nobody. */
  sender?: ReactNode;
  status: AgentStatus;
  control: AgentsControl;
  shown: boolean;
  /** A page said where the worker stands now. */
  onStatus: (status: AgentStatus) => void;
  /** Hears the transcript the tab holds each time it moves, by the call that started the worker, as an agent's tab says its own. */
  onHeld: (callId: string, held: HeldTranscript) => void;
}): React.JSX.Element {
  const transcript = useAgentTranscript({
    transcript: { kind: TRANSCRIPT_KIND.AGENT, agentId, callId },
    shown,
    follower: control.transcripts,
    onStatus: (_agentId, next) => onStatus(next.status),
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
  // The press is the same door from draw to draw, so a message kept as it was opens what the window opens now.
  const openTarget = useSteady(onOpenTarget);
  const delegation = useMemo(
    () => ({ models, onOpenTarget: openTarget, cards }),
    [models, openTarget, cards],
  );
  const origin = useMemo(() => (sender === undefined ? undefined : { sender }), [sender]);
  // As an agent's: dated by the page it was read from, with the worker's own title.
  useEffect(() => {
    if (pageStatus === undefined || messages.length === 0) return;
    const held = { messages, status: pageStatus, runStartedAt, title: pageTitle };
    onHeld(callId, { ...held, subagentTitles: new Map() });
  }, [onHeld, callId, messages, pageStatus, runStartedAt, pageTitle]);
  // A worker's reply streams into a log as quiet as its agent's, so it is said once whole, under the worker's name.
  const name = cardTitle(task);
  const tab = useRef<HTMLElement>(null);
  useReplySaid({ messages, status: pageStatus, name, quiet: false, tab });
  return (
    <AgentTabFrame ref={tab} label={name}>
      <MacOwnerProvider value={macOwner}>
        <AgentPicturesProvider value={pictures}>
          <WholePartsProvider value={wholeParts}>
            <AgentTranscriptView
              messages={lines}
              standing={transcript.standing}
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
