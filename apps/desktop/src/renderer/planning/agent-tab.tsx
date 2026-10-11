import {
  CODING_AGENT_BRIEF,
  type CodingAgentBrief,
  type CodingAgentMessage,
  type CodingAgentPullRequestAnswer,
  type CodingAgentStatus,
  type CodingAgentSummary,
} from "@sidecar/hosted/coding-agent-wire";
import type { CatalogModel, ModelChoice } from "@sidecar/hosted/models-wire";
import { MESSAGE_ROLE } from "@sidecar/wire";
import { BotIcon, FileTextIcon } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";
import type { Components } from "streamdown";
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
import { AgentComposer } from "./agent-composer";
import { type PublishedDoors, PublishedRow } from "./agent-published";
import {
  AGENT_PART,
  type AgentPart,
  agentLines,
  agentRows,
  agentStillWriting,
  agentTabLabel,
  choiceLabel,
  endLine,
  isDelegation,
  messageWords,
  opensOnGitHub,
  providerOfModel,
  settledPlanEdits,
  showsPublishedRow,
  workerLines,
  workerStatusOf,
} from "./coding-agent-model";
import { CopyMessageAction } from "./copy-message";
import { cardTitle, delegationView, toolCallView } from "./tool-call-model";
import {
  TRANSCRIPT_COMPONENTS,
  TranscriptReasoning,
  TranscriptRows,
  TranscriptSubagent,
  TranscriptTool,
  TranscriptWords,
} from "./transcript-blocks";
import { type AgentComposerControl, useAgentComposer } from "./use-agent-composer";
import { type AgentModelControl, useAgentModel } from "./use-agent-model";
import { useAgentPullRequest } from "./use-agent-pull-request";
import { type AgentTranscriptControl, useAgentTranscript } from "./use-agent-transcript";
import type { CodingAgentsControl } from "./use-coding-agents";
import { WorkingLine } from "./working-time";

/**
 * agent-tab.tsx -- one coding agent's tab in the side panel: its transcript live, and the message box under it wearing what it runs on and what it published.
 *
 * The transcript is drawn as every transcript is (`transcript-blocks.tsx`
 * over `../ai-elements/`), the Transcript and Work tabs alike, from the
 * agent's stored `UIMessage`s as they are, and reads as a devtool's agent
 * pane: the plan it was handed is a card at the top, folded under its
 * title; each of its own turns runs the column's width with its text as
 * markdown, its reasoning folded under one quiet line, each tool call one
 * collapsible row saying what it did (`tool-call-model.ts`), with the
 * input and the answer under the row once opened and a call that ended in
 * an error marked in red, each delegation to a worker a subagent's row on
 * a line of its own, as the Work tab draws its worker's, saying the task
 * and the model and effort the worker runs on, opening onto its answer,
 * and carrying the button that opens the worker's own tab
 * (`AgentSubagentTab`), and its runs of calls and its finished lead
 * folded as the Work tab folds Luke's; a message the developer sent it after the plan
 * is the developer's bubble, as the Transcript tab draws one; and while
 * the agent may still write, a shimmering "Working…" stands at the end,
 * counting how long the run has gone where the service said when it began
 * (`working-time.tsx`), gone the moment it ends so a finished turn ends on
 * its own last line; a
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
 * the agent stands is its tab's dot and the transcript's own lines, what
 * it runs on is the model chip at the box's foot, and what it published
 * is the chip after it. A line the developer sends joins the transcript at
 * once as theirs and is read back from the service's own row, and the
 * Stop is the composer's, the one the tab has. A worker's tab draws the
 * worker's transcript the same way, under the agent and the call that
 * started it, with the task it was handed in the plan card's place and no
 * composer, since nothing is sent to a worker.
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
}

/** An agent's transcript: the plan it was handed, and the agent starting. */
const AGENT_LEAD: TranscriptLead = {
  label: "Plan",
  icon: <FileTextIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />,
  startingLine: "The agent is starting. Its transcript appears here.",
  grouped: true,
};

/** A worker's transcript: the task it was handed, and the worker starting. */
const WORKER_LEAD: TranscriptLead = {
  label: "Task",
  icon: <BotIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />,
  startingLine: "The worker is starting. Its transcript appears here.",
  grouped: false,
};

