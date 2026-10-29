// @vitest-environment jsdom

import assert from "node:assert/strict";
import { INBOX_SCOPE_KIND } from "@luke/features/agent-view";
import {
  INBOX_ASK,
  INBOX_ASK_STATUS,
  INBOX_MESSAGE_AUTHOR,
  INBOX_STATUS,
  type InboxItem,
} from "@luke/features/inbox-wire";
import { ACT_KIND } from "@luke/host/acts";
import { UNREAD } from "@luke/host/app-state";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { fakeActPort, fakeActPortCalls } from "../testing/app-bridge.js";
import { handInboxItems } from "../testing/app-state.js";
import { onRegistry } from "../testing/copy-feedback.js";
import {
  type HolderInboxItems,
  type InboxHolding,
  useHolderInboxItems,
} from "./use-holder-inbox-items.js";

/**
 * use-holder-inbox-items.test.ts -- the window's Inbox draws each listed
 * task's items from the account's feed in app state: pending until the feed
 * answers or catches up with main's word of a task, holding nothing of a
 * task the feed holds nothing of, saying the feed could not be read only
 * while it lists a task, and asking the host to read it again on Try again.
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

/** The account's feed holding the plans given, and no agent with no task. */
function fed(plans: Readonly<Record<string, readonly InboxItem[]>>) {
  return { rows: { [INBOX_SCOPE_KIND.PLAN]: plans, [INBOX_SCOPE_KIND.AGENT]: {} } };
}

function mount(holdings: readonly InboxHolding[]) {
  let control: HolderInboxItems | undefined;
  function Probe({ listed }: { listed: readonly InboxHolding[] }) {
    control = useHolderInboxItems(listed);
    return null;
  }
  const registry = AtomRegistry.make();
  root = createRoot(document.createElement("div"));
  const draw = (listed: readonly InboxHolding[]) =>
    act(() => root?.render(onRegistry(registry, createElement(Probe, { listed }))));
  draw(holdings);
  return { control: () => control, list: draw };
}

test("each listed plan is pending until the account's feed first answers, then holds what the feed holds of it, one it holds nothing of holding nothing now", async () => {
  const deliver = handInboxItems(UNREAD);
  const { control } = mount([holding("acme-plan"), holding("personal-plan")]);
  await settle();
  const before = control()?.pending;
  deliver(fed({ "acme-plan": [ITEM] }));
  await settle();

  assert.equal(before, true);
  assert.equal(control()?.pending, false);
  assert.deepEqual(control()?.items[INBOX_SCOPE_KIND.PLAN].get("acme-plan"), [ITEM]);
  assert.deepEqual(control()?.items[INBOX_SCOPE_KIND.PLAN].get("personal-plan"), []);
});

test("a plan main says changed later than the feed holds it is pending until the feed catches up, its items standing meanwhile", async () => {
  const deliver = handInboxItems(fed({ "acme-plan": [ITEM] }));
  const { control, list } = mount([holding("acme-plan")]);
  await settle();
  const answered = control()?.pending;
  list([{ ...holding("acme-plan"), updatedAt: 2 }]);
  const behind = [control()?.pending, control()?.items[INBOX_SCOPE_KIND.PLAN].get("acme-plan")];
  deliver(fed({ "acme-plan": [{ ...ITEM, updatedAt: 2 }] }));
  await settle();

  assert.deepEqual([answered, ...behind], [false, true, [ITEM]]);
  assert.equal(control()?.pending, false);
  assert.deepEqual(control()?.current[INBOX_SCOPE_KIND.PLAN], new Set(["acme-plan"]));
});

test("a feed refused before it ever answered says so only while a plan is listed, and Try again asks the host to read it again", async () => {
  handInboxItems({ failed: true });
  let retried = 0;
  fakeActPort({
    ...fakeActPortCalls(),
    [ACT_KIND.AGENTS_INBOX_ITEMS_RETRY]: () => {
      retried += 1;
      return Promise.resolve(undefined);
    },
  });
  const { control, list } = mount([holding("acme-plan")]);
  await settle();
  const failed = control()?.failed;
  list([]);
  const unlisted = control()?.failed;
  list([holding("acme-plan")]);
  act(() => control()?.onRetry());
  await settle();

  assert.deepEqual([failed, unlisted], [true, false]);
  assert.equal(retried, 1);
});
