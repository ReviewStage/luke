import {
  type AgentRead,
  CHILD_STATUS,
  type ChildRead,
  type ChildStatus,
} from "@sidecar/hosted/reads-wire";
import { lastActivityLabel, ProviderMark } from "@sidecar/panel";
import {
  type ChildTranscriptSnapshot,
  CONVERSATION_VIEW_SOURCE,
  type SessionIdentity,
} from "@sidecar/session";
import { TRANSCRIPT_KIND, type TranscriptKind } from "@sidecar/wire";
import type { AgentsSnapshot, ChildrenSnapshot } from "#shared/messages/children";
import { ConversationUnreadableNotice } from "./conversation-panel";
import { ConversationTurns } from "./conversation-turns";
import { PANEL_TAB, panelPanelId, panelTabId } from "./panel-tabs";
import type { SessionView } from "./session-model";
import { agentSession, agentTitle, subagentTitle } from "./subagent-title";

/**
 * The three pages the Conversation tab draws: the thread itself, the list of
 * the agents Luke follows and the sub-agents the brain delegated to, and one
 * of their transcripts. Held by the app rather than here, the way the settings
 * page is, because arriving at the tab is arriving at its front page and
 * Escape unwinds the pages one at a time before it leaves the tab.
 */
export const CONVERSATION_PAGE = {
  THREAD: "thread",
  SUBAGENTS: "subagents",
  TRANSCRIPT: "transcript",
} as const;

export type ConversationPage = (typeof CONVERSATION_PAGE)[keyof typeof CONVERSATION_PAGE];

/**
 * The row a transcript page is opened from: which conversation, of which
 * kind, and the words the page's header wears for it, taken from the row as
 * it stood when pressed rather than looked up again, so the header reads the
 * same whether the list still names the conversation or not.
 */
export interface TranscriptRow {
  readonly conversationId: string;
  readonly kind: TranscriptKind;
  readonly title: string;
  readonly status: ChildStatus;
}

/** Where a child or an agent stands, in the one word its row wears for it. */
const SUBAGENT_STATUS_WORD = {
  [CHILD_STATUS.ACCEPTED]: "Waiting",
  [CHILD_STATUS.RUNNING]: "Running",
  [CHILD_STATUS.SETTLED]: "Done",
  [CHILD_STATUS.FAILED]: "Failed",
  [CHILD_STATUS.CANCELLED]: "Cancelled",
} as const satisfies Record<ChildStatus, string>;

/** A row's latest instant: its turn's settle, else its start, else its own opening. */
function activityAt(row: ChildRead | AgentRead): number {
  return row.settledAt ?? row.startedAt ?? row.acceptedAt;
}

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

/** The row an agent's transcript is opened from, named from the roster by session identity. */
function agentTranscriptRow(agent: AgentRead, roster: readonly SessionView[]): TranscriptRow {
  return {
    conversationId: agent.id,
    kind: TRANSCRIPT_KIND.OBSERVED,
    title: agentTitle(agent, roster),
    status: agent.status,
  };
}

/**
 * The control that turns the Conversation tab to its sub-agents and back,
 * seated beside the tab bar the way Clear is. Lit while the list is showing,
 * on the search button's own terms, so the control and its effect cannot be
 * read apart.
 */
export function SubagentsButton({
  open,
  onToggle,
}: {
  open: boolean;
  onToggle: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className="conversation-subagents"
      data-active={String(open)}
      aria-expanded={open}
      onClick={onToggle}
    >
      Sub-agents
    </button>
  );
}

/** One section of the list: its heading, its rows, and what it says when a read list holds none. */
function SubagentsSection({
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
    <section className="subagents-section">
      <h3 className="subagents-section-title">{heading}</h3>
      {children.length > 0 ? (
        <ol className="subagents-list">{children}</ol>
      ) : settled ? (
        // Only a list actually read may say it is empty; before that the
        // room stands empty, as the thread's does before its first read.
        <p className="subagents-section-empty">{empty}</p>
      ) : null}
    </section>
  );
}

/**
 * The Conversation tab's second page, in two sections: the per-workspace
 * agents first, the coding-agent sessions Luke follows, each named from the
 * roster by session identity with its provider's mark, then the sub-agents
 * the brain delegated to, newest first, each named by its label or task.
 * Every row wears where it stands and how long ago it last moved, and a
 * row's press opens its transcript on the host and turns the tab to the
 * transcript page that draws it. Mounted under the thread's own root, ids and
 * blocked class alike, because a task's words are the developer's and belong
 * in no optional recording.
 */
