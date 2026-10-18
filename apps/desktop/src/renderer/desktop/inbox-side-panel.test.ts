// @vitest-environment jsdom

import assert from "node:assert/strict";
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
import { ACT_KIND, ACT_OUTCOME_STATUS, type Act, type ActOutcome } from "@luke/host/acts";
import { useAppKeymap } from "@luke/panel/app-commands";
import { OpenLinkProvider } from "@luke/panel/tasks/use-open-link";
import { fakeAppBridge } from "@luke/panel/testing/app-bridge";
import { onRegistry } from "@luke/panel/testing/copy-feedback";
import { markdownHtmlParserLanded } from "@luke/panel/testing/markdown";
import { Effect } from "effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test } from "vitest";
import { fakeAppPlatform, QUIET_PANEL } from "#testing/app-platform";
import { tasksControl, waitingOf } from "#testing/tasks-control";
import { useSidePanel } from "../tasks/use-side-panel";
import type { InboxChoice } from "../tasks/use-tasks-tab";
import { DesktopInbox } from "./desktop-inbox";

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

const TASK: TaskSummary = {
  id: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
  workspaceId: ACME.id,
  name: "Teammate invitations",
  createdAt: 1,
  updatedAt: 2,
  repository: "acme/relay",
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

function answer(request: Act): Promise<ActOutcome> {
  switch (request.kind) {
    case ACT_KIND.CODING_AGENTS_INBOX_READ_STATE:
      readMarks.push(`${request.payload.unread ? "unread" : "read"}:${request.payload.itemId}`);
      return Promise.resolve({
        status: ACT_OUTCOME_STATUS.DONE,
        value: { id: request.payload.itemId, unread: request.payload.unread },
      });
    case ACT_KIND.CODING_AGENTS_INBOX:
      // A read past the cursor is held open while nothing changes, as the service holds it.
      return request.payload.after === "0"
        ? Promise.resolve({
            status: ACT_OUTCOME_STATUS.DONE,
            value: { items: [ITEM], cursor: "1" } satisfies CodingAgentInboxAnswerView,
          })
        : new Promise(() => undefined);
    case ACT_KIND.CODING_AGENTS_LIST:
      return Promise.resolve({ status: ACT_OUTCOME_STATUS.DONE, value: { agents: [AGENT] } });
    case ACT_KIND.CODING_AGENTS_PULL_REQUEST:
      return Promise.resolve({
        status: ACT_OUTCOME_STATUS.DONE,
        value: {
          repository: TASK.repository,
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
      return Promise.resolve({ status: ACT_OUTCOME_STATUS.REFUSED, reason: "Not in this test." });
  }
}

/** The window's Inbox on the plan's item, its side panel the window's own hook held by the chosen item's plan, and every place it was asked to leave for. */
async function inbox({ pages }: { pages: readonly PageLine[] | undefined } = { pages: [FUNNEL] }) {
  const links: ReadLink[] = [];
  const tasks: string[] = [];
  const left = { links, tasks, rereads: 0 };
  fakeAppPlatform({ ...QUIET_PANEL, pageFrameUrl });
  fakeAppBridge({
    act: answer,
  });
  function Page() {
    const [chosen, setChosen] = useState<InboxChoice | undefined>(undefined);
    const panelFor = chosen !== undefined && "taskId" in chosen ? chosen.taskId : undefined;
    const sidePanel = useSidePanel(
      undefined,
      { id: panelFor, holds: {}, bare: true },
      [],
      [],
      [],
      [FUNNEL.id],
      undefined,
    );
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
            pages,
            onRereadPages: () => {
              left.rereads += 1;
            },
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
  return { container, left };
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

test("U marks the Inbox's item while the Inbox holds the keys, and not while the panel beside it does", async () => {
  function Keymap() {
    useAppKeymap(true);
    return null;
  }
  const keys = createRoot(document.body.appendChild(document.createElement("div")));
  act(() => keys.render(createElement(Keymap)));
  const { container } = await inbox();
  const pressU = () =>
    act(() => {
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "u", bubbles: true }));
    });
  pressU();
  await settle();
  assert.deepEqual(readMarks, [`unread:${ITEM.id}`], "the Inbox holds the keys");

  await pressChip(container, "invites.ts");
  const panel = container.querySelector<HTMLElement>(".side-panel");
  assert.ok(panel, "the panel stands beside the Inbox");
  act(() => {
    panel.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
  });
  pressU();
  await settle();
  assert.deepEqual(
    readMarks,
    [`unread:${ITEM.id}`],
    "the panel holds the keys, so U is not the Inbox's",
  );
  act(() => keys.unmount());
});
