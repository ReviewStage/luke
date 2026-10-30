/**
 * after-paint.ts -- work a frame does not draw, started once that frame has painted.
 *
 * A press that chooses something draws it in the frame the press lands in,
 * and React runs the effects of that commit before the browser paints it, so
 * what an effect starts, a read sent or a write asked, is time the reader's
 * frame waits behind. `afterPaint` holds such work until the frame has
 * painted: two animation frames on, since the first runs before the paint it
 * belongs to and the second after it. A hidden tab paints no frames, so it
 * runs the work at once there, since nobody waits on that tab's paint.
 */

/** Runs `work` once the frame being drawn now has painted; answers what cancels it, which does nothing once it has run. */
export function afterPaint(work: () => void): () => void {
  let cancelled = false;
  const go = () => {
    if (!cancelled) work();
  };
  if (document.visibilityState === "hidden") {
    queueMicrotask(go);
    return () => {
      cancelled = true;
    };
  }
  let frame = globalThis.requestAnimationFrame(() => {
    frame = globalThis.requestAnimationFrame(go);
  });
  return () => {
    cancelled = true;
    globalThis.cancelAnimationFrame(frame);
  };
}
