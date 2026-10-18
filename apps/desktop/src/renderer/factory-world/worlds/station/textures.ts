import {
  DataTexture,
  EquirectangularReflectionMapping,
  FloatType,
  LinearFilter,
  LinearMipmapLinearFilter,
  LinearSRGBColorSpace,
  RepeatWrapping,
  RGBAFormat,
  SRGBColorSpace,
  Vector3,
} from "three";
import { seeded } from "./kit";

/**
 * textures.ts -- the station's few small textures, painted into typed arrays as it is built: the hull's panelling with its bumps and roughness, the solar cells, the gold foil, the radiator fins, and the environment its metal reflects.
 *
 * A world draws no words and touches no DOM, so there is no canvas to paint
 * on: `Raster` is the handful of fills these textures need, over a plain
 * RGBA array that becomes a `DataTexture`. Each is seeded, so the hull
 * reads the same every time. Nothing is loaded, so nothing needs an asset
 * host the panel's CSP refuses.
 */

/** The hull's panel texture, in pixels a side. */
const HULL_SIZE = 512;

/** The environment's size, longitude by latitude. */
const ENVIRONMENT_SIZE = { WIDTH: 128, HEIGHT: 64 } as const;

/** The sun's direction as the station's metal sees it: high, so the hull reads bright. */
export const SUN_DIRECTION = new Vector3(-0.35, 0.62, 0.7).normalize();

type Rgba = readonly [number, number, number, number];

/** An RGBA image in bytes, with the few fills the textures are painted with, each blended over what is there. */
class Raster {
  readonly data: Uint8Array;

  constructor(
    readonly width: number,
    readonly height: number,
    fill: Rgba,
  ) {
    this.data = new Uint8Array(width * height * 4);
    this.rect(0, 0, width, height, fill);
  }

  /** Blends `color` over the pixel at (x, y), wrapping at the edges as the texture repeats. */
  plot(x: number, y: number, [r, g, b, a]: Rgba): void {
    const px = ((Math.floor(x) % this.width) + this.width) % this.width;
    const py = ((Math.floor(y) % this.height) + this.height) % this.height;
    const at = (py * this.width + px) * 4;
    const keep = 1 - a;
    this.data[at] = r * a + (this.data[at] ?? 0) * keep;
    this.data[at + 1] = g * a + (this.data[at + 1] ?? 0) * keep;
    this.data[at + 2] = b * a + (this.data[at + 2] ?? 0) * keep;
    this.data[at + 3] = 255;
  }

  rect(x: number, y: number, width: number, height: number, color: Rgba): void {
    for (let py = Math.floor(y); py < y + height; py += 1) {
      for (let px = Math.floor(x); px < x + width; px += 1) this.plot(px, py, color);
    }
  }

  /** A rectangle's outline, `line` pixels wide, inside its edge. */
  outline(x: number, y: number, width: number, height: number, line: number, color: Rgba): void {
    this.rect(x, y, width, line, color);
    this.rect(x, y + height - line, width, line, color);
    this.rect(x, y + line, line, height - 2 * line, color);
    this.rect(x + width - line, y + line, line, height - 2 * line, color);
  }

  /** A vertical gradient over a rectangle, from `top` to `bottom`. */
  shade(x: number, y: number, width: number, height: number, top: Rgba, bottom: Rgba): void {
    for (let row = 0; row < height; row += 1) {
      const t = row / Math.max(1, height - 1);
      const color: Rgba = [
        top[0] + (bottom[0] - top[0]) * t,
        top[1] + (bottom[1] - top[1]) * t,
        top[2] + (bottom[2] - top[2]) * t,
        top[3] + (bottom[3] - top[3]) * t,
      ];
      this.rect(x, y + row, width, 1, color);
    }
  }

  /** A filled triangle. */
  triangle(points: readonly [number, number][], color: Rgba): void {
    const [a, b, c] = points;
    if (a === undefined || b === undefined || c === undefined) return;
    const edge = (p: [number, number], q: [number, number], x: number, y: number) =>
      (q[0] - p[0]) * (y - p[1]) - (q[1] - p[1]) * (x - p[0]);
    const area = edge(a, b, c[0], c[1]);
    if (area === 0) return;
    const xs = [a[0], b[0], c[0]];
    const ys = [a[1], b[1], c[1]];
    for (let y = Math.floor(Math.min(...ys)); y <= Math.max(...ys); y += 1) {
      for (let x = Math.floor(Math.min(...xs)); x <= Math.max(...xs); x += 1) {
        const w0 = edge(b, c, x, y) / area;
        const w1 = edge(c, a, x, y) / area;
        const w2 = edge(a, b, x, y) / area;
        if (w0 >= 0 && w1 >= 0 && w2 >= 0) this.plot(x, y, color);
      }
    }
  }

  /** The red channel at (x, y), wrapping, in [0, 1]: what a height map is read by. */
  heightAt(x: number, y: number): number {
    const px = ((x % this.width) + this.width) % this.width;
    const py = ((y % this.height) + this.height) % this.height;
    return (this.data[(py * this.width + px) * 4] ?? 0) / 255;
  }
}

