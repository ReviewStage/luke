/**
 * pane-motion.ts -- the window's pane motion under jsdom: the motion tokens set and an animation engine that records what is played rather than playing it.
 */

/** A motion the page played: the element it played on, its keyframes, and a way to have it finish. */
interface Played {
  element: Element;
  keyframes: Keyframe[];
  finish: () => void;
}

/** What the recording engine answers a motion with: no more of an Animation than the page reaches for. */
interface RecordedMotion {
  onfinish: (() => void) | null;
  cancel: () => void;
}

/**
 * Gives the window the pane's motion tokens and an animation engine that
 * records what is played rather than playing it, since jsdom has neither;
 * answers what was played, and a way to take both away again.
 */
export function playMotions() {
  const played: Played[] = [];
  const root = document.documentElement.style;
  root.setProperty("--duration-pane", "240ms");
  root.setProperty("--motion-pane", "ease-out");
  Object.defineProperty(Element.prototype, "animate", {
    configurable: true,
    value(this: Element, keyframes: Keyframe[]) {
      const animation: RecordedMotion = {
        onfinish: null,
        cancel: () => undefined,
      };
      played.push({ element: this, keyframes, finish: () => animation.onfinish?.() });
      return animation;
    },
  });
  // Note that a motion recorded is never running, so an exit that stops what runs first finds nothing to stop.
  Object.defineProperty(Element.prototype, "getAnimations", {
    configurable: true,
    value: () => [],
  });
  return {
    played,
    remove: () => {
      root.removeProperty("--duration-pane");
      root.removeProperty("--motion-pane");
      Reflect.deleteProperty(Element.prototype, "animate");
      Reflect.deleteProperty(Element.prototype, "getAnimations");
    },
  };
}
