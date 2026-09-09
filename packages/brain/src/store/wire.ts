import { type AgentId, isIdentifier, type SessionKey } from "@sidecar/runtime/vocabulary";
import { isRecord, isWireNumber, isWireString, type UnparsedWireValue } from "@sidecar/wire";
import {
  type AnyOperationParams,
  isStoreOperationName,
  type NoParams,
  STORE_LIFECYCLE,
  type StoreOpenOptions,
  type StoreOperationName,
} from "./store-operations.js";

/**
 * What crosses between the store's client on the main thread and the worker
 * that owns the database: one request at a time per id, each answered once.
 * Every value is structured-cloneable; nothing here is a function or a
 * handle, so the same protocol runs over a `MessagePort` in tests and a
 * `Worker` in the app.
 */

/**
 * A request as either end holds it: an id, the name that selects what to do,
 * and the parameters that name declares. The two lifecycle names are the two
 * that are not operations — they make and unmake the store every operation
 * runs against — so they carry their own parameters here.
 */
export type StoreRequest =
  | { id: number; name: StoreOperationName; params: AnyOperationParams }
  | { id: number; name: typeof STORE_LIFECYCLE.OPEN; params: StoreOpenOptions }
  | { id: number; name: typeof STORE_LIFECYCLE.CLOSE; params: NoParams };

export type StoreResponse =
  | { id: number; ok: true; result: UnparsedWireValue }
  | { id: number; ok: false; error: string };

/** What travels on the channel in either direction: a structured-clone value, parsed on arrival. */
export type StoreMessage = StoreRequest | StoreResponse;

/** The two ends of a message channel as both sides use them: a `Worker`, a `MessagePort`, or a test double. */
export interface StorePort {
  postMessage(message: StoreMessage): void;
  on(event: "message", listener: (message: UnparsedWireValue) => void): void;
  on(event: "error", listener: (error: Error) => void): void;
  on(event: "exit", listener: (code: number) => void): void;
}

/**
 * Reads an answer off the channel. Both ends are Luke's own code on the same
 * machine, so what arrives is one of the two envelopes above; the read
 * establishes the envelope's shape and leaves the payload to the operation's
 * own types, which the sender chose.
 */
export function storeResponseFromWire(value: UnparsedWireValue): StoreResponse | undefined {
  if (!isRecord(value) || !isWireNumber(value.id)) return undefined;
  if (value.ok === true) return { id: value.id, ok: true, result: value.result };
  if (value.ok === false && isWireString(value.error)) {
    return { id: value.id, ok: false, error: value.error };
  }
  return undefined;
}

/**
 * The id an unreadable message still carries. A request whose payload the
 * read refuses is answered as a refusal rather than left waiting, because a
 * caller that named an id is owed an answer under it; a message that named
 * none can only be dropped.
 */
export function storeRequestIdFromWire(value: UnparsedWireValue): number | undefined {
  return isRecord(value) && isWireNumber(value.id) ? value.id : undefined;
}

/**
 * Reads a request off the channel. The envelope is the only thing to
 * establish: an id, and a name the operation table or the lifecycle holds.
 * The parameters belong to the name the read admitted, and the sender — this
 * build's own client — typed them against the same table.
 */
export function storeRequestFromWire(value: UnparsedWireValue): StoreRequest | undefined {
  if (!isRecord(value) || !isWireNumber(value.id)) return undefined;
  if (isStoreOperationName(value.name)) {
    // SAFETY: the name selects the operation whose parameters the sender typed.
    return { id: value.id, name: value.name, params: value.params as AnyOperationParams };
  }
  if (value.name === STORE_LIFECYCLE.CLOSE) {
    return { id: value.id, name: STORE_LIFECYCLE.CLOSE, params: {} };
  }
  if (value.name !== STORE_LIFECYCLE.OPEN) return undefined;
  const params = storeOpenOptionsFromWire(value.params);
  return params ? { id: value.id, name: STORE_LIFECYCLE.OPEN, params } : undefined;
}

/**
 * The open's parameters, read rather than assumed. They are the one payload
 * the worker acts on before any operation runs — they name the directory it
 * opens a database in — so the read is here rather than at a `SAFETY:`
 * comment's word.
 */
function storeOpenOptionsFromWire(value: UnparsedWireValue): StoreOpenOptions | undefined {
  if (!isRecord(value)) return undefined;
  const { agentRoot, workspaceDirectory, agentId, sessionKey, conversationName, now } = value;
  if (!isWireString(agentRoot) || !isWireString(conversationName)) return undefined;
  if (!isIdentifier(agentId) || !isIdentifier(sessionKey) || !isWireNumber(now)) return undefined;
  if (workspaceDirectory !== undefined && !isWireString(workspaceDirectory)) return undefined;
  // SAFETY: an identifier's brand is a compile-time tag, and the non-empty
  // string `isIdentifier` establishes is the whole of its runtime shape.
  return {
    agentRoot,
    ...(workspaceDirectory !== undefined ? { workspaceDirectory } : undefined),
    agentId: agentId as AgentId,
    sessionKey: sessionKey as SessionKey,
    conversationName,
    now,
  };
}
