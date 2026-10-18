import { AGENT_TOOL } from "@luke/features/agent-tools";
import {
  CODING_AGENT_BRIEF,
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
import { LINK_PLACE } from "@luke/features/luke-link";
import type { CatalogModel, ModelChoice } from "@luke/features/models-wire";
import type { KnownNames } from "@luke/features/place-chip-model";
import { CALL_KIND, CALL_WORDS } from "@luke/features/turn-rows";
import { ACT_KIND } from "@luke/host/acts";
import { useAct } from "@luke/panel/act";
import { appPlatform } from "@luke/panel/app-platform";
import { useOpenPlace } from "@luke/panel/tasks/use-open-link";
import {
  DisclosureChevron,
  DocumentIcon,
  ERROR_STATE_PLACEMENT,
  ErrorState,
  HoverCard,
  HoverCardHead,
  INLINE_REF_LOOK,
  TEXT_LINK_LOOK,
  TEXT_TONE,
  Text,
  TextLink,
} from "@luke/ui";
import { ACTOR_KIND, ACTOR_STATE, type Actor } from "@luke/ui/actor-model";
import { MESSAGE_ROLE } from "@luke/wire";
import { BotIcon, WebhookIcon, ZapIcon } from "lucide-react";
import { Fragment, type ReactNode, useEffect, useMemo, useRef } from "react";
import {
  ACTOR_SIZE,
  ActorLine,
  ActorMark,
  ActorRef,
  AutomationCard,
  automationActor,
} from "../actor-ref";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "../ai-elements/conversation";
import { Fold, FoldBody, FoldSummary } from "../ai-elements/fold";
import { MESSAGE_ACTIONS_PLACEMENT, Message, MessageContent } from "../ai-elements/message";
import { Plan, PlanContent, PlanHeader, PlanIcon, PlanTitle } from "../ai-elements/plan";
import { TOOL_STATE } from "../ai-elements/tool";
import { useAutomation } from "../automation-directory";
import { useCopyToast } from "../copy-feedback";
import { InlineRef } from "../inline-ref";
import { useMemberDirectory, usePerson } from "../member-directory";
import { SPINNER_SIZE, Spinner } from "../spinner";
import { GLYPH_STATE, stateEndMark } from "../state-glyph";
import { TOAST_HOLD, TOAST_TONE, useToast } from "../toast";
import { AgentComposer } from "./agent-composer";
import {
  AgentPicturesProvider,
  CallPictures,
  ShownPictures,
  useAgentPictureDoor,
} from "./agent-pictures";
import { type PublishedDoors, PublishedRow } from "./agent-published";
import type { AgentServersControl } from "./agent-servers";
import type { HeldTranscript } from "./agent-tab-card";
import { ArchivedComposerNote } from "./archived-task";
import { AttachedFileChips, messageFileChips } from "./attached-file-chips";
import { useChatOn } from "./chat-gate";
import { ChatNoticeCard, type ChatNoticeDoors } from "./chat-notice";
import {
  AGENT_PART,
  type AgentPart,
  agentLines,
  agentListCallIds,
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
  providerOf,
  settledPlanEdits,
  sidebarCallIds,
  teammateStarter,
  turnStretches,
  WORKING_PHASE_WORDS,
  workerLines,
  workerStatusOf,
  workerToolState,
} from "./coding-agent-model";
import { ContinueAgent, ContinuedComposerNote, ContinuedTrail } from "./continue-agent";
import { CopyMessageAction } from "./copy-message";
import { ForkedToLine, useForkOffered } from "./fork-action";
import { type ForkCut, forkCutOf, openReply } from "./fork-model";
import { linkChip } from "./mention-chip";
import { MentionedAgentCard } from "./mentioned-agent-card";
import {
  agentMessagePlace,
  MESSAGE_GONE,
  MessagePlaceProvider,
  useMessageReveal,
} from "./message-links";
import { PlanPictures } from "./plan-pictures";
import { ReplayCard, type ReplayPlace, replayPlace } from "./replay-card";
import { briefAgent, replayOpening } from "./replay-card-model";
import { REPLY_SCOPE, ReplyToSelection } from "./reply-to-selection";
import { SentTime } from "./sent-time";
import { MentionedServers, SentToAgent } from "./server-card";
import { SentWords, useSkill } from "./skill-chip";
import type { SkillSource } from "./skill-picker";
import { SkillCard } from "./skill-ref";
import { useMentionDoors } from "./task-mentions";
import { useMinute } from "./task-time";
import {
  calledAgent,
  cardTitle,
  delegationView,
  loadedSkill,
  TARGET_HINT,
  TOOL_TARGET,
  type ToolTarget,
  todoFocus,
  todosSummary,
  todosView,
  toolCallView,
  toolTarget,
  type WorkerJobs,
} from "./tool-call-model";
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
} from "./transcript-blocks";
import { UndeliveredLines, UndeliveredMark, useUndeliveredLines } from "./undelivered-mark";
import { type AgentComposerControl, useAgentComposer } from "./use-agent-composer";
import { type AgentModelControl, useAgentModel } from "./use-agent-model";
import { useAgentPullRequest } from "./use-agent-pull-request";
import { useAgentServers } from "./use-agent-servers";
import { type AgentTranscriptControl, useAgentTranscript } from "./use-agent-transcript";
import type { CodingAgentsControl } from "./use-coding-agents";
import { useKnownNames } from "./use-known-names";
import { WorkedFor, WorkingLine } from "./working-time";

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
 * why where the service said. The list
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
  /** What the tab says before the first message lands; a turn that ended before one says how instead. */
  startingLine: string;
}

