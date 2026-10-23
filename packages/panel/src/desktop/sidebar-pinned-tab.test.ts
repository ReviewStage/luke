// @vitest-environment jsdom

import assert from "node:assert/strict";
import { MOTION_DELAY_MS } from "@luke/brand";
import { CHECK_SUMMARY, PULL_REQUEST_STATE } from "@luke/features/coding-agent-wire";
import type { TaskSummary } from "@luke/features/task-wire";
import { ACT_KIND } from "@luke/host/acts";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import type { PinnedTab } from "../tasks/use-side-panel.js";
import { type AnyAct, FAKE_ANSWER, type FakeActAnswer, fakeActs } from "../testing/app-bridge.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { restOn } from "../testing/hint-rest.js";
import { tasksControl } from "../testing/tasks-control.js";
import { SidebarPinnedTab } from "./sidebar-pinned-tab.js";

/**
 * sidebar-pinned-tab.test.ts -- an agent's pin in the sidebar reads the pull
 * request its agent opened only once its card shows: a pointer crossing the
 * row asks the service nothing, and a card hung again soon after shows what
 * the first read without asking again, while one hung after a read that
 * failed asks again. The service is a script at the act
 * boundary; synthetic ids throughout.
 */

const TASK: TaskSummary = {
  id: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
  workspaceId: "workspace",
  name: "Teammate invitations",
  createdAt: 1,
  updatedAt: 2,
  repository: "acme/relay",
};

const AGENT = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";

const PIN: PinnedTab = { task: TASK.id, tab: { agent: AGENT }, label: "Expiry job", at: 1 };

/** Each pull request read the service was asked, by agent. */
let reads: string[] = [];
/** How many pull request reads the service refuses before it answers. */
let refusing = 0;
let root: Root | undefined;

beforeEach(() => {
  reads = [];
  refusing = 0;
  fakeActs({
    act: (request: AnyAct): Promise<FakeActAnswer> => {
      if (request.kind === ACT_KIND.CODING_AGENTS_PULL_REQUEST) {
        reads.push(request.payload.agentId);
        if (refusing > 0) {
          refusing -= 1;
          return Promise.resolve({ status: FAKE_ANSWER.REFUSED, reason: "Unreachable." });
        }
        const pullRequest = {
          number: 42,
          title: "Expire invitations",
          url: "https://github.com/acme/relay/pull/42",
          state: PULL_REQUEST_STATE.OPEN,
          checks: CHECK_SUMMARY.PASSING,
          additions: 4,
          deletions: 1,
          changedFiles: 1,
        };
        const value = { repository: "acme/relay", branch: "luke/expiry", pullRequest };
        return Promise.resolve({ status: FAKE_ANSWER.DONE, value });
      }
      return Promise.resolve({ status: FAKE_ANSWER.REFUSED, reason: "Not in this test." });
    },
  });
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  vi.useRealTimers();
  document.body.replaceChildren();
});

/** The pin's row drawn in the sidebar's list, answering its press. */
function drawPin(pin: PinnedTab = PIN, task: TaskSummary = TASK): HTMLElement {
  const list = document.body.appendChild(document.createElement("ul"));
  root = createRoot(list);
  act(() =>
    root?.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(SidebarPinnedTab, {
          tasks: tasksControl({ tasks: [task] }),
          pin,
          task,
          current: false,
          inSight: true,
          onOpen: () => undefined,
          onOpenTask: () => undefined,
        }),
      ),
    ),
  );
  return list.querySelector<HTMLElement>("button.luke-list-row-main") ?? assert.fail("the row");
}

async function settled(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
}

/** The pointer leaving the row for somewhere else, as a browser tells the row and the press. */
function leave(press: HTMLElement): void {
  const outside = document.body.appendChild(document.createElement("div"));
  act(() => {
    press.dispatchEvent(new MouseEvent("pointerout", { bubbles: true, relatedTarget: outside }));
    press.dispatchEvent(new MouseEvent("pointerleave", { relatedTarget: outside }));
    press.parentElement?.dispatchEvent(new MouseEvent("pointerleave", { relatedTarget: outside }));
    outside.dispatchEvent(new MouseEvent("pointerover", { bubbles: true, relatedTarget: press }));
  });
}

const card = () => document.querySelector(".luke-tooltip-card [data-pinned-tab-card]");

test("a pointer crossing a pinned agent's row asks the service nothing", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  const press = drawPin();
  act(() => {
    press.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
  });
  act(() => {
    vi.advanceTimersByTime(MOTION_DELAY_MS.HINT / 2);
  });
  leave(press);
  act(() => {
    vi.advanceTimersByTime(2 * MOTION_DELAY_MS.HINT);
  });
  await settled();
  assert.equal(card(), null);
  assert.deepEqual(reads, []);
});

test("a pinned agent's card reads its pull request as it shows, and hung again soon after shows it without asking again", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  const press = drawPin();
  restOn(press);
  await settled();
  assert.deepEqual(reads, [AGENT]);
  assert.match(card()?.textContent ?? "", /Expire invitations/u);

  leave(press);
  act(() => {
    vi.advanceTimersByTime(2 * MOTION_DELAY_MS.HINT);
  });
  assert.equal(card(), null, "the card has gone");
  restOn(press);
  await settled();
  assert.match(card()?.textContent ?? "", /Expire invitations/u);
  assert.deepEqual(reads, [AGENT], "one read for both cards");
});

test("a pinned agent's card hung again after its read failed asks again, and shows the pull request the service now answers", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  refusing = 1;
  const press = drawPin();
  restOn(press);
  await settled();
  assert.ok(card() !== null, "the card stands");
  assert.doesNotMatch(card()?.textContent ?? "", /Expire invitations/u);

  leave(press);
  act(() => {
    vi.advanceTimersByTime(2 * MOTION_DELAY_MS.HINT);
  });
  restOn(press);
  await settled();
  assert.deepEqual(reads, [AGENT, AGENT]);
  assert.match(card()?.textContent ?? "", /Expire invitations/u);
});

test("a pinned Changes tab wears its pull request's mark and current label where its task's row holds the pull request, and the grey icon and pinned label where it holds none", () => {
  const pin: PinnedTab = { task: TASK.id, tab: { changes: AGENT }, label: "#42 Old title", at: 1 };
  const held: TaskSummary = {
    ...TASK,
    agents: {
      total: 1,
      working: 0,
      agents: [],
      pullRequestTotal: 1,
      pullRequests: [
        {
          number: 42,
          title: "Expire invitations",
          state: PULL_REQUEST_STATE.MERGED,
          checks: CHECK_SUMMARY.PASSING,
          additions: 4,
          deletions: 1,
          agentId: AGENT,
        },
      ],
    },
  };
  const live = drawPin(pin, held);
  assert.equal(live.textContent, "#42 Expire invitations");
  assert.equal(
    live.querySelector("[data-pull-request-mark]")?.getAttribute("data-pull-request-state"),
    PULL_REQUEST_STATE.MERGED,
  );

  act(() => root?.unmount());
  document.body.replaceChildren();
  const unknown = drawPin(pin, TASK);
  assert.equal(unknown.textContent, "#42 Old title");
  assert.equal(unknown.querySelector("[data-pull-request-mark]"), null);
});
