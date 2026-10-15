import assert from "node:assert/strict";
import { test } from "vitest";
import { appLinkClaim, appLinkInArguments, appLinkInbox, placeOfAppLink } from "./app-links.js";
import { LINK_PLACE, type ReadLink } from "./luke-link.js";

/**
 * A Luke link the system hands the app: read only as a place in Luke, in
 * the app's own scheme; held until a panel can open it, then
 * opened in the order it came, and each later one as it comes; let go once
 * the launch is torn down. Synthetic ids.
 */

const PLAN_ID = "3f6c1b2a-8d4e-4f10-9a7b-5c2d1e0fa21b";
const SECTION_LINK = `tryluke://tryluke.dev/acme/plan/${PLAN_ID}#rollout`;
const PLAN_LINK = `tryluke://tryluke.dev/acme/plan/${PLAN_ID}`;
const AGENT_ID = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";

const SECTION: ReadLink = {
  workspace: "acme",
  place: { kind: LINK_PLACE.SECTION, planId: PLAN_ID, anchor: "rollout" },
};
const PLAN: ReadLink = { workspace: "acme", place: { kind: LINK_PLACE.TASK, planId: PLAN_ID } };

test("a link in the app's own scheme names its place: a task, its section, an agent, an Inbox item", () => {
  assert.deepEqual(placeOfAppLink(SECTION_LINK), SECTION);
  assert.deepEqual(placeOfAppLink(PLAN_LINK), PLAN);
  assert.deepEqual(placeOfAppLink(`tryluke://tryluke.dev/acme/agent/${AGENT_ID}`), {
    workspace: "acme",
    place: { kind: LINK_PLACE.AGENT, agentId: AGENT_ID },
  });
  assert.deepEqual(placeOfAppLink(`tryluke://tryluke.dev/acme/plan/${PLAN_ID}/inbox/${AGENT_ID}`), {
    workspace: "acme",
    place: { kind: LINK_PLACE.INBOX_ITEM, planId: PLAN_ID, itemId: AGENT_ID },
  });
});

test("anything but a place's link in the app's own scheme names nothing", () => {
  for (const url of [
    `https://tryluke.dev/acme/plan/${PLAN_ID}`,
    `luke://plan/${PLAN_ID}`,
    "tryluke://tryluke.dev/acme/settings/Coding%20agents",
    `https://tryluke.dev/acme/agent/${AGENT_ID}`,
    `tryluke://evil.example/acme/plan/${PLAN_ID}`,
    "tryluke://github.com/acme/relay/blob/HEAD/a.ts",
    "javascript:alert(1)",
  ]) {
    assert.equal(placeOfAppLink(url), undefined, url);
  }
});

test("a second launch's link is the last of its arguments in the app's own scheme", () => {
  assert.equal(appLinkInArguments(["/Applications/Luke.app", "--flag", PLAN_LINK]), PLAN_LINK);
  assert.equal(appLinkInArguments(["/Applications/Luke.app", "https://tryluke.dev"]), undefined);
});

test("links that arrive before a panel can open them open once it can, in order, and later ones as they come", () => {
  const inbox = appLinkInbox();
  const opened: ReadLink[] = [];

  inbox.arrive(SECTION_LINK);
  inbox.arrive("https://example.com");
  inbox.arrive(PLAN_LINK);
  const beforeReady = opened.length;
  inbox.ready((place) => opened.push(place));
  inbox.arrive(SECTION_LINK);

  assert.equal(beforeReady, 0);
  assert.deepEqual(opened, [SECTION, PLAN, SECTION]);
});

test("once the launch is torn down a link opens nothing, and none is held for a later window", () => {
  const inbox = appLinkInbox();
  const opened: ReadLink[] = [];
  inbox.ready((place) => opened.push(place));

  inbox.close();
  inbox.arrive(PLAN_LINK);
  const afterClose = opened.length;
  inbox.ready((place) => opened.push(place));

  assert.equal(afterClose, 0);
  assert.deepEqual(opened, []);
});

test("a packaged build claims the scheme as itself, a live development run on its own binary and app, a fixture run not at all", () => {
  const launch = {
    executable: "/repo/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron",
    appPath: "/repo/apps/desktop",
  };

  assert.deepEqual(appLinkClaim({ ...launch, packaged: true, live: true }), [
    launch.executable,
    [],
  ]);
  assert.deepEqual(appLinkClaim({ ...launch, packaged: false, live: true }), [
    launch.executable,
    [launch.appPath],
  ]);
  assert.equal(appLinkClaim({ ...launch, packaged: false, live: false }), undefined);
});