/** What a delegation's row draws from beyond its part: the catalog its pair is named from, the agent's own pair for a half the agent left to its own, and the press that opens the worker's tab. */
export interface DelegationDoors {
  models: readonly CatalogModel[] | undefined;
  own?: ModelChoice | undefined;
  /** Opens the worker's tab, by the call that started it, with the task and where the worker stands as the row knows it; none where the row stands in a tab that opens no tab. */
  onOpen?: ((callId: string, task: string, status: CodingAgentStatus) => void) | undefined;
}

/** How the agent's markdown is drawn: as every transcript's, with a link only to GitHub. */
function transcriptComponents(openGitHub: (url: string) => void): Components {
  return {
    ...TRANSCRIPT_COMPONENTS,
    a: ({ href, children }) =>
      href !== undefined && opensOnGitHub(href) ? (
        <a
          href={href}
          className="agent-link"
          onClick={(event) => {
            event.preventDefault();
            openGitHub(href);
          }}
        >
          {children}
        </a>
      ) : (
        <span className="agent-link-inert" title={href}>
          {children}
        </span>
      ),
  };
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
      input={view.input}
      output={view.output}
      errorText={part.errorText}
    />
  );
}

/** One delegation: a subagent's row saying the task and the pair, opening onto the worker's answer, with the button into its tab. */
function DelegationRow({
  part,
  doors,
}: {
  part: Extract<AgentPart, { kind: typeof AGENT_PART.TOOL }>;
  doors: DelegationDoors | undefined;
}): ReactNode {
  const view = delegationView(part, doors?.own);
  const onOpen = doors?.onOpen;
  return (
    <TranscriptSubagent
      data-call-id={part.callId}
      task={cardTitle(view.task)}
      pair={
        view.choice === undefined
          ? undefined
          : {
              label: choiceLabel(view.choice, doors?.models ?? []),
              provider: providerOfModel(doors?.models, view.choice.model),
            }
      }
      state={part.state}
      result={view.result}
      errorText={part.errorText}
      onOpen={
        onOpen === undefined
          ? undefined
          : () => onOpen(part.callId, view.task, workerStatusOf(part.state))
      }
    />
  );
}

/** One part of the agent's turn, drawn by its kind. */
function AgentPartView({
  part,
  components,
  delegation,
}: {
  part: AgentPart;
  components: Components;
  delegation: DelegationDoors | undefined;
}): ReactNode {
  switch (part.kind) {
    case AGENT_PART.TEXT:
      return <TranscriptWords text={part.text} components={components} />;
    case AGENT_PART.REASONING:
      return <TranscriptReasoning text={part.text} />;
    case AGENT_PART.TOOL:
      return isDelegation(part) ? (
        <DelegationRow part={part} doors={delegation} />
      ) : (
        <ToolCallView part={part} />
      );
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
  components,
}: {
  text: string;
  lead: TranscriptLead;
  components: Components;
}): ReactNode {
  return (
    <Plan data-plan-card="" aria-label={lead.label}>
      <PlanHeader>
        {lead.icon}
        <PlanTitle label={lead.label}>{cardTitle(text)}</PlanTitle>
      </PlanHeader>
      <PlanContent>
        <TranscriptWords text={text} components={components} />
      </PlanContent>
    </Plan>
  );
}

/**
 * One message: the plan the agent was handed, as a card; a message the
 * developer sent it since, as the developer's bubble; or one of the
 * agent's own turns, with a copy of its words under it where it has any.
 */
function AgentMessage({
  message,
  plan,
  lead,
  moving,
  components,
  delegation,
  copyText,
}: {
  message: CodingAgentMessage;
  /** Whether this is the plan the agent was handed, which is the first of the developer's messages. */
  plan: boolean;
  lead: TranscriptLead;
  /** Whether the agent may still write to this message: it is the last, and the agent still works. */
  moving: boolean;
  components: Components;
  delegation: DelegationDoors | undefined;
  copyText: (words: string) => Promise<void>;
}): ReactNode {
  const words = messageWords(message);
  if (plan) return <PlanCard text={words} lead={lead} components={components} />;
  if (message.role === MESSAGE_ROLE.USER) {
    return (
      <Message from={message.role}>
        <MessageContent>
          <TranscriptWords text={words} components={components} />
        </MessageContent>
        <CopyMessageAction words={words} copyText={copyText} />
      </Message>
    );
  }
  return (
    <Message from={message.role}>
      <MessageContent>
        <TranscriptRows rows={agentRows(message, moving, lead.grouped)}>
          {(part) => <AgentPartView part={part} components={components} delegation={delegation} />}
        </TranscriptRows>
      </MessageContent>
      {words === "" ? null : <CopyMessageAction words={words} copyText={copyText} />}
    </Message>
  );
}

