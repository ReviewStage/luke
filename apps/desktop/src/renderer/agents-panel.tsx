import {
  type AgentRead,
  CHILD_STATUS,
  type ChildRead,
  type ChildStatus,
} from "@sidecar/hosted/reads-wire";
import {
  BackIcon,
  lastActivityLabel,
  SessionRow as PanelSessionRow,
  RobotIcon,
} from "@sidecar/panel";
import {
  CONVERSATION_VIEW_SOURCE,
  SESSION_URGENCY,
  type SessionIdentity,
  type SessionUrgency,
  type TranscriptSnapshot,
} from "@sidecar/session";
import { cssCustomProperties } from "@sidecar/surface/react-css";
import { TRANSCRIPT_KIND, type TranscriptKind } from "@sidecar/wire";
import { useLayoutEffect, useRef } from "react";
import type { AgentsSnapshot, ChildrenSnapshot } from "#shared/messages/agents";
import { agentSession, agentTitle, subagentTitle } from "./agent-title";
import { ConversationUnreadableNotice } from "./conversation-panel";
import type { ToolRowChip } from "./conversation-tool-row";
import { ConversationTurns, SessionChip } from "./conversation-turns";
import { PANEL_TAB, panelPanelId, panelTabId } from "./panel-tabs";
import type { SessionView } from "./session-model";

/**
 * The three pages the Conversation tab draws: the thread itself, the list of
 * the agents Luke follows and the sub-agents the brain delegated to, and one
 * of their transcripts. Held by the app rather than here, the way the settings
 * page is, because arriving at the tab is arriving at its front page and
 * Escape unwinds the pages one at a time before it leaves the tab.
 */
export const CONVERSATION_PAGE = {
  THREAD: "thread",
  AGENTS: "agents",
  TRANSCRIPT: "transcript",
} as const;

export type ConversationPage = (typeof CONVERSATION_PAGE)[keyof typeof CONVERSATION_PAGE];

/**
 * The row a transcript page is opened from: which conversation, of which
 * kind, and the words the page's header wears for it, taken from the row as
 * it stood when pressed rather than looked up again, so the header reads the
 * same whether the list still names the conversation or not. An agent's row
 * also carries its session's identity, so the header can wear the session's
 * chip in the title's place and keep it level with the roster.
 */
export interface TranscriptRow {
  readonly conversationId: string;
  readonly kind: TranscriptKind;
  readonly title: string;
  readonly status: ChildStatus;
  readonly session?: SessionIdentity;
}

/** Where a child or an agent stands, in the one word its row wears for it. */
const STATUS_WORD = {
  [CHILD_STATUS.ACCEPTED]: "Waiting",
  [CHILD_STATUS.RUNNING]: "Running",
  [CHILD_STATUS.SETTLED]: "Done",
  [CHILD_STATUS.FAILED]: "Failed",
  [CHILD_STATUS.CANCELLED]: "Cancelled",
} as const satisfies Record<ChildStatus, string>;

/**
 * A row's state in the session rows' vocabulary: running spins as working
 * does, settled checks off as complete, failed takes the attention colour,
 * and waiting or cancelled wear none.
 */
const ROW_STATE = {
  [CHILD_STATUS.ACCEPTED]: undefined,
  [CHILD_STATUS.RUNNING]: SESSION_URGENCY.WORKING,
  [CHILD_STATUS.SETTLED]: SESSION_URGENCY.COMPLETE,
  [CHILD_STATUS.FAILED]: SESSION_URGENCY.ATTENTION,
  [CHILD_STATUS.CANCELLED]: undefined,
} as const satisfies Record<ChildStatus, SessionUrgency | undefined>;

/**
 * A row's latest instant: its turn's settle, else its start, else its
 * queuing where the row carries one (an agent's), else its own opening.
 * Both sections sort by it, newest first, so a row's place and its age
 * label read the same instant.
 */
function activityAt(row: ChildRead | AgentRead): number {
  return (
    row.settledAt ??
    row.startedAt ??
    ("queuedAt" in row ? row.queuedAt : undefined) ??
    row.acceptedAt
  );
}

const byLatestActivity = (a: ChildRead | AgentRead, b: ChildRead | AgentRead) =>
  activityAt(b) - activityAt(a);

