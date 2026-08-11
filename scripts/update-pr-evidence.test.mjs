import assert from "node:assert/strict";
import test from "node:test";
import { evidenceEnd, evidenceStart, updateEvidenceBlock } from "./update-pr-evidence.mjs";

const evidence = {
  artifactUrl: "https://github.example/artifact/1",
  runUrl: "https://github.example/run/2",
  headSha: "0123456789abcdef",
};

test("appends automated evidence without replacing author content", () => {
  const result = updateEvidenceBlock("## Summary\n\nAuthor notes\n", evidence);

  assert.match(result, /Author notes/);
  assert.match(result, /Download the deterministic macOS evidence/);
  assert.equal(result.match(new RegExp(evidenceStart, "g"))?.length, 1);
});

test("replaces only the existing automated evidence block", () => {
  const initial = [
    "## Summary",
    "",
    evidenceStart,
    "stale evidence",
    evidenceEnd,
    "",
    "## Human notes",
    "Keep this",
  ].join("\n");
  const result = updateEvidenceBlock(initial, evidence);

  assert.doesNotMatch(result, /stale evidence/);
  assert.match(result, /Keep this/);
  assert.equal(result.match(new RegExp(evidenceStart, "g"))?.length, 1);
});
