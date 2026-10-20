// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { BrowserFocus, BrowserKey } from "@luke/features/browser-acts";
import type { CodingAgentInboxAnswerView } from "@luke/features/coding-agent-view";
import {
  CHECK_SUMMARY,
  CODING_AGENT_STATUS,
  type CodingAgentSummary,
  PULL_REQUEST_STATE,
} from "@luke/features/coding-agent-wire";
import {
  INBOX_BLOCK,
  INBOX_RESPONSE,
  INBOX_STATUS,
  INBOX_WIRE_VERSION,
  type InboxItem,
} from "@luke/features/inbox-wire";
import type { ReadLink } from "@luke/features/luke-link";
import { pageFrameUrl } from "@luke/features/page-frame";
import type { PageLine } from "@luke/features/page-wire";
import type { TaskSummary } from "@luke/features/task-wire";
import { WORKSPACE_ROLE, type Workspace } from "@luke/features/workspace-wire";
import { ACT_KIND } from "@luke/host/acts";
import { EXPERIMENT, type ExperimentChoices, NO_EXPERIMENTS } from "@luke/settings";
import { experimentsOn } from "@luke/settings/testing";
import { Effect } from "effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test } from "vitest";
import { useAppKeymap } from "../app-commands.js";
import { useInboxTaskAgents } from "../tasks/use-inbox-task-agents.js";
import { OpenLinkProvider } from "../tasks/use-open-link.js";
import { type SidePanelControl, useSidePanel } from "../tasks/use-side-panel.js";
import type { InboxChoice } from "../tasks/use-tasks-tab.js";
import { type AnyAct, FAKE_ANSWER, type FakeActAnswer, fakeActs } from "../testing/app-bridge.js";
import { fakeAppPlatform, QUIET_PANEL } from "../testing/app-platform.js";
import { handState } from "../testing/app-state.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { markdownHtmlParserLanded } from "../testing/markdown.js";
import { tasksControl, waitingOf } from "../testing/tasks-control.js";
import { DesktopInbox } from "./desktop-inbox.js";

/**
 * inbox-side-panel.test.ts -- what an item of the window's Inbox opens that
 * its task's side panel draws opens in that panel beside the Inbox, the
 * Inbox still standing: a file of the task's repository, a page of the
 * task, and a pull request one of its agents opened. A page of another
 * task still leaves for that task. Synthetic workspace, plan, agent, page,
 * and pull request.
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

/** The task's repository, where its agent opened the pull request. */
const REPOSITORY = "acme/relay";

const TASK: TaskSummary = {
  id: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
  workspaceId: ACME.id,
  name: "Teammate invitations",
  createdAt: 1,
  updatedAt: 2,
  repository: REPOSITORY,
};
const OTHER_TASK = "9d2b7b5a-4e3f-4e9c-9c77-7a5d8b3f4c32";

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

/** An agent of the task archived since, whose Pull request tab the task may still keep. */
const ARCHIVED: CodingAgentSummary = {
  ...AGENT,
  id: "5e7d9c3b-1a2f-4b6e-9d8c-7f6a5b4c3d2e",
  title: "Draft the invitation email",
  createdAt: 2,
  archivedAt: 4,
};

const PULL = "https://github.com/acme/relay/pull/42";

const FUNNEL: PageLine = {
  id: "3f8e2a1b-6c4d-4e5f-8a9b-0c1d2e3f4a5b",
  title: "Invite funnel",
  version: 2,
  at: 1_500,
};

/** The item's words, naming a pull request, a page of its plan, a file of its repository, and a page of another plan. */
const WORDS = [
  `Opened [@relay#42](${PULL}).`,
  `See [@Invite funnel](https://tryluke.dev/acme/plan/${TASK.id}/page/${FUNNEL.id}).`,
  "The change is in [@invites.ts](https://github.com/acme/relay/blob/HEAD/src/invites.ts).",
  `Compare [@Old funnel](https://tryluke.dev/acme/plan/${OTHER_TASK}/page/${FUNNEL.id}).`,
].join(" ");

const ITEM: InboxItem = {
  id: "a1b2c3d4-0000-4000-8000-000000000001",
  agentId: AGENT.id,
  key: "0001",
  revision: 1,
  version: INBOX_WIRE_VERSION,
  title: "Ready for a look",
  blocks: [{ type: INBOX_BLOCK.MARKDOWN, text: WORDS }],
  response: { type: INBOX_RESPONSE.NONE },
  needsReply: false,
  status: INBOX_STATUS.OPEN,
  postedAt: 1_000,
  updatedAt: 2_000,
};

let root: Root | undefined;

