// @vitest-environment jsdom

import assert from "node:assert/strict";
import { WORKSPACE_PHOTO_TYPE } from "@luke/features/workspace-wire";
import { ACT_OUTCOME_STATUS } from "@luke/host/acts";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { fakeAppBridge } from "../testing/app-bridge.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { WORKSPACE_REF_SIZE, WorkspaceCard, WorkspaceRef } from "./workspace-ref.js";

/**
 * workspace-ref.test.ts -- a workspace named is its tile and its name as one
 * object: its letter on its hue until its photo loads and the photo after,
 * the name as text a reader hears, a row's line under the name where one is
 * hung, and its card saying who shares it. Synthetic workspaces throughout.
 */

const PHOTO = { contentType: WORKSPACE_PHOTO_TYPE.PNG, base64: "iVBORw0KGgo=" };

const roots: Root[] = [];

beforeEach(() => {
  fakeAppBridge({ act: () => Promise.resolve({ status: ACT_OUTCOME_STATUS.DONE, value: PHOTO }) });
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

/** Lets the photo's read, and the redraw it causes, land. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
}

function draw(element: ReactElement): HTMLElement {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(onRegistry(AtomRegistry.make(), element)));
  return container;
}

/** What a reader hears of a ref: its words, the tile being hidden from a screen reader. */
function heard(node: Node): string {
  if (node instanceof Element && node.getAttribute("aria-hidden") === "true") return "";
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  return [...node.childNodes].map(heard).join("");
}

test("a workspace is named by its letter and its name", () => {
  const view = draw(
    createElement(WorkspaceRef, {
      workspace: { id: "workspace-stage", name: "Stage" },
      size: WORKSPACE_REF_SIZE.ROW,
    }),
  );
  const tile = view.querySelector(".workspace-tile") ?? assert.fail("the ref draws the tile");

  assert.equal(tile.textContent, "S");
  assert.equal(heard(view), "Stage");
});

test("a workspace with a photo is named by the photo once it loads, and the name beside it", async () => {
  const view = draw(
    createElement(WorkspaceRef, {
      workspace: { id: "workspace-photo-ref", name: "Stage", photoVersion: "5a5a5a5a5a5a5a5a" },
    }),
  );
  await settle();
  const image = view.querySelector("img") ?? assert.fail("the photo is asked for");
  act(() => image.dispatchEvent(new Event("load")));

  assert.equal(image.getAttribute("src"), `data:image/png;base64,${PHOTO.base64}`);
  assert.equal(view.querySelector(".workspace-tile")?.textContent, "");
  assert.equal(heard(view), "Stage");
});

test("a row's line stands under the name, and a search's marked name stands in for the plain one", () => {
  const row = draw(
    createElement(WorkspaceRef, {
      workspace: { id: "workspace-acme", name: "Acme" },
      size: WORKSPACE_REF_SIZE.ROW,
      line: "5 members",
    }),
  );
  const found = draw(
    createElement(WorkspaceRef, {
      workspace: { id: "workspace-acme", name: "Acme" },
      name: createElement("mark", null, "Acme"),
    }),
  );

  assert.deepEqual(
    [...(row.querySelector(".workspace-ref-copy")?.children ?? [])].map((part) => part.textContent),
    ["Acme", "5 members"],
  );
  assert.equal(found.querySelector(".workspace-ref-name mark")?.textContent, "Acme");
});

test("a workspace's card names it with who shares it: its members counted, or Personal workspace for the account's own", () => {
  const team = draw(
    createElement(WorkspaceCard, {
      workspace: { id: "workspace-acme", name: "Acme", memberCount: 5 },
      personal: false,
    }),
  );
  const own = draw(
    createElement(WorkspaceCard, {
      workspace: { id: "workspace-personal", name: "Dana Reyes", memberCount: 1 },
      personal: true,
    }),
  );

  assert.deepEqual(
    [team, own].map((card) => [
      card.querySelector(".luke-hover-card-name")?.textContent,
      card.querySelector(".luke-hover-card-sub")?.textContent,
    ]),
    [
      ["Acme", "5 members"],
      ["Dana Reyes", "Personal workspace"],
    ],
  );
});
