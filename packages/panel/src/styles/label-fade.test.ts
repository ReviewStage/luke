// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { WORKSPACE_REF_SIZE, WorkspaceRef } from "../desktop/workspace-ref.js";
import { layContainersAt } from "../testing/container-width.js";

/**
 * label-fade.test.ts -- a name, a title, or a place the shell and the
 * sidebar cut to their line fades out over its last `--label-fade` while it
 * is cut short, as a browser's tab ends a long title, rather than ending in
 * an ellipsis; one that fits ends on its last letter, unmasked. jsdom lays
 * nothing out, so a box is stood in for as 50px wide, its words 10px a
 * letter, and the observer reports a box once as a first layout would; the
 * sheets are laid as the window lays them (`testing/container-width.ts`).
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** What a cut label's mask draws: its words faded out over their last few pixels. */
const FADE = "linear-gradient(to left, transparent, #000 var(--label-fade))";

/** A sample of the places that fade: a sidebar row's repository, a row's context, a chat byline's place, and a tool's title. */
const FADING = [
  "sidebar-task-repository",
  "home-row-context",
  "chat-byline-where",
  "integration-tool-title",
] as const;

const roots: Root[] = [];
let laid: HTMLStyleElement | undefined;

beforeEach(() => {
  laid = layContainersAt({});
  vi.stubGlobal(
    "ResizeObserver",
    class implements ResizeObserver {
      constructor(private readonly heard: ResizeObserverCallback) {}
      observe(): void {
        this.heard([], this);
      }
      unobserve(): void {}
      disconnect(): void {}
    },
  );
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(50);
  vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return (this.textContent ?? "").length * 10;
  });
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  laid?.remove();
  laid = undefined;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** A workspace named at the sidebar head's size, answering its name's box. */
function workspaceName(name: string): HTMLElement {
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  roots.push(root);
  act(() =>
    root.render(
      createElement(WorkspaceRef, {
        workspace: { id: "workspace-1", name },
        size: WORKSPACE_REF_SIZE.HEAD,
      }),
    ),
  );
  return host.querySelector<HTMLElement>(".workspace-ref-name") ?? assert.fail("its name");
}

/** A box of `className` in the window, marked as `useClipped` measured it, or unmeasured. */
function label(className: string, overflow: boolean | undefined): CSSStyleDeclaration {
  const element = document.body.appendChild(document.createElement("span"));
  element.className = className;
  if (overflow !== undefined) element.dataset.overflow = String(overflow);
  return getComputedStyle(element);
}

test("a workspace's name too long for its box fades out at its end rather than ending in an ellipsis", () => {
  const style = getComputedStyle(workspaceName("Platform infrastructure and reliability"));
  assert.equal(style.maskImage, FADE);
  assert.equal(style.textOverflow, "clip");
});

test("a workspace's name that fits ends on its last letter, unmasked", () => {
  const style = getComputedStyle(workspaceName("Acme"));
  assert.ok(!style.maskImage.includes("gradient"), style.maskImage);
  assert.notEqual(style.textOverflow, "ellipsis");
});

for (const className of FADING) {
  test(`a .${className} measured cut short fades out at its end, with no ellipsis`, () => {
    const style = label(className, true);
    assert.equal(style.maskImage, FADE);
    assert.equal(style.textOverflow, "clip");
  });

  test(`a .${className} that fits is drawn whole, unmasked`, () => {
    assert.ok(!label(className, false).maskImage.includes("gradient"));
  });
}

test("who wrote a revision, pressed to open where it was written, is a box of its own that fades, not an inline line its press cuts with an ellipsis", () => {
  const head = document.body.appendChild(document.createElement("p"));
  head.className = "version-sections-head";
  const press = head.appendChild(document.createElement("button"));
  press.className = "luke-text-button";
  const name = press.appendChild(document.createElement("span"));
  name.className = "version-row-author";
  name.dataset.overflow = "true";
  const style = getComputedStyle(name);
  assert.equal(style.display, "block");
  assert.equal(style.maskImage, FADE);
});
