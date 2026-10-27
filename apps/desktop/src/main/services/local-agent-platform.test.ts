/**
 * local-agent-platform.test.ts -- what This Mac registers as a device: its name, the Computer Name before a generated host name; it takes a discard line and names the check that keeps a worktree holding unsaved work, and runs each agent in a VM started through its launcher on the smolvm it fetched.
 */

import assert from "node:assert/strict";
import childProcess from "node:child_process";
import os from "node:os";
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
    vi.restoreAllMocks();
  });

  it.each([
    { computerName: "Charles's MacBook Pro\n", named: "Charles's MacBook Pro" },
    { computerName: undefined, named: "Mac-1898" },
  ])(
    "is named by the Mac's Computer Name, else its host name ($named)",
    ({ computerName, named }) => {
      // Note that the host name is one the network generated, which the member never chose.
      vi.spyOn(os, "hostname").mockReturnValue("Mac-1898.local");
      vi.spyOn(childProcess, "execFileSync").mockImplementation(() => {
        if (computerName === undefined) throw new Error("scutil: ComputerName: not set");
        return computerName;
      });

      assert.equal(localAgentPlatform({ packaged: true, stateRoot: STATE_ROOT }).deviceName, named);
    },
  );

  it("takes a discard line, and checks the worktree before one removes it", () => {
    const platform = localAgentPlatform({ packaged: true, stateRoot: STATE_ROOT });

    assert.deepEqual(platform.deviceCapabilities, [DEVICE_CAPABILITY.DISCARD]);
    assert.equal(typeof platform.unsavedWorkScript, "function");
  });

  it("starts each runner in its VM through the launcher, on the smolvm fetched under Luke's state, and registers so", () => {
    const platform = localAgentPlatform({ packaged: true, stateRoot: STATE_ROOT });
    const runner = platform.launch({
      agentId: "agent-1",
      folder: "/Users/dev/.luke/agents/agent-1",
      checkout: "/Users/dev/.luke/agents/agent-1/repository",
      node: "node",
      bundle: "/Applications/Luke.app/agent-runner/agent-runner.mjs",
      env: {},
    });

    assert.equal(platform.deviceIsolation, DEVICE_ISOLATION.SANDBOX);
    assert.equal(runner.command, "/Applications/Luke.app/luke-agent-launcher");
    assert.deepEqual(runner.args.slice(0, 3), [
      `${STATE_ROOT}/agent-tools/smolvm/1.32.3/smolvm`,
      "machine",
      "exec",
    ]);
  });
});
