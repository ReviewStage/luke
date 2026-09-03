import {
  CONVERSATION_ENTRY_KIND,
  type ConversationEntry,
  type ConversationEntryKind,
  conversationEntryKey,
} from "@sidecar/realtime";
import { useEffect, useRef, useState } from "react";
import { type AskHandler, AskLuke } from "./ask-luke";
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
      return { speaker: HISTORY_ENTRY_SPEAKER.LUKE, label: "Luke" };
    case CONVERSATION_ENTRY_KIND.ACT:
      return { speaker: HISTORY_ENTRY_SPEAKER.EVENT, label: "At your request" };
  }
}

const COPY_CONFIRMATION_MS = 1500;

const ENTRY_TIME = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

function HistoryEntryRow({
  entry,
  streaming,
}: {
  entry: ConversationEntry;
  streaming?: boolean;
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
      <span className="history-bubble">
        <p>
          {words}
          {recordedAt ? (
            <time className="history-time" dateTime={recordedAt.toISOString()}>
              {ENTRY_TIME.format(recordedAt)}
            </time>
          ) : null}
        </p>
        {/* Copying words still arriving would copy half a sentence; the control
            appears with the settled line the same words become. */}
        {presentation.speaker === HISTORY_ENTRY_SPEAKER.EVENT || streaming ? null : (
          <button
            type="button"
            className="history-copy"
            data-copied={copied ? "true" : undefined}
            aria-label={copied ? "Copied" : "Copy message"}
            onClick={() => {
              // The visible words, never the structured model context behind an
              // announcement: copy takes exactly what the bubble shows.
              window.sidecar.copyText(words);
              setCopied(true);
            }}
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
          </button>
        )}
      </span>
    </li>
  );
}

/** Stable enough for repeated identical lines without pretending the record has durable ids. */
function keyedHistoryEntries(entries: readonly ConversationEntry[]) {
  const occurrences = new Map<string, number>();
  return entries.map((entry) => {
    const base = conversationEntryKey(entry);
    const occurrence = (occurrences.get(base) ?? 0) + 1;
    occurrences.set(base, occurrence);
    return { entry, key: `${base}:${occurrence}` };
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

export function ConversationHistoryPanel({
  entries,
  live = [],
  onClear,
  ask,
  onAskEngaged,
  askShortcut,
}: {
  entries: readonly ConversationEntry[];
  /**
   * The lines still being said, drawn under the settled thread as the same
   * bubbles they will settle into — words growing, no timestamp, no copy.
   */
  live?: readonly ConversationEntry[];
  onClear: () => void;
  /** The same ask the sessions tab's composer carries: one conversation, reached from either tab. */
  ask: AskHandler;
  onAskEngaged: (engaged: boolean) => void;
  askShortcut?: string;
}): React.JSX.Element {
  const [confirmingClear, setConfirmingClear] = useState(false);
  const list = useRef<HTMLOListElement | null>(null);
  const entryCount = entries.length;
  const liveLength = live.reduce((total, entry) => total + entry.words.length, 0);

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

  useEffect(() => {
    if (entries.length === 0) setConfirmingClear(false);
  }, [entries.length]);

  return (
    <section
      // PostHog blocks this fixed class and its whole subtree. Conversation
      // history belongs on this screen, but never in an optional recording.
      className="history-view ph-no-capture"
      role="tabpanel"
      id={panelPanelId(PANEL_TAB.HISTORY)}
      aria-labelledby={panelTabId(PANEL_TAB.HISTORY)}
    >
      {entries.length > 0 ? (
        <header className="history-header">
          <span className="history-clear-controls">
            {confirmingClear ? (
              <button
                type="button"
                className="history-clear-cancel"
                onClick={() => setConfirmingClear(false)}
              >
                Cancel
              </button>
            ) : null}
            <button
              type="button"
              className="history-clear"
              onClick={() => {
                if (!confirmingClear) {
                  setConfirmingClear(true);
                  return;
                }
                onClear();
              }}
            >
              {confirmingClear ? "Clear history" : "Clear"}
            </button>
          </span>
        </header>
      ) : null}
      {entries.length === 0 && live.length === 0 ? (
        <div className="history-empty">
          <strong>No messages yet</strong>
        </div>
      ) : (
        <ol className="history-list" ref={list}>
          {keyedHistoryEntries(entries).map(({ entry, key }) => (
            <HistoryEntryRow key={key} entry={entry} />
          ))}
          {live.map((entry, index) => (
            <HistoryEntryRow
              // biome-ignore lint/suspicious/noArrayIndexKey: A line still being said has no durable id, and its words change on every delta — a key made of either would remount the bubble mid-sentence, while its position holds still for exactly as long as the line does.
              key={`live:${entry.kind}:${index}`}
              entry={entry}
              streaming
            />
          ))}
        </ol>
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
