#!/usr/bin/env node
// Generates Luke's brand assets from the parameters chosen during the
// interactive logo-lab exploration (the lab pages are local design tools and
// are not checked in). The decisions are recorded in
// design/motion-selections.md; this script bakes those numbers into
// standalone SVGs.
//
// Usage: node design/generate-brand-assets.mjs
// PNG derivatives (app icon, menu-bar template) are rasterized separately —
// see design/brand/README.md.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "brand");

// Inks are named for the UI mode they serve: the dark-mode asset is light.
const INKS = { light: "#1d1d1f", dark: "#f5f5f7" };
const TILE = ["#48484a", "#1c1c1e"]; // space-black gradient, mode-independent
const TILE_INK = "#f8fafc";

// Base face, as accepted in Round 7.
const FACE = { sw: 16, r: 14, lift: 22, tilt: -8, eyeR: 12, spread: 84, eyeY: 92 };
// Face-first caps wordmark. Letter weight matches the face's effective
// stroke (sw x scale) so the face-L does not read heavier than U-K-E.
const WORDMARK = { scale: 1.55, gap: 14, uRadius: 46, sp: 8 };

const fmt = (v) => Math.round(v * 100) / 100;
const easeAll = (n) => Array(n).fill("0.4 0 0.6 1").join(";");

function animT(type, values, dur, opts = {}) {
  const kt = opts.keyTimes ? ` keyTimes="${opts.keyTimes}"` : "";
  const ks = opts.spline ? ` calcMode="spline" keySplines="${opts.spline}"` : "";
  return `<animateTransform attributeName="transform" type="${type}" values="${values}"${kt}${ks} dur="${fmt(dur)}s" repeatCount="indefinite"/>`;
}
const wrapAnim = (inner, anim) => `<g>${anim}${inner}</g>`;
const scaleAbout = (inner, values, dur, opts = {}) =>
  `<g transform="translate(120 124)"><g>${animT("scale", values, dur, opts)}` +
  `<g transform="translate(-120 -124)">${inner}</g></g></g>`;

const stroke = (w) =>
  `fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"`;
const smileD = (lift) =>
  `M 104 84 V ${fmt(164 - FACE.r)} Q 104 164 ${fmt(104 + FACE.r)} 164 Q 140 164 168 ${fmt(164 - lift)}`;
const eyeXs = () => [120 - FACE.spread / 2, 120 + FACE.spread / 2];

function eyeStd(cx, cy, r, blink) {
  if (!blink) return `<circle cx="${fmt(cx)}" cy="${fmt(cy)}" r="${fmt(r)}" fill="currentColor"/>`;
  return (
    `<ellipse cx="${fmt(cx)}" cy="${fmt(cy)}" rx="${fmt(r)}" ry="${fmt(r)}" fill="currentColor">` +
    `<animate attributeName="ry" values="${fmt(r)};${fmt(r)};${fmt(r * 0.12)};${fmt(r)}" keyTimes="0;0.9;0.945;1" dur="4.6s" repeatCount="indefinite"/></ellipse>`
  );
}

// opts: { smile, eyes, extra, blink }
function faceCore(opts = {}) {
  const [c1, c2] = eyeXs();
  const smile =
    opts.smile !== undefined ? opts.smile : `<path d="${smileD(FACE.lift)}" ${stroke(FACE.sw)}/>`;
  const eyes =
    opts.eyes !== undefined
      ? opts.eyes
      : eyeStd(c1, FACE.eyeY, FACE.eyeR, opts.blink) + eyeStd(c2, FACE.eyeY, FACE.eyeR, opts.blink);
  return `<g transform="rotate(${FACE.tilt} 120 124)">${smile}${eyes}${opts.extra || ""}</g>`;
}

