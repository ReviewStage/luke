import {
  CONVERSATION_ENTRY_KIND,
  type ConversationEntry,
  type ConversationEntryKind,
} from "@sidecar/realtime";
import { useEffect, useRef, useState } from "react";
import { PANEL_TAB, panelPanelId, panelTabId } from "./panel-tabs";

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
      return { speaker: HISTORY_ENTRY_SPEAKER.LUKE, label: "Luke" };
    case CONVERSATION_ENTRY_KIND.ANNOUNCEMENT:
      return { speaker: HISTORY_ENTRY_SPEAKER.EVENT, label: "Luke updated you" };
    case CONVERSATION_ENTRY_KIND.ACT:
      return { speaker: HISTORY_ENTRY_SPEAKER.EVENT, label: "At your request" };
  }
}

function HistoryEntryRow({ entry }: { entry: ConversationEntry }): React.JSX.Element {
  const presentation = historyEntryPresentation(entry.kind);
  return (
    <li className="history-entry" data-speaker={presentation.speaker}>
      <small>{presentation.label}</small>
      <p>{entry.words}</p>
    </li>
  );
}

/** Stable enough for repeated identical lines without pretending the record has durable ids. */
function keyedHistoryEntries(entries: readonly ConversationEntry[]) {
  const occurrences = new Map<string, number>();
  return entries.map((entry) => {
    const identity = entry.identity;
    const base = `${entry.kind}:${entry.words}:${identity?.providerId ?? ""}:${identity?.providerSessionId ?? ""}`;
    const occurrence = (occurrences.get(base) ?? 0) + 1;
    occurrences.set(base, occurrence);
    return { entry, key: `${base}:${occurrence}` };
  });
}

export function ConversationHistoryPanel({
  entries,
  onClear,
}: {
  entries: readonly ConversationEntry[];
  onClear: () => void;
}): React.JSX.Element {
  const [confirmingClear, setConfirmingClear] = useState(false);
  const list = useRef<HTMLOListElement | null>(null);
  const entryCount = entries.length;

  useEffect(() => {
    // Reading the count binds the scroll to an append or clear, not to an
    // unrelated render of the same history.
    if (entryCount === 0) return;
    const element = list.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [entryCount]);

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
      {entries.length === 0 ? (
        <div className="history-empty">
          <strong>No conversation yet</strong>
        </div>
      ) : (
        <ol className="history-list" ref={list}>
          {keyedHistoryEntries(entries).map(({ entry, key }) => (
            <HistoryEntryRow key={key} entry={entry} />
          ))}
        </ol>
      )}
    </section>
  );
}
