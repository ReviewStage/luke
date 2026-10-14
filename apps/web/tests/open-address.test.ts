import assert from "node:assert/strict";
import { test } from "vitest";
import { appLinkFromAddress } from "../src/open-address";

/**
 * What the "Open in Luke" page hands the desktop app: the plan its address
 * names, spelled in the app's own scheme, on tryluke.dev or any preview
 * that serves the page, and nothing for an address that names no plan.
 * Synthetic ids.
 */

const PLAN_ID = "3f6c1b2a-8d4e-4f10-9a7b-5c2d1e0fa21b";

test("a plan's address, or a section's, opens that plan in the app, whichever host served the page", () => {
  assert.equal(
    appLinkFromAddress(`/acme/plan/${PLAN_ID}`, ""),
    `tryluke://tryluke.dev/acme/plan/${PLAN_ID}`,
  );
  assert.equal(
    appLinkFromAddress(`/acme/plan/${PLAN_ID}/`, "#rollout"),
    `tryluke://tryluke.dev/acme/plan/${PLAN_ID}#rollout`,
  );
  assert.equal(
    appLinkFromAddress(`/acme/plan/${PLAN_ID}`, "#rollout"),
    `tryluke://tryluke.dev/acme/plan/${PLAN_ID}#rollout`,
  );
});

test("an address that names no plan opens nothing", () => {
  for (const [pathname, hash] of [
    ["/acme/plans/x", ""],
    ["/acme", ""],
    [`/acme/plan/${PLAN_ID}/more`, ""],
    [`/acme/plan/${PLAN_ID}`, "#a%20b"],
  ] as const) {
    assert.equal(appLinkFromAddress(pathname, hash), undefined, `${pathname}${hash}`);
  }
});
