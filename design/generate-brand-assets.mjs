#!/usr/bin/env node
// Luke brand-asset generator — the single source of truth for the artwork.
// The identity is the L-face: a monoline capital-L nose curling into a smile,
// two eyes above it. Edit the constants below and re-run:
//
//   node design/generate-brand-assets.mjs
//
// It writes three kinds of output, all from the one description of the face and
// its motions further down:
//
//   design/brand/**.svg                              standalone assets (SMIL)
//   apps/desktop/src/renderer/luke-face-art.ts       the face, for the app
//   apps/desktop/src/renderer/styles/face-motion.css the motions, as @keyframes
//
// The app draws the face itself rather than loading these SVGs, because it needs
// what a baked asset cannot give it: `currentColor`, so one drawing serves the
// menu bar and the notch, and CSS animation, so the renderer's own motion tokens
// can hold every loop still for a capture run or for reduced motion. Emitting
// its two inputs from here keeps that second copy from being a second source.
//
// PNG derivatives (app icon sizes, menu-bar template) are rasterized
// separately — see design/brand/README.md.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DMG_WINDOW } from "./dmg-window.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "brand");
const APP_RENDERER = join(HERE, "..", "apps", "desktop", "src", "renderer");

// ---------- Palette ----------
// Inks are named for the UI mode they serve: the dark-mode asset is light.
const INKS = { light: "#1d1d1f", dark: "#f5f5f7" };
// Icon tiles follow the same naming: the dark-mode tile is space black under a
// light face, the light-mode tile is porcelain under a dark one.
const TILES = {
  light: { gradient: ["#fbfbfd", "#d8d8dd"], ink: "#1d1d1f" },
  dark: { gradient: ["#48484a", "#1c1c1e"], ink: "#f8fafc" },
};

// ---------- Artwork parameters ----------
// The face lives on a 240x240 canvas: stroke weight, nose corner radius,
// smile lift, base head tilt, and eye size/spread/height.
const FACE = { sw: 16, r: 14, lift: 22, tilt: -8, eyeR: 12, spread: 84, eyeY: 92 };
// Face-first caps wordmark: the face is the capital L, followed by custom
// U-K-E letterforms at cap height. Letter weight matches the face's
// effective stroke (sw x scale) so the face-L does not read heavier.
const WORDMARK = { scale: 1.55, gap: 14, uRadius: 46, sp: 8 };
// The square window the app draws the face through, centred on the artwork's
// optical centre. It is wider than the face so the quiet motions have room;
// the loud ones are allowed to leave it, which is why the app does not clip it.
const APP_VIEW = { size: 146, cx: 121, cy: 124 };

// ---------- Helpers ----------
const fmt = (v) => Math.round(v * 100) / 100;
const EASE = "0.4 0 0.6 1";
// A spline is written for SMIL; CSS wants the same four numbers as a function.
const bezier = (spline) => `cubic-bezier(${spline.split(" ").join(", ")})`;

function animT(type, values, dur, opts = {}) {
  const kt = opts.keyTimes ? ` keyTimes="${opts.keyTimes}"` : "";
  const ks = opts.spline ? ` calcMode="spline" keySplines="${opts.spline}"` : "";
  return `<animateTransform attributeName="transform" type="${type}" values="${values}"${kt}${ks} dur="${fmt(dur)}s" repeatCount="indefinite"/>`;
}
const wrapAnim = (inner, anim) => `<g>${anim}${inner}</g>`;
// Scales about the face's optical center (SMIL scale has no origin of its own).
const scaleAbout = (inner, values, dur, opts = {}) =>
  `<g transform="translate(120 124)"><g>${animT("scale", values, dur, opts)}` +
  `<g transform="translate(-120 -124)">${inner}</g></g></g>`;

const stroke = (w) =>
  `fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"`;

// ---------- The face ----------
const smileD = (lift) =>
  `M 104 84 V ${fmt(164 - FACE.r)} Q 104 164 ${fmt(104 + FACE.r)} 164 Q 140 164 168 ${fmt(164 - lift)}`;
const eyeXs = () => [120 - FACE.spread / 2, 120 + FACE.spread / 2];

const eye = (cx) =>
  `<circle cx="${fmt(cx)}" cy="${fmt(FACE.eyeY)}" r="${fmt(FACE.eyeR)}" fill="currentColor"/>`;
// An eye whose vertical radius animates through `values` (blinks, squeezes).
const eyeRy = (cx, values, kt, dur) =>
  `<ellipse cx="${fmt(cx)}" cy="${FACE.eyeY}" rx="${FACE.eyeR}" ry="${FACE.eyeR}" fill="currentColor">` +
  `<animate attributeName="ry" values="${values}" keyTimes="${kt}" dur="${dur}s" repeatCount="indefinite"/></ellipse>`;
// An eye whose whole radius animates — widening rather than closing.
const eyeR = (cx, values, kt, dur) =>
  `<circle cx="${fmt(cx)}" cy="${FACE.eyeY}" r="${FACE.eyeR}" fill="currentColor">` +
  `<animate attributeName="r" values="${values}" keyTimes="${kt}" dur="${dur}s" repeatCount="indefinite"/></circle>`;
const browD = (cx) => {
  const r = FACE.eyeR;
  const y = FACE.eyeY;
  return `M ${fmt(cx - r * 0.85)} ${fmt(y - r - 9)} Q ${fmt(cx)} ${fmt(y - r - 15)} ${fmt(cx + r * 0.85)} ${fmt(y - r - 9)}`;
};
const BROW_WIDTH = 5;
const brow = (cx) =>
  `<path d="${browD(cx)}" stroke="currentColor" stroke-width="${BROW_WIDTH}" stroke-linecap="round" fill="none"/>`;
const lidD = (cx) => {
  const r = FACE.eyeR;
  const y = FACE.eyeY;
  return `M ${fmt(cx - r)} ${fmt(y - r * 0.05)} Q ${fmt(cx)} ${fmt(y + r * 0.75)} ${fmt(cx + r)} ${fmt(y - r * 0.05)}`;
};
const LID_WIDTH = fmt(Math.max(4.5, FACE.eyeR * 0.5));
const lid = (cx) =>
  `<path d="${lidD(cx)}" stroke="currentColor" stroke-width="${LID_WIDTH}" stroke-linecap="round" fill="none"/>`;

