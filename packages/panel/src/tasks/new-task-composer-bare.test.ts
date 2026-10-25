// @vitest-environment jsdom

import assert from "node:assert/strict";
import { TASK_STATUS, type TaskStanding } from "@luke/features/task-wire";
import { Effect } from "effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test, vi } from "vitest";
import { fakeActPort, fakeAppBridge } from "../testing/app-bridge.js";
import {
  editorBundleLanded,
  installEditorLayout,
  pressInComposer,
  typeInComposer,
} from "../testing/composer.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { restOn } from "../testing/hint-rest.js";
import { installScrollIntoView } from "../testing/scroll-into-view.js";
import { tasksControl } from "../testing/tasks-control.js";
import { MENTION_MENU_SIDE } from "./mention-picker.js";
import { NewTaskComposer } from "./new-task-composer.js";
import { NEW_TASK_PURPOSE, type NewTaskPurpose } from "./new-task-purpose.js";

/**
 * New task's round button while its box holds nothing: ⌘Return there starts a
 * task with no agent, and the button's hint is the one place that says so,
 * with the chord. A box with words keeps the button's own hint, and the
 * automation's card, whose ⌘Return starts no bare task, never names one.
 * A card opened from a Tasks page group's + starts its task where the group
 * stands until its pill's × lets that go. Synthetic throughout.
 */

const roots: Root[] = [];

beforeAll(() => Effect.runPromise(editorBundleLanded));

beforeEach(() => {
  installScrollIntoView();
  installEditorLayout();
  fakeAppBridge({});
  fakeActPort({});
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  vi.restoreAllMocks();
  window.localStorage.clear();
  document.body.innerHTML = "";
});

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
}

/** The card for `purpose` on a repository, its box empty, opened on `standing` where given, each start's standing written down. */
async function mount(
  purpose: NewTaskPurpose = NEW_TASK_PURPOSE.TASK,
  standing?: TaskStanding,
  starts: (TaskStanding | undefined)[] = [],
): Promise<HTMLElement> {
  const control = tasksControl();
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(NewTaskComposer, {
          newTask: {
            ...control.newTask,
            workspaceId: "workspace-acme",
            repositoriesIn: () => ({ ...control.repositories, recent: ["acme/web"] }),
            ...(standing === undefined
              ? undefined
              : { preset: { standing: { asked: standing, words: "In progress" } } }),
            start: (_name, _repository, _workspaceId, from) => {
              starts.push(from?.standing);
              return Promise.resolve(undefined);
            },
          },
          workspaceId: "workspace-acme",
          onLeave: () => undefined,
          listSide: MENTION_MENU_SIDE.ABOVE,
          purpose,
        }),
      ),
    ),
  );
  await settle();
  return container;
}

/** The round button's hint once the pointer has rested on it: its words, and the chord it draws. */
function sendHint(container: HTMLElement): { words: string; chord: string | undefined } {
  restOn(
    container.querySelector('button[type="submit"]') ?? assert.fail("the card draws its button"),
  );
  const pill = document.querySelector('[role="tooltip"]') ?? assert.fail("the button's hint shows");
  const chord = pill.querySelector(".luke-shortcut")?.textContent ?? undefined;
  const words = (pill.textContent ?? "").replace(chord ?? "", "").trim();
  return { words, chord };
}

test("an empty box's button says ⌘Return starts a task with no agent", async () => {
  const hint = sendHint(await mount());

  assert.equal(hint.words, "Start a task with no agent");
  assert.equal(hint.chord, "⌘⏎");
});

test("a box with words keeps the button's own hint, with no chord", async () => {
  const container = await mount();
  typeInComposer(container, "Fix the login page");
  await settle();
  const hint = sendHint(container);

  assert.equal(hint.words, "Start agent");
  assert.equal(hint.chord, undefined);
});

test("the automation's empty card names no bare task", async () => {
  const hint = sendHint(await mount(NEW_TASK_PURPOSE.AUTOMATION));

  assert.equal(hint.words, "Start agent");
  assert.equal(hint.chord, undefined);
});

test("a card opened from a group's + starts its task in the group, and its pill's × lets that go", async () => {
  const starts: (TaskStanding | undefined)[] = [];
  const container = await mount(NEW_TASK_PURPOSE.TASK, { status: TASK_STATUS.IN_PROGRESS }, starts);
  act(() => pressInComposer(container, "Enter", { metaKey: true }));
  await settle();
  act(() =>
    (
      container.querySelector<HTMLButtonElement>('button[aria-label="Remove In progress"]') ??
      assert.fail("the card draws the group's pill")
    ).click(),
  );
  act(() => pressInComposer(container, "Enter", { metaKey: true }));
  await settle();

  assert.deepEqual(starts, [{ status: TASK_STATUS.IN_PROGRESS }, undefined]);
});
