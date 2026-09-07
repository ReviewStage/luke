import path from "node:path";
import type { UnparsedWireValue } from "@sidecar/wire";
import { AGENT_DATABASE_FILE, type RuntimeDatabase } from "./database.js";
import {
  eraseRecovery,
  importLegacyState,
  type LegacyImportReport,
  pruneRecovery,
  RECOVERY_DIRECTORY_NAME,
} from "./legacy-import.js";
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
 * Opening is the one request that runs the legacy import, and it runs before
 * the answer goes back, so a client that has heard "open" knows the tables
 * already hold whatever the old files held.
 */
export interface RuntimeStoreHostOptions {
  openDatabase: (location: string) => RuntimeDatabase;
}

export function serveRuntimeStore(port: RuntimeStorePort, options: RuntimeStoreHostOptions): void {
  let database: RuntimeDatabase | undefined;
  let recoveryDirectory: string | undefined;

  const handle = <Method extends RuntimeStoreMethod>(
    request: RuntimeStoreRequest<Method>,
  ): RuntimeStoreMethods[Method]["result"] => {
    const method: RuntimeStoreMethod = request.method;
    switch (method) {
      case RUNTIME_STORE_METHOD.OPEN: {
        // SAFETY: the method name is what the request carries; its params are the ones that method declares.
        const params = request.params as RuntimeStoreMethods["open"]["params"];
        database?.close();
        database = options.openDatabase(path.join(params.agentRoot, AGENT_DATABASE_FILE));
        recoveryDirectory = path.join(params.agentRoot, RECOVERY_DIRECTORY_NAME);
        database.ensureConversation(
          params.agentId,
          params.sessionKey,
          params.conversationName,
          params.now,
        );
        if (params.legacy) {
          return importLegacyState({
            database,
            sessionKey: params.sessionKey,
            sources: params.legacy,
            recoveryDirectory,
            now: params.now,
          });
        }
        const failures: string[] = [];
        const report: LegacyImportReport = {
          retired: [],
          expiredRecoveries: pruneRecovery(recoveryDirectory, params.now, failures),
          failures,
        };
        return report;
      }
      case RUNTIME_STORE_METHOD.BRAIN_LOAD: {
        // SAFETY: the method name is what the request carries; its params are the ones that method declares.
        const params = request.params as RuntimeStoreMethods["brain.load"]["params"];
        return opened().loadBrainState(params.sessionKey);
      }
      case RUNTIME_STORE_METHOD.BRAIN_SAVE: {
        // SAFETY: the method name is what the request carries; its params are the ones that method declares.
        const params = request.params as RuntimeStoreMethods["brain.save"]["params"];
        return opened().saveBrainState(params.sessionKey, params.save);
      }
      case RUNTIME_STORE_METHOD.HISTORY_APPEND: {
        // SAFETY: the method name is what the request carries; its params are the ones that method declares.
        const params = request.params as RuntimeStoreMethods["history.append"]["params"];
        return opened().appendHistory(params.sessionKey, params.entries, params.now);
      }
      case RUNTIME_STORE_METHOD.HISTORY_LIST: {
        // SAFETY: the method name is what the request carries; its params are the ones that method declares.
        const params = request.params as RuntimeStoreMethods["history.list"]["params"];
        return opened().listHistory(params.sessionKey, params.now);
      }
      case RUNTIME_STORE_METHOD.HISTORY_CLEAR: {
        // SAFETY: the method name is what the request carries; its params are the ones that method declares.
        const params = request.params as RuntimeStoreMethods["history.clear"]["params"];
        opened().clearHistoryAtOrBefore(params.sessionKey, params.clearedAt);
        return true;
      }
      case RUNTIME_STORE_METHOD.HISTORY_CUTOFF: {
        // SAFETY: the method name is what the request carries; its params are the ones that method declares.
        const params = request.params as RuntimeStoreMethods["history.cutoff"]["params"];
        return opened().clearedAt(params.sessionKey);
      }
      case RUNTIME_STORE_METHOD.RECOVERY_ERASE:
        return recoveryDirectory === undefined ? true : eraseRecovery(recoveryDirectory);
      case RUNTIME_STORE_METHOD.FACTS_LIST:
        return opened().personalFacts();
      case RUNTIME_STORE_METHOD.FACTS_REPLACE: {
        // SAFETY: the method name is what the request carries; its params are the ones that method declares.
        const params = request.params as RuntimeStoreMethods["facts.replace"]["params"];
        return opened().replacePersonalFacts(params.facts);
      }
      case RUNTIME_STORE_METHOD.CLOSE:
        database?.close();
        database = undefined;
        return true;
    }
  };

  const opened = (): RuntimeDatabase => {
    if (!database) throw new Error("runtime store is not open");
    return database;
  };

  port.on("message", (message) => {
    const request = runtimeStoreRequestFromWire(message);
    if (!request) return;
    let response: RuntimeStoreResponse;
    try {
      // SAFETY: a method's result is the structured-clone value its declared type describes.
      response = { id: request.id, ok: true, result: handle(request) as UnparsedWireValue };
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
