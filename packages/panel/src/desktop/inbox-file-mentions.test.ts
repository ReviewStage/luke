// @vitest-environment jsdom

import assert from "node:assert/strict";
import { CODING_AGENT_STATUS, type CodingAgentSummary } from "@luke/features/coding-agent-wire";
import {
  INBOX_MESSAGE_AUTHOR,
  INBOX_STATUS,
  INBOX_WIRE_VERSION,
  type InboxItem,
} from "@luke/features/inbox-wire";
import type { ReadLink } from "@luke/features/link-grammar";
import type { CodeRef, TaskSummary } from "@luke/features/task-wire";
import { WORKSPACE_ROLE, type Workspace } from "@luke/features/workspace-wire";
import { ACT_KIND } from "@luke/host/acts";
import { NO_EXPERIMENTS } from "@luke/settings";
import { Effect } from "effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test } from "vitest";
import { installPressIntent } from "../press-intent.js";
import { useInboxTaskAgents } from "../tasks/use-inbox-task-agents.js";
import { OpenLinkProvider } from "../tasks/use-open-link.js";
import { useSidePanel } from "../tasks/use-side-panel.js";
import type { InboxChoice } from "../tasks/use-tasks-tab.js";
import {
  type AnyAct,
  FAKE_ANSWER,
  type FakeActAnswer,
  fakeActPort,
  fakeActPortCalls,
  fakeActs,
} from "../testing/app-bridge.js";
import { fakeAppPlatform, QUIET_PANEL } from "../testing/app-platform.js";
import { handState } from "../testing/app-state.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { followedInboxes } from "../testing/followed-inboxes.js";
import { markdownHtmlParserLanded } from "../testing/markdown.js";
import { tasksControl, waitingOf } from "../testing/tasks-control.js";
import { DesktopInbox } from "./desktop-inbox.js";

/**
 * inbox-file-mentions.test.ts -- a file an item of a task names in its
 * words opens as the item's code does: beside the Inbox as the panel's
 * preview, and pressed with ⌘, on the task, at the lines and commit it
 * names; written in the older `luke://file/` form, which is no GitHub
 * page to fall back on, as much as in the settled one. Synthetic
 * workspace, plan, agent, and file.
 */

// A Markdown block is drawn once the parser has landed, as the panel lands it after its first paint.
beforeAll(() => Effect.runPromise(markdownHtmlParserLanded));

const ACME: Workspace = {
  id: "workspace-acme",
  name: "Acme",
  slug: "acme",
  role: WORKSPACE_ROLE.MEMBER,
  github: { login: "acme", active: true },
  memberCount: 2,
};

const TASK: TaskSummary = {
  id: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
  workspaceId: ACME.id,
  name: "Teammate invitations",
  createdAt: 1,
  updatedAt: 2,
  repository: "acme/relay",
};

const AGENT: CodingAgentSummary = {
  id: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21",
  planId: TASK.id,
  model: "anthropic/claude-opus-5.5",
  effort: "high",
  title: "Batch the invitations",
  createdAt: 3,
  status: CODING_AGENT_STATUS.COMPLETED,
  turnId: null,
};

/** The commit the item's lines were read at. */
const COMMIT = "0123456789abcdef0123456789abcdef01234567";

/** The item's words, naming a file in the older form and three of its lines at a commit. */
const WORDS = [
  "The change is in [@invites.ts](luke://file/src/invites.ts).",
  `The batch is [@invites.ts:3–5](https://github.com/acme/relay/blob/${COMMIT}/src/invites.ts#L3-L5).`,
].join(" ");

const ITEM: InboxItem = {
  id: "a1b2c3d4-0000-4000-8000-000000000001",
  agentId: AGENT.id,
  key: "0001",
  revision: 1,
  version: INBOX_WIRE_VERSION,
  title: "Ready for a look",
  needsReply: false,
  status: INBOX_STATUS.OPEN,
  thread: [
    {
      id: "e1b2c3d4-0000-4000-8000-000000000001",
      author: INBOX_MESSAGE_AUTHOR.AGENT,
      text: WORDS,
      createdAt: 1_000,
    },
  ],
  postedAt: 1_000,
  updatedAt: 2_000,
};

let root: Root | undefined;

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

/** The host's inbox streams for the window, the task's inbox pushed as holding the one item. */
const follows = followedInboxes(() => ({ items: [ITEM] }));

function answer(request: AnyAct): Promise<FakeActAnswer> {
  if (request.kind === ACT_KIND.CODING_AGENTS_LIST) {
    return Promise.resolve({ status: FAKE_ANSWER.DONE, value: { agents: [AGENT] } });
  }
  return Promise.resolve({ status: FAKE_ANSWER.REFUSED, reason: "Not in this test." });
}

