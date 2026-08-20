import assert from "node:assert/strict";
import test from "node:test";
import { shadowRef } from "./use-state-with-ref";

test("the ref holds what was last written, before any render", () => {
  const ref = { current: "capsule" };
  assert.equal(shadowRef(ref, "panel"), "panel");
  assert.equal(ref.current, "panel", "a timer firing now must see the shape just asked for");
});
