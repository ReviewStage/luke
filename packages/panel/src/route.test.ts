import assert from "node:assert/strict";
import { LINK_PLACE, type ReadLink } from "@luke/features/link-grammar";
import { it } from "vitest";
import {
  addressOf,
  HERE,
  type Here,
  ROUTE,
  type Route,
  route,
  THING,
  type Thing,
} from "./route.js";

/**
 * route.test.ts -- where a link pressed opens, one row per kind of address
 * and the surface it was pressed on: an Inbox item, a task's page, an
 * agent's page, the window past them, and the Tasks tab going to a place.
 * Synthetic ids.
 */

const TASK = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
const AGENT = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";
const OTHER = "5b7d9f1a-3c5e-4a7b-9d1f-2b4c6d8e0f1a";
const PAGE = "3f8e2a1b-6c4d-4e5f-8a9b-0c1d2e3f4a5b";
const CALL = "toolu_01";
const THREAD = "PRRT_kwDOA1";
const MESSAGE = "4a6c8e0b-2d4f-4b6d-8f0a-1c3e5a7b9d2c";
const INBOX_ITEM = "6e8a0c2d-4f6b-4d8f-a1c3-5e7a9b1d3f4e";
const PR = "https://github.com/acme/relay/pull/42";
const FILE = "https://github.com/acme/relay/blob/HEAD/src/invites.ts";
const LUKE = "https://tryluke.dev/acme";

/** A task's or an agent's: its repository, and one agent, which opened the pull request numbered 42. */
const HOLDING = {
  repository: "acme/relay",
  pullRequests: new Map([[AGENT, { url: PR }]]),
  agentIds: [AGENT],
  heldIds: undefined,
};

/** The same, its agent archived: no longer drawn, though still held. */
const ARCHIVED = { ...HOLDING, agentIds: [], heldIds: [AGENT] };

const ITEM: Here = { kind: HERE.INBOX_ITEM, taskId: TASK, agentId: undefined, ...HOLDING };
const TASKLESS_ITEM: Here = {
  kind: HERE.INBOX_ITEM,
  taskId: undefined,
  agentId: AGENT,
  ...HOLDING,
};
const ON_TASK: Here = { kind: HERE.TASK, ...HOLDING };
const ON_AGENT: Here = { kind: HERE.AGENT, ...HOLDING };

/** The window, listing the task, and an agent on no task, which opened the pull request numbered 43. */
const WINDOW: Here = {
  kind: HERE.WINDOW,
  opensPlaces: true,
  listed: {
    tasks: [{ id: TASK, agents: { pullRequests: [{ url: PR, agentId: AGENT }] } }],
    agents: [{ id: OTHER, pullRequest: { url: "https://github.com/acme/relay/pull/43" } }],
  },
};

/** The Tasks tab showing the task with nothing over its plan. */
const STANDING: Here = { kind: HERE.TASKS_TAB, taskId: TASK };

const NOTHING: Route = { kind: ROUTE.NOTHING };

function preview(thing: Thing): Route {
  return { kind: ROUTE.PREVIEW, thing };
}

function go(link: ReadLink): Route {
  return { kind: ROUTE.GO, link };
}

