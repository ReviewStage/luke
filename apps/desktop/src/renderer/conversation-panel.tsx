import type { AgentRead, ChildRead } from "@sidecar/hosted/reads-wire";
import { ChevronIcon } from "@sidecar/panel";
import type { ConversationViewSnapshot, SessionIdentity } from "@sidecar/session";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PlacedLiveEntry } from "./conversation-live-lines";
import { ConversationListeningRow } from "./conversation-rows";
import { ConversationTurns } from "./conversation-turns";
import { PANEL_TAB, panelPanelId, panelTabId } from "./panel-tabs";
import type { SessionView } from "./session-model";

/** What a reader is told when the service named a row this build could not read back; the thread stands as last read. */
const UNREADABLE_NOTICE = "Part of the conversation could not be read.";

/** The one thing said about a read the service refused, under the thread and under an open transcript alike. */
export function ConversationUnreadableNotice(): React.JSX.Element {
  return (
    <p className="conversation-notice" role="status">
      {UNREADABLE_NOTICE}
    </p>
  );
}

/**
 * How close to the tail a reader still counts as following it. Words arriving
 * grow the list under the reader a little at a time, so the tail they were
 * pinned to is at most a delta away; a reader who scrolled up to reread is
 * further than that, and the stream must not drag them back down.
 */
const STREAM_FOLLOW_SLACK_PX = 48;

/**
 * How close to the top a reader has to be for the thread to ask for older
 * turns: near enough that they meant to reach it, so a reread of the last few
 * turns fetches nothing, and far enough that the page is on its way before
 * the scroll stops dead against the edge.
 */
const HISTORY_REACH_SLACK_PX = 48;

/** What a reader is told while the page of older turns they reached for is on its way. */
const LOADING_OLDER_NOTICE = "Loading earlier messages…";

/** The first row of the thread's own: a message's, never a date break, which comes and goes with the group above it. */
const ANCHOR_ROW_SELECTOR = ".conversation-list > li:not(.conversation-break)";

/**
 * The thread's one control, seated beside the tab bar the way each tab's
 * search is, so every tab's control is opened from the same place. Clearing
 * is the service's soft delete of the account's conversation, kept thirty
 * days and reachable on every Mac signed in to it, but it still asks twice:
 * the second press names what the first one meant, with a way to stand down
 * beside it. The confirmation needs no reset of its own — the button is
 * drawn only over a thread with turns, so the clear that empties them
 * unmounts it, exactly as leaving the tab does.
 */
export function ConversationClearButton({ onClear }: { onClear: () => void }): React.JSX.Element {
  const [confirming, setConfirming] = useState(false);
  return (
    <span className="conversation-clear-controls">
      {confirming ? (
        <button
          type="button"
          className="conversation-clear-cancel"
          onClick={() => setConfirming(false)}
        >
          Cancel
        </button>
      ) : null}
      <button
        type="button"
        className="conversation-clear"
        onClick={() => {
          if (!confirming) {
            setConfirming(true);
            return;
          }
          onClear();
        }}
      >
        {confirming ? "Clear conversation" : "Clear"}
      </button>
    </span>
  );
}

export interface ConversationScrollMetrics {
  readonly scrollTop: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
}

/** How far a reader stands from the thread's tail: zero when they are on it or the thread fits whole. */
export function conversationDistanceFromTail({
  scrollTop,
  scrollHeight,
  clientHeight,
}: ConversationScrollMetrics): number {
  return Math.max(scrollHeight - scrollTop - clientHeight, 0);
}

/** Whether the thread still counts as being followed, with a little room for a small drift above the tail. */
export function followsConversationTail(metrics: ConversationScrollMetrics): boolean {
  return conversationDistanceFromTail(metrics) <= STREAM_FOLLOW_SLACK_PX;
}

/** Whether a reader has reached the top of what the thread holds, or the thread fits whole and there is no top to reach. */
function reachesConversationHead({ scrollTop }: ConversationScrollMetrics): boolean {
  return scrollTop <= HISTORY_REACH_SLACK_PX;
}

function scrollMetrics(element: HTMLDivElement): ConversationScrollMetrics {
  return {
    scrollTop: element.scrollTop,
    scrollHeight: element.scrollHeight,
    clientHeight: element.clientHeight,
  };
}

function scrollToConversationTail(element: HTMLDivElement): void {
  element.scrollTop = element.scrollHeight;
}

/** Where a row stands in the scrolled content, whatever the offset is: the one number a prepend moves. */
function rowTop(container: HTMLDivElement, row: Element): number {
  return (
    row.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop
  );
}

/**
 * Where the thread stood at its last paint: its first row and where that row
 * stood, and the thread's whole height for when the row itself is gone.
 * Older turns landing above the reader move the first row down by exactly
 * their height, whatever grew at the tail in the same paint.
 */