beforeEach(() => {
  window.localStorage.clear();
  readMarks = [];
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

/** Answers each act as the service would for the plan, its agent, and the pull request it opened. */
/** Every read mark the Inbox sent, in order. */
let readMarks: string[] = [];

function answer(request: AnyAct): Promise<FakeActAnswer> {
  switch (request.kind) {
    case ACT_KIND.CODING_AGENTS_INBOX_READ_STATE:
      readMarks.push(`${request.payload.unread ? "unread" : "read"}:${request.payload.itemId}`);
      return Promise.resolve({
        status: FAKE_ANSWER.DONE,
        value: { id: request.payload.itemId, unread: request.payload.unread },
      });
    case ACT_KIND.CODING_AGENTS_INBOX:
      // A read past the cursor is held open while nothing changes, as the service holds it.
      return request.payload.after === "0"
        ? Promise.resolve({
            status: FAKE_ANSWER.DONE,
            value: { items: [ITEM], cursor: "1" } satisfies CodingAgentInboxAnswerView,
          })
        : new Promise(() => undefined);
    case ACT_KIND.CODING_AGENTS_LIST:
      return Promise.resolve({
        status: FAKE_ANSWER.DONE,
        value: { agents: [ARCHIVED, AGENT] },
      });
    case ACT_KIND.CODING_AGENTS_PULL_REQUEST:
      return Promise.resolve({
        status: FAKE_ANSWER.DONE,
        value: {
          repository: REPOSITORY,
          branch: "luke/batch-invitations",
          pullRequest: {
            number: 42,
            title: "Send invitations in batches",
            url: PULL,
            state: PULL_REQUEST_STATE.OPEN,
            checks: CHECK_SUMMARY.PASSING,
            additions: 12,
            deletions: 3,
            changedFiles: 2,
          },
        },
      });
    default:
      return Promise.resolve({ status: FAKE_ANSWER.REFUSED, reason: "Not in this test." });
  }
}

/** Main's events on a Browser tab's page, as the test hears the window subscribe to them. */
interface MainBrowserEvents {
  focus?: (focus: BrowserFocus) => void;
  key?: (key: BrowserKey) => void;
}

/** The window's Inbox on the plan's item, its side panel the window's own hook held by the chosen item's plan, and every place it was asked to leave for. */
async function inbox(
  {
    pages,
    experiments = NO_EXPERIMENTS,
  }: {
    pages: readonly PageLine[] | undefined;
    experiments?: ExperimentChoices;
  } = {
    pages: [FUNNEL],
  },
) {
  let control: SidePanelControl | undefined;
  // Main's word on a Browser tab's page: that it took the keyboard, and a chord pressed over it.
  const main: MainBrowserEvents = {};
  const links: ReadLink[] = [];
  const tasks: string[] = [];
  const left = { links, tasks, rereads: 0 };
  fakeAppPlatform({ ...QUIET_PANEL, pageFrameUrl });
  fakeActs({
    act: answer,
    onBrowserState: () => () => undefined,
    onBrowserKey: (listener: (key: BrowserKey) => void) => {
      main.key = listener;
      return () => undefined;
    },
    onBrowserFocus: (listener: (focus: BrowserFocus) => void) => {
      main.focus = listener;
      return () => undefined;
    },
  });
  handState(experiments);
  function Page() {
    const [chosen, setChosen] = useState<InboxChoice | undefined>(undefined);
    // Whether the list was asked for, which the window keeps as the Tasks tab does.
    const [listed, setListed] = useState(false);
    const panelFor = chosen !== undefined && "taskId" in chosen ? chosen.taskId : undefined;
    // The task's agents as the Inbox read them, which the window's own hook holds its panel to (`use-tasks-tab.ts`).
    const taskAgents = useInboxTaskAgents(panelFor);
    const sidePanel = useSidePanel(
      undefined,
      { id: panelFor, holds: {}, bare: true },
      [],
      [],
      [],
      [FUNNEL.id],
      taskAgents.agentIds,
    );
    control = sidePanel;
    // The window's keymap, which hears a chord as the window's root mounts it.
    useAppKeymap(true);
    return createElement(
      OpenLinkProvider,
      { value: (link: ReadLink) => left.links.push(link) },
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
            listed,
            onListed: setListed,
            pages,
            onRereadPages: () => {
              left.rereads += 1;
            },
            onTaskAgents: taskAgents.onRead,
          },
          sidePanel,
          onShowTask: (taskId) => left.tasks.push(taskId),
        }),
      }),
    );
  }
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() => root?.render(onRegistry(AtomRegistry.make(), createElement(Page))));
  await settle();
  const panel = () => {
    assert.ok(control);
    return control;
  };
  return { container, left, panel, main };
}