/** The row a child's transcript is opened from, named as the list names the child. */
export function childTranscriptRow(child: ChildRead): TranscriptRow {
  return {
    conversationId: child.id,
    kind: TRANSCRIPT_KIND.CHILD,
    title: subagentTitle(child),
    status: child.status,
  };
}

/**
 * Whether the list of the row's kind still names its conversation: the host
 * closes a transcript its list no longer names, so the page over it turns
 * back to the list. Nothing while that list is unread, since an unread list
 * names nothing yet; the other list has no say over it.
 */
export function transcriptListed(
  row: TranscriptRow,
  subagents: ChildrenSnapshot,
  agents: AgentsSnapshot,
): boolean | undefined {
  const list = row.kind === TRANSCRIPT_KIND.CHILD ? subagents : agents;
  if (!list.settled) return undefined;
  const rows: readonly { readonly id: string }[] =
    row.kind === TRANSCRIPT_KIND.CHILD ? subagents.children : agents.agents;
  return rows.some((listed) => listed.id === row.conversationId);
}

/** The row an agent's transcript is opened from, named from the roster by session identity, which it carries for the header's chip. */
export function agentTranscriptRow(
  agent: AgentRead,
  roster: readonly SessionView[],
): TranscriptRow {
  return {
    conversationId: agent.id,
    kind: TRANSCRIPT_KIND.OBSERVED,
    title: agentTitle(agent, roster),
    status: agent.status,
    session: { providerId: agent.providerId, providerSessionId: agent.providerSessionId },
  };
}

/**
 * The chip the transcript page's header wears for an agent's session, built
 * as an action row's is: the roster's own title, mark, and identity while it
 * holds the session, pressable exactly when the session's own row is, and
 * that press opens the chat in the provider; once the roster has let the
 * session go, the title the row wore under the provider's mark, a name
 * alone, since a press could reach nothing. Read from the roster where it is
 * drawn, so a session the roster lets go while its page is open stops being
 * a press there too. The Agents list's rows wear no such chip: a row is one
 * press, and it opens the transcript.
 */
function headerChip(
  identity: SessionIdentity,
  title: string,
  roster: readonly SessionView[],
): ToolRowChip {
  const session = agentSession(identity, roster);
  if (session === undefined) return { text: title, markId: identity.providerId, openable: false };
  return {
    text: session.title,
    markId: session.agentId ?? session.providerId,
    identity,
    openable: session.openable,
  };
}

/**
 * The control that turns the Conversation tab to its Agents page and back,
 * seated beside the tab bar the way Clear is. Lit while the list is showing,
 * on the search button's own terms, so the control and its effect cannot be
 * read apart.
 */
export function AgentsButton({
  open,
  onToggle,
}: {
  open: boolean;
  onToggle: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className="conversation-agents"
      data-active={String(open)}
      aria-expanded={open}
      onClick={onToggle}
    >
      Agents
    </button>
  );
}

/** A page's head, as a settings page's: the icon back button, then the page's name and whatever else the line says. */
function AgentsPageHeader({
  backTo,
  onBack,
  children,
}: {
  backTo: string;
  onBack: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <header className="agents-header" style={cssCustomProperties({ "--row-index": 0 })}>
      <button
        type="button"
        className="icon-button agents-back"
        aria-label={`Back to ${backTo}`}
        title="Back"
        onClick={onBack}
      >
        <BackIcon />
      </button>
      {children}
    </header>
  );
}

/** One section of the list: its heading over its rows, or what it says once read with none. */
function AgentsSection({
  heading,
  settled,
  empty,
  children,
}: {
  heading: string;
  settled: boolean;
  empty: string;
  children: readonly React.JSX.Element[];
}): React.JSX.Element {
  return (
    <section className="agents-section">
      <h3 className="agents-section-title">{heading}</h3>
      {children.length > 0 ? (
        children
      ) : settled ? (
        // Only a list actually read may say it is empty.
        <p className="agents-section-empty">{empty}</p>
      ) : null}
    </section>
  );
}

/**
 * One row of either section, in a session row's own anatomy and classes, so
 * an agent or a child reads as a chat does one tab over. An agent leads with
 * its agent's mark; a child, the brain's own, with the robot the thread's
 * chips wear for Luke's agents. The row is one press, and it opens the
 * transcript.
 */
