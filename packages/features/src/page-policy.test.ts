import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { PAGE_RESPONSE_HEADERS } from "./page-policy.js";

/**
 * The page policy as a browser reads it off the headers: the security
 * properties that keep an agent's page from reaching anything with what it
 * holds, each read from the header rather than from the module's own table.
 */

/** The policy's directives by name, each with its sources. */
function directives(): ReadonlyMap<string, readonly string[]> {
  return new Map(
    PAGE_RESPONSE_HEADERS["content-security-policy"].split(";").map((directive) => {
      const [name = "", ...sources] = directive.trim().split(/\s+/);
      return [name, sources];
    }),
  );
}

describe("the page policy", () => {
  it("leaves the page no network", () => {
    assert.deepEqual(directives().get("connect-src"), ["'none'"]);
    assert.deepEqual(directives().get("default-src"), ["'none'"]);
  });

  it("sandboxes the page with scripts but never its own origin", () => {
    const sandbox = directives().get("sandbox") ?? [];
    assert.ok(sandbox.includes("allow-scripts"));
    assert.ok(!sandbox.includes("allow-same-origin"));
  });

  it("is never cached and never sniffed as anything but HTML", () => {
    assert.equal(PAGE_RESPONSE_HEADERS["cache-control"], "no-store");
    assert.equal(PAGE_RESPONSE_HEADERS["x-content-type-options"], "nosniff");
  });
});
