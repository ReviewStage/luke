import {
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  RedFormat,
  RepeatWrapping,
  RGBAFormat,
  SRGBColorSpace,
  type Texture,
} from "three";
import { type Burrows, blobOf, COLONY } from "./layout";
import { clamp, fbm, hash2, seeded, vnoise } from "./shapes";

/**
 * soil.ts -- the colony's painted surfaces: the soil face with its burrows cut out and its wounds, the meadow's turf and trail, the wood, and the clay grain every surface shares.
 *
 * Every picture is painted here, pixel by pixel, into a texture's own bytes:
 * no image ships in the bundle and no canvas is drawn, so the world reaches
 * no DOM. The soil face is the one texture that changes: its colour is
 * painted once, and its holes (its alpha, which the face's alpha test cuts
 * through) and its cracks are repainted only when the burrows or their
 * damage change, never on a hover or a scrub.
 */

/** Soil face pixels per scene unit. */
const PPU = 10;
const FACE_W = COLONY.WIDTH * PPU;
const FACE_H = COLONY.DEPTH * PPU;
/** Meadow pixels per scene unit. */
const TURF_PPU = 10;
const TURF_W = COLONY.WIDTH * TURF_PPU;
const TURF_H = COLONY.SLAB * TURF_PPU;

/** The soil's colour by depth: dark topsoil, warm clays, then the grey of the bedrock. */
const STRATA: readonly (readonly [number, readonly [number, number, number]])[] = [
  [0, [52, 34, 24]],
  [1.4, [92, 60, 40]],
  [9, [124, 80, 51]],
  [19, [146, 95, 60]],
  [29, [120, 79, 53]],
  [39, [99, 65, 46]],
  [45.5, [92, 76, 66]],
  [54, [80, 72, 68]],
];

type Rgb = readonly [number, number, number];

/** An RGBA picture being painted. */
interface Picture {
  readonly data: Uint8Array;
  readonly width: number;
  readonly height: number;
}

/* ----- Painting ----- */

