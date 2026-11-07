// @vitest-environment jsdom

import assert from "node:assert/strict";
import { INBOX_SCOPE_KIND } from "@repo/features/agent-view";
import { AGENT_STATUS, type AgentSummary } from "@repo/features/agent-wire";
import {
  INBOX_ASK,
  INBOX_ASK_STATUS,
  INBOX_MESSAGE_AUTHOR,
  INBOX_STATUS,
  INBOX_WIRE_VERSION,
  type InboxItem,
} from "@repo/features/inbox-wire";
import type { Task } from "@repo/features/task-wire";
import { APP_COMMAND } from "@repo/settings/shortcuts";
import { agentTab } from "@repo/ui/tab-strip-model";
import { DOCUMENT_REGION, TASKS_PAGE } from "@repo/ui/tasks-model";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { runAppCommand } from "../app-commands.js";
import { NO_LOOKS } from "../tasks/use-task-looks.js";
import { handInboxItems } from "../testing/app-state.js";
import { onRegistry, settleQueries } from "../testing/copy-feedback.js";
import { installScrollIntoView } from "../testing/scroll-into-view.js";
import { agentsControl, pushedTranscripts, tasksControl } from "../testing/tasks-control.js";
import { DesktopTasks } from "./desktop-tasks.js";

/**
 * agent-threads.test.ts -- the dock over an agent's box opens the agent's
 * threads in its card, in its transcript's place: the Inbox's list of its
 * items alone beside the thread the dock names, the oldest waiting, or,
 * with none waiting on the reader, the latest changed; Escape gives the
 * card its transcript back. Synthetic throughout.
 */

const TASK: Task = {
  id: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
  workspaceId: "workspace-personal",
  name: "Teammate invitations",
  createdAt: 1,
  updatedAt: 2,
  repository: "acme/web",
  document: { body: "", assumptions: [] },
};

const AGENT: AgentSummary = {
  id: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21",
  planId: TASK.id,
  model: "anthropic/claude-opus-5.5",
  effort: "high",
  title: "Invite expiry job",
  createdAt: 1,
  status: AGENT_STATUS.COMPLETED,
  turnId: null,
};

const OTHER_AGENT = "4d2f1c7e-9a3b-4e8d-b1c6-2f7a8e9d0b13";

/** An open item asking a decision, posted by `agentId` at `at`. */
function item(id: string, agentId: string, title: string, at: number): InboxItem {
  return {
    id,
    agentId,
    key: id,
    revision: 1,
    version: INBOX_WIRE_VERSION,
    title,
    needsReply: true,
    status: INBOX_STATUS.OPEN,
    thread: [
      {
        id: `m${id.slice(1)}`,
        author: INBOX_MESSAGE_AUTHOR.AGENT,
        text: "Which one?",
        ask: {
          type: INBOX_ASK.DECIDE,
          options: [{ label: "Yes" }, { label: "No" }],
          status: INBOX_ASK_STATUS.OPEN,
        },
        createdAt: at,
      },
    ],
    postedAt: at,
    updatedAt: at,
  };
}

/** Two of the agent's threads, the older first, and another agent's on the same task. */
const ITEMS: readonly InboxItem[] = [
  item("a1b2c3d4-0000-4000-8000-000000000001", AGENT.id, "Invite TTL", 10),
  item("a1b2c3d4-0000-4000-8000-000000000002", AGENT.id, "Which SMTP host?", 30),
  item("a1b2c3d4-0000-4000-8000-000000000003", OTHER_AGENT, "Someone else's", 20),
];

const roots: Root[] = [];

beforeEach(installScrollIntoView);

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

