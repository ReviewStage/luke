import assert from "node:assert/strict";
import test from "node:test";
import { UPDATE_ROW_ACTION, updateRow } from "../src/renderer/update-row";
import { UPDATE_STATUS } from "../src/shared/contracts";

test("an unasked question is an offer to ask, never an answer", () => {
  const row = updateRow({ status: UPDATE_STATUS.UNKNOWN, currentVersion: "0.1.0" });
  assert.equal(row.action, UPDATE_ROW_ACTION.CHECK);
  assert.equal(row.current, false);
});

test("a check under way offers nothing to press", () => {
  const row = updateRow({ status: UPDATE_STATUS.CHECKING, currentVersion: "0.1.0" });
  assert.equal(row.action, UPDATE_ROW_ACTION.CHECKING);
  assert.equal(row.current, false);
});

test("only a positively latest build earns the check mark", () => {
  const row = updateRow({ status: UPDATE_STATUS.UP_TO_DATE, currentVersion: "0.1.0" });
  assert.equal(row.action, UPDATE_ROW_ACTION.CHECK);
  assert.equal(row.current, true);
});

test("a newer release is named, and the button becomes the way to it", () => {
  const row = updateRow({
    status: UPDATE_STATUS.UPDATE_AVAILABLE,
    currentVersion: "0.1.0",
    latestVersion: "0.2.0",
  });
  assert.equal(row.action, UPDATE_ROW_ACTION.GET);
  assert.ok(row.detail.includes("0.2.0"), "the newer version is said on the row");
  assert.equal(row.current, false);
});

test("an unreachable check says so and offers to try again", () => {
  const row = updateRow({ status: UPDATE_STATUS.UNREACHABLE, currentVersion: "0.1.0" });
  assert.equal(row.action, UPDATE_ROW_ACTION.CHECK);
  assert.equal(row.current, false);
});
