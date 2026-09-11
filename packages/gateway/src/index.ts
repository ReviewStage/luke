/**
 * The Gateway: the one boundary every client reaches the runtime through.
 * The protocol is the vocabulary — versioned envelopes, a fixed method
 * table, typed errors — and everything beside it is what carries that
 * vocabulary: the handler shapes a host answers with, a client, the
 * in-process transport, and the node registry an operator's capabilities are
 * asked for through. Every name
 * in these modules is part of the contract, so the barrel is written as one
 * door per module rather than as a second list to forget a name in.
 *
 * Three things stand apart. `./websocket` is the socket binding, because it
 * reaches `ws` and `node:http` and a bundle that only wants the vocabulary
 * must not resolve them; `./server` is the host's server, because it composes
 * `@effect/rpc`'s runtime over the group `./rpc` derives; and `./testing` is
 * the transport that carries every envelope through text, which nothing that
 * ships composes. The handler vocabulary a host writes its table against
 * stays here, in `./methods`.
 */
export * from "./attachment.js";
export * from "./client.js";
export * from "./invocations.js";
export * from "./methods.js";
export * from "./nodes.js";
export * from "./protocol.js";
export * from "./shutdown.js";
export * from "./transport.js";
export * from "./wire.js";
