// @vitest-environment jsdom

import assert from "node:assert/strict";
import { afterEach, test } from "vitest";
import { FIND_SHADOW_ATTRIBUTE, findRanges, matchFrom, watchText } from "./find-matches";

/**
 * find-matches.test.ts -- a find reads the words a marked host's shadow
 * root draws, as a Files changed diff's are, in the host's place among the
 * tab's own and set apart from them, leaving out what the host's selector
 * names there, as a diff's gutter of numbers; an unmarked shadow root, as
 * the file tree's, is not read. A find kept at a match keeps to it across
 * the shadow's edge, and a change inside the shadow root is a change of
 * the tab's text. Synthetic words only.
 */

afterEach(() => {
  document.body.innerHTML = "";
});

/** A tab: a line of its own, a marked host drawing a gutter and two lines, an unmarked host, and a line after. */
function drawTab() {
  const tab = document.body.appendChild(document.createElement("div"));
  tab.innerHTML = "<p>seats before</p><div id='diff'></div><div id='tree'></div><p>seats after</p>";
  const host = tab.querySelector("#diff") ?? assert.fail("the host stands");
  host.setAttribute(FIND_SHADOW_ATTRIBUTE, "[data-gutter]");
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML =
    "<div data-gutter><span>3</span><span>42</span></div>" +
    "<div data-code><div><span>const </span><span>seats</span> = 3;</div><div>const seats = 42;</div></div>";
  const tree = tab.querySelector("#tree") ?? assert.fail("the tree stands");
  tree.attachShadow({ mode: "open" }).innerHTML = "<div>seats.ts</div>";
  return { tab, shadow };
}

test("a marked shadow root's words are found in its host's place, its gutter and an unmarked shadow root left out", () => {
  const { tab } = drawTab();

  const ranges = findRanges(tab, "seats");
  assert.deepEqual(
    ranges.map(
      (range) => range.startContainer.parentElement?.closest("p, [data-code] > div")?.textContent,
    ),
    ["seats before", "const seats = 3;", "const seats = 42;", "seats after"],
  );
  assert.deepEqual(findRanges(tab, "42").length, 1);
  // A match never runs from the tab's own words into the shadow's.
  assert.equal(findRanges(tab, "beforeconst").length, 0);
});

test("a find kept at a match in the shadow root keeps to it, and one at the tab's own line before it moves on into the shadow", () => {
  const { tab } = drawTab();
  const ranges = findRanges(tab, "seats");

  assert.equal(matchFrom(ranges, ranges[2], tab), 2);
  assert.equal(matchFrom(ranges, ranges[3], tab), 3);
  const before = document.createRange();
  before.selectNodeContents(tab.querySelector("p") ?? assert.fail("the line stands"));
  before.collapse(false);
  assert.equal(matchFrom(ranges, before, tab), 1);
});

test("a change inside a marked shadow root is a change of the tab's text", async () => {
  const { tab, shadow } = drawTab();
  let changes = 0;
  const stop = watchText(tab, () => {
    changes += 1;
  });

  const code = shadow.querySelector("[data-code]") ?? assert.fail("the code stands");
  code.append(document.createElement("div"));
  await Promise.resolve();
  stop();

  assert.equal(changes, 1);
});

test("what a marked host slots into its shadow root is found where its slot stands", () => {
  const tab = document.body.appendChild(document.createElement("div"));
  const host = tab.appendChild(document.createElement("div"));
  host.setAttribute(FIND_SHADOW_ATTRIBUTE, "");
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = "<div>line one seats</div><slot name='note'></slot><div>line two seats</div>";
  const note = host.appendChild(document.createElement("div"));
  note.slot = "note";
  note.textContent = "a comment on seats";

  assert.deepEqual(
    findRanges(tab, "seats").map((range) => range.startContainer.parentElement?.textContent),
    ["line one seats", "a comment on seats", "line two seats"],
  );
});