function AgentRow({
  row,
  index,
  mark,
  providerId,
  title,
  origin,
  now,
  onOpen,
}: {
  row: ChildRead | AgentRead;
  index: number;
  mark?: React.ReactNode;
  providerId?: string | undefined;
  title: string;
  origin?: string | undefined;
  now: number;
  onOpen: () => void;
}): React.JSX.Element {
  const state = ROW_STATE[row.status];
  return (
    <button
      type="button"
      className="session-row agent-row"
      {...(state === undefined ? undefined : { "data-state": state })}
      style={cssCustomProperties({ "--row-index": index + 1 })}
      onClick={onOpen}
    >
      <PanelSessionRow
        {...(providerId === undefined ? undefined : { providerId })}
        {...(mark === undefined ? undefined : { mark })}
        title={<span className="agent-name">{title}</span>}
        detail={
          <>
            <span className="agent-status" data-status={row.status}>
              {STATUS_WORD[row.status]}
            </span>
            {origin === undefined ? null : (
              <>
                {" · "}
                <span className="agent-origin">{origin}</span>
              </>
            )}
          </>
        }
        working={state === SESSION_URGENCY.WORKING}
        complete={state === SESSION_URGENCY.COMPLETE}
        when={<span className="agent-age">{lastActivityLabel(activityAt(row), now)}</span>}
      />
    </button>
  );
}

/**
 * The Conversation tab's second page, in two sections: the per-workspace
 * agents first, the coding-agent sessions Luke follows, each named from the
 * roster by session identity with its provider's mark, then the sub-agents
 * the brain delegated to, each named by its label or task. Each section
 * lists its rows by the instant they last moved, newest first, the same
 * instant the row's age reads. Every row wears where it stands and how long
 * ago it last moved, and a row's press opens its transcript on the host and
 * turns the tab to the transcript page that draws it. Mounted under the
 * thread's own root, ids and blocked class alike, because a task's words are
 * the developer's and belong in no optional recording.
 */
export function AgentsPanel({
  subagents,
  agents,
  roster,
  now,
  onOpenTranscript,
  onBack,
}: {
  /** The account's children as the document holds them, and whether a read has landed. */
  subagents: ChildrenSnapshot;
  /** The account's agents as the document holds them, and whether a read has landed. */
  agents: AgentsSnapshot;
  /** The sessions as the roster holds them now, so an agent's row names its session by its current title. */
  roster: readonly SessionView[];
  /** The instant the rows' ages are read against, on the roster's own terms. */
  now: number;
  /** Opens the pressed row's transcript on the host and turns to its page. */
  onOpenTranscript: (row: TranscriptRow) => void;
  /** Returns the tab to the thread. */
  onBack: () => void;
}): React.JSX.Element {
  const listedAgents = [...agents.agents].sort(byLatestActivity);
  const children = [...subagents.children].sort(byLatestActivity);
  return (
    <section
      className="conversation-view agents-page ph-no-capture"
      role="tabpanel"
      id={panelPanelId(PANEL_TAB.CONVERSATION)}
      aria-labelledby={panelTabId(PANEL_TAB.CONVERSATION)}
    >
      <AgentsPageHeader backTo="Conversation" onBack={onBack}>
        <h2 className="agents-title">Agents</h2>
      </AgentsPageHeader>
      <div className="agents-scroll">
        <AgentsSection
          heading="Per-workspace agents"
          settled={agents.settled}
          empty="No per-workspace agents yet"
        >
          {listedAgents.map((agent, index) => (
            <AgentRow
              key={agent.id}
              row={agent}
              index={index}
              providerId={agentSession(agent, roster)?.agentId ?? agent.providerId}
              title={agentTitle(agent, roster)}
              now={now}
              onOpen={() => onOpenTranscript(agentTranscriptRow(agent, roster))}
            />
          ))}
        </AgentsSection>
        <AgentsSection heading="Sub-agents" settled={subagents.settled} empty="No sub-agents yet">
          {children.map((child, index) => (
            <AgentRow
              key={child.id}
              row={child}
              index={listedAgents.length + index}
              mark={<RobotIcon className="agent-robot" />}
              title={subagentTitle(child)}
              origin={
                child.parentKind === CONVERSATION_VIEW_SOURCE.OBSERVED
                  ? "from an observed session"
                  : undefined
              }
              now={now}
              onOpen={() => onOpenTranscript(childTranscriptRow(child))}
            />
          ))}
        </AgentsSection>
      </div>
    </section>
  );
}