function rgbOf(hex: string): Rgb {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/** Lays `rgb` at `alpha` over the pixel at (x, y). */
function blend(picture: Picture, x: number, y: number, rgb: Rgb, alpha: number): void {
  if (x < 0 || y < 0 || x >= picture.width || y >= picture.height || alpha <= 0) return;
  const at = (y * picture.width + x) * 4;
  const keep = 1 - alpha;
  picture.data[at] = (picture.data[at] ?? 0) * keep + rgb[0] * alpha;
  picture.data[at + 1] = (picture.data[at + 1] ?? 0) * keep + rgb[1] * alpha;
  picture.data[at + 2] = (picture.data[at + 2] ?? 0) * keep + rgb[2] * alpha;
}

/** Paints an ellipse at (cx, cy), turned by `turn`, each pixel's colour and alpha answered by `shade` from its place on the unit disc. */
function ellipse(
  picture: Picture,
  at: { cx: number; cy: number; rx: number; ry: number; turn: number },
  shade: (u: number, v: number) => readonly [Rgb, number] | undefined,
): void {
  const reach = Math.ceil(Math.max(at.rx, at.ry)) + 1;
  const cos = Math.cos(at.turn);
  const sin = Math.sin(at.turn);
  for (let y = Math.floor(at.cy - reach); y <= at.cy + reach; y += 1) {
    for (let x = Math.floor(at.cx - reach); x <= at.cx + reach; x += 1) {
      const dx = x + 0.5 - at.cx;
      const dy = y + 0.5 - at.cy;
      const u = (dx * cos + dy * sin) / at.rx;
      const v = (-dx * sin + dy * cos) / at.ry;
      if (u * u + v * v > 1) continue;
      const painted = shade(u, v);
      if (painted !== undefined) blend(picture, x, y, painted[0], painted[1]);
    }
  }
}

/** Strokes a line through `points` (in pixels), `width` across, by stamping discs along it. */
function stroke(
  picture: Picture,
  points: readonly (readonly [number, number])[],
  width: number,
  rgb: Rgb,
  alpha: number,
): void {
  const radius = Math.max(0.5, width / 2);
  const stamped = new Set<number>();
  for (let index = 1; index < points.length; index += 1) {
    const [ax, ay] = points[index - 1] ?? [0, 0];
    const [bx, by] = points[index] ?? [0, 0];
    const steps = Math.max(
      1,
      Math.ceil(Math.hypot(bx - ax, by - ay) / Math.max(0.5, radius * 0.5)),
    );
    for (let step = 0; step <= steps; step += 1) {
      const cx = ax + ((bx - ax) * step) / steps;
      const cy = ay + ((by - ay) * step) / steps;
      for (let y = Math.floor(cy - radius); y <= cy + radius; y += 1) {
        for (let x = Math.floor(cx - radius); x <= cx + radius; x += 1) {
          // Note that each pixel takes the stroke once, so a line's overlapping stamps do not darken it.
          const key = y * picture.width + x;
          if (stamped.has(key) || (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 > radius * radius)
            continue;
          stamped.add(key);
          blend(picture, x, y, rgb, alpha);
        }
      }
    }
  }
}

/** A scene point on the soil face, in the face picture's pixels; row zero is the bottom of the slab. */
function facePixel(x: number, y: number): [number, number] {
  return [(x + COLONY.HALF) * PPU, (y + COLONY.DEPTH) * PPU];
}

function strataAt(depth: number): Rgb {
  for (let index = 0; index < STRATA.length - 1; index += 1) {
    const [d0, c0] = STRATA[index] ?? [0, [0, 0, 0]];
    const [d1, c1] = STRATA[index + 1] ?? [0, [0, 0, 0]];
    if (depth <= d1) {
      const t = clamp((depth - d0) / (d1 - d0), 0, 1);
      return [
        c0[0] + (c1[0] - c0[0]) * t,
        c0[1] + (c1[1] - c0[1]) * t,
        c0[2] + (c1[2] - c0[2]) * t,
      ];
    }
  }
  return STRATA.at(-1)?.[1] ?? [80, 72, 68];
}

/** The soil's banded clay, its grain, its pebbles, the roots hanging from the turf, and a few buried shells. */
function paintSoil(picture: Picture): void {
  const random = seeded(7);
  const rand = (low: number, high: number) => low + (high - low) * random();
  const { data, width, height } = picture;
  for (let py = 0; py < height; py += 1) {
    const y = py / PPU - COLONY.DEPTH;
    for (let px = 0; px < width; px += 1) {
      const x = px / PPU - COLONY.HALF;
      const depth = -y + (fbm(x * 0.045, y * 0.06, 3) - 0.5) * 6;
      const color = strataAt(depth);
      const band =
        Math.max(0, 1 - Math.abs(((depth + 3) % 9.5) - 4.75) / 0.35) *
        (depth > 3 && depth < 44 ? 1 : 0);
      const grain = 0.84 + 0.3 * fbm(x * 0.9, y * 0.9, 2) + (hash2(px, py) - 0.5) * 0.08;
      const at = (py * width + px) * 4;
      data[at] = clamp(color[0] * grain + band * 46, 0, 255);
      data[at + 1] = clamp(color[1] * grain + band * 34, 0, 255);
      data[at + 2] = clamp(color[2] * grain + band * 20, 0, 255);
      data[at + 3] = 255;
    }
  }
  const shallow = ["#a58a6c", "#8c7560", "#b59a78", "#6f5a48", "#c2a785"].map(rgbOf);
  const deep = ["#8d847c", "#7a726d", "#9a8f84", "#6f6762"].map(rgbOf);
  const highlight = rgbOf("#f2e6d4");
  for (let index = 0; index < 520; index += 1) {
    const y = rand(-COLONY.DEPTH, -1.5);
    const bedrock = y < -45;
    const r = (bedrock ? rand(0.4, 1.7) : rand(0.12, 0.55)) * PPU;
    const palette = bedrock ? deep : shallow;
    const base = palette[Math.floor(random() * palette.length)] ?? highlight;
    const [px, py] = facePixel(rand(-COLONY.HALF, COLONY.HALF), y);
    const turn = rand(0, 3);
    const squash = rand(0.55, 0.9);
    ellipse(
      picture,
      { cx: px + r * 0.12, cy: py - r * 0.18, rx: r * 1.08, ry: r * 1.08 * squash, turn },
      () => [[30, 18, 10], 0.35],
    );
    ellipse(picture, { cx: px, cy: py, rx: r, ry: r * squash, turn }, (u, v) => {
      const lit = clamp((Math.hypot(u + 0.35, v - 0.4) - 0.1) / 0.6, 0, 1);
      const t = Math.min(1, lit / 0.35);
      return [
        [
          highlight[0] + (base[0] - highlight[0]) * t,
          highlight[1] + (base[1] - highlight[1]) * t,
          highlight[2] + (base[2] - highlight[2]) * t,
        ],
        1,
      ];
    });
  }
  const rootTones = [rgbOf("#d6b48a"), rgbOf("#c4a076"), rgbOf("#e6cca0")];
  for (let index = 0; index < 70; index += 1) {
    let x = rand(-COLONY.HALF, COLONY.HALF);
    let y = -0.6;
    let angle = Math.PI / 2 + rand(-0.4, 0.4);
    const thick = rand(1.2, 3.2) * (PPU / 12);
    const length = rand(2, 11);
    const tone = rootTones[index % rootTones.length] ?? highlight;
    const alpha = rand(0.45, 0.85);
    const steps = Math.round(length * 3);
    for (let step = 0; step < steps; step += 1) {
      const from = facePixel(x, y);
      angle += rand(-0.3, 0.3);
      x += Math.cos(angle) * 0.33;
      y -= Math.sin(angle) * 0.33;
      stroke(picture, [from, facePixel(x, y)], thick * (1 - step / steps) + 0.4, tone, alpha);
      if (random() < 0.07) {
        const twig: [number, number][] = [facePixel(x, y)];
        let [x2, y2, a2] = [x, y, angle + rand(-1, 1)];
        for (let k = 0; k < 6; k += 1) {
          a2 += rand(-0.3, 0.3);
          x2 += Math.cos(a2) * 0.3;
          y2 -= Math.sin(a2) * 0.3;
          twig.push(facePixel(x2, y2));
        }
        stroke(picture, twig, 0.8, tone, alpha);
      }
    }
  }
  for (const [x, y, r] of [
    [-30, -33, 1],
    [44, -21, 0.8],
    [8, -46.5, 1.2],
  ] as const) {
    const [cx, cy] = facePixel(x, y);
    const spiral: [number, number][] = [];
    for (let a = 0; a < 18; a += 0.2) {
      const rr = r * PPU * Math.exp(-a * 0.16);
      spiral.push([cx + Math.cos(a) * rr, cy - Math.sin(a) * rr]);
    }
    ellipse(picture, { cx, cy, rx: r * PPU, ry: r * PPU, turn: 0 }, () => [rgbOf("#d9c3a0"), 1]);
    stroke(picture, spiral, 2, rgbOf("#8e7458"), 1);
  }
}

/** Cracks radiating from a damaged chamber's outline, and, where the damage runs deep, a wet seep down from the turf. */
function paintWound(picture: Picture, chamber: Burrows["chambers"][number], damage: number): void {
  const random = seeded(Math.floor(chamber.sa * 1e6));
  const rand = (low: number, high: number) => low + (high - low) * random();
  const cracks = Math.round(1.5 * Math.log2(1 + damage));
  for (let index = 0; index < cracks; index += 1) {
    const a = rand(0, Math.PI * 2);
    let x = chamber.cx + Math.cos(a) * chamber.rx * 1.02;
    let y = Math.max(chamber.floorY, chamber.cy + Math.sin(a) * chamber.ry * 1.02);
    let angle = a;
    const line: [number, number][] = [facePixel(x, y)];
    const length = rand(2, 3 + Math.log2(1 + damage) * 1.4);
    for (let step = 0; step < length / 0.45; step += 1) {
      angle += rand(-0.6, 0.6);
      x += Math.cos(angle) * 0.45;
      y += Math.sin(angle) * 0.45;
      line.push(facePixel(x, y));
    }
    stroke(picture, line, rand(1.4, 3.2) * (PPU / 12), [28, 14, 8], 0.9);
  }
  if (damage < 4) return;
  const wet = Math.sqrt(damage);
  let x = chamber.cx + rand(-1, 1);
  for (let y = 0; y > chamber.cy + chamber.ry * 0.7; y -= 0.15) {
    x += rand(-0.18, 0.18) + Math.sin(y * 0.4) * 0.05;
    const w = (0.35 + wet * 0.09) * (0.7 + 0.6 * vnoise(y * 0.5, chamber.sa)) * PPU;
    const [px, py] = facePixel(x, y);
    ellipse(picture, { cx: px, cy: py, rx: w, ry: w * 0.6, turn: 0 }, () => [[40, 52, 62], 0.08]);
    if (random() < 0.08) {
      ellipse(
        picture,
        { cx: px + rand(-4, 4), cy: py, rx: rand(1, 2.4), ry: rand(1, 2.4), turn: 0 },
        () => [[210, 235, 245], 0.5],
      );
    }
  }
}

/** Cuts the burrows out of the face's alpha: every tunnel, every bore, and every chamber's outline above its floor. */
function carve(picture: Picture, burrows: Burrows): void {
  const hole = (x: number, y: number) => {
    if (x >= 0 && y >= 0 && x < picture.width && y < picture.height)
      picture.data[(y * picture.width + x) * 4 + 3] = 0;
  };
  const disc = (cx: number, cy: number, radius: number) => {
    for (let y = Math.floor(cy - radius); y <= cy + radius; y += 1) {
      const across = Math.sqrt(Math.max(0, radius * radius - (y + 0.5 - cy) ** 2));
      for (let x = Math.ceil(cx - across - 0.5); x <= cx + across - 0.5; x += 1) hole(x, y);
    }
  };
  const radius = COLONY.TUNNEL_RADIUS * PPU;
  for (const tunnel of burrows.tunnels) {
    for (let index = 1; index < tunnel.center.length; index += 1) {
      const a = tunnel.center[index - 1] ?? { x: 0, y: 0 };
      const b = tunnel.center[index] ?? a;
      const steps = Math.max(
        1,
        Math.ceil((Math.hypot(b.x - a.x, b.y - a.y) * PPU) / (radius * 0.5)),
      );
      for (let step = 0; step < steps; step += 1) {
        const [px, py] = facePixel(
          a.x + ((b.x - a.x) * step) / steps,
          a.y + ((b.y - a.y) * step) / steps,
        );
        disc(px, py, radius);
      }
    }
  }
  for (const bore of burrows.bores) {
    const [px, bottom] = facePixel(bore.x, bore.bottom - 0.6);
    const top = bore.top === 0 ? picture.height : facePixel(bore.x, bore.top)[1];
    for (let y = Math.floor(bottom); y <= top; y += 1) {
      for (let x = Math.ceil(px - radius); x <= px + radius; x += 1) hole(x, y);
    }
  }
  for (const chamber of burrows.chambers) {
    const [left, floor] = facePixel(chamber.cx - chamber.rx * 1.12, chamber.floorY);
    const [right, roof] = facePixel(chamber.cx + chamber.rx * 1.12, chamber.cy + chamber.ry * 1.12);
    for (let y = Math.ceil(floor); y <= roof; y += 1) {
      const v = ((y + 0.5) / PPU - COLONY.DEPTH - chamber.cy) / chamber.ry;
      for (let x = Math.floor(left); x <= right; x += 1) {
        const u = ((x + 0.5) / PPU - COLONY.HALF - chamber.cx) / chamber.rx;
        const f = blobOf(chamber, Math.atan2(v, u));
        if (u * u + v * v < f * f) hole(x, y);
      }
    }
  }
}

/** The face's alpha, halved and blurred, which darkens the soil around every hole's rim. */
function blurRims(picture: Picture, into: Uint8Array): void {
  const width = picture.width / 2;
  const height = picture.height / 2;
  const plain = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      for (const [dx, dy] of [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ] as const) {
        sum += picture.data[((2 * y + dy) * picture.width + 2 * x + dx) * 4 + 3] ?? 0;
      }
      plain[y * width + x] = sum / 4;
    }
  }
  const pass = (from: Float32Array, horizontal: boolean): Float32Array => {
    const to = new Float32Array(from.length);
    const reach = 4;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        let sum = 0;
        for (let k = -reach; k <= reach; k += 1) {
          const sx = horizontal ? clamp(x + k, 0, width - 1) : x;
          const sy = horizontal ? y : clamp(y + k, 0, height - 1);
          sum += from[sy * width + sx] ?? 255;
        }
        to[y * width + x] = sum / (2 * reach + 1);
      }
    }
    return to;
  };
  const blurred = pass(pass(pass(pass(plain, true), false), true), false);
  blurred.forEach((value, index) => {
    into[index] = value;
  });
}

