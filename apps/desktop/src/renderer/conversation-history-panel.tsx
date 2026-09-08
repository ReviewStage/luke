import {
  CONVERSATION_ENTRY_KIND,
  type ConversationEntry,
  type ConversationEntryKind,
  conversationEntryKey,
} from "@sidecar/realtime";
import {
  CONVERSATION_KIND,
  type ConversationRecord,
  type HistoryArchiveRecord,
  MAIN_SESSION_KEY,
  RESTORE_OUTCOME,
  type RestoreOutcome,
  type SessionKey,
  sessionKey,
} from "@sidecar/runtime-contracts";
import { useEffect, useRef, useState } from "react";
import { type BrainRequestSnapshot, brainRequestPending } from "#shared/wire/brain";
import {
  CONVERSATION_CONTROL_WORDS,
  CONVERSATION_DELETE_OUTCOME,
  type ConversationDeleteOutcome,
  type ConversationDirectory,
} from "#shared/wire/conversation";
import { type AskHandler, AskLuke } from "./ask-luke";
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
      return { speaker: HISTORY_ENTRY_SPEAKER.LUKE, label: "Luke" };
    case CONVERSATION_ENTRY_KIND.ACT:
      return { speaker: HISTORY_ENTRY_SPEAKER.EVENT, label: "At your request" };
  }
}

const COPY_CONFIRMATION_MS = 1500;

const ENTRY_TIME = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const ARCHIVE_TIME = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

/** What History says under an ask whose run has not ended yet. */
export const HISTORY_PENDING_LABEL = "Luke is working on this…";

/** What History says over an archived conversation's thread instead of a composer. */
export const HISTORY_ARCHIVED_NOTE = "Archived. Unarchive it to keep talking here.";

/** The one-line outcomes the controls report, in place, on the header's own clock. */
export const HISTORY_CONTROL_NOTICE = {
  FRESH: "Started fresh. Your history and Luke's memory are still here.",
  FRESH_FAILED: "Could not start fresh just now.",
  DELETED: "History deleted. A recovery archive is saved on this Mac.",
  DELETED_UNPUBLISHED:
    "History deleted. The recovery archive is saved in the database and will be written to disk at the next launch.",
  DELETE_REFUSED: "Could not delete this history.",
  RESTORED: "Restored.",
  RESTORE_NEWER_LIVE: "Not restored: this conversation already has newer messages.",
  RESTORE_UNREADABLE: "Not restored: the archive could not be read.",
  RESTORE_MISSING: "Not restored: that archive is gone.",
} as const;

const NOTICE_MS = 6000;

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

/**
 * The conversation controls as the panel is handed them: the directory, the
 * selection, and one operation per control. Every operation goes back through
 * the bridge to the main process, which validates the key against the
 * directory as it then stands; the panel decides nothing but what to draw.
 */
export interface ConversationControls {
  directory: ConversationDirectory;
  selected: SessionKey;
  onSelect: (sessionKey: SessionKey) => void;
  onNewThread: (temporary: boolean) => void;
  onStartFresh: (sessionKey: SessionKey) => Promise<boolean>;
  onArchive: (sessionKey: SessionKey) => Promise<boolean>;
  onUnarchive: (sessionKey: SessionKey) => Promise<boolean>;
  onDeleteHistory: (sessionKey: SessionKey) => Promise<ConversationDeleteOutcome>;
  onRestore: (archive: HistoryArchiveRecord) => Promise<RestoreOutcome>;
}

const CONFIRMING = {
  FRESH: "fresh",
  DELETE: "delete",
} as const;

type Confirming = (typeof CONFIRMING)[keyof typeof CONFIRMING];

export function conversationLabel(record: ConversationRecord): string {
  if (record.kind === CONVERSATION_KIND.MAIN) return "Main";
  return record.temporary ? `${record.name} (temporary)` : record.name;
}

function restoreNotice(outcome: RestoreOutcome): string {
  switch (outcome) {
    case RESTORE_OUTCOME.RESTORED:
      return HISTORY_CONTROL_NOTICE.RESTORED;
    case RESTORE_OUTCOME.NEWER_LIVE:
      return HISTORY_CONTROL_NOTICE.RESTORE_NEWER_LIVE;
    case RESTORE_OUTCOME.MISSING:
      return HISTORY_CONTROL_NOTICE.RESTORE_MISSING;
    case RESTORE_OUTCOME.UNREADABLE:
      return HISTORY_CONTROL_NOTICE.RESTORE_UNREADABLE;
  }
}

function deleteNotice(outcome: ConversationDeleteOutcome): string {
  switch (outcome) {
    case CONVERSATION_DELETE_OUTCOME.COMPLETE:
      return HISTORY_CONTROL_NOTICE.DELETED;
    case CONVERSATION_DELETE_OUTCOME.INCOMPLETE:
      return HISTORY_CONTROL_NOTICE.DELETED_UNPUBLISHED;
    case CONVERSATION_DELETE_OUTCOME.REFUSED:
      return HISTORY_CONTROL_NOTICE.DELETE_REFUSED;
  }
}

