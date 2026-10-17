// @vitest-environment jsdom

import assert from "node:assert/strict";
import { pageFrameUrl } from "@luke/features/page-frame";
import { PAGE_SHOWER, type PageLine } from "@luke/features/page-wire";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { fakeAppPlatform } from "#testing/app-platform";
import { onRegistry } from "#testing/copy-feedback";
import { PageCard } from "./page-card";

/**
 * page-card.test.ts -- a page's card shows its preview once the version it
 * names has loaded, and a version written while the card stands is held
 * hidden until it loads, rather than the last version standing under the
 * new one's number. Synthetic plan and page.
 */

const TASK = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";

const FUNNEL: PageLine = {
  id: "5d1c3f9a-7e2b-4c8d-9f10-2a3b4c5d6e7f",
  title: "Invite funnel",
  version: 2,
  at: 1_800_000_000_000,
};

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

beforeEach(() => fakeAppPlatform({ pageFrameUrl }));

test("a version written while the card stands is hidden until it loads, never the last version under its number", () => {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  const render = (page: PageLine) =>
    act(() =>
      root.render(onRegistry(AtomRegistry.make(), createElement(PageCard, { taskId: TASK, page }))),
    );
  const preview = () => container.querySelector<HTMLElement>(".page-card-preview");
  const load = () =>
    act(() => {
      container.querySelector("iframe")?.dispatchEvent(new Event("load"));
    });

  render(FUNNEL);
  assert.equal(preview()?.dataset.loaded, "false", "hidden until the page has loaded");
  load();
  assert.equal(preview()?.dataset.loaded, "true");

  render({ ...FUNNEL, version: 3 });
  assert.equal(container.querySelector(".luke-hover-card-sub")?.textContent, "Version 3");
  assert.equal(
    container.querySelector("iframe")?.getAttribute("src"),
    pageFrameUrl({ taskId: TASK, pageId: FUNNEL.id, version: 3 }),
  );
  assert.equal(preview()?.dataset.loaded, "false", "the new version is hidden until it loads");
  load();
  assert.equal(preview()?.dataset.loaded, "true");
});

test("the head says who showed the version beside it, wherever the card hangs: Luke, an agent by the name the window holds, or a coding agent it holds none of, and nothing for a version from before", () => {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  const subOf = (page: PageLine) => {
    act(() =>
      root.render(onRegistry(AtomRegistry.make(), createElement(PageCard, { taskId: TASK, page }))),
    );
    return container.querySelector(".luke-hover-card-sub")?.textContent;
  };

  assert.deepEqual(
    [
      subOf({ ...FUNNEL, shownBy: { kind: PAGE_SHOWER.LUKE } }),
      subOf({ ...FUNNEL, version: 1, shownBy: { kind: PAGE_SHOWER.LUKE } }),
      subOf({
        ...FUNNEL,
        shownBy: { kind: PAGE_SHOWER.AGENT, agentId: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21" },
      }),
      subOf(FUNNEL),
    ],
    [
      "Version 2 · Shown by Luke",
      "Shown by Luke",
      "Version 2 · Shown by a coding agent",
      "Version 2",
    ],
  );
});
