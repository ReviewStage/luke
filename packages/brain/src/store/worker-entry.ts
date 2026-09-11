import { NodeRuntime, NodeWorkerRunner } from "@effect/platform-node";
import { Layer } from "effect";
import { storeWorkerLayer } from "./worker-host.js";

/**
 * The store's own worker-thread launch, spawned directly by
 * `store-client.test.ts` so the client is exercised against a real worker
 * thread rather than the in-process transport. Production's own runtime
 * edge is `apps/desktop/src/main/store-worker.ts`, which runs the same
 * `storeWorkerLayer`; this file is not reached from there and carries no
 * production export.
 */
NodeRuntime.runMain(
  NodeWorkerRunner.launch(storeWorkerLayer.pipe(Layer.provide(NodeWorkerRunner.layer))),
);
