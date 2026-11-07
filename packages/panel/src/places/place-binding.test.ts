// @vitest-environment jsdom

import assert from "node:assert/strict";
import { createMemoryHistory } from "@tanstack/react-router";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { useTaskRoute } from "../task-route.js";
import { withQueryClient } from "../testing/copy-feedback.js";
import { windowRouter } from "../testing/window-router.js";
import { PLACE_BINDING, usePlaceArrivals, usePlaceBinding } from "./place-binding.js";
import { useWindowPlace } from "./routed-places.js";
import { taskOfAt } from "./task-step.js";

/**
 * place-binding.test.ts -- the place standing and the task the host binds
 * following each other through the place module: the host binding a task
 * leaves Home or another task's place for it, arriving on Home lets go of
 * the task and arriving on a task's place asks for it, neither chases the
 * other, and only the developer's own moves count as arrivals. Synthetic ids.
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
  let arrivals: (() => number) | undefined;
  function Probe() {
    const [standing, setStanding] = useState(bound);
    bind = setStanding;
    arrivals = usePlaceArrivals();
    const here = useWindowPlace();
    const routed = useTaskRoute().at;
    usePlaceBinding({
      known: true,
      place: here.place,
      // A task's own address names its task by its id here, as no list holds a number for it.
      task: routed === undefined ? undefined : taskOfAt(routed, [], []),
      page: here.place?.binding === PLACE_BINDING.TASK ? undefined : here.href,
      bound: standing,
      onUnbind: () => moves.push("unbind"),
      onSelect: (taskId) => moves.push(`select ${taskId}`),
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
    /** How many arrivals of the developer's the binding counted. */
    arrivals: () => arrivals?.() ?? assert.fail("the binding stands"),
    /** The host binding `taskId`, or none. */
    bind: (taskId: string | undefined) => act(() => bind?.(taskId)),
    /** The router arriving at `address`, as Back, a press, or a link moves it. */
    arrive: (address: string) => act(() => held.history.push(address)),
    /** The router arriving at `address` and the host binding `taskId`, or none, in the same breath. */
    arriveBinding: (address: string, taskId: string | undefined) =>
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

test("arriving on a task's own place asks for its task, and asks nothing where the door that arrived asked for it already", () => {
  const window = mount(`/acme/task/${TASK_ID}`, TASK_ID);
  window.arrive(`/acme/task/${OTHER_TASK_ID}`);
  window.bind(OTHER_TASK_ID);
  window.arriveBinding("/acme/inbox", OTHER_TASK_ID);
  window.arriveBinding(`/acme/task/${TASK_ID}`, TASK_ID);
  assert.deepEqual(window.moves, [`select ${OTHER_TASK_ID}`]);
});

test("the host binding another task under a task's own place goes to that task, and a place standing over it stays", () => {
  const onTask = mount(`/acme/task/${TASK_ID}`, TASK_ID);
  onTask.bind(OTHER_TASK_ID);
  const onInbox = mount("/acme/inbox", TASK_ID);
  onInbox.bind(OTHER_TASK_ID);
  assert.deepEqual([onTask.moves, onInbox.moves], [["to the task"], []]);
});

test("arriving on a task's own place as the host binds another in the same breath asks for the task arrived on rather than leaving it", () => {
  const window = mount("/acme", undefined);
  window.arriveBinding(`/acme/task/${TASK_ID}`, OTHER_TASK_ID);
  assert.deepEqual(window.moves, [`select ${TASK_ID}`]);
});

test("the binding's own move to the task the host bound is no arrival, while each move of the developer's is one", () => {
  const window = mount("/acme", undefined);
  window.bind(TASK_ID);
  // The window follows the binding to the task's own place, as the history writes its step.
  window.arrive(`/acme/task/${TASK_ID}`);
  const followed = window.arrivals();
  window.arrive("/acme/inbox");
  window.arrive(`/acme/task/${TASK_ID}`);
  assert.deepEqual([followed, window.arrivals()], [0, 2]);
});
