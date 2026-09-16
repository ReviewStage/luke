import { BRAIN_INPUT_MARKER } from "@sidecar/brain/input-items";
import { CHILD_STATUS, type ChildRead, type ChildStatus } from "@sidecar/hosted/reads-wire";
import { lastActivityLabel } from "@sidecar/panel";
import {
  type ChildTranscriptSnapshot,
  CONVERSATION_VIEW_SOURCE,
  type SessionIdentity,
} from "@sidecar/session";
import type { ChildrenSnapshot } from "#shared/messages/children";
import { ConversationUnreadableNotice } from "./conversation-panel";
import { ConversationTurns } from "./conversation-turns";
import { PANEL_TAB, panelPanelId, panelTabId } from "./panel-tabs";
import type { SessionView } from "./session-model";

/**
 * The three pages the Conversation tab draws: the thread itself, the list of
 * the sub-agents the brain delegated to, and one sub-agent's transcript. Held
 * by the app rather than here, the way the settings page is, because arriving
 * at the tab is arriving at its front page and Escape unwinds the pages one at
 * a time before it leaves the tab.
 */
export const CONVERSATION_PAGE = {
  THREAD: "thread",
  SUBAGENTS: "subagents",
  TRANSCRIPT: "transcript",
} as const;

export type ConversationPage = (typeof CONVERSATION_PAGE)[keyof typeof CONVERSATION_PAGE];

/** Where a child stands, in the one word its row wears for it. */
const SUBAGENT_STATUS_WORD = {
  [CHILD_STATUS.ACCEPTED]: "Waiting",
  [CHILD_STATUS.RUNNING]: "Running",
  [CHILD_STATUS.SETTLED]: "Done",
  [CHILD_STATUS.FAILED]: "Failed",
  [CHILD_STATUS.CANCELLED]: "Cancelled",
} as const satisfies Record<ChildStatus, string>;

/** How much of a child's id stands in for a name when it was handed neither a label nor a task. */
const CHILD_ID_EXCERPT_CHARS = 8;

/** The name a child falls back to: a slice of its id. */
function childIdTitle(childId: string): string {
  return `Child ${childId.slice(0, CHILD_ID_EXCERPT_CHARS)}`;
}

/** What a row calls the child: its label, else its task without the marker, else a slice of its id. */
function subagentTitle(child: ChildRead): string {
  if (child.label) return child.label;
  // The brain leads a delegated task with its own marker; the row names the task, never the framing.
  const task = child.task?.startsWith(BRAIN_INPUT_MARKER.SUBAGENT_TASK)
    ? child.task.slice(BRAIN_INPUT_MARKER.SUBAGENT_TASK.length).trim()
    : child.task;
  return task || childIdTitle(child.id);
}

/** The child's latest instant: its turn's settle, else its start, else the child's own opening. */
function subagentActivityAt(child: ChildRead): number {
  return child.settledAt ?? child.startedAt ?? child.acceptedAt;
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

/**
 * The Conversation tab's second page: the account's sub-agents, newest first,
 * each row naming the child, where it stands, and how long ago it last moved.
 * A row's press opens the child's transcript on the host and turns the tab to
 * the transcript page that draws it. Mounted under the thread's own root, ids
 * and blocked class alike, because a task's words are the developer's and
 * belong in no optional recording.
 */
export function SubagentsPanel({
  subagents,
  now,
  onOpenChild,
  onBack,
}: {
  /** The account's children as the document holds them, and whether a read has landed. */
  subagents: ChildrenSnapshot;
  /** The instant the rows' ages are read against, on the roster's own terms. */
  now: number;
  /** Opens the pressed child's transcript on the host and turns to its page. */
  onOpenChild: (childId: string) => void;
  /** Returns the tab to the thread. */
  onBack: () => void;
}): React.JSX.Element {
  const rows = [...subagents.children].sort((a, b) => b.acceptedAt - a.acceptedAt);
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
      {rows.length === 0 ? (
        // Only a list actually read may say it is empty; before that the
        // room stands empty, as the thread's does before its first read.
        subagents.settled ? (
          <div className="conversation-empty">
            <strong>No sub-agents yet</strong>
          </div>
        ) : null
      ) : (
        <ol className="subagents-list">
          {rows.map((child) => (
            <li key={child.id}>
              <button type="button" className="subagent-row" onClick={() => onOpenChild(child.id)}>
                <span className="subagent-title">{subagentTitle(child)}</span>
                <span className="subagent-meta">
                  <span className="subagent-status" data-status={child.status}>
                    {SUBAGENT_STATUS_WORD[child.status]}
                  </span>
                  <span className="subagent-age">
                    {lastActivityLabel(subagentActivityAt(child), now)}
                  </span>
                  {child.parentKind === CONVERSATION_VIEW_SOURCE.OBSERVED ? (
                    <span className="subagent-origin">from an observed session</span>
                  ) : null}
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/**
 * The Conversation tab's third page: one sub-agent's transcript, drawn as the
 * thread draws its own turns, under the same scroll scaffolding so the
 * sideways pull and the scrollbars behave the same. The header names the way
 * back to the list, the child by the list's own title for it, and where it
 * stands. Nothing here is live: a child's words arrive settled, as stored
 * turns, so there is no streaming row, no listening row, and no Stop. Mounted
 * under the thread's own root, ids and blocked class alike, because a child's
 * words are the developer's and belong in no optional recording.
 */
export function SubagentTranscriptPanel({
  childId,
  subagents,
  transcript,
  roster,
  now,
  onOpenChat,
  onBack,
}: {
  /** The child whose transcript the page is of, as the row press named it. */
  childId: string;
  /** The account's children as the document holds them, for the header's title and status. */
  subagents: ChildrenSnapshot;
  /** The transcript the host holds open, if any; drawn only while it is this child's. */
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
  const child = subagents.children.find((row) => row.id === childId);
  // A transcript still standing for another child is the one this open replaced; it is not this page's.
  const own = transcript?.childId === childId ? transcript : undefined;
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
        <h2 className="subagents-title subagent-transcript-title">
          {child ? subagentTitle(child) : childIdTitle(childId)}
        </h2>
        {child ? (
          <span className="subagent-status" data-status={child.status}>
            {SUBAGENT_STATUS_WORD[child.status]}
          </span>
        ) : null}
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
