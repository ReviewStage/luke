import {
  CODING_AGENT_BRIEF,
  CODING_AGENT_STATUS,
  type CodingAgentBrief,
  type CodingAgentMessage,
  type CodingAgentPullRequestAnswer,
  type CodingAgentStatus,
  type CodingAgentSubagentStanding,
  type CodingAgentSummary,
} from "@sidecar/hosted/coding-agent-wire";
import type { CatalogModel, ModelChoice, ModelProvider } from "@sidecar/hosted/models-wire";
import { CodingAgentsIcon, DocumentIcon } from "@sidecar/panel";
import { MESSAGE_ROLE } from "@sidecar/wire";
import { BotIcon } from "lucide-react";
import { Fragment, type ReactNode, useEffect, useRef } from "react";
import { ACT_KIND } from "#shared/messages/acts";
import { useAct } from "../act";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "../ai-elements/conversation";
import { Message, MessageContent } from "../ai-elements/message";
import { Plan, PlanContent, PlanHeader, PlanTitle } from "../ai-elements/plan";
import { TOOL_STATE } from "../ai-elements/tool";
import { useCopyToast } from "../copy-feedback";
import { HarnessMark } from "../provider-marks";
import { RetryButton } from "../retry-button";
import { SPINNER_SIZE, Spinner } from "../spinner";
import { StateGlyph, stateEndMark } from "../state-glyph";
import { AgentComposer } from "./agent-composer";
import { type PublishedDoors, PublishedRow } from "./agent-published";
import type { AgentServersControl } from "./agent-servers";
import type { HeldTranscript } from "./agent-tab-card";
import { ArchivedComposerNote } from "./archived-plan";
import { AttachedFileChips, messageFileChips } from "./attached-file-chips";
import {
  AGENT_PART,
  type AgentPart,
  agentGlyphState,
  agentLines,
  agentRows,
  agentStillWriting,
  agentTabLabel,
  agentWorkingPhase,
  delegates,
  dockedTodos,
  endLine,
  messageWords,
  newestTodos,
  providerOf,
  settledPlanEdits,
  showsPublishedRow,
  startedAgentOf,
  WORKING_PHASE_WORDS,
  workerLines,
  workerStatusOf,
  workerToolState,
} from "./coding-agent-model";
import { CopyMessageAction } from "./copy-message";
import type { SkillSource } from "./skill-picker";
import {
  AGENT_TOOL,
  cardTitle,
  delegationView,
  todoFocus,
  todosSummary,
  todosView,
  toolCallView,
} from "./tool-call-model";
import {
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
import { CALL_KIND, CALL_WORDS } from "./turn-rows";
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
 * pane: the plan it was handed is a card at the top, folded under its
 * title; each of its own turns runs the column's width with its text as
 * markdown, its reasoning folded under one quiet line, each tool call one
 * collapsible row saying what it did (`tool-call-model.ts`), with the
 * input and the answer under the row once opened and a call that ended in
 * an error marked in red, each delegation to a worker a subagent's row on
 * a line of its own, as the Call tab draws its worker's, saying the task
 * and the model and effort the worker runs on, the whole line the one
 * button that opens the worker's own tab in the side panel (`AgentSubagentTab`), each write
 * of its to-do list the list on a row of its own where it landed, open
 * while it is the newest and folded once a newer one stands, the newest
 * docked over the composer instead while the agent works through it, and its
 * runs of calls and its finished lead folded as the Call tab folds Luke's; a message the developer sent it after the plan
 * is the developer's bubble, as the Call tab draws one; and while
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
  /** Whether runs of calls fold under one line; a worker's session is read for its detail, so its do not. */
  grouped: boolean;
  /** Whether a finished turn's line wears the mark of the harness its model ran in; Luke's own turns run in none. */
  harnessed: boolean;
}

/** An agent's transcript: the plan it was handed, and the agent starting. */
const AGENT_LEAD: TranscriptLead = {
  label: "Plan",
  icon: (
    <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground [&>svg]:size-4">
      <DocumentIcon />
    </span>
  ),
  startingLine: "The agent is starting. Its transcript appears here.",
  grouped: true,
  harnessed: true,
};

/** A worker's transcript: the task it was handed, and the worker starting. */
export const WORKER_LEAD: TranscriptLead = {
  label: "Task",
  icon: <BotIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />,
  startingLine: "The worker is starting. Its transcript appears here.",
  grouped: false,
  harnessed: true,
};

/** The planning model's turns, which open on no card and run in no harness of a coding agent's. */
export const PLANNING_LEAD: TranscriptLead = {
  ...AGENT_LEAD,
  harnessed: false,
};