interface ThreadAnchor {
  readonly row: Element;
  readonly top: number;
  readonly height: number;
}

function threadAnchor(container: HTMLDivElement): ThreadAnchor | undefined {
  const row = container.querySelector(ANCHOR_ROW_SELECTOR);
  if (row === null) return undefined;
  return { row, top: rowTop(container, row), height: container.scrollHeight };
}

/**
 * How far the content above the reader moved since the anchor was taken:
 * nothing while the same row still leads, since rows only ever land above
 * the first one by changing which row is first; the row's own move where it
 * still stands; and the thread's change of height where it was let go of,
 * the one case a row cannot measure.
 */
function movedAbove(container: HTMLDivElement, anchor: ThreadAnchor): number {
  if (container.querySelector(ANCHOR_ROW_SELECTOR) === anchor.row) return 0;
  if (anchor.row.isConnected) return rowTop(container, anchor.row) - anchor.top;
  return container.scrollHeight - anchor.height;
}

/** What of a view an ask was made over: enough to tell that a page has landed since, whichever object carries the view now. */
interface ViewMark {
  readonly groups: number;
  readonly first: string | undefined;
  readonly hasOlder: boolean;
}

function viewMark(view: ConversationViewSnapshot): ViewMark {
  return {
    groups: view.groups.length,
    first: view.groups[0]?.turnId,
    hasOlder: view.hasOlder === true,
  };
}

function sameViewMark(a: ViewMark | undefined, b: ViewMark): boolean {
  return (
    a !== undefined && a.groups === b.groups && a.first === b.first && a.hasOlder === b.hasOlder
  );
}

function ConversationJumpToBottomButton({ onClick }: { onClick: () => void }): React.JSX.Element {
  return (
    <button
      type="button"
      className="conversation-jump-to-bottom"
      aria-label="Scroll to the latest message"
      title="Scroll to the latest message"
      onClick={onClick}
    >
      <ChevronIcon />
    </button>
  );
}