// ---------- Accepted motions (Round 7 params baked in) ----------
function squeezeEyes(kt, dur, factor) {
  const r = FACE.eyeR;
  const [c1, c2] = eyeXs();
  const rv = [r, r, r * factor, r * factor, r, r].map(fmt).join(";");
  const mk = (cx) =>
    `<ellipse cx="${fmt(cx)}" cy="${FACE.eyeY}" rx="${r}" ry="${r}" fill="currentColor">` +
    `<animate attributeName="ry" values="${rv}" keyTimes="${kt}" dur="${dur}s" repeatCount="indefinite"/></ellipse>`;
  return mk(c1) + mk(c2);
}

const MOTIONS = {
  talking() {
    const tempo = 0.65;
    const rot = animT("rotate", "-4 120 150;4 120 150;-4 120 150", tempo, { spline: easeAll(2) });
    const bob = animT("translate", "0 0;0 2.5;0 0", tempo * 0.61, { spline: easeAll(2) });
    return wrapAnim(wrapAnim(faceCore(), rot), bob);
  },
  yes() {
    const v = [0, 0, 8, 0, 0].map((a) => `${a} 120 190`).join(";");
    return wrapAnim(
      faceCore(),
      animT("rotate", v, 2.2, { keyTimes: "0;0.15;0.45;0.75;1", spline: easeAll(4) }),
    );
  },
  error() {
    const e = 6;
    const v = [0, e, -e, e * 0.7, -e * 0.7, e * 0.3, 0, 0]
      .map((a) => `${fmt(a)} 120 124`)
      .join(";");
    return wrapAnim(
      faceCore(),
      animT("rotate", v, 3, { keyTimes: "0;0.05;0.11;0.17;0.23;0.29;0.35;1", spline: easeAll(7) }),
    );
  },
  reviewing() {
    const kt = "0;0.35;0.42;0.68;0.76;1";
    const s = 1.03;
    const sv = `1 1;1 1;${s} ${s};${s} ${s};1 1;1 1`;
    return scaleAbout(faceCore({ eyes: squeezeEyes(kt, 4.4, 0.18) }), sv, 4.4, {
      keyTimes: kt,
      spline: easeAll(5),
    });
  },
  success() {
    const kt = "0;0.25;0.45;0.65;0.75;1";
    const ty = "0 0;0 0;0 -14;0 0;0 0;0 0";
    const sc = "1 1;1.05 0.93;0.96 1.06;1.07 0.9;1 1;1 1";
    const inner = scaleAbout(faceCore(), sc, 2, { keyTimes: kt, spline: easeAll(5) });
    return wrapAnim(inner, animT("translate", ty, 2, { keyTimes: kt, spline: easeAll(5) }));
  },
  listening() {
    const v = [0, 0, -12, -12, 0, 0].map((a) => `${a} 120 124`).join(";");
    return wrapAnim(
      faceCore(),
      animT("rotate", v, 3.6, { keyTimes: "0;0.18;0.32;0.68;0.82;1", spline: easeAll(5) }),
    );
  },
  idle() {
    const r = FACE.eyeR;
    const vals = [r, r, r * 0.1, r, r * 0.1, r, r].map(fmt).join(";");
    const kt = "0;0.55;0.585;0.62;0.655;0.69;1";
    const [c1, c2] = eyeXs();
    const mk = (cx) =>
      `<ellipse cx="${fmt(cx)}" cy="${FACE.eyeY}" rx="${r}" ry="${r}" fill="currentColor">` +
      `<animate attributeName="ry" values="${vals}" keyTimes="${kt}" dur="4.6s" repeatCount="indefinite"/></ellipse>`;
    return faceCore({ eyes: mk(c1) + mk(c2) });
  },
  notification() {
    const r = FACE.eyeR;
    const y = FACE.eyeY;
    const [c1, c2] = eyeXs();
    const kt = "0;0.5;0.55;0.72;0.77;1";
    const rv = [r, r, r * 1.2, r * 1.2, r, r].map(fmt).join(";");
    const mkEye = (cx) =>
      `<circle cx="${fmt(cx)}" cy="${y}" r="${r}" fill="currentColor">` +
      `<animate attributeName="r" values="${rv}" keyTimes="${kt}" dur="4s" repeatCount="indefinite"/></circle>`;
    const brow = (cx) =>
      `<path d="M ${fmt(cx - r * 0.85)} ${fmt(y - r - 9)} Q ${fmt(cx)} ${fmt(y - r - 15)} ${fmt(cx + r * 0.85)} ${fmt(y - r - 9)}" stroke="currentColor" stroke-width="5" stroke-linecap="round" fill="none"/>`;
    const brows = wrapAnim(
      brow(c1) + brow(c2),
      animT("translate", "0 0;0 0;0 -6;0 -6;0 0;0 0", 4, { keyTimes: kt, spline: easeAll(5) }),
    );
    return faceCore({ eyes: mkEye(c1) + mkEye(c2), extra: brows });
  },
  wink() {
    const kt = "0;0.5;0.56;0.68;0.74;1";
    const r = FACE.eyeR;
    const y = FACE.eyeY;
    const [c1, c2] = eyeXs();
    const rv = [r, r, r * 0.12, r * 0.12, r, r].map(fmt).join(";");
    const winkEye =
      `<ellipse cx="${fmt(c2)}" cy="${y}" rx="${r}" ry="${r}" fill="currentColor">` +
      `<animate attributeName="ry" values="${rv}" keyTimes="${kt}" dur="4s" repeatCount="indefinite"/></ellipse>`;
    const openEye = `<circle cx="${fmt(c1)}" cy="${y}" r="${r}" fill="currentColor"/>`;
    const rot = [0, 0, 2.5, 2.5, 0, 0].map((a) => `${a} 120 150`).join(";");
    return wrapAnim(
      faceCore({ eyes: winkEye + openEye }),
      animT("rotate", rot, 4, { keyTimes: kt, spline: easeAll(5) }),
    );
  },
  sleeping() {
    const r = FACE.eyeR;
    const y = FACE.eyeY;
    const [c1, c2] = eyeXs();
    const lid = (cx) =>
      `<path d="M ${fmt(cx - r)} ${fmt(y - r * 0.05)} Q ${fmt(cx)} ${fmt(y + r * 0.75)} ${fmt(cx + r)} ${fmt(y - r * 0.05)}" stroke="currentColor" stroke-width="${fmt(Math.max(4.5, r * 0.5))}" stroke-linecap="round" fill="none"/>`;
    const z = (x, yy, s, begin) =>
      `<g opacity="0" transform="translate(${x} ${yy})">` +
      `<animate attributeName="opacity" values="0;0.85;0" dur="3s" begin="${begin}s" repeatCount="indefinite"/>` +
      `<animateTransform attributeName="transform" type="translate" values="${x} ${yy};${x + 6} ${yy - 16}" dur="3s" begin="${begin}s" repeatCount="indefinite"/>` +
      `<path d="M 0 0 H ${s} L 0 ${s} H ${s}" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/></g>`;
    const zzz = z(176, 62, 8, 0) + z(190, 46, 11, -1) + z(166, 44, 6, -2);
    const face = `<g transform="rotate(7 120 150)">${faceCore({ eyes: lid(c1) + lid(c2) })}</g>`;
    return scaleAbout(face, "1 1;1.035 1.035;1 1", 4.8, { spline: easeAll(2) }) + zzz;
  },
  refresh() {
    const v = ["0 120 124", "360 120 124", "360 120 124"].join(";");
    return wrapAnim(
      faceCore(),
      animT("rotate", v, 4.5, { keyTimes: "0;0.3;1", spline: "0.35 0 0.25 1;0.4 0 0.6 1" }),
    );
  },
  boop() {
    const sv = "1 1;1 1;1.09 1.09;0.985 0.985;1 1";
    return scaleAbout(faceCore(), sv, 3.2, { keyTimes: "0;0.55;0.63;0.72;1", spline: easeAll(4) });
  },
  monitoring() {
    const v = "-3.5 120 196;3.5 120 196;-3.5 120 196";
    return wrapAnim(faceCore(), animT("rotate", v, 3.2, { spline: easeAll(2) }));
  },
  appear() {
    const kt = "0;0.15;0.3;0.75;0.9;1";
    const tv = "-16 0;-16 0;0 0;0 0;-16 0;-16 0";
    const rv = [8, 8, 0, 0, 8, 8].map((a) => `${a} 76 190`).join(";");
    const inner = wrapAnim(
      faceCore(),
      animT("rotate", rv, 4, { keyTimes: kt, spline: easeAll(5) }),
    );
    return wrapAnim(inner, animT("translate", tv, 4, { keyTimes: kt, spline: easeAll(5) }));
  },
  attention() {
    const kt = "0;0.35;0.45;0.55;0.75;1";
    const rot = [6, 6, -2.5, 0.8, 0, 6].map((a) => `${a} 120 150`).join(";");
    const ty = "0 3;0 3;0 -1.5;0 0;0 0;0 3";
    const inner = wrapAnim(
      faceCore(),
      animT("rotate", rot, 4.5, { keyTimes: kt, spline: easeAll(5) }),
    );
    return wrapAnim(inner, animT("translate", ty, 4.5, { keyTimes: kt, spline: easeAll(5) }));
  },
  floating() {
    const ty = animT("translate", "0 0;0 -8;0 0", 4.4, { spline: easeAll(2) });
    const rot = animT("rotate", "-2 120 124;2 120 124;-2 120 124", 4.4 * 1.31, {
      spline: easeAll(2),
    });
    return wrapAnim(wrapAnim(faceCore(), rot), ty);
  },
  hiding() {
    const kt = "0;0.35;0.45;0.65;0.78;1";
    const ty = "0 0;0 0;0 55;0 55;0 -4;0 0";
    return wrapAnim(faceCore(), animT("translate", ty, 5, { keyTimes: kt, spline: easeAll(5) }));
  },
  tease() {
    const r = FACE.eyeR;
    const y = FACE.eyeY;
    const [c1, c2] = eyeXs();
    const brow = (cx) =>
      `<path d="M ${fmt(cx - r * 0.85)} ${fmt(y - r - 9)} Q ${fmt(cx)} ${fmt(y - r - 15)} ${fmt(cx + r * 0.85)} ${fmt(y - r - 9)}" stroke="currentColor" stroke-width="5" stroke-linecap="round" fill="none"/>`;
    const tv = "0 0;0 0;0 -6;0 0;0 -6;0 0;0 0";
    const brows = wrapAnim(
      brow(c1) + brow(c2),
      animT("translate", tv, 4.2, { keyTimes: "0;0.45;0.52;0.59;0.66;0.73;1", spline: easeAll(6) }),
    );
    return faceCore({ extra: brows });
  },
  waiting() {
    const ty = "0 0;0 -5;0 0;0 -5;0 0;0 0";
    return wrapAnim(
      faceCore(),
      animT("translate", ty, 2.4, { keyTimes: "0;0.07;0.14;0.21;0.28;1", spline: easeAll(5) }),
    );
  },
};

