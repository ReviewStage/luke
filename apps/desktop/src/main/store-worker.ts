import { NodeRuntime, NodeWorkerRunner } from "@effect/platform-node";
import { storeWorkerLayer } from "@sidecar/brain/store";
import { Layer } from "effect";

/**
 * The brain store's worker thread, bundled on its own beside the main
 * bundle. Every synchronous SQLite call happens here; the main thread only
 * posts requests to it. This file is the store's runtime edge: the one
 * place its effects are run: the runner layer is launched — built and then
 * held open for as long as the thread lives — over the worker-runner
 * protocol `NodeWorkerRunner.layer` speaks on this thread's own message port.
 */
NodeRuntime.runMain(Layer.launch(storeWorkerLayer.pipe(Layer.provide(NodeWorkerRunner.layer))));
