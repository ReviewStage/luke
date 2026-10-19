import assert from "node:assert/strict";
import { test } from "vitest";
import { appLinkOf, LINK_PLACE, type LinkPlace, linkOf, readLink } from "./luke-link.js";

/**
 * A place in Luke as the link a teammate is sent: written under its
 * workspace by its ids alone, read back by the web's scheme or the
 * desktop's, and nothing read from an address that names no place.
 * Synthetic ids.
 */

const TASK = "3f6c1b2a-8d4e-4f10-9a7b-5c2d1e0fa21b";
const AGENT = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
const OTHER = "0c9a3f1e-6b2d-4e8f-a1c7-3d5e7f9a1b2c";
const HOME = "https://tryluke.dev/acme";

/** Every kind of place, and the link it is shared by, spelled out. */
const LINKS: readonly (readonly [LinkPlace, string])[] = [
  [{ kind: LINK_PLACE.TASK, planId: TASK }, `${HOME}/plan/${TASK}`],
  [{ kind: LINK_PLACE.SECTION, planId: TASK, anchor: "rollout" }, `${HOME}/plan/${TASK}#rollout`],
  [
    { kind: LINK_PLACE.COMMENT, planId: TASK, threadId: OTHER },
    `${HOME}/plan/${TASK}?comment=${OTHER}`,
  ],
  [{ kind: LINK_PLACE.VERSION, planId: TASK, revision: 12 }, `${HOME}/plan/${TASK}/version/12`],
  [{ kind: LINK_PLACE.PAGE, planId: TASK, pageId: OTHER }, `${HOME}/plan/${TASK}/page/${OTHER}`],
  [{ kind: LINK_PLACE.CALL, planId: TASK }, `${HOME}/plan/${TASK}/call`],
  [{ kind: LINK_PLACE.CALL, planId: TASK, callId: "call_9" }, `${HOME}/plan/${TASK}/call/call_9`],
  [
    { kind: LINK_PLACE.TURN, planId: TASK, at: 1760000000000 },
    `${HOME}/plan/${TASK}/work/1760000000000`,
  ],
  [{ kind: LINK_PLACE.AGENT, planId: TASK, agentId: AGENT }, `${HOME}/plan/${TASK}/agent/${AGENT}`],
  [{ kind: LINK_PLACE.AGENT, agentId: AGENT }, `${HOME}/agent/${AGENT}`],
  [
    { kind: LINK_PLACE.WORKER, planId: TASK, agentId: AGENT, callId: "toolu_01" },
    `${HOME}/plan/${TASK}/agent/${AGENT}/worker/toolu_01`,
  ],
  [
    { kind: LINK_PLACE.WORKER, planId: TASK, callId: "toolu_02" },
    `${HOME}/plan/${TASK}/worker/toolu_02`,
  ],
  [
    { kind: LINK_PLACE.CHANGES, planId: TASK, agentId: AGENT },
    `${HOME}/plan/${TASK}/agent/${AGENT}/changes`,
  ],
  [
    { kind: LINK_PLACE.MESSAGE, planId: TASK, agentId: AGENT, messageId: OTHER },
    `${HOME}/plan/${TASK}/agent/${AGENT}/message/${OTHER}`,
  ],
  [
    { kind: LINK_PLACE.MESSAGE, agentId: AGENT, messageId: OTHER },
    `${HOME}/agent/${AGENT}/message/${OTHER}`,
  ],
  [{ kind: LINK_PLACE.INBOX }, `${HOME}/inbox`],
  [
    { kind: LINK_PLACE.INBOX_ITEM, planId: TASK, itemId: OTHER },
    `${HOME}/plan/${TASK}/inbox/${OTHER}`,
  ],
  [
    { kind: LINK_PLACE.INBOX_ITEM, agentId: AGENT, itemId: OTHER },
    `${HOME}/agent/${AGENT}/inbox/${OTHER}`,
  ],
  [{ kind: LINK_PLACE.AUTOMATIONS }, `${HOME}/automations`],
  [{ kind: LINK_PLACE.AUTOMATION, automationId: OTHER }, `${HOME}/automation/${OTHER}`],
  [
    { kind: LINK_PLACE.AUTOMATION_RUN, automationId: OTHER, runId: AGENT },
    `${HOME}/automation/${OTHER}/run/${AGENT}`,
  ],
  [{ kind: LINK_PLACE.FACTORY }, `${HOME}/factory`],
  [{ kind: LINK_PLACE.SETTINGS }, `${HOME}/settings`],
  [{ kind: LINK_PLACE.SETTINGS, page: "coding-agents" }, `${HOME}/settings/coding-agents`],
  [{ kind: LINK_PLACE.PERSON, userId: "user_9Fq2-x" }, `${HOME}/person/user_9Fq2-x`],
  [{ kind: LINK_PLACE.ISSUE, issueId: OTHER }, `${HOME}/issue/${OTHER}`],
];

