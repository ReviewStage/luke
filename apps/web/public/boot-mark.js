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

  function millisecondsOf(value) {
    const amount = Number.parseFloat(value);
    if (!Number.isFinite(amount)) return HINT_FALLBACK;
    return value.trim().endsWith("ms") ? amount : amount * 1000;
  }

  function motionHeld() {
    const duration = getComputedStyle(document.body).getPropertyValue("--ui-duration-fast");
    return duration.trim() !== "" && millisecondsOf(duration) <= 1;
  }

  function copperOf() {
    const probe = document.createElement("span");
    probe.style.color = "var(--ui-color-accent)";
    frame.appendChild(probe);
    const copper = getComputedStyle(probe).color;
    probe.remove();
    return copper;
  }

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

  function standDown() {
    canvas.remove();
    delete frame.dataset.bootMark;
  }

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

  function drawn(now) {
    if (!frame.isConnected) return false;
    if (leaveAt !== null && now - leaveAt >= fading) {
      frame.remove();
      return false;
    }
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
    if (leaveAt === null) gathered = clamp((now - start) / MOTION.REVEAL);
    const angle = ((now - start) / 1000) * LIGHT.TURN;
    context.fillStyle = copper;
    for (const d of dots) {
      const lit = LIGHT.FLOOR + studio(d.rx, d.ry, d.rz, angle) * LIGHT.GAIN > d.threshold;
      if (!lit) continue;
      const arrival = clamp((gathered - d.threshold * MOTION.STAGGER) / (1 - MOTION.STAGGER));
      if (arrival <= 0) continue;
      const settle = (0.5 + d.drift / 2) * MOTION.SETTLE * ratio * (1 - easeOut(arrival));
      context.globalAlpha = arrival;
      context.fillRect(d.x, Math.round(d.y + settle), dot, dot);
    }
    context.globalAlpha = 1;
    return true;
  }

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
