import type { UnparsedWireValue } from "@sidecar/wire";
import {
  type OpenStore,
  openStore,
  STORE_LIFECYCLE,
  STORE_OPERATIONS,
  type StoreOpenOptions,
} from "./store-operations.js";
import {
  type StorePort,
  type StoreRequest,
  type StoreResponse,
  storeRequestFromWire,
} from "./wire.js";

/**
 * The database's side of the channel. It answers requests one at a time in
 * the order they arrive — the database is synchronous, so there is nothing
 * to interleave — and never lets an exception cross the channel as anything
 * but an error answer with the request's id, so a caller always hears back.
 */
export function serveStore(port: StorePort): void {
  let open: OpenStore | undefined;

  const answer = (request: StoreRequest): unknown => {
    if (request.name === STORE_LIFECYCLE.OPEN) {
      open?.db.close();
      // SAFETY: the open's parameters are the ones its own client method typed.
      open = openStore(request.params as StoreOpenOptions);
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
      params: unknown,
    ) => unknown;
    return operation(open, request.params);
  };

  port.on("message", (message) => {
    const request = storeRequestFromWire(message);
    if (!request) return;
    let response: StoreResponse;
    try {
      // SAFETY: an operation's result is the structured-clone value its declared type describes.
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
