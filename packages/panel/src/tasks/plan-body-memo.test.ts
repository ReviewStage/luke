// @vitest-environment jsdom

import assert from "node:assert/strict";
import { PLAN_ACTOR, type Task } from "@luke/features/task-wire";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { onRegistry } from "../testing/copy-feedback.js";
import { DOCUMENT_TASK } from "../testing/document-task.js";
import { PlanBody } from "./plan-body.js";
import type { PlanEditDoor } from "./use-plan-editing.js";

/**
 * plan-body-memo.test.ts -- the plan parses again only the section whose
 * words changed: a later save, the window handing the same plan over again,
 * and each frame of Luke typing a section leave every other section's
 * Markdown as it was drawn.
 *
 * Note that the Markdown engine is wrapped to record the words it is handed,
 * and still parses them, because which words it parses is the whole of what
 * this file checks.
 */

const parsed = vi.hoisted((): string[] => []);

vi.mock("react-markdown", async (importOriginal) => {
  const engine = await importOriginal<typeof import("react-markdown")>();
  const Markdown = engine.default;
  return {
    ...engine,
    default: (options: Parameters<typeof Markdown>[0]) => {
      parsed.push(options.children ?? "");
      return Markdown(options);
    },
  };
});

const DEAN = { userId: "user-dean", name: "Dean Stratakos" };
const CHARLES = { userId: "user-charles", name: "Charles Pan" };
const GOAL = "## Goal\nInvite a teammate by email.";
const APPROACH = "## Approach\nModel an invite as a pending membership.";
const APPROACH_LATER = `${APPROACH} Removal covers both, so nobody is left half invited.`;

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
  parsed.length = 0;
  if (standingMatchMedia === undefined) Reflect.deleteProperty(window, "matchMedia");
  else Object.defineProperty(window, "matchMedia", standingMatchMedia);
});

/** The task with `body` as its text, last saved by `by` at `at`. */
function taskWith(body: string, by: typeof DEAN, at: number): Task {
  return {
    ...DOCUMENT_TASK,
    document: { body, assumptions: [] },
    lastEdit: { actor: PLAN_ACTOR.DEVELOPER, by, at, duringCall: false },
  };
}

const NEVER_SAVED: PlanEditDoor = () => new Promise(() => undefined);

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
        createElement(PlanBody, {
          task,
          live: true,
          reader: { readerId: DEAN.userId },
          onEdit: (request) => NEVER_SAVED(request),
          onShowHistory: () => undefined,
          sectionLinks: { workspace: "acme", onOpen: () => undefined, reveal: undefined },
        }),
      ),
    ),
  );
}

/** Whether any words parsed since the last look were the section that says `said`. */
function parsedSaying(said: string): boolean {
  return parsed.some((words) => words.includes(said));
}

test("a save to the second section parses that section again and leaves the first as drawn", () => {
  draw(taskWith(`${GOAL}\n\n${APPROACH}`, DEAN, 1));
  assert.equal(parsedSaying("Invite a teammate"), true);
  parsed.length = 0;

  // Dean's own save lands at once, since he watched it being typed.
  draw(taskWith(`${GOAL}\n\n${APPROACH_LATER}`, DEAN, 2));

  assert.equal(parsedSaying("nobody is left half invited"), true);
  assert.equal(parsedSaying("Invite a teammate"), false);
  assert.match(document.body.textContent ?? "", /nobody is left half invited\./u);
});

test("the same plan handed over again parses nothing", () => {
  const task = taskWith(`${GOAL}\n\n${APPROACH}`, DEAN, 1);
  draw(task);
  parsed.length = 0;

  draw({ ...task, document: { ...task.document } });

  assert.deepEqual(parsed, []);
});

test("while a teammate's save types in, only the section being typed is parsed frame by frame", () => {
  vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
  draw(taskWith(`${GOAL}\n\n${APPROACH}`, CHARLES, 1));
  parsed.length = 0;

  draw(taskWith(`${GOAL}\n\n${APPROACH_LATER}`, CHARLES, 2));
  for (let frame = 0; frame < 600; frame += 1) act(() => vi.advanceTimersByTime(16));

  assert.match(document.body.textContent ?? "", /nobody is left half invited\./u);
  assert.equal(parsed.length > 2, true, "the typing drew several frames");
  assert.equal(parsedSaying("Invite a teammate"), false);
});