export function SubagentsPanel({
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
  const children = [...subagents.children].sort((a, b) => b.acceptedAt - a.acceptedAt);
  const meta = (row: ChildRead | AgentRead) => (
    <>
      <span className="subagent-status" data-status={row.status}>
        {SUBAGENT_STATUS_WORD[row.status]}
      </span>
      <span className="subagent-age">{lastActivityLabel(activityAt(row), now)}</span>
    </>
  );
  return (
    <section
      className="conversation-view ph-no-capture"
      role="tabpanel"
      id={panelPanelId(PANEL_TAB.CONVERSATION)}
      aria-labelledby={panelTabId(PANEL_TAB.CONVERSATION)}
    >
      <header className="subagents-header">
        <button type="button" className="subagents-back" onClick={onBack}>
          ‹ Conversation
        </button>
        <h2 className="subagents-title">Sub-agents</h2>
      </header>
      <div className="subagents-sections">
        <SubagentsSection
          heading="Per-workspace agents"
          settled={agents.settled}
          empty="No per-workspace agents yet"
        >
          {agents.agents.map((agent) => {
            const session = agentSession(agent, roster);
            return (
              <li key={agent.id}>
                <button
                  type="button"
                  className="subagent-row"
                  onClick={() => onOpenTranscript(agentTranscriptRow(agent, roster))}
                >
                  <span className="subagent-title">
                    <ProviderMark
                      providerId={session?.agentId ?? agent.providerId}
                      className="subagent-mark"
                    />
                    <span className="subagent-name">{agentTitle(agent, roster)}</span>
                  </span>
                  <span className="subagent-meta">{meta(agent)}</span>
                </button>
              </li>
            );
          })}
        </SubagentsSection>
        <SubagentsSection
          heading="Sub-agents"
          settled={subagents.settled}
          empty="No sub-agents yet"
        >
          {children.map((child) => (
            <li key={child.id}>
              <button
                type="button"
                className="subagent-row"
                onClick={() => onOpenTranscript(childTranscriptRow(child))}
              >
                <span className="subagent-title">
                  <span className="subagent-name">{subagentTitle(child)}</span>
                </span>
                <span className="subagent-meta">
                  {meta(child)}
                  {child.parentKind === CONVERSATION_VIEW_SOURCE.OBSERVED ? (
                    <span className="subagent-origin">from an observed session</span>
                  ) : null}
                </span>
              </button>
            </li>
          ))}
        </SubagentsSection>
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
 * again. Nothing here is live: the words arrive settled, as stored turns, so
 * there is no streaming row, no listening row, and no Stop. Mounted under the
 * thread's own root, ids and blocked class alike, because the words are the
 * developer's and belong in no optional recording.
 */
export function SubagentTranscriptPanel({
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
  transcript: ChildTranscriptSnapshot | undefined;
  /** The sessions as the roster holds them now, so an action's chip names a session by its current title. */
  roster: readonly SessionView[];
  /** The instant a running turn's wait is read against, on the thread's own terms. */
  now: number;
  /** A session row's own press by identity, for the chip naming the session an action reached. */
  onOpenChat: (identity: SessionIdentity) => void;
  /** Returns the tab to the sub-agents list. */
  onBack: () => void;
}): React.JSX.Element {
  // A transcript still standing for another conversation, or for this one
  // under another kind, is the one this open replaced; it is not this page's.
  const own =
    transcript?.conversationId === open.conversationId && transcript.kind === open.kind
      ? transcript
      : undefined;
  const groups = own?.groups ?? [];
  return (
    <section
      className="conversation-view ph-no-capture"
      role="tabpanel"
      id={panelPanelId(PANEL_TAB.CONVERSATION)}
      aria-labelledby={panelTabId(PANEL_TAB.CONVERSATION)}
    >
      <header className="subagents-header">
        <button type="button" className="subagents-back" onClick={onBack}>
          ‹ Sub-agents
        </button>
        <h2 className="subagents-title subagent-transcript-title">{open.title}</h2>
        <span className="subagent-status" data-status={open.status}>
          {SUBAGENT_STATUS_WORD[open.status]}
        </span>
      </header>
      {groups.length > 0 ? (
        <div className="conversation-thread">
          <div className="conversation-scroll">
            <div className="conversation-pull">
              <ConversationTurns
                groups={groups}
                roster={roster}
                now={now}
                onOpenChat={onOpenChat}
              />
            </div>
          </div>
        </div>
      ) : own?.settled ? (
        <div className="conversation-empty">
          <strong>Nothing said yet</strong>
        </div>
      ) : (
        // Nothing read yet says neither "nothing said" nor a thread: the room
        // stands empty until the first read lands, as the thread's does.
        <div className="conversation-thread">
          <div className="conversation-scroll" />
        </div>
      )}
      {own?.unreadable ? <ConversationUnreadableNotice /> : null}
    </section>
  );
}
