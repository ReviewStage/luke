import assert from "node:assert/strict";
import { test } from "vitest";
import {
  GITHUB_INSTALL_STATUS,
  githubInstallLandingPath,
  githubInstallStatusFromWire,
} from "./github-install-wire.js";

test("the landing reads back the one status the service put on its address", () => {
  for (const status of Object.values(GITHUB_INSTALL_STATUS)) {
    const path = githubInstallLandingPath(status);
    const query = new URL(path, "https://luke.test").searchParams;
    assert.equal(githubInstallStatusFromWire(query.get("status")), status);
  }
});

test("a missing or unknown status cannot choose a card", () => {
  assert.equal(githubInstallStatusFromWire(null), undefined);
  assert.equal(githubInstallStatusFromWire("octocat"), undefined);
});
