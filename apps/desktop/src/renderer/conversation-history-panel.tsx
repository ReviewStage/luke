import {
  CONVERSATION_ENTRY_KIND,
  type ConversationEntry,
  type ConversationEntryKind,
  conversationEntryKey,
} from "@sidecar/realtime";
import { useEffect, useRef, useState } from "react";
import { type BrainRequestSnapshot, brainRequestPending } from "#shared/wire/brain";
import { type AskHandler, AskLuke } from "./ask-luke";
import { createHistoryTimeBreakFormatter, opensHistoryTimeBreak } from "./history-time-break";
import { MarkdownMessage } from "./markdown-message";
import { PANEL_TAB, panelPanelId, panelTabId } from "./panel-tabs";
import { CheckIcon, CopyIcon } from "./settings-icons";

export const HISTORY_ENTRY_SPEAKER = {
  YOU: "you",
  LUKE: "luke",
  EVENT: "event",
} as const;

type HistoryEntrySpeaker = (typeof HISTORY_ENTRY_SPEAKER)[keyof typeof HISTORY_ENTRY_SPEAKER];

export interface HistoryEntryPresentation {
  speaker: HistoryEntrySpeaker;
  label: string;
}

/** The user-facing voice for each kind of line in Luke's current-launch thread. */
export function historyEntryPresentation(kind: ConversationEntryKind): HistoryEntryPresentation {
  switch (kind) {
    case CONVERSATION_ENTRY_KIND.TYPED_ASK:
    case CONVERSATION_ENTRY_KIND.SPOKEN_ASK:
      return { speaker: HISTORY_ENTRY_SPEAKER.YOU, label: "You" };
    case CONVERSATION_ENTRY_KIND.REPLY:
    case CONVERSATION_ENTRY_KIND.ANNOUNCEMENT:
    // An act Luke took on his own judgment is drawn as his own line, never as
    // the developer's request; the attribution lives in the stored kind.
    case CONVERSATION_ENTRY_KIND.OWN_ACT:
      return { speaker: HISTORY_ENTRY_SPEAKER.LUKE, label: "Luke" };
    case CONVERSATION_ENTRY_KIND.ACT:
      return { speaker: HISTORY_ENTRY_SPEAKER.EVENT, label: "At your request" };
  }
}

const COPY_CONFIRMATION_MS = 1500;

const ENTRY_TIME = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

const timeBreakLabel = createHistoryTimeBreakFormatter();

/** What History says under an ask whose run has not ended yet. */
export const HISTORY_PENDING_LABEL = "Luke is working on this…";

