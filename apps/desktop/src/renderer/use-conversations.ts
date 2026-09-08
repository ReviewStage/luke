import type { ConversationEntry } from "@sidecar/realtime";
import {
  type ConversationRecord,
  type HistoryArchiveRecord,
  MAIN_SESSION_KEY,
  type SessionKey,
  sessionKey,
} from "@sidecar/runtime-contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  CONVERSATION_DELETE_OUTCOME,
  CONVERSATION_RESTORE_OUTCOME,
  type ConversationDeleteOutcome,
  type ConversationDirectory,
  type ConversationRestoreOutcome,
} from "#shared/wire/conversation";
import type { AppBootstrap } from "#shared/wire/session";

/**
 * The panel's view of the conversations Luke holds: the directory the main
 * process pushes, which conversation the History tab is looking at, and that
 * conversation's thread. The panel owns none of it — every operation is a
 * bridge call the main process validates against the directory as it then
 * stands — and it holds one thread at a time: main's arrives with the
 * bootstrap and every relay, another's is fetched when the developer opens
 * it and followed by the relays that name it from then on.
 */
export interface ConversationsState {
  directory: ConversationDirectory;
  /** The conversation the History tab is showing. */
  selected: SessionKey;
  selectedRecord: ConversationRecord | undefined;
  /** The selected conversation's retained thread. */
  history: readonly ConversationEntry[];
  select: (sessionKey: SessionKey) => void;
  createThread: (temporary: boolean) => Promise<void>;
  startFresh: (sessionKey: SessionKey) => Promise<boolean>;
  archive: (sessionKey: SessionKey) => Promise<boolean>;
  unarchive: (sessionKey: SessionKey) => Promise<boolean>;
  deleteHistory: (sessionKey: SessionKey) => Promise<ConversationDeleteOutcome>;
  restoreArchive: (archive: HistoryArchiveRecord) => Promise<ConversationRestoreOutcome>;
  /** The bootstrap's snapshot of main's thread, applied only where no push has spoken yet. */
  acceptBootstrap: (bootstrap: Pick<AppBootstrap, "conversationHistory">) => void;
}

const EMPTY_DIRECTORY: ConversationDirectory = { entries: [], archives: [] };

export function useConversations(): ConversationsState {
  const [directory, setDirectory] = useState<ConversationDirectory>(EMPTY_DIRECTORY);
  const [selected, setSelected] = useState<SessionKey>(MAIN_SESSION_KEY);
  const selectedRef = useRef<SessionKey>(MAIN_SESSION_KEY);
  const [history, setHistory] = useState<readonly ConversationEntry[]>([]);
  // Main's thread is kept whichever conversation is showing, so switching
  // back to it costs no read and a relay that arrives meanwhile is not lost.
  const mainHistory = useRef<readonly ConversationEntry[]>([]);
  const mainPushed = useRef(false);

  useEffect(() => {
    const unsubscribe = window.sidecar.onConversationsChanged(setDirectory);
    void window.sidecar
      .listConversations()
      .then(setDirectory)
      .catch(() => undefined);
    return unsubscribe;
  }, []);

  useEffect(
    () =>
      window.sidecar.onConversationHistoryChanged((payload) => {
        if (payload.sessionKey === MAIN_SESSION_KEY) {
          mainHistory.current = payload.entries;
          mainPushed.current = true;
        }
        if (payload.sessionKey === selectedRef.current) setHistory(payload.entries);
      }),
    [],
  );

  const select = useCallback((sessionKey: SessionKey) => {
    selectedRef.current = sessionKey;
    setSelected(sessionKey);
    if (sessionKey === MAIN_SESSION_KEY) {
      setHistory(mainHistory.current);
      return;
    }
    setHistory([]);
    void window.sidecar
      .conversationHistory(sessionKey)
      .then((entries) => {
        if (selectedRef.current === sessionKey) setHistory(entries);
      })
      .catch(() => undefined);
  }, []);

  // A conversation that leaves the directory — deleted for good, or gone with
  // a temporary thread — cannot stay selected; an archived one can, read-only.
  useEffect(() => {
    if (selected === MAIN_SESSION_KEY || directory.entries.length === 0) return;
    if (!directory.entries.some((entry) => entry.sessionKey === selected)) select(MAIN_SESSION_KEY);
  }, [directory, selected, select]);

  const acceptBootstrap = useCallback((bootstrap: Pick<AppBootstrap, "conversationHistory">) => {
    if (mainPushed.current) return;
    mainHistory.current = bootstrap.conversationHistory;
    if (selectedRef.current === MAIN_SESSION_KEY) setHistory(bootstrap.conversationHistory);
  }, []);

  const createThread = useCallback(
    async (temporary: boolean) => {
      const created = await window.sidecar
        .createConversationThread({ temporary })
        .catch(() => undefined);
      if (created) select(sessionKey(created));
    },
    [select],
  );

  return {
    directory,
    selected,
    selectedRecord: directory.entries.find((entry) => entry.sessionKey === selected),
    history,
    select,
    createThread,
    startFresh: (sessionKey) =>
      window.sidecar.startFreshConversation(sessionKey).catch(() => false),
    archive: (sessionKey) => window.sidecar.archiveConversation(sessionKey).catch(() => false),
    unarchive: (sessionKey) => window.sidecar.unarchiveConversation(sessionKey).catch(() => false),
    deleteHistory: (sessionKey) =>
      window.sidecar
        .deleteConversationHistory(sessionKey)
        .catch((): ConversationDeleteOutcome => CONVERSATION_DELETE_OUTCOME.REFUSED),
    restoreArchive: (archive) =>
      window.sidecar
        .restoreConversationArchive(archive.archiveId)
        .catch((): ConversationRestoreOutcome => CONVERSATION_RESTORE_OUTCOME.UNREADABLE),
    acceptBootstrap,
  };
}
