import assert from "node:assert/strict";
import { test } from "vitest";
import { linearIssueIdentifierIn } from "./linear-wire.js";

test("a key typed alone in any case, or a pasted link to an issue's page, names that issue; other words name none", () => {
  assert.equal(linearIssueIdentifierIn("ENG-123"), "ENG-123");
  assert.equal(linearIssueIdentifierIn("  eng-42 "), "ENG-42");
  assert.equal(
    linearIssueIdentifierIn("https://linear.app/acme/issue/OPS-7/rotate-the-deploy-key"),
    "OPS-7",
  );
  assert.equal(linearIssueIdentifierIn(" https://linear.app/acme/issue/ops-7 "), "OPS-7");

  assert.equal(linearIssueIdentifierIn("fix ENG-123"), undefined);
  assert.equal(linearIssueIdentifierIn("ENG-0"), undefined);
  assert.equal(linearIssueIdentifierIn("https://linear.app/acme/project/eng-1"), undefined);
  assert.equal(linearIssueIdentifierIn("https://example.com/acme/issue/ENG-1"), undefined);
  assert.equal(linearIssueIdentifierIn(""), undefined);
});
