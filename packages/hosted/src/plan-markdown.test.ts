import assert from "node:assert/strict";
import { test } from "vitest";
import { planMarkdown } from "./plan-markdown.js";

test("a plan copies as its name for a title over its text, which holds its assumptions", () => {
  const text =
    "## Goal\n\nInvite a teammate by email.\n\n## Assumptions\n\n- An invite expires after 7 days.\n";

  const copied = planMarkdown({
    name: "Teammate\ninvitations ",
    document: { body: text, assumptions: [] },
  });

  assert.equal(copied, `# Teammate invitations\n\n${text}`);
  assert.equal(
    planMarkdown({ name: "Teammate invitations", document: { body: "", assumptions: [] } }),
    "# Teammate invitations\n",
  );
});