export function ConversationPanel({
  view,
  roster = [],
  subagents = [],
  agents = [],
  onOpenChat,
  onOpenChild,
  onOpenAgent,
  onOfferRatingFeedback,
  onLoadOlder,
  live = [],
  spokenAskPending = false,
  now,
}: {
  /** The Conversation as the host's reads of the service compose it: the turn groups, and whether a read has landed. */
  view: ConversationViewSnapshot;
  /** The sessions as the roster holds them now, so an action's chip names a session by its current title. */
  roster?: readonly SessionView[];
  /** The account's children as the document holds them, so a completion's chip names the child by the list's own title. */
  subagents?: readonly ChildRead[];
  /** A session row's own press by identity, for the chip naming the session an action reached. */
  onOpenChat?: (identity: SessionIdentity) => void;
  /** The list row's own press by child id, for the chip on a completion; absent where the thread opens no transcript. */
  onOpenChild?: (childId: string) => void;
  /** The account's per-workspace agents as the document holds them, so an observed group's source chip leads to the agent the list names. */
  agents?: readonly AgentRead[];
  /** The list row's own press for an agent, for the chip heading an observed group; absent where the thread opens no transcript. */
  onOpenAgent?: (agent: AgentRead) => void;
  /** Opens the feedback composer on the draft a thumbs down offers; absent where no composer can be offered. */
  onOfferRatingFeedback?: (draft: string) => void;
  /**
   * Asks the host for one page of older turns, which lands on the view rather
   * than as the answer; the answer says whether one landed. Asked once per
   * reach for the top while the view says older turns stand, and never while
   * an ask is out. Absent where the thread pages nothing back.
   */
  onLoadOlder?: () => Promise<boolean>;
  /**
   * The instant the thread's dates are read against, so a line from earlier
   * today says Today and one from last week says which day. Passed down like
   * the rows' ages are, because only the app knows which clock is honest.
   */
  now: number;
  /**
   * The lines still being said, drawn among the settled thread as the same
   * bubbles they will settle into — words growing, no timestamp, no copy —
   * each where its row will land once the record has told where that is.
   */
  live?: readonly PlacedLiveEntry[];
  /**
   * Whether a spoken turn is still owed its first words — being listened to,
   * or committed with its transcription not yet streaming — so the thread
   * holds the developer's place before anything is written.
   */
  spokenAskPending?: boolean;
}): React.JSX.Element {
  const list = useRef<HTMLDivElement | null>(null);
  const [following, setFollowing] = useState(true);
  const followingRef = useRef(following);
  followingRef.current = following;
  const [loadingOlder, setLoadingOlder] = useState(false);
  const loadingOlderRef = useRef(loadingOlder);
  loadingOlderRef.current = loadingOlder;
  /** The view the last ask was made over, so a page landing since is told from the same view carried again. */
  const askedOver = useRef<ViewMark | undefined>(undefined);
  // The browser keeps the offset rather than the content, so when rows land
  // above a reader who is not following the tail, the offset is moved by
  // exactly what landed above them.
  const anchor = useRef<ThreadAnchor | undefined>(undefined);
  const thread = view.groups.length > 0 || live.length > 0 || spokenAskPending;
  const olderStands = view.hasOlder === true && onLoadOlder !== undefined;

  useEffect(() => {
    if (thread) return;
    setFollowing(true);
  }, [thread]);

  useLayoutEffect(() => {
    if (!thread || !followingRef.current) return;
    const element = list.current;
    if (element) scrollToConversationTail(element);
  }, [thread, view, live, spokenAskPending]);

  // After the tail is pinned, so a following reader is never moved twice.
  useLayoutEffect(() => {
    const element = list.current;
    if (!element) return;
    const previous = anchor.current;
    if (previous !== undefined && !followingRef.current) {
      const moved = movedAbove(element, previous);
      if (moved !== 0) element.scrollTop += moved;
    }
    anchor.current = threadAnchor(element);
  }, [thread, view, live, spokenAskPending]);

  /** One ask at a time, and only while the view says there is something to ask for. */
  const askForOlder = () => {
    if (!olderStands || loadingOlderRef.current || onLoadOlder === undefined) return;
    askedOver.current = viewMark(view);
    setLoadingOlder(true);
    loadingOlderRef.current = true;
    // However the ask ends, the next reach may ask again; what landed is on the view.
    const settled = () => setLoadingOlder(false);
    void onLoadOlder().then(settled, settled);
  };

  // A page that landed short of the reader's window, or a thread that fits it
  // whole, leaves them at the top with no scroll to make: the next page is
  // asked for once the view has moved since the last ask and no ask is out.
  // The page lands on the view before the ask answers, so the look is made
  // again as the ask settles; a view that did not move is not asked over
  // twice, so a page the host would not read does not spin the ask.
  useEffect(() => {
    if (loadingOlder || sameViewMark(askedOver.current, viewMark(view))) return;
    const element = list.current;
    if (!element || !thread || !reachesConversationHead(scrollMetrics(element))) return;
    askForOlder();
  }, [view, loadingOlder]);

  const syncFollowing = () => {
    const element = list.current;
    if (!element) return;
    const metrics = scrollMetrics(element);
    setFollowing((standing) => {
      const next = followsConversationTail(metrics);
      return standing === next ? standing : next;
    });
    if (reachesConversationHead(metrics)) askForOlder();
  };

  return (
    <section
      // PostHog blocks this fixed class and its whole subtree. Everything the
      // thread draws — the stored turns, a session's title on an action's
      // chip, a line still being said — belongs on this screen, but never in
      // an optional recording, so all of it is mounted under this one root.
      className="conversation-view ph-no-capture"
      role="tabpanel"
      id={panelPanelId(PANEL_TAB.CONVERSATION)}
      aria-labelledby={panelTabId(PANEL_TAB.CONVERSATION)}
    >
      {thread ? (
        <div className="conversation-thread">
          <div className="conversation-scroll" ref={list} onScroll={syncFollowing}>
            {/* The pull is the thread's own sideways scroll, on a scroller of its
                own so the vertical one keeps its scrollbar: the list is one
                stamp column wider than the view, and snapping puts it back the
                moment the fingers lift, which only the browser can see. */}
            <div className="conversation-pull">
              <ConversationTurns
                groups={view.groups}
                roster={roster}
                subagents={subagents}
                agents={agents}
                now={now}
                {...(onOpenChat ? { onOpenChat } : undefined)}
                {...(onOpenChild ? { onOpenChild } : undefined)}
                {...(onOpenAgent ? { onOpenAgent } : undefined)}
                {...(onOfferRatingFeedback ? { onOfferRatingFeedback } : undefined)}
                live={live}
              >
                {/* After the lines still being said: the newest spoken turn's
                    place, held while its first words are still on the service's
                    clock. */}
                {spokenAskPending ? <ConversationListeningRow /> : null}
              </ConversationTurns>
            </div>
          </div>
          {loadingOlder ? (
            <p className="conversation-notice conversation-loading-older" role="status">
              {LOADING_OLDER_NOTICE}
            </p>
          ) : null}
          {following ? null : (
            <ConversationJumpToBottomButton
              onClick={() => {
                const element = list.current;
                if (!element) return;
                scrollToConversationTail(element);
                setFollowing(true);
              }}
            />
          )}
        </div>
      ) : view.settled ? (
        <div className="conversation-empty">
          <strong>No messages yet</strong>
        </div>
      ) : (
        // Nothing read yet says neither "nothing said" nor a thread: the room
        // stands empty until the first read lands.
        <div className="conversation-thread">
          <div className="conversation-scroll" ref={list} onScroll={syncFollowing} />
        </div>
      )}
      {view.unreadable ? <ConversationUnreadableNotice /> : null}
    </section>
  );
}
