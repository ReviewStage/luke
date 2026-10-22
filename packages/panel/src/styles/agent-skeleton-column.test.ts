// @vitest-environment jsdom

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, beforeAll, test } from "vitest";

/**
 * agent-skeleton-column.test.ts -- an agent's tab while it is read stands its
 * placeholder lines in the column its transcript and composer keep to, in the
 * task's column and the side panel alike, rather than at the pane's edge.
 * jsdom lays nothing out, so the padding each rule declares is read.
 */

beforeAll(() => {
  const sheet = document.createElement("style");
  sheet.textContent = ["tasks.css", "desktop.css"]
    .map((name) => readFileSync(`${__dirname}/${name}`, "utf8"))
    .join("\n");
  document.head.append(sheet);
});

afterEach(() => {
  document.body.replaceChildren();
});

function element(className: string, parent: Element): HTMLElement {
  const made = parent.appendChild(document.createElement("div"));
  made.className = className;
  return made;
}

/** An agent's tab skeleton, as `agent-tab-skeleton.tsx` draws it, under `pane`. */
function skeletonIn(pane: string) {
  const tab = element("agent-tab", element(pane, document.body));
  const lines = element("agent-log-skeleton", element("luke-skeleton-region", tab));
  const composer = element("agent-composer", element("agent-tab-foot", tab));
  return { lines: getComputedStyle(lines), composer: getComputedStyle(composer) };
}

for (const pane of ["desktop-agent", "side-panel-content"]) {
  test(`in .${pane} the skeleton's lines stand on the composer's column`, () => {
    const { lines, composer } = skeletonIn(pane);
    // jsdom resolves no padding drawn from a custom property, so the declared column is read.
    assert.notEqual(composer.paddingInline, "");
    assert.equal(lines.paddingInline, composer.paddingInline);
  });
}