// The z's that drift off a sleeping head: where each starts, how big, and where
// in the shared three-second loop its rise begins. The stagger is a keyframe
// phase rather than a negative delay: a paused animation with a negative delay
// holds at its resolved current time, not its first frame, so a capture run or
// reduced motion stopping the loop at time zero would freeze two z's mid-air.
// With every glyph's own loop starting invisible, paused means unseen.
const SLEEP_Z = [
  { x: 176, y: 62, size: 8, start: 0 },
  { x: 190, y: 46, size: 11, start: 0.4 },
  { x: 166, y: 44, size: 6, start: 0.2 },
];
const SLEEP_Z_DURATION = 3;
// How much of the loop a z spends rising; the rest of it is spent unseen.
const SLEEP_Z_RISE = 0.6;
const SLEEP_Z_WIDTH = 3.5;
const SLEEP_Z_DRIFT = [6, -16];
const zGlyphD = (size) => `M 0 0 H ${size} L 0 ${size} H ${size}`;
/** A z's rise as keyframe times, holding its resting value outside the window. */
const zTrack = (start, times, values) => {
  const shifted = times.map((time, index) => [+(start + time).toFixed(4), values[index]]);
  const framed = [[0, values[0]], ...shifted, [1, values[values.length - 1]]];
  // A window already touching either edge needs no frame drawn onto it.
  const kept = framed.filter(([time], index) => index === 0 || time > framed[index - 1][0]);
  return {
    times: kept.map(([time]) => time),
    values: kept.map(([, value]) => value),
  };
};
const zGlyph = ({ x, y, size, start }) => {
  const rise = SLEEP_Z_RISE;
  const opacity = zTrack(start, [0, rise / 2, rise], ["0", "0.85", "0"]);
  const travel = zTrack(
    start,
    [0, rise],
    [`${x} ${y}`, `${x + SLEEP_Z_DRIFT[0]} ${y + SLEEP_Z_DRIFT[1]}`],
  );
  return (
    `<g opacity="0" transform="translate(${x} ${y})">` +
    `<animate attributeName="opacity" values="${opacity.values.join(";")}" keyTimes="${opacity.times.join(";")}" dur="${SLEEP_Z_DURATION}s" repeatCount="indefinite"/>` +
    `<animateTransform attributeName="transform" type="translate" values="${travel.values.join(";")}" keyTimes="${travel.times.join(";")}" dur="${SLEEP_Z_DURATION}s" repeatCount="indefinite"/>` +
    `<path d="${zGlyphD(size)}" stroke="currentColor" stroke-width="${SLEEP_Z_WIDTH}" stroke-linecap="round" stroke-linejoin="round" fill="none"/></g>`
  );
};

// Composes the face. opts: { eyes, extra } override the defaults.
function face(opts = {}) {
  const [c1, c2] = eyeXs();
  const smile = `<path d="${smileD(FACE.lift)}" ${stroke(FACE.sw)}/>`;
  const eyes = opts.eyes !== undefined ? opts.eyes : eye(c1) + eye(c2);
  return `<g transform="rotate(${FACE.tilt} 120 124)">${smile}${eyes}${opts.extra || ""}</g>`;
}