function HistoryEntryRow({
  entry,
  streaming,
  pending,
  onCancel,
}: {
  entry: ConversationEntry;
  streaming?: boolean;
  /** Whether the run this ask opened is still going, which draws the wait and the cancel. */
  pending?: boolean;
  onCancel?: () => void;
}): React.JSX.Element {
  const presentation = historyEntryPresentation(entry.kind);
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
      className="history-entry"
      data-speaker={presentation.speaker}
      data-streaming={streaming ? "true" : undefined}
    >
      <small className="visually-hidden">{presentation.label}</small>
      <div className="history-message">
        <span className="history-bubble">
          <MarkdownMessage words={words} className="history-words" />
          {pending ? (
            <span className="history-pending" role="status">
              <span className="history-pending-label">{HISTORY_PENDING_LABEL}</span>
              {onCancel ? (
                <button type="button" className="history-cancel" onClick={onCancel}>
                  Cancel
                </button>
              ) : null}
            </span>
          ) : null}
          {/* Copying words still arriving would copy half a sentence; the control
            appears with the settled line the same words become. */}
          {presentation.speaker === HISTORY_ENTRY_SPEAKER.EVENT || streaming ? null : (
            <button
              type="button"
              className="history-copy"
              data-copied={copied ? "true" : undefined}
              aria-label={copied ? "Copied" : "Copy message"}
              onClick={() => {
                // The line's own words as written, Markdown marks included, so
                // a paste carries the structure the bubble drew — and never the
                // structured model context behind an announcement.
                window.sidecar.copyText(words);
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
        <time className="history-time" dateTime={recordedAt.toISOString()}>
          {ENTRY_TIME.format(recordedAt)}
        </time>
      ) : null}
    </li>
  );
}

/**
 * The moment a line was said, set over it the way iMessage dates a message
 * that followed a long silence. It is the thread's line, not a message: it
 * reads in the quiet voice the requested acts use, and it stands still under
 * the pull like Luke's rows do, so uncovering the stamp column never pushes
 * a date off the screen.
 */
function HistoryTimeBreak({ recordedAt, now }: { recordedAt: number; now: number }) {
  const at = new Date(recordedAt);
  const label = timeBreakLabel(recordedAt, now);
  return (
    <li className="history-break">
      <time className="history-break-time" dateTime={at.toISOString()}>
        <strong>{label.day}</strong> {label.time}
      </time>
    </li>
  );
}

/** Stable enough for repeated identical lines without pretending the record has durable ids. */
function keyedHistoryEntries(entries: readonly ConversationEntry[]) {
  const occurrences = new Map<string, number>();
  let previousRecordedAt: number | undefined;
  return entries.map((entry) => {
    const base = conversationEntryKey(entry);
    const occurrence = (occurrences.get(base) ?? 0) + 1;
    occurrences.set(base, occurrence);
    const opensBreak = opensHistoryTimeBreak(previousRecordedAt, entry.recordedAt);
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
const HISTORY_COMPOSER_ROW_INDEX = 1;

/**
 * The thread's one control, seated beside the tab bar the way each tab's
 * search is, so every tab's control is opened from the same place. Clearing
 * is the recoverable deletion, but it still asks twice: the second press
 * names what the first one meant, with a way to stand down beside it. The
 * confirmation needs no reset of its own — the button is drawn only over a
 * thread with recorded lines, so the clear that empties them unmounts it,
 * exactly as leaving the tab does.
 */
export function HistoryClearButton({ onClear }: { onClear: () => void }): React.JSX.Element {
  const [confirming, setConfirming] = useState(false);
  return (
    <span className="history-clear-controls">
      {confirming ? (
        <button type="button" className="history-clear-cancel" onClick={() => setConfirming(false)}>
          Cancel
        </button>
      ) : null}
      <button
        type="button"
        className="history-clear"
        onClick={() => {
          if (!confirming) {
            setConfirming(true);
            return;
          }
          onClear();
        }}
      >
        {confirming ? "Clear history" : "Clear"}
      </button>
    </span>
  );
}

export function ConversationHistoryPanel({
  entries,
  live = [],
  requests = [],
  now,
  onCancelRequest,
  ask,
  onAskEngaged,
  askShortcut,
}: {
  entries: readonly ConversationEntry[];
  /**
   * The instant the thread's dates are read against, so a line from earlier
   * today says Today and one from last week says which day. Passed down like
   * the rows' ages are, because only the app knows which clock is honest.
   */
  now: number;
  /**
   * The brain's runs, so an ask whose run is still going is drawn waiting,
   * with the cancel the developer holds. Read here from the records alone;
   * the reply's own line arrives when the run ends.
   */
  requests?: readonly BrainRequestSnapshot[];
  onCancelRequest?: (runId: string) => void;
  /**
   * The lines still being said, drawn under the settled thread as the same
   * bubbles they will settle into — words growing, no timestamp, no copy.
   */
  live?: readonly ConversationEntry[];
  /** The same ask the sessions tab's composer carries: one conversation, reached from either tab. */
  ask: AskHandler;
  onAskEngaged: (engaged: boolean) => void;
  askShortcut?: string;
}): React.JSX.Element {
  const list = useRef<HTMLDivElement | null>(null);
  const entryCount = entries.length;
  const liveLength = live.reduce((total, entry) => total + entry.words.length, 0);
  const pendingRuns = new Set(
    requests.filter(brainRequestPending).map((snapshot) => snapshot.runId),
  );

  useEffect(() => {
    // Reading the count binds the scroll to an append or clear, not to an
    // unrelated render of the same history.
    if (entryCount === 0) return;
    const element = list.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [entryCount]);

  useEffect(() => {
    // A streaming line only carries the reader along; unlike an append, it
    // never pulls one back who has scrolled up while Luke talks.
    if (liveLength === 0) return;
    const element = list.current;
    if (!element) return;
    const fromTail = element.scrollHeight - element.scrollTop - element.clientHeight;
    if (fromTail <= STREAM_FOLLOW_SLACK_PX) element.scrollTop = element.scrollHeight;
  }, [liveLength]);

  const thread = entries.length > 0 || live.length > 0;

  return (
    <section
      // PostHog blocks this fixed class and its whole subtree. Conversation
      // history belongs on this screen, but never in an optional recording.
      className="history-view ph-no-capture"
      role="tabpanel"
      id={panelPanelId(PANEL_TAB.HISTORY)}
      aria-labelledby={panelTabId(PANEL_TAB.HISTORY)}
    >
      {thread ? (
        <div className="history-scroll" ref={list}>
          {/* The pull is the thread's own sideways scroll, on a scroller of its
              own so the vertical one keeps its scrollbar: the list is one
              stamp column wider than the view, and snapping puts it back the
              moment the fingers lift, which only the browser can see. */}
          <div className="history-pull">
            <ol className="history-list">
              {keyedHistoryEntries(entries).flatMap(({ entry, key, opensBreak }) => {
                const runId = entry.requestId;
                const pending =
                  runId !== undefined &&
                  (entry.kind === CONVERSATION_ENTRY_KIND.TYPED_ASK ||
                    entry.kind === CONVERSATION_ENTRY_KIND.SPOKEN_ASK) &&
                  pendingRuns.has(runId);
                const row = (
                  <HistoryEntryRow
                    key={key}
                    entry={entry}
                    pending={pending}
                    {...(pending && runId !== undefined && onCancelRequest
                      ? { onCancel: () => onCancelRequest(runId) }
                      : undefined)}
                  />
                );
                return opensBreak && entry.recordedAt !== undefined
                  ? [
                      <HistoryTimeBreak
                        key={`${key}:break`}
                        recordedAt={entry.recordedAt}
                        now={now}
                      />,
                      row,
                    ]
                  : [row];
              })}
              {live.map((entry, index) => (
                <HistoryEntryRow
                  // biome-ignore lint/suspicious/noArrayIndexKey: A line still being said has no durable id, and its words change on every delta — a key made of either would remount the bubble mid-sentence, while its position holds still for exactly as long as the line does.
                  key={`live:${entry.kind}:${index}`}
                  entry={entry}
                  streaming
                />
              ))}
            </ol>
          </div>
        </div>
      ) : (
        <div className="history-empty">
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
        rowIndex={HISTORY_COMPOSER_ROW_INDEX}
        {...(askShortcut ? { shortcut: askShortcut } : undefined)}
      />
    </section>
  );
}
