import assert from "node:assert/strict";
import test from "node:test";
import { unparsedWire } from "@sidecar/wire";
import { isSupersetControlId, SUPERSET_CONTROL_ID, supersetFailureReason } from "./vocabulary.js";

const FALLBACK = "Superset could not do that.";

/**
 * What the CLI wrote on stderr, and the one line of it a row may carry. A
 * failure the developer can act on is the point: the CLI's own words, cleaned
 * of the terminal's, never its whole output.
 */
const REASON_CASE: readonly {
  readonly name: string;
  readonly stderr?: string;
  readonly reason: string;
}[] = [
  { name: "an attached error with no stderr falls back", reason: FALLBACK },
  { name: "an empty stderr falls back", stderr: "", reason: FALLBACK },
  { name: "whitespace alone falls back", stderr: "  \n\n  ", reason: FALLBACK },
  {
    name: "the first non-empty line is the reason, without its error prefix",
    stderr: "\n\nerror: that project has no such branch\nat main.rs:14\n",
    reason: "that project has no such branch",
  },
  {
    name: "the terminal's own escape sequences are stripped",
    stderr: "\u001b[31merror:\u001b[0m no such host",
    reason: "no such host",
  },
  {
    name: "control characters become spaces and runs of space collapse",
    stderr: "error:\tno\u0007 such\u007fhost",
    reason: "no such host",
  },
  {
    name: "a long line is cut to a sentence",
    stderr: `error: ${"x".repeat(400)}`,
    reason: "x".repeat(300),
  },
];

for (const reasonCase of REASON_CASE) {
  test(reasonCase.name, () => {
    assert.equal(
      supersetFailureReason(unparsedWire({ stderr: reasonCase.stderr }), FALLBACK),
      reasonCase.reason,
    );
  });
}

test("a thrown value that is no record at all falls back", () => {
  assert.equal(supersetFailureReason(unparsedWire("boom"), FALLBACK), FALLBACK);
  assert.equal(supersetFailureReason(undefined, FALLBACK), FALLBACK);
});

test("recognizes only controls owned by Superset", () => {
  assert.equal(isSupersetControlId(SUPERSET_CONTROL_ID.DELETE_WORKSPACE), true);
  assert.equal(isSupersetControlId("provider-native-control"), false);
});
