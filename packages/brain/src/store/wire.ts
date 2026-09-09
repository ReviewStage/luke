import { isRecord, isWireNumber, isWireString, type UnparsedWireValue } from "@sidecar/wire";
import {
  isStoreLifecycleName,
  isStoreOperationName,
  type StoreLifecycleName,
  type StoreOperationName,
} from "./store-operations.js";

/**
 * What crosses between the store's client on the main thread and the worker
 * that owns the database: one request at a time per id, each answered once.
 * Every value is structured-cloneable; nothing here is a function or a
 * handle, so the same protocol runs over a `MessagePort` in tests and a
 * `Worker` in the app.
 */

export interface StoreRequest {
  id: number;
  name: StoreOperationName | StoreLifecycleName;
  /** The operation's own parameters, which the sender typed against the table. */
  params: unknown;
}

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
 * Reads a request off the channel. The envelope is the only thing to
 * establish: an id, and a name the operation table or the lifecycle holds.
 * The parameters belong to the operation the name selects, and the sender —
 * this build's own client — chose them.
 */
export function storeRequestFromWire(value: UnparsedWireValue): StoreRequest | undefined {
  if (!isRecord(value) || !isWireNumber(value.id)) return undefined;
  if (!isStoreOperationName(value.name) && !isStoreLifecycleName(value.name)) return undefined;
  return { id: value.id, name: value.name, params: value.params };
}