// ---------- Wordmark ----------
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

function faceFirstWordmark(faceHtml = faceCore()) {
  const s = WORDMARK.scale;
  const x0 = 20;
  const tx = x0 - 66 * s;
  const ty = 170 - 164 * s;
  const face = `<g transform="translate(${fmt(tx)} ${fmt(ty)}) scale(${fmt(s)})">${faceHtml}</g>`;
  const letters = capsUKE(tx + 176 * s + WORDMARK.gap, fmt(FACE.sw * s));
  return { body: face + letters.body, width: letters.end + 40 - x0 };
}

// ---------- Sizing ----------
// The face is drawn on a 240x240 canvas with generous margins so animations
// have room to move. Standalone assets must not inherit that padding, so we
// compute the artwork's true bounding box (stroke caps included, then the
// base tilt applied) and size everything from it.
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

// ---------- File emission ----------
const svgOpenAt = (x, y, w, h) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${fmt(x)} ${fmt(y)} ${fmt(w)} ${fmt(h)}" fill="none">`;
const svgOpen = (w, h) => svgOpenAt(0, 0, w, h);
// Full animation canvas for motion marks; tight crop for static artwork.
const markSvg = (body) => `${svgOpen(240, 240)}${body}</svg>`;
function tightMarkSvg(body, pad = 6) {
  const b = faceBBox();
  return `${svgOpenAt(b.x - pad, b.y - pad, b.w + 2 * pad, b.h + 2 * pad)}${body}</svg>`;
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

const written = [];
function emit(relPath, svg, title) {
  const path = join(OUT, relPath);
  mkdirSync(dirname(path), { recursive: true });
  // Accessible name, first child of <svg> per SVG a11y guidance.
  const titled = svg.replace(/(<svg[^>]*>)/, `$1<title>${title}</title>`);
  writeFileSync(path, `${titled}\n`);
  written.push(relPath);
}
function emitModes(baseName, svgWithCurrentColor, title) {
  for (const [mode, ink] of Object.entries(INKS)) {
    emit(`${baseName}-${mode}.svg`, svgWithCurrentColor.replaceAll("currentColor", ink), title);
  }
}

// Static marks and wordmarks, per mode.
emitModes("luke-mark", tightMarkSvg(faceCore()), "Luke");
emitModes("luke-wordmark", wordSvg(faceFirstWordmark()), "LUKE");

// App icon: space-black tile with the white face; works on both modes.
// The glyph spans ~58% of the tile width, centered — measured from the
// artwork's bounding box, in line with typical macOS glyph-in-tile icons.
const bbox = faceBBox();
const glyphScale = (224 * 0.58) / bbox.w;
const gx = 120 - bbox.cx * glyphScale;
const gy = 120 - bbox.cy * glyphScale;
const icon =
  `${svgOpen(240, 240)}<defs><linearGradient id="tile" x1="0" y1="0" x2="1" y2="1">` +
  `<stop offset="0" stop-color="${TILE[0]}"/><stop offset="1" stop-color="${TILE[1]}"/></linearGradient></defs>` +
  `<rect x="8" y="8" width="224" height="224" rx="52" fill="url(#tile)"/>` +
  `<g color="${TILE_INK}" transform="translate(${fmt(gx)} ${fmt(gy)}) scale(${fmt(glyphScale)})">${faceCore()}</g></svg>`;
emit("icon/luke-icon.svg", icon.replaceAll("currentColor", TILE_INK), "Luke app icon");

// Menu-bar template source: pure black, macOS recolors it (see README).
// Square canvas, artwork filling ~90% of it, per status-item conventions.
const side = Math.max(bbox.w, bbox.h) * 1.1;
const menubar = `${svgOpenAt(bbox.cx - side / 2, bbox.cy - side / 2, side, side)}${faceCore()}</svg>`;
emit("menubar/luke-menubar-template.svg", menubar.replaceAll("currentColor", "#000000"), "Luke");

// Animated state marks, per mode.
for (const [state, render] of Object.entries(MOTIONS)) {
  emitModes(`motion/luke-${state}`, markSvg(render()), `Luke — ${state}`);
}
// Animated hero wordmark: the face talks inside the caps word.
emitModes("luke-wordmark-talking", wordSvg(faceFirstWordmark(MOTIONS.talking())), "LUKE — talking");

process.stdout.write(`${written.length} SVGs written to design/brand/\n`);