/** What a delegation's row draws from beyond its part: the catalog its pair is named from, the agent's own pair for a half the agent left to its own, when each running worker began, and the press that opens the worker's tab. */
export interface DelegationDoors {
  models: readonly CatalogModel[] | undefined;
  own?: ModelChoice | undefined;
  /** When each running worker began, by the call that started it, which its row counts from; none while the tab is off screen, so nothing counts unseen. */
  starts?: ReadonlyMap<string, number> | undefined;
  /** Opens the worker's tab, by the call that started it, with the task and where the worker stands as the row knows it; none where the row stands in a tab that opens no tab. */
  onOpen?: ((callId: string, task: string, status: CodingAgentStatus) => void) | undefined;
  /** Opens a coding agent's tab, by the agent, which the row of a call that started one asks for; none where nothing opens one. */
  onOpenAgent?: ((agentId: string) => void) | undefined;
  /** Where each worker stands as its own session reads, by the call that started it, which its row says over the call's own state; none from a service older than it. */
  standings?: ReadonlyMap<string, CodingAgentSubagentStanding> | undefined;
}

/** One tool call: its row, and its input and answer under it once opened. */
function ToolCallView({
  part,
}: {
  part: Extract<AgentPart, { kind: typeof AGENT_PART.TOOL }>;
}): ReactNode {
  const view = toolCallView(part);
  return (
    <TranscriptTool
      data-call-id={part.callId}
      state={part.state}
      kind={view.kind}
      subject={view.subject}
      description={view.description}
      input={view.input}
      output={view.output}
      errorText={part.errorText}
    />
  );
}

