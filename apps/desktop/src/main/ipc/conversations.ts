import type { ConversationEntry } from "@sidecar/realtime";
import type { SessionKey } from "@sidecar/runtime-contracts";
import type { IpcMain, IpcMainEvent, IpcMainInvokeEvent, WebContents } from "electron";
import { BRIDGE } from "#shared/bridge";
import {
  CONVERSATION_DELETE_OUTCOME,
  CONVERSATION_RESTORE_OUTCOME,
  type ConversationDeleteOutcome,
  type ConversationDirectory,
  type ConversationRestoreOutcome,
} from "#shared/wire/conversation";
import { registerBridge } from "../register-bridge";

/**
 * The conversation controls at the IPC boundary. Every operation comes from a
 * panel, names a conversation by a key the directory lists at that moment,
 * and is carried out by the operations the desktop composed; nothing here
 * decides what an operation does, only who may ask for it and on what.
 */
export interface ConversationOperations {
  directory: () => ConversationDirectory;
  holds: (sessionKey: SessionKey) => boolean;
  history: (sessionKey: SessionKey) => readonly ConversationEntry[];
  createThread: (temporary: boolean) => Promise<SessionKey | undefined>;
  startFresh: (sessionKey: SessionKey) => Promise<boolean>;
  archive: (sessionKey: SessionKey) => Promise<boolean>;
  unarchive: (sessionKey: SessionKey) => Promise<boolean>;
  deleteHistory: (sessionKey: SessionKey) => Promise<ConversationDeleteOutcome>;
  restoreArchive: (archiveId: string) => Promise<ConversationRestoreOutcome>;
}

export interface ConversationsIpcDependencies {
  ipcMain: Pick<IpcMain, "handle" | "on">;
  trustedSender: (event: IpcMainEvent | IpcMainInvokeEvent) => boolean;
  /** Whether the sender is a panel window, the only surface that holds the controls. */
  panel: (sender: WebContents) => boolean;
  operations: ConversationOperations;
}

export function registerConversationsIpc(dependencies: ConversationsIpcDependencies): void {
  const { operations, panel } = dependencies;
  // SAFETY: the bridge guard admitted a non-empty string, which is what the session key constructor admits.
  const key = (value: string) => value as SessionKey;
  const listed = (sender: WebContents, value: string): SessionKey | undefined =>
    panel(sender) && operations.holds(key(value)) ? key(value) : undefined;
  registerBridge(
    BRIDGE,
    {
      listConversations: () => operations.directory(),
      conversationHistory: (context, sessionKey) => {
        const target = listed(context.sender, sessionKey);
        return target ? operations.history(target) : [];
      },
      createConversationThread: (context, request) =>
        panel(context.sender) ? operations.createThread(request.temporary) : undefined,
      startFreshConversation: (context, sessionKey) => {
        const target = listed(context.sender, sessionKey);
        return target ? operations.startFresh(target) : false;
      },
      archiveConversation: (context, sessionKey) => {
        const target = listed(context.sender, sessionKey);
        return target ? operations.archive(target) : false;
      },
      unarchiveConversation: (context, sessionKey) => {
        const target = listed(context.sender, sessionKey);
        return target ? operations.unarchive(target) : false;
      },
      deleteConversationHistory: (context, sessionKey) => {
        const target = listed(context.sender, sessionKey);
        return target ? operations.deleteHistory(target) : CONVERSATION_DELETE_OUTCOME.REFUSED;
      },
      restoreConversationArchive: (context, archiveId) =>
        panel(context.sender)
          ? operations.restoreArchive(archiveId)
          : CONVERSATION_RESTORE_OUTCOME.MISSING,
    },
    { ipcMain: dependencies.ipcMain, trustedSender: dependencies.trustedSender },
  );
}