/* ----- Public ----- */

/** The soil face: its colour with the burrows cut through its alpha, and the darkening around their rims. */
export interface SoilFace {
  readonly texture: DataTexture;
  readonly rims: DataTexture;
  /** Repaints the face for `burrows`, wounded where `damage` (by chamber index) says. */
  readonly paint: (burrows: Burrows, damage: ReadonlyMap<number, number>) => void;
}

export function soilFace(): SoilFace {
  const base = new Uint8Array(FACE_W * FACE_H * 4);
  paintSoil({ data: base, width: FACE_W, height: FACE_H });
  const pixels = new Uint8Array(base);
  const texture = new DataTexture(pixels, FACE_W, FACE_H, RGBAFormat);
  texture.colorSpace = SRGBColorSpace;
  texture.generateMipmaps = true;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.magFilter = LinearFilter;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  const shade = new Uint8Array((FACE_W / 2) * (FACE_H / 2)).fill(255);
  const rims = new DataTexture(shade, FACE_W / 2, FACE_H / 2, RedFormat);
  rims.unpackAlignment = 1;
  rims.magFilter = LinearFilter;
  rims.minFilter = LinearFilter;
  rims.needsUpdate = true;
  return {
    texture,
    rims,
    paint: (burrows, damage) => {
      const picture: Picture = { data: pixels, width: FACE_W, height: FACE_H };
      picture.data.set(base);
      for (const [index, amount] of damage) {
        const chamber = burrows.chambers[index];
        if (chamber !== undefined && amount >= 1) paintWound(picture, chamber, amount);
      }
      carve(picture, burrows);
      blurRims(picture, shade);
      texture.needsUpdate = true;
      rims.needsUpdate = true;
    },
  };
}

