/**
 * local-agent-platform.test.ts -- what This Mac registers as a device: it takes a discard line and names the check that keeps a worktree holding unsaved work, whether it runs its agents directly or, sandboxed, each in a VM started through its launcher on the smolvm it fetched.
 */

import assert from "node:assert/strict";
import { DEVICE_CAPABILITY, DEVICE_ISOLATION } from "@luke/features/device-agent-wire";
import { afterEach, beforeEach, describe, it, vi } from "vitest";
import { localAgentPlatform } from "./local-agent-platform";

vi.mock("electron", () => ({ app: { isPackaged: true, getAppPath: () => "/app" } }));

const STATE_ROOT = "/Users/dev/Library/Application Support/Luke";

describe("what This Mac registers", () => {
  // Note that a packaged build's resources folder is Electron's own property of the process, which Node has none of.
  beforeEach(() => {
    Object.defineProperty(process, "resourcesPath", {
      value: "/Applications/Luke.app",
      configurable: true,
    });
  });
  afterEach(() => {
    Reflect.deleteProperty(process, "resourcesPath");
  });

  it("takes a discard line, and checks the worktree before one removes it, sandboxed or not", () => {
    const platform = localAgentPlatform({ packaged: true, stateRoot: STATE_ROOT });

    for (const each of [platform, platform.sandboxed]) {
      assert.deepEqual(each?.deviceCapabilities, [DEVICE_CAPABILITY.DISCARD]);
      assert.equal(typeof each?.unsavedWorkScript, "function");
    }
  });

  it("sandboxed, starts each runner in its VM through the launcher, on the smolvm fetched under Luke's state, and registers so", () => {
    const sandboxed = localAgentPlatform({ packaged: true, stateRoot: STATE_ROOT }).sandboxed;
    const runner = sandboxed?.launch({
      agentId: "agent-1",
      folder: "/Users/dev/.luke/agents/agent-1",
      checkout: "/Users/dev/.luke/agents/agent-1/repository",
      node: "node",
      bundle: "/Applications/Luke.app/agent-runner/agent-runner.mjs",
      env: {},
    });

    assert.equal(sandboxed?.deviceIsolation, DEVICE_ISOLATION.SANDBOX);
    assert.equal(runner?.command, "/Applications/Luke.app/luke-agent-launcher");
    assert.deepEqual(runner?.args.slice(0, 3), [
      `${STATE_ROOT}/agent-tools/smolvm/1.32.3/smolvm`,
      "machine",
      "exec",
    ]);
  });
});
