import type {
  CodingAgentMessage,
  CodingAgentPullRequestAnswer,
  CodingAgentSummary,
} from "@sidecar/hosted/coding-agent-wire";
import type { CatalogModel } from "@sidecar/hosted/models-wire";
import { MESSAGE_ROLE } from "@sidecar/wire";
import {
  FilePenIcon,
  FileTextIcon,
  GlobeIcon,
  type LucideIcon,
  SearchIcon,
  TerminalIcon,
  WrenchIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import type { Components } from "streamdown";
import { ACT_KIND } from "#shared/messages/acts";
import { useAct } from "../act";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "../ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
  PANEL_MARKDOWN_COMPONENTS,
} from "../ai-elements/message";
import { Plan, PlanContent, PlanHeader, PlanTitle } from "../ai-elements/plan";
import { Reasoning, ReasoningContent, ReasoningTrigger } from "../ai-elements/reasoning";
import { Shimmer } from "../ai-elements/shimmer";
import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput } from "../ai-elements/tool";
import { AgentComposer } from "./agent-composer";
import { type PublishedDoors, PublishedHead, PublishedRow } from "./agent-published";
import {
  AGENT_PART,
  AGENT_STATUS_LABEL,
  type AgentPart,
  agentLines,
  agentParts,
  agentStillWriting,
  agentTabLabel,
  messageWords,
  opensOnGitHub,
  showsPublishedRow,
} from "./coding-agent-model";
import { CopyMessageAction } from "./copy-message";
import { planCardTitle, TOOL_GLYPH, type ToolGlyph, toolCallView } from "./tool-call-model";
import { type AgentComposerControl, useAgentComposer } from "./use-agent-composer";
import { useAgentPullRequest } from "./use-agent-pull-request";
import { type AgentTranscriptControl, useAgentTranscript } from "./use-agent-transcript";
import type { CodingAgentsControl } from "./use-coding-agents";

/**
 * agent-tab.tsx -- one coding agent's tab in the side panel: what it runs on and where it stands, what it published, its transcript live, and the message box under it.
 *
 * The transcript is drawn with the AI Elements components, as the
 * Transcript tab's is and on the same spacing, from the agent's stored
 * `UIMessage`s as they are, and reads as a devtool's agent pane: the plan
 * it was handed is a card at the top, folded under its title; each of its
 * own turns runs the column's width with its text as markdown, its
 * reasoning folded under one quiet line, and each tool call one compact
 * row saying what it did (`tool-call-model.ts`), with the input and the
 * answer under the row once opened and a call that ended in an error
 * marked in red; a message the developer sent it after the plan is the
 * developer's bubble, as the Transcript tab draws one; and while the agent
 * may still write, a shimmering "Working…" stands at the end, gone the
 * moment it ends so a finished turn ends on its own last line. The list
 * keeps to its newest line while it is scrolled there. A link in the
 * transcript opens in the browser where it is a page on GitHub, which is
 * where the pull request the agent opened lives; every other address is
 * drawn and goes nowhere. The head wears the pull request or the branch
 * the agent published (`agent-published.tsx`), and a finished transcript
 * ends on a row summing the pull request up. Every word here is the
 * agent's or the plan's, so the root is left out of the screen recording
 * (`ph-no-capture`) as a second line behind the recording's text masking.
 * Under the transcript stands the composer (`agent-composer.tsx`): a line
 * the developer sends joins the transcript at once as theirs and is read
 * back from the service's own row, a line queued for after the turn stands
 * above the box until its turn opens, and the Stop is the composer's, the
 * one the tab has.
 */

/** What the tab says before the agent's first message lands. */
const NOTHING_YET_LINE = "The agent is starting. Its transcript appears here.";

