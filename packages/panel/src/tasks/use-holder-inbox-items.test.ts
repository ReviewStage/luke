// @vitest-environment jsdom

import assert from "node:assert/strict";
import { CODING_AGENT_CALL_FAILURE, INBOX_SCOPE_KIND } from "@luke/features/coding-agent-view";
import {
  INBOX_ASK,
  INBOX_ASK_STATUS,
  INBOX_MESSAGE_AUTHOR,
  INBOX_STATUS,
  type InboxItem,
} from "@luke/features/inbox-wire";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { fakeActPort, fakeAppBridge } from "../testing/app-bridge.js";
import { followedInboxes } from "../testing/followed-inboxes.js";
import {
  type HolderInboxItems,
  type InboxHolding,
  useHolderInboxItems,
} from "./use-holder-inbox-items.js";

/**
 * use-holder-inbox-items.test.ts -- the window's Inbox follows each listed task's
 * items while it lists it, holds each push, lets a task go as it leaves the
 * list, says a task could not be read only of a task it still lists, so a
 * workspace switched to is not told of another's failure, and follows a
 * failed task again on Try again.
 */

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
});

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 40; tick += 1) await Promise.resolve();
  });
}

const holding = (taskId: string): InboxHolding => ({
  kind: INBOX_SCOPE_KIND.PLAN,
  id: taskId,
  updatedAt: 1,
});

const ITEM: InboxItem = {
  id: "3e4f5a6b-7c8d-4e9f-8a0b-1c2d3e4f5a6b",
  agentId: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21",
  key: "deploy-window",
  revision: 1,
  version: 1,
  title: "Deploy tonight?",
  thread: [
    {
      id: "4e4f5a6b-7c8d-4e9f-8a0b-1c2d3e4f5a6b",
      author: INBOX_MESSAGE_AUTHOR.AGENT,
      text: "Approve or decline.",
      ask: {
        type: INBOX_ASK.DECIDE,
        options: [{ label: "Approve" }, { label: "Decline" }],
        status: INBOX_ASK_STATUS.OPEN,
      },
      createdAt: 1,
    },
  ],
  needsReply: true,
  status: INBOX_STATUS.OPEN,
  postedAt: 1,
  updatedAt: 1,
};

/** The host's inbox streams, standing in for the act port. */
function bridge(main: ReturnType<typeof followedInboxes>) {
  fakeAppBridge({});
  fakeActPort(main.procedures);
}

function mount(holdings: readonly InboxHolding[]) {
  let control: HolderInboxItems | undefined;
  function Probe({ listed }: { listed: readonly InboxHolding[] }) {
    control = useHolderInboxItems(listed);
    return null;
  }
  root = createRoot(document.createElement("div"));
  act(() => root?.render(createElement(Probe, { listed: holdings })));
  return {
    control: () => control,
    list: (listed: readonly InboxHolding[]) =>
      act(() => root?.render(createElement(Probe, { listed }))),
  };
}

test("each listed plan is pending until its inbox is pushed, every push replaces its items, and a plan let go of keeps its last ones", async () => {
  const main = followedInboxes(() => ({ items: [ITEM] }));
  bridge(main);
  const { control, list } = mount([holding("acme-plan")]);
  const before = control()?.pending;
  await settle();
  const pushed = control()?.pending;
  const answered = { ...ITEM, revision: 2, status: INBOX_STATUS.ANSWERED };
  main.push({ kind: "plan", id: "acme-plan" }, { items: [answered] });
  await settle();
  const after = control()?.items[INBOX_SCOPE_KIND.PLAN].get("acme-plan");
  list([]);
  await settle();

  assert.deepEqual([before, pushed], [true, false]);
  assert.deepEqual(after, [answered]);
  assert.equal(main.isFollowed({ kind: "plan", id: "acme-plan" }), false);
  assert.deepEqual(control()?.items[INBOX_SCOPE_KIND.PLAN].get("acme-plan"), [answered]);
  assert.deepEqual(main.asked, ["plan:acme-plan"]);
});

test("a plan main says changed later than its last push is pending until a push catches up, its items standing meanwhile", async () => {
  const main = followedInboxes(() => ({ items: [ITEM] }));
  bridge(main);
  const { control, list } = mount([holding("acme-plan")]);
  await settle();
  const pushed = control()?.pending;
  list([{ ...holding("acme-plan"), updatedAt: 2 }]);
  const behind = [control()?.pending, control()?.current[INBOX_SCOPE_KIND.PLAN].has("acme-plan")];
  main.push({ kind: "plan", id: "acme-plan" }, { items: [{ ...ITEM, updatedAt: 2 }] });
  await settle();

  assert.deepEqual([pushed, ...behind], [false, true, false]);
  assert.equal(control()?.pending, false);
  assert.deepEqual(control()?.current[INBOX_SCOPE_KIND.PLAN], new Set(["acme-plan"]));
});

test("an agent whose push holds a newer settled thread is still pending until its open question main lists is pushed as new as main says", async () => {
  // The agent's open question at 50 and a settled thread at 100, as its push first holds them.
  const settled = {
    ...ITEM,
    id: "5e4f5a6b-7c8d-4e9f-8a0b-1c2d3e4f5a6b",
    status: INBOX_STATUS.ANSWERED,
    updatedAt: 100,
  };
  const main = followedInboxes(() => ({ items: [{ ...ITEM, updatedAt: 50 }, settled] }));
  bridge(main);
  const agent = (updatedAt: number): InboxHolding => ({
    kind: INBOX_SCOPE_KIND.AGENT,
    id: ITEM.agentId,
    updatedAt,
    listed: [{ id: ITEM.id, updatedAt }],
  });
  const { control, list } = mount([agent(50)]);
  await settle();
  const pushed = control()?.pending;
  // Main says the question changed at 80, which the newer settled thread says nothing of.
  list([agent(80)]);
  const behind = control()?.pending;
  main.push({ kind: "agent", id: ITEM.agentId }, { items: [{ ...ITEM, updatedAt: 80 }, settled] });
  await settle();

  assert.deepEqual([pushed, behind, control()?.pending], [false, true, false]);
});

test("a plan that could not be read says so only while it is listed, is let go, and is followed again on Try again", async () => {
  // The service refuses Personal's task, until it is asked again, and answers Acme's with nothing waiting.
  let refuse = true;
  const main = followedInboxes(({ id }) =>
    id === "personal-plan" && refuse
      ? { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED }
      : { items: [] },
  );
  bridge(main);
  const { control, list } = mount([holding("personal-plan")]);
  await settle();
  const failed = control()?.failed;
  const followed = main.isFollowed({ kind: "plan", id: "personal-plan" });
  list([holding("acme-plan")]);
  await settle();
  const elsewhere = control()?.failed;

  list([holding("personal-plan")]);
  refuse = false;
  act(() => control()?.onRetry());
  await settle();

  assert.deepEqual([failed, followed, elsewhere], [true, false, false]);
  assert.equal(control()?.failed, false);
  assert.deepEqual(control()?.items[INBOX_SCOPE_KIND.PLAN].get("personal-plan"), []);
  assert.deepEqual(main.asked, ["plan:personal-plan", "plan:acme-plan", "plan:personal-plan"]);
});
