import { type RefObject, useEffect, useState } from "react";
import { heldStill } from "./landing-paint.js";

/**
 * landing-story.ts -- the clock the landing's scenes play their stories on, and the moment their times count back from.
 *
 * A story is a count of steps, each held for a beat. Its clock runs only
 * while the scene is on screen, so a reader scrolling to it meets its start,
 * starts over at its end, and where motion is held stands at its last step,
 * where the whole story is told. Every time a scene shows counts back from
 * one fixed moment, so a page drawn on any day says the same ages, and a
 * prerendered page and the browser agree. A page too narrow for a whole
 * window shows a scene's telling moment alone (`landing.css`), so a scene
 * may play only the end of its story there, from that moment on.
 */

/** The moment every scene's times count back from. */
export const STORY_NOW = Date.UTC(2026, 10, 2, 21, 52);

export const MINUTE = 60_000;

/** The width under which the page draws a phone's landing, as `landing.css`'s container query steps. */
const NARROW_PAGE = 640;

/** Nothing: no part of a scene is ever pressed. */
export function still(): void {}

/** Whether the landing page the element `ref` names stands on is under 640px wide; false until it is measured. */
export function useNarrowPage(ref: RefObject<HTMLDivElement | null>): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const page = ref.current?.closest(".ui-landing-page");
    // Note that a document with no layout, as jsdom's is, stays wide, because it has no page to measure.
    if (!page || typeof ResizeObserver === "undefined") return undefined;
    const watch = new ResizeObserver(([entry]) => {
      const width = entry?.contentRect.width ?? 0;
      setNarrow(width > 0 && width < NARROW_PAGE);
    });
    watch.observe(page);
    return () => watch.disconnect();
  }, [ref]);
  return narrow;
}

/**
 * A story's step, from 0 to `count - 1`, held `beat` milliseconds each, on a
 * clock that runs only while the element `ref` names is on screen, or the
 * last step where motion is held.
 */
export function useStory(
  ref: RefObject<HTMLDivElement | null>,
  count: number,
  beat: number,
): number {
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
  }, [ref, count, beat]);
  return step;
}
