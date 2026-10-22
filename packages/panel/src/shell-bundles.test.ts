import assert from "node:assert/strict";
import { test } from "vitest";
import { installShellBundles, type ShellBundles, shellBundles } from "./shell-bundles.js";

/** Bundles no test loads: the door is what is under test, not a bundle behind it. */
const BUNDLES: ShellBundles = {
  avatarSession: () => Promise.reject(new Error("No avatar session here.")),
};

test("an older install taken down after a newer one of the same bundles leaves the newer standing, and the newer's own undo takes them down", () => {
  const undoOlder = installShellBundles(BUNDLES);
  const undoNewer = installShellBundles(BUNDLES);

  undoOlder();
  assert.equal(shellBundles(), BUNDLES);

  undoNewer();
  assert.throws(() => shellBundles(), /No shell bundles are installed/u);
});
