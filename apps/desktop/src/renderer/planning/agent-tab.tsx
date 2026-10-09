import {
  CODING_AGENT_STATUS,
  type CodingAgentMessage,
  type CodingAgentSummary,
} from "@sidecar/hosted/coding-agent-wire";
import type { CatalogModel } from "@sidecar/hosted/models-wire";
import { StopIcon } from "@sidecar/panel";
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
import { type ReactNode, useState } from "react";
import type { Components } from "streamdown";
import { ACT_KIND } from "#shared/messages/acts";
import { useAct } from "../act";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "../ai-elements/conversation";
import { Fold, FoldBody, FoldChevron, FoldSummary } from "../ai-elements/fold";
import {
  Message,
  MessageContent,
  MessageResponse,
  PANEL_MARKDOWN_COMPONENTS,
} from "../ai-elements/message";
import { Reasoning, ReasoningContent, ReasoningTrigger } from "../ai-elements/reasoning";
import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput } from "../ai-elements/tool";
import {
  AGENT_PART,
  AGENT_STATUS_LABEL,
  type AgentPart,
  agentParts,
  agentStillWriting,
  agentTabLabel,
  opensOnGitHub,
} from "./coding-agent-model";
import { planCardTitle, TOOL_GLYPH, type ToolGlyph, toolCallView } from "./tool-call-model";
import { useAgentTranscript } from "./use-agent-transcript";
import type { CodingAgentsControl } from "./use-coding-agents";

/**
 * agent-tab.tsx -- one coding agent's tab in the side panel: what it runs on and where it stands, the Stop, and its transcript live.
 *
 * The transcript is drawn with the AI Elements components, as the
 * Transcript tab's is, from the agent's stored `UIMessage`s as they are,
 * and reads as a devtool's agent pane: the plan it was handed is a card
 * at the top, folded under its title; each of its own turns runs the
 * column's width with its text as markdown, its reasoning folded under
 * one quiet line, and each tool call one compact row saying what it did
 * (`tool-call-model.ts`), with the input and the answer under the row
 * once opened and a call that ended in an error marked in red. The list
 * keeps to its newest line while it is scrolled there. A link in the
 * transcript opens in the browser where it is a page on GitHub, which is
 * where the pull request the agent opened lives; every other address is
 * drawn and goes nowhere. Every word here is the agent's or the plan's,
 * so the root is left out of the screen recording (`ph-no-capture`) as a
 * second line behind the recording's text masking.
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
    <Fold
      className="rounded-lg border border-border bg-muted text-[12.5px]"
      data-plan-card=""
      aria-label={PLAN_CARD_LABEL}
    >
      <FoldSummary className="flex h-8 items-center gap-2 px-3 transition-colors hover:bg-secondary">
        <FoldChevron />
        <FileTextIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">
          <span className="text-muted-foreground">{PLAN_CARD_LABEL} · </span>
          <span className="font-medium">{planCardTitle(text)}</span>
        </span>
      </FoldSummary>
      <FoldBody className="border-t border-border px-3 py-2 text-[13px] leading-normal">
        <MessageResponse mode="static" components={components}>
          {text}
        </MessageResponse>
      </FoldBody>
    </Fold>
  );
}

/** One message: the plan the agent was handed, as a card, or one of the agent's own turns. */
function AgentMessage({
  message,
  components,
}: {
  message: CodingAgentMessage;
  components: Components;
}): ReactNode {
  const parts = agentParts(message);
  if (message.role === MESSAGE_ROLE.USER) {
    const text = parts
      .flatMap((part) => (part.kind === AGENT_PART.TEXT ? [part.text] : []))
      .join("\n\n");
    return <PlanCard text={text} components={components} />;
  }
  return (
    <Message from={message.role}>
      <MessageContent>
        {parts.map((part, index) => (
          <AgentPartView key={index} part={part} components={components} />
        ))}
      </MessageContent>
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

/** The tab's head: model · effort · status, and the Stop while the agent may still write. */
export function AgentHeader({
  agent,
  models,
  onStop,
}: {
  agent: CodingAgentSummary;
  models: readonly CatalogModel[] | undefined;
  onStop: (agentId: string) => Promise<void>;
}): React.JSX.Element {
  const [stopping, setStopping] = useState(false);
  // Note that Stop stands only once a turn runs, because the service cancels
  // the turn under way and a starting agent has none yet to cancel.
  const stoppable = agent.status === CODING_AGENT_STATUS.RUNNING;
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
      {stoppable ? (
        <button
          type="button"
          className="toolbar-button agent-stop"
          disabled={stopping}
          onClick={() => {
            setStopping(true);
            onStop(agent.id).finally(() => setStopping(false));
          }}
        >
          <StopIcon />
          {stopping ? "Stopping…" : "Stop"}
        </button>
      ) : null}
    </header>
  );
}

/** The transcript as the tab draws it: the messages, or what stands in their place. */
export function AgentTranscriptView({
  messages,
  reading,
  failed,
  onRetry,
  openGitHub,
}: {
  messages: readonly CodingAgentMessage[];
  reading: boolean;
  failed: boolean;
  onRetry: () => void;
  /** Opens a page of GitHub's in the browser, which is where the agent's pull request lives. */
  openGitHub: (url: string) => void;
}): React.JSX.Element {
  const components = transcriptComponents(openGitHub);
  if (messages.length > 0) {
    return (
      <Conversation>
        <ConversationContent>
          {messages.map((message) => (
            <AgentMessage key={message.id} message={message} components={components} />
          ))}
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
  const { tell } = useAct();
  const transcript = useAgentTranscript({
    agentId: agent.id,
    status: agent.status,
    shown,
    read: control.readTranscript,
    onStatus: control.onStatus,
  });
  return (
    <section className="agent-tab ph-no-capture" aria-label={agentTabLabel(agent, control.models)}>
      <AgentHeader agent={agent} models={control.models} onStop={control.onStop} />
      <AgentTranscriptView
        messages={transcript.messages}
        reading={transcript.reading}
        failed={transcript.failed}
        onRetry={transcript.onRetry}
        openGitHub={(url) => tell(ACT_KIND.GITHUB_OPEN, { url })}
      />
    </section>
  );
}
