// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { TaskSummary } from "@luke/features/task-wire";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { DesktopSidebar } from "./desktop/desktop-sidebar.js";
import {
  endWindowSpanOnFirstDraw,
  installPanelSpanRecorder,
  markWindowStart,
  PANEL_SPAN,
  type PanelSpan,
  useKeystrokeSpans,
} from "./panel-spans.js";
import { SHELL_ROOM } from "./shell-room.js";
import type { TasksControl } from "./tasks/use-tasks-tab.js";
import { fakeActPortAnswering } from "./testing/app-bridge.js";
import { onRegistry } from "./testing/copy-feedback.js";
import { sidebarProps } from "./testing/desktop-sidebar.js";
import { keyPressed, reportEventTiming } from "./testing/event-timing.js";
import { tasksControl } from "./testing/tasks-control.js";

/**
 * panel-spans.test.ts -- what the window times of its own start and of a key pressed in a timed box: its start to its first surface drawn and to the sidebar's first task list read, each once, and a keystroke to the paint after it, saying how long it waited and nothing of the key.
 *
 * The browser's Event Timing is answered by the test (`testing/event-timing.ts`); the clock is a fake date.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** The one task the sidebar's first read lists. */
const INVITES: TaskSummary = {
  id: "0a1b2c3d-0000-4000-8000-100000000001",
  workspaceId: "0a1b2c3d-0000-4000-8000-000000000001",
  name: "Invite expiry",
  createdAt: 1,
  updatedAt: 2,
  repository: "acme/relay",
};

const roots: Root[] = [];

/** What the window recorded, each span as a caller reads it. */
let spans: PanelSpan[] = [];
let uninstall: () => void = () => undefined;

beforeEach(() => {
  spans = [];
  uninstall = installPanelSpanRecorder((span) => spans.push(span));
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(5_000_000);
  reportEventTiming();
  fakeActPortAnswering(() => Promise.resolve(undefined));
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  uninstall();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Lets an observer's report, and an effect's, land. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
}

/** Each span recorded, by its name, how long it waited, and what it measured. */
function recorded(): { name: string; startedAt: number; waited: number; measured: object }[] {
  return spans.map((span) => ({
    name: span.name,
    startedAt: span.startedAt,
    waited: span.endedAt - span.startedAt,
    measured: span.attributes(),
  }));
}

/** The sidebar drawn over `tasks`, and what draws it again over the next. */
async function sidebarOver(tasks: TasksControl): Promise<(next: TasksControl) => Promise<void>> {
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  roots.push(root);
  const registry = AtomRegistry.make();
  const draw = async (next: TasksControl) => {
    act(() =>
      root.render(
        onRegistry(
          registry,
          createElement(DesktopSidebar, { ...sidebarProps(next), room: SHELL_ROOM.WIDE }),
        ),
      ),
    );
    await settle();
  };
  await draw(tasks);
  return draw;
}

/** A box whose keystrokes are timed under `name` while it stands. */
function TimedBox({ name }: { name: Parameters<typeof useKeystrokeSpans>[0] }): React.JSX.Element {
  return createElement("div", { ref: useKeystrokeSpans(name) }, createElement("p"));
}

test("the window's first paint is timed from its start to the first surface drawn into its root, and only once", async () => {
  const rootElement = document.body.appendChild(document.createElement("div"));
  markWindowStart();
  endWindowSpanOnFirstDraw(rootElement, PANEL_SPAN.WINDOW_FIRST_PAINT);

  vi.setSystemTime(5_000_420);
  await settle();
  assert.deepEqual(recorded(), [], "nothing is drawn yet");
  rootElement.append(document.createElement("main"));
  await settle();
  vi.setSystemTime(5_000_900);
  rootElement.append(document.createElement("aside"));
  await settle();

  assert.deepEqual(recorded(), [
    { name: PANEL_SPAN.WINDOW_FIRST_PAINT, startedAt: 5_000_000, waited: 420, measured: {} },
  ]);
});

test("the window's first usable screen is timed from its start to the sidebar's first task list read, saying how many tasks it listed, once", async () => {
  markWindowStart();
  const reading = tasksControl({ listRead: false, tasks: [INVITES] });
  const draw = await sidebarOver(reading);
  assert.deepEqual(recorded(), [], "the list is still being read");

  vi.setSystemTime(5_001_300);
  await draw({ ...reading, listRead: true });
  vi.setSystemTime(5_009_000);
  await draw({ ...reading, listRead: false });
  await draw({ ...reading, listRead: true });

  assert.deepEqual(recorded(), [
    {
      name: PANEL_SPAN.WINDOW_FIRST_USABLE,
      startedAt: 5_000_000,
      waited: 1_300,
      measured: { "window.task_count": 1 },
    },
  ]);
});

test("a window whose first task list read fails is not timed through its Retry", async () => {
  markWindowStart();
  const failed = tasksControl({ listRead: false, listFailed: true });
  const draw = await sidebarOver(failed);

  vi.setSystemTime(5_030_000);
  await draw({ ...failed, listFailed: false, listRead: true });

  assert.deepEqual(recorded(), []);
});

test("a key pressed in a timed box is timed to the paint after it, saying how long it waited and ran, and a key pressed elsewhere is not", async () => {
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  roots.push(root);
  act(() => root.render(createElement(TimedBox, { name: PANEL_SPAN.KEYSTROKE_COMPOSER })));
  const inside = document.querySelector("p");
  assert.ok(inside);

  keyPressed(inside, {
    startTime: 1_000,
    processingStart: 1_012,
    processingEnd: 1_040,
    duration: 72,
  });
  keyPressed(document.body, {
    startTime: 2_000,
    processingStart: 2_001,
    processingEnd: 2_300,
    duration: 320,
  });

  assert.deepEqual(recorded(), [
    {
      name: PANEL_SPAN.KEYSTROKE_COMPOSER,
      startedAt: performance.timeOrigin + 1_000,
      waited: 72,
      measured: { "keystroke.input_delay_ms": 12, "keystroke.processing_ms": 28 },
    },
  ]);
});

test("a box gone, or one in a window that records nothing, times no key", () => {
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  roots.push(root);
  act(() => root.render(createElement(TimedBox, { name: PANEL_SPAN.KEYSTROKE_COMMAND_PALETTE })));
  const gone = document.querySelector("p");
  assert.ok(gone);
  act(() => root.unmount());
  roots.splice(0);
  keyPressed(gone, {
    startTime: 1_000,
    processingStart: 1_010,
    processingEnd: 1_020,
    duration: 40,
  });

  uninstall();
  const untraced = createRoot(document.body.appendChild(document.createElement("div")));
  roots.push(untraced);
  act(() => untraced.render(createElement(TimedBox, { name: PANEL_SPAN.KEYSTROKE_COMPOSER })));
  uninstall = installPanelSpanRecorder((span) => spans.push(span));
  const unwatched = document.querySelector("p");
  assert.ok(unwatched);
  keyPressed(unwatched, {
    startTime: 3_000,
    processingStart: 3_010,
    processingEnd: 3_020,
    duration: 40,
  });

  assert.deepEqual(recorded(), []);
});