/**
 * The Conversation tab's third page: one transcript, a sub-agent's or a
 * per-workspace agent's, drawn as the thread draws its own turns, under the
 * same scroll scaffolding so the sideways pull and the scrollbars behave the
 * same. The header names the way back to the list, the conversation by the
 * title and status the row that opened it wore, and nothing is looked up
 * again but the chip an agent's header wears for its session, which stands
 * with the roster as the thread's chips do and opens the chat in the provider
 * exactly when the session's own row would, so a session the roster lets go
 * or stops opening is no longer a press here either. Nothing else here is
 * live: the words arrive settled, as stored turns, so there is no streaming
 * row, no listening row, and no Stop. The page opens at
 * its tail, as the thread does, and jumps there again only when the transcript
 * gains a turn or another row is opened, so a re-read that adds nothing leaves
 * a reader who scrolled up where they stand. Mounted under the thread's own
 * root, ids and blocked class alike, because the words are the developer's and
 * belong in no optional recording.
 */
export function AgentTranscriptPanel({
  open,
  transcript,
  roster,
  now,
  onOpenChat,
  onBack,
}: {
  /** The row the page was opened from: which conversation, and the header's words for it. */
  open: TranscriptRow;
  /** The transcript the host holds open, if any; drawn only while it is this conversation's. */
  transcript: TranscriptSnapshot | undefined;
  /** The sessions as the roster holds them now, so an action's chip names a session by its current title. */
  roster: readonly SessionView[];
  /** The instant a running turn's wait is read against, on the thread's own terms. */
  now: number;
  /** A session row's own press by identity, for the header's chip and for the chip naming the session an action reached. */
  onOpenChat: (identity: SessionIdentity) => void;
  /** Returns the tab to the Agents list. */
  onBack: () => void;
}): React.JSX.Element {
  // A transcript still standing for another conversation, or for this one
  // under another kind, is the one this open replaced; it is not this page's.
  const own =
    transcript?.conversationId === open.conversationId && transcript.kind === open.kind
      ? transcript
      : undefined;
  const groups = own?.groups ?? [];
  const scroller = useRef<HTMLDivElement | null>(null);
  const shown = useRef<{ row: TranscriptRow; count: number } | undefined>(undefined);

  // Keyed on the row and the count rather than the snapshot: a re-read that
  // hands back the same turns as a new array must not move a reader who
  // scrolled up, nor may one that hands back fewer, while another row opened
  // with as many turns jumps anew.
  useLayoutEffect(() => {
    const last = shown.current;
    shown.current = { row: open, count: groups.length };
    const sameRow = last?.row.conversationId === open.conversationId && last.row.kind === open.kind;
    if (sameRow && groups.length <= last.count) return;
    const element = scroller.current;
    if (!element || groups.length === 0) return;
    element.scrollTop = element.scrollHeight;
  }, [open, groups.length]);

  return (
    <section
      className="conversation-view agents-page ph-no-capture"
      role="tabpanel"
      id={panelPanelId(PANEL_TAB.CONVERSATION)}
      aria-labelledby={panelTabId(PANEL_TAB.CONVERSATION)}
    >
      <AgentsPageHeader backTo="Agents" onBack={onBack}>
        {/* The heading's own name is the title, so heading navigation hears the
            conversation and not the chip's press. */}
        <h2 className="agents-title agent-transcript-title" aria-label={open.title}>
          {open.session === undefined ? (
            open.title
          ) : (
            <SessionChip
              chip={headerChip(open.session, open.title, roster)}
              onOpenChat={onOpenChat}
            />
          )}
        </h2>
        <span className="agent-status" data-status={open.status}>
          {STATUS_WORD[open.status]}
        </span>
      </AgentsPageHeader>
      {groups.length === 0 && own?.settled ? (
        <div className="conversation-empty">
          <strong>Nothing said yet</strong>
        </div>
      ) : (
        <div className="conversation-thread">
          <div className="conversation-scroll" ref={scroller}>
            {groups.length > 0 ? (
              <div className="conversation-pull">
                <ConversationTurns
                  groups={groups}
                  roster={roster}
                  now={now}
                  onOpenChat={onOpenChat}
                />
              </div>
            ) : (
              // Nothing read yet says neither "nothing said" nor a thread: the
              // room says it is still reading until the first read lands.
              <div className="conversation-empty" role="status">
                Loading…
              </div>
            )}
          </div>
        </div>
      )}
      {own?.unreadable ? <ConversationUnreadableNotice /> : null}
    </section>
  );
}
