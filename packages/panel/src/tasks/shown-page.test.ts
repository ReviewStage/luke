// @vitest-environment jsdom

import assert from "node:assert/strict";
import { pageFrameUrl } from "@repo/features/page-frame";
import { PAGE_PICK_ACT, PAGE_PICK_TYPE } from "@repo/features/page-pick";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { fakeAppPlatform } from "../testing/app-platform.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { ReplyDoorProvider } from "./reply-to-selection.js";
import { ShownPage } from "./shown-page.js";

/**
 * shown-page.test.ts -- words selected in a page drawn in a transcript offer
 * Reply, whose press lays them into the message box and tells the page to
 * let them go, and offer nothing where no box takes them. Synthetic page.
 */

const TASK = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
const PAGE = "5d1c3f9a-7e2b-4c8d-9f10-2a3b4c5d6e7f";
const WORDS = "Signups fell 12% in week 3.";

const roots: Root[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

beforeEach(() => fakeAppPlatform({ pageFrameUrl }));

/** The page drawn, under a box's door where one is handed; answers its frame's window. */
function drawPage(door: ((reply: string) => void) | undefined): Window {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  const page: ReactNode = createElement(ShownPage, {
    place: { taskId: TASK },
    pageId: PAGE,
    version: 1,
    title: "Invite funnel",
  });
  act(() =>
    root.render(
      onRegistry(AtomRegistry.make(), createElement(ReplyDoorProvider, { value: door }, page)),
    ),
  );
  const framed = container.querySelector("iframe")?.contentWindow;
  assert.ok(framed);
  return framed;
}

/** The frame saying `WORDS` are selected in it. */
function selectInFrame(framed: Window): void {
  const selected = {
    path: "body > p",
    quote: WORDS,
    section: "",
    box: { left: 10, top: 40, right: 200, bottom: 60 },
    words: true,
  };
  act(() => {
    window.dispatchEvent(
      new MessageEvent("message", { data: { type: PAGE_PICK_TYPE, selected }, source: framed }),
    );
  });
}

function replyPress(): HTMLButtonElement | undefined {
  return [...document.body.querySelectorAll("button")].find((each) => each.textContent === "Reply");
}

test("words selected in the page offer Reply, which lays them into the box and lets them go in the page", () => {
  const replies: string[] = [];
  const framed = drawPage((reply) => replies.push(reply));
  const told = vi.spyOn(framed, "postMessage").mockImplementation(() => undefined);
  selectInFrame(framed);
  const press = replyPress();
  assert.ok(press, "Reply stands over the words");
  act(() => press.click());
  assert.deepEqual(replies, [WORDS]);
  assert.deepEqual(told.mock.calls[0]?.[0], { type: PAGE_PICK_TYPE, act: PAGE_PICK_ACT.UNSELECT });
  assert.equal(replyPress(), undefined, "Reply goes once pressed");
});

test("words selected in the page offer nothing where no box takes them", () => {
  selectInFrame(drawPage(undefined));
  assert.equal(replyPress(), undefined);
});
