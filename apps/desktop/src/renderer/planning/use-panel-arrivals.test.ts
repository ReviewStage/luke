// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { PageLine } from "@sidecar/hosted/page-wire";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { usedPlan } from "#testing/plans-control";
import { usePanelArrivals } from "./use-panel-arrivals";
import { SIDE_PANEL_TAB, type SidePanelControl, useSidePanel } from "./use-side-panel";

/**
 * The side panel as pages arrive on a call: a page Luke shows while the
 * call stands opens its tab, and so does a newer version of one it held,
 * while the pages a plan opened with, or a call started with, arrive
 * nothing. Synthetic plans and pages throughout.
 */

const PLAN = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
const FUNNEL = "5d1c3f9a-7e2b-4c8d-9f10-2a3b4c5d6e7f";
const MOCKUP = "6e2d4fab-8f3c-4d9e-a021-3b4c5d6e7f80";

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  window.localStorage.clear();
});

const line = (id: string, version: number, title = "Page"): PageLine => ({
  id,
  title,
  version,
  at: version,
});

/** Mounts the panel and its arrivals over the plan's pages as a call reads them, nothing while no call stands. */
function mount(pages: readonly PageLine[] | undefined) {
  let panel: SidePanelControl | undefined;
  function Probe({ listed }: { listed: readonly PageLine[] | undefined }) {
    const ids = (listed ?? []).map((page) => page.id);
    panel = useSidePanel(undefined, usedPlan(PLAN), [], [], [], ids);
    usePanelArrivals({ planId: PLAN, board: undefined, code: undefined, pages: listed, panel });
    return null;
  }
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const render = (listed: readonly PageLine[] | undefined) =>
    act(() => root.render(createElement(Probe, { listed })));
  render(pages);
  return {
    render,
    tab: () => panel?.tab,
  };
}

test("a page shown on the call opens its tab, and so does a newer version of one the call started with", () => {
  const panel = mount([line(FUNNEL, 1)]);
  assert.equal(panel.tab(), SIDE_PANEL_TAB.BOARD);

  panel.render([line(MOCKUP, 1), line(FUNNEL, 1)]);
  assert.deepEqual(panel.tab(), { page: MOCKUP });

  panel.render([line(FUNNEL, 2), line(MOCKUP, 1)]);
  assert.deepEqual(panel.tab(), { page: FUNNEL });
});

test("the pages a call starts with arrive nothing, and a call that ended reads its successor's afresh", () => {
  const panel = mount(undefined);
  panel.render([line(FUNNEL, 3)]);
  assert.equal(panel.tab(), SIDE_PANEL_TAB.BOARD);

  panel.render(undefined);
  panel.render([line(FUNNEL, 3), line(MOCKUP, 2)]);
  assert.equal(panel.tab(), SIDE_PANEL_TAB.BOARD);
});
