import path from "node:path";
import type { UnparsedWireValue } from "@sidecar/wire";
import { loadBrainEnvelope, saveBrainEnvelope } from "./brain-envelope.js";
import { AGENT_DATABASE_FILE, RuntimeDatabase } from "./database.js";
import { personalFacts, replacePersonalFacts } from "./facts-table.js";
import {
  appendHistory,
  clearHistoryAtOrBefore,
  historyClearedAt,
  listHistory,
} from "./history-table.js";
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

/** What a handler runs against: the database once opened, and the open and close of it. */
interface RuntimeStoreHost {
  opened(): RuntimeDatabase;
  open(location: string): void;
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
    host.open(path.join(params.agentRoot, AGENT_DATABASE_FILE));
    host
      .opened()
      .ensureConversation(params.agentId, params.sessionKey, params.conversationName, params.now);
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
  [RUNTIME_STORE_METHOD.HISTORY_CLEAR]: (host, params) => {
    clearHistoryAtOrBefore(host.opened(), params.sessionKey, params.clearedAt);
    return true;
  },
  [RUNTIME_STORE_METHOD.HISTORY_CUTOFF]: (host, params) =>
    historyClearedAt(host.opened(), params.sessionKey),
  [RUNTIME_STORE_METHOD.FACTS_LIST]: (host) => personalFacts(host.opened()),
  [RUNTIME_STORE_METHOD.FACTS_REPLACE]: (host, params) =>
    replacePersonalFacts(host.opened(), params.facts),
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
  const host: RuntimeStoreHost = {
    opened: () => {
      if (!database) throw new Error("runtime store is not open");
      return database;
    },
    open: (location) => {
      database?.close();
      database = RuntimeDatabase.open(location);
    },
    close: () => {
      database?.close();
      database = undefined;
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
