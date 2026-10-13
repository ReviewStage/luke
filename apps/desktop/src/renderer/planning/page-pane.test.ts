// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { PageLine } from "@sidecar/hosted/page-wire";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { pageFrameUrl } from "#shared/page-frame";
import { PagePane } from "./page-pane";

/**
 * A page's tab as the developer meets it: the page drawn in a frame that
 * runs its scripts and nothing else, out of the screen recording, at its
 * newest version until they step back through the earlier ones. Synthetic
 * plans and pages throughout.
 */

const PLAN = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";

const FUNNEL: PageLine = {
  id: "5d1c3f9a-7e2b-4c8d-9f10-2a3b4c5d6e7f",
  title: "Invite funnel",
  version: 3,
  at: 1_800_000_000_000,
};

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

/** Mounts the pane over the page as the plan lists it, answering what it draws and a way to list it again. */
function mount(page: PageLine) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const render = (listed: PageLine) =>
    act(() => root.render(createElement(PagePane, { planId: PLAN, page: listed })));
  render(page);
  const frame = () => {
    const found = container.querySelector("iframe");
    assert.ok(found);
    return found;
  };
  const press = (label: string) => {
    const button = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
    assert.ok(button);
    act(() => button.click());
  };
  return { container, frame, press, render };
}

const versionUrl = (version: number) => pageFrameUrl({ planId: PLAN, pageId: FUNNEL.id, version });

test("a page is drawn at its newest version in a frame that runs its own scripts alone, left out of the recording", () => {
  const { container, frame } = mount(FUNNEL);

  assert.equal(frame().getAttribute("src"), versionUrl(3));
  assert.equal(frame().getAttribute("sandbox"), "allow-scripts");
  assert.equal(frame().getAttribute("allow"), "");
  assert.ok(frame().closest(".ph-no-capture"));
  assert.match(container.textContent ?? "", /Invite funnel.*Version 3 of 3/);
});
