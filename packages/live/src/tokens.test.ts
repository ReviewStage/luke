import assert from "node:assert/strict";
import { test } from "vitest";
import { startupPrefix, startupTokens } from "./tokens.js";

test("the startup estimate counts a CJK character or an emoji half as a token, and code at three characters to one", () => {
  assert.ok(startupTokens("計画".repeat(500)) >= 1_000);
  assert.ok(startupTokens("🙂".repeat(100)) >= 100);
  assert.ok(startupTokens("if (a) { b(); }\n".repeat(30)) >= 160);
});

test("the startup prefix is the longest start within the bound, and never splits an emoji", () => {
  const text = `plan ${"計".repeat(10)}🙂 tail`;
  for (let tokens = 0; tokens <= startupTokens(text); tokens += 1) {
    const prefix = startupPrefix(text, tokens);
    assert.ok(text.startsWith(prefix));
    assert.ok(startupTokens(prefix) <= tokens);
    const longer = text.slice(0, prefix.length + 1);
    const pairEnd = longer.length < text.length && /[\uD800-\uDBFF]$/.test(longer);
    if (prefix.length < text.length && !pairEnd) assert.ok(startupTokens(longer) > tokens);
    assert.ok(!/[\uD800-\uDBFF]$/.test(prefix));
  }
  assert.equal(startupPrefix(text, startupTokens(text)), text);
});
