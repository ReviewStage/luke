// @vitest-environment jsdom

import assert from "node:assert/strict";
import { createMemoryHistory } from "@tanstack/react-router";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { withQueryClient } from "../testing/copy-feedback.js";
import { windowRouter } from "../testing/window-router.js";
import { usePlaceBinding } from "./place-binding.js";
import { useWindowPlace } from "./routed-places.js";

/**
 * place-binding.test.ts -- Home and the task the host binds following each
 * other through the place module: the host binding a task leaves Home,
 * arriving on Home lets go of the task, and neither chases the other.
 * Synthetic ids.
 */

const TASK_ID = "b2000002-0000-4000-8000-0000000000e2";
const OTHER_TASK_ID = "b2000002-0000-4000-8000-0000000000e3";

const roots: Root[] = [];

afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.innerHTML = "";
});

/** The window's binding over a router standing at `at`, the task bound as `bound` starts, each door it moves by recorded in order. */
function mount(at: string, bound: string | undefined) {
  const moves: string[] = [];
  const held = windowRouter(createMemoryHistory({ initialEntries: [at] }));
  let bind: ((taskId: string | undefined) => void) | undefined;
  function Probe() {
    const [standing, setStanding] = useState(bound);
    bind = setStanding;
    usePlaceBinding({
      known: true,
      place: useWindowPlace().place,
      bound: standing,
      onUnbind: () => moves.push("unbind"),
      onToBound: () => moves.push("to the task"),
      onToUnbound: () => moves.push("to Home"),
    });
    return null;
  }
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  roots.push(root);
  act(() => root.render(held.provide(withQueryClient(createElement(Probe)))));
  return {
    moves,
    /** The host binding `taskId`, or none. */
    bind: (taskId: string | undefined) => act(() => bind?.(taskId)),
    /** The router arriving at `address`, as Back, a press, or a link moves it. */
    arrive: (address: string) => act(() => held.history.push(address)),
    /** The router arriving at `address` and the host binding `taskId` in the same breath. */
    arriveBinding: (address: string, taskId: string) =>
      act(() => {
        held.history.push(address);
        bind?.(taskId);
      }),
  };
}

test("the host binding a task while Home stands leaves Home for it, once", () => {
  const window = mount("/acme", undefined);
  window.bind(TASK_ID);
  assert.deepEqual(window.moves, ["to the task"]);
});

test("arriving on Home with a task bound lets go of the task, and leaves Home no more once the task is let go", () => {
  const window = mount(`/acme/task/${TASK_ID}`, TASK_ID);
  window.arrive("/acme");
  window.bind(undefined);
  assert.deepEqual(window.moves, ["unbind"]);
});

test("arriving on Home as the host binds a task in the same breath lets go of it rather than leaving, and a task bound later leaves Home", () => {
  const window = mount(`/acme/task/${TASK_ID}`, undefined);
  window.arriveBinding("/acme", OTHER_TASK_ID);
  window.bind(undefined);
  window.bind(TASK_ID);
  assert.deepEqual(window.moves, ["unbind", "to the task"]);
});

test("a window opening on Home with a task already bound stands that task, the host's word over the place it opened on", () => {
  const window = mount("/app", TASK_ID);
  assert.deepEqual(window.moves, ["to the task"]);
});

test("the host binding no task under the task standing goes Home, and does nothing under a place standing over it", () => {
  const onTask = mount(`/acme/task/${TASK_ID}`, TASK_ID);
  onTask.bind(undefined);
  const onBoard = mount("/acme/tasks", TASK_ID);
  onBoard.bind(undefined);
  assert.deepEqual([onTask.moves, onBoard.moves], [["to Home"], []]);
});
