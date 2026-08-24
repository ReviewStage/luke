import assert from "node:assert/strict";
import test from "node:test";
import { UPDATE_STATUS, type UpdateSnapshot } from "#shared/wire/update";
import { UPDATE_ROW_ACTION, updateAvailable, updateRow } from "./update-row";

function supported(update: Partial<UpdateSnapshot> & Pick<UpdateSnapshot, "status">) {
  // SAFETY: every call site passes the fields its status's snapshot variant
  // requires; the assertion only spares each test restating the two constants.
  return { currentVersion: "0.1.0", installSupported: true, ...update } as UpdateSnapshot;
}

test("an unasked question is an offer to ask, never an answer", () => {
  const row = updateRow(supported({ status: UPDATE_STATUS.IDLE, upToDate: false }));
  assert.equal(row.action, UPDATE_ROW_ACTION.CHECK);
  assert.equal(row.current, false);
});

test("only a positively latest build earns the check mark", () => {
  const row = updateRow(supported({ status: UPDATE_STATUS.IDLE, upToDate: true }));
  assert.equal(row.action, UPDATE_ROW_ACTION.CHECK);
  assert.equal(row.current, true);
});

test("a check under way offers nothing to press", () => {
  const row = updateRow(supported({ status: UPDATE_STATUS.CHECKING }));
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
  );
  assert.equal(row.action, UPDATE_ROW_ACTION.DOWNLOADING);
  assert.ok(row.detail.includes("0.2.0"), "the version being fetched is said on the row");
  assert.ok(row.detail.includes("42%"), "progress is said in whole percent");
  assert.equal(row.current, false);

  const silent = updateRow(
    supported({ status: UPDATE_STATUS.DOWNLOADING, latestVersion: "0.2.0" }),
  );
  assert.ok(!silent.detail.includes("%"), "no invented progress before the first report");
});

test("a downloaded build offers the restart that installs it", () => {
  const row = updateRow(supported({ status: UPDATE_STATUS.READY, latestVersion: "0.2.0" }));
  assert.equal(row.action, UPDATE_ROW_ACTION.RESTART);
  assert.equal(row.detail, "Version 0.2.0 is downloaded.");
  assert.equal(row.current, false);
});

test("the first launch after an install confirms what happened", () => {
  const row = updateRow(supported({ status: UPDATE_STATUS.UPDATED, previousVersion: "0.1.0" }));
  assert.equal(row.action, UPDATE_ROW_ACTION.CHECK);
  assert.ok(row.detail.includes("0.1.0"), "the version left behind is named");
  assert.equal(row.current, true);
});

test("a failed update says so and falls back to the releases page", () => {
  const failed = updateRow(supported({ status: UPDATE_STATUS.ERROR, latestVersion: "0.2.0" }));
  assert.equal(failed.action, UPDATE_ROW_ACTION.GET);
  assert.ok(failed.detail.includes("could not be installed"), "the failure is said plainly");
  assert.ok(failed.detail.includes("0.2.0"), "the version to fetch by hand is still named");

  const unversioned = updateRow(supported({ status: UPDATE_STATUS.ERROR }));
  assert.equal(unversioned.action, UPDATE_ROW_ACTION.GET);
  assert.equal(unversioned.current, false);
});

test("a build that cannot install itself offers the browser in every state", () => {
  const row = updateRow({
    status: UPDATE_STATUS.IDLE,
    currentVersion: "0.1.0",
    installSupported: false,
    upToDate: false,
  });
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
