import { parentPort } from "node:worker_threads";
import { serveStore } from "./worker-host.js";

/**
 * The dedicated database worker. Everything synchronous about SQLite happens
 * on this thread and nowhere else; the main thread only ever posts a request
 * and awaits its answer.
 */
if (!parentPort) throw new Error("the brain's store worker must be started as a worker thread");
serveStore(parentPort);