/** The dot that says where an agent stands, pulsing while it may still write. */
export function AgentStatusDot({ status }: { status: CodingAgentSummary["status"] }) {
  return (
    <span
      className="agent-status-dot"
      data-status={status}
      data-live={String(agentStillWriting(status))}
      aria-hidden="true"
    />
  );
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
  startedAt,
  ended,
  onRetry,
  openGitHub,
  copyText,
  footer,
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
  /** When the run under way began, which the working line counts from; none where unknown, when the line only shimmers. */
  startedAt?: number | undefined;
  /** The line the transcript ends on once its turn was stopped or failed (`endLine`); nothing otherwise. */
  ended?: string | undefined;
  onRetry: () => void;
  /** Opens a page of GitHub's in the browser, which is where the agent's pull request lives. */
  openGitHub: (url: string) => void;
  /** Puts a turn's words on the clipboard; a refusal rejects. */
  copyText: (words: string) => Promise<void>;
  /** What ends the transcript once the agent has: the row summing its pull request up. */
  footer?: ReactNode;
}): React.JSX.Element {
  const components = transcriptComponents(openGitHub);
  if (messages.length > 0) {
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
        <ConversationContent className="pt-(--section-gap)">
          {messages.map((message, index) => (
            <AgentMessage
              key={message.id}
              message={message}
              plan={message === plan}
              lead={lead}
              moving={working && index === messages.length - 1}
              components={components}
              delegation={delegation}
              copyText={copyText}
            />
          ))}
          {working ? <WorkingLine startedAt={startedAt} /> : null}
          {ended !== undefined ? (
            <p className="agent-end-line" data-ended="" aria-live="polite">
              {ended}
            </p>
          ) : null}
          {footer}
          {failed ? (
            <p className="agent-note" role="alert">
              The transcript could not be read.{" "}
              <button type="button" className="toolbar-button" onClick={onRetry}>
                Try again
              </button>
            </p>
          ) : null}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>
    );
  }
  return (
    <ConversationEmptyState aria-busy={reading}>
      {failed ? (
        <>
          <p className="m-0" role="alert">
            The transcript could not be read.
          </p>
          <button type="button" className="toolbar-button" onClick={onRetry}>
            Try again
          </button>
        </>
      ) : (
        <p className="m-0" data-ended={ended === undefined ? undefined : ""}>
          {ended ?? (reading ? "Reading the transcript…" : lead.startingLine)}
        </p>
      )}
    </ConversationEmptyState>
  );
}

/**
 * The tab as drawn from what it holds: the transcript with the lines sent
 * and not yet read back at its end, and the composer under it.
 */
export function AgentTabView({
  agent,
  models,
  readModels,
  transcript,
  composer,
  model,
  published,
  doors,
  startedAt,
  onStop,
  onOpenSubagent,
  openGitHub,
  copyText,
}: {
  agent: CodingAgentSummary;
  models: readonly CatalogModel[] | undefined;
  readModels: () => void;
  transcript: AgentTranscriptControl;
  composer: AgentComposerControl;
  model: AgentModelControl;
  /** What the agent published, once the service has said; nothing before. */
  published: CodingAgentPullRequestAnswer | undefined;
  doors: PublishedDoors;
  /** When the agent's run began, as the working line counts from it; none while the tab is off screen, so nothing counts unseen. */
  startedAt: number | undefined;
  onStop: () => Promise<void>;
  /** Opens one of the agent's workers in a tab of the panel's own; none where the view stands in no panel. */
  onOpenSubagent?: DelegationDoors["onOpen"];
  openGitHub: (url: string) => void;
  copyText: (words: string) => Promise<void>;
}): React.JSX.Element {
  return (
    <section className="agent-tab ph-no-capture" aria-label={agentTabLabel(agent, models)}>
      <AgentTranscriptView
        messages={agentLines(transcript.messages, composer.sent)}
        brief={agent.brief}
        delegation={{
          models,
          own: { model: agent.model, effort: agent.effort },
          onOpen: onOpenSubagent,
        }}
        reading={transcript.reading}
        failed={transcript.failed}
        working={agentStillWriting(agent.status)}
        startedAt={startedAt}
        ended={endLine(agent.status, transcript.failure, transcript.turnUsage)}
        onRetry={transcript.onRetry}
        openGitHub={openGitHub}
        copyText={copyText}
        footer={
          showsPublishedRow(agent.status, published) ? (
            <PublishedRow
              pullRequest={published.pullRequest}
              turnUsage={transcript.turnUsage}
              openGitHub={openGitHub}
            />
          ) : null
        }
      />
      <footer className="agent-tab-foot">
        <AgentComposer
          status={agent.status}
          composer={composer}
          model={model}
          models={models}
          readModels={readModels}
          usage={transcript.usage}
          published={published}
          doors={doors}
          onStop={onStop}
        />
      </footer>
    </section>
  );
}

