import type { ConversationEntry } from "@sidecar/realtime";
import {
  RESTORE_OUTCOME,
  type RestoreOutcome,
  type SessionKey,
  sessionKey,
} from "@sidecar/runtime-contracts";
import type { IpcMain, IpcMainEvent, IpcMainInvokeEvent, WebContents } from "electron";
import { BRIDGE } from "#shared/bridge";
import {
  CONVERSATION_DELETE_OUTCOME,
  type ConversationDeleteOutcome,
  type ConversationDirectory,
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
  restoreArchive: (archiveId: string) => Promise<RestoreOutcome>;
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
  const listed = (sender: WebContents, value: string): SessionKey | undefined => {
    const key = sessionKey(value);
    return panel(sender) && operations.holds(key) ? key : undefined;
  };
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
        panel(context.sender) ? operations.restoreArchive(archiveId) : RESTORE_OUTCOME.MISSING,
    },
    { ipcMain: dependencies.ipcMain, trustedSender: dependencies.trustedSender },
  );
}
