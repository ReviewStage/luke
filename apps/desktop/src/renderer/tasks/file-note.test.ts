// @vitest-environment jsdom

import assert from "node:assert/strict";
import { DisclosureFind } from "@luke/ui";
import { act, createElement, Fragment, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { type FileNotes, notesBefore } from "./file-note";

/**
 * file-note.test.ts -- a folded note says its words once: cut to its line
 * while folded, and only its hidden body while a find looks through the tab,
 * so a find counts one match a note; a press on its line tells the tab.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const WORDS = "Retry the request before the first invite is sent";
const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});

function notes(folded: string[], heard: [string, boolean][]): FileNotes {
  return {
    notes: [{ callId: "call-1", shownAt: 0, startLine: 3, endLine: 9, note: WORDS }],
    folded,
    onFold: (callId, now) => heard.push([callId, now]),
    onShow: () => undefined,
  };
}

function draw(element: ReactNode): HTMLElement {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(createElement(Fragment, null, element)));
  return container;
}

/** How many times the note's words stand in the card's text. */
function said(container: HTMLElement): number {
  return (container.textContent ?? "").split("Retry the request").length - 1;
}

test("a folded note says its words once, and still once while a find looks through the tab", () => {
  const heard: [string, boolean][] = [];
  const folded = draw(notesBefore(notes(["call-1"], heard))(3));
  assert.equal(said(folded), 1);
  const finding = draw(
    createElement(DisclosureFind, {
      finding: true,
      children: notesBefore(notes(["call-1"], heard))(3),
    }),
  );
  assert.equal(said(finding), 1);
  assert.match(finding.textContent ?? "", /Lines 3–9/u);
});

test("a press on a note's line tells the tab to unfold it", () => {
  const heard: [string, boolean][] = [];
  const container = draw(notesBefore(notes(["call-1"], heard))(3));
  act(() => container.querySelector("summary")?.click());
  assert.deepEqual(heard, [["call-1", false]]);
});