/** When each running worker began: the newest turn's waits, and every worker its own session says still runs. */
function workerStarts(
  waits: ReadonlyMap<string, number>,
  standings: ReadonlyMap<string, CodingAgentSubagentStanding>,
): ReadonlyMap<string, number> {
  const running = [...standings.values()].filter(
    (standing) => workerToolState(standing.status) === TOOL_STATE.INPUT_AVAILABLE,
  );
  return new Map([
    ...waits,
    ...running.map((standing) => [standing.callId, standing.startedAt] as const),
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

/** A call that started a coding agent, once it began: the one button that opens the agent's tab, saying what it did. */
function OpeningCallView({
  part,
  onOpen,
}: {
  part: Extract<AgentPart, { kind: typeof AGENT_PART.TOOL }>;
  onOpen: () => void;
}): ReactNode {
  const view = toolCallView(part);
  return (
    <TranscriptOpeningCall
      callId={part.callId}
      kind={view.kind}
      subject={view.subject}
      state={part.state}
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
      if (delegates(part)) return <DelegationRow part={part} doors={delegation} />;
      const agent = startedAgentOf(part);
      const openAgent = delegation?.onOpenAgent;
      if (agent !== undefined && openAgent !== undefined) {
        return <OpeningCallView part={part} onOpen={() => openAgent(agent)} />;
      }
      return part.tool === AGENT_TOOL.WRITE_TODOS ? (
        <TodosRow part={part} open={part.callId === todos.open} />
      ) : (
        <ToolCallView part={part} />
      );
    }
    // A step boundary is the model's own pacing, and the parts keep one rhythm across it.
    case AGENT_PART.STEP_START:
    case AGENT_PART.OTHER:
      return null;
  }
}

/** The plan the agent was handed, or the task a worker was: a card across the column, folded under its title. */
function PlanCard({
  text,
  lead,
  title = cardTitle(text),
}: {
  text: string;
  lead: TranscriptLead;
  /** The card's line: the text's first line as plain words, unless the transcript names it otherwise. */
  title?: string | undefined;
}): ReactNode {
  return (
    <Plan data-plan-card="" aria-label={lead.label}>
      <PlanHeader>
        {lead.icon}
        <PlanTitle label={lead.label}>{title}</PlanTitle>
      </PlanHeader>
      <PlanContent>
        <TranscriptWords text={text} />
      </PlanContent>
    </Plan>
  );
}

/**
 * One message: the plan the agent was handed, as a card; a message the
 * developer sent it since, as the developer's bubble; or one of the
 * agent's own turns, with a copy of its words under it where it has any,
 * ending once it has finished on how long it worked and when it ended.
 */
export function AgentMessage({
  message,
  plan,
  lead,
  moving,
  delegation,
  todos = NO_TODOS,
  briefTitle,
}: {
  message: CodingAgentMessage;
  /** Whether this is the plan the agent was handed, which is the first of the developer's messages. */
  plan: boolean;
  /** The plan's or task's card line, where the transcript names it otherwise than by its first line. */
  briefTitle?: string | undefined;
  lead: TranscriptLead;
  /** Whether the agent may still write to this message: it is the last, and the agent still works. */
  moving: boolean;
  delegation: DelegationDoors | undefined;
  todos?: TodosPlace;
}): ReactNode {
  const words = messageWords(message);
  if (plan) return <PlanCard text={words} lead={lead} title={briefTitle} />;
  if (message.role === MESSAGE_ROLE.USER) {
    return (
      <Message from={message.role}>
        <AttachedFileChips files={messageFileChips(message)} />
        {words === "" ? null : (
          <>
            <MessageContent>
              <TranscriptWords text={words} />
            </MessageContent>
            <CopyMessageAction words={words} />
          </>
        )}
      </Message>
    );
  }
  const { startedAt, finishedAt } = message;
  return (
    <Message from={message.role}>
      <MessageContent>
        <TranscriptRows rows={agentRows(message, moving, lead.grouped, todos.kept)}>
          {(part) => <AgentPartView part={part} delegation={delegation} todos={todos} />}
        </TranscriptRows>
      </MessageContent>
      {moving || startedAt === undefined || finishedAt === undefined ? null : (
        <WorkedFor
          startedAt={startedAt}
          endedAt={finishedAt}
          record={message}
          models={delegation?.models}
          harnessed={lead.harnessed}
        />
      )}
      {words === "" ? null : <CopyMessageAction words={words} />}
    </Message>
  );
}

/**
 * A coding agent's mark at rest, wherever one is drawn: the mark of the
 * harness its model runs in, or the Coding agents glyph where Luke knows no
 * harness for it. A row that says where the agent stands wears it inside
 * `AgentGlyph`; one that leaves that to the agent's tab, as the "+" does,
 * or knows nothing of where it stands, as a revision's author, wears it bare.
 */
export function AgentMark({ provider }: { provider: ModelProvider | undefined }) {
  return provider === undefined ? <CodingAgentsIcon /> : <HarnessMark provider={provider} />;
}

/**
 * A subagent's mark: the mark of the harness its model runs in, as its row
 * in a transcript wears it, or the worker's robot where its model is not
 * known. Note that the harness is read from the model's id, as an agent's
 * is, so the mark stands before the catalog is read.
 */
export function SubagentMark({ model }: { model: string | undefined }) {
  const provider = model === undefined ? undefined : providerOf(model);
  return provider === undefined ? <BotIcon /> : <HarnessMark provider={provider} />;
}

/**
 * An agent's glyph wearing where it stands: its mark (`AgentMark`) at its
 * full size, giving way to the working mark while the agent may still write
 * (`state-glyph.tsx`). A failed agent keeps its mark, and its row or tab
 * says the failure at its end (`agentEndMark`).
 */
export function AgentGlyph({ agent }: { agent: Pick<CodingAgentSummary, "model" | "status"> }) {
  return (
    <StateGlyph
      glyph={<AgentMark provider={providerOf(agent.model)} />}
      state={agentGlyphState(agent.status)}
    />
  );
}

/** The mark at the end of an agent's row or tab: the failed mark once its turn failed, nothing otherwise (`stateEndMark`). */
export function agentEndMark(
  agent: Pick<CodingAgentSummary, "status">,
  hinted: boolean,
): React.JSX.Element | undefined {
  return stateEndMark(agentGlyphState(agent.status), hinted);
}

/** The transcript as the tab draws it: the messages, or what stands in their place. */
export function AgentTranscriptView({
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
  onRetry,
  footer,
  overComposer = false,
  earlierOmitted = false,
  briefTitle,
}: {
  messages: readonly CodingAgentMessage[];
  /** What the agent was handed first: the plan, drawn as the plan's card, or a task, drawn as the developer's message; nothing reads as the plan. */
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
  onRetry: () => void;
  /** What ends the transcript once the agent has: the row summing its pull request up. */
  footer?: ReactNode;
  /** Whether the composer stands right under the log, which the log's foot then fades into. */
  overComposer?: boolean;
  /** Whether older steps than these were left out, which a note says after the card. */
  earlierOmitted?: boolean;
  /** The plan's or task's card line, where it is named otherwise than by its first line, as a planning worker is by its job. */
  briefTitle?: string | undefined;
}): React.JSX.Element {
  if (messages.length > 0) {
    const todos = todosPlace(messages, working);
    // The plan is the first of the developer's messages, unless the agent
    // was handed a task in its place, which is the developer's message as
    // any other is; the rest the developer sent since.
    const plan =
      brief === CODING_AGENT_BRIEF.TASK
        ? undefined
        : messages.find((message) => message.role === MESSAGE_ROLE.USER);
    return (
      <Conversation>
        {/* The plan's card stands off the tab row by the gap between a column's groups. */}
        <ConversationContent
          className={
            overComposer ? "agent-log-over-composer pt-(--section-gap)" : "pt-(--section-gap)"
          }
        >
          {messages.map((message, index) => (
            <Fragment key={message.id}>
              <AgentMessage
                message={message}
                plan={message === plan}
                lead={lead}
                moving={working && index === messages.length - 1}
                delegation={delegation}
                todos={todos}
                briefTitle={briefTitle}
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
          {ended !== undefined ? (
            <p className="agent-end-line" data-ended="" aria-live="polite">
              {ended}
            </p>
          ) : null}
          {footer}
          {failed ? (
            <div className="agent-note agent-failure" role="alert">
              <p className="m-0">The transcript could not be read.</p>
              <RetryButton onRetry={onRetry} />
            </div>
          ) : null}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>
    );
  }
  return (
    <ConversationEmptyState>
      {failed ? (
        <>
          <p className="m-0" role="alert">
            The transcript could not be read.
          </p>
          <RetryButton onRetry={onRetry} />
        </>
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
export function AgentTabView({
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
  openGitHub,
  keywords,
  skills,
}: {
  agent: CodingAgentSummary;
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
  openGitHub: (url: string) => void;
  /** The words a dictation into the box is likely to say. */
  keywords?: readonly string[] | undefined;
  /** Where the skills a `/` in the box offers are read from; nothing where it offers none. */
  skills?: SkillSource | undefined;
}): React.JSX.Element {
  const lines = agentLines(transcript.messages, composer.sent);
  const working = agentStillWriting(agent.status);
  return (
    <section className="agent-tab ph-no-capture" aria-label={agentTabLabel(agent, models)}>
      <AgentTranscriptView
        messages={lines}
        brief={agent.brief}
        delegation={{
          models,
          own: { model: agent.model, effort: agent.effort },
          starts: delegationStarts && workerStarts(delegationStarts, transcript.subagents),
          onOpen: onOpenSubagent,
          standings: transcript.subagents,
        }}
        reading={transcript.reading}
        failed={transcript.failed}
        working={working}
        sessionStarting={agent.status === CODING_AGENT_STATUS.STARTING}
        startedAt={startedAt}
        ended={endLine(agent.status, transcript.failure, transcript.turnUsage)}
        onRetry={transcript.onRetry}
        footer={
          showsPublishedRow(agent.status, published) ? (
            <PublishedRow pullRequest={published.pullRequest} openGitHub={openGitHub} />
          ) : null
        }
        overComposer
      />
      <footer className="agent-tab-foot">
        <TodosDock messages={lines} working={working} />
        {onUnarchive !== undefined ? (
          <ArchivedComposerNote
            onUnarchive={onUnarchive}
            stop={agent.status === CODING_AGENT_STATUS.RUNNING ? onStop : undefined}
          />
        ) : (
          <AgentComposer
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
  onHeld,
}: {
  agent: CodingAgentSummary;
  control: CodingAgentsControl;
  /** Whether the tab is on screen: the plan's column showing it, on the Plans tab. */
  shown: boolean;
  /** Opens one of the agent's workers in a tab of the side panel's own, by the call that started it. */
  onOpenSubagent: (callId: string, task: string, status: CodingAgentStatus) => void;
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
    tell(ACT_KIND.PLANNING_REFRESH);
  }, [settledEdits, tell]);
  const composer = useAgentComposer({
    agentId: agent.id,
    messages: transcript.messages,
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
  return (
    <AgentTabView
      agent={agent}
      models={control.models}
      readModels={control.readModels}
      transcript={transcript}
      composer={composer}
      model={model}
      servers={servers}
      published={published}
      doors={{ openGitHub, copy: copyWithToast, openChanges: onOpenChanges }}
      startedAt={shown ? agent.runStartedAt : undefined}
      delegationStarts={shown ? transcript.delegations : undefined}
      onStop={() => control.onStop(agent.id)}
      onUnarchive={control.onUnarchive}
      onOpenSubagent={onOpenSubagent}
      openGitHub={openGitHub}
      keywords={control.keywords}
      skills={control.readSkills}
    />
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
}: {
  agentId: string;
  callId: string;
  task: string;
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
  // As an agent's: dated by the page it was read from, with the worker's own title.
  useEffect(() => {
    if (pageStatus === undefined || messages.length === 0) return;
    const held = { messages, status: pageStatus, runStartedAt, title: pageTitle };
    onHeld(callId, { ...held, subagentTitles: new Map() });
  }, [onHeld, callId, messages, pageStatus, runStartedAt, pageTitle]);
  return (
    <section className="agent-tab ph-no-capture" aria-label={cardTitle(task)}>
      <AgentTranscriptView
        messages={workerLines(task, transcript.messages)}
        lead={WORKER_LEAD}
        delegation={{ models: control.models }}
        reading={transcript.reading}
        failed={transcript.failed}
        working={agentStillWriting(status)}
        sessionStarting={status === CODING_AGENT_STATUS.STARTING}
        startedAt={shown ? transcript.runStartedAt : undefined}
        ended={endLine(status, transcript.failure)}
        onRetry={transcript.onRetry}
      />
    </section>
  );
}
