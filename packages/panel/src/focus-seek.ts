const FOCUS_FRAME_LIMIT = 60;

export function drawnVisibly(element: HTMLElement): boolean {
  return element.checkVisibility({ opacityProperty: true, visibilityProperty: true });
}

function staged(element: HTMLElement): boolean {
  return getComputedStyle(element).visibility === "visible";
}

export function focusSeek<Target extends HTMLElement>({
  find,
  ready = staged,
  act,
  frames: limit = FOCUS_FRAME_LIMIT,
}: {
  find: () => Target | null | undefined;
  ready?: (target: Target) => boolean;
  act: (target: Target) => void;
  frames?: number;
}): () => void {
  let frame = 0;
  let waited = 0;
  const seek = () => {
    const target = find();
    if (target && ready(target)) {
      act(target);
      return;
    }
    if (waited++ > limit) return;
    frame = requestAnimationFrame(seek);
  };
  seek();
  return () => cancelAnimationFrame(frame);
}
