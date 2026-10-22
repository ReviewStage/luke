// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test, vi } from "vitest";
import { INBOX_COLUMNS, type InboxColumnsShown, useInboxColumns } from "./inbox-columns.js";

/**
 * inbox-columns.test.ts -- an Inbox whose holder keeps whether its list was
 * asked for, as the window keeps its Inbox's, forgets the ask once it is
 * measured split, though it was drawn again only after the ask, and keeps
 * it while it is not yet measured, so the list it narrows onto stays.
 */

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

/** An Inbox drawn this wide, its list asked for by its holder before it was drawn. */
function drawAsked(width: number) {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    DOMRect.fromRect({ width, height: 800 }),
  );
  let asked: boolean | undefined;
  let shown: InboxColumnsShown | undefined;
  function Inbox() {
    const [listAsked, setListAsked] = useState(true);
    asked = listAsked;
    const columns = useInboxColumns("item-1", true, { asked: listAsked, onAsk: setListAsked });
    shown = columns.shown;
    return createElement("div", { ref: columns.ref });
  }
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(createElement(Inbox)));
  return { asked: () => asked, shown: () => shown };
}

test("an Inbox drawn split forgets the list its holder kept asked for, so it narrows onto its item", () => {
  const inbox = drawAsked(900);
  assert.equal(inbox.shown(), INBOX_COLUMNS.BOTH);
  assert.equal(inbox.asked(), false);
});

test("an Inbox drawn one column wide stands the list its holder kept asked for", () => {
  const inbox = drawAsked(400);
  assert.equal(inbox.shown(), INBOX_COLUMNS.LIST);
  assert.equal(inbox.asked(), true);
});
