/**
 * event-timing.ts -- the browser's Event Timing as a test answers it: a `PerformanceObserver` that reports `event` timings, and a key pressed or a press on an element, and a frame held, reported to every observer observing, with the wait the test gives it, each event an interaction of its own.
 *
 * jsdom times no event, so a test of what a keystroke's span says hands the
 * timing in itself, as Chromium would report it once the key's paint is done.
 */

import { vi } from "vitest";

/** What each observer observing was handed to hear its timings with. */
const heard: PerformanceObserverCallback[] = [];

/** An observer as Chromium makes one, whose timings `keyPressed` reports. */
class ReportedObserver implements PerformanceObserver {
  static readonly supportedEntryTypes: readonly string[] = [
    "event",
    "first-input",
    "long-animation-frame",
  ];

  readonly #callback: PerformanceObserverCallback;

  constructor(callback: PerformanceObserverCallback) {
    this.#callback = callback;
  }

  observe(): void {
    heard.push(this.#callback);
  }

  disconnect(): void {}

  takeRecords(): PerformanceEntryList {
    return [];
  }
}

/** A keystroke's wait, in the page's milliseconds: when it was pressed, when its handlers started and ended, and how long until the paint after it. */
interface KeystrokeWait {
  readonly startTime: number;
  readonly processingStart: number;
  readonly processingEnd: number;
  readonly duration: number;
}

/** Makes the window's browser one that reports how long an event waited. */
export function reportEventTiming(): void {
  vi.stubGlobal("PerformanceObserver", ReportedObserver);
}

/** The id the browser gave the last interaction it reported. */
let interactions = 0;

/** Reports a key pressed on `target`, its wait as `wait` says, to every observer observing. */
export function keyPressed(target: Node, wait: KeystrokeWait): void {
  reportEvent("keydown", target, wait);
}

/** Reports a press on `target`, its wait as `wait` says, to every observer observing. */
export function pressed(target: Node, wait: KeystrokeWait): void {
  reportEvent("pointerdown", target, wait);
}

/** Reports a press on `target` and the click after it as one interaction, each event's wait as given, to every observer observing. */
export function pressedAndClicked(target: Node, press: KeystrokeWait, click: KeystrokeWait): void {
  reportEvents(target, [
    ["pointerdown", press],
    ["click", click],
  ]);
}

/** Reports the event `name` on `target` as an interaction of its own, its wait as `wait` says, to every observer observing. */
function reportEvent(name: string, target: Node, wait: KeystrokeWait): void {
  reportEvents(target, [[name, wait]]);
}

/** Reports `events` on `target` as one interaction of their own, each with its wait, to every observer observing. */
function reportEvents(target: Node, events: readonly (readonly [string, KeystrokeWait])[]): void {
  interactions += 1;
  const id = interactions;
  const timings: PerformanceEventTiming[] = events.map(([name, wait]) => ({
    name,
    entryType: "event",
    cancelable: true,
    interactionId: id,
    target,
    ...wait,
    toJSON: () => ({ ...wait }),
  }));
  const list: PerformanceObserverEntryList = {
    getEntries: () => timings,
    getEntriesByName: (name) => timings.filter((timing) => timing.name === name),
    getEntriesByType: (type) => timings.filter((timing) => timing.entryType === type),
  };
  for (const callback of heard) callback(list, new ReportedObserver(() => undefined));
}

/** A long frame's wait, in the page's milliseconds: when it started, how long it held, how much of it blocked input, when its style and layout began, and each script's run. */
interface FrameWait {
  readonly startTime: number;
  readonly duration: number;
  readonly blockingDuration: number;
  readonly styleAndLayoutStart: number;
  readonly scripts: readonly number[];
}

/** Reports a frame held as `wait` says to every observer observing, as Chromium's Long Animation Frames report one. */
export function frameHeld(wait: FrameWait): void {
  const timing = {
    name: "long-animation-frame",
    entryType: "long-animation-frame",
    ...wait,
    scripts: wait.scripts.map((duration) => ({ duration })),
    toJSON: () => ({ ...wait }),
  };
  const list: PerformanceObserverEntryList = {
    getEntries: () => [timing],
    getEntriesByName: (name) => (name === timing.name ? [timing] : []),
    getEntriesByType: (type) => (type === timing.entryType ? [timing] : []),
  };
  for (const callback of heard) callback(list, new ReportedObserver(() => undefined));
}
