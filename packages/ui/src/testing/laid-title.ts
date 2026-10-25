/**
 * laid-title.ts -- a bar's title laid out under jsdom: jsdom lays nothing out, so a bar never learns how much of its title shows.
 *
 * The box named `room` stands `room` pixels wide from the left edge, the
 * title's words named `words` want `whole` pixels from the same edge, so as
 * much as the room leaves of them shows, and every other box measures
 * nothing; the readable floor is `floor` pixels, as the profiles set it.
 * Resizes are not watched, and a frame runs at once, so a bar reads itself
 * as it renders. `restore` takes it all away.
 */

/** How a bar's title is laid: its room, its words, and how wide each stands. */
export interface TitleLayout {
  /** The selector of the box that cuts the title. */
  readonly room: string;
  /** The selector of the title's words. */
  readonly words: string;
  /** How wide the room stands. */
  readonly roomWidth: number;
  /** How wide the whole title is. */
  readonly whole: number;
  /** How much of a title must show, in pixels. */
  readonly floor: number;
}

/** No resize is watched: a bar reads itself once, as it renders. */
class StillObserver {
  observe(): void {}
  disconnect(): void {}
}

/** Lays every matching bar's title out as `layout` says, until the answered `restore` is called. */
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
  document.documentElement.style.setProperty("--luke-title-floor", `${layout.floor}px`);
  return {
    restore: () => {
      if (rect !== undefined) Object.defineProperty(proto, "getBoundingClientRect", rect);
      if (scroll !== undefined) Object.defineProperty(proto, "scrollWidth", scroll);
      globalThis.requestAnimationFrame = frame;
      globalThis.ResizeObserver = observer;
      document.documentElement.style.removeProperty("--luke-title-floor");
    },
  };
}