/** The meadow's turf seen from above: grass-green noise, packed dirt around each anthill and along the trail, and each shaft's mouth. */
export interface Turf {
  readonly texture: DataTexture;
  readonly paint: (burrows: Burrows) => void;
}

export function turf(): Turf {
  const base = new Uint8Array(TURF_W * TURF_H * 4);
  for (let y = 0; y < TURF_H; y += 1) {
    for (let x = 0; x < TURF_W; x += 1) {
      const n = fbm(x * 0.02, y * 0.03, 3);
      base.set([92 + n * 40, 104 + n * 40, 48 + n * 20, 255], (y * TURF_W + x) * 4);
    }
  }
  const speckles = [rgbOf("#d2bea0"), rgbOf("#785a3c"), rgbOf("#b4a082")];
  const turfPixels = new Uint8Array(base);
  const texture = new DataTexture(turfPixels, TURF_W, TURF_H, RGBAFormat);
  texture.colorSpace = SRGBColorSpace;
  texture.generateMipmaps = true;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.anisotropy = 4;
  const at = (x: number, z: number): [number, number] => [
    (x + COLONY.HALF) * TURF_PPU,
    -z * TURF_PPU,
  ];
  const dirt = (painted: Picture, x: number, z: number, rx: number, rz: number, alpha: number) => {
    const [cx, cy] = at(x, z);
    ellipse(painted, { cx, cy, rx: rx * TURF_PPU, ry: rz * TURF_PPU, turn: 0 }, (u, v) => {
      const d = Math.hypot(u, v);
      return [
        d < 0.75 ? [150, 108, 70] : [140, 100, 64],
        alpha * (d < 0.75 ? 1 : 0.85 * (1 - (d - 0.75) / 0.25)),
      ];
    });
  };
  return {
    texture,
    paint: (burrows) => {
      const painted: Picture = { data: turfPixels, width: TURF_W, height: TURF_H };
      painted.data.set(base);
      for (const chamber of burrows.chambers) {
        const mound = chamber.mound;
        if (mound !== undefined) dirt(painted, mound.x, mound.z, mound.r + 3.4, mound.rz + 3.4, 1);
      }
      for (let x = -COLONY.HALF; x < COLONY.HALF; x += 0.3) {
        dirt(painted, x, COLONY.TRAIL_Z + Math.sin(x * 0.2) * 0.15, 1.25, 1, 0.5);
      }
      for (const bore of burrows.bores) {
        if (bore.top !== 0) continue;
        const [cx] = at(bore.x, 0);
        ellipse(
          painted,
          {
            cx,
            cy: 0,
            rx: COLONY.TUNNEL_RADIUS * TURF_PPU,
            ry: COLONY.TUNNEL_RADIUS * TURF_PPU,
            turn: 0,
          },
          () => [[32, 19, 11], 1],
        );
      }
      const speck = seeded(23);
      for (let index = 0; index < 900; index += 1) {
        const [cx, cy] = at((speck() * 2 - 1) * COLONY.HALF, -speck() * COLONY.SLAB);
        const r = 0.6 + speck() * 1.6;
        ellipse(painted, { cx, cy, rx: r, ry: r, turn: 0 }, () => [
          speckles[index % 3] ?? [0, 0, 0],
          0.6,
        ]);
      }
      texture.needsUpdate = true;
    },
  };
}

