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
import { FAILURE_REASON, type FailureReason } from "@luke/features/failure-remedy";
import type { CatalogModel, ModelChoice } from "@luke/features/models-wire";
import { CALL_KIND, CALL_WORDS } from "@luke/features/turn-rows";
import { ACT_KIND } from "@luke/host/acts";
import { DocumentIcon } from "@luke/ui";
import { ACTOR_KIND, ACTOR_STATE, type Actor } from "@luke/ui/actor-model";
import { MESSAGE_ROLE } from "@luke/wire";
import { BotIcon, WebhookIcon, ZapIcon } from "lucide-react";
import { Fragment, type ReactNode, useEffect, useMemo, useRef } from "react";
import { useAct } from "../act";
import { ActorLine, ActorRef, AutomationCard, automationActor } from "../actor-ref";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "../ai-elements/conversation";
import { Fold, FoldBody, FoldChevron, FoldSummary } from "../ai-elements/fold";
import { Message, MessageContent } from "../ai-elements/message";
import { Plan, PlanContent, PlanHeader, PlanTitle } from "../ai-elements/plan";
import { TOOL_STATE } from "../ai-elements/tool";
import { useAutomation } from "../automation-directory";
import { useCopyToast } from "../copy-feedback";
import { FailureNote } from "../failure-note";
import { useMemberDirectory, usePerson } from "../member-directory";
import { READ_FAILURE_PLACE, ReadFailure } from "../read-failure";
import { SPINNER_SIZE, Spinner } from "../spinner";
import { TOAST_HOLD, TOAST_TONE, useToast } from "../toast";
import { Tooltip } from "../tooltip";
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
import { ArchivedComposerNote } from "./archived-plan";
import { AttachedFileChips, messageFileChips } from "./attached-file-chips";
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
  delegates,
  dockedTodos,
  endLine,
  endLineReason,
  lineSender,
  macOwnerOf,
  messageWords,
  newestTodos,
  placedMessages,
  settledPlanEdits,
  showsPublishedRow,
  teammateStarter,
  turnStretches,
  WORKING_PHASE_WORDS,
  workerLines,
  workerStatusOf,
  workerToolState,
} from "./coding-agent-model";
import { CopyMessageAction } from "./copy-message";
import {
  agentMessagePlace,
  MESSAGE_GONE,
  MessagePlaceProvider,
  useMessageReveal,
} from "./message-links";
import { callHeading, useMinute } from "./plan-time";
import { MentionedServers, SentToAgent } from "./server-card";
import { SentWords, useSkill } from "./skill-chip";
import type { SkillSource } from "./skill-picker";
import { SkillCard } from "./skill-ref";
import {
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
import { type AgentComposerControl, useAgentComposer } from "./use-agent-composer";
import { type AgentModelControl, useAgentModel } from "./use-agent-model";
import { useAgentPullRequest } from "./use-agent-pull-request";
import { useAgentServers } from "./use-agent-servers";
import { type AgentTranscriptControl, useAgentTranscript } from "./use-agent-transcript";
import type { CodingAgentsControl } from "./use-coding-agents";
import { WorkedFor, WorkingLine } from "./working-time";

/**
 * agent-tab.tsx -- one coding agent's tab in the plan's column: its transcript live, and the message box under it wearing what it runs on and what it published.
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
 * drawn and goes nowhere. A finished transcript ends on a row summing the
 * pull request up, with what the turn cost where the service priced it,
 * as the stopped or failed line carries it too. Every word here is the agent's or the plan's, so the
 * root is left out of the screen recording (`ph-no-capture`) as a second
 * line behind the recording's text masking. Under the transcript stands
 * the composer (`agent-composer.tsx`), with no head above either: where
 * the agent stands is its tab's glyph and the transcript's own lines, what
 * it runs on is the model chip at the box's foot, and what it published
 * is the chip after it. A line the developer sends joins the transcript at
 * once as theirs and is read back from the service's own row, and the
 * Stop is the composer's, the one the tab has. A worker's tab draws the
 * worker's transcript the same way, under the agent and the call that
 * started it, with the task it was handed in the plan card's place and no
 * composer, since nothing is sent to a worker. Either tab says what it
 * holds to the plan's page each time it moves (`onHeld`), which its tab's hover
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

/** An agent's transcript: the plan it was handed, and the agent starting; the planning model's turns on the Call tab, which open on no card, alike. */
export const AGENT_LEAD: TranscriptLead = {
  label: "Plan",
  icon: (
    <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground [&>svg]:size-4">
      <DocumentIcon />
    </span>
  ),
  startingLine: "The agent is starting.",
};

/** The plan's own tab, which a task's name over its plan's card opens. */
const PLAN_TARGET: ToolTarget = { kind: TOOL_TARGET.PLAN };

/** What the tab says where its transcript could not be read. */
const TRANSCRIPT_FAILED_LINE = "The transcript could not be read.";

/** A worker's transcript: the subagent task it was handed, and the worker starting. */
const WORKER_LEAD: TranscriptLead = {
  label: "Subagent task",
  icon: <BotIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />,
  startingLine: "The worker is starting.",
};

/** An automation's run: the prompt it handed the agent, and the agent starting. */
const AUTOMATION_LEAD: TranscriptLead = {
  label: "Prompt",
  icon: <ZapIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />,
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
 * the sender line over the card, naming who, the card's kind where it is not
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
}

/** One tool call: its row, and its input and answer under it once opened, a stop naming the worker it stopped by its job where `jobs` knows it. */
function ToolCallView({
  part,
  jobs,
}: {
  part: Extract<AgentPart, { kind: typeof AGENT_PART.TOOL }>;
  jobs?: WorkerJobs | undefined;
}): ReactNode {
  const view = toolCallView({ ...part, jobs });
  return (
    <>
      <TranscriptTool
        data-call-id={part.callId}
        state={part.state}
        kind={view.kind}
        provider={view.provider}
        subject={view.subject}
        description={view.description}
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
}: {
  part: Extract<AgentPart, { kind: typeof AGENT_PART.TOOL }>;
  open: boolean;
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
    />
  );
}

/** Where the transcript draws the agent's to-do lists: the call whose list stays out of a finished turn's fold, and the call whose list is drawn open, none while the list is docked above the composer. */
interface TodosPlace {
  readonly kept: string | undefined;
  readonly open: string | undefined;
}

/** A transcript that holds no to-do list, as the planning model's does not. */
const NO_TODOS: TodosPlace = { kept: undefined, open: undefined };

/** Where the to-do lists are drawn for the transcript given: the newest kept and open, unless it is docked while the agent works on it. */
function todosPlace(messages: readonly CodingAgentMessage[], working: boolean): TodosPlace {
  const standing = newestTodos(messages);
  const docked = dockedTodos(standing, working);
  return { kept: standing?.callId, open: docked === undefined ? standing?.callId : undefined };
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

/**
 * A call that loaded a skill: the one button that opens the skill's
 * `SKILL.md`, hanging the card a sent message's chip of the skill hangs
 * (`skill-ref.tsx`), where it is one of the plan's skills, and a call's row
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
  onOpen,
}: {
  part: Extract<AgentPart, { kind: typeof AGENT_PART.TOOL }>;
  hint: string;
  card?: ReactNode;
  onOpen: () => void;
}): ReactNode {
  const view = toolCallView(part);
  return (
    <TranscriptOpeningCall
      callId={part.callId}
      kind={view.kind}
      subject={view.subject}
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
      return <TranscriptWords text={part.text} />;
    case AGENT_PART.REASONING:
      return <TranscriptReasoning text={part.text} />;
    case AGENT_PART.TOOL: {
      // A set of pictures the agent showed, or is showing, is drawn as itself; one refused keeps its row, where its error is read.
      if (part.tool === AGENT_TOOL.SHOW_IMAGE && part.state !== TOOL_STATE.OUTPUT_ERROR) {
        return <ShownPictures input={part.input} output={part.output} />;
      }
      if (delegates(part)) return <DelegationRow part={part} doors={delegation} />;
      // A call that failed keeps its row, because the row is where its error is read.
      const target = part.state === TOOL_STATE.OUTPUT_ERROR ? undefined : toolTarget(part);
      const openTarget = delegation?.onOpenTarget;
      if (target !== undefined && openTarget !== undefined) {
        return (
          <OpeningCallView
            part={part}
            hint={TARGET_HINT[target.kind]}
            card={delegation?.cards?.target(target)}
            onOpen={() => openTarget(target)}
          />
        );
      }
      if (part.tool === AGENT_TOOL.WRITE_TODOS) {
        return <TodosRow part={part} open={part.callId === todos.open} />;
      }
      return toolCallView(part).kind === CALL_KIND.LOAD_SKILL ? (
        <LoadedSkillView part={part} />
      ) : (
        <ToolCallView part={part} jobs={delegation?.jobs} />
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
    <Fold className="agent-origin-body text-[12.5px]">
      <FoldSummary className="flex h-7 cursor-pointer items-center gap-2 rounded-md px-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">
        <FoldChevron />
        <WebhookIcon className="size-4 shrink-0" aria-hidden="true" />
        {WEBHOOK_BODY_LABEL}
      </FoldSummary>
      <FoldBody>
        <pre className="m-0 whitespace-pre-wrap px-1 py-1 font-mono text-[12px] [overflow-wrap:anywhere]">
          {body}
        </pre>
      </FoldBody>
    </Fold>
  );
}

/**
 * What the transcript opens on: the plan the agent was handed, an
 * automation's prompt, or the task a worker was, as a message sent to the
 * agent, at a sent message's measure under the line naming who sent it,
 * where the transcript names anyone: a card folded under its title, and a
 * webhook's body folded again inside it.
 */
function PlanCard({
  text,
  lead,
  title = cardTitle(text),
  sender,
  body,
  messageId,
}: {
  text: string;
  lead: TranscriptLead;
  /** The message the card draws, which a link to it is brought into view by; none where it draws no message of the transcript's. */
  messageId?: string | undefined;
  /** The card's line: the text's first line as plain words, unless the transcript names it otherwise. */
  title?: string | undefined;
  /** The line naming who sent it (`TranscriptOrigin`); none where the transcript names nobody. */
  sender?: ReactNode;
  /** A webhook call's body, which rode in with an automation's prompt. */
  body?: string | undefined;
}): ReactNode {
  return (
    <Message from={MESSAGE_ROLE.USER} className="agent-origin" data-message-id={messageId}>
      {sender == null ? null : <span className="message-sender">{sender}</span>}
      <Plan data-plan-card="" aria-label={lead.label} className="agent-origin-card">
        <PlanHeader>
          {lead.icon}
          <PlanTitle label={lead.label}>{title}</PlanTitle>
        </PlanHeader>
        <PlanContent>
          <TranscriptWords text={text} />
          {body === undefined ? null : <OriginBody body={body} />}
        </PlanContent>
      </Plan>
    </Message>
  );
}

/** A task named as the sender of its plan: its document glyph and its name as one target, hanging its card and opening its plan where the place can. */
function TaskRef({ task, onOpen }: { task: BriefTask; onOpen?: (() => void) | undefined }) {
  const inner = (
    <>
      <span className="agent-origin-glyph" aria-hidden="true">
        <DocumentIcon />
      </span>
      <span className="actor-ref-name">{task.name}</span>
    </>
  );
  return (
    <Tooltip label={task.name} card={task.card}>
      {onOpen === undefined ? (
        <span className="actor-ref">{inner}</span>
      ) : (
        <button type="button" className="actor-ref" data-plan-ref="" onClick={onOpen}>
          {inner}
        </button>
      )}
    </Tooltip>
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

/** The issue or pull request an automation's GitHub event named, by number and title, opening on GitHub where the event gave its address. */
function OriginSubject({
  subject,
  openGitHub,
}: {
  subject: NonNullable<CodingAgentOrigin["subject"]>;
  openGitHub: (url: string) => void;
}): React.JSX.Element {
  const words =
    subject.title === undefined ? `#${subject.number}` : `#${subject.number} ${subject.title}`;
  const { url } = subject;
  if (url === undefined) return <span className="agent-origin-subject">{words}</span>;
  return (
    <a
      className="text-link agent-origin-subject"
      href={url}
      onClick={(event) => {
        event.preventDefault();
        openGitHub(url);
      }}
    >
      {words}
    </a>
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
  onOpenPlan: (() => void) | undefined;
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
        <TaskSender task={task} onOpen={input.onOpenPlan} starter={starter} />
      ),
  };
}

/** Who wrote or said a message: their mark and their name, hanging their card. */
function MessageSender({ actor }: { actor: Actor }): React.JSX.Element {
  return (
    <span className="message-sender">
      <ActorRef actor={actor} />
    </span>
  );
}

/** When one of the developer's lines was sent, in the words a finished turn's line ends on (`WorkedFor`), after who sent it where anyone is named. */
function SentTime({ at, named }: { at: number; named: boolean }): React.JSX.Element {
  const now = useMinute();
  return (
    <span className="message-sent-at">
      {named ? <span aria-hidden="true">·</span> : null}
      <time dateTime={new Date(at).toISOString()}>{callHeading(at, now)}</time>
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

/**
 * A sent message's actions, set in the line under its bubble rather than
 * floated on a card over its corner: they still show only while the
 * pointer or the keyboard is on the message, but take their place in the
 * line, so the sender beside them never moves.
 */
const SENT_ACTIONS_CLASS = "static border-0 bg-transparent p-0 shadow-none";

/**
 * One message: the plan the agent was handed, as a card; a message the
 * developer sent it since, as the developer's bubble, with a quiet line
 * under it holding its Copy and Copy link and, at the bubble's edge, who
 * sent it and when; or one of the agent's own turns, with a copy of its
 * words under it where it has any, ending once it has finished on how long
 * it worked and when it ended. A line that reached a turn while it ran is
 * drawn inside it, as its own bubble between the work before it and the
 * work after it.
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
}: {
  message: CodingAgentMessage;
  /** Whether this is the plan the agent was handed, which is the first of the developer's messages. */
  plan: boolean;
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
  if (plan) {
    return (
      <PlanCard
        text={origin?.text ?? words}
        lead={origin?.lead ?? lead}
        title={briefTitle}
        sender={origin?.sender}
        body={origin?.body}
        messageId={message.id}
      />
    );
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
        {words === "" && named === null && sentAt === undefined ? null : (
          <div className="message-meta">
            {words === "" ? null : (
              <CopyMessageAction
                words={words}
                messageId={message.id}
                className={SENT_ACTIONS_CLASS}
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
        {said || !ends ? null : workedFor}
        {words === "" || said || !ends ? null : (
          <CopyMessageAction words={words} messageId={message.id} />
        )}
      </Message>
    );
  });
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
  footer,
  overComposer = false,
  earlierOmitted = false,
  briefTitle,
  briefSender,
  origin,
  readerId,
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
  /** The line the transcript ends on once its turn was stopped or failed (`endLine`); nothing otherwise. */
  ended?: string | undefined;
  /** What mends the turn the end line tells of (`endLineReason`): an API key looked at, or nothing the line offers. */
  endReason?: FailureReason;
  /** Turns to the page holding the API keys, which an end line telling of a key refused offers. */
  onOpenApiKeys?: (() => void) | undefined;
  onRetry: () => void;
  /** What ends the transcript once the agent has: the row summing its pull request up. */
  footer?: ReactNode;
  /** Whether the composer stands right under the log, which the log's foot then fades into. */
  overComposer?: boolean;
  /** Whether older steps than these were left out, which a note says after the card. */
  earlierOmitted?: boolean;
  /** The plan's or task's card line, where it is named otherwise than by its first line, as a planning worker is by its job. */
  briefTitle?: string | undefined;
  /** The teammate who handed the agent its task, named over the task's message; none for the reader's own agent. */
  briefSender?: Actor | undefined;
  /** Who handed the agent what it opens on, which is then its card under their line, a prompt among them; none where only a plan is, whose card names nobody. */
  origin?: TranscriptOrigin | undefined;
  /** The reader's own account id, whose messages are drawn with no name over them (`lineSender`). */
  readerId?: string | undefined;
}): React.JSX.Element {
  const { members, former } = useMemberDirectory();
  if (messages.length > 0) {
    const todos = todosPlace(messages, working);
    // The plan is the first of the developer's messages, unless the agent
    // was handed a prompt in its place, which is the developer's message as
    // any other is, but where something sent it, an automation, when it is
    // that sender's card; the rest the developer sent since.
    const first = messages.find((message) => message.role === MESSAGE_ROLE.USER);
    const carded = brief !== CODING_AGENT_BRIEF.PROMPT || origin !== undefined;
    const plan = carded ? first : undefined;
    const task = carded ? undefined : first;
    // A line that reached a turn while it ran is drawn inside that turn, where it arrived.
    const placed = placedMessages(messages);
    return (
      <Conversation>
        {/* The plan's card stands off the tab row by the gap between a column's groups; lines fade under the bar or banner above. */}
        <ConversationContent
          className={
            overComposer
              ? "scroll-fade agent-log-over-composer pt-(--section-gap)"
              : "scroll-fade pt-(--section-gap)"
          }
        >
          {placed.map(({ message, arrived }, index) => (
            <Fragment key={message.id}>
              <AgentMessage
                message={message}
                plan={message === plan}
                lead={lead}
                moving={working && index === placed.length - 1}
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
          {ended === undefined ? null : endReason === FAILURE_REASON.API_KEY ? (
            <FailureNote
              failure={{ reason: FAILURE_REASON.API_KEY, text: ended }}
              className="agent-end-line"
              onRemedy={onOpenApiKeys}
            />
          ) : (
            <p className="agent-end-line" data-ended="" aria-live="polite">
              {ended}
            </p>
          )}
          {footer}
          {failed ? <ReadFailure line={TRANSCRIPT_FAILED_LINE} onRetry={onRetry} /> : null}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>
    );
  }
  return (
    <ConversationEmptyState>
      {failed ? (
        <ReadFailure
          line={TRANSCRIPT_FAILED_LINE}
          onRetry={onRetry}
          place={READ_FAILURE_PLACE.CENTRED}
        />
      ) : reading && ended === undefined ? (
        <Spinner label="Loading transcript" size={SPINNER_SIZE.REGION} />
      ) : (
        <p className="m-0" data-ended={ended === undefined ? undefined : ""}>
          {ended ?? lead.startingLine}
        </p>
      )}
    </ConversationEmptyState>
  );
}

/**
 * The tab as drawn from what it holds: the transcript with the lines sent
 * and not yet read back at its end, and the composer under it, or, while
 * the plan is archived, the note that offers Unarchive in its place, with
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
  openGitHub,
  onOpenApiKeys,
  keywords,
  skills,
  starter,
  readerId,
  run,
}: {
  agent: CodingAgentSummary;
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
  /** Brings the plan back from the archive; present exactly while it is archived, when no message is sent. */
  onUnarchive?: (() => void) | undefined;
  /** Opens one of the agent's workers in a tab of the panel's own; none where the view stands in no panel. */
  onOpenSubagent?: DelegationDoors["onOpen"];
  /** Opens what one of its calls is about; none where nothing opens it. */
  onOpenTarget?: DelegationDoors["onOpenTarget"];
  /** The cards its rows that open a tab hang; none where they hang their hints. */
  cards?: TranscriptCards | undefined;
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
}): React.JSX.Element {
  const lines = agentLines(transcript.messages, composer.sent);
  const working = agentStillWriting(agent.status);
  const steering = new Set(composer.sent.filter((line) => line.steers).map((line) => line.id));
  const starterActor = usePerson(agent.startedBy);
  const pictures = useAgentPictureDoor(agent.id);
  const { members, former } = useMemberDirectory();
  const origin = agentOrigin({
    agent,
    run,
    task: cards?.task,
    onOpenPlan: onOpenTarget === undefined ? undefined : () => onOpenTarget(PLAN_TARGET),
    starter: starter === undefined ? undefined : starterActor,
    openGitHub,
  });
  return (
    <section className="agent-tab ph-no-capture" aria-label={agentTabLabel(agent, models)}>
      <MacOwnerProvider value={macOwnerOf(agent.startedBy, members, readerId, former)}>
        <AgentPicturesProvider value={pictures}>
          <MentionedServers value={{ disabled: servers.disabled, steering }}>
            <AgentTranscriptView
              messages={lines}
              brief={agent.brief}
              briefSender={starter === undefined ? undefined : starterActor}
              origin={origin}
              readerId={readerId}
              delegation={{
                models,
                own: { model: agent.model, effort: agent.effort },
                starts: delegationStarts && workerStarts(delegationStarts, transcript.subagents),
                onOpen: onOpenSubagent,
                onOpenTarget,
                cards,
                standings: transcript.subagents,
              }}
              reading={transcript.reading}
              failed={transcript.failed}
              working={working}
              sessionStarting={agent.status === CODING_AGENT_STATUS.STARTING}
              startedAt={startedAt}
              ended={endLine(agent.status, transcript.failure, transcript.turnUsage, starter)}
              endReason={endLineReason(transcript.failure, starter)}
              onOpenApiKeys={onOpenApiKeys}
              onRetry={transcript.onRetry}
              footer={
                showsPublishedRow(agent.status, published) ? (
                  <PublishedRow pullRequest={published.pullRequest} openGitHub={openGitHub} />
                ) : null
              }
              overComposer
            />
          </MentionedServers>
        </AgentPicturesProvider>
      </MacOwnerProvider>
      <footer className="agent-tab-foot">
        <TodosDock messages={lines} working={working} />
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
          />
        )}
      </footer>
    </section>
  );
}

export function AgentTab({
  agent,
  control,
  shown,
  onOpenSubagent,
  onOpenChanges,
  onOpenTarget,
  cards,
  onHeld,
  run,
}: {
  agent: CodingAgentSummary;
  /** The automation's run that started the agent, as its page reads it; none on a plan's tab. */
  run?: CodingAgentOrigin | undefined;
  control: CodingAgentsControl;
  /** Whether the tab is on screen: the plan's column showing it, on the Plans tab. */
  shown: boolean;
  /** Opens one of the agent's workers in a tab of the side panel's own, by the call that started it. */
  onOpenSubagent: (callId: string, task: string, status: CodingAgentStatus) => void;
  /** Opens what one of its calls is about in the tab that draws it. */
  onOpenTarget?: DelegationDoors["onOpenTarget"];
  /** The cards its rows that open a tab hang, as those tabs hang them. */
  cards?: TranscriptCards | undefined;
  /** Opens the agent's changes, its pull request's files, in a tab of the side panel's own. */
  onOpenChanges?: (() => void) | undefined;
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
  const composer = useAgentComposer({
    agentId: agent.id,
    planId: agent.planId,
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
  const openGitHub = (url: string) => tell(ACT_KIND.GITHUB_OPEN, { url });
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
          openChanges: onOpenChanges,
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
        starter={teammateStarter(agent.startedBy, control.me)}
        readerId={control.me}
        run={run}
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
  /** Who handed the worker its task, named over its card: the agent that delegated it, which opens its tab; none where the panel names nobody. */
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
            ended={endLine(status, transcript.failure)}
            onRetry={transcript.onRetry}
          />
        </AgentPicturesProvider>
      </MacOwnerProvider>
    </section>
  );
}
