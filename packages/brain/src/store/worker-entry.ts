import { NodeRuntime, NodeWorkerRunner } from "@effect/platform-node";
import { Layer } from "effect";
import { storeWorkerLayer } from "./worker-host.js";

/**
 * The dedicated database worker, and the store's runtime edge: the one place
 * the store's effects are run. Everything synchronous about SQLite happens
 * on this thread and nowhere else; the main thread only ever sends a request
 * and awaits its answer. The launch stands until the parent tells the
 * runner to end, and a failure to stand up at all ends the thread with a
 * non-zero code, which the parent's client reads as the worker gone.
 */
NodeRuntime.runMain(
  NodeWorkerRunner.launch(storeWorkerLayer.pipe(Layer.provide(NodeWorkerRunner.layer))),
);
