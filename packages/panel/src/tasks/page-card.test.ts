// @vitest-environment jsdom

import assert from "node:assert/strict";
import { LINK_PLACE } from "@repo/features/link-grammar";
import { pageFrameUrl } from "@repo/features/page-frame";
import { PAGE_SHOWER, type PageLine } from "@repo/features/page-wire";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { fakeAppPlatform } from "../testing/app-platform.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { PageCard } from "./page-card.js";
import { OpenLinkProvider } from "./use-open-link.js";

const TASK = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";

const FUNNEL: PageLine = {
  id: "5d1c3f9a-7e2b-4c8d-9f10-2a3b4c5d6e7f",
  title: "Invite funnel",
  version: 2,
  at: 1_800_000_000_000,
};

const roots: Root[] = [];

afterEach(() => {
  vi.restoreAllMocks();
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
      root.render(
        onRegistry(AtomRegistry.make(), createElement(PageCard, { place: { taskId: TASK }, page })),
      ),
    );
  const preview = () => container.querySelector<HTMLElement>(".ui-page-thumb");
  const load = () =>
    act(() => {
      container.querySelector("iframe")?.dispatchEvent(new Event("load"));
    });

  render(FUNNEL);
  assert.equal(preview()?.dataset.loaded, "false", "hidden until the page has loaded");
  load();
  assert.equal(preview()?.dataset.loaded, "true");

  render({ ...FUNNEL, version: 3 });
  assert.equal(container.querySelector(".ui-hover-card-sub")?.textContent, "Version 3");
  assert.equal(
    container.querySelector("iframe")?.getAttribute("src"),
    pageFrameUrl({ taskId: TASK, pageId: FUNNEL.id, version: 3 }),
  );
  assert.equal(preview()?.dataset.loaded, "false", "the new version is hidden until it loads");
  load();
  assert.equal(preview()?.dataset.loaded, "true");
});

test("a provenance row says who showed the version, wherever the card hangs: Vespin, an agent by the name the window holds, or an agent it holds none of, and nothing for a version from before", () => {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  const subOf = (page: PageLine) => {
    act(() =>
      root.render(
        onRegistry(AtomRegistry.make(), createElement(PageCard, { place: { taskId: TASK }, page })),
      ),
    );
    return container.querySelector(".ui-hover-card-row")?.textContent;
  };

  assert.deepEqual(
    [
      subOf({ ...FUNNEL, shownBy: { kind: PAGE_SHOWER.APP } }),
      subOf({ ...FUNNEL, version: 1, shownBy: { kind: PAGE_SHOWER.APP } }),
      subOf({
        ...FUNNEL,
        shownBy: { kind: PAGE_SHOWER.AGENT, agentId: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21" },
      }),
      subOf(FUNNEL),
    ],
    ["Shown by Vespin", "Shown by Vespin", "Shown by Agent", undefined],
  );
});

test("a press on the agent that showed the version opens its tab, on the page's task", () => {
  const agentId = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";
  const opened: unknown[] = [];
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(OpenLinkProvider, {
          value: (link) => opened.push(link.place),
          children: createElement(PageCard, {
            place: { taskId: TASK },
            page: { ...FUNNEL, shownBy: { kind: PAGE_SHOWER.AGENT, agentId } },
          }),
        }),
      ),
    ),
  );
  const shower = container.querySelector<HTMLElement>(".ui-hover-card-row [data-actor-ref]");
  assert.equal(shower?.tagName, "BUTTON", "the agent's name is a press");
  act(() => shower?.click());
  assert.deepEqual(opened, [{ kind: LINK_PLACE.AGENT, planId: TASK, agentId }]);
});

test("the preview's page is handed the window's theme when it asks, with the room its tab keeps", () => {
  document.documentElement.style.setProperty("--ui-page-inset", "24px");
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(PageCard, { place: { taskId: TASK }, page: FUNNEL }),
      ),
    ),
  );
  const framed = container.querySelector("iframe")?.contentWindow;
  assert.ok(framed);
  const answer = vi.spyOn(framed, "postMessage").mockImplementation(() => undefined);
  act(() => {
    window.dispatchEvent(
      new MessageEvent("message", { data: { type: "app-page-theme-ask" }, source: framed }),
    );
  });
  const answered = answer.mock.calls[0]?.[0];
  document.documentElement.style.removeProperty("--ui-page-inset");
  assert.equal(answered?.type, "app-page-theme");
  assert.equal(answered?.inset, "24px", "the tab's room, not the words' none");
});