/** The clay grain every soil surface shares, as a tangent-space normal map that tiles. */
export function grainTexture(): DataTexture {
  const size = 128;
  const heights = new Float32Array(size * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = (x / size) * 8;
      const v = (y / size) * 8;
      heights[y * size + x] =
        fbm(u, v, 3) * 0.7 + vnoise(u * 3.1, v * 3.1) ** 3 * 0.6 + hash2(x, y) * 0.08;
    }
  }
  const data = new Uint8Array(size * size * 4);
  const h = (x: number, y: number) =>
    heights[((y + size) % size) * size + ((x + size) % size)] ?? 0;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const nx = (h(x - 1, y) - h(x + 1, y)) * 3.2;
      const ny = (h(x, y - 1) - h(x, y + 1)) * 3.2;
      const length = Math.hypot(nx, ny, 1);
      data.set(
        [
          (nx / length) * 127.5 + 127.5,
          (ny / length) * 127.5 + 127.5,
          (1 / length) * 127.5 + 127.5,
          255,
        ],
        (y * size + x) * 4,
      );
    }
  }
  const texture = new DataTexture(data, size, size, RGBAFormat);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.generateMipmaps = true;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.magFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/** `grain`, tiled `x` by `y` times; the copy shares its pixels, so the grain is uploaded once. */