test("every place is shared as its kind's address under its workspace, by its ids alone", () => {
  for (const [place, link] of LINKS) {
    assert.equal(linkOf(place, "acme"), link, place.kind);
  }
});

test("every place's link, by the web's scheme or the desktop's, names that place in its workspace", () => {
  for (const [place, link] of LINKS) {
    assert.deepEqual(readLink(link), { workspace: "acme", place }, link);
    assert.deepEqual(
      readLink(link.replace("https:", "tryluke:")),
      { workspace: "acme", place },
      `${link} in the app's scheme`,
    );
  }
});

test("a workspace written by id, or by a slug that must be encoded, is read back as written", () => {
  const place = { kind: LINK_PLACE.AGENT, agentId: AGENT } as const;
  const link = linkOf(place, "personal-u_1 (Dean)");

  assert.equal(link, `https://tryluke.dev/personal-u_1%20%28Dean%29/agent/${AGENT}`);
  assert.deepEqual(readLink(link), { workspace: "personal-u_1 (Dean)", place });
});

test("a link pasted with a trailing slash, a query, or a fragment its kind has no use for still names its place", () => {
  assert.deepEqual(readLink(`${HOME}/agent/${AGENT}/inbox/${OTHER}/?from=slack#top`), {
    workspace: "acme",
    place: { kind: LINK_PLACE.INBOX_ITEM, agentId: AGENT, itemId: OTHER },
  });
});

test("a task's link names one of its comment threads by its comment query alone, any other query being the address's own", () => {
  assert.deepEqual(readLink(`${HOME}/task/${TASK}/?from=slack&comment=${OTHER}#rollout`)?.place, {
    kind: LINK_PLACE.COMMENT,
    planId: TASK,
    threadId: OTHER,
  });
  assert.deepEqual(readLink(`${HOME}/plan/${TASK}?comment=${OTHER}&comment=${AGENT}`)?.place, {
    kind: LINK_PLACE.TASK,
    planId: TASK,
  });
  assert.equal(
    appLinkOf(`${HOME}/plan/${TASK}?comment=${OTHER}&from=slack`),
    `tryluke://tryluke.dev/acme/plan/${TASK}?comment=${OTHER}`,
  );
});

test("a task's own link, or a section's, is read under /task/ and with a slash after its id, as under /plan/", () => {
  for (const target of [
    `${HOME}/task/${TASK}#rollout`,
    `${HOME}/plan/${TASK}/#rollout`,
    `tryluke://tryluke.dev/acme/task/${TASK}/#Rollout`,
  ]) {
    assert.deepEqual(
      readLink(target),
      { workspace: "acme", place: { kind: LINK_PLACE.SECTION, planId: TASK, anchor: "rollout" } },
      target,
    );
  }
  assert.equal(appLinkOf(`${HOME}/task/${TASK}/`), `tryluke://tryluke.dev/acme/plan/${TASK}`);
});

test("a section headed by the longest heading a plan takes, percent-encoded, is still its link", () => {
  const anchor = "語".repeat(1_000);
  const link = linkOf({ kind: LINK_PLACE.SECTION, planId: TASK, anchor }, "acme");

  assert.ok(link.length > 4_000);
  assert.deepEqual(readLink(link), {
    workspace: "acme",
    place: { kind: LINK_PLACE.SECTION, planId: TASK, anchor },
  });
  assert.equal(appLinkOf(link), link.replace("https:", "tryluke:"));
});

