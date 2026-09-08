import path from "node:path";
import type { UnparsedWireValue } from "@sidecar/wire";
import { deleteConversationHistory, listArchives, restoreArchive } from "./archives.js";
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
import { personalFacts, replacePersonalFacts } from "./facts-table.js";
import { appendHistory, historyClearedAt, listHistory } from "./history-table.js";
import { deleteScheduledJob, listScheduledJobs, putScheduledJob } from "./jobs-table.js";
import { runHistoryMaintenance } from "./maintenance-run.js";
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
  open(agentRoot: string): void;
  close(): void;
}

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
    host.open(params.agentRoot);
    createConversation(host.opened(), {
      agentId: params.agentId,
      sessionKey: params.sessionKey,
      name: params.conversationName,
      now: params.now,
    });
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
  [RUNTIME_STORE_METHOD.FACTS_LIST]: (host) => personalFacts(host.opened()),
  [RUNTIME_STORE_METHOD.FACTS_REPLACE]: (host, params) =>
    replacePersonalFacts(host.opened(), params.facts),
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
  [RUNTIME_STORE_METHOD.ARCHIVES_LIST]: (host) => listArchives(host.opened()),
  [RUNTIME_STORE_METHOD.ARCHIVE_RESTORE]: (host, params) =>
    restoreArchive(host.opened(), host.agentRoot(), params.archiveId, params.agentId, params.now),
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
  const host: RuntimeStoreHost = {
    opened: () => {
      if (!database) throw new Error("runtime store is not open");
      return database;
    },
    agentRoot: () => {
      if (root === undefined) throw new Error("runtime store is not open");
      return root;
    },
    open: (agentRoot) => {
      database?.close();
      root = agentRoot;
      database = RuntimeDatabase.open(path.join(agentRoot, AGENT_DATABASE_FILE));
    },
    close: () => {
      database?.close();
      database = undefined;
      root = undefined;
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
