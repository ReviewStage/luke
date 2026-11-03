/**
 * host-wire.test.ts -- the uninstall command a host's Remove names, by the link its release made: `~/.local/bin/luke-host` through 0.6.0, and `~/.local/bin/vespin-host` from 0.7.0 on.
 *
 * The expected links are the ones the account install made: an install of
 * `host-v0.6.0` links `~/.local/bin/luke-host`, and a 0.7.0 daemon links
 * `~/.local/bin/vespin-host` once it moved its service over.
 */

import { describe, expect, it } from "@effect/vitest";
import { hostUninstallCommand } from "./host-wire.js";

describe("the uninstall command a host's Remove names", () => {
  it.each([
    { version: "0.6.0", command: "~/.local/bin/luke-host uninstall" },
    { version: "0.7.0", command: "~/.local/bin/vespin-host uninstall" },
  ])("names $command for a host on $version", ({ version, command }) => {
    expect(hostUninstallCommand(version)).toBe(command);
  });
});
