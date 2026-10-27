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
  leaveWindowSpan,
  markWindowStart,
  noteListedTasks,
  PANEL_SPAN,
  type PanelSpan,
  useKeystrokeSpans,
} from "./panel-spans.js";
import { SHELL_ROOM } from "./shell-room.js";
import type { TasksControl } from "./tasks/use-tasks-tab.js";
import { fakeActPortAnswering } from "./testing/app-bridge.js";
import { onRegistry } from "./testing/copy-feedback.js";
import { sidebarProps } from "./testing/desktop-sidebar.js";
import {
  frameHeld,
  keyPressed,
  pressed,
  pressedAndClicked,
  reportEventTiming,
} from "./testing/event-timing.js";
import { tasksControl } from "./testing/tasks-control.js";

/**
 * panel-spans.test.ts -- what the window times of its own start, of a key pressed in a timed box, and of what is slow anywhere: its start to its first surface drawn and to the sidebar's first task list read, each once, a keystroke to the paint after it, saying how long it waited and nothing of the key, a slow press or key anywhere, and a long frame, each saying where it came.
 *
 * The browser's Event Timing and Long Animation Frames are answered by the test (`testing/event-timing.ts`); the clock is a fake date.
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

test("a window whose first surface fails, its fallback drawn and the failure reported as it commits, has no first paint", async () => {
  const rootElement = document.body.appendChild(document.createElement("div"));
  markWindowStart();
  endWindowSpanOnFirstDraw(rootElement, PANEL_SPAN.WINDOW_FIRST_PAINT);

  vi.setSystemTime(5_000_300);
  rootElement.append(document.createElement("section"));
  leaveWindowSpan(PANEL_SPAN.WINDOW_FIRST_PAINT);
  await settle();

  assert.deepEqual(recorded(), []);
});

test("the window's first usable screen is timed from its start to the sidebar's first task list read, saying how many tasks the read answered, once", async () => {
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

test("a key pressed in a timed box is timed to the paint after it, saying how long it waited and ran and where, and a slow key pressed elsewhere is timed as a slow interaction", async () => {
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
      measured: {
        "keystroke.input_delay_ms": 12,
        "keystroke.processing_ms": 28,
        "panel.region": "elsewhere",
      },
    },
    {
      name: PANEL_SPAN.INTERACTION_SLOW,
      startedAt: performance.timeOrigin + 2_000,
      waited: 320,
      measured: {
        "interaction.kind": "key",
        "interaction.input_delay_ms": 1,
        "interaction.processing_ms": 299,
        "interaction.presentation_ms": 20,
        "panel.region": "elsewhere",
      },
    },
  ]);
});

test("a press anywhere slow enough to feel is timed to the paint after it, saying the part of the window and the page it came on, the workspace's size, and how its wait split, its slowest event timed once; a quick one is not", () => {
  document.body.innerHTML =
    '<main data-span-region="main" data-span-page="inbox"><aside data-span-region="side_panel"><p></p></aside></main>';
  const inside = document.querySelector("p");
  assert.ok(inside);
  // Note that the window's observer is heard from the recorder installed after Event Timing is reported.
  uninstall();
  uninstall = installPanelSpanRecorder((span) => spans.push(span));
  noteListedTasks(42);

  pressed(inside, {
    startTime: 1_000,
    processingStart: 1_030,
    processingEnd: 1_110,
    duration: 180,
  });
  pressed(inside, { startTime: 2_000, processingStart: 2_005, processingEnd: 2_040, duration: 60 });
  pressedAndClicked(
    inside,
    { startTime: 3_000, processingStart: 3_004, processingEnd: 3_010, duration: 120 },
    { startTime: 3_000, processingStart: 3_050, processingEnd: 3_200, duration: 260 },
  );

  assert.deepEqual(recorded(), [
    {
      name: PANEL_SPAN.INTERACTION_SLOW,
      startedAt: performance.timeOrigin + 1_000,
      waited: 180,
      measured: {
        "window.task_count": 42,
        "interaction.kind": "press",
        "interaction.input_delay_ms": 30,
        "interaction.processing_ms": 80,
        "interaction.presentation_ms": 70,
        "panel.region": "side_panel",
        "panel.page": "inbox",
      },
    },
    {
      name: PANEL_SPAN.INTERACTION_SLOW,
      startedAt: performance.timeOrigin + 3_000,
      waited: 260,
      measured: {
        "window.task_count": 42,
        "interaction.kind": "press",
        "interaction.input_delay_ms": 50,
        "interaction.processing_ms": 150,
        "interaction.presentation_ms": 60,
        "panel.region": "side_panel",
        "panel.page": "inbox",
      },
    },
  ]);
});

test("a frame held long enough to stutter is timed, saying how much of it blocked input, ran scripts, and laid out, and the page it held; a short one is not", () => {
  document.body.innerHTML = '<main data-span-region="main" data-span-page="task"></main>';
  uninstall();
  uninstall = installPanelSpanRecorder((span) => spans.push(span));

  frameHeld({
    startTime: 1_000,
    duration: 240,
    blockingDuration: 190,
    styleAndLayoutStart: 1_200,
    scripts: [120, 60],
  });
  frameHeld({
    startTime: 2_000,
    duration: 70,
    blockingDuration: 20,
    styleAndLayoutStart: 2_050,
    scripts: [40],
  });

  assert.deepEqual(recorded(), [
    {
      name: PANEL_SPAN.FRAME_LONG,
      startedAt: performance.timeOrigin + 1_000,
      waited: 240,
      measured: {
        "frame.blocking_ms": 190,
        "frame.script_ms": 180,
        "frame.layout_ms": 40,
        "panel.page": "task",
      },
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
