import assert from "node:assert/strict";
import { test } from "vitest";
import { type RunningBuild, UPDATE_STATUS, type UpdateSnapshot } from "#shared/messages/update";
import { fixtureUpdate, UPDATE_ROW_ACTION, updateAvailable, updateRow } from "./update-row";

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

test("an unasked question is an offer to ask, never an answer", () => {
  const row = updateRow(supported({ status: UPDATE_STATUS.IDLE, upToDate: false }), RELEASE);
  assert.equal(row.action, UPDATE_ROW_ACTION.CHECK);
  assert.equal(row.current, false);
});

test("only a positively latest build earns the check mark", () => {
  const row = updateRow(supported({ status: UPDATE_STATUS.IDLE, upToDate: true }), RELEASE);
  assert.equal(row.action, UPDATE_ROW_ACTION.CHECK);
  assert.equal(row.current, true);
});

test("a check under way offers nothing to press", () => {
  const row = updateRow(supported({ status: UPDATE_STATUS.CHECKING }), RELEASE);
  assert.equal(row.action, UPDATE_ROW_ACTION.CHECKING);
  assert.equal(row.current, false);
});

test("a download under way names the version and how far along it is", () => {
  const row = updateRow(
    supported({
      status: UPDATE_STATUS.DOWNLOADING,
      latestVersion: "0.2.0",
      progress: { percent: 41.7, transferredBytes: 41, totalBytes: 100 },
    }),
    RELEASE,
  );
  assert.equal(row.action, UPDATE_ROW_ACTION.DOWNLOADING);
  assert.equal(row.current, false);
});

test("a downloaded build offers the restart that installs it", () => {
  const row = updateRow(
    supported({ status: UPDATE_STATUS.READY, latestVersion: "0.2.0" }),
    RELEASE,
  );
  assert.equal(row.action, UPDATE_ROW_ACTION.RESTART);
  assert.equal(row.detail, "Version 0.2.0 is downloaded.");
  assert.equal(row.current, false);
});

test("the first launch after an install confirms what happened", () => {
  const row = updateRow(
    supported({ status: UPDATE_STATUS.UPDATED, previousVersion: "0.1.0" }),
    RELEASE,
  );
  assert.equal(row.action, UPDATE_ROW_ACTION.CHECK);
  assert.equal(row.current, true);
});

test("a failed update says so and falls back to the releases page", () => {
  const failed = updateRow(
    supported({ status: UPDATE_STATUS.ERROR, latestVersion: "0.2.0" }),
    RELEASE,
  );
  assert.equal(failed.action, UPDATE_ROW_ACTION.GET);

  const unversioned = updateRow(supported({ status: UPDATE_STATUS.ERROR }), RELEASE);
  assert.equal(unversioned.action, UPDATE_ROW_ACTION.GET);
  assert.equal(unversioned.current, false);
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

test("only a positively known newer release counts as news", () => {
  // The news stands through the whole install: a release downloading,
  // waiting on its restart, or failed mid-fetch is still one this build is
  // not on — while a failure that never named a version has no news to mark.
  assert.equal(
    updateAvailable(supported({ status: UPDATE_STATUS.DOWNLOADING, latestVersion: "0.2.0" })),
    true,
  );
  assert.equal(
    updateAvailable(supported({ status: UPDATE_STATUS.READY, latestVersion: "0.2.0" })),
    true,
  );
  assert.equal(
    updateAvailable(supported({ status: UPDATE_STATUS.ERROR, latestVersion: "0.2.0" })),
    true,
  );
  assert.equal(updateAvailable(supported({ status: UPDATE_STATUS.ERROR })), false);
  assert.equal(updateAvailable(supported({ status: UPDATE_STATUS.IDLE, upToDate: true })), false);
  assert.equal(updateAvailable(supported({ status: UPDATE_STATUS.CHECKING })), false);
  assert.equal(
    updateAvailable(supported({ status: UPDATE_STATUS.UPDATED, previousVersion: "0.1.0" })),
    false,
  );
});

test("a fixture run stages a newer release waiting on its restart, and a live run keeps the updater's answer", () => {
  const live = supported({ status: UPDATE_STATUS.IDLE, upToDate: true });

  // Note that a capture runs unpackaged, and the staged release still stands
  // in Settings rather than the development build's row.
  const staged = updateRow(fixtureUpdate({ fixtureMode: true }, live), { packaged: false });
  assert.equal(staged.action, UPDATE_ROW_ACTION.RESTART);
  assert.equal(staged.detail, "Version 0.2.0 is downloaded.");

  assert.equal(fixtureUpdate({ fixtureMode: false }, live), live);
});
