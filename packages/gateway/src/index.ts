/**
 * index.ts -- the Gateway: the one boundary the desktop reaches the host
 * through. The protocol is the vocabulary (a fixed method table, event kinds,
 * typed refusals, the shapes the desktop reads), and beside it is what
 * carries that vocabulary in one process: the handler shapes a host answers
 * with, the dispatcher over a folded method table, and the node registry an
 * operator's capabilities are asked for through. The barrel is one door per
 * module rather than a second list to forget a name in.
 */
export * from "./host.js";
export * from "./methods.js";
export * from "./nodes.js";
export * from "./protocol.js";
export * from "./shutdown.js";
export * from "./wire.js";
