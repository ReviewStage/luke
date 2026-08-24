import assert from "node:assert/strict";
import test from "node:test";
import { boundedInvocation, INVOCATION_FAILURE, invocationPath } from "./invocation.js";

test("arguments are passed directly without shell interpretation", async () => {
  const marker = "$(printf should-not-run)";
  const result = await boundedInvocation({
    binary: process.execPath,
    arguments: ["-e", "process.stdout.write(process.argv[1])", marker],
    timeoutMs: 2_000,
    maximumOutputBytes: 1024,
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, marker);
});

test("a non-zero exit is a bounded answer", async () => {
  const result = await boundedInvocation({
    binary: process.execPath,
    arguments: ["-e", "process.stderr.write('no'); process.exit(7)"],
    timeoutMs: 2_000,
    maximumOutputBytes: 1024,
  });
  assert.deepEqual(result, { exitCode: 7, stdout: "", stderr: "no" });
});

test("an absent binary is a typed unavailable failure", async () => {
  await assert.rejects(
    boundedInvocation({
      binary: "/definitely/not/a/binary",
      arguments: [],
      timeoutMs: 2_000,
      maximumOutputBytes: 1024,
    }),
    { name: "InvocationError", failure: INVOCATION_FAILURE.UNAVAILABLE },
  );
});

test("PATH augmentation preserves inherited entries and removes duplicates", () => {
  const inherited = [...new Set((process.env.PATH ?? "").split(":").filter(Boolean))];
  const added = "/a/sidecar-test-bin";
  const entries = invocationPath([added, added]).split(":");
  assert.deepEqual(entries.slice(0, inherited.length), inherited);
  assert.equal(entries.filter((entry) => entry === added).length, 1);
});