/** An agent's transcript: the plan it was handed, and the agent starting; the brain's turns on the Call tab, which open on no card, alike. */
export const AGENT_LEAD: TranscriptLead = {
  label: "Plan",
  icon: <DocumentIcon />,
  startingLine: "The agent is starting.",
};

/** The plan's own tab, which a task's name over its plan's card opens. */
const TASK_TARGET: ToolTarget = { kind: TOOL_TARGET.PLAN };

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

/** The task an agent's plan is the plan of, as its card's sender line names it: its name, and the card its sidebar row hangs. */
export interface BriefTask {
  readonly name: string;
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

/** A chat notice's card, at the moment the window's clock says. */
function NoticeRow({
  message,
  doors,
}: {
  message: CodingAgentMessage;
  doors: ChatNoticeDoors | undefined;
}): ReactNode {
  const now = useMinute();
  const notice = chatNoticeOf(message);
  if (notice === undefined) return null;
  return (
    <ChatNoticeCard
      messageId={message.id}
      notice={notice}
      words={messageWords(message)}
      doors={doors}
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

/** One tool call: its row, and its input and answer under it once opened, a stop naming the worker it stopped by its job where `jobs` knows it, and a call about an agent naming it by its chip where `cards` or its answer know it. */
function ToolCallView({
  part,
  jobs,
  cards,
}: {
  part: Extract<AgentPart, { kind: typeof AGENT_PART.TOOL }>;
  jobs?: WorkerJobs | undefined;
  cards?: TranscriptCards | undefined;
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
      />
      <CallPictures tool={part.tool} input={part.input} output={part.output} />
    </>
  );
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
      card={doors?.cards?.worker({ callId: part.callId, task: view.task, status })}
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
      onOpen={onOpen}
    />
  );
}

/** One part of the agent's turn, drawn by its kind. */
function AgentPartView({
  part,
  delegation,
  todos,
}: {
  part: AgentPart;
  delegation: DelegationDoors | undefined;
  todos: TodosPlace;
}): ReactNode {
  switch (part.kind) {
    case AGENT_PART.TEXT:
      // The agent's words alone may be replied to, never a call's output or a thought.
      return (
        <div {...{ [REPLY_SCOPE]: "" }}>
          <TranscriptWords text={part.text} />
        </div>
      );
    case AGENT_PART.REASONING:
      return <TranscriptReasoning text={part.text} />;
    case AGENT_PART.TOOL: {
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
          <OpeningCallView
            part={part}
            hint={TARGET_HINT[target.kind]}
            card={delegation?.cards?.target(target)}
            cards={delegation?.cards}
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
      ) : (
        <ToolCallView part={part} jobs={delegation?.jobs} cards={delegation?.cards} />
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
  return (
    <Message from={MESSAGE_ROLE.USER} className="agent-origin" data-message-id={messageId}>
      <Plan data-task-card="" aria-label={lead.label}>
        <PlanHeader>
          <PlanIcon>{lead.icon}</PlanIcon>
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

/** A task named as the sender of its plan: its document glyph and its name as one target, hanging its card and opening its plan where the place can. */
function TaskRef({ task, onOpen }: { task: BriefTask; onOpen?: (() => void) | undefined }) {
  return (
    <InlineRef
      look={INLINE_REF_LOOK.WASH}
      glyph={
        <span className="agent-origin-glyph">
          <DocumentIcon />
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
  return (
    <ActorLine>
      {task === undefined ? null : <TaskRef task={task} onOpen={onOpen} />}
      {starter === undefined ? null : (
        <ActorLine>
          {task === undefined ? "Started by " : " · started by "}
          <ActorRef actor={starter} sentence />
        </ActorLine>
      )}
    </ActorLine>
  );
}

/**
 * The issue or pull request an automation's GitHub event named, by number
 * and title: where the event gave its address, its chip, as the transcript
 * draws a link to it, wearing GitHub's mark for where it stands and opening
 * it on GitHub (`mention-chip.tsx`); a link opening on GitHub where the
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
  if (url === undefined) return <span className="agent-origin-subject">{words}</span>;
  const chip = linkChip(url, words, doors);
  if (chip !== undefined) return <span className="agent-origin-chip">{chip}</span>;
  return (
    <span className="agent-origin-subject">
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
    </span>
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
  if (agent.brief === CODING_AGENT_BRIEF.PROMPT) return undefined;
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

/**
 * Another coding agent named as a line's sender, by the id the service
 * answered for it: its harness's mark and its name, as it sent the line,
 * hanging its tab's card as it stands now, read as the card is first hung
 * (`mentioned-agent-card.tsx`), and opening its tab on a press.
 */
function SendingAgent({
  actor,
  agentId,
}: {
  actor: Extract<Actor, { kind: typeof ACTOR_KIND.AGENT }>;
  agentId: string;
}): React.JSX.Element {
  const { workspaceId } = useMemberDirectory();
  const openPlace = useOpenPlace();
  const { taskId } = actor;
  // Its own card stands while the agent is read, and where the read answers nothing.
  const fallback = (
    <HoverCard>
      <HoverCardHead glyph={<ActorMark actor={actor} size={ACTOR_SIZE.CARD} />} name={actor.name} />
    </HoverCard>
  );
  const card = (
    <MentionedAgentCard
      agentId={agentId}
      taskId={taskId}
      name={actor.name}
      workspaceId={workspaceId}
      fallback={fallback}
    />
  );
  const open =
    openPlace === undefined
      ? undefined
      : () =>
          openPlace({
            kind: LINK_PLACE.AGENT,
            ...(taskId === undefined ? undefined : { planId: taskId }),
            agentId,
          });
  return <ActorRef actor={actor} card={card} onOpen={open} />;
}

/** One of the developer's lines that reached a turn while it ran, with who sent it, named over it as any line of theirs is. */
export interface ArrivedLine {
  readonly message: CodingAgentMessage;
  readonly sender: Actor | undefined;
}

/** No line reached the turn while it ran. */
const NO_ARRIVED: readonly ArrivedLine[] = [];

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
  said = false,
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
  /** Whether its words were said aloud and are drawn after it, as a spoken turn's on the Call tab are, so its words stay inside its work's fold, with how long it worked, once it has finished. */
  said?: boolean;
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
    return (
      <Message from={message.role} data-message-id={message.id}>
        <AttachedFileChips files={messageFileChips(message)} />
        {words === "" ? null : (
          <MessageContent>
            <SentToAgent id={message.id} arrived={message.arrivedIn !== undefined}>
              <SentWords text={words} />
            </SentToAgent>
          </MessageContent>
        )}
        <UndeliveredMark messageId={message.id} />
        {words === "" && named === null && sentAt === undefined ? null : (
          <div className="message-meta">
            {words === "" ? null : (
              <CopyMessageAction
                words={words}
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
  // A spoken turn's words were Luke's line, so they get no Copy, and its "Worked for" line stays inside its fold.
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
          <TranscriptRows rows={stretch.rows} trailer={said && ends ? workedFor : undefined}>
            {(part) => <AgentPartView part={part} delegation={delegation} todos={todos} />}
          </TranscriptRows>
        </MessageContent>
        {said || !ends ? null : (
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
        )}
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
        <button
          type="button"
          className="toolbar-button bordered-button failure-note-remedy agent-end-remedy"
          onClick={onOpenApiKeys}
        >
          {remedy}
        </button>
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
}: {
  messages: readonly CodingAgentMessage[];
  /** What the agent was handed first: the plan, drawn as the plan's card, or a prompt, drawn as the developer's message; nothing reads as the plan. */
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
  if (messages.length > 0) {
    const todos = todosPlace(messages, working);
    // The plan is the first of the developer's messages, unless the agent
    // was handed a prompt in its place, which is the developer's message as
    // any other is, but where something sent it, an automation, when it is
    // that sender's card; the rest the developer sent since.
    const first = messages.find(
      (message) =>
        message.role === MESSAGE_ROLE.USER &&
        chatNoticeOf(message) === undefined &&
        !undelivered.has(message.id),
    );
    const carded = brief !== CODING_AGENT_BRIEF.PROMPT || origin !== undefined;
    const plan = carded ? first : undefined;
    const task = carded ? undefined : first;
    // An agent started from another opens on the brief as its source's did, then the replay's card, then the note.
    const opening = replay === undefined || first === undefined ? undefined : replayOpening(first);
    // A line that reached a turn while it ran is drawn inside that turn, where it arrived.
    const placed = placedMessages(messages);
    const open = openReply(messages, working);
    return (
      <Conversation>
        {/* The plan's card stands off the tab row by the gap between a column's groups; lines fade under the bar or banner above. */}
        <ConversationContent
          className={overComposer ? "scroll-fade agent-log-over-composer" : "scroll-fade"}
        >
          {placed.map(({ message, arrived }, index) => (
            <Fragment key={message.id}>
              <AgentMessage
                message={message === first && opening !== undefined ? opening.brief : message}
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
                arrived={arrived.map((line) => ({
                  message: line,
                  sender: lineSender(line.sentBy, readerId, members, former),
                }))}
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
                    <AgentMessage
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
      {reading && ended === undefined ? (
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
}: {
  agent: CodingAgentSummary;
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
  /** Turns to Settings › Coding agents, which a turn failed on a refused key offers. */
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
  const lines = agentLines(transcript.messages, composer.sent);
  const chatOn = useChatOn();
  const working = agentStillWriting(agent.status);
  const steering = new Set(composer.sent.filter((line) => line.steers).map((line) => line.id));
  const undelivered = new Set(
    composer.sent.filter((line) => line.undelivered === true).map((line) => line.id),
  );
  const starterActor = usePerson(agent.startedBy);
  const pictures = useAgentPictureDoor(agent.id);
  const { members, former } = useMemberDirectory();
  const tab = useRef<HTMLElement>(null);
  // The door the box hands Reply, which lays a quote in at its caret.
  const replyDoor = useRef<((words: string) => void) | undefined>(undefined);
  const origin = agentOrigin({
    // An agent started from an automation's run opens on the run's prompt under the automation.
    agent: replay === undefined ? agent : briefAgent(agent, replay.agents),
    run,
    task: cards?.task,
    onOpenTask: onOpenTarget === undefined ? undefined : () => onOpenTarget(TASK_TARGET),
    starter: starter === undefined ? undefined : starterActor,
    openGitHub,
  });
  return (
    <section
      ref={tab}
      className="agent-tab ph-no-capture"
      aria-label={agentTabLabel(agent, models)}
    >
      <MacOwnerProvider value={macOwnerOf(agent.startedBy, members, readerId, former)}>
        <AgentPicturesProvider value={pictures}>
          <MentionedServers value={{ disabled: servers.disabled, steering }}>
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
                  starts: delegationStarts && workerStarts(delegationStarts, transcript.subagents),
                  onOpen: onOpenSubagent,
                  onOpenTarget,
                  cards,
                  standings: transcript.subagents,
                  chat,
                  chatOn,
                }}
                reading={transcript.reading}
                failed={transcript.failed}
                working={working}
                sessionStarting={agent.status === CODING_AGENT_STATUS.STARTING}
                startedAt={startedAt}
                ended={endLineParts(agent.status, transcript.failure, starter, continuable)}
                endReason={endLineReason(transcript.failure, starter)}
                onOpenApiKeys={onOpenApiKeys}
                endPress={endPress}
                endTrail={endTrail}
                onRetry={transcript.onRetry}
                overComposer
              />
            </UndeliveredLines>
          </MentionedServers>
        </AgentPicturesProvider>
      </MacOwnerProvider>
      <footer className="agent-tab-foot">
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
}: {
  agent: CodingAgentSummary;
  /** The automation's run that started the agent, as its page reads it; none on a plan's tab. */
  run?: CodingAgentOrigin | undefined;
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
    agentId: agent.id,
    status: agent.status,
    shown,
    read: control.readTranscript,
    onStatus: control.onStatus,
    onTitle: control.onTitle,
  });
  const { messages, pageStatus, runStartedAt, subagentTitles } = transcript;
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
    onStatus: control.onStatus,
  });
  const model = useAgentModel({ agent, choose: control.onChoose });
  const servers = useAgentServers({
    agent,
    write: control.onSwitchServers,
    onOpenSettings: control.onOpenIntegrations,
  });
  const published = useAgentPullRequest({
    agentId: agent.id,
    status: agent.status,
    shown,
    messages: transcript.messages,
    read: control.readPullRequest,
  });
  const copyWithToast = useCopyToast();
  const openGitHub = (url: string) => appPlatform().openGitHub(url);
  // A link to one of its messages is answered once the transcript has landed, here or by saying it is gone.
  const toast = useToast();
  useMessageReveal({
    agentId: agent.id,
    shown,
    caughtUp: transcript.caughtUp,
    pages: transcript.pages,
    settled: !agentStillWriting(agent.status),
    drawn: (messageId) => messages.some((message) => message.id === messageId),
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
  return (
    <MessagePlaceProvider value={agentMessagePlace(agent, messages)}>
      <AgentTabView
        agent={agent}
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
    agentId,
    callId,
    status,
    shown,
    read: control.readTranscript,
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
  const { members, former } = useMemberDirectory();
  const macOwner = macOwnerOf(owner?.startedBy, members, control.me, former);
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
          <AgentTranscriptView
            messages={workerLines(task, transcript.messages)}
            lead={WORKER_LEAD}
            origin={sender === undefined ? undefined : { sender }}
            delegation={{ models: control.models }}
            reading={transcript.reading}
            failed={transcript.failed}
            working={agentStillWriting(status)}
            sessionStarting={status === CODING_AGENT_STATUS.STARTING}
            startedAt={shown ? transcript.runStartedAt : undefined}
            ended={endLineParts(status, transcript.failure)}
            onRetry={transcript.onRetry}
          />
        </AgentPicturesProvider>
      </MacOwnerProvider>
    </section>
  );
}
