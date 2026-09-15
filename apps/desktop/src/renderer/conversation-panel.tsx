import { ChevronIcon } from "@sidecar/panel";
import {
  CONVERSATION_ENTRY_KIND,
  type ConversationEntry,
  type ConversationEntryKind,
  type ConversationViewSnapshot,
  type SessionIdentity,
} from "@sidecar/session";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  CONVERSATION_ENTRY_SPEAKER,
  type ConversationEntrySpeaker,
  ConversationListeningRow,
} from "./conversation-rows";
import { ConversationTurns } from "./conversation-turns";
import { MarkdownMessage } from "./markdown-message";
import { PANEL_TAB, panelPanelId, panelTabId } from "./panel-tabs";
import type { SessionView } from "./session-model";

interface ConversationEntryPresentation {
  speaker: ConversationEntrySpeaker;
  label: string;
}

/** The user-facing voice for each kind of line still being said, before the record it settles into arrives. */
function conversationEntryPresentation(kind: ConversationEntryKind): ConversationEntryPresentation {
  switch (kind) {
    case CONVERSATION_ENTRY_KIND.ASK:
      return { speaker: CONVERSATION_ENTRY_SPEAKER.YOU, label: "You" };
    case CONVERSATION_ENTRY_KIND.REPLY:
    case CONVERSATION_ENTRY_KIND.ANNOUNCEMENT:
    // An action Luke took on his own judgment is drawn as his own line, never as
    // the developer's request; the attribution lives in the stored kind.
    case CONVERSATION_ENTRY_KIND.OWN_ACTION:
      return { speaker: CONVERSATION_ENTRY_SPEAKER.LUKE, label: "Luke" };
    case CONVERSATION_ENTRY_KIND.ACTION:
      return { speaker: CONVERSATION_ENTRY_SPEAKER.EVENT, label: "At your request" };
  }
}

/**
 * A line still being said, drawn as the bubble it will settle into: words
 * growing, no timestamp, and no copy, because copying half a sentence would
 * copy half a sentence. The settled line arrives from the service as a
 * stored message and is drawn by the turn renderer above it; this bubble is
 * drawn until then, whatever clock the row settled on
 * (`conversation-live-lines.ts`), so the words never leave the screen between
 * the settle and the read.
 */
function ConversationStreamingRow({ entry }: { entry: ConversationEntry }): React.JSX.Element {
  const presentation = conversationEntryPresentation(entry.kind);
  return (
    <li className="conversation-entry" data-speaker={presentation.speaker} data-streaming="true">
      <small className="visually-hidden">{presentation.label}</small>
      <div className="conversation-message">
        <span className="conversation-bubble">
          <MarkdownMessage words={entry.words} className="conversation-words" />
        </span>
      </div>
    </li>
  );
}

/** What a reader is told when the service named a row this build could not read back; the thread stands as last read. */
const UNREADABLE_NOTICE = "Part of the conversation could not be read.";

/**
 * How close to the tail a reader still counts as following it. Words arriving
 * grow the list under the reader a little at a time, so the tail they were
 * pinned to is at most a delta away; a reader who scrolled up to reread is
 * further than that, and the stream must not drag them back down.
 */
const STREAM_FOLLOW_SLACK_PX = 48;

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
  onOpenChat,
  onOfferRatingFeedback,
  live = [],
  spokenAskPending = false,
  now,
}: {
  /** The Conversation as the host's reads of the service compose it: the turn groups, and whether a read has landed. */
  view: ConversationViewSnapshot;
  /** The sessions as the roster holds them now, so an action's chip names a session by its current title. */
  roster?: readonly SessionView[];
  /** A session row's own press by identity, for the chip naming the session an action reached. */
  onOpenChat?: (identity: SessionIdentity) => void;
  /** Opens the feedback composer on the draft a thumbs down offers; absent where no composer can be offered. */
  onOfferRatingFeedback?: (draft: string) => void;
  /**
   * The instant the thread's dates are read against, so a line from earlier
   * today says Today and one from last week says which day. Passed down like
   * the rows' ages are, because only the app knows which clock is honest.
   */
  now: number;
  /**
   * The lines still being said, drawn under the settled thread as the same
   * bubbles they will settle into — words growing, no timestamp, no copy.
   */
  live?: readonly ConversationEntry[];
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
  const thread = view.groups.length > 0 || live.length > 0 || spokenAskPending;

  useEffect(() => {
    if (thread) return;
    setFollowing(true);
  }, [thread]);

  useLayoutEffect(() => {
    if (!thread || !followingRef.current) return;
    const element = list.current;
    if (element) scrollToConversationTail(element);
  }, [thread, view, live, spokenAskPending]);

  const syncFollowing = () => {
    const element = list.current;
    if (!element) return;
    setFollowing((standing) => {
      const next = followsConversationTail(scrollMetrics(element));
      return standing === next ? standing : next;
    });
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
                now={now}
                {...(onOpenChat ? { onOpenChat } : undefined)}
                {...(onOfferRatingFeedback ? { onOfferRatingFeedback } : undefined)}
              >
                {/* A line still being said has no durable id, and its words change
                    on every delta — a key made of either would remount the bubble
                    mid-sentence, while its position holds still for exactly as
                    long as the line does. */}
                {live.map((entry, index) => (
                  <ConversationStreamingRow key={`live:${entry.kind}:${index}`} entry={entry} />
                ))}
                {/* After the lines still being said: the newest spoken turn's
                    place, held while its first words are still on the service's
                    clock. */}
                {spokenAskPending ? <ConversationListeningRow /> : null}
              </ConversationTurns>
            </div>
          </div>
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
      {view.unreadable ? (
        <p className="conversation-notice" role="status">
          {UNREADABLE_NOTICE}
        </p>
      ) : null}
    </section>
  );
}
