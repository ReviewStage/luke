import assert from "node:assert/strict";
import { test } from "vitest";
import { type RunningBuild, UPDATE_STATUS, type UpdateSnapshot } from "./update.js";
import { UPDATE_ROW_ACTION, updateInSidebar, updateRow } from "./update-row.js";

const RELEASE: RunningBuild = { packaged: true };

/** What `run.sh` launches: unpackaged, so no updater stands behind it. */
const UNINSTALLABLE_IDLE: UpdateSnapshot = {
  status: UPDATE_STATUS.IDLE,
  currentVersion: "0.11.0",
  installSupported: false,
  upToDate: false,
};

function supported(update: Partial<UpdateSnapshot> & Pick<UpdateSnapshot, "status">) {
  // SAFETY: every call site passes the fields its status's snapshot variant
  // requires; the assertion only spares each test restating the two constants.
  return { currentVersion: "0.1.0", installSupported: true, ...update } as UpdateSnapshot;
}

test("each state says where the build stands in a few words and offers its one next step, a failure in the failure's words", () => {
  const rows: [UpdateSnapshot, string, string, boolean][] = [
    [
      supported({ status: UPDATE_STATUS.IDLE, upToDate: false }),
      "Not checked yet",
      UPDATE_ROW_ACTION.CHECK,
      false,
    ],
    [
      supported({ status: UPDATE_STATUS.IDLE, upToDate: true }),
      "Up to date",
      UPDATE_ROW_ACTION.CHECK,
      false,
    ],
    [
      supported({ status: UPDATE_STATUS.IDLE, upToDate: false, unreachable: true }),
      "Couldn't reach GitHub",
      UPDATE_ROW_ACTION.RETRY,
      true,
    ],
    [
      supported({ status: UPDATE_STATUS.CHECKING }),
      "Checking for updates…",
      UPDATE_ROW_ACTION.CHECKING,
      false,
    ],
    [
      supported({ status: UPDATE_STATUS.READY, latestVersion: "0.2.0" }),
      "0.2.0 is ready to install",
      UPDATE_ROW_ACTION.RESTART,
      false,
    ],
    [
      supported({ status: UPDATE_STATUS.UPDATED, previousVersion: "0.0.9" }),
      "Updated from 0.0.9",
      UPDATE_ROW_ACTION.CHECK,
      false,
    ],
    [
      supported({ status: UPDATE_STATUS.ERROR, latestVersion: "0.2.0" }),
      "Couldn't install 0.2.0",
      UPDATE_ROW_ACTION.GET,
      true,
    ],
    [
      supported({ status: UPDATE_STATUS.ERROR }),
      "Couldn't check for updates",
      UPDATE_ROW_ACTION.RETRY,
      true,
    ],
    [
      { ...supported({ status: UPDATE_STATUS.IDLE, upToDate: false }), installSupported: false },
      "This copy can't update itself",
      UPDATE_ROW_ACTION.GET,
      false,
    ],
  ];
  for (const [update, detail, action, failed] of rows) {
    const row = updateRow(update, RELEASE);
    assert.deepEqual([row.detail, row.action, row.failed], [detail, action, failed]);
  }
});

test("a download under way names its version and how far along it is, with nothing to press", () => {
  const row = updateRow(
    supported({
      status: UPDATE_STATUS.DOWNLOADING,
      latestVersion: "0.2.0",
      progress: { percent: 41.7, transferredBytes: 41, totalBytes: 100 },
    }),
    RELEASE,
  );
  assert.equal(row.detail, "Downloading 0.2.0… 42%");
  assert.equal(row.action, UPDATE_ROW_ACTION.DOWNLOADING);
  assert.equal(row.progress, 41.7);

  const begun = updateRow(
    supported({ status: UPDATE_STATUS.DOWNLOADING, latestVersion: "0.2.0" }),
    RELEASE,
  );
  assert.equal(begun.detail, "Downloading 0.2.0…");
  assert.equal(begun.progress, 0, "a download not yet counted draws an empty bar");
});

test("the sidebar carries a release only while it has something to press: its restart, or the download once installing it failed", () => {
  const ready = supported({ status: UPDATE_STATUS.READY, latestVersion: "0.2.0" });
  assert.equal(updateInSidebar(ready), true);
  assert.equal(
    updateInSidebar(supported({ status: UPDATE_STATUS.ERROR, latestVersion: "0.2.0" })),
    true,
  );
  // Note that a download runs silently: nothing is pressed until it lands.
  assert.equal(
    updateInSidebar(supported({ status: UPDATE_STATUS.DOWNLOADING, latestVersion: "0.2.0" })),
    false,
  );
  assert.equal(updateInSidebar(supported({ status: UPDATE_STATUS.ERROR })), false);
  assert.equal(updateInSidebar(supported({ status: UPDATE_STATUS.IDLE, upToDate: true })), false);
  assert.equal(updateInSidebar({ ...ready, installSupported: false }), false);
});

test("a development build names its branch and commit and offers nothing to press", () => {
  const row = updateRow(UNINSTALLABLE_IDLE, {
    packaged: false,
    commit: { sha: "a1b2c3d", dirty: false, branch: "main" },
  });
  assert.equal(row.title, "Development build");
  assert.equal(row.detail, "main @ a1b2c3d");
  assert.equal(row.action, UPDATE_ROW_ACTION.NONE);
  assert.equal(row.current, false);
});

test("a development build cut from a dirty tree or a detached head says so, and one with no commit says it runs from source", () => {
  const dirty = updateRow(UNINSTALLABLE_IDLE, {
    packaged: false,
    commit: { sha: "a1b2c3d", dirty: true },
  });
  assert.equal(dirty.detail, "a1b2c3d-dirty");

  const unstamped = updateRow(UNINSTALLABLE_IDLE, { packaged: false });
  assert.equal(unstamped.title, "Development build");
  assert.equal(unstamped.detail, "Run from source.");
  assert.equal(unstamped.action, UPDATE_ROW_ACTION.NONE);
});

test("a release shows its version with its commit beside it, and its version alone when unstamped", () => {
  const live = supported({ status: UPDATE_STATUS.IDLE, upToDate: true });
  const stamped = updateRow(live, {
    packaged: true,
    commit: { sha: "a1b2c3d", dirty: false },
  });
  assert.equal(stamped.title, "Version 0.1.0 (a1b2c3d)");
  assert.equal(stamped.action, UPDATE_ROW_ACTION.CHECK);

  assert.equal(updateRow(live, RELEASE).title, "Version 0.1.0");
});

test("a packaged build that cannot install itself keeps the way to the releases page", () => {
  const row = updateRow(UNINSTALLABLE_IDLE, RELEASE);
  assert.equal(row.title, "Version 0.11.0");
  assert.equal(row.action, UPDATE_ROW_ACTION.GET);
  assert.equal(row.current, false);
});
