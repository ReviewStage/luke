import assert from "node:assert/strict";
import { Schema } from "effect";
import { test } from "vitest";
import { MIRROR_FRAME, mirrorFrameSchema } from "./sandbox-mirror-wire.js";

const decode = Schema.decodeUnknownResult(mirrorFrameSchema);

test("a header's base is read only as a full lowercase commit id", () => {
  const id = "0123456789abcdef0123456789abcdef01234567";
  assert.equal(decode({ type: MIRROR_FRAME.HEADER, base: id })._tag, "Success");
  for (const base of [
    "--upload-pack=x",
    `-${id.slice(1)}`,
    "main",
    id.slice(0, 39),
    id.toUpperCase(),
  ]) {
    assert.equal(decode({ type: MIRROR_FRAME.HEADER, base })._tag, "Failure", base);
  }
});
