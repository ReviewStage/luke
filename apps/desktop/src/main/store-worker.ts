import { NodeRuntime, NodeWorkerRunner } from "@effect/platform-node";
import { storeWorkerLayer } from "@sidecar/brain/store";
import { Layer } from "effect";

/**
 * The brain store's worker thread, bundled on its own beside the main
 * bundle. Every synchronous SQLite call happens here; the main thread only
 * posts requests to it. This file is the store's runtime edge: the one
 * place its effects are run, over the worker-runner protocol
 * `NodeWorkerRunner.launch` provides on this thread's own message port.
 */
NodeRuntime.runMain(
  NodeWorkerRunner.launch(storeWorkerLayer.pipe(Layer.provide(NodeWorkerRunner.layer))),
);
