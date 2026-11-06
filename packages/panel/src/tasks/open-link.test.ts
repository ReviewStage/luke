// @vitest-environment jsdom

import assert from "node:assert/strict";
import { LINK_PLACE, type ReadLink } from "@repo/features/link-grammar";
import { ACT_KIND } from "@repo/host/acts";
import { Effect } from "effect";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test } from "vitest";
import {
  type AnyAct,
  fakeActPort,
  fakeAppBridge,
  type OpenedLink,
  openingLinks,
} from "../testing/app-bridge.js";
import { DESKTOP_LINKS, fakeAppPlatform } from "../testing/app-platform.js";
import { withQueryClient } from "../testing/copy-feedback.js";
import { markdownHtmlParserLanded } from "../testing/markdown.js";
import { TranscriptWords } from "./transcript-blocks.js";
import { OpenLinkProvider } from "./use-open-link.js";

const TASK_ID = "3f6c1b2a-8d4e-4f10-9a7b-5c2d1e0fa21b";
const AGENT_ID = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
const ITEM_ID = "0c9a3f1e-6b2d-4e8f-a1c7-3d5e7f9a1b2c";

const WORDS = [
  `See [the rollout](https://vespin.dev/acme/plan/${TASK_ID}#rollout),`,
  `[the plan](https://vespin.dev/personal-u_1/plan/${TASK_ID}),`,
  `[the agent](https://vespin.dev/acme/plan/${TASK_ID}/agent/${AGENT_ID}),`,
  `[its question](https://vespin.dev/acme/agent/${AGENT_ID}/inbox/${ITEM_ID}),`,
  "[the pull request](https://github.com/acme/relay/pull/12),",
  "and [the docs](https://example.com/docs).",
].join(" ");

beforeAll(() => Effect.runPromise(markdownHtmlParserLanded));

const roots: Root[] = [];
let sent: (AnyAct | OpenedLink)[] = [];

beforeEach(() => {
  sent = [];
  fakeAppPlatform(DESKTOP_LINKS);
  fakeAppBridge({});
  fakeActPort(openingLinks((link) => sent.push(link)));
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

function pressedEach(openPlace: ((link: ReadLink) => void) | undefined): void {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const words: ReactNode = createElement(TranscriptWords, { text: WORDS });
  act(() =>
    root.render(
      withQueryClient(
        openPlace === undefined
          ? words
          : createElement(OpenLinkProvider, { value: openPlace }, words),
      ),
    ),
  );
  for (const link of container.querySelectorAll<HTMLElement>(
    "a, .text-link-inert, button[data-mention-ref]",
  )) {
    act(() => link.click());
  }
}

test("a Vespin link opens its place in the window, a task at its section, an agent, an Inbox item, and other pages open in the browser", () => {
  const opened: ReadLink[] = [];

  pressedEach((link) => opened.push(link));

  assert.deepEqual(opened, [
    { workspace: "", place: { kind: LINK_PLACE.SECTION, planId: TASK_ID, anchor: "rollout" } },
    { workspace: "", place: { kind: LINK_PLACE.TASK, planId: TASK_ID } },
    {
      workspace: "acme",
      place: { kind: LINK_PLACE.AGENT, planId: TASK_ID, agentId: AGENT_ID },
    },
    {
      workspace: "acme",
      place: { kind: LINK_PLACE.INBOX_ITEM, agentId: AGENT_ID, itemId: ITEM_ID },
    },
  ]);
  assert.deepEqual(
    sent.map((request) => request.kind),
    [ACT_KIND.GITHUB_OPEN, ACT_KIND.WEB_OPEN],
  );
});

test("off the window, where no opener for a place is handed down, a Vespin link opens in the browser as any page does", () => {
  pressedEach(undefined);

  assert.deepEqual(
    sent.map((request) => request.kind),
    [ACT_KIND.WEB_OPEN, ACT_KIND.WEB_OPEN, ACT_KIND.GITHUB_OPEN, ACT_KIND.WEB_OPEN],
  );
});
