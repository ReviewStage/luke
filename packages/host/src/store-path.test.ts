import assert from "node:assert/strict";
import path from "node:path";
import { agentId } from "@sidecar/runtime/vocabulary";
import { test } from "vitest";
import { agentRootPath, storeWorkerPath } from "./store-path.js";

test("the agent's root is its own directory under the application data", () => {
  assert.equal(agentRootPath("/data"), path.join("/data", "agents", "main"));
  assert.equal(agentRootPath("/data", agentId("other")), path.join("/data", "agents", "other"));
});

test("the worker is found beside the bundle, and outside the archive in a packaged app", () => {
  assert.equal(
    storeWorkerPath(path.join("/repo", "apps", "desktop", "dist")),
    path.join("/repo", "apps", "desktop", "dist", "store-worker.js"),
  );
  assert.equal(
    storeWorkerPath(
      path.join("/Applications", "Luke.app", "Contents", "Resources", "app.asar", "dist"),
    ),
    path.join(
      "/Applications",
      "Luke.app",
      "Contents",
      "Resources",
      "app.asar.unpacked",
      "dist",
      "store-worker.js",
    ),
  );
});
