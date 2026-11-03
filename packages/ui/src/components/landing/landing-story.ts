import { type RefObject, useEffect, useRef, useState } from "react";
import { prefersStill } from "./landing-paint.js";

/**
 * landing-story.ts -- the clock the landing's scenes play their stories on, and the moment their times count back from.
 *
 * A story is a count of steps, each held for a beat. Its clock runs only
 * while the scene is on screen, so a reader scrolling to it meets its start,
 * starts over at its end, and under reduced motion stands at its last step,
 * where the whole story is told. Every time a scene shows counts back from
 * one fixed moment, so a page drawn on any day says the same ages, and a
 * prerendered page and the browser agree.
 */

/** The moment every scene's times count back from. */
export const STORY_NOW = Date.UTC(2026, 10, 2, 21, 52);

export const MINUTE = 60_000;

/** Nothing: no part of a scene is ever pressed. */
export function still(): void {}

/**
 * A story's step, from 0 to `count - 1`, held `beat` milliseconds each, on a
 * clock that runs only while the element `ref` names is on screen, or the
 * last step under reduced motion.
 */
export function useStory(
  count: number,
  beat: number,
): readonly [RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState(0);
  useEffect(() => {
    const scene = ref.current;
    if (!scene) return undefined;
    if (prefersStill()) {
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
    // Note that time only counts while the scene is shown, so a reader scrolling to it meets the story's start.
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