test("a task's places are read under the name the unit of work is taking, /task/, as under /plan/", () => {
  assert.deepEqual(readLink(`${HOME}/task/${TASK}/agent/${AGENT}`), {
    workspace: "acme",
    place: { kind: LINK_PLACE.AGENT, planId: TASK, agentId: AGENT },
  });
  assert.deepEqual(readLink(`${HOME}/task/${TASK}/version/3`), {
    workspace: "acme",
    place: { kind: LINK_PLACE.VERSION, planId: TASK, revision: 3 },
  });
});

test("a picture in a plan's address names its task, and nothing of the picture", () => {
  const picture = "0b6f6b52-2c1e-4f8e-9a4d-7f1c2e9d5a01";

  assert.deepEqual(readLink(`${HOME}/plan/${TASK}/files/${picture}`), {
    workspace: "acme",
    place: { kind: LINK_PLACE.TASK, planId: TASK },
  });
  assert.equal(readLink(`${HOME}/plan/${TASK}/files/not-an-id`), undefined);
});

test("an address that names no place in Luke names nothing", () => {
  for (const target of [
    `https://example.com/acme/agent/${AGENT}`,
    `http://tryluke.dev/acme/agent/${AGENT}`,
    `https://tryluke.dev/agent/${AGENT}`,
    `https://tryluke.dev//agent/${AGENT}`,
    `${HOME}/agent`,
    `${HOME}/agents/${AGENT}`,
    `${HOME}/agent/${AGENT}/changes`,
    `${HOME}/agent/${AGENT}/worker/toolu_01`,
    `${HOME}/agent/Fix%20the%20billing%20export`,
    `${HOME}/task/Fix%20billing`,
    `${HOME}/plan/Fix%20billing#rollout`,
    `${HOME}/plan/${TASK}/version/latest`,
    `${HOME}/plan/${TASK}/call/call_9/more`,
    `${HOME}/inbox/${OTHER}`,
    `${HOME}/plan/${TASK}/agent/${AGENT}/inbox/${OTHER}`,
    `${HOME}/agent/${AGENT}/inbox/${OTHER}/answer`,
    `${HOME}/automations/${OTHER}`,
    `${HOME}/automation/${OTHER}/runs/${AGENT}`,
    `${HOME}/factory/today`,
    `${HOME}/settings/Coding%20agents`,
    `${HOME}/person`,
    `${HOME}/people/user_9Fq2-x`,
    `${HOME}/person/user_9Fq2-x/tasks`,
    `${HOME}/person/charles%40acme.dev`,
    `${HOME}/issue`,
    `${HOME}/issues/${OTHER}`,
    `${HOME}/issue/${OTHER}/comments`,
    `${HOME}/issue/LUKE%2012`,
    `${HOME}/agent/%E0%A4%A`,
    `${HOME}/agent/${"a".repeat(201)}`,
    `luke://mcp/linear`,
    "javascript:alert(1)",
    "",
  ]) {
    assert.equal(readLink(target), undefined, target);
  }
});

test("a link is handed to the desktop in its own scheme, written again from the place it names", () => {
  assert.equal(
    appLinkOf(`${HOME}/plan/${TASK}/agent/${AGENT}?from=slack#top`),
    `tryluke://tryluke.dev/acme/plan/${TASK}/agent/${AGENT}`,
  );
  assert.equal(
    appLinkOf(`https://tryluke.dev/acme/plan/${TASK}?from=slack#Rollout`),
    `tryluke://tryluke.dev/acme/plan/${TASK}#rollout`,
  );
  assert.equal(
    appLinkOf(`tryluke://tryluke.dev/personal-u_1/plan/${TASK}/inbox/${OTHER}`),
    `tryluke://tryluke.dev/personal-u_1/plan/${TASK}/inbox/${OTHER}`,
  );
  for (const target of [
    `https://example.com/acme/plan/${TASK}`,
    `luke://plan/${TASK}`,
    "https://github.com/acme/checkout/blob/HEAD/src/a.ts",
    `https://tryluke.dev/acme/plan/${TASK}#a%20b`,
  ]) {
    assert.equal(appLinkOf(target), undefined, target);
  }
});
