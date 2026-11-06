// @vitest-environment jsdom

import assert from "node:assert/strict";
import { DESCRIPTION_ACTOR, type Task } from "@repo/features/task-wire";
import { EXPERIMENT } from "@repo/settings";
import { experimentsOn } from "@repo/settings/testing";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test, vi } from "vitest";
import { readExperiments } from "../testing/app-state.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { DOCUMENT_TASK } from "../testing/document-task.js";
import { DescriptionBody } from "./description-body.js";
import { type DescriptionEditSend, descriptionEditMutation } from "./description-edit-mutation.js";

// Note that the description, its comments, and its history stand only while the account has Descriptions on.
beforeAll(() => readExperiments(experimentsOn(EXPERIMENT.DESCRIPTIONS)));

/**
 * description-body-memo.test.ts -- a section's byline moves its edit time on with
 * the clock.
 */

const DEAN = { userId: "user-dean", name: "Dean Stratakos" };
const GOAL = "## Goal\nInvite a teammate by email.";
const APPROACH = "## Approach\nModel an invite as a pending membership.";

// jsdom draws no layout, so it has no `scrollIntoView` for the view to follow the caret with.
Element.prototype.scrollIntoView ??= () => undefined;

let root: Root | undefined;
const standingMatchMedia = Object.getOwnPropertyDescriptor(window, "matchMedia");

beforeEach(() => {
  // The OS's motion setting, which jsdom has none of: motion is not reduced.
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({ matches: false, media: query }),
  });
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  vi.useRealTimers();
  document.body.innerHTML = "";
  if (standingMatchMedia === undefined) Reflect.deleteProperty(window, "matchMedia");
  else Object.defineProperty(window, "matchMedia", standingMatchMedia);
});

/** The task with `body` as its text, last saved by `by` at `at`. */
function taskWith(body: string, by: typeof DEAN, at: number): Task {
  return {
    ...DOCUMENT_TASK,
    document: { body, assumptions: [] },
    lastEdit: { actor: DESCRIPTION_ACTOR.DEVELOPER, by, at, duringCall: false },
  };
}

const NEVER_SAVED: DescriptionEditSend = () => new Promise(() => undefined);

/**
 * Draws `task` on Dean's page as the task's own page hands it over: every
 * prop made afresh on each draw, as a page drawn again on each delivery of
 * the window's state makes them.
 */
function draw(task: Task): void {
  if (root === undefined) {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  }
  const registry = AtomRegistry.make();
  const shown = root;
  act(() =>
    shown.render(
      onRegistry(
        registry,
        createElement(DescriptionBody, {
          task,
          reader: { readerId: DEAN.userId },
          edit: descriptionEditMutation(task.id, NEVER_SAVED),
          onShowHistory: () => undefined,
          sectionLinks: { workspace: "acme", onOpen: () => undefined, reveal: undefined },
        }),
      ),
    ),
  );
}

test("a minute passing moves each section's edit time", async () => {
  vi.useFakeTimers({
    toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"],
  });
  vi.setSystemTime(1_800_000_000_000);
  const at = Date.now() - 5 * 60_000;
  const task: Task = {
    ...taskWith(`${GOAL}\n\n${APPROACH}`, DEAN, at),
    sectionEdits: [
      { section: "Goal", actor: DESCRIPTION_ACTOR.DEVELOPER, by: DEAN, at, duringCall: false },
      { section: "Approach", actor: DESCRIPTION_ACTOR.DEVELOPER, by: DEAN, at, duringCall: false },
    ],
  };
  draw(task);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  const bylines = () =>
    [...document.querySelectorAll(".description-unit-byline")].map((line) => line.textContent);
  assert.match(bylines()[0] ?? "", /5m/u);

  await act(async () => {
    await vi.advanceTimersByTimeAsync(60_000);
  });

  assert.match(bylines()[0] ?? "", /6m/u, "the section's time moved on with the minute");
  assert.match(bylines()[1] ?? "", /6m/u);
});
