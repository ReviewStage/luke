/**
 * The Gateway: the one boundary every client reaches the runtime through.
 * The protocol is the vocabulary — versioned envelopes, a fixed method
 * table, typed errors — and everything beside it is what carries that
 * vocabulary: the host's server, a client, the in-process transport, and the
 * node registry an operator's capabilities are asked for through. Every name
 * in these modules is part of the contract, so the barrel is written as one
 * door per module rather than as a second list to forget a name in.
 *
 * Two things stand apart. `./websocket` is the socket binding, because it
 * reaches `ws` and `node:http` and a bundle that only wants the vocabulary
 * must not resolve them, and `./testing` is the transport that carries every
 * envelope through text, which nothing that ships composes.
 */
export * from "./attachment.js";
export * from "./client.js";
export * from "./invocations.js";
export * from "./nodes.js";
export * from "./protocol.js";
export * from "./server.js";
export * from "./shutdown.js";
export * from "./transport.js";
export * from "./wire.js";
