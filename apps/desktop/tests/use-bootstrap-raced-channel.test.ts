import assert from "node:assert/strict";
import test from "node:test";
import { staleBootstrap } from "../src/renderer/use-bootstrap-raced-channel";

test("a live push makes the bootstrap snapshot stale", () => {
  assert.equal(
    staleBootstrap(false),
    false,
    "nothing has arrived; the snapshot is still the newest word",
  );
  assert.equal(
    staleBootstrap(true),
    true,
    "a push that raced past the reply must not be clobbered by it",
  );
});
