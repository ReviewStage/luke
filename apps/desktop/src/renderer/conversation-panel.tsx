import { type BrainRequestSnapshot, brainRequestPending } from "@sidecar/brain/requests-wire";
import { CheckIcon, CopyIcon, WingFace } from "@sidecar/panel";
import {
  CONVERSATION_ENTRY_KIND,
  type ConversationEntry,
  type ConversationEntryKind,
  conversationEntryKey,
} from "@sidecar/session";
import { FACE_MOTION } from "@sidecar/surface";
import { useEffect, useRef, useState } from "react";
import { ACT_KIND } from "#shared/messages/acts";
import { tell } from "./act";
import { type AskHandler, AskLuke } from "./ask-luke";
import {
  createConversationTimeBreakFormatter,
  opensConversationTimeBreak,
} from "./conversation-time-break";
import { MarkdownMessage } from "./markdown-message";
import { PANEL_TAB, panelPanelId, panelTabId } from "./panel-tabs";
import { ThinkingDots } from "./thinking-dots";

export const CONVERSATION_ENTRY_SPEAKER = {
  YOU: "you",
  LUKE: "luke",
  EVENT: "event",
} as const;

type ConversationEntrySpeaker =
  (typeof CONVERSATION_ENTRY_SPEAKER)[keyof typeof CONVERSATION_ENTRY_SPEAKER];

export interface ConversationEntryPresentation {
  speaker: ConversationEntrySpeaker;
  label: string;
}

/** The user-facing voice for each kind of line in Luke's current-launch thread. */
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

const COPY_CONFIRMATION_MS = 1500;

const ENTRY_TIME = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

const timeBreakLabel = createConversationTimeBreakFormatter();

/** What a reader is told of a run still going; the sighted read the face and the dots. */
export const CONVERSATION_THINKING_LABEL = "Luke is thinking";

/** What a reader is told while a spoken turn is still owed its first words. */
export const CONVERSATION_LISTENING_LABEL = "Luke is listening";

/** How long a run goes before the wait says how long it has been. */
const THINKING_ELAPSED_AFTER_MS = 10_000;

/** How often the wait's own clock moves once it is saying its age. */
const THINKING_CLOCK_MS = 1_000;

/**
 * What the wait says once a run has gone on long enough to be worth a word,
 * and nothing before that: a quick reply earns no sentence, and a run that has
 * stood for minutes must not read like one that started a second ago.
 */
