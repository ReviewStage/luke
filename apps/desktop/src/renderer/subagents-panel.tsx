import { BRAIN_INPUT_MARKER } from "@sidecar/brain/input-items";
import { CHILD_STATUS, type ChildRead, type ChildStatus } from "@sidecar/hosted/reads-wire";
import { lastActivityLabel } from "@sidecar/panel";
import { CONVERSATION_VIEW_SOURCE } from "@sidecar/session";
import { useState } from "react";
import type { ChildrenSnapshot } from "#shared/messages/children";
import { PANEL_TAB, panelPanelId, panelTabId } from "./panel-tabs";

/**
 * The two pages the Conversation tab draws: the thread itself, or the list of
 * the sub-agents the brain delegated to. Held by the app rather than here,
 * the way the settings page is, because arriving at the tab is arriving at
 * its front page and Escape unwinds the list before it leaves the tab.
 */
export const CONVERSATION_PAGE = {
  THREAD: "thread",
  SUBAGENTS: "subagents",
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

/** What a row calls the child: its label, else its task without the marker, else a slice of its id. */
function subagentTitle(child: ChildRead): string {
  if (child.label) return child.label;
  // The brain leads a delegated task with its own marker; the row names the task, never the framing.
  const task = child.task?.startsWith(BRAIN_INPUT_MARKER.SUBAGENT_TASK)
    ? child.task.slice(BRAIN_INPUT_MARKER.SUBAGENT_TASK.length).trim()
    : child.task;
  if (task) return task;
  return `Child ${child.id.slice(0, CHILD_ID_EXCERPT_CHARS)}`;
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
 * A row's press opens the child's transcript on the host; the page that
 * draws it is not here yet, so for now the press only marks the row. Mounted
 * under the thread's own root, ids and blocked class alike, because a task's
 * words are the developer's and belong in no optional recording.
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
  /** Opens the pressed child's transcript on the host. */
  onOpenChild: (childId: string) => void;
  /** Returns the tab to the thread. */
  onBack: () => void;
}): React.JSX.Element {
  const [selectedChildId, setSelectedChildId] = useState<string | undefined>(undefined);
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
              <button
                type="button"
                className="subagent-row"
                aria-pressed={selectedChildId === child.id}
                onClick={() => {
                  setSelectedChildId(child.id);
                  onOpenChild(child.id);
                }}
              >
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
