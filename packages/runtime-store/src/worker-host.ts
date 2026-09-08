import path from "node:path";
import type { UnparsedWireValue } from "@sidecar/wire";
import { deleteConversationHistory } from "./archives.js";
import { loadBrainEnvelope, saveBrainEnvelope } from "./brain-envelope.js";
import {
  deleteChildCompletion,
  deleteChildRun,
  listChildCompletions,
  listChildRuns,
  putChildCompletion,
  putChildRun,
} from "./children-table.js";
import {
  archiveConversation,
  createConversation,
  listConversations,
  pinConversation,
  unarchiveConversation,
} from "./conversations-table.js";
import { AGENT_DATABASE_FILE, RuntimeDatabase } from "./database.js";
import { appendHistory, historyClearedAt, listHistory, searchHistory } from "./history-table.js";
import { deleteScheduledJob, listScheduledJobs, putScheduledJob } from "./jobs-table.js";
import { runHistoryMaintenance } from "./maintenance-run.js";
import { flushState, recordFlush } from "./memory-flush-table.js";
import {
  applyMemorySync,
  memoryIndexStatus,
  planMemorySync,
  readMemoryLines,
  rebuildMemoryIndex,
  searchMemoryIndex,
} from "./memory-index-table.js";
import {
  forgetMemorySources,
  forgetNotebookEntry,
  listNotebookEntries,
  migrateFactsIntoNotebook,
  rememberNotebookEntry,
} from "./notebook-table.js";
import {
  RUNTIME_STORE_METHOD,
  type RuntimeStoreMethod,
  type RuntimeStoreMethods,
  type RuntimeStorePort,
  type RuntimeStoreRequest,
  type RuntimeStoreResponse,
  runtimeStoreRequestFromWire,
} from "./protocol.js";

/**
 * The database's side of the channel. It answers requests one at a time in
 * the order they arrive — the database is synchronous, so there is nothing
 * to interleave — and never lets an exception cross the channel as anything
 * but an error answer with the request's id, so a caller always hears back.
 */

/** What a handler runs against: the database once opened, the agent directory it lives in, and the open and close of it. */
interface RuntimeStoreHost {
  opened(): RuntimeDatabase;
  agentRoot(): string;
  /** The notebook's root: the agent's identity workspace. */
  workspace(): string;
  open(agentRoot: string, workspaceDirectory: string | undefined): void;
  close(): void;
}

const WORKSPACE_DIRECTORY = "workspace";

/**
 * One handler per method, keyed by the protocol's own table, so a method
 * added to the protocol without a handler here fails to compile rather than
 * falling through at runtime.
 */
type RuntimeStoreHandlers = {
  [Method in RuntimeStoreMethod]: (
    host: RuntimeStoreHost,
    params: RuntimeStoreMethods[Method]["params"],
  ) => RuntimeStoreMethods[Method]["result"];
};

