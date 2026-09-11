import { type BrainRequestSnapshot, brainRequestPending } from "@sidecar/brain/requests-wire";
import {
  CONVERSATION_ENTRY_KIND,
  type ConversationEntry,
  type ConversationEntryKind,
  type ConversationViewSnapshot,
  type SessionIdentity,
} from "@sidecar/session";
import { useEffect, useRef, useState } from "react";
import { type AskHandler, AskLuke } from "./ask-luke";
import {
  CONVERSATION_ENTRY_SPEAKER,
  type ConversationEntrySpeaker,
  ConversationListeningRow,
  ConversationThinkingRow,
} from "./conversation-rows";
import { ConversationTurns } from "./conversation-turns";
import { MarkdownMessage } from "./markdown-message";
import { PANEL_TAB, panelPanelId, panelTabId } from "./panel-tabs";
import type { SessionView } from "./session-model";

export interface ConversationEntryPresentation {
  speaker: ConversationEntrySpeaker;
  label: string;
}

/** The user-facing voice for each kind of line still being said, before the record it settles into arrives. */
export function conversationEntryPresentation(
  kind: ConversationEntryKind,
): ConversationEntryPresentation {
  switch (kind) {
    case CONVERSATION_ENTRY_KIND.TYPED_ASK:
    case CONVERSATION_ENTRY_KIND.SPOKEN_ASK:
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
 * stored message and is drawn by the turn renderer above it.
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
 * Where the composer stands in the panel's arrival stack: the tab bar is index
 * 0, and the thread above it is not a member of the stack, so the pill is the
 * first thing to fan in under the bar.
 */
const CONVERSATION_COMPOSER_ROW_INDEX = 1;

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

/** How many rows a stored thread stands as, for the scroll that follows an append. */
function messageCount(view: ConversationViewSnapshot): number {
  return view.groups.reduce((total, group) => total + group.messages.length, 0);
}

export function ConversationPanel({
  view,
  roster = [],
  onOpenChat,
  live = [],
  requests = [],
  spokenAskPending = false,
  now,
  ask,
  onAskEngaged,
  askShortcut,
  onStop,
}: {
  /** The Conversation as the host's reads of the service compose it: the turn groups, and whether a read has landed. */
  view: ConversationViewSnapshot;
  /** The sessions as the roster holds them now, so an action's chip names a session by its current title. */
  roster?: readonly SessionView[];
  /** A session row's own press by identity, for the chip naming the session an action reached. */
  onOpenChat?: (identity: SessionIdentity) => void;
  /**
   * The instant the thread's dates are read against, so a line from earlier
   * today says Today and one from last week says which day. Passed down like
   * the rows' ages are, because only the app knows which clock is honest.
   */
  now: number;
  /**
   * The brain's runs, so a run still going draws Luke's turn at the thread's
   * tail. Read here from the records alone; the reply's own line arrives when
   * the run ends, and the stop is the composer's.
   */
  requests?: readonly BrainRequestSnapshot[];
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
  /** The same ask the sessions tab's composer carries: one conversation, reached from either tab. */
  ask: AskHandler;
  onAskEngaged: (engaged: boolean) => void;
  askShortcut?: string;
  /** Stops every run still going, for the composer's disc while one is. */
  onStop?: () => void;
}): React.JSX.Element {
  const list = useRef<HTMLDivElement | null>(null);
  const entryCount = messageCount(view);
  const liveLength = live.reduce((total, entry) => total + entry.words.length, 0);
  // One wait however many runs are going: a second ask joins the turn under
  // way, and two waits for one turn would say otherwise. Its age is the
  // oldest run's.
  const pending = requests.filter(brainRequestPending);
  const thinkingSince =
    pending.length > 0 ? Math.min(...pending.map((snapshot) => snapshot.acceptedAt)) : undefined;

  useEffect(() => {
    // Reading the count binds the scroll to an append, a clear, or a wait
    // arriving, not to an unrelated render of the same conversation.
    if (entryCount === 0 && thinkingSince === undefined && !spokenAskPending) return;
    const element = list.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [entryCount, thinkingSince, spokenAskPending]);

  useEffect(() => {
    // A streaming line only carries the reader along; unlike an append, it
    // never pulls one back who has scrolled up while Luke talks.
    if (liveLength === 0) return;
    const element = list.current;
    if (!element) return;
    const fromTail = element.scrollHeight - element.scrollTop - element.clientHeight;
    if (fromTail <= STREAM_FOLLOW_SLACK_PX) element.scrollTop = element.scrollHeight;
  }, [liveLength]);

  const thread =
    view.groups.length > 0 || live.length > 0 || thinkingSince !== undefined || spokenAskPending;

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
        <div className="conversation-scroll" ref={list}>
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
              {/* And then the wait for the answer: a spoken ask's own words
                  stream in above it. */}
              {thinkingSince !== undefined ? (
                <ConversationThinkingRow since={thinkingSince} now={now} />
              ) : null}
            </ConversationTurns>
          </div>
        </div>
      ) : view.settled ? (
        <div className="conversation-empty">
          <strong>No messages yet</strong>
        </div>
      ) : (
        // Nothing read yet says neither "nothing said" nor a thread: the room
        // stands empty until the first read lands.
        <div className="conversation-scroll" ref={list} />
      )}
      {view.unreadable ? (
        <p className="conversation-notice" role="status">
          {UNREADABLE_NOTICE}
        </p>
      ) : null}
      {/* The thread is where a typed ask's reply lands as a bubble, so the field
          that asks stands at its foot — the same composer the sessions tab
          holds, addressed to the same conversation. It rides inside the
          blocked subtree: a draft here is worded beside the words it will
          join, and a recording sees neither. */}
      <AskLuke
        ask={ask}
        onEngagedChange={onAskEngaged}
        rowIndex={CONVERSATION_COMPOSER_ROW_INDEX}
        thinking={thinkingSince !== undefined}
        {...(onStop ? { onStop } : undefined)}
        {...(askShortcut ? { shortcut: askShortcut } : undefined)}
      />
    </section>
  );
}
