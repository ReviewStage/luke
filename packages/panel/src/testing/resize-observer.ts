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
    const entries = [...this.#targets].map((target) => ({ target }) as ResizeObserverEntry);
    this.#callback(entries, this);
  }
}

export function relayout(): void {
  for (const observer of [...watching]) observer.report();
}

globalThis.ResizeObserver ??= StandInResizeObserver;
