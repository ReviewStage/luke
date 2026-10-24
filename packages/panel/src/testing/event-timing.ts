/**
 * event-timing.ts -- the browser's Event Timing as a test answers it: a `PerformanceObserver` that reports `event` timings, and a key pressed on an element reported to every observer observing, with the wait the test gives it.
 *
 * jsdom times no event, so a test of what a keystroke's span says hands the
 * timing in itself, as Chromium would report it once the key's paint is done.
 */

import { vi } from "vitest";

/** What each observer observing was handed to hear its timings with. */
const heard: PerformanceObserverCallback[] = [];

/** An observer as Chromium makes one, whose timings `keyPressed` reports. */
class ReportedObserver implements PerformanceObserver {
  static readonly supportedEntryTypes: readonly string[] = ["event", "first-input"];

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

/** Reports a key pressed on `target`, its wait as `wait` says, to every observer observing. */
export function keyPressed(target: Node, wait: KeystrokeWait): void {
  const timing: PerformanceEventTiming = {
    name: "keydown",
    entryType: "event",
    cancelable: true,
    interactionId: 1,
    target,
    ...wait,
    toJSON: () => ({ ...wait }),
  };
  const list: PerformanceObserverEntryList = {
    getEntries: () => [timing],
    getEntriesByName: (name) => (name === timing.name ? [timing] : []),
    getEntriesByType: (type) => (type === timing.entryType ? [timing] : []),
  };
  for (const callback of heard) callback(list, new ReportedObserver(() => undefined));
}