export function grainOf(grain: Texture, x: number, y: number): Texture {
  const tiled = grain.clone();
  tiled.repeat.set(x, y);
  tiled.needsUpdate = true;
  return tiled;
}

/** A tiling wood grain over `base`, its rings in `rings`. */
export function woodTexture(base: string, rings: string, seed: number): DataTexture {
  const size = 256;
  const random = seeded(seed);
  const ground = rgbOf(base);
  const ring = rgbOf(rings);
  const data = new Uint8Array(size * size * 4);
  const picture: Picture = { data, width: size, height: size };
  for (let y = 0; y < size; y += 1) {
    const n = fbm(y * 0.04, 3.1 + seed, 3);
    const alpha = (Math.sin(y * 0.18 + n * 9) * 0.5 + 0.5) * 0.18;
    for (let x = 0; x < size; x += 1) {
      const at = (y * size + x) * 4;
      data.set(
        [
          ground[0] * (1 - alpha) + ring[0] * alpha,
          ground[1] * (1 - alpha) + ring[1] * alpha,
          ground[2] * (1 - alpha) + ring[2] * alpha,
          255,
        ],
        at,
      );
    }
  }
  for (let line = 0; line < 30; line += 1) {
    const y0 = random() * size;
    const points: [number, number][] = [];
    for (let x = 0; x <= size; x += 8)
      points.push([x, y0 + Math.sin(x * 0.025 + line) * 3 + fbm(x * 0.02, line, 2) * 8]);
    stroke(picture, points, 0.5 + random() * 1.5, ring, 0.05 + random() * 0.11);
  }
  const texture = new DataTexture(data, size, size, RGBAFormat);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.generateMipmaps = true;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.magFilter = LinearFilter;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}
