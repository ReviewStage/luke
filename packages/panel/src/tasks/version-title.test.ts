// @vitest-environment jsdom

import assert from "node:assert/strict";
import { PLAN_ACTOR } from "@luke/features/task-wire";
import { Effect } from "effect";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test } from "vitest";
import { fakeActPort, fakeAppBridge } from "../testing/app-bridge.js";
import { DESKTOP_LINKS, fakeAppPlatform } from "../testing/app-platform.js";
import { DOCUMENT_TASK } from "../testing/document-task.js";
import { markdownHtmlParserLanded } from "../testing/markdown.js";
import { HISTORY_READ } from "./use-plan-history.js";
import { VersionView } from "./version-view.js";

/**
 * version-title.test.ts -- a version of a plan names its task in the page
 * title's role, as the plan's header does, and not as a `#` heading of its
 * text, so the page keeps the one `h1` its bar gives it.
 */

const NAME = "Invitations";

// A version's words are drawn once the parser has landed, as the panel lands it after its first paint.
beforeAll(() => Effect.runPromise(markdownHtmlParserLanded));

const roots: Root[] = [];

beforeEach(() => {
  fakeAppPlatform(DESKTOP_LINKS);
  fakeAppBridge({});
  fakeActPort({});
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

function Version(): ReactNode {
  const restore = { busy: false, onRestore: () => undefined };
  return createElement(VersionView, {
    onRetry: () => undefined,
    title: NAME,
    viewing: {
      line: {
        seq: 2,
        lastEdit: { actor: PLAN_ACTOR.NOTETAKER, at: 2, duringCall: true },
        startedAt: 1,
        changes: 1,
      },
      current: false,
      read: {
        kind: HISTORY_READ.READY,
        document: { ...DOCUMENT_TASK.document, body: "## Rollout\n\nShip it." },
        previous: null,
      },
    },
    restore,
  });
}

test("a version names its task in the title role, as no heading, under the bar's one h1", () => {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(createElement(Version)));

  const name = [...container.querySelectorAll(".task-title .luke-text")].map((title) => [
    title.textContent,
    title.getAttribute("data-variant"),
  ]);
  assert.deepEqual(name, [[NAME, "title"]]);
  assert.equal(container.querySelectorAll("h1").length, 1);
  assert.equal(container.querySelector('.luke-markdown-heading[data-level="1"]'), null);
});
