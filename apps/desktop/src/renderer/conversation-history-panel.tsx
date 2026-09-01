import { ProviderMark } from "@sidecar/panel";
import {
  CONVERSATION_ENTRY_KIND,
  type ConversationEntry,
  type ConversationEntryKind,
  conversationEntryKey,
} from "@sidecar/realtime";
import type { SessionIdentity } from "@sidecar/session";
import { useEffect, useRef, useState } from "react";
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
  openable,
  onOpenSession,
}: {
  entry: ConversationEntry;
  streaming?: boolean;
  openable: (identity: SessionIdentity) => boolean;
  onOpenSession: (identity: SessionIdentity) => void;
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
  // A chip per chat the line named, each the roster-validated identity and
  // title the words were recorded beside, offered only while a press has
  // somewhere to land: the session's current address, or — for a chat whose
  // row has departed — the last one its provider reported, which the main
  // process keeps and the press only ever names.
  const mentions = (entry.mentions ?? []).filter((mention) => openable(mention));

  return (
    <li
      className="history-entry"
      data-speaker={presentation.speaker}
      data-streaming={streaming ? "true" : undefined}
    >
      <small className="visually-hidden">{presentation.label}</small>
      {/* The bubble anchors the copy control, so a chip row wrapping wider
          below cannot pull the glyph away from the words it copies. */}
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
      {mentions.length > 0 ? (
        <span className="history-mentions">
          {mentions.map((mention) => (
            <button
              key={`${mention.providerId}:${mention.providerSessionId}`}
              type="button"
              className="history-chip"
              aria-label={`Open ${mention.title}`}
              onClick={() =>
                onOpenSession({
                  providerId: mention.providerId,
                  providerSessionId: mention.providerSessionId,
                })
              }
            >
              <ProviderMark providerId={mention.markId} />
              <span className="history-chip-name">{mention.title}</span>
              {/* The app marks the chat's row wore when the line was recorded,
                  saying where it is also held. Bare marks, never presses of
                  their own: the chip is one press, like the notice band's. */}
              {mention.applications.length > 0 ? (
                <span className="history-chip-applications">
                  {mention.applications.map((application) => (
                    <span
                      key={application.id}
                      className="history-chip-application"
                      role="img"
                      aria-label={`Also in ${application.name}`}
                      title={application.name}
                    >
                      <ProviderMark providerId={application.id} />
                    </span>
                  ))}
                </span>
              ) : null}
            </button>
          ))}
        </span>
      ) : null}
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

export function ConversationHistoryPanel({
  entries,
  live = [],
  onClear,
  openable,
  onOpenSession,
}: {
  entries: readonly ConversationEntry[];
  /**
   * The lines still being said, drawn under the settled thread as the same
   * bubbles they will settle into — words growing, no timestamp, no copy.
   */
  live?: readonly ConversationEntry[];
  onClear: () => void;
  /** Whether a named chat still has an address a press could reach. */
  openable: (identity: SessionIdentity) => boolean;
  /** Hands a chip's roster-validated identity to the same open a row press takes. */
  onOpenSession: (identity: SessionIdentity) => void;
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
            <HistoryEntryRow
              key={key}
              entry={entry}
              openable={openable}
              onOpenSession={onOpenSession}
            />
          ))}
          {live.map((entry, index) => (
            <HistoryEntryRow
              // biome-ignore lint/suspicious/noArrayIndexKey: A line still being said has no durable id, and its words change on every delta — a key made of either would remount the bubble mid-sentence, while its position holds still for exactly as long as the line does.
              key={`live:${entry.kind}:${index}`}
              entry={entry}
              streaming
              openable={openable}
              onOpenSession={onOpenSession}
            />
          ))}
        </ol>
      )}
    </section>
  );
}