// ---------- Motion states ----------
// Emotion is expressed by whole-head or eyes-only motion; the mouth never
// morphs — mouth morphing read as unnatural. Each motion is a stack of
// transform layers, innermost first, over a face that may need more parts drawn
// than the resting one. Every easing is spline-based so nothing reads
// mechanical; a layer that does not name its own splines eases every interval.
//
// Layers: { type: rotate | translate | scale, values, dur, keyTimes?, splines? }
// and `pivot` for a rotation. Rotation values are degrees; translation values
// are canvas units; scale values are factors. A layer with `hold` instead of
// `values` is a fixed offset rather than an animation.
//
// Eyes: { kind, factors, keyTimes, dur } scales the eye radius through
// `factors` — vertically for a blink or a squeeze, both ways for a widening.
const MOTIONS = {
  // Quick head rocking with a vertical bob on an offset period, like a person
  // mid-sentence.
  talking: {
    moment: "speaking / narrating (head bob)",
    layers: [
      {
        type: "rotate",
        pivot: [120, 150],
        values: [0, -4, 4, 0],
        keyTimes: [0, 0.25, 0.75, 1],
        dur: 0.65,
      },
      {
        type: "translate",
        values: [
          [0, 0],
          [0, 2.5],
          [0, 0],
        ],
        dur: 0.4,
      },
    ],
  },
  // An easy nod from a pivot near the chin.
  yes: {
    moment: "acknowledged (nod)",
    layers: [
      {
        type: "rotate",
        pivot: [120, 190],
        values: [0, 0, 8, 0, 0],
        keyTimes: [0, 0.15, 0.45, 0.75, 1],
        dur: 2.2,
      },
    ],
  },
  // An agitated wiggle that decays to stillness, then a long rest.
  error: {
    moment: "something went wrong (shimmy)",
    layers: [
      {
        type: "rotate",
        pivot: [120, 124],
        values: [0, 6, -6, 4.2, -4.2, 1.8, 0, 0],
        keyTimes: [0, 0.05, 0.11, 0.17, 0.23, 0.29, 0.35, 1],
        dur: 3,
      },
    ],
  },
  // Eyes squeeze nearly shut while the face leans in — peering at detail.
  reviewing: {
    moment: "inspecting a session (wince-like squint)",
    layers: [
      {
        type: "scale",
        values: [
          [1, 1],
          [1, 1],
          [1.03, 1.03],
          [1.03, 1.03],
          [1, 1],
          [1, 1],
        ],
        keyTimes: [0, 0.35, 0.42, 0.68, 0.76, 1],
        dur: 4.4,
      },
    ],
    eyes: {
      kind: "squeeze",
      factors: [1, 1, 0.18, 0.18, 1, 1],
      keyTimes: [0, 0.35, 0.42, 0.68, 0.76, 1],
      dur: 4.4,
    },
  },
  // A happy hop with squash-and-stretch: crouch, spring, land.
  success: {
    moment: "task done (squash-and-stretch hop)",
    layers: [
      {
        type: "scale",
        values: [
          [1, 1],
          [1.05, 0.93],
          [0.96, 1.06],
          [1.07, 0.9],
          [1, 1],
          [1, 1],
        ],
        keyTimes: [0, 0.25, 0.45, 0.65, 0.75, 1],
        dur: 2,
      },
      {
        type: "translate",
        values: [
          [0, 0],
          [0, 0],
          [0, -14],
          [0, 0],
          [0, 0],
          [0, 0],
        ],
        keyTimes: [0, 0.25, 0.45, 0.65, 0.75, 1],
        dur: 2,
      },
    ],
  },
  // Ease over to one side, hold, ease back — the curious tilt.
  listening: {
    moment: "curious tilt",
    layers: [
      {
        type: "rotate",
        pivot: [120, 124],
        values: [0, 0, -12, -12, 0, 0],
        keyTimes: [0, 0.18, 0.32, 0.68, 0.82, 1],
        dur: 3.6,
      },
    ],
  },
  // An occasional quick double-blink — the smallest sign of life.
  idle: {
    moment: "double blink",
    layers: [],
    eyes: {
      kind: "blink",
      factors: [1, 1, 0.1, 1, 0.1, 1, 1],
      keyTimes: [0, 0.55, 0.585, 0.62, 0.655, 0.69, 1],
      dur: 4.6,
    },
  },
  // Brows pop up and the eyes widen for a beat — "oh!".
  notification: {
    moment: "attention caught by something new (brow flash)",
    layers: [],
    eyes: {
      kind: "widen",
      factors: [1, 1, 1.2, 1.2, 1, 1],
      keyTimes: [0, 0.5, 0.55, 0.72, 0.77, 1],
      dur: 4,
    },
    brows: {
      values: [
        [0, 0],
        [0, 0],
        [0, -6],
        [0, -6],
        [0, 0],
        [0, 0],
      ],
      keyTimes: [0, 0.5, 0.55, 0.72, 0.77, 1],
      dur: 4,
    },
  },
  // One eye closes with a small head-tip toward it.
  wink: {
    moment: "confirmation / easter egg",
    layers: [
      {
        type: "rotate",
        pivot: [120, 150],
        values: [0, 0, 2.5, 2.5, 0, 0],
        keyTimes: [0, 0.5, 0.56, 0.68, 0.74, 1],
        dur: 4,
      },
    ],
    eyes: {
      kind: "wink",
      factors: [1, 1, 0.12, 0.12, 1, 1],
      keyTimes: [0, 0.5, 0.56, 0.68, 0.74, 1],
      dur: 4,
    },
  },
  // Lids down, head drooped, slow deep breathing, z's drifting up.
  sleeping: {
    moment: "nothing to watch (lids down, zzz)",
    layers: [
      { type: "rotate", pivot: [120, 150], hold: 7 },
      {
        type: "scale",
        values: [
          [1, 1],
          [1.035, 1.035],
          [1, 1],
        ],
        dur: 4.8,
      },
    ],
    eyes: { kind: "lids" },
    sleepZ: true,
  },
  // One full pirouette with an ease-out landing, then a long rest.
  refresh: {
    moment: "relaunch (one pirouette)",
    layers: [
      {
        type: "rotate",
        pivot: [120, 124],
        values: [0, 360, 360],
        keyTimes: [0, 0.3, 1],
        splines: ["0.35 0 0.25 1", EASE],
        dur: 4.5,
      },
    ],
  },
  // A quick puff, as if tapped — feedback for clicks and hovers.
  boop: {
    moment: "tap feedback (puff)",
    layers: [
      {
        type: "scale",
        values: [
          [1, 1],
          [1, 1],
          [1.09, 1.09],
          [0.985, 0.985],
          [1, 1],
        ],
        keyTimes: [0, 0.55, 0.63, 0.72, 1],
        dur: 3.2,
      },
    ],
  },
  // One slow rock from the base, out to each side and back — quiet work, made
  // visible. It begins and ends upright, so the app can spend it as a gesture
  // between stretches of stillness rather than rocking for as long as work runs.
  monitoring: {
    moment: "humming along (slow sway)",
    layers: [{ type: "rotate", pivot: [120, 196], values: [0, 3.5, 0, -3.5, 0], dur: 3.6 }],
  },
  // Leans in from the side and settles — an entrance. It ends at the resting
  // pose and stays there: a play that ended leaning back out would snap to the
  // drawn rest the instant the animation dropped. It alone begins away from
  // rest, because it is made for the moment the face is first drawn, where
  // there is no earlier pose to snap from.
  appear: {
    moment: "attaching (peek-slide in)",
    layers: [
      {
        type: "rotate",
        pivot: [76, 190],
        values: [8, 8, 0, 0],
        keyTimes: [0, 0.15, 0.3, 1],
        dur: 4,
      },
      {
        type: "translate",
        values: [
          [-16, 0],
          [-16, 0],
          [0, 0],
          [0, 0],
        ],
        keyTimes: [0, 0.15, 0.3, 1],
        dur: 4,
      },
    ],
  },
  // Settles into a slouch, bolts upright with a touch of overshoot, and comes
  // back to rest. The slouch is inside the gesture rather than at either end of
  // it: a motion that begins away from rest starts by snapping there.
  attention: {
    moment: "attention caught (perk up)",
    layers: [
      {
        type: "rotate",
        pivot: [120, 150],
        values: [0, 6, 6, -2.5, 0.8, 0, 0],
        keyTimes: [0, 0.2, 0.42, 0.5, 0.58, 0.75, 1],
        dur: 4.5,
      },
      {
        type: "translate",
        values: [
          [0, 0],
          [0, 3],
          [0, 3],
          [0, -1.5],
          [0, 0],
          [0, 0],
          [0, 0],
        ],
        keyTimes: [0, 0.2, 0.42, 0.5, 0.58, 0.75, 1],
        dur: 4.5,
      },
    ],
  },
  // A slow vertical drift with a lazy rotation, out of rest and back into it.
  // Both layers share a period: the app plays a motion once and returns the face
  // to rest, so a layer on its own period would be cut wherever it had got to.
  floating: {
    moment: "hovering idle",
    layers: [
      {
        type: "rotate",
        pivot: [120, 124],
        values: [0, -2, 2, 0],
        keyTimes: [0, 0.25, 0.75, 1],
        dur: 4.8,
      },
      {
        type: "translate",
        values: [
          [0, 0],
          [0, -8],
          [0, 0],
        ],
        dur: 4.8,
      },
    ],
  },
  // Ducks down, waits, then pops back up with a little overshoot.
  hiding: {
    moment: "minimized (peekaboo duck)",
    layers: [
      {
        type: "translate",
        values: [
          [0, 0],
          [0, 0],
          [0, 55],
          [0, 55],
          [0, -4],
          [0, 0],
        ],
        keyTimes: [0, 0.35, 0.45, 0.65, 0.78, 1],
        dur: 5,
      },
    ],
  },
  // The hover showpiece: a little crouch, a banked dash off the edge, a beat
  // out of sight, and a swoop back in from the other side that lands with a
  // touch of overshoot. The teleport from one side to the other happens far
  // above the frame, so the wing's clip never draws the face crossing back —
  // it leaves to the right and returns from the upper left.
  flyoff: {
    moment: "hover flourish (fly off and swoop back)",
    layers: [
      {
        type: "rotate",
        pivot: [120, 124],
        values: [0, -10, 22, 10, -14, -14, 5, 0, 0],
        keyTimes: [0, 0.1, 0.26, 0.34, 0.4, 0.46, 0.62, 0.72, 1],
        dur: 3,
      },
      {
        type: "translate",
        values: [
          [0, 0],
          [-16, 6],
          [280, -90],
          [280, -240],
          [-340, -240],
          [-340, -110],
          [16, 8],
          [0, 0],
          [0, 0],
        ],
        keyTimes: [0, 0.1, 0.26, 0.34, 0.4, 0.46, 0.62, 0.72, 1],
        // The dash accelerates away and the swoop brakes in; everything the
        // frame cannot see keeps the default curve.
        splines: [EASE, "0.5 0 0.9 0.5", EASE, EASE, EASE, "0.1 0.5 0.3 1", EASE, EASE],
        dur: 3,
      },
    ],
  },
  // Two eyebrow waggles — pure mischief.
  tease: {
    moment: "playful (brow waggle)",
    layers: [],
    brows: {
      values: [
        [0, 0],
        [0, 0],
        [0, -6],
        [0, 0],
        [0, -6],
        [0, 0],
        [0, 0],
      ],
      keyTimes: [0, 0.45, 0.52, 0.59, 0.66, 0.73, 1],
      dur: 4.2,
    },
  },
  // Two impatient little bounces, then waiting — a foot-tap.
  waiting: {
    moment: "needs approval (fidget)",
    layers: [
      {
        type: "translate",
        values: [
          [0, 0],
          [0, -5],
          [0, 0],
          [0, -5],
          [0, 0],
          [0, 0],
        ],
        keyTimes: [0, 0.07, 0.14, 0.21, 0.28, 1],
        dur: 2.4,
      },
    ],
  },
  // A relaxed side-to-side wiggle that eases out — shaking something off,
  // happily. The same decaying shape as the error shimmy, but spread over most
  // of the cycle at a lower tempo, so it reads as loosening up rather than
  // agitation; the two must not share artwork, because one carries a failure
  // and the other must never.
  shimmy: {
    moment: "shaking it off (happy wiggle)",
    layers: [
      {
        type: "rotate",
        pivot: [120, 124],
        values: [0, -9, 8, -5.5, 3, -1.2, 0, 0],
        keyTimes: [0, 0.12, 0.26, 0.4, 0.52, 0.62, 0.7, 1],
        dur: 2.6,
      },
    ],
  },
  // A woozy wobble that settles: the head rolls in decaying arcs while a small
  // counter-sway keeps it off balance, and the eyes sit half-lidded until the
  // world stops moving. Both layers and the eyes share the period, as every
  // one-shot must.
  dizzy: {
    moment: "woozy after a flight (decaying wobble)",
    layers: [
      {
        type: "rotate",
        pivot: [120, 150],
        values: [0, 9, -8, 6, -4, 2, 0, 0],
        keyTimes: [0, 0.1, 0.24, 0.38, 0.52, 0.66, 0.78, 1],
        dur: 3.2,
      },
      {
        type: "translate",
        values: [
          [0, 0],
          [2, 0],
          [-2, 0],
          [1.5, 0],
          [-1, 0],
          [0.5, 0],
          [0, 0],
          [0, 0],
        ],
        keyTimes: [0, 0.1, 0.24, 0.38, 0.52, 0.66, 0.78, 1],
        dur: 3.2,
      },
    ],
    eyes: {
      kind: "squeeze",
      factors: [1, 0.55, 0.55, 1, 1],
      keyTimes: [0, 0.15, 0.55, 0.75, 1],
      dur: 3.2,
    },
  },
  // A look to one side, a hold, a sweep to the other, and back — checking both
  // ways. The eyes cannot travel (they only ever scale), so the glance is the
  // whole head's, leaning from a pivot near the chin the way the nod does.
  glance: {
    moment: "checking both ways (look around)",
    layers: [
      {
        type: "rotate",
        pivot: [120, 190],
        values: [0, 0, -7, -7, 7, 7, 0, 0],
        keyTimes: [0, 0.12, 0.24, 0.42, 0.56, 0.74, 0.86, 1],
        dur: 3.4,
      },
    ],
  },
};

