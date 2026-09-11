import assert from "node:assert/strict";
import { PANEL_FORM_FACTOR, PanelFormFactorSchema } from "@sidecar/surface";
import type { UnparsedWireValue } from "@sidecar/wire";
import { Either, Schema } from "effect";
import { test } from "vitest";

const NOTHING_ANY_VOCABULARY_HOLDS: readonly UnparsedWireValue[] = [
  "",
  " ",
  "not-a-member",
  undefined,
  17,
  true,
  {},
  [],
];

test("the panel form factor schema holds exactly the shapes this build draws", () => {
  const decode = Schema.decodeUnknownEither(PanelFormFactorSchema);
  for (const member of Object.values(PANEL_FORM_FACTOR)) {
    assert.deepEqual(decode(member), Either.right(member));
  }
  for (const refused of NOTHING_ANY_VOCABULARY_HOLDS) {
    assert.equal(Either.isLeft(decode(refused)), true);
  }
});