/** Lets every promise settled so far run its continuations. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 16; tick += 1) await Promise.resolve();
  });
}

/** The window's Inbox on the plan's item, its side panel the window's own hook, and every place it was asked to leave for. */
async function inbox() {
  const links: ReadLink[] = [];
  /** Each file asked for on a task, and each tab asked for on a task the window was to go to. */
  const went: string[] = [];
  fakeAppPlatform(QUIET_PANEL);
  fakeActs({ act: answer });
  fakeActPort({ ...fakeActPortCalls(), ...follows.procedures });
  handState(NO_EXPERIMENTS);
  function Page() {
    const [chosen, setChosen] = useState<InboxChoice | undefined>(undefined);
    const [listed, setListed] = useState(false);
    const panelFor = chosen !== undefined && "taskId" in chosen ? chosen.taskId : undefined;
    const taskAgents = useInboxTaskAgents(panelFor);
    const sidePanel = useSidePanel(
      undefined,
      { id: panelFor, holds: {}, bare: true },
      [],
      [],
      [],
      [],
      taskAgents.agentIds,
      undefined,
      undefined,
      taskAgents.heldIds,
    );
    return createElement(
      OpenLinkProvider,
      { value: (link: ReadLink) => links.push(link) },
      createElement(DesktopInbox, {
        tasks: tasksControl({
          workspace: ACME,
          tasks: [TASK],
          inbox: [{ taskId: TASK.id, items: [waitingOf(ITEM)] }],
          inboxTasks: [{ taskId: TASK.id, items: 1, updatedAt: 2_000 }],
          inboxView: {
            open: true,
            chosen,
            onOpen: () => undefined,
            onClose: () => undefined,
            onChoose: setChosen,
            onOpenItem: () => undefined,
            onOpenChannel: () => undefined,
            listed,
            onListed: setListed,
            pages: [],
            onTaskAgents: taskAgents.onRead,
          },
          sidePanel,
          onShowFile: (taskId: string, ref: CodeRef, commit: string | undefined) =>
            went.push(`${taskId} file ${JSON.stringify(ref)} ${commit}`),
          onShowPanelTab: (taskId, tab) => went.push(`${taskId} ${JSON.stringify(tab)}`),
        }),
      }),
    );
  }
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() => root?.render(onRegistry(AtomRegistry.make(), createElement(Page))));
  await settle();
  return { container, links, went };
}

/** Presses the chip of the item's words that says the name given, with ⌘ where asked. */
async function pressChip(
  container: HTMLElement,
  name: string,
  { command }: { command: boolean } = { command: false },
): Promise<void> {
  const chip = [
    ...container.querySelectorAll<HTMLElement>("[data-inbox-message-text] [data-mention-ref]"),
  ].find((each) => each.querySelector(".luke-inline-ref-label")?.textContent === name);
  assert.ok(chip, `no chip says ${name}`);
  act(() => {
    chip.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, metaKey: command }),
    );
  });
  await settle();
}

/** The panel beside the Inbox as a reader hears it: each tab's label, `▸ ` before the one shown; nothing where no panel stands. */
function panelTabs(container: HTMLElement): string[] | undefined {
  const panel = container.querySelector('aside[aria-label="Panel"]');
  if (panel === null) return undefined;
  return [...panel.querySelectorAll<HTMLElement>('[role="tab"]')].map(
    (tab) => `${tab.getAttribute("aria-selected") === "true" ? "▸ " : ""}${tab.textContent}`,
  );
}

test("a file an item of a task names in the older form opens beside the Inbox as the panel's preview, the Inbox still standing", async () => {
  const { container, links, went } = await inbox();
  assert.equal(panelTabs(container), undefined, "no panel stands until the item opens one");

  await pressChip(container, "invites.ts");

  assert.deepEqual(panelTabs(container), ["▸ invites.ts"]);
  assert.ok(container.querySelector(".inbox-view"), "the Inbox still stands");
  assert.deepEqual([...links, ...went], [], "nothing left the Inbox");
});

test("a file an item of a task names, pressed with ⌘, goes to the task on its tab, and its lines to the task at their commit", async () => {
  const stop = installPressIntent(window);
  try {
    const { container, links, went } = await inbox();

    await pressChip(container, "invites.ts", { command: true });
    await pressChip(container, "invites.ts:3–5", { command: true });

    assert.deepEqual(went, [
      `${TASK.id} ${JSON.stringify({ file: "src/invites.ts" })}`,
      `${TASK.id} file ${JSON.stringify({ path: "src/invites.ts", startLine: 3, endLine: 5 })} ${COMMIT}`,
    ]);
    assert.deepEqual(links, [], "nothing opened as a link");
  } finally {
    stop();
  }
});