/** The task's page on the agent's tab, wide enough for the list and the thread side by side; where it leaves for the window's Inbox; and which agent it says shows its threads, the latest last. */
async function mount(
  items: readonly InboxItem[] = ITEMS,
  me?: string,
): Promise<{
  container: HTMLElement;
  inboxes: unknown[];
  covered: (string | undefined)[];
}> {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({
      matches: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    DOMRect.fromRect({ width: 1200, height: 800 }),
  );
  handInboxItems({
    rows: { [INBOX_SCOPE_KIND.PLAN]: { [TASK.id]: items }, [INBOX_SCOPE_KIND.AGENT]: {} },
  });
  pushedTranscripts(() => [
    { messages: [], cursor: "1:0", status: AGENT_STATUS.COMPLETED, title: null },
  ]);
  const inboxes: unknown[] = [];
  const covered: (string | undefined)[] = [];
  const control = tasksControl({
    page: TASKS_PAGE.DOCUMENT,
    me,
    activeTaskId: TASK.id,
    region: { kind: DOCUMENT_REGION.READY, task: TASK },
    mainTabs: {
      ...tasksControl().mainTabs,
      tabs: [agentTab(AGENT.id)],
      tab: agentTab(AGENT.id),
      openAgents: [AGENT.id],
    },
    agents: agentsControl({ agents: [AGENT], agentIds: [AGENT.id, OTHER_AGENT] }),
    onShowInbox: (choice) => inboxes.push(choice),
    onThreadsShown: (agentId) => covered.push(agentId),
  });
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(DesktopTasks, { looks: NO_LOOKS, tasks: control }),
      ),
    ),
  );
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
  await settleQueries();
  return { container, inboxes, covered };
}

test("the dock opens the agent's threads in its card on the oldest waiting, its own alone, and Escape gives the transcript back", async () => {
  const { container, inboxes, covered } = await mount();
  const transcript = container.querySelector<HTMLElement>(".desktop-agent");
  const dock =
    container.querySelector<HTMLElement>(
      ".agent-threads-dock [role='button'], .agent-threads-dock button",
    ) ?? assert.fail("the agent's box docks its waiting threads");
  act(() => dock.click());

  assert.deepEqual(inboxes, [], "the dock leaves the task for no Inbox");
  const threads =
    container.querySelector<HTMLElement>(".agent-threads") ??
    assert.fail("the card shows the agent's threads");
  assert.equal(transcript?.hidden, true, "the transcript stands hidden beneath them");
  assert.equal(covered.at(-1), AGENT.id, "main is told the transcript is out of sight");
  const list = threads.querySelector("nav")?.textContent ?? "";
  assert.match(list, /Invite TTL/u);
  assert.match(list, /Which SMTP host\?/u);
  assert.doesNotMatch(list, /Someone else's/u, "another agent's thread is not listed");
  assert.equal(
    threads.querySelector("section[aria-label]")?.getAttribute("aria-label"),
    "Invite TTL",
    "the thread shown is the oldest waiting",
  );

  act(() => {
    assert.ok(runAppCommand(APP_COMMAND.EXIT_AGENT_THREADS), "Escape goes back to the transcript");
  });
  assert.equal(container.querySelector(".agent-threads"), null);
  assert.equal(container.querySelector<HTMLElement>(".desktop-agent")?.hidden, false);
  assert.equal(covered.at(-1), undefined, "and in sight again");
});

test("with none waiting on the reader, the quiet dock opens the agent's latest changed thread, not its oldest open one", async () => {
  const teammates: InboxItem = {
    ...item("a1b2c3d4-0000-4000-8000-000000000004", AGENT.id, "Asked of a teammate", 10),
    waitsOn: { userId: "user-grace", name: "Grace Hopper" },
  };
  const answered: InboxItem = {
    ...item("a1b2c3d4-0000-4000-8000-000000000005", AGENT.id, "Answered lately", 40),
    status: INBOX_STATUS.ANSWERED,
  };
  const { container } = await mount([teammates, answered], "user-ada");
  const dock =
    container.querySelector<HTMLElement>(
      ".agent-threads-dock [role='button'], .agent-threads-dock button",
    ) ?? assert.fail("the agent's box docks its threads, quiet");
  assert.match(dock.textContent ?? "", /2 threads/u);
  act(() => dock.click());

  assert.equal(
    container.querySelector(".agent-threads section[aria-label]")?.getAttribute("aria-label"),
    "Answered lately",
  );
});
