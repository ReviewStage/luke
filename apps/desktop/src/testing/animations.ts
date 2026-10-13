// animations.ts -- a stand-in for the Web Animations API, which jsdom lacks, and the pane motion tokens base.css would set: what a pane's motion test plays its slides on.
import { act } from "react";

/** The motion tokens as base.css leaves them, which jsdom does not load: as shipped, and under reduced motion. */
export const MOTION = {
  ON: "240ms",
  REDUCED: "1ms",
} as const;

/** What the stand-in engine hands back for an animation: the little of one the panes use, and a finish for a test. */
interface FakeAnimation {
  onfinish: (() => void) | null;
  cancel: () => void;
  finish: () => void;
}

/** One animation the stand-in engine is running, and the element it runs on. */
interface Running {
  element: Element;
  animation: FakeAnimation;
  keyframes: Keyframe[];
}

/** What the stand-in engine is running, oldest first; a test empties it after itself. */
export const running: Running[] = [];

/**
 * Puts the Web Animations API in jsdom's place: each animation runs until
 * the test finishes it. Note that the stand-ins are set by reflection,
 * because they answer only the part of an `Animation` the panes use.
 */
export function installAnimations(): void {
  Reflect.set(Element.prototype, "animate", function (this: Element, keyframes: Keyframe[]) {
    const stop = () => {
      if (running.includes(entry)) running.splice(running.indexOf(entry), 1);
    };
    const animation: FakeAnimation = {
      onfinish: null,
      cancel: stop,
      finish: () => {
        stop();
        animation.onfinish?.();
      },
    };
    const entry: Running = { element: this, animation, keyframes };
    running.push(entry);
    return animation;
  });
  Reflect.set(Element.prototype, "getAnimations", function (this: Element) {
    return running.filter((each) => each.element === this).map((each) => each.animation);
  });
}

/** Plays every animation running to its end. */
export function finishAll(): void {
  act(() => {
    for (const each of [...running]) each.animation.finish();
  });
}

/** Sets the pane's motion tokens on the document, as base.css would. */
export function motion(duration: string): void {
  document.documentElement.style.setProperty("--duration-pane", duration);
  document.documentElement.style.setProperty("--motion-pane", "ease-out");
}