/** A repeating, mipmapped texture over `raster`, in sRGB where it holds colour. */
function textureOf(raster: Raster, colour: boolean): DataTexture {
  const texture = new DataTexture(raster.data, raster.width, raster.height, RGBAFormat);
  texture.colorSpace = colour ? SRGBColorSpace : LinearSRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  return texture;
}

/** A tangent-space normal map read off a height map's slopes. */
function normalsOf(height: Raster, strength: number): DataTexture {
  const normals = new Raster(height.width, height.height, [128, 128, 255, 1]);
  for (let y = 0; y < height.height; y += 1) {
    for (let x = 0; x < height.width; x += 1) {
      const dx = (height.heightAt(x + 1, y) - height.heightAt(x - 1, y)) * strength;
      const dy = (height.heightAt(x, y + 1) - height.heightAt(x, y - 1)) * strength;
      const length = Math.hypot(dx, dy, 1);
      const at = (y * height.width + x) * 4;
      normals.data[at] = ((-dx / length) * 0.5 + 0.5) * 255;
      normals.data[at + 1] = ((dy / length) * 0.5 + 0.5) * 255;
      normals.data[at + 2] = ((1 / length) * 0.5 + 0.5) * 255;
    }
  }
  return textureOf(normals, false);
}

/** The hull's three maps. */
interface HullTextures {
  readonly map: DataTexture;
  readonly normal: DataTexture;
  readonly roughness: DataTexture;
}

/** Splits the hull into panels, recursively, mostly across its long side. */
function panelsOf(random: () => number): [number, number, number, number][] {
  const panels: [number, number, number, number][] = [];
  const split = (x: number, y: number, width: number, height: number, depth: number) => {
    if (depth > 4 || width < 48 || height < 48 || (depth > 1 && random() < 0.28)) {
      panels.push([x, y, width, height]);
      return;
    }
    const across = (width >= height && random() < 0.75) || (width < height && random() < 0.25);
    const side = across ? width : height;
    const cut = Math.round((side * (0.3 + 0.4 * random())) / 16) * 16 || 16;
    if (across) {
      split(x, y, cut, height, depth + 1);
      split(x + cut, y, width - cut, height, depth + 1);
    } else {
      split(x, y, width, cut, depth + 1);
      split(x, y + cut, width, height - cut, depth + 1);
    }
  };
  split(0, 0, HULL_SIZE, HULL_SIZE, 0);
  return panels;
}

/** One panel's dressing: vent slats, a hazard stripe, a plate, or a hatch, painted into colour and height. */
function dressPanel(
  colour: Raster,
  height: Raster,
  [x, y, w, h]: readonly [number, number, number, number],
  random: () => number,
): void {
  const kind = random();
  if (kind < 0.12 && w > 60 && h > 40) {
    for (let slat = 0; slat < 6; slat += 1) {
      colour.rect(x + 10, y + 10 + slat * 6, w - 20, 3, [40, 46, 54, 0.85]);
      height.rect(x + 10, y + 10 + slat * 6, w - 20, 3, [51, 51, 51, 1]);
    }
  } else if (kind < 0.18 && w > 50) {
    colour.rect(x + 4, y + h - 14, w - 8, 9, [217, 165, 43, 1]);
    for (let row = 0; row < 9; row += 1) {
      for (let px = 0; px < w - 8; px += 1) {
        if ((px + row) % 14 < 7) colour.plot(x + 4 + px, y + h - 6 - row, [34, 34, 34, 1]);
      }
    }
  } else if (kind < 0.26) {
    const plate: Rgba = random() < 0.5 ? [40, 80, 150, 0.7] : [170, 50, 40, 0.6];
    colour.rect(x + 8, y + 8, 18 + random() * 20, 6, plate);
  } else if (kind < 0.36 && w > 40 && h > 40) {
    height.rect(x + 10, y + 10, w - 20, h - 20, [154, 154, 154, 1]);
    colour.outline(x + 10, y + 10, w - 20, h - 20, 1, [0, 0, 0, 0.25]);
  }
}

