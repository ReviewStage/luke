import { type RefObject, useEffect, useRef, useState } from "react";
import { heldStill } from "./landing-paint.js";

export const STORY_NOW = Date.UTC(2026, 10, 2, 21, 52);

export const MINUTE = 60_000;

export function still(): void {}

export function useStory(
  count: number,
  beat: number,
): readonly [RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState(0);
  useEffect(() => {
    const scene = ref.current;
    if (!scene) return undefined;
    if (heldStill()) {
      setStep(count - 1);
      return undefined;
    }
    let shown = false;
    let played = 0;
    let previous: number | undefined;
    let frame = 0;
    const watch = new IntersectionObserver(([entry]) => {
      shown = entry?.isIntersecting ?? false;
    });
    watch.observe(scene);
    const tick = (ms: number): void => {
      if (shown && previous !== undefined) played += ms - previous;
      previous = ms;
      setStep(Math.floor(played / beat) % count);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      watch.disconnect();
    };
  }, [count, beat]);
  return [ref, step];
}