/** How the agent's markdown is drawn: at the panel's scale, never as an image, which would be a request the moment the tab opens, and a link only to GitHub. */
function transcriptComponents(openGitHub: (url: string) => void): Components {
  return {
    ...PANEL_MARKDOWN_COMPONENTS,
    img: () => null,
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

/** Each row's icon, by what its glyph stands for. */
const TOOL_ICON = {
  [TOOL_GLYPH.TERMINAL]: TerminalIcon,
  [TOOL_GLYPH.FILE]: FileTextIcon,
  [TOOL_GLYPH.EDIT]: FilePenIcon,
  [TOOL_GLYPH.SEARCH]: SearchIcon,
  [TOOL_GLYPH.WEB]: GlobeIcon,
  [TOOL_GLYPH.GENERIC]: WrenchIcon,
} as const satisfies Record<ToolGlyph, LucideIcon>;

/** The word before a plan card's title. */
const PLAN_CARD_LABEL = "Plan";

/** What stands at the end of the transcript while the agent may still write. */
const WORKING_LINE = "Working…";

/** One tool call: its row, and its input and answer under it once opened. */
function ToolCallView({
  part,
}: {
  part: Extract<AgentPart, { kind: typeof AGENT_PART.TOOL }>;
}): ReactNode {
  const view = toolCallView(part);
  const Icon = TOOL_ICON[view.glyph];
  return (
    <Tool data-call-id={part.callId}>
      <ToolHeader
        state={part.state}
        icon={<Icon aria-hidden="true" />}
        label={view.summary.label}
        code={view.summary.code}
      />
      <ToolContent>
        <ToolInput block={view.input} />
        <ToolOutput block={view.output} errorText={part.errorText} />
      </ToolContent>
    </Tool>
  );
}

/** One part of the agent's turn, drawn by its kind. */
function AgentPartView({
  part,
  components,
}: {
  part: AgentPart;
  components: Components;
}): ReactNode {
  switch (part.kind) {
    case AGENT_PART.TEXT:
      return (
        <MessageResponse mode="static" components={components}>
          {part.text}
        </MessageResponse>
      );
    case AGENT_PART.REASONING:
      return (
        <Reasoning>
          <ReasoningTrigger />
          <ReasoningContent>
            <MessageResponse mode="static" components={components}>
              {part.text}
            </MessageResponse>
          </ReasoningContent>
        </Reasoning>
      );
    case AGENT_PART.TOOL:
      return <ToolCallView part={part} />;
    // A step boundary is the model's own pacing, and the parts keep one rhythm across it.
    case AGENT_PART.STEP_START:
    case AGENT_PART.OTHER:
      return null;
  }
}

/** The plan the agent was handed: a card across the column, folded under its title. */
function PlanCard({ text, components }: { text: string; components: Components }): ReactNode {
  return (
    <Plan data-plan-card="" aria-label={PLAN_CARD_LABEL}>
      <PlanHeader>
        <FileTextIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <PlanTitle label={PLAN_CARD_LABEL}>{planCardTitle(text)}</PlanTitle>
      </PlanHeader>
      <PlanContent>
        <MessageResponse mode="static" components={components}>
          {text}
        </MessageResponse>
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
  components,
  copyText,
}: {
  message: CodingAgentMessage;
  /** Whether this is the plan the agent was handed, which is the first of the developer's messages. */
  plan: boolean;
  components: Components;
  copyText: (words: string) => Promise<void>;
}): ReactNode {
  const parts = agentParts(message);
  const words = messageWords(message);
  if (plan) return <PlanCard text={words} components={components} />;
  if (message.role === MESSAGE_ROLE.USER) {
    return (
      <Message from={message.role}>
        <MessageContent>
          <MessageResponse mode="static" components={components}>
            {words}
          </MessageResponse>
        </MessageContent>
        <CopyMessageAction words={words} copyText={copyText} />
      </Message>
    );
  }
  return (
    <Message from={message.role}>
      <MessageContent>
        {parts.map((part, index) => (
          <AgentPartView key={index} part={part} components={components} />
        ))}
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

/** The tab's head: model · effort · status, and what the agent published. The Stop is the composer's, under the transcript. */
export function AgentHeader({
  agent,
  models,
  published,
  doors,
}: {
  agent: CodingAgentSummary;
  models: readonly CatalogModel[] | undefined;
  /** What the agent published, once the service has said; nothing before. */
  published: CodingAgentPullRequestAnswer | undefined;
  doors: PublishedDoors;
}): React.JSX.Element {
  return (
    <header className="agent-tab-header">
      <AgentStatusDot status={agent.status} />
      <span className="agent-tab-title">
        <strong>{agentTabLabel(agent, models)}</strong>
        <span className="agent-tab-separator"> · </span>
        {agent.effort}
        <span className="agent-tab-separator"> · </span>
        <span data-status={agent.status}>{AGENT_STATUS_LABEL[agent.status]}</span>
      </span>
      <PublishedHead published={published} doors={doors} />
    </header>
  );
}

/** The transcript as the tab draws it: the messages, or what stands in their place. */
export function AgentTranscriptView({
  messages,
  reading,
  failed,
  working,
  onRetry,
  openGitHub,
  copyText,
  footer,
}: {
  messages: readonly CodingAgentMessage[];
  reading: boolean;
  failed: boolean;
  /** Whether the agent may still write, which is when the transcript ends on a working line. */
  working: boolean;
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
    // The plan is the first of the developer's messages; the rest the developer sent since.
    const plan = messages.find((message) => message.role === MESSAGE_ROLE.USER);
    return (
      <Conversation>
        <ConversationContent>
          {messages.map((message) => (
            <AgentMessage
              key={message.id}
              message={message}
              plan={message === plan}
              components={components}
              copyText={copyText}
            />
          ))}
          {working ? (
            <p className="m-0 text-[12.5px]" data-working="" aria-live="polite">
              <Shimmer>{WORKING_LINE}</Shimmer>
            </p>
          ) : null}
          {footer}
          {failed ? (
            <p className="agent-note" role="alert">
              The transcript could not be read.{" "}
              <button type="button" className="plan-button" onClick={onRetry}>
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
          <button type="button" className="plan-button" onClick={onRetry}>
            Try again
          </button>
        </>
      ) : (
        <p className="m-0">{reading ? "Reading the transcript…" : NOTHING_YET_LINE}</p>
      )}
    </ConversationEmptyState>
  );
}

/**
 * The tab as drawn from what it holds: the head, the transcript with the
 * lines sent and not yet read back at its end, and the composer under it
 * with the lines queued above its box.
 */
export function AgentTabView({
  agent,
  models,
  transcript,
  composer,
  published,
  doors,
  onStop,
  openGitHub,
  copyText,
}: {
  agent: CodingAgentSummary;
  models: readonly CatalogModel[] | undefined;
  transcript: AgentTranscriptControl;
  composer: AgentComposerControl;
  /** What the agent published, once the service has said; nothing before. */
  published: CodingAgentPullRequestAnswer | undefined;
  doors: PublishedDoors;
  onStop: () => Promise<void>;
  openGitHub: (url: string) => void;
  copyText: (words: string) => Promise<void>;
}): React.JSX.Element {
  const lines = agentLines(transcript.messages, composer.sent);
  return (
    <section className="agent-tab ph-no-capture" aria-label={agentTabLabel(agent, models)}>
      <AgentHeader agent={agent} models={models} published={published} doors={doors} />
      <AgentTranscriptView
        messages={lines.transcript}
        reading={transcript.reading}
        failed={transcript.failed}
        working={agentStillWriting(agent.status)}
        onRetry={transcript.onRetry}
        openGitHub={openGitHub}
        copyText={copyText}
        footer={
          showsPublishedRow(agent.status, published) ? (
            <PublishedRow pullRequest={published.pullRequest} openGitHub={openGitHub} />
          ) : null
        }
      />
      <footer className="agent-tab-foot">
        <AgentComposer
          status={agent.status}
          composer={composer}
          queued={lines.queued}
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
}: {
  agent: CodingAgentSummary;
  control: CodingAgentsControl;
  /** Whether the tab is on screen: the panel open on it, on the Plans tab. */
  shown: boolean;
}): React.JSX.Element {
  const { act, tell } = useAct();
  const transcript = useAgentTranscript({
    agentId: agent.id,
    status: agent.status,
    shown,
    read: control.readTranscript,
    onStatus: control.onStatus,
  });
  const composer = useAgentComposer({
    agentId: agent.id,
    messages: transcript.messages,
    send: control.onMessage,
    onStatus: control.onStatus,
  });
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
      transcript={transcript}
      composer={composer}
      published={published}
      doors={{ openGitHub, copy: (words) => tell(ACT_KIND.WINDOW_COPY_TEXT, { words }) }}
      onStop={() => control.onStop(agent.id)}
      openGitHub={openGitHub}
      copyText={(words) => act(ACT_KIND.WINDOW_COPY_TEXT, { words })}
    />
  );
}