it.each<[string, string, Here, Route]>([
  [
    "an Inbox item: a pull request one of its agents opened, however its page is spelled, in that agent's Pull request tab",
    `${PR}#issuecomment-1`,
    ITEM,
    preview({ kind: THING.PULL_REQUEST, agentId: AGENT }),
  ],
  [
    "an Inbox item: another pull request of its repository, in any case, by its number in its first agent's tab",
    "https://github.com/Acme/Relay/pull/41/files",
    ITEM,
    preview({ kind: THING.PULL_REQUEST, agentId: AGENT, number: 41 }),
  ],
  [
    "an Inbox item: a pull request of another repository, the window's",
    "https://github.com/acme/other/pull/41",
    ITEM,
    NOTHING,
  ],
  [
    "an Inbox item: another pull request of its repository with none of its agents drawn, the window's",
    "https://github.com/acme/relay/pull/41",
    { ...ITEM, agentIds: [] },
    NOTHING,
  ],
  [
    "an Inbox item of an agent on no task: another pull request of its repository, the window's",
    "https://github.com/acme/relay/pull/41",
    TASKLESS_ITEM,
    NOTHING,
  ],
  [
    "an Inbox item: a long run of slashes, read at once as any address no pull request matches",
    `https://github.com/acme/relay/pull/43${"/".repeat(50_000)}x`,
    { ...ITEM, agentIds: undefined },
    NOTHING,
  ],
  [
    "an Inbox item: a file of its repository, beside it",
    FILE,
    ITEM,
    preview({ kind: THING.FILE, path: "src/invites.ts", lines: undefined }),
  ],
  [
    "an Inbox item of an agent on no task: a file of its repository, beside it",
    FILE,
    TASKLESS_ITEM,
    preview({ kind: THING.FILE, path: "src/invites.ts", lines: undefined }),
  ],
  [
    "an Inbox item not yet chosen: nothing beside it",
    FILE,
    { ...ITEM, taskId: undefined },
    NOTHING,
  ],
  [
    "an Inbox item: its task's own page, beside it",
    `${LUKE}/plan/${TASK}/page/${PAGE}`,
    ITEM,
    preview({ kind: THING.PAGE, pageId: PAGE }),
  ],
  [
    "an Inbox item: another task's page, the window's",
    `${LUKE}/plan/${OTHER}/page/${PAGE}`,
    ITEM,
    NOTHING,
  ],
  [
    "an Inbox item of an agent on no task: that agent's page, beside it",
    `${LUKE}/agent/${AGENT}/page/${PAGE}`,
    TASKLESS_ITEM,
    preview({ kind: THING.PAGE, pageId: PAGE }),
  ],
  [
    "an Inbox item of an agent on no task: another agent's page, the window's",
    `${LUKE}/agent/${OTHER}/page/${PAGE}`,
    TASKLESS_ITEM,
    NOTHING,
  ],
  ["an Inbox item: its task's plan, the window's", `${LUKE}/plan/${TASK}`, ITEM, NOTHING],
  [
    "an Inbox item: an agent of its task, its transcript beside it",
    `${LUKE}/plan/${TASK}/agent/${AGENT}`,
    ITEM,
    preview({ kind: THING.TRANSCRIPT, agentId: AGENT }),
  ],
  [
    "an Inbox item: an agent under another task, the window's",
    `${LUKE}/plan/${OTHER}/agent/${AGENT}`,
    ITEM,
    NOTHING,
  ],
  [
    "an Inbox item: an agent not of its task, the window's",
    `${LUKE}/agent/${OTHER}`,
    ITEM,
    NOTHING,
  ],
  [
    "an Inbox item: an archived agent of its task, to the task on its tab",
    `${LUKE}/plan/${TASK}/agent/${AGENT}`,
    { ...ITEM, ...ARCHIVED },
    go({
      workspace: "acme",
      place: { kind: LINK_PLACE.AGENT, planId: TASK, agentId: AGENT },
    }),
  ],
  [
    "an Inbox item: an archived agent's Changes, beside it",
    `${LUKE}/agent/${AGENT}/changes`,
    { ...ITEM, ...ARCHIVED },
    preview({ kind: THING.CHANGES, agentId: AGENT }),
  ],
  [
    "an Inbox item: a message of an agent of its task, its transcript beside it at the message",
    `${LUKE}/agent/${AGENT}/message/${MESSAGE}`,
    ITEM,
    preview({ kind: THING.TRANSCRIPT, agentId: AGENT, messageId: MESSAGE }),
  ],
  [
    "an Inbox item: a message of an archived agent of its task, the window's",
    `${LUKE}/plan/${TASK}/agent/${AGENT}/message/${MESSAGE}`,
    { ...ITEM, ...ARCHIVED },
    NOTHING,
  ],
  [
    "an Inbox item of an agent on no task: a message of that agent, the window's",
    `${LUKE}/agent/${AGENT}/message/${MESSAGE}`,
    TASKLESS_ITEM,
    NOTHING,
  ],
  [
    "an Inbox item: a review thread of an archived agent's pull request, beside it at the thread",
    `${LUKE}/agent/${AGENT}/changes/conversation/thread/${THREAD}`,
    { ...ITEM, ...ARCHIVED },
    preview({ kind: THING.THREAD, agentId: AGENT, threadId: THREAD, view: "conversation" }),
  ],
  [
    "an Inbox item: a review thread of an agent not of its task, the window's",
    `${LUKE}/agent/${OTHER}/changes/files/thread/${THREAD}`,
    ITEM,
    NOTHING,
  ],
  [
    "an Inbox item: another task's Inbox item, chosen in this Inbox",
    `${LUKE}/plan/${OTHER}/inbox/${INBOX_ITEM}`,
    ITEM,
    preview({ kind: THING.INBOX_ITEM, itemId: INBOX_ITEM, taskId: OTHER, agentId: undefined }),
  ],
  [
    "an Inbox item: an Inbox item an agent of its task posted, chosen in this Inbox under the task",
    `${LUKE}/agent/${AGENT}/inbox/${INBOX_ITEM}`,
    ITEM,
    preview({ kind: THING.INBOX_ITEM, itemId: INBOX_ITEM, taskId: TASK, agentId: AGENT }),
  ],
  [
    "an Inbox item: an Inbox item an agent it does not hold posted, the window's to find",
    `${LUKE}/agent/${OTHER}/inbox/${INBOX_ITEM}`,
    ITEM,
    NOTHING,
  ],
  [
    "an Inbox item of an agent on no task: another item of that agent, chosen in this Inbox",
    `${LUKE}/agent/${AGENT}/inbox/${INBOX_ITEM}`,
    TASKLESS_ITEM,
    preview({ kind: THING.INBOX_ITEM, itemId: INBOX_ITEM, taskId: undefined, agentId: AGENT }),
  ],
  [
    "a task: a page under its agent's pull request's, in that agent's own Pull request tab",
    `${PR}/files`,
    ON_TASK,
    preview({ kind: THING.PULL_REQUEST, agentId: AGENT }),
  ],
  [
    "a task: another pull request of its repository, by its number in its first agent's tab",
    "https://github.com/acme/relay/pull/41",
    ON_TASK,
    preview({ kind: THING.PULL_REQUEST, agentId: AGENT, number: 41 }),
  ],
  [
    "a task: a pull request of another repository, the window's",
    "https://github.com/acme/other/pull/41",
    ON_TASK,
    NOTHING,
  ],
  [
    "a task: an archived agent's pull request, merged or not, in its own Pull request tab",
    PR,
    { ...ON_TASK, ...ARCHIVED },
    preview({ kind: THING.PULL_REQUEST, agentId: AGENT }),
  ],
  [
    "a task: a Luke link, to its own page among them, the window's",
    `${LUKE}/plan/${TASK}/page/${PAGE}`,
    ON_TASK,
    NOTHING,
  ],
  ["a task: a file of its repository, the window's", FILE, ON_TASK, NOTHING],
  [
    "an agent's page: the pull request it opened, in its Pull request tab",
    PR,
    ON_AGENT,
    preview({ kind: THING.PULL_REQUEST, agentId: AGENT }),
  ],
  [
    "an agent's page: another pull request of its repository, by its number",
    "https://github.com/acme/relay/pull/41",
    ON_AGENT,
    preview({ kind: THING.PULL_REQUEST, agentId: AGENT, number: 41 }),
  ],
  [
    "the window: a Luke link, to its place",
    `${LUKE}/agent/${AGENT}`,
    WINDOW,
    go({ workspace: "acme", place: { kind: LINK_PLACE.AGENT, agentId: AGENT } }),
  ],
  [
    "the window: a plan an older link names, to the plan",
    `luke://plan/${TASK}`,
    WINDOW,
    go({ workspace: "", place: { kind: LINK_PLACE.TASK, planId: TASK } }),
  ],
  [
    "the window: a pull request a listed task's agent opened, however spelled, to its Pull request tab on the task",
    `${PR}#issuecomment-1`,
    WINDOW,
    go({ workspace: "", place: { kind: LINK_PLACE.CHANGES, planId: TASK, agentId: AGENT } }),
  ],
  [
    "the window: a pull request a listed agent on no task opened, to its Pull request tab",
    "https://github.com/acme/relay/pull/43",
    WINDOW,
    go({ workspace: "", place: { kind: LINK_PLACE.CHANGES, agentId: OTHER } }),
  ],
  [
    "the window: a pull request nothing listed names, to the browser",
    "https://github.com/acme/relay/pull/7",
    WINDOW,
    { kind: ROUTE.EXTERNAL, href: "https://github.com/acme/relay/pull/7" },
  ],
  [
    "the window: any other page, to the browser",
    "https://example.com/docs",
    WINDOW,
    { kind: ROUTE.EXTERNAL, href: "https://example.com/docs" },
  ],
  [
    "outside the window: a Luke link, to the browser",
    `${LUKE}/agent/${AGENT}`,
    { kind: HERE.WINDOW, opensPlaces: false, listed: undefined },
    { kind: ROUTE.EXTERNAL, href: `${LUKE}/agent/${AGENT}` },
  ],
  [
    "the Tasks tab: a page of the task it shows, as the panel's preview",
    `${LUKE}/plan/${TASK}/page/${PAGE}`,
    STANDING,
    preview({ kind: THING.PAGE, pageId: PAGE }),
  ],
  [
    "the Tasks tab: another task's page, to that task",
    `${LUKE}/plan/${OTHER}/page/${PAGE}`,
    STANDING,
    go({ workspace: "acme", place: { kind: LINK_PLACE.PAGE, planId: OTHER, pageId: PAGE } }),
  ],
  [
    "the Tasks tab: the task it shows, its Overview",
    `${LUKE}/plan/${TASK}`,
    STANDING,
    { kind: ROUTE.OVERVIEW, place: { kind: LINK_PLACE.TASK, planId: TASK } },
  ],
  [
    "the Tasks tab: a section of the task it shows, its Overview at the section",
    `${LUKE}/plan/${TASK}#rollout`,
    STANDING,
    { kind: ROUTE.OVERVIEW, place: { kind: LINK_PLACE.SECTION, planId: TASK, anchor: "rollout" } },
  ],
  [
    "the Tasks tab: a comment of the task it shows, its Overview at the comment",
    `${LUKE}/plan/${TASK}?comment=${MESSAGE}`,
    STANDING,
    { kind: ROUTE.OVERVIEW, place: { kind: LINK_PLACE.COMMENT, planId: TASK, threadId: MESSAGE } },
  ],
  [
    "the Tasks tab: another task's section, to that task",
    `${LUKE}/plan/${OTHER}#rollout`,
    STANDING,
    go({
      workspace: "acme",
      place: { kind: LINK_PLACE.SECTION, planId: OTHER, anchor: "rollout" },
    }),
  ],
  [
    "the Tasks tab: a worker of the task it shows, as the panel's preview",
    `${LUKE}/plan/${TASK}/agent/${AGENT}/worker/${CALL}`,
    STANDING,
    preview({ kind: THING.WORKER, agentId: AGENT, callId: CALL }),
  ],
  [
    "the Tasks tab: a review thread of the task it shows, its agent's Changes as the panel's preview",
    `${LUKE}/plan/${TASK}/agent/${AGENT}/changes/files/thread/${THREAD}`,
    STANDING,
    preview({ kind: THING.CHANGES, agentId: AGENT }),
  ],
  [
    "the Tasks tab with something over the task's plan: the task's own Changes, to the task",
    `${LUKE}/plan/${TASK}/agent/${AGENT}/changes`,
    { kind: HERE.TASKS_TAB, taskId: undefined },
    go({ workspace: "acme", place: { kind: LINK_PLACE.CHANGES, planId: TASK, agentId: AGENT } }),
  ],
])("%s", (_, href, here, expected) => {
  assert.deepEqual(route(addressOf(href), here), expected);
});
