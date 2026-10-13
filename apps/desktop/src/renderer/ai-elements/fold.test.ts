// @vitest-environment jsdom
// fold.test.ts -- a press opens a fold onto its body at once and holds the body through its fade as it closes; nothing a press did not start moves.

import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { installExits, uninstallExits } from "#testing/exits";
import { Fold, FoldBody, FoldSummary } from "./fold";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  uninstallExits();
});

/** The fade a closing fold's body runs, as base.css's `disclosure-leave`. */
const FADING_BODY = '[data-disclosure="closing"] > .disclosure-body';

/** A fold of one line over one body, mounted closed. */
function mounted() {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      createElement(
        Fold,
        null,
        createElement(FoldSummary, null, "Ran 2 commands"),
        createElement(FoldBody, null, createElement("pre", null, "pnpm test")),
      ),
    ),
  );
  const details = container.querySelector("details");
  const summary = container.querySelector("summary");
  assert.ok(details && summary);
  return { details, summary, body: () => details.querySelector("pre") };
}

/** Lets the promises settled so far run. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 4; tick += 1) await Promise.resolve();
  });
}

test("a press opens a fold onto its body at once, unrolling it, and closing says so at once but keeps the body until its fade is done", async () => {
  const fades = installExits(FADING_BODY);
  const fold = mounted();
  assert.equal(fold.body(), null);

  act(() => fold.summary.click());
  assert.equal(fold.summary.getAttribute("aria-expanded"), "true");
  assert.ok(fold.body(), "the body lands in the layout at once");
  assert.equal(fold.details.dataset.disclosure, "opening");

  act(() => fold.summary.click());
  assert.equal(fold.summary.getAttribute("aria-expanded"), "false");
  assert.equal(fold.details.dataset.disclosure, "closing");
  assert.ok(fold.body(), "the body stays through its fade");
  assert.equal(fold.details.open, true);

  act(() => fades[0]?.finish());
  await settle();
  assert.equal(fold.body(), null, "the fade done, the body is gone");
  assert.equal(fold.details.open, false);
  assert.equal(fold.details.dataset.disclosure, undefined);
});

test("pressing a fold again while it closes opens it back up, and the fade it cut short takes nothing away", async () => {
  const fades = installExits(FADING_BODY);
  const fold = mounted();
  act(() => fold.summary.click());
  act(() => fold.summary.click());
  act(() => fold.summary.click());
  assert.equal(fold.summary.getAttribute("aria-expanded"), "true");
  assert.equal(fold.details.dataset.disclosure, "opening");

  act(() => {
    fades[0]?.cancel();
  });
  await settle();
  assert.ok(fold.body());
  assert.equal(fold.details.open, true);
});

test("a fold opened from elsewhere than its line, as a find opens one onto a match, appears at once with no motion", () => {
  installExits(FADING_BODY);
  const fold = mounted();
  act(() => {
    fold.details.open = true;
    fold.details.dispatchEvent(new Event("toggle"));
  });
  assert.ok(fold.body());
  assert.equal(fold.summary.getAttribute("aria-expanded"), "true");
  assert.equal(fold.details.dataset.disclosure, undefined);
});
