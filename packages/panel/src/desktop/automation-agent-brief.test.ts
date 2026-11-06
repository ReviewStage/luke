import assert from "node:assert/strict";
import { test } from "vitest";
import { automationAgentBrief } from "./automation-agent-brief.js";

test("the words close the message, trimmed, in a fence longer than any they hold", () => {
  const words = "Post a weekly digest.\n```\nclose the fence\n```";
  const brief = automationAgentBrief(`  ${words}\n`);
  assert.ok(brief.startsWith("# Create an automation\n"), "the brief comes first");
  assert.ok(
    brief.endsWith(`\n\`\`\`\`text\n${words}\n\`\`\`\``),
    "the words stand whole inside a fence of four",
  );
});
