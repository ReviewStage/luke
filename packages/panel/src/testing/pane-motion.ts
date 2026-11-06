interface Played {
  element: Element;
  keyframes: Keyframe[];
  finish: () => void;
}

interface RecordedMotion {
  onfinish: (() => void) | null;
  cancel: () => void;
}

export function playMotions() {
  const played: Played[] = [];
  const root = document.documentElement.style;
  root.setProperty("--ui-duration-pane", "240ms");
  root.setProperty("--ui-motion-pane", "ease-out");
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
  Object.defineProperty(Element.prototype, "getAnimations", {
    configurable: true,
    value: () => [],
  });
  return {
    played,
    remove: () => {
      root.removeProperty("--ui-duration-pane");
      root.removeProperty("--ui-motion-pane");
      Reflect.deleteProperty(Element.prototype, "animate");
      Reflect.deleteProperty(Element.prototype, "getAnimations");
    },
  };
}

const LIST_MOTION_TOKENS = {
  "--ui-duration-exit": "90ms",
  "--ui-motion-exit": "ease",
  "--ui-duration-shape": "460ms",
  "--ui-spring": "ease-out",
  "--ui-list-travel": "16px",
};

export function playListMotions() {
  const motions = playMotions();
  const root = document.documentElement.style;
  for (const [name, value] of Object.entries(LIST_MOTION_TOKENS)) root.setProperty(name, value);
  return {
    played: motions.played,
    remove: () => {
      motions.remove();
      for (const name of Object.keys(LIST_MOTION_TOKENS)) root.removeProperty(name);
    },
  };
}
