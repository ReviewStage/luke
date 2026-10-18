/**
 * resize-observer.ts -- the browser's ResizeObserver, which jsdom lacks, reporting when a test says the layout changed.
 *
 * jsdom lays out nothing, so nothing it holds ever resizes of its own accord:
 * an observer here is silent until a test that has staged a layout calls
 * `relayout`, as the window would report a resize. Installed for every test
 * file by the suite's setup wherever the environment has none of its own.
 */

/** Every observer still watching something, across the window. */
const watching = new Set<StandInResizeObserver>();

class StandInResizeObserver implements ResizeObserver {
  readonly #callback: ResizeObserverCallback;
  readonly #targets = new Set<Element>();

  constructor(callback: ResizeObserverCallback) {
    this.#callback = callback;
  }

  observe(target: Element): void {
    this.#targets.add(target);
    watching.add(this);
  }

  unobserve(target: Element): void {
    this.#targets.delete(target);
    if (this.#targets.size === 0) watching.delete(this);
  }

  disconnect(): void {
    this.#targets.clear();
    watching.delete(this);
  }

  report(): void {
    // SAFETY: jsdom lays nothing out, so an entry has no box to carry but its
    // target, and the observers under test read nothing from an entry.
    const entries = [...this.#targets].map((target) => ({ target }) as ResizeObserverEntry);
    this.#callback(entries, this);
  }
}

/** Reports a resize to every observer watching, as the window does once a layout has changed. */
export function relayout(): void {
  for (const observer of [...watching]) observer.report();
}

globalThis.ResizeObserver ??= StandInResizeObserver;