const MOTION_NAMES = Object.keys(MOTIONS);
// Per-interval easing for anything with `values`: its own splines, or the
// default ease on every interval. Eyes are the exception — they animate with
// no splines at all, which SMIL and CSS both read as linear.
const motionSplines = (part) => part.splines ?? Array(part.values.length - 1).fill(EASE);
/** The longest loop in a motion: how long a caller must wait to see all of it. */
function motionCycleMs(motion) {
  const durations = [
    ...motion.layers.filter((layer) => layer.values).map((layer) => layer.dur),
    ...(motion.eyes?.dur ? [motion.eyes.dur] : []),
    ...(motion.brows?.dur ? [motion.brows.dur] : []),
    ...(motion.sleepZ ? [SLEEP_Z_DURATION] : []),
  ];
  return Math.round(Math.max(...durations, 0) * 1000);
}

// ---------- Motions as SMIL ----------
function svgEyes(motion) {
  const [c1, c2] = eyeXs();
  const eyes = motion.eyes;
  if (!eyes) return eye(c1) + eye(c2);
  if (eyes.kind === "lids") return lid(c1) + lid(c2);
  const kt = eyes.keyTimes.join(";");
  const radii = eyes.factors.map((factor) => fmt(FACE.eyeR * factor)).join(";");
  // The wink animates the eye it closes and draws the open one after it.
  if (eyes.kind === "wink") return eyeRy(c2, radii, kt, eyes.dur) + eye(c1);
  if (eyes.kind === "widen") return eyeR(c1, radii, kt, eyes.dur) + eyeR(c2, radii, kt, eyes.dur);
  return eyeRy(c1, radii, kt, eyes.dur) + eyeRy(c2, radii, kt, eyes.dur);
}