/** Lets every promise settled so far run its continuations. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 16; tick += 1) await Promise.resolve();
  });
}

/** Presses the chip of the item's words that says the name given. */
async function pressChip(container: HTMLElement, name: string): Promise<void> {
  const chip = [
    ...container.querySelectorAll<HTMLButtonElement>("[data-inbox-markdown] [data-mention-ref]"),
  ].find((each) => each.querySelector(".luke-inline-ref-label")?.textContent?.includes(name));
  assert.ok(chip, `no chip says ${name}`);
  act(() => chip.click());
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

test("a pull request, a page, and a file the item names open as tabs of the panel beside the Inbox, which still stands, and a page of another plan leaves for that plan", async () => {
  const { container, left } = await inbox();
  assert.equal(panelTabs(container), undefined, "no panel stands until the item opens one");

  await pressChip(container, "relay#42");
  await pressChip(container, "Invite funnel");
  await pressChip(container, "invites.ts");
  const tabs = panelTabs(container);
  assert.ok(tabs, "the panel stands beside the Inbox");
  assert.deepEqual(tabs, ["#42 Send invitations in batches", "Invite funnel", "▸ invites.ts"]);
  assert.ok(container.querySelector(".inbox-view"), "the Inbox still stands");
  assert.equal(left.links.length + left.tasks.length, 0, "nothing left the Inbox");

  await pressChip(container, "Old funnel");
  assert.deepEqual(
    left.links.map((link) => link.place),
    [{ kind: "page", planId: OTHER_TASK, pageId: FUNNEL.id }],
  );
  assert.equal(panelTabs(container)?.length, 3, "nothing of another plan opens in the panel");
});

test("a page the item names whose plan's pages did not answer asks for them again, so its tab stands once they do", async () => {
  const { container, left } = await inbox({ pages: undefined });
  await pressChip(container, "Invite funnel");
  assert.equal(left.rereads, 1);
  assert.equal(left.links.length, 0, "the page is still the panel's to open");
});

test("a Browser tab chosen on the item's plan stands chosen in the panel beside the Inbox, and draws its page there", async () => {
  const { container, panel } = await inbox({
    pages: [FUNNEL],
    experiments: experimentsOn(EXPERIMENT.BROWSER),
  });
  await pressChip(container, "invites.ts");
  act(() => panel().onOpenBrowser("http://localhost:3000/"));
  await settle();

  assert.deepEqual(panelTabs(container), ["invites.ts", "▸ Browser"]);
  const content = container.querySelector('aside[aria-label="Panel"] [role="tabpanel"]');
  assert.ok(
    content?.querySelector('section[aria-label="Browser"]'),
    "the Browser tab's pane is drawn",
  );
  assert.equal(content?.textContent?.includes("Loading page"), false);
});

test("a click into a Browser tab's page beside the Inbox hands the panel the keys, so ⌘W over the page closes that tab", async () => {
  const { container, panel, main } = await inbox({
    pages: [FUNNEL],
    experiments: experimentsOn(EXPERIMENT.BROWSER),
  });
  await pressChip(container, "invites.ts");
  act(() => panel().onOpenBrowser("http://localhost:3000/"));
  await settle();
  // The Inbox's own column holds the keys, as a press in its list leaves them.
  act(() => {
    container
      .querySelector(".inbox-view")
      ?.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
  });
  await settle();
  const browserId = panel().browsers[0]?.tab.browser;
  assert.ok(browserId);

  act(() => main.focus?.({ browserId }));
  await settle();
  act(() =>
    main.key?.({ browserId, key: "w", code: "KeyW", shift: false, alt: false, control: false }),
  );
  await settle();

  assert.deepEqual(panelTabs(container), ["▸ invites.ts"]);
});

test("closing the last tab drawn beside the Inbox shuts the panel, as on a task's page, though the task keeps an archived agent's Pull request tab", async () => {
  const { container, panel } = await inbox();
  // The archived agent's tab, as one opened on the task's page before the agent was archived, which no strip draws.
  act(() => panel().onChoose({ changes: ARCHIVED.id }));
  await settle();
  await pressChip(container, "relay#42");
  assert.equal(panelTabs(container)?.[0], "▸ #42 Send invitations in batches");

  const close = container.querySelector<HTMLButtonElement>(
    'aside[aria-label="Panel"] button[aria-label="Close #42 Send invitations in batches"]',
  );
  assert.ok(close, "the tab offers its close");
  act(() => close.click());
  await settle();

  assert.equal(panelTabs(container), undefined, "the panel shut with its last tab");
});