const HANDLERS: RuntimeStoreHandlers = {
  [RUNTIME_STORE_METHOD.OPEN]: (host, params) => {
    host.open(params.agentRoot, params.workspaceDirectory);
    createConversation(host.opened(), {
      agentId: params.agentId,
      sessionKey: params.sessionKey,
      name: params.conversationName,
      now: params.now,
    });
    // The stable facts an earlier build kept move into the notebook at the
    // first open that finds them, under their own ids, and never again.
    migrateFactsIntoNotebook(host.opened(), host.workspace(), params.now);
    return true;
  },
  [RUNTIME_STORE_METHOD.BRAIN_LOAD]: (host, params) =>
    loadBrainEnvelope(host.opened(), params.sessionKey),
  [RUNTIME_STORE_METHOD.BRAIN_SAVE]: (host, params) =>
    saveBrainEnvelope(host.opened(), params.sessionKey, params.save),
  [RUNTIME_STORE_METHOD.HISTORY_APPEND]: (host, params) =>
    appendHistory(host.opened(), params.sessionKey, params.entries, params.now),
  [RUNTIME_STORE_METHOD.HISTORY_LIST]: (host, params) =>
    listHistory(host.opened(), params.sessionKey, params.now),
  [RUNTIME_STORE_METHOD.HISTORY_CUTOFF]: (host, params) =>
    historyClearedAt(host.opened(), params.sessionKey),
  [RUNTIME_STORE_METHOD.HISTORY_SEARCH]: (host, params) =>
    searchHistory(host.opened(), params.sessionKeys, params.query, params.limit, params.now),
  [RUNTIME_STORE_METHOD.NOTEBOOK_LIST]: (host, params) =>
    listNotebookEntries(host.opened(), host.workspace(), params.now),
  [RUNTIME_STORE_METHOD.NOTEBOOK_REMEMBER]: (host, params) =>
    rememberNotebookEntry(host.opened(), host.workspace(), params, params.now),
  [RUNTIME_STORE_METHOD.NOTEBOOK_FORGET]: (host, params) =>
    forgetNotebookEntry(host.opened(), host.workspace(), params.id, params.now),
  [RUNTIME_STORE_METHOD.MEMORY_PLAN_SYNC]: (host, params) =>
    planMemorySync(
      host.opened(),
      host.workspace(),
      params.identity,
      listNotebookEntries(host.opened(), host.workspace(), params.now),
    ),
  [RUNTIME_STORE_METHOD.MEMORY_APPLY_SYNC]: (host, params) =>
    applyMemorySync(
      host.opened(),
      { changed: params.changed, removed: params.removed },
      params.embeddings,
      params.identity,
      params.now,
    ),
  [RUNTIME_STORE_METHOD.MEMORY_SEARCH]: (host, params) => searchMemoryIndex(host.opened(), params),
  [RUNTIME_STORE_METHOD.MEMORY_GET]: (host, params) =>
    readMemoryLines(host.workspace(), params.path, params.from, params.lines),
  [RUNTIME_STORE_METHOD.MEMORY_REBUILD]: (host) => rebuildMemoryIndex(host.opened()),
  [RUNTIME_STORE_METHOD.MEMORY_STATUS]: (host) => memoryIndexStatus(host.opened()),
  [RUNTIME_STORE_METHOD.MEMORY_FLUSH_STATE_GET]: (host, params) =>
    flushState(host.opened(), params.sessionKey, params.generationId),
  [RUNTIME_STORE_METHOD.MEMORY_FLUSH_STATE_PUT]: (host, params) => {
    recordFlush(host.opened(), params.sessionKey, params.state);
    return true;
  },
  [RUNTIME_STORE_METHOD.MEMORY_FORGET]: (host, params) =>
    forgetMemorySources(host.opened(), host.workspace(), params.ask, params.now),
  [RUNTIME_STORE_METHOD.CONVERSATIONS_LIST]: (host) => listConversations(host.opened()),
  [RUNTIME_STORE_METHOD.CONVERSATION_CREATE]: (host, params) =>
    createConversation(host.opened(), params),
  [RUNTIME_STORE_METHOD.CONVERSATION_ARCHIVE]: (host, params) =>
    archiveConversation(host.opened(), params.sessionKey, params.now, params.reason),
  [RUNTIME_STORE_METHOD.CONVERSATION_UNARCHIVE]: (host, params) =>
    unarchiveConversation(host.opened(), params.sessionKey),
  [RUNTIME_STORE_METHOD.CONVERSATION_PIN]: (host, params) =>
    pinConversation(host.opened(), params.sessionKey, params.pinnedAt),
  [RUNTIME_STORE_METHOD.CONVERSATION_DELETE]: (host, params) =>
    deleteConversationHistory(
      host.opened(),
      host.agentRoot(),
      params.sessionKey,
      params.now,
      params,
    ),
  [RUNTIME_STORE_METHOD.MAINTENANCE_RUN]: (host, params) =>
    runHistoryMaintenance(host.opened(), host.agentRoot(), params),
  [RUNTIME_STORE_METHOD.JOBS_LIST]: (host) => listScheduledJobs(host.opened()),
  [RUNTIME_STORE_METHOD.JOB_PUT]: (host, params) => putScheduledJob(host.opened(), params.job),
  [RUNTIME_STORE_METHOD.JOB_DELETE]: (host, params) => deleteScheduledJob(host.opened(), params.id),
  [RUNTIME_STORE_METHOD.CHILDREN_LIST]: (host) => listChildRuns(host.opened()),
  [RUNTIME_STORE_METHOD.CHILD_PUT]: (host, params) => putChildRun(host.opened(), params.record),
  [RUNTIME_STORE_METHOD.CHILD_DELETE]: (host, params) =>
    deleteChildRun(host.opened(), params.childId),
  [RUNTIME_STORE_METHOD.COMPLETIONS_LIST]: (host) => listChildCompletions(host.opened()),
  [RUNTIME_STORE_METHOD.COMPLETION_PUT]: (host, params) =>
    putChildCompletion(host.opened(), params.completion),
  [RUNTIME_STORE_METHOD.COMPLETION_DELETE]: (host, params) =>
    deleteChildCompletion(host.opened(), params.completionId),
  [RUNTIME_STORE_METHOD.CLOSE]: (host) => {
    host.close();
    return true;
  },
};

function dispatch<Method extends RuntimeStoreMethod>(
  host: RuntimeStoreHost,
  request: RuntimeStoreRequest<Method>,
): RuntimeStoreMethods[Method]["result"] {
  // SAFETY: the handler table is indexed by the request's own method, so the handler's params
  // and result are the ones that method declares; TypeScript cannot correlate the two through
  // a generic index, which is the one place this file narrows by hand.
  const handler = HANDLERS[request.method] as (
    host: RuntimeStoreHost,
    params: RuntimeStoreMethods[Method]["params"],
  ) => RuntimeStoreMethods[Method]["result"];
  return handler(host, request.params);
}

export function serveRuntimeStore(port: RuntimeStorePort): void {
  let database: RuntimeDatabase | undefined;
  let root: string | undefined;
  let workspace: string | undefined;
  const host: RuntimeStoreHost = {
    opened: () => {
      if (!database) throw new Error("runtime store is not open");
      return database;
    },
    agentRoot: () => {
      if (root === undefined) throw new Error("runtime store is not open");
      return root;
    },
    workspace: () => {
      if (workspace === undefined) throw new Error("runtime store is not open");
      return workspace;
    },
    open: (agentRoot, workspaceDirectory) => {
      database?.close();
      root = agentRoot;
      workspace = workspaceDirectory ?? path.join(agentRoot, WORKSPACE_DIRECTORY);
      database = RuntimeDatabase.open(path.join(agentRoot, AGENT_DATABASE_FILE));
    },
    close: () => {
      database?.close();
      database = undefined;
      root = undefined;
      workspace = undefined;
    },
  };

  port.on("message", (message) => {
    const request = runtimeStoreRequestFromWire(message);
    if (!request) return;
    let response: RuntimeStoreResponse;
    try {
      // SAFETY: a method's result is the structured-clone value its declared type describes.
      response = { id: request.id, ok: true, result: dispatch(host, request) as UnparsedWireValue };
    } catch (error) {
      response = {
        id: request.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    port.postMessage(response);
  });
}
