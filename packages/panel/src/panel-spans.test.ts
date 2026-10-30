// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { TaskSummary } from "@luke/features/task-wire";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { DesktopSidebar } from "./desktop/desktop-sidebar.js";
import {
  beginPanelSpan,
  endWindowSpanOnFirstDraw,
  installPanelSpanRecorder,
  leaveWindowSpan,
  markWindowStart,
  PANEL_SPAN,
  type PanelSpan,
  useKeystrokeSpans,
} from "./panel-spans.js";
import { SHELL_ROOM } from "./shell-room.js";
import { useInboxItemOpenSpan, useInboxOpenSpan } from "./tasks/use-inbox-spans.js";
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

/** The Inbox's two press spans, drawn over the rows the page holds and the thread it shows. */
function InboxTimed({
  rows,
  shown,
  held,
  pressed,
}: {
  rows: number;
  shown: string | undefined;
  held: boolean;
  pressed: string | undefined;
}): null {
  useInboxOpenSpan(rows);
  const timeOpen = useInboxItemOpenSpan(shown, held);
  // A press is made once, as the render that carries it commits.
  useEffect(() => {
    if (pressed !== undefined) timeOpen(pressed);
  }, [pressed, timeOpen]);
  return null;
}

test("the Inbox is timed from its opening to its first rows drawn, and a row chosen to its thread drawn, the one already shown never", () => {
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  roots.push(root);
  const draw = (props: Parameters<typeof InboxTimed>[0]) =>
    act(() => root.render(createElement(InboxTimed, props)));

  beginPanelSpan(PANEL_SPAN.INBOX_OPEN);
  draw({ rows: 0, shown: undefined, held: false, pressed: undefined });
  vi.setSystemTime(5_000_250);
  draw({ rows: 7, shown: undefined, held: false, pressed: undefined });
  draw({ rows: 8, shown: undefined, held: false, pressed: undefined });

  vi.setSystemTime(5_001_000);
  draw({ rows: 8, shown: undefined, held: false, pressed: "a" });
  vi.setSystemTime(5_001_040);
  draw({ rows: 8, shown: "a", held: true, pressed: "a" });
  draw({ rows: 8, shown: "a", held: true, pressed: undefined });
  draw({ rows: 8, shown: "a", held: true, pressed: "a" });
  draw({ rows: 8, shown: "a", held: true, pressed: undefined });

  assert.deepEqual(recorded(), [
    {
      name: PANEL_SPAN.INBOX_OPEN,
      startedAt: 5_000_000,
      waited: 250,
      measured: { "inbox.item_count": 7 },
    },
    {
      name: PANEL_SPAN.INBOX_ITEM_OPEN,
      startedAt: 5_001_000,
      waited: 40,
      measured: { "inbox.held": 1 },
    },
  ]);
});

test("an Inbox left before it drew a row, or in a window that records nothing, times nothing", () => {
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  roots.push(root);
  beginPanelSpan(PANEL_SPAN.INBOX_OPEN);
  act(() =>
    root.render(
      createElement(InboxTimed, { rows: 0, shown: undefined, held: false, pressed: undefined }),
    ),
  );
  act(() => root.unmount());
  roots.splice(0);
  uninstall();
  beginPanelSpan(PANEL_SPAN.INBOX_OPEN);
  uninstall = installPanelSpanRecorder((span) => spans.push(span));
  const next = createRoot(document.body.appendChild(document.createElement("div")));
  roots.push(next);
  act(() =>
    next.render(
      createElement(InboxTimed, { rows: 3, shown: undefined, held: false, pressed: undefined }),
    ),
  );

  assert.deepEqual(recorded(), []);
});