/** The hull's panelling: its colour, the normals its seams and rivets raise, and its roughness. */
export function hullTextures(): HullTextures {
  const random = seeded(11);
  const colour = new Raster(HULL_SIZE, HULL_SIZE, [200, 200, 204, 1]);
  const height = new Raster(HULL_SIZE, HULL_SIZE, [136, 136, 136, 1]);
  const roughness = new Raster(HULL_SIZE, HULL_SIZE, [138, 138, 138, 1]);
  for (const panel of panelsOf(random)) {
    const [x, y, w, h] = panel;
    const value = 196 + (random() - 0.5) * 34;
    const warm = random() < 0.12;
    colour.rect(
      x,
      y,
      w,
      h,
      warm ? [value + 8, value - 4, value - 22, 1] : [value, value + 2, value + 5, 1],
    );
    const rough = 120 + random() * 70;
    roughness.rect(x, y, w, h, [rough, rough, rough, 1]);
    colour.shade(x, y, w, h, [255, 255, 255, 0.05], [0, 0, 0, 0.07]);
    dressPanel(colour, height, panel, random);
    colour.outline(x, y, w, h, 2, [30, 34, 40, 0.55]);
    height.outline(x, y, w, h, 3, [34, 34, 34, 1]);
    for (let along = 8; along < w - 4; along += 12) {
      height.rect(x + along, y + 5, 2, 2, [238, 238, 238, 1]);
      height.rect(x + along, y + h - 7, 2, 2, [238, 238, 238, 1]);
      colour.rect(x + along, y + 5, 2, 2, [80, 86, 94, 0.6]);
    }
  }
  for (let speck = 0; speck < 2500; speck += 1) {
    const shade = random() < 0.5 ? 0 : 255;
    const size = random() * 6;
    colour.rect(random() * HULL_SIZE, random() * HULL_SIZE, size, size, [
      shade,
      shade,
      shade,
      random() * 0.04,
    ]);
  }
  return {
    map: textureOf(colour, true),
    normal: normalsOf(height, 3),
    roughness: textureOf(roughness, false),
  };
}

/** Solar cells: deep blue panes in a grey frame. */
export function solarTexture(): DataTexture {
  const raster = new Raster(256, 256, [10, 18, 38, 1]);
  for (let row = 0; row < 8; row += 1) {
    for (let column = 0; column < 4; column += 1) {
      raster.shade(column * 64 + 2, row * 32 + 2, 60, 28, [22, 42, 92, 1], [11, 24, 56, 1]);
      for (let line = 1; line < 4; line += 1) {
        raster.rect(column * 64 + line * 16, row * 32 + 2, 1, 28, [120, 150, 210, 0.25]);
      }
    }
  }
  for (let x = 0; x < 256; x += 64) raster.rect(x, 0, 2, 256, [154, 163, 176, 1]);
  return textureOf(raster, true);
}

/** Crinkled gold foil. */
export function foilTexture(): DataTexture {
  const random = seeded(5);
  const raster = new Raster(256, 256, [184, 134, 46, 1]);
  for (let flake = 0; flake < 380; flake += 1) {
    const x = random() * 256;
    const y = random() * 256;
    const size = 10 + random() * 40;
    const light = 0.5 + random() * 0.8;
    raster.triangle(
      [
        [x, y],
        [x + size, y + random() * size * 0.6],
        [x + random() * size, y + size],
      ],
      [Math.min(255, 255 * light), Math.min(255, 200 * light), Math.min(255, 110 * light), 0.35],
    );
  }
  return textureOf(raster, true);
}

/** White radiator fins. */
export function radiatorTexture(): DataTexture {
  const raster = new Raster(128, 128, [232, 236, 239, 1]);
  for (let x = 0; x < 128; x += 8) raster.rect(x, 0, 2, 128, [201, 207, 214, 1]);
  raster.rect(0, 0, 128, 3, [170, 178, 187, 1]);
  return textureOf(raster, true);
}

/** What the sky looks like from `direction`: black space above, blue Earth below, its bright limb, and a hard sun. */
function environmentAt(direction: Vector3): [number, number, number] {
  const y = direction.y;
  const below = Math.min(1, Math.max(0, (0.02 - y) / 0.27));
  const earth = below * below * (3 - 2 * below);
  const limb = 0.5 * Math.exp(-Math.abs(y + 0.03) * 30);
  const facing = Math.max(0, direction.dot(SUN_DIRECTION));
  const sun = facing ** 600 * 80 + facing ** 12 * 0.25;
  return [
    0.004 + (0.05 - 0.004) * earth + 0.35 * limb + sun,
    0.006 + (0.16 - 0.006) * earth + 0.55 * limb + sun * 0.93,
    0.01 + (0.32 - 0.01) * earth + 0.9 * limb + sun * 0.82,
  ];
}

/** The environment the station's metal reflects, as an equirectangular HDR texture the renderer prefilters itself. */
export function environmentTexture(): DataTexture {
  const { WIDTH, HEIGHT } = ENVIRONMENT_SIZE;
  const data = new Float32Array(WIDTH * HEIGHT * 4);
  const direction = new Vector3();
  for (let row = 0; row < HEIGHT; row += 1) {
    // Note that row 0 is the bottom, as three's equirectangular lookup reads a texture not flipped.
    const latitude = ((row + 0.5) / HEIGHT - 0.5) * Math.PI;
    for (let column = 0; column < WIDTH; column += 1) {
      const longitude = ((column + 0.5) / WIDTH) * Math.PI * 2 - Math.PI;
      direction.set(
        Math.cos(latitude) * Math.cos(longitude),
        Math.sin(latitude),
        Math.cos(latitude) * Math.sin(longitude),
      );
      const [r, g, b] = environmentAt(direction);
      data.set([r, g, b, 1], (row * WIDTH + column) * 4);
    }
  }
  const texture = new DataTexture(data, WIDTH, HEIGHT, RGBAFormat, FloatType);
  texture.mapping = EquirectangularReflectionMapping;
  texture.colorSpace = LinearSRGBColorSpace;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}
