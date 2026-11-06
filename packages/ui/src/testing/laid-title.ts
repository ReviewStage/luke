export interface TitleLayout {
  readonly room: string;
  readonly words: string;
  readonly roomWidth: number;
  readonly whole: number;
  readonly floor: number;
}

class StillObserver {
  observe(): void {}
  disconnect(): void {}
}

export function layTitle(layout: TitleLayout): { restore: () => void } {
  const proto = Element.prototype;
  const rect = Object.getOwnPropertyDescriptor(proto, "getBoundingClientRect");
  const scroll = Object.getOwnPropertyDescriptor(proto, "scrollWidth");
  const frame = globalThis.requestAnimationFrame;
  const observer = globalThis.ResizeObserver;
  const box = (width: number) => new DOMRect(0, 0, width, 0);
  Object.defineProperty(proto, "getBoundingClientRect", {
    configurable: true,
    value(this: Element) {
      if (this.matches(layout.room)) return box(layout.roomWidth);
      if (this.matches(layout.words)) return box(layout.whole);
      return box(0);
    },
  });
  Object.defineProperty(proto, "scrollWidth", {
    configurable: true,
    get(this: Element) {
      return this.matches(layout.words) ? layout.whole : 0;
    },
  });
  globalThis.requestAnimationFrame = (run: FrameRequestCallback) => {
    run(0);
    return 0;
  };
  globalThis.ResizeObserver = StillObserver as unknown as typeof ResizeObserver;
  document.documentElement.style.setProperty("--ui-title-floor", `${layout.floor}px`);
  return {
    restore: () => {
      if (rect !== undefined) Object.defineProperty(proto, "getBoundingClientRect", rect);
      if (scroll !== undefined) Object.defineProperty(proto, "scrollWidth", scroll);
      globalThis.requestAnimationFrame = frame;
      globalThis.ResizeObserver = observer;
      document.documentElement.style.removeProperty("--ui-title-floor");
    },
  };
}