function svgBrows(motion) {
  const [c1, c2] = eyeXs();
  if (!motion.brows) return "";
  const { values, keyTimes, dur } = motion.brows;
  return wrapAnim(
    brow(c1) + brow(c2),
    animT("translate", values.map((pair) => pair.join(" ")).join(";"), dur, {
      keyTimes: keyTimes.join(";"),
      spline: motionSplines(motion.brows).join(";"),
    }),
  );
}

function motionSvg(motion) {
  let body = face({ eyes: svgEyes(motion), extra: svgBrows(motion) });
  for (const layer of motion.layers) {
    if (layer.hold !== undefined) {
      body = `<g transform="rotate(${layer.hold} ${layer.pivot.join(" ")})">${body}</g>`;
      continue;
    }
    const opts = {
      keyTimes: layer.keyTimes ? layer.keyTimes.join(";") : undefined,
      spline: motionSplines(layer).join(";"),
    };
    if (layer.type === "scale") {
      body = scaleAbout(
        body,
        layer.values.map((pair) => pair.join(" ")).join(";"),
        layer.dur,
        opts,
      );
      continue;
    }
    const values =
      layer.type === "rotate"
        ? layer.values.map((angle) => `${angle} ${layer.pivot.join(" ")}`).join(";")
        : layer.values.map((pair) => pair.join(" ")).join(";");
    body = wrapAnim(body, animT(layer.type, values, layer.dur, opts));
  }
  if (motion.sleepZ) body += SLEEP_Z.map(zGlyph).join("");
  return body;
}

// ---------- Motions as CSS ----------
// The app cannot use the SMIL above: it needs the renderer's `--face-motion`
// token to be able to stop every loop at once, which only CSS animation offers.
// Each layer, each eye, and each brow becomes one @keyframes and one rule that
// names it. A part that eases every interval with one curve carries it on the
// rule; only mixed curves become per-keyframe timing functions, which is the
// only way CSS can express a keySplines list. No curve at all is linear, which
// the wiring in base.css already says.
const cssTime = (fraction) => `${+(fraction * 100).toFixed(4)}%`;

// How each transform a part can play is written. Eye factors are scalars: a
// widen scales the whole eye and everything else squeezes it vertically.
const TRANSFORM_CSS = {
  rotate: (angle) => `rotate(${angle}deg)`,
  scale: ([x, y]) => `scale(${x}, ${y})`,
  translate: ([x, y]) => `translate(${x}px, ${y}px)`,
};

const evenTimes = (count) => Array.from({ length: count }, (_, index) => index / (count - 1));

function cssKeyframes(name, steps, easings = []) {
  const blocks = steps.map(({ at, declaration }, index) => {
    const easing = easings[index] ? `\n    animation-timing-function: ${easings[index]};` : "";
    return `  ${cssTime(at)} {\n    ${declaration}${easing}\n  }`;
  });
  return `@keyframes ${name} {\n${blocks.join("\n\n")}\n}`;
}

const originCss = (pivot) =>
  pivot ? `\n  transform-origin: ${pivot.map((n) => `${n}px`).join(" ")};` : "";

// One moving part: its @keyframes, and the rule that plays them on `target`.
// `splines` is per-interval SMIL easing, or undefined for a part with none.
function partCss({ target, name, part, transform, splines, pivot }) {
  const times = part.keyTimes ?? evenTimes(part.values.length);
  const steps = part.values.map((value, index) => ({
    at: times[index],
    declaration: `transform: ${transform(value)};`,
  }));
  const uniform = splines === undefined || splines.every((spline) => spline === splines[0]);
  const block = cssKeyframes(name, steps, uniform ? [] : splines.map(bezier));
  const easing = uniform && splines ? `\n  animation-timing-function: ${bezier(splines[0])};` : "";
  const rule = `${target} {${originCss(pivot)}\n  animation-name: ${name};\n  animation-duration: ${part.dur}s;${easing}\n}`;
  return { block, rule };
}

function motionCss(name, motion) {
  const selector = `.luke-face[data-motion="${name}"]`;
  const blocks = [];
  const rules = [];
  const emit = (part) => {
    const { block, rule } = partCss(part);
    blocks.push(block);
    rules.push(rule);
  };

  motion.layers.forEach((layer, index) => {
    const target = `${selector} .luke-face-layer-${index + 1}`;
    const pivot = layer.type === "translate" ? undefined : (layer.pivot ?? [120, 124]);
    if (layer.hold !== undefined) {
      rules.push(`${target} {${originCss(pivot)}\n  transform: rotate(${layer.hold}deg);\n}`);
      return;
    }
    emit({
      target,
      name: `luke-${name}-${index + 1}`,
      part: layer,
      transform: TRANSFORM_CSS[layer.type],
      splines: motionSplines(layer),
      pivot,
    });
  });

  const eyes = motion.eyes;
  if (eyes && eyes.kind !== "lids") {
    emit({
      // The wink closes one eye; every other motion moves both.
      target: `${selector} ${eyes.kind === "wink" ? ".luke-face-eye-right" : ".luke-face-eye"}`,
      name: `luke-${name}-eyes`,
      part: { values: eyes.factors, keyTimes: eyes.keyTimes, dur: eyes.dur },
      transform: (factor) => (eyes.kind === "widen" ? `scale(${factor})` : `scaleY(${factor})`),
    });
  }

  if (motion.brows) {
    emit({
      target: `${selector} .luke-face-brows`,
      name: `luke-${name}-brows`,
      part: motion.brows,
      transform: TRANSFORM_CSS.translate,
      splines: motionSplines(motion.brows),
    });
  }

  return [`/* ${name} — ${motion.moment} */`, ...blocks, ...rules].join("\n\n");
}