export function thinkingElapsedLabel(since: number, now: number): string | undefined {
  const elapsed = now - since;
  if (elapsed < THINKING_ELAPSED_AFTER_MS) return undefined;
  const seconds = Math.floor(elapsed / 1000);
  return `Still thinking · ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * Luke's turn, drawn on his side of the thread in the bubble his reply will
 * fill, so the thread holds one object per turn and the reply replaces the wait
 * in place. His face plays the success hop on repeat — a run still going is
 * continuously true, which is what a repeating motion is for — and three dots
 * rise in its wake. Nothing here is a control: the stop is the composer's disc,
 * which both tabs share. The reader's line is the live region, and the age
 * beside it is not, so a ticking count is never read out second by second.
 */
function ConversationThinkingRow({
  since,
  now,
}: {
  since: number;
  now: number;
}): React.JSX.Element {
  // The wait keeps a clock of its own past the app's, which moves only when
  // the app renders: a count of how long a run has been going has to move on
  // its own. Never behind the app's clock, so a fixed clock is never
  // contradicted by this one.
  const [clock, setClock] = useState(now);
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), THINKING_CLOCK_MS);
    return () => window.clearInterval(timer);
  }, []);
  const elapsed = thinkingElapsedLabel(since, Math.max(clock, now));
  return (
    <li
      className="conversation-entry"
      data-speaker={CONVERSATION_ENTRY_SPEAKER.LUKE}
      data-thinking="true"
    >
      <small className="visually-hidden">Luke</small>
      <div className="conversation-message">
        <span className="conversation-bubble">
          <span className="conversation-thinking">
            <WingFace motion={FACE_MOTION.SUCCESS} repeat />
            <ThinkingDots />
            {elapsed ? <span className="conversation-thinking-elapsed">{elapsed}</span> : null}
            <span className="visually-hidden" role="status">
              {CONVERSATION_THINKING_LABEL}
            </span>
          </span>
        </span>
      </div>
    </li>
  );
}

/**
 * The developer's turn before its words arrive, in the sent bubble the
 * transcript will fill: the press is heard the moment it lands, not seconds
 * later when the transcription's first words come back. Three dots and no
 * face — the face is Luke's own mark, and this turn is the developer's. It is
 * presentation alone, drawn from the reported voice view and never entering
 * the thread; the words that settle it arrive as a live line and then a
 * recorded one, exactly as they always did.
 */
function ConversationListeningRow(): React.JSX.Element {
  return (
    <li
      className="conversation-entry"
      data-speaker={CONVERSATION_ENTRY_SPEAKER.YOU}
      data-thinking="true"
    >
      <small className="visually-hidden">You</small>
      <div className="conversation-message">
        <span className="conversation-bubble">
          <span className="conversation-listening">
            <ThinkingDots />
            <span className="visually-hidden" role="status">
              {CONVERSATION_LISTENING_LABEL}
            </span>
          </span>
        </span>
      </div>
    </li>
  );
}

function ConversationEntryRow({
  entry,
  streaming,
}: {
  entry: ConversationEntry;
  streaming?: boolean;
}): React.JSX.Element {
  const presentation = conversationEntryPresentation(entry.kind);
  const words = entry.words;
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPY_CONFIRMATION_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  const recordedAt = entry.recordedAt === undefined ? undefined : new Date(entry.recordedAt);

  return (
    <li
      className="conversation-entry"
      data-speaker={presentation.speaker}
      data-streaming={streaming ? "true" : undefined}
    >
      <small className="visually-hidden">{presentation.label}</small>
      <div className="conversation-message">
        <span className="conversation-bubble">
          <MarkdownMessage words={words} className="conversation-words" />
          {/* Copying words still arriving would copy half a sentence; the control
            appears with the settled line the same words become. */}
          {presentation.speaker === CONVERSATION_ENTRY_SPEAKER.EVENT || streaming ? null : (
            <button
              type="button"
              className="conversation-copy"
              data-copied={copied ? "true" : undefined}
              aria-label={copied ? "Copied" : "Copy message"}
              onClick={() => {
                // The line's own words as written, Markdown marks included, so
                // a paste carries the structure the bubble drew — and never the
                // structured model context behind an announcement.
                tell(ACT_KIND.WINDOW_COPY_TEXT, { words });
                setCopied(true);
              }}
            >
              {copied ? <CheckIcon /> : <CopyIcon />}
            </button>
          )}
        </span>
      </div>
      {/* The stamp is the row's, not the bubble's: it stands in one column
          past the thread's visible edge, sent and received alike, which the
          thread's own sideways scroll brings into view. */}
      {recordedAt ? (
        <time className="conversation-time" dateTime={recordedAt.toISOString()}>
          {ENTRY_TIME.format(recordedAt)}
        </time>
      ) : null}
    </li>
  );
}

/**
 * The moment a line was said, set over it the way iMessage dates a message
 * that followed a long silence. It is the thread's line, not a message: it
 * reads in the quiet voice the requested actions use, and it stands still under
 * the pull like Luke's rows do, so uncovering the stamp column never pushes
 * a date off the screen.
 */
function ConversationTimeBreak({ recordedAt, now }: { recordedAt: number; now: number }) {
  const at = new Date(recordedAt);
  const label = timeBreakLabel(recordedAt, now);
  return (
    <li className="conversation-break">
      <time className="conversation-break-time" dateTime={at.toISOString()}>
        <strong>{label.day}</strong> {label.time}
      </time>
    </li>
  );
}

/** Stable enough for repeated identical lines without pretending the record has durable ids. */
function keyedConversationEntries(entries: readonly ConversationEntry[]) {
  const occurrences = new Map<string, number>();
  let previousRecordedAt: number | undefined;
  return entries.map((entry) => {
    const base = conversationEntryKey(entry);
    const occurrence = (occurrences.get(base) ?? 0) + 1;
    occurrences.set(base, occurrence);
    const opensBreak = opensConversationTimeBreak(previousRecordedAt, entry.recordedAt);
    if (entry.recordedAt !== undefined) previousRecordedAt = entry.recordedAt;
    return { entry, key: `${base}:${occurrence}`, opensBreak };
  });
}

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
 * is the recoverable deletion, but it still asks twice: the second press
 * names what the first one meant, with a way to stand down beside it. The
 * confirmation needs no reset of its own — the button is drawn only over a
 * thread with recorded lines, so the clear that empties them unmounts it,
 * exactly as leaving the tab does.
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

export function ConversationPanel({
  entries,
  live = [],
  requests = [],
  spokenAskPending = false,
  now,
  ask,
  onAskEngaged,
  askShortcut,
  onStop,
}: {
  entries: readonly ConversationEntry[];
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
  const entryCount = entries.length;
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
    entries.length > 0 || live.length > 0 || thinkingSince !== undefined || spokenAskPending;

  return (
    <section
      // PostHog blocks this fixed class and its whole subtree. Conversation
      // conversation belongs on this screen, but never in an optional recording.
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
            <ol className="conversation-list">
              {keyedConversationEntries(entries).flatMap(({ entry, key, opensBreak }) => {
                const row = <ConversationEntryRow key={key} entry={entry} />;
                return opensBreak && entry.recordedAt !== undefined
                  ? [
                      <ConversationTimeBreak
                        key={`${key}:break`}
                        recordedAt={entry.recordedAt}
                        now={now}
                      />,
                      row,
                    ]
                  : [row];
              })}
              {live.map((entry, index) => (
                <ConversationEntryRow
                  // biome-ignore lint/suspicious/noArrayIndexKey: A line still being said has no durable id, and its words change on every delta — a key made of either would remount the bubble mid-sentence, while its position holds still for exactly as long as the line does.
                  key={`live:${entry.kind}:${index}`}
                  entry={entry}
                  streaming
                />
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
            </ol>
          </div>
        </div>
      ) : (
        <div className="conversation-empty">
          <strong>No messages yet</strong>
        </div>
      )}
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
