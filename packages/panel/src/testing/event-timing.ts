import { vi } from "vitest";

const heard: PerformanceObserverCallback[] = [];

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

interface KeystrokeWait {
  readonly startTime: number;
  readonly processingStart: number;
  readonly processingEnd: number;
  readonly duration: number;
}

export function reportEventTiming(): void {
  vi.stubGlobal("PerformanceObserver", ReportedObserver);
}

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
