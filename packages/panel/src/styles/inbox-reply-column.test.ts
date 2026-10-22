// @vitest-environment jsdom

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, beforeAll, test } from "vitest";

/**
 * inbox-reply-column.test.ts -- the reader's draft reply on an Inbox item
 * stands in its comment's body edge to edge, under the words of the thread
 * before it, in the window's Inbox and a task's Inbox tab in the side panel
 * alike, rather than padded in to the panel's reading column a second time.
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

/** The draft reply's composer, as `inbox-pane.tsx` draws it, under `pane`, and an agent's composer beside it. */
function composersIn(pane: string) {
  const root = element(pane, document.body);
  const comment = element("inbox-comment", element("inbox-thread", element("desktop-inbox", root)));
  comment.dataset.inboxComment = "draft";
  const reply = element("agent-composer", element("inbox-comment-body", comment));
  const agent = element("agent-composer", element("agent-tab-foot", root));
  return { reply: getComputedStyle(reply), agent: getComputedStyle(agent) };
}

for (const pane of ["desktop-task-main", "side-panel-content"]) {
  test(`in .${pane} the Inbox's reply box stands on its comment's own column`, () => {
    const { reply } = composersIn(pane);
    // jsdom maps no logical side onto a physical one, so each is read as declared.
    assert.equal(reply.paddingLeft, "0px");
    assert.equal(reply.paddingRight, "0px");
    assert.doesNotMatch(reply.paddingInline, /--reading-room/);
  });
}

test("in the side panel an agent's composer still pads in to the reading column", () => {
  const { agent } = composersIn("side-panel-content");
  assert.match(agent.paddingInline, /--reading-room/);
});
