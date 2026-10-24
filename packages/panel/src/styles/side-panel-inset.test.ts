// @vitest-environment jsdom

import assert from "node:assert/strict";
import { afterEach, test } from "vitest";
import { layContainersAt } from "../testing/container-width.js";

/**
 * A side panel's transcript, its docks and its composer start their words where the column's do, at the text inset, so a tab moving between the two keeps its edge. jsdom lays nothing out and resolves no `max()`, so each rule's padding is read as the declaration it names. Synthetic throughout.
 */

/** The column's text inset, which `max()` floors every pad at. */
const FLOOR = "var(--content-inset)";

afterEach(() => {
  document.head.replaceChildren();
  document.body.replaceChildren();
});

/** The padding a rule gives `selector`'s element inside a side panel's tab. */
function sidePanelPadding(html: string, selector: string): string {
  layContainersAt({}, { only: ["@luke/ui/tokens.css", "./tasks.css", "./desktop.css"] });
  const panel = document.body.appendChild(document.createElement("div"));
  panel.className = "side-panel-content";
  panel.innerHTML = html;
  const element = panel.querySelector(selector);
  assert.ok(element !== null, `${selector} stands`);
  return getComputedStyle(element).paddingInline;
}

test("a side panel's transcript, docks and composer floor at the column's text inset", () => {
  for (const selector of [
    ".conversation-log",
    ".agent-todos-dock",
    ".agent-published-dock",
    ".draft-fork-dock",
  ]) {
    const padding = sidePanelPadding(`<div class="${selector.slice(1)}"></div>`, selector);
    assert.ok(padding.includes(FLOOR), `${selector} pads ${padding}`);
  }

  const composer = sidePanelPadding(
    '<div class="agent-tab-foot"><div class="agent-composer"></div></div>',
    ".agent-composer",
  );
  assert.ok(composer.includes(FLOOR), `the composer pads ${composer}`);
});

test("a side panel's code feed floors at the column's text inset", () => {
  const padding = sidePanelPadding(
    '<div class="code-pane"><div class="conversation-log"></div></div>',
    ".conversation-log",
  );
  assert.ok(padding.includes(FLOOR), `the feed pads ${padding}`);
});
