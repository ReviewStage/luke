import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { agentId } from "@sidecar/runtime-contracts";
import { agentRootPath, runtimeStoreWorkerPath } from "./store-path.js";

test("the agent's root is its own directory under the application data", () => {
  assert.equal(agentRootPath("/data"), path.join("/data", "agents", "main"));
  assert.equal(agentRootPath("/data", agentId("other")), path.join("/data", "agents", "other"));
});

test("the worker is found beside the bundle, and outside the archive in a packaged app", () => {
  assert.equal(
    runtimeStoreWorkerPath(path.join("/repo", "apps", "desktop", "dist")),
    path.join("/repo", "apps", "desktop", "dist", "runtime-store-worker.js"),
  );
  assert.equal(
    runtimeStoreWorkerPath(
      path.join("/Applications", "Luke.app", "Contents", "Resources", "app.asar", "dist"),
    ),
    path.join(
      "/Applications",
      "Luke.app",
      "Contents",
      "Resources",
      "app.asar.unpacked",
      "dist",
      "runtime-store-worker.js",
    ),
  );
});