export function AgentTab({
  agent,
  control,
  shown,
  onOpenSubagent,
}: {
  agent: CodingAgentSummary;
  control: CodingAgentsControl;
  /** Whether the tab is on screen: the panel open on it, on the Plans tab. */
  shown: boolean;
  /** Opens one of the agent's workers in a tab of the panel's own, by the call that started it. */
  onOpenSubagent: (callId: string, task: string, status: CodingAgentStatus) => void;
}): React.JSX.Element {
  const { act, tell } = useAct();
  const transcript = useAgentTranscript({
    agentId: agent.id,
    status: agent.status,
    shown,
    read: control.readTranscript,
    onStatus: control.onStatus,
    onTitle: control.onTitle,
  });
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
  const published = useAgentPullRequest({
    agentId: agent.id,
    status: agent.status,
    shown,
    messages: transcript.messages,
    read: control.readPullRequest,
  });
  const openGitHub = (url: string) => tell(ACT_KIND.GITHUB_OPEN, { url });
  return (
    <AgentTabView
      agent={agent}
      models={control.models}
      readModels={control.readModels}
      transcript={transcript}
      composer={composer}
      model={model}
      published={published}
      doors={{ openGitHub, copy: (words) => tell(ACT_KIND.WINDOW_COPY_TEXT, { words }) }}
      startedAt={shown ? agent.runStartedAt : undefined}
      onStop={() => control.onStop(agent.id)}
      onOpenSubagent={onOpenSubagent}
      openGitHub={openGitHub}
      copyText={(words) => act(ACT_KIND.WINDOW_COPY_TEXT, { words })}
    />
  );
}

/**
 * One of an agent's workers in a tab of the panel's own: its transcript,
 * read under the agent and the call that started it and followed while
 * the worker runs, drawn as the agent's is with the task it was handed in
 * the plan's place, a working line at its end while it runs, and no head
 * and no composer, since the tab's own label names the task and nothing is
 * sent to a worker. Where the worker stands is what its pages say, which
 * the panel keeps for the tab's glyph (`onStatus`).
 */
export function AgentSubagentTab({
  agentId,
  callId,
  task,
  status,
  control,
  shown,
  onStatus,
}: {
  agentId: string;
  callId: string;
  task: string;
  status: CodingAgentStatus;
  control: CodingAgentsControl;
  shown: boolean;
  /** A page said where the worker stands now. */
  onStatus: (status: CodingAgentStatus) => void;
}): React.JSX.Element {
  const { act, tell } = useAct();
  const transcript = useAgentTranscript({
    agentId,
    callId,
    status,
    shown,
    read: control.readTranscript,
    onStatus: (_agentId, next) => onStatus(next),
    // A worker's page names the worker's conversation, which is no title of the agent's.
    onTitle: () => undefined,
  });
  return (
    <section className="agent-tab ph-no-capture" aria-label={cardTitle(task)}>
      <AgentTranscriptView
        messages={workerLines(task, transcript.messages)}
        lead={WORKER_LEAD}
        delegation={{ models: control.models }}
        reading={transcript.reading}
        failed={transcript.failed}
        working={agentStillWriting(status)}
        ended={endLine(status, transcript.failure)}
        onRetry={transcript.onRetry}
        openGitHub={(url) => tell(ACT_KIND.GITHUB_OPEN, { url })}
        copyText={(words) => act(ACT_KIND.WINDOW_COPY_TEXT, { words })}
      />
    </section>
  );
}