function faceMotionCss() {
  const resting = "opacity: 0;\n    transform: translate(0, 0);";
  const drifted = `opacity: 0;\n    transform: translate(${SLEEP_Z_DRIFT[0]}px, ${SLEEP_Z_DRIFT[1]}px);`;
  const zBlocks = SLEEP_Z.map((z, index) => {
    const end = +(z.start + SLEEP_Z_RISE).toFixed(4);
    const steps = [
      { at: 0, declaration: resting },
      ...(z.start > 0 ? [{ at: z.start, declaration: resting }] : []),
      { at: +(z.start + SLEEP_Z_RISE / 2).toFixed(4), declaration: "opacity: 0.85;" },
      { at: end, declaration: drifted },
      ...(end < 1 ? [{ at: 1, declaration: drifted }] : []),
    ];
    return cssKeyframes(`luke-sleep-z-${index + 1}`, steps);
  });
  const zRules = [
    `.luke-face-z {\n  animation-duration: ${SLEEP_Z_DURATION}s;\n}`,
    ...SLEEP_Z.map(
      (z, index) => `.luke-face-z-${index + 1} {\n  animation-name: luke-sleep-z-${index + 1};\n}`,
    ),
  ];
  return [
    "/* Generated by design/generate-brand-assets.mjs. Do not edit by hand: change",
    "   the motion table in that script and re-run it.",
    "",
    "   One @keyframes per moving part, and one rule per part that names it. The",
    "   wiring these depend on — the layer stack, the play state, and the ink —",
    "   lives with the rest of the renderer's motion vocabulary in base.css. */",
    "",
    MOTION_NAMES.map((name) => motionCss(name, MOTIONS[name])).join("\n\n"),
    "",
    "/* The z's share one loop, each rising through its own window of it so they",
    "   never rise as a group. The stagger is cut into the keyframes rather than",
    "   carried as a delay: every glyph's first frame is invisible, so a paused",
    "   loop — a capture run, reduced motion — shows no z at all. */",
    "",
    [...zBlocks, ...zRules].join("\n\n"),
    "",
  ].join("\n");
}

// ---------- The face, as a renderer module ----------
const tsList = (values) => values.join(", ");
const tsRecord = (entries, indent = "  ") =>
  entries.map(([key, value]) => `${indent}${key}: ${value},`).join("\n");

function faceArtModule() {
  const [c1, c2] = eyeXs();
  const view = APP_VIEW;
  const box = [view.cx - view.size / 2, view.cy - view.size / 2, view.size, view.size];
  const parts = MOTION_NAMES.map((name) => {
    const motion = MOTIONS[name];
    const flags = [
      `brows: ${Boolean(motion.brows)}`,
      `lids: ${motion.eyes?.kind === "lids"}`,
      `sleepZ: ${Boolean(motion.sleepZ)}`,
    ];
    return [name, `{ ${tsList(flags)} }`];
  });

  return `// Generated by design/generate-brand-assets.mjs. Do not edit by hand: change the
// artwork parameters in that script and re-run it.
//
// The face the renderer draws, in the artwork's own canvas coordinates, and the
// vocabulary of things it can be doing. The motions themselves are @keyframes in
// styles/face-motion.css, generated from the same table.

/** Luke's face, on the 240x240 canvas every asset in design/brand/ is cut from. */
export const FACE_ART = {
  /** A square window centred on the face. Loud motions leave it, and may. */
  VIEW_BOX: "${box.map(fmt).join(" ")}",
  /**
   * The face cropped to itself, the way the static mark SVGs are cut. Only for
   * a mark that never moves: it is tight enough that any motion would leave it.
   */
  MARK_VIEW_BOX: "${markBox().map(fmt).join(" ")}",
  /** The head's resting tilt, about the point the motions pivot on. */
  TILT: "rotate(${FACE.tilt} 120 124)",
  /** The capital-L nose, curling into the smile. */
  SMILE: "${smileD(FACE.lift)}",
  STROKE_WIDTH: ${FACE.sw},
  EYE_Y: ${FACE.eyeY},
  EYE_RADIUS: ${FACE.eyeR},
  EYE_X: { LEFT: ${fmt(c1)}, RIGHT: ${fmt(c2)} },
  /** Drawn only by the motions that raise them. */
  BROW: { LEFT: "${browD(c1)}", RIGHT: "${browD(c2)}" },
  BROW_WIDTH: ${BROW_WIDTH},
  /** Closed eyes, for a face that is asleep rather than blinking. */
  LID: { LEFT: "${lidD(c1)}", RIGHT: "${lidD(c2)}" },
  LID_WIDTH: ${LID_WIDTH},
  SLEEP_Z: [
${SLEEP_Z.map((z) => `    { x: ${z.x}, y: ${z.y}, path: "${zGlyphD(z.size)}" },`).join("\n")}
  ],
  SLEEP_Z_WIDTH: ${SLEEP_Z_WIDTH},
} as const;

/** Every motion the artwork defines, whether or not the app has a moment for it. */
export const FACE_MOTION = {
${MOTION_NAMES.map((name) => `  ${name.toUpperCase()}: "${name}",`).join("\n")}
} as const;

export type FaceMotion = (typeof FACE_MOTION)[keyof typeof FACE_MOTION];

/** One full cycle: how long a caller waits to see a motion out before moving on. */
export const FACE_MOTION_CYCLE_MS: Record<FaceMotion, number> = {
${tsRecord(MOTION_NAMES.map((name) => [name, motionCycleMs(MOTIONS[name])]))}
};

/** What a motion needs drawn beyond the resting smile and eyes. */
export const FACE_MOTION_PARTS: Record<
  FaceMotion,
  { brows: boolean; lids: boolean; sleepZ: boolean }
> = {
${tsRecord(parts)}
};
`;
}

