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

beforeAll(() => readExperiments(experimentsOn(EXPERIMENT.DESCRIPTIONS)));

const DEAN = { userId: "user-dean", name: "Dean Stratakos" };
const GOAL = "## Goal\nInvite a teammate by email.";
const APPROACH = "## Approach\nModel an invite as a pending membership.";

Element.prototype.scrollIntoView ??= () => undefined;

let root: Root | undefined;
const standingMatchMedia = Object.getOwnPropertyDescriptor(window, "matchMedia");

beforeEach(() => {
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

function taskWith(body: string, by: typeof DEAN, at: number): Task {
  return {
    ...DOCUMENT_TASK,
    document: { body, assumptions: [] },
    lastEdit: { actor: DESCRIPTION_ACTOR.DEVELOPER, by, at, duringCall: false },
  };
}

const NEVER_SAVED: DescriptionEditSend = () => new Promise(() => undefined);

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
