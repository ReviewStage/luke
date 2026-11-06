// @vitest-environment jsdom

import assert from "node:assert/strict";
import { LINK_PLACE, type ReadLink } from "@repo/features/link-grammar";
import { LIVE_READ } from "@repo/features/live-wire";
import { pageFrameUrl } from "@repo/features/page-frame";
import { PAGE_OWNER } from "@repo/features/page-wire";
import { IDLE_TASKS_VIEW } from "@repo/features/tasks-view";
import { Effect } from "effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, test } from "vitest";
import { fakeAppBridge } from "../testing/app-bridge.js";
import { fakeAppPlatform } from "../testing/app-platform.js";
import { stateWith } from "../testing/app-state.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { restOn } from "../testing/hint-rest.js";
import { markdownHtmlParserLanded } from "../testing/markdown.js";
import { TaskMentions, type TaskMentionsValue } from "./task-mentions.js";
import { TranscriptWords } from "./transcript-blocks.js";
import { OpenLinkProvider } from "./use-open-link.js";

const TASK = "3f6c1b2a-8d4e-4f10-9a7b-5c2d1e0fa21b";
const PAGE = "26494df1-595a-4364-abf7-85781c65a9f8";
const AGENT = "7b1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f";
const HOME = `https://vespin.dev/acme/plan/${TASK}`;

const REPLY = [
  `I showed [@Invite funnel](${HOME}/page/${PAGE}),`,
  `asked [@Wire the desktop](${HOME}/agent/${AGENT}) to rebase,`,
  `and followed [@Rollout](${HOME}#rollout)`,
  "in [@session-store.ts](https://github.com/acme/relay/blob/HEAD/apps/web/session-store.ts).",
].join(" ");

beforeAll(() => Effect.runPromise(markdownHtmlParserLanded));

const TASK_PAGE: TaskMentionsValue = {
  holder: { taskId: TASK },
  taskName: "Teammate invitations",
  workspace: "acme",
  repository: "acme/relay",
  text: () => "## Rollout\n\nStore first.\n",
  doors: {
    holder: { taskId: TASK },
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
    chips.map((chip) => [
      chip.dataset.kind,
      chip.querySelector(".ui-inline-ref-label")?.textContent,
    ]),
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
      tasks: { ...IDLE_TASKS_VIEW, activeTaskId: TASK },
      [LIVE_READ.PAGES]: {
        [PAGE_OWNER.TASK]: {
          [TASK]: {
            rows: [{ id: PAGE, title: "Invite funnel", version: 2, at: 1_800_000_000_000 }],
          },
        },
        [PAGE_OWNER.AGENT]: {},
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
  restOn(page);
  const card = document.querySelector(".ui-tooltip-card [data-page-card]");
  assert.ok(card, "the page's tab's card is hung");
  assert.equal(card.querySelector(".ui-hover-card-name")?.textContent, "Invite funnel");
  assert.equal(card.querySelector(".ui-hover-card-sub")?.textContent, "Version 2");
  assert.equal(
    card.querySelector("iframe")?.getAttribute("src"),
    pageFrameUrl({ taskId: TASK, pageId: PAGE, version: 2 }),
  );
});