// ---------- Wordmark ----------
// Custom monoline U-K-E letterforms at cap height (44..170), following the
// face-L. The U keeps a fully round bottom, echoing the smile.
function capsUKE(u0, w) {
  const A = 44;
  const B = 170;
  const sp = WORDMARK.sp;
  const uW = 92;
  const r = Math.min(WORDMARK.uRadius, uW / 2);
  const S = stroke(w);
  const U = `<path d="M ${fmt(u0)} ${A} V ${fmt(B - r)} Q ${fmt(u0)} ${B} ${fmt(u0 + r)} ${B} H ${fmt(u0 + uW - r)} Q ${fmt(u0 + uW)} ${B} ${fmt(u0 + uW)} ${fmt(B - r)} V ${A}" ${S}/>`;
  const xk = u0 + uW + 46 + sp;
  const kArm = 64;
  const K = `<path d="M ${fmt(xk)} ${A} V ${B} M ${fmt(xk)} 112 L ${fmt(xk + kArm)} ${A} M ${fmt(xk)} 112 L ${fmt(xk + kArm + 4)} ${B}" ${S}/>`;
  const xe = xk + kArm + 46 + sp;
  const eW = 70;
  const E = `<path d="M ${fmt(xe + eW)} ${A} H ${fmt(xe)} V ${B} H ${fmt(xe + eW)} M ${fmt(xe)} 107 H ${fmt(xe + eW * 0.72)}" ${S}/>`;
  return { body: U + K + E, end: xe + eW };
}

// The face scaled up to cap height (smile on the baseline), then the letters.
// `faceHtml` lets callers substitute an animated face.
function wordmark(faceHtml = face()) {
  const s = WORDMARK.scale;
  const x0 = 20;
  const tx = x0 - 66 * s;
  const ty = 170 - 164 * s;
  const scaledFace = `<g transform="translate(${fmt(tx)} ${fmt(ty)}) scale(${fmt(s)})">${faceHtml}</g>`;
  const letters = capsUKE(tx + 176 * s + WORDMARK.gap, fmt(FACE.sw * s));
  return { body: scaledFace + letters.body, width: letters.end + 40 - x0 };
}

// ---------- Sizing ----------
// The face is drawn on a 240x240 canvas with margins so animations have room
// to move. Standalone assets must not inherit that padding, so everything is
// sized from the artwork's true bounding box (stroke caps included, base tilt
// applied).
function faceBBox() {
  const sw2 = FACE.sw / 2;
  const [c1, c2] = eyeXs();
  const x0 = Math.min(104 - sw2, c1 - FACE.eyeR);
  const x1 = Math.max(168 + sw2, c2 + FACE.eyeR);
  const y0 = Math.min(84 - sw2, FACE.eyeY - FACE.eyeR);
  const y1 = Math.max(164 + sw2, FACE.eyeY + FACE.eyeR);
  const th = (FACE.tilt * Math.PI) / 180;
  const cos = Math.cos(th);
  const sin = Math.sin(th);
  const pts = [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ].map(([x, y]) => [
    120 + (x - 120) * cos - (y - 124) * sin,
    124 + (x - 120) * sin + (y - 124) * cos,
  ]);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const bx0 = Math.min(...xs);
  const by0 = Math.min(...ys);
  const bx1 = Math.max(...xs);
  const by1 = Math.max(...ys);
  return { x: bx0, y: by0, w: bx1 - bx0, h: by1 - by0, cx: (bx0 + bx1) / 2, cy: (by0 + by1) / 2 };
}

// ---------- SVG assembly ----------
const svgOpenAt = (x, y, w, h) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${fmt(x)} ${fmt(y)} ${fmt(w)} ${fmt(h)}" fill="none">`;
const svgOpen = (w, h) => svgOpenAt(0, 0, w, h);
// Motion marks keep the full animation canvas; static artwork is cropped tight.
const markSvg = (body) => `${svgOpen(240, 240)}${body}</svg>`;
/**
 * The static mark's own window: the face's bounding box with a little air.
 * Shared by the cut SVGs and by the app, which draws the same mark itself.
 */
const MARK_PAD = 6;

function markBox(pad = MARK_PAD) {
  const b = faceBBox();
  return [b.x - pad, b.y - pad, b.w + 2 * pad, b.h + 2 * pad];
}

function tightMarkSvg(body, pad = MARK_PAD) {
  const [x, y, w, h] = markBox(pad);
  return `${svgOpenAt(x, y, w, h)}${body}</svg>`;
}
// Words are trimmed vertically to the taller of the face and the letters.
function wordSvg({ body, width }, pad = 6) {
  const b = faceBBox();
  const s = WORDMARK.scale;
  const ty = 170 - 164 * s;
  const lw2 = (FACE.sw * s) / 2;
  const yTop = Math.min(b.y * s + ty, 44 - lw2) - pad;
  const yBot = Math.max((b.y + b.h) * s + ty, 170 + lw2) + pad;
  return `${svgOpenAt(0, yTop, width + 30, yBot - yTop)}${body}</svg>`;
}

// ---------- Emission ----------
// `--check` reports whether the committed outputs still match what this script
// produces, without touching any of them. That is what the repository checks run:
// three sets of outputs are committed alongside this one source, and a check that
// depended on the state of the working tree could only tell you so while the tree
// was clean.
const CHECK_ONLY = process.argv.includes("--check");
const written = [];
const stale = [];

