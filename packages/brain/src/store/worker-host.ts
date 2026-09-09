import type { UnparsedWireValue } from "@sidecar/wire";
import {
  type AnyOperationParams,
  type OpenStore,
  openStore,
  STORE_LIFECYCLE,
  STORE_OPERATIONS,
  type StoreAnswer,
} from "./store-operations.js";
import {
  type StorePort,
  type StoreRequest,
  type StoreResponse,
  storeRequestFromWire,
  storeRequestIdFromWire,
} from "./wire.js";

/** What a request whose envelope this build cannot read is answered with. */
export const UNREADABLE_REQUEST = "the request could not be read";

/**
 * The database's side of the channel. It answers requests one at a time in
 * the order they arrive — the database is synchronous, so there is nothing
 * to interleave — and never lets an exception cross the channel as anything
 * but an error answer with the request's id, so a caller always hears back.
 * A message whose payload the read refuses is answered the same way, under
 * the id it named; only a message that named no id at all is dropped, since
 * there is nothing to answer it under.
 */
export function serveStore(port: StorePort): void {
  let open: OpenStore | undefined;

  const answer = (request: StoreRequest): StoreAnswer => {
    if (request.name === STORE_LIFECYCLE.OPEN) {
      // The old store is let go before the new one is opened, so an open that
      // throws leaves the worker honestly closed rather than holding a handle
      // to a database it already closed.
      open?.db.close();
      open = undefined;
      open = openStore(request.params);
      return true;
    }
    if (request.name === STORE_LIFECYCLE.CLOSE) {
      open?.db.close();
      open = undefined;
      return true;
    }
    if (!open) throw new Error("the brain's store is not open");
    // SAFETY: the name selects the operation, and the sender is the same build's
    // client, which typed the parameters that name declares. This is the one
    // place the correlation TypeScript cannot express through an index is
    // narrowed by hand, and it is narrowed once rather than per operation.
    const operation = STORE_OPERATIONS[request.name] as (
      store: OpenStore,
      params: AnyOperationParams,
    ) => StoreAnswer;
    return operation(open, request.params);
  };

  port.on("message", (message) => {
    const request = storeRequestFromWire(message);
    if (!request) {
      const id = storeRequestIdFromWire(message);
      if (id !== undefined) port.postMessage({ id, ok: false, error: UNREADABLE_REQUEST });
      return;
    }
    let response: StoreResponse;
    try {
      // SAFETY: an operation's answer is the structured-clone value its declared type describes.
      response = { id: request.id, ok: true, result: answer(request) as UnparsedWireValue };
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
