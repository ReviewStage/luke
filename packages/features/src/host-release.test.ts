/**
 * host-release.test.ts -- the host's rename by release: a release through 0.6.0 is fetched as `luke-host-…` and one from 0.7.0 on as `vespin-host-…`, published again under the old name, and the uninstall command a host is shown names the link its release made.
 *
 * The expected names are the ones the releases on GitHub carry and the links
 * the account install made: `host-v0.6.0` publishes `luke-host-0.6.0-…`
 * alone, and an install of it links `~/.local/bin/luke-host`.
 */

import { describe, expect, it } from "@effect/vitest";
import { HOST_TARGET, hostTarballNames, hostTarballUrl } from "./host-release.js";
import { hostUninstallCommand } from "./host-wire.js";

describe("the host's rename by release", () => {
  it.each([
    {
      version: "0.6.0",
      url: "https://github.com/ReviewStage/vespin/releases/download/host-v0.6.0/luke-host-0.6.0-linux-x64.tar.gz",
      published: ["luke-host-0.6.0-linux-x64.tar.gz"],
      uninstall: "~/.local/bin/luke-host uninstall",
    },
    {
      version: "0.7.0",
      url: "https://github.com/ReviewStage/vespin/releases/download/host-v0.7.0/vespin-host-0.7.0-linux-x64.tar.gz",
      published: ["vespin-host-0.7.0-linux-x64.tar.gz", "luke-host-0.7.0-linux-x64.tar.gz"],
      uninstall: "~/.local/bin/vespin-host uninstall",
    },
  ])(
    "fetches $version by $published.0, publishes it under every name a host fetches it by, and names its uninstall by its link",
    ({ version, url, published, uninstall }) => {
      expect(hostTarballUrl(version, HOST_TARGET.LINUX_X64)).toBe(url);
      expect(hostTarballNames(version, HOST_TARGET.LINUX_X64)).toEqual(published);
      expect(hostUninstallCommand(version)).toBe(uninstall);
    },
  );
});