function put(path, content) {
  if (CHECK_ONLY) {
    const current = existsSync(path) ? readFileSync(path, "utf8") : undefined;
    if (current !== content) stale.push(path);
    return;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function emit(relPath, svg, title) {
  // Accessible name, first child of <svg> per SVG a11y guidance.
  const titled = svg.replace(/(<svg[^>]*>)/, `$1<title>${title}</title>`);
  put(join(OUT, relPath), `${titled}\n`);
  written.push(relPath);
}
function emitModes(baseName, svgWithCurrentColor, title) {
  for (const [mode, ink] of Object.entries(INKS)) {
    emit(`${baseName}-${mode}.svg`, svgWithCurrentColor.replaceAll("currentColor", ink), title);
  }
}

// Static mark and wordmark, per mode.
emitModes("luke-mark", tightMarkSvg(face()), "Luke");
emitModes("luke-wordmark", wordSvg(wordmark()), "LUKE");

// App icon, one per mode: the same squircle tile under the face, space black
// for dark mode and porcelain for light. The packaged `.icns` is cut from the
// dark set — one bundle icon has to serve both modes and space black does —
// and the running app swaps the Dock image between the two as the theme
// changes. The glyph spans ~58% of the tile width, centered — typical macOS
// glyph-in-tile proportion, measured from the artwork's bounding box.
const bbox = faceBBox();
const glyphScale = (224 * 0.58) / bbox.w;
const gx = 120 - bbox.cx * glyphScale;
const gy = 120 - bbox.cy * glyphScale;
for (const [mode, tile] of Object.entries(TILES)) {
  const icon =
    `${svgOpen(240, 240)}<defs><linearGradient id="tile" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="${tile.gradient[0]}"/><stop offset="1" stop-color="${tile.gradient[1]}"/></linearGradient></defs>` +
    `<rect x="8" y="8" width="224" height="224" rx="52" fill="url(#tile)"/>` +
    `<g color="${tile.ink}" transform="translate(${fmt(gx)} ${fmt(gy)}) scale(${fmt(glyphScale)})">${face()}</g></svg>`;
  emit(`icon/luke-icon-${mode}.svg`, icon.replaceAll("currentColor", tile.ink), "Luke app icon");
}

// Square mark: the static mark's own tight fill — the face's bounding box
// padded by the same 6 units, squared by its larger side — with the corners
// left square, one per mode, tiled and transparent. The tiled pair carries
// the icon's gradient full-bleed and is the avatar shape for surfaces that
// round their own tiles — GitHub among them, where a pre-rounded tile would
// show seams in the corners. The transparent pair is the same crop with no
// tile: the see-through version of the icon and the tiled mark alike, since
// the tile is all they do not share. A transparent avatar shows GitHub's
// badge background color instead of a tile: pair the dark set with #1c1c1e,
// the space-black end of the dark tile, which reads on either GitHub theme.
const squareSide = Math.max(bbox.w, bbox.h) + 12;
const squareX = bbox.cx - squareSide / 2;
const squareY = bbox.cy - squareSide / 2;
for (const [mode, tile] of Object.entries(TILES)) {
  const open = svgOpenAt(squareX, squareY, squareSide, squareSide);
  const tiled =
    `${open}<defs><linearGradient id="tile" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="${tile.gradient[0]}"/><stop offset="1" stop-color="${tile.gradient[1]}"/></linearGradient></defs>` +
    `<rect x="${fmt(squareX)}" y="${fmt(squareY)}" width="${fmt(squareSide)}" height="${fmt(squareSide)}" fill="url(#tile)"/>` +
    `${face()}</svg>`;
  emit(`mark/luke-mark-square-${mode}.svg`, tiled.replaceAll("currentColor", tile.ink), "Luke");
  emit(
    `mark/luke-mark-square-transparent-${mode}.svg`,
    `${open}${face()}</svg>`.replaceAll("currentColor", tile.ink),
    "Luke",
  );
}

// And the dark mark once more over flat pure black instead of the tile's
// gradient, for surfaces that want the mark on true black.
const squareBlack =
  `${svgOpenAt(squareX, squareY, squareSide, squareSide)}` +
  `<rect x="${fmt(squareX)}" y="${fmt(squareY)}" width="${fmt(squareSide)}" height="${fmt(squareSide)}" fill="#000000"/>` +
  `${face()}</svg>`;
emit(
  "mark/luke-mark-square-black.svg",
  squareBlack.replaceAll("currentColor", TILES.dark.ink),
  "Luke",
);

// Logo: the wordmark lockup as its own shareable set, per mode — the face-L
// and the letters together on a transparent background, no tile and no
// rounded corners, for the places that take a logo rather than an avatar.
// Its PNG derivatives are cut smaller than the mark's 1024 square because a
// lockup is handed to headers and docs, not enlarged into a tile — see
// design/brand/README.md.
emitModes("logo/luke-logo", wordSvg(wordmark()), "LUKE");

// Menu-bar template source: pure black, macOS recolors it. Square canvas
// with the artwork filling ~90% of it, per status-item conventions.
const side = Math.max(bbox.w, bbox.h) * 1.1;
const menubar = `${svgOpenAt(bbox.cx - side / 2, bbox.cy - side / 2, side, side)}${face()}</svg>`;
emit("menubar/luke-menubar-template.svg", menubar.replaceAll("currentColor", "#000000"), "Luke");

// DMG background: a quiet field with the same rounded monoline language as the
// face. Shared window geometry keeps the arrow centered between the two icons.
const dmgBackground = DMG_WINDOW.BACKGROUND.PNG;
const arrowY = DMG_WINDOW.POSITIONS.APP.Y;
const arrowStart = DMG_WINDOW.POSITIONS.APP.X + DMG_WINDOW.ICON_SIZE;
const arrowEnd = DMG_WINDOW.POSITIONS.APPLICATIONS.X - DMG_WINDOW.ICON_SIZE;
const arrowHead = 28;
const dmg =
  `${svgOpen(dmgBackground.WIDTH, dmgBackground.HEIGHT)}` +
  `<rect width="${dmgBackground.WIDTH}" height="${dmgBackground.HEIGHT}" fill="#f5f5f7"/>` +
  `<path d="M ${arrowStart} ${arrowY} H ${arrowEnd} M ${arrowEnd - arrowHead} ${arrowY - arrowHead} L ${arrowEnd} ${arrowY} L ${arrowEnd - arrowHead} ${arrowY + arrowHead}" ` +
  `fill="none" stroke="#6e6e73" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
emit("dmg/luke-dmg-background.svg", dmg, "Drag Luke to Applications");

// Animated state marks, per mode.
for (const name of MOTION_NAMES) {
  emitModes(`motion/luke-${name}`, markSvg(motionSvg(MOTIONS[name])), `Luke — ${name}`);
}
// Animated hero wordmark: the face talks inside the caps word.
emitModes("luke-wordmark-talking", wordSvg(wordmark(motionSvg(MOTIONS.talking))), "LUKE — talking");

// The desktop renderer's two inputs, from the same table the SVGs came from.
put(join(APP_RENDERER, "luke-face-art.ts"), faceArtModule());
put(join(APP_RENDERER, "styles", "face-motion.css"), faceMotionCss());

if (!CHECK_ONLY) {
  process.stdout.write(`${written.length} SVGs written to design/brand/\n`);
  process.stdout.write("luke-face-art.ts and styles/face-motion.css written to the desktop app\n");
} else if (stale.length > 0) {
  process.stderr.write(
    `${stale.length} generated file(s) no longer match this script:\n${stale.join("\n")}\n` +
      "Run: node design/generate-brand-assets.mjs\n",
  );
  process.exit(1);
} else {
  process.stdout.write(`${written.length + 2} generated files are up to date\n`);
}