/**
 * The header over the thread: a compact selector across every conversation,
 * and the controls that replaced the one ambiguous Clear. Each destructive
 * control confirms in place with the sentence that says what it keeps.
 */
function ConversationHeader({
  controls,
  onNotice,
}: {
  controls: ConversationControls;
  onNotice: (notice: string) => void;
}): React.JSX.Element {
  const [confirming, setConfirming] = useState<Confirming | undefined>(undefined);
  const { directory, selected } = controls;
  const active = directory.entries.filter((entry) => entry.archivedAt === undefined);
  const archived = directory.entries.filter((entry) => entry.archivedAt !== undefined);
  const current = directory.entries.find((entry) => entry.sessionKey === selected);
  const isMain = current?.kind === CONVERSATION_KIND.MAIN;
  const isArchived = current?.archivedAt !== undefined;
  const archives = directory.archives.filter((archive) => archive.sessionKey === selected);

  const startFresh = async () => {
    setConfirming(undefined);
    const fresh = await controls.onStartFresh(selected);
    onNotice(fresh ? HISTORY_CONTROL_NOTICE.FRESH : HISTORY_CONTROL_NOTICE.FRESH_FAILED);
  };
  const deleteHistory = async () => {
    setConfirming(undefined);
    onNotice(deleteNotice(await controls.onDeleteHistory(selected)));
  };

  return (
    <header className="history-header">
      <label className="history-selector">
        <span className="visually-hidden">Conversation</span>
        <select
          className="history-select"
          value={selected}
          onChange={(event) => {
            controls.onSelect(sessionKey(event.target.value));
          }}
        >
          <optgroup label="Conversations">
            {active.map((entry) => (
              <option key={entry.sessionKey} value={entry.sessionKey}>
                {conversationLabel(entry)}
              </option>
            ))}
          </optgroup>
          {archived.length > 0 ? (
            <optgroup label="Archived">
              {archived.map((entry) => (
                <option key={entry.sessionKey} value={entry.sessionKey}>
                  {conversationLabel(entry)}
                </option>
              ))}
            </optgroup>
          ) : null}
        </select>
      </label>
      <details className="history-menu">
        <summary className="history-menu-summary" aria-label="Conversation controls">
          Manage
        </summary>
        <div className="history-menu-sheet">
          <div className="history-menu-group">
            <button
              type="button"
              className="history-menu-action"
              onClick={() => controls.onNewThread(false)}
            >
              {CONVERSATION_CONTROL_WORDS.NEW_THREAD}
            </button>
            <button
              type="button"
              className="history-menu-action"
              onClick={() => controls.onNewThread(true)}
            >
              {CONVERSATION_CONTROL_WORDS.NEW_TEMPORARY_THREAD}
            </button>
            <p className="history-menu-note">{CONVERSATION_CONTROL_WORDS.TEMPORARY_EXPLANATION}</p>
          </div>
          {current && !isArchived ? (
            <div className="history-menu-group">
              {confirming === CONFIRMING.FRESH ? (
                <>
                  <p className="history-menu-note">
                    {CONVERSATION_CONTROL_WORDS.START_FRESH_EXPLANATION}
                  </p>
                  <span className="history-confirm">
                    <button
                      type="button"
                      className="history-menu-cancel"
                      onClick={() => setConfirming(undefined)}
                    >
                      Cancel
                    </button>
                    <button type="button" className="history-menu-action" onClick={startFresh}>
                      {CONVERSATION_CONTROL_WORDS.START_FRESH}
                    </button>
                  </span>
                </>
              ) : (
                <button
                  type="button"
                  className="history-menu-action"
                  onClick={() => setConfirming(CONFIRMING.FRESH)}
                >
                  {CONVERSATION_CONTROL_WORDS.START_FRESH}
                </button>
              )}
              {isMain ? null : (
                <button
                  type="button"
                  className="history-menu-action"
                  onClick={() => void controls.onArchive(selected)}
                >
                  {CONVERSATION_CONTROL_WORDS.ARCHIVE}
                </button>
              )}
            </div>
          ) : null}
          {current && isArchived ? (
            <div className="history-menu-group">
              <button
                type="button"
                className="history-menu-action"
                onClick={() => void controls.onUnarchive(selected)}
              >
                {CONVERSATION_CONTROL_WORDS.UNARCHIVE}
              </button>
            </div>
          ) : null}
          {current ? (
            <div className="history-menu-group">
              {confirming === CONFIRMING.DELETE ? (
                <>
                  <p className="history-menu-note">
                    {CONVERSATION_CONTROL_WORDS.DELETE_EXPLANATION}
                  </p>
                  <span className="history-confirm">
                    <button
                      type="button"
                      className="history-menu-cancel"
                      onClick={() => setConfirming(undefined)}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="history-menu-action history-menu-danger"
                      onClick={deleteHistory}
                    >
                      {CONVERSATION_CONTROL_WORDS.DELETE_HISTORY}
                    </button>
                  </span>
                </>
              ) : (
                <button
                  type="button"
                  className="history-menu-action history-menu-danger"
                  onClick={() => setConfirming(CONFIRMING.DELETE)}
                >
                  {CONVERSATION_CONTROL_WORDS.DELETE_HISTORY}
                </button>
              )}
            </div>
          ) : null}
          {archives.length > 0 ? (
            <div className="history-menu-group">
              <p className="history-menu-note">Deleted history of this conversation</p>
              <ul className="history-archives">
                {archives.map((archive) => (
                  <li key={archive.archiveId} className="history-archive">
                    <span className="history-archive-label">
                      {ARCHIVE_TIME.format(new Date(archive.deletedAt))} · {archive.historyLines}{" "}
                      lines
                      {archive.publishedAt === undefined ? " · not yet on disk" : ""}
                    </span>
                    <button
                      type="button"
                      className="history-menu-action"
                      onClick={() => {
                        void controls.onRestore(archive).then((outcome) => {
                          onNotice(restoreNotice(outcome));
                        });
                      }}
                    >
                      {CONVERSATION_CONTROL_WORDS.RESTORE}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </details>
    </header>
  );
}

export function ConversationHistoryPanel({
  entries,
  live = [],
  requests = [],
  onCancelRequest,
  conversations,
  ask,
  onAskEngaged,
  askShortcut,
}: {
  entries: readonly ConversationEntry[];
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
  /** The selector and the controls over every conversation Luke holds. */
  conversations: ConversationControls;
  /** The ask for the conversation shown: main's composer on the sessions tab is the same handler aimed at main. */
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
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const selectedRecord = conversations.directory.entries.find(
    (entry) => entry.sessionKey === conversations.selected,
  );
  const archived = selectedRecord?.archivedAt !== undefined;
  // Only main's thread carries the voice window's words still being said.
  const shownLive = conversations.selected === MAIN_SESSION_KEY ? live : [];

  useEffect(() => {
    if (notice === undefined) return;
    const timer = setTimeout(() => setNotice(undefined), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);

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

  const thread = entries.length > 0 || shownLive.length > 0;

  return (
    <section
      // PostHog blocks this fixed class and its whole subtree. Conversation
      // history belongs on this screen, but never in an optional recording:
      // the selector's thread names and the archive list ride inside it too.
      className="history-view ph-no-capture"
      role="tabpanel"
      id={panelPanelId(PANEL_TAB.HISTORY)}
      aria-labelledby={panelTabId(PANEL_TAB.HISTORY)}
    >
      {/* Keyed by the selection so a confirmation opened over one conversation
          never carries over to the next. */}
      <ConversationHeader
        key={conversations.selected}
        controls={conversations}
        onNotice={setNotice}
      />
      {notice ? (
        <p className="history-notice" role="status">
          {notice}
        </p>
      ) : null}
      {thread ? (
        <div className="history-scroll" ref={list}>
          {/* The pull is the thread's own sideways scroll, on a scroller of its
              own so the vertical one keeps its scrollbar: the list is one
              stamp column wider than the view, and snapping puts it back the
              moment the fingers lift, which only the browser can see. */}
          <div className="history-pull">
            <ol className="history-list">
              {keyedHistoryEntries(entries).map(({ entry, key }) => {
                const runId = entry.requestId;
                const pending =
                  runId !== undefined &&
                  (entry.kind === CONVERSATION_ENTRY_KIND.TYPED_ASK ||
                    entry.kind === CONVERSATION_ENTRY_KIND.SPOKEN_ASK) &&
                  pendingRuns.has(runId);
                return (
                  <HistoryEntryRow
                    key={key}
                    entry={entry}
                    pending={pending}
                    {...(pending && runId !== undefined && onCancelRequest
                      ? { onCancel: () => onCancelRequest(runId) }
                      : undefined)}
                  />
                );
              })}
              {shownLive.map((entry, index) => (
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
          holds, addressed to the conversation shown. It rides inside the
          blocked subtree: a draft here is worded beside the words it will
          join, and a recording sees neither. An archived conversation takes
          no ask: its brain is retired until it is unarchived. */}
      {archived ? (
        <p className="history-archived-note">{HISTORY_ARCHIVED_NOTE}</p>
      ) : (
        <AskLuke
          ask={ask}
          onEngagedChange={onAskEngaged}
          rowIndex={HISTORY_COMPOSER_ROW_INDEX}
          {...(askShortcut ? { shortcut: askShortcut } : undefined)}
        />
      )}
    </section>
  );
}
