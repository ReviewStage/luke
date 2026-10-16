// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { CodingAgentInboxAnswerView } from "@luke/features/coding-agent-view";
import { CODING_AGENT_CALL_FAILURE } from "@luke/features/coding-agent-view";
import { INBOX_CURSOR_START } from "@luke/features/inbox-wire";
import type { AppInboxTaskHolding } from "@luke/host/app-state";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { type InboxItemsControl, useInboxItems } from "./use-inbox-items";

/**
 * use-inbox-items.test.ts -- the window's Inbox reads each listed plan's
 * items, and says a read failed only of a plan it still lists, so a
 * workspace switched to is not told of another's failure.
 */

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
});

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
}

const holding = (planId: string): AppInboxTaskHolding => ({
  taskId: planId,
  items: 1,
  updatedAt: 1,
});

test("a read that failed for a plan another workspace listed says nothing once the list holds only plans that read", async () => {
  // The service refuses Personal's plan and answers Acme's with nothing waiting.
  const readInbox = ({ taskId: planId }: { taskId: string }): Promise<CodingAgentInboxAnswerView> =>
    Promise.resolve(
      planId === "personal-plan"
        ? { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED }
        : { items: [], cursor: INBOX_CURSOR_START },
    );
  let control: InboxItemsControl | undefined;
  function Probe({ holdings }: { holdings: readonly AppInboxTaskHolding[] }) {
    control = useInboxItems({ holdings, readInbox });
    return null;
  }
  root = createRoot(document.createElement("div"));
  act(() => root?.render(createElement(Probe, { holdings: [holding("personal-plan")] })));
  await settle();
  const before = control?.failed;
  act(() => root?.render(createElement(Probe, { holdings: [holding("acme-plan")] })));
  await settle();

  assert.equal(before, true);
  assert.equal(control?.failed, false);
});

test("a plan that changed since its items were read is pending until a read of it answers, its old items standing meanwhile", async () => {
  const answers: ((answer: CodingAgentInboxAnswerView) => void)[] = [];
  const readInbox = (): Promise<CodingAgentInboxAnswerView> =>
    new Promise((resolve) => answers.push(resolve));
  let control: InboxItemsControl | undefined;
  function Probe({ holdings }: { holdings: readonly AppInboxTaskHolding[] }) {
    control = useInboxItems({ holdings, readInbox });
    return null;
  }
  root = createRoot(document.createElement("div"));
  act(() => root?.render(createElement(Probe, { holdings: [holding("acme-plan")] })));
  const unread = control?.pending;
  await act(async () => answers[0]?.({ items: [], cursor: INBOX_CURSOR_START }));
  await settle();
  const read = control?.pending;
  act(() =>
    root?.render(createElement(Probe, { holdings: [{ ...holding("acme-plan"), updatedAt: 2 }] })),
  );
  await settle();

  assert.deepEqual([unread, read, control?.pending], [true, false, true]);
  assert.deepEqual(control?.items.get("acme-plan"), []);
});
