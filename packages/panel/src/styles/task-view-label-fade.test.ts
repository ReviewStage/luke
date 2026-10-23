// @vitest-environment jsdom

import assert from "node:assert/strict";
import { INTEGRATION_PROVIDER } from "@luke/features/integration-wire";
import { SERVER_ROW } from "@luke/ui/agent-servers-model";
import { TerminalIcon } from "lucide-react";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { TOOL_STATE, ToolLine } from "../ai-elements/tool.js";
import { ServerRowWords } from "../tasks/agent-servers.js";
import { PullRequestLabels } from "../tasks/pull-request-labels.js";
import { layContainersAt } from "../testing/container-width.js";

/**
 * task-view-label-fade.test.ts -- a label of the task's views cut short
 * fades out at its end, as a browser's tab title does, rather than ending
 * in an ellipsis, and one that fits ends on its last letter, neither faded
 * nor cut: a call's verb in a transcript, an MCP server's name in its row,
 * and a pull request's label pill, whose name, standing in its own
 * direction, fades at its left where it reads right to left. jsdom lays
 * nothing out, so the panel's sheets are laid (`testing/container-width.ts`),
 * a box is stood in for as 120px wide and its words as 8px a letter, and the
 * observer reports each box once as a first layout would.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** How wide every box stands, in CSS pixels. */
const BOX = 120;

/** How wide a letter stands, in CSS pixels. */
const LETTER = 8;

/** Words that fit a box, and words that outrun it. */
const SHORT = "Read";
const LONG = "Refresh the session token before it expires on a slow network";

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
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(BOX);
  vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return (this.textContent ?? "").length * LETTER;
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

/** Draws `element` into the document and answers the box named by `selector` inside it. */
function drawn(element: ReactElement, selector: string): HTMLElement {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(element));
  const box = container.querySelector<HTMLElement>(selector);
  return box ?? assert.fail(`no ${selector} drawn`);
}

/** How a box ends its words: whether it fades them, and whether it ends them in an ellipsis. */
function ending(box: HTMLElement) {
  const style = getComputedStyle(box);
  return {
    fades: /gradient/.test(style.getPropertyValue("mask-image")),
    ellipsis: style.textOverflow === "ellipsis",
  };
}

const SITES = [
  {
    name: "a call's verb in a transcript",
    draw: (words: string) =>
      drawn(
        createElement(ToolLine, {
          state: TOOL_STATE.OUTPUT_AVAILABLE,
          icon: createElement(TerminalIcon),
          label: words,
          subject: undefined,
        }),
        ".tool-label",
      ),
  },
  {
    name: "an MCP server's name in its row",
    draw: (words: string) =>
      drawn(
        createElement(ServerRowWords, {
          row: {
            provider: INTEGRATION_PROVIDER.LINEAR,
            connection: "linear",
            accounts: 1,
            name: words,
            kind: SERVER_ROW.SWITCH,
            on: true,
          },
        }),
        ".agent-servers-name",
      ),
  },
  {
    name: "a pull request's label pill",
    draw: (words: string) =>
      drawn(
        createElement(PullRequestLabels, { labels: [{ name: words, color: "0e8a16" }] }),
        ".luke-badge-line",
      ),
  },
];

for (const site of SITES) {
  test(`${site.name} cut short fades out at its end rather than ending in an ellipsis`, () => {
    assert.deepEqual(ending(site.draw(LONG)), { fades: true, ellipsis: false });
  });

  test(`${site.name} that fits ends on its last letter, neither faded nor cut`, () => {
    assert.deepEqual(ending(site.draw(SHORT)), { fades: false, ellipsis: false });
  });
}

test("a pull request's label pill keeps its own edge and fill whole while its name fades", () => {
  const name = SITES[2]?.draw(LONG) ?? assert.fail("the pill's name");
  const pill = name.closest<HTMLElement>(".luke-badge") ?? assert.fail("the pill");
  assert.equal(ending(name).fades, true);
  assert.equal(ending(pill).fades, false);
});

test("a pull request's label named right to left fades at its left, where its words are cut, and one left to right at its right", () => {
  const towards = (words: string) => {
    const name = SITES[2]?.draw(words) ?? assert.fail("the pill's name");
    return getComputedStyle(name)
      .getPropertyValue("mask-image")
      .match(/to (left|right)/)?.[1];
  };
  assert.equal(towards("مراجعة التصميم مطلوبة قبل نافذة الدمج"), "right");
  assert.equal(towards(LONG), "left");
});
