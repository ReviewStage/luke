import assert from "node:assert/strict";
import { test } from "vitest";
import { agentTraceDirectoryFromEnvironment } from "./trace-directory.js";

test("an environment naming LUKE_TRACE_DIR answers that directory", () => {
  assert.equal(
    agentTraceDirectoryFromEnvironment({ LUKE_TRACE_DIR: "/tmp/luke-trace", PATH: "/bin" }),
    "/tmp/luke-trace",
  );
});

test("an environment with no LUKE_TRACE_DIR answers undefined, never a default", () => {
  assert.equal(agentTraceDirectoryFromEnvironment({ PATH: "/bin" }), undefined);
  assert.equal(agentTraceDirectoryFromEnvironment({}), undefined);
});

test("an environment variable present but undefined is absent, not empty", () => {
  assert.equal(
    agentTraceDirectoryFromEnvironment({ LUKE_TRACE_DIR: undefined, PATH: "/bin" }),
    undefined,
  );
});
