// @vitest-environment jsdom

import assert from "node:assert/strict";
import { LINK_PLACE, type ReadLink } from "@luke/features/luke-link";
import { pageFrameUrl } from "@luke/features/page-frame";
import { IDLE_TASKS_VIEW } from "@luke/features/tasks-view";
import { TaskMentions, type TaskMentionsValue } from "@luke/panel/tasks/task-mentions";
import { TranscriptWords } from "@luke/panel/tasks/transcript-blocks";
import { OpenLinkProvider } from "@luke/panel/tasks/use-open-link";
import { fakeAppBridge } from "@luke/panel/testing/app-bridge";
import { stateWith } from "@luke/panel/testing/app-state";
import { onRegistry } from "@luke/panel/testing/copy-feedback";
import { markdownHtmlParserLanded } from "@luke/panel/testing/markdown";
import { Effect } from "effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, test } from "vitest";
import { fakeAppPlatform } from "#testing/app-platform";

/**
 * agent-written-mentions.test.ts -- the mentions a coding agent is told to
 * write (`packages/service/src/agents/coder-host/instructions.ts`), drawn
 * in the words its replies and its Inbox items are drawn in, on its task's
 * page: a page it
 * showed, another agent, a section of its plan, and a file of its
 * repository, each as the chip of what it names, called by the name the
 * agent wrote, and a page's chip opens the page in the window and hangs its
 * tab's card, previewing it, where the page is the open plan's. Synthetic
 * workspace, task, page, and agent.
 */

const TASK = "3f6c1b2a-8d4e-4f10-9a7b-5c2d1e0fa21b";
const PAGE = "26494df1-595a-4364-abf7-85781c65a9f8";
const AGENT = "7b1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f";
const HOME = `https://tryluke.dev/acme/plan/${TASK}`;

/** A reply as an agent writes one, naming each kind as its instructions show. */
const REPLY = [
  `I showed [@Invite funnel](${HOME}/page/${PAGE}),`,
  `asked [@Wire the desktop](${HOME}/agent/${AGENT}) to rebase,`,
  `and followed [@Rollout](${HOME}#rollout)`,
  "in [@session-store.ts](https://github.com/acme/relay/blob/HEAD/apps/web/session-store.ts).",
].join(" ");

// A reply is drawn once the parser has landed, as the panel lands it after its first paint.
beforeAll(() => Effect.runPromise(markdownHtmlParserLanded));

/** The task's page an agent's tab stands on, whose repository a file's link is read against. */
const TASK_PAGE: TaskMentionsValue = {
  taskId: TASK,
  taskName: "Teammate invitations",
  workspace: "acme",
  repository: "acme/relay",
  text: () => "## Rollout\n\nStore first.\n",
  doors: {
    taskId: TASK,
    place: { workspace: "acme", repository: "acme/relay" },
    anchors: new Set(["rollout"]),
    onOpenTask: () => undefined,
    onOpenFile: () => undefined,
  },
};

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

/** The words drawn as an agent's tab on its task's page draws them, every place a chip opened kept. */
function drawn(text: string, opened: ReadLink[]): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(
          OpenLinkProvider,
          { value: (link: ReadLink) => opened.push(link) },
          createElement(TaskMentions, {
            value: TASK_PAGE,
            children: createElement(TranscriptWords, { text }),
          }),
        ),
      ),
    ),
  );
  return container;
}

test("an agent's written mentions of a page, an agent, a section, and a file are drawn as their chips under the names it wrote, and the page's opens the page", () => {
  const opened: ReadLink[] = [];
  const container = drawn(REPLY, opened);

  const chips = [...container.querySelectorAll<HTMLElement>("[data-mention-ref]")];
  const page = chips.find((chip) => chip.dataset.kind === "page");
  assert.ok(page instanceof HTMLButtonElement, "the page is a chip that opens");
  act(() => page.click());

  assert.deepEqual(
    chips.map((chip) => [chip.dataset.kind, chip.textContent]),
    [
      ["page", "Invite funnel"],
      ["agent", "Wire the desktop"],
      ["section", "Rollout"],
      ["file", "session-store.ts"],
    ],
  );
  assert.deepEqual(opened, [
    { workspace: "acme", place: { kind: LINK_PLACE.PAGE, planId: TASK, pageId: PAGE } },
  ]);
});

test("a page's chip on the open plan hangs the page's tab's card, previewing its newest version", async () => {
  const state = stateWith(
    {},
    {
      tasks: {
        ...IDLE_TASKS_VIEW,
        activeTaskId: TASK,
        pages: [{ id: PAGE, title: "Invite funnel", version: 2, at: 1_800_000_000_000 }],
      },
    },
  );
  fakeAppBridge({
    onAppState: () => () => undefined,
    requestAppState: () => Promise.resolve(state),
  });
  fakeAppPlatform({ pageFrameUrl });
  const container = drawn(REPLY, []);
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
  const page = container.querySelector<HTMLElement>('[data-mention-ref][data-kind="page"]');
  assert.ok(page, "the page's chip");
  act(() => {
    page.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
  });
  const card = document.querySelector(".luke-tooltip-card [data-page-card]");
  assert.ok(card, "the page's tab's card is hung");
  assert.equal(card.querySelector(".luke-hover-card-name")?.textContent, "Invite funnel");
  assert.equal(card.querySelector(".luke-hover-card-sub")?.textContent, "Version 2");
  assert.equal(
    card.querySelector("iframe")?.getAttribute("src"),
    pageFrameUrl({ taskId: TASK, pageId: PAGE, version: 2 }),
  );
});
