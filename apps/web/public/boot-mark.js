// boot-mark.js -- the loading frame's mark as copper dots: they appear in
// place as the product's mark, a studio light moves through them by density
// alone, and they fade out with the frame as the app draws.
//
// app.html's frame holds the mark as an SVG; this classic script, run as the
// body is parsed (a file, because the page's policy runs no inline script),
// draws it instead as dots on a canvas over the frame, reading the mark's
// shape off that SVG. Each dot stands on a grid forty cells across the mark
// and is lit or not by the landing's 8×8 ordered dither (`@repo/ui`'s
// landing-paint.ts) over the light the landing's copper ball reflects
// (`@repo/ui`'s mark-orb.tsx), here off a flat mark seen from close by, so
// light reads as more dots and shadow as fewer, all in the theme's one
// copper. The dots appear once the wait has run long enough to notice
// (`--ui-hint-delay`), each fading in where it stands, in the dither's order,
// and settling the last few pixels into place, so the mark never draws outside
// its own box; the light keeps moving while the tab loads. When
// the panel draws, `src/app/web-root.tsx` lifts the frame out of the root and
// sends it `boot-frame-leave`: the dots stop where they stand and fade out
// with the frame's ground, as one layer, to the app beneath, and the frame
// removes itself once it has. Note that the dots never travel beyond the
// mark, because the panel's first screen (a sign-in card, most often) stands
// in the middle of the window, around it, and may draw at any moment of the
// dots' arrival. Where motion is held still, as
// reduced motion and a capture run hold it (`@repo/ui`'s `motionHeld`, read
// here the same way, off the motion tokens), or where a canvas cannot draw,
// the SVG mark stands still as before.
(() => {
  const GRID = { ACROSS: 40, DOT: 0.72, LEAST: 3 };
  const LIGHT = { FLOOR: 0.32, GAIN: 0.72, TURN: 0.55, LEAN: 0.8 };
  const MOTION = { REVEAL: 1000, STAGGER: 0.38, SETTLE: 4 };
  const HINT_FALLBACK = 500;
  const BAYER = [
    0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26, 12, 44, 4, 36, 14, 46, 6, 38, 60,
    28, 52, 20, 62, 30, 54, 22, 3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25, 15, 47,
    7, 39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29, 53, 21,
  ].map((rank) => (rank + 0.5) / 64);

  const frame = document.querySelector(".boot-frame");
  const markPath = frame?.querySelector(".boot-frame-mark path")?.getAttribute("d");
  if (!frame || !markPath || motionHeld()) return;
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) return;

  const clamp = (x) => Math.min(1, Math.max(0, x));
  const smooth = (from, to, x) => {
    const k = clamp((x - from) / (to - from));
    return k * k * (3 - 2 * k);
  };
  const easeOut = (x) => 1 - (1 - x) ** 4;

  /** How bright the landing ball's studio is in the direction (x, y, z), turned by `angle` about the vertical. */
  function studio(x, y, z, angle) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const rx = c * x + s * z;
    const rz = -s * x + c * z;
    const top = smooth(0.25, 0.6, y) * smooth(0.95, 0.5, Math.abs(rx));
    const strip = smooth(0.35, 0.65, rx) * smooth(0.75, 0.3, Math.abs(y));
    const rim = smooth(0.1, 0.5, -rz) * smooth(0.6, 0.15, Math.abs(y + 0.1)) * 0.7;
    return clamp(top * 0.9 + strip * 0.85 + rim);
  }

  /** A duration CSS gives, such as `500ms` or `0.5s`, in milliseconds. */
  function millisecondsOf(value) {
    const amount = Number.parseFloat(value);
    if (!Number.isFinite(amount)) return HINT_FALLBACK;
    return value.trim().endsWith("ms") ? amount : amount * 1000;
  }

  /** Whether motion is held still: the motion tokens' durations zeroed, as `@repo/ui`'s `motionHeld` reads them. */
  function motionHeld() {
    const duration = getComputedStyle(document.body).getPropertyValue("--ui-duration-fast");
    return duration.trim() !== "" && millisecondsOf(duration) <= 1;
  }

  /** The theme's copper as the browser resolves it, read through a probe so any color syntax works. */
  function copperOf() {
    const probe = document.createElement("span");
    probe.style.color = "var(--ui-color-accent)";
    frame.appendChild(probe);
    const copper = getComputedStyle(probe).color;
    probe.remove();
    return copper;
  }

  // The dots, laid out for the frame's size and the screen's density: one per cell of the mark's grid the mark covers.
  let layout = null;
  function layOut() {
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.round(frame.clientWidth * ratio);
    const height = Math.round(frame.clientHeight * ratio);
    const mark = frame.querySelector(".boot-frame-mark");
    const size = Math.round((mark?.clientWidth || 64) * ratio);
    canvas.width = width;
    canvas.height = height;
    const mask = document.createElement("canvas");
    mask.width = size;
    mask.height = size;
    const maskContext = mask.getContext("2d");
    if (!maskContext) return null;
    maskContext.scale(size / 100, size / 100);
    maskContext.fill(new Path2D(markPath));
    const covered = maskContext.getImageData(0, 0, size, size).data;
    // Note that a cell is never under three device pixels and a dot always leaves a pixel of gap in it, so the dots never merge into a solid.
    const cell = Math.max(GRID.LEAST, Math.round(size / GRID.ACROSS));
    const dot = Math.min(Math.round(cell * GRID.DOT), cell - 1);
    const left = Math.round((width - size) / 2);
    const top = Math.round((height - size) / 2);
    const dots = [];
    for (let j = 0; j * cell < size; j++) {
      for (let i = 0; i * cell < size; i++) {
        const cx = Math.min(size - 1, Math.floor(i * cell + cell / 2));
        const cy = Math.min(size - 1, Math.floor(j * cell + cell / 2));
        if (!covered[(cy * size + cx) * 4 + 3]) continue;
        // Where the flat mark reflects the studio from here: a viewer close by sees each point at its own angle.
        const u = ((cx / size) * 2 - 1) * LIGHT.LEAN;
        const v = (1 - (cy / size) * 2) * LIGHT.LEAN;
        const length = Math.hypot(u, v, 1);
        dots.push({
          x: left + i * cell,
          y: top + j * cell,
          rx: u / length,
          ry: v / length,
          rz: 1 / length,
          threshold: BAYER[(j % 8) * 8 + (i % 8)],
          drift: Math.random(),
        });
      }
    }
    return { width, height, ratio, size, dot, dots, copper: copperOf() };
  }

  const hint = millisecondsOf(
    getComputedStyle(document.documentElement).getPropertyValue("--ui-hint-delay"),
  );
  const start = performance.now() + hint;
  let leaveAt = null;
  let fading = 0;
  let gathered = 0;

  /** Takes the dots down and gives the frame back its still SVG, for the root's first render to replace as before. */
  function standDown() {
    canvas.remove();
    delete frame.dataset.bootMark;
  }

  /** Whether `layout` was laid out for the frame and the mark as they stand now. */
  function current(laidOut) {
    const mark = frame.querySelector(".boot-frame-mark");
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    return (
      laidOut !== null &&
      laidOut.ratio === ratio &&
      laidOut.width === Math.round(frame.clientWidth * ratio) &&
      laidOut.height === Math.round(frame.clientHeight * ratio) &&
      laidOut.size === Math.round((mark?.clientWidth || 64) * ratio)
    );
  }

  /** Draws one frame of the dots; answers whether there is another to draw. */
  function drawn(now) {
    if (!frame.isConnected) return false;
    if (leaveAt !== null && now - leaveAt >= fading) {
      frame.remove();
      return false;
    }
    // Note that motion is asked again on every frame before the dots leave, because a stylesheet that lands after this script can hold it still.
    if (leaveAt === null && motionHeld()) {
      standDown();
      return false;
    }
    if (!current(layout)) layout = layOut();
    if (!layout) {
      standDown();
      return false;
    }
    const { width, height, ratio, dot, dots, copper } = layout;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, width, height);
    // The dots hold where they stand once the frame leaves, so none crosses the panel as the frame fades.
    if (leaveAt === null) gathered = clamp((now - start) / MOTION.REVEAL);
    const angle = ((now - start) / 1000) * LIGHT.TURN;
    context.fillStyle = copper;
    for (const d of dots) {
      const lit = LIGHT.FLOOR + studio(d.rx, d.ry, d.rz, angle) * LIGHT.GAIN > d.threshold;
      if (!lit) continue;
      // Each dot arrives in the dither's order, fading in where it stands and settling up the last few pixels into place.
      const arrival = clamp((gathered - d.threshold * MOTION.STAGGER) / (1 - MOTION.STAGGER));
      if (arrival <= 0) continue;
      const settle = (0.5 + d.drift / 2) * MOTION.SETTLE * ratio * (1 - easeOut(arrival));
      context.globalAlpha = arrival;
      context.fillRect(d.x, Math.round(d.y + settle), dot, dot);
    }
    context.globalAlpha = 1;
    return true;
  }

  // Note that a frame that fails to draw gives the page back its still mark, or, once leaving, takes itself down, so a failure never hides the frame's mark nor leaves the frame over the panel.
  function paint(now) {
    try {
      if (drawn(now)) requestAnimationFrame(paint);
    } catch {
      if (leaveAt === null) standDown();
      else frame.remove();
    }
  }

  canvas.className = "boot-frame-dots";
  canvas.setAttribute("aria-hidden", "true");
  frame.appendChild(canvas);
  frame.dataset.bootMark = "live";
  frame.addEventListener(
    "boot-frame-leave",
    () => {
      if (gathered <= 0) {
        frame.remove();
        return;
      }
      leaveAt = performance.now();
      frame.dataset.leaving = "true";
      fading = millisecondsOf(getComputedStyle(frame).transitionDuration);
    },
    { once: true },
  );
  requestAnimationFrame(paint);
})();
