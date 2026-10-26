import assert from "node:assert/strict";
import { DEVICE_CAPABILITY } from "@luke/features/device-agent-wire";
import { afterEach, beforeEach, describe, it, vi } from "vitest";
import { localAgentPlatform } from "./local-agent-platform";

vi.mock("electron", () => ({ app: { isPackaged: true, getAppPath: () => "/app" } }));

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

  it("takes a discard line, and checks the worktree before one removes it", () => {
    const platform = localAgentPlatform(true);

    assert.deepEqual(platform.deviceCapabilities, [DEVICE_CAPABILITY.DISCARD]);
    assert.equal(typeof platform.unsavedWorkScript, "function");
  });
});
