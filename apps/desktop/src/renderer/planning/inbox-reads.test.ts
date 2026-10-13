// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import type { AppInboxPlan, AppInboxPlanHolding } from "#shared/messages/app-state";
import { type InboxReadsControl, useInboxReads } from "./inbox-reads";

const PLAN = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
const OTHER = "9d2b7b5a-4e3f-4e9c-9c77-7a5d8b3f4c32";
const ITEM_A = "a1b2c3d4-0000-4000-8000-000000000001";
const ITEM_B = "a1b2c3d4-0000-4000-8000-000000000002";
const ITEM_C = "a1b2c3d4-0000-4000-8000-000000000003";

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  window.localStorage.clear();
});

/** The marks over what waits, mounted as the plans tab holds them, read back through the control. */
function mount(
  waiting: readonly AppInboxPlan[],
  staged = false,
  holding: readonly AppInboxPlanHolding[] = [],
): () => InboxReadsControl {
  let control: InboxReadsControl | undefined;
  function Probe() {
    control = useInboxReads(waiting, holding, staged);
    return null;
  }
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  roots.push(root);
  act(() => root.render(createElement(Probe)));
  return () => {
    assert.ok(control);
    return control;
  };
}

test("the counts are each plan's waiting items not yet shown, every plan's summed, and marks made on screen last across a launch", () => {
  const waiting = [
    { planId: PLAN, items: [ITEM_A, ITEM_B] },
    { planId: OTHER, items: [ITEM_C] },
  ];
  const first = mount(waiting);
  assert.equal(first().total, 3);
  act(() => first().onSeen(PLAN, [ITEM_A, ITEM_B]));
  assert.equal(first().unread(PLAN), 0);
  assert.equal(first().unread(OTHER), 1);
  assert.equal(first().total, 1);

  const relaunched = mount(waiting);
  assert.equal(relaunched().unread(PLAN), 0);
  assert.equal(relaunched().total, 1);
});

test("a fixture run's marks are kept nowhere", () => {
  const waiting = [{ planId: PLAN, items: [ITEM_A] }];
  const staged = mount(waiting, true);
  act(() => staged().onSeen(PLAN, [ITEM_A]));
  assert.equal(staged().total, 0);

  assert.equal(mount(waiting)().total, 1);
});

test("the marks follow main's read on their own: an item seen, answered, and posted again with no board on screen counts as unread", () => {
  const holding = [{ planId: PLAN, items: 1, updatedAt: 1 }];
  let waiting: readonly AppInboxPlan[] = [{ planId: PLAN, items: [ITEM_A] }];
  let control: InboxReadsControl | undefined;
  let restand: ((next: readonly AppInboxPlan[]) => void) | undefined;
  function Probe() {
    const [standing, setStanding] = useState(waiting);
    restand = setStanding;
    control = useInboxReads(standing, holding, false);
    return null;
  }
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  roots.push(root);
  act(() => root.render(createElement(Probe)));
  act(() => control?.onSeen(PLAN, [ITEM_A]));
  assert.equal(control?.total, 0);

  waiting = [];
  act(() => restand?.(waiting));
  waiting = [{ planId: PLAN, items: [ITEM_A] }];
  act(() => restand?.(waiting));
  assert.equal(control?.total, 1);
});
