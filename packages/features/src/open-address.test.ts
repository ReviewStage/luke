import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";
import { LINK_PLACE } from "./luke-link.js";
import { openTargetOf } from "./open-address.js";

/**
 * What the "Open in Luke" page hands the desktop app: the place its
 * address names, spelled in the app's own scheme, on tryluke.dev or any
 * preview that serves the page, and nothing for an address that names no
 * place. Synthetic ids.
 */

const PLAN_ID = "3f6c1b2a-8d4e-4f10-9a7b-5c2d1e0fa21b";
const AGENT_ID = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";

/** The app link the page hands over for an address, alone. */
function appLinkFromAddress(pathname: string, hash: string): string | undefined {
  return openTargetOf(pathname, hash)?.appLink;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test("a task's address, or a section's, opens that task in the app, whichever host served the page", () => {
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

test("a picture's address opens the plan it is of, and nothing else of it", () => {
  const picture = "0b6f6b52-2c1e-4f8e-9a4d-7f1c2e9d5a01";

  assert.equal(
    appLinkFromAddress(`/acme/plan/${PLAN_ID}/files/${picture}`, ""),
    `tryluke://tryluke.dev/acme/plan/${PLAN_ID}`,
  );
  assert.equal(appLinkFromAddress(`/acme/plan/${PLAN_ID}/files/not-an-id`, ""), undefined);
});

test("an agent's, an Inbox item's, or an automation's address opens it in the app, the page told its kind", () => {
  assert.deepEqual(openTargetOf(`/acme/plan/${PLAN_ID}/agent/${AGENT_ID}/`, ""), {
    appLink: `tryluke://tryluke.dev/acme/plan/${PLAN_ID}/agent/${AGENT_ID}`,
    kind: LINK_PLACE.AGENT,
  });
  assert.deepEqual(openTargetOf(`/acme/plan/${PLAN_ID}/inbox/${AGENT_ID}`, ""), {
    appLink: `tryluke://tryluke.dev/acme/plan/${PLAN_ID}/inbox/${AGENT_ID}`,
    kind: LINK_PLACE.INBOX_ITEM,
  });
  assert.deepEqual(openTargetOf(`/acme/automation/${AGENT_ID}`, "#runs"), {
    appLink: `tryluke://tryluke.dev/acme/automation/${AGENT_ID}`,
    kind: LINK_PLACE.AUTOMATION,
  });
});

test("an address that names no place opens nothing", () => {
  for (const [pathname, hash] of [
    ["/acme/plans/x", ""],
    ["/acme/agent/Fix%20billing", ""],
    [`/acme/plan/${PLAN_ID}/files`, ""],
    ["/acme", ""],
    [`/acme/plan/${PLAN_ID}/more`, ""],
    [`/acme/plan/${PLAN_ID}`, "#a%20b"],
  ] as const) {
    assert.equal(appLinkFromAddress(pathname, hash), undefined, `${pathname}${hash}`);
  }
});

test("a browser without URL.parse, as Safari before 18 is, still opens the place", () => {
  vi.stubGlobal("URL", Object.assign(class extends URL {}, { parse: undefined }));

  assert.equal(
    appLinkFromAddress(`/acme/plan/${PLAN_ID}`, "#rollout"),
    `tryluke://tryluke.dev/acme/plan/${PLAN_ID}#rollout`,
  );
  assert.equal(
    appLinkFromAddress(`/acme/agent/${AGENT_ID}`, ""),
    `tryluke://tryluke.dev/acme/agent/${AGENT_ID}`,
  );
  assert.equal(appLinkFromAddress("/acme/plans/x", ""), undefined);
});
