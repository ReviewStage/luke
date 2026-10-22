// @vitest-environment jsdom

import assert from "node:assert/strict";
import { LINK_PLACE, type ReadLink } from "@luke/features/luke-link";
import { DisclosureFind } from "@luke/ui";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, Fragment, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { LinkWorkspaceProvider } from "../copy-link-item.js";
import { copyingInto, DESKTOP_LINKS, fakeAppPlatform } from "../testing/app-platform.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { FileNoteAnnotation, type FileNotes, type NoteLines } from "./file-note.js";
import { OpenLinkProvider } from "./use-open-link.js";

/**
 * file-note.test.ts -- an agent's note on lines of a file: folded, it is its head alone and previews none of its words,
 * which a find still reaches once; a press on its head tells the tab; its
 * ⋯ opens the turn of his work that showed the lines and copies that turn's
 * link; and the pointer or the keyboard on it lights its lines.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const WORDS = "Retry the request before the first invite is sent";
const TASK_ID = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
const SHOWN_AT = 1_760_000_000_000;
const AGENT_ID = "3f1c9e2a-6b7d-4e8f-a1b2-c3d4e5f60718";
const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
  delete document.documentElement.dataset.keyboard;
});

function notes(
  folded: string[],
  heard: [string, boolean][],
  lit: (NoteLines | undefined)[] = [],
): FileNotes {
  return {
    notes: [
      {
        callId: "call-1",
        shownAt: SHOWN_AT,
        turnId: "turn-1",
        agentId: AGENT_ID,
        startLine: 3,
        endLine: 5,
        note: WORDS,
      },
    ],
    folded,
    onFold: (callId, now) => heard.push([callId, now]),
    taskId: TASK_ID,
    agentLabel: (agentId) => (agentId === AGENT_ID ? "Invite emails" : undefined),
    onLight: (lines) => lit.push(lines),
  };
}

function draw(element: ReactNode): HTMLElement {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(createElement(Fragment, null, element)));
  return container;
}

/** The note as a File tab draws it under its line, nothing minimized. */
function noteOf(drawn: FileNotes): ReactNode {
  const [note] = drawn.notes;
  assert.ok(note);
  return createElement(FileNoteAnnotation, { note, notes: drawn, minimized: undefined });
}

/** How many times the note's words stand in the card's text. */
function said(container: HTMLElement): number {
  return (container.textContent ?? "").split("Retry the request").length - 1;
}

test("folded, a note is its head alone, and a find through the tab still finds its words once", () => {
  const heard: [string, boolean][] = [];
  const folded = draw(noteOf(notes(["call-1"], heard)));
  assert.equal(said(folded), 0, "no preview of its words");
  assert.match(folded.querySelector(".annotation-card-head")?.textContent ?? "", /^Invite emails/u);
  const finding = draw(
    createElement(DisclosureFind, {
      finding: true,
      children: noteOf(notes(["call-1"], heard)),
    }),
  );
  assert.equal(said(finding), 1);
});

test("a press on a note's head tells the tab to unfold it", () => {
  const heard: [string, boolean][] = [];
  const container = draw(noteOf(notes(["call-1"], heard)));
  act(() => container.querySelector("summary")?.click());
  assert.deepEqual(heard, [["call-1", false]]);
});

test("a note's ⋯ opens the agent's turn that showed its lines, and copies that turn's link", () => {
  const opened: ReadLink[] = [];
  const copied: string[] = [];
  fakeAppPlatform({ ...DESKTOP_LINKS, ...copyingInto(copied) });
  const container = draw(
    onRegistry(
      AtomRegistry.make(),
      createElement(
        OpenLinkProvider,
        { value: (link: ReadLink) => opened.push(link) },
        createElement(LinkWorkspaceProvider, { value: "acme" }, noteOf(notes([], []))),
      ),
    ),
  );
  const press = (label: string) => {
    act(() =>
      (
        container.querySelector<HTMLButtonElement>('button[aria-label="Note actions"]') ??
        assert.fail("the note has its ⋯")
      ).click(),
    );
    const items = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    assert.deepEqual(
      items.map((item) => item.textContent),
      ["View in conversation", "Copy link"],
    );
    act(() => items.find((item) => item.textContent === label)?.click());
  };
  assert.equal(container.querySelector("summary")?.getAttribute("aria-expanded"), "true");

  press("View in conversation");
  assert.deepEqual(
    opened.map((link) => link.place),
    [{ kind: LINK_PLACE.MESSAGE, planId: TASK_ID, agentId: AGENT_ID, messageId: "turn-1" }],
  );
  press("Copy link");
  assert.deepEqual(copied, [
    `https://tryluke.dev/acme/plan/${TASK_ID}/agent/${AGENT_ID}/message/turn-1`,
  ]);
  assert.equal(
    container.querySelector("summary")?.getAttribute("aria-expanded"),
    "true",
    "the ⋯ folds nothing",
  );
  assert.equal(container.querySelector(".pull-request-thread-actions"), null, "no foot");
});

test("the pointer, or the keyboard, on a note lights its lines, and leaving lets them go", () => {
  const lit: (NoteLines | undefined)[] = [];
  const container = draw(noteOf(notes([], [], lit)));
  const note = container.querySelector<HTMLElement>(".file-note") ?? assert.fail("the note");
  act(() => {
    note.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
  });
  act(() => {
    note.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: document.body }));
  });
  document.documentElement.dataset.keyboard = "true";
  const summary = container.querySelector<HTMLElement>("summary") ?? assert.fail("a head");
  act(() => {
    summary.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
  });
  act(() => {
    summary.dispatchEvent(
      new FocusEvent("focusout", { bubbles: true, relatedTarget: document.body }),
    );
  });
  assert.deepEqual(lit, [
    { startLine: 3, endLine: 5 },
    undefined,
    { startLine: 3, endLine: 5 },
    undefined,
  ]);
});
