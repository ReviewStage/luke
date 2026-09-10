import assert from "node:assert/strict";
import test from "node:test";
import { remoteSessionContextText } from "../server/hosted/remote-context";

const NOW = 1_700_000_000_000;

test("an empty roster says so in words", () => {
  assert.equal(
    remoteSessionContextText([], NOW),
    "No coding-agent sessions are currently observed.",
  );
});
