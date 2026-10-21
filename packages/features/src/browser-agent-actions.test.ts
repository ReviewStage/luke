import assert from "node:assert/strict";
import { Schema } from "effect";
import { test } from "vitest";
import {
  BROWSER_AGENT_ACTION,
  BROWSER_AGENT_LIMITS,
  browserAgentActionSchema,
  browserAgentActionsSchema,
} from "./browser-agent-actions.js";

/**
 * Which actions an agent's call may carry: an address is http or https
 * alone, a click and a scroll say where, and a sequence is short.
 */

const readsAction = Schema.is(browserAgentActionSchema);
const readsActions = Schema.is(browserAgentActionsSchema);

test("an address that is not http or https is refused", () => {
  for (const url of [
    "file:///etc/passwd",
    "javascript:alert(1)",
    "chrome://settings",
    "localhost:3000",
  ]) {
    assert.equal(readsAction({ action: BROWSER_AGENT_ACTION.OPEN, url }), false, url);
    assert.equal(
      readsAction({ action: BROWSER_AGENT_ACTION.NAVIGATE, tab: "page-1", url }),
      false,
      url,
    );
  }
  assert.equal(
    readsAction({ action: BROWSER_AGENT_ACTION.OPEN, url: "http://localhost:3000/" }),
    true,
  );
});

test("a click names a ref or a whole point, and a scroll a ref or a distance", () => {
  const click = { action: BROWSER_AGENT_ACTION.CLICK, tab: "page-1" };
  assert.equal(readsAction(click), false);
  assert.equal(readsAction({ ...click, x: 10 }), false);
  assert.equal(readsAction({ ...click, ref: "e4", x: 10, y: 20 }), false);
  assert.equal(readsAction({ ...click, ref: "button" }), false);
  assert.equal(readsAction({ ...click, ref: "e4" }), true);
  assert.equal(readsAction({ ...click, x: 10, y: 20 }), true);

  const scroll = { action: BROWSER_AGENT_ACTION.SCROLL };
  assert.equal(readsAction(scroll), false);
  assert.equal(readsAction({ ...scroll, ref: "e4", deltaY: 300 }), false);
  assert.equal(readsAction({ ...scroll, deltaY: -300 }), true);
});

test("a key is a named one or a single character", () => {
  const key = { action: BROWSER_AGENT_ACTION.KEY, tab: "page-1" };
  assert.equal(readsAction({ ...key, key: "Enter" }), true);
  assert.equal(readsAction({ ...key, key: "a", modifiers: ["control"] }), true);
  assert.equal(readsAction({ ...key, key: "Hyper" }), false);
  assert.equal(readsAction({ ...key, key: "a", modifiers: ["super"] }), false);
});

test("a wait is bounded, and a call carries a short sequence", () => {
  const wait = { action: BROWSER_AGENT_ACTION.WAIT, tab: "page-1" };
  assert.equal(readsAction({ ...wait, timeoutMs: BROWSER_AGENT_LIMITS.WAIT_MAX_MS }), true);
  assert.equal(readsAction({ ...wait, timeoutMs: BROWSER_AGENT_LIMITS.WAIT_MAX_MS + 1 }), false);

  const list = { action: BROWSER_AGENT_ACTION.LIST };
  assert.equal(readsActions([]), false);
  assert.equal(
    readsActions(Array.from({ length: BROWSER_AGENT_LIMITS.MAX_ACTIONS }, () => list)),
    true,
  );
  assert.equal(
    readsActions(Array.from({ length: BROWSER_AGENT_LIMITS.MAX_ACTIONS + 1 }, () => list)),
    false,
  );
});
