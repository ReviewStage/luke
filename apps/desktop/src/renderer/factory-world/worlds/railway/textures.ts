import {
  ClampToEdgeWrapping,
  type ColorSpace,
  DataTexture,
  EquirectangularReflectionMapping,
  LinearFilter,
  LinearMipmapLinearFilter,
  NoColorSpace,
  RepeatWrapping,
  RGBAFormat,
  SRGBColorSpace,
  Vector3,
} from "three";
import { clamp, seeded, TAU } from "./kit";

/**
 * textures.ts -- the railway's materials, painted pixel by pixel: flock grass, ballast, cobbles, concrete, lawn, dirt, the table's wood, crop rows, a water ripple, and the soft room that lights everything.
 *
 * A world loads nothing from outside its bundle and draws through no DOM
 * (`../README.md`), so each texture is computed into a small typed array and
 * handed to the GPU as a `DataTexture`: speckles of a handful of tones over a
 * base, the way a modeller's flock and scatter look up close. Each tiles, and
 * each is seeded, so the board looks the same every time. None of them holds
 * a word.
 */

/** A square of RGBA bytes being painted. */
interface Canvas {
  readonly size: number;
  readonly data: Uint8Array;
}

function canvasOf(size: number): Canvas {
  return { size, data: new Uint8Array(size * size * 4) };
}

/** Parses `#rrggbb` into bytes. */
function bytesOf(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function fill(canvas: Canvas, hex: string): void {
  const [r, g, b] = bytesOf(hex);
  for (let at = 0; at < canvas.data.length; at += 4) {
    canvas.data[at] = r;
    canvas.data[at + 1] = g;
    canvas.data[at + 2] = b;
    canvas.data[at + 3] = 255;
  }
}

/** Blends `rgb` over the pixel at (`x`, `y`), wrapping, at `alpha`. */
function blend(canvas: Canvas, x: number, y: number, rgb: readonly number[], alpha: number): void {
  const size = canvas.size;
  const at = ((((y % size) + size) % size) * size + (((x % size) + size) % size)) * 4;
  for (let channel = 0; channel < 3; channel += 1) {
    const was = canvas.data[at + channel] ?? 0;
    canvas.data[at + channel] = Math.round(was + ((rgb[channel] ?? 0) - was) * alpha);
  }
}

/** Scatters `count` soft dots of the `tones`, `low` to `high` pixels across, wrapping at the edges. */
function speckle(
  canvas: Canvas,
  tones: readonly string[],
  count: number,
  low: number,
  high: number,
  seed: number,
): void {
  const rnd = seeded(seed);
  const rgbs = tones.map(bytesOf);
  for (let dot = 0; dot < count; dot += 1) {
    const rgb = rgbs[Math.floor(rnd() * rgbs.length)] ?? [0, 0, 0];
    const alpha = 0.25 + rnd() * 0.5;
    const cx = rnd() * canvas.size;
    const cy = rnd() * canvas.size;
    const radius = low + rnd() * (high - low);
    const reach = Math.ceil(radius);
    for (let dy = -reach; dy <= reach; dy += 1) {
      for (let dx = -reach; dx <= reach; dx += 1) {
        if (dx * dx + dy * dy > radius * radius) continue;
        blend(canvas, Math.floor(cx + dx), Math.floor(cy + dy), rgb, alpha);
      }
    }
  }
}

function textureOf(canvas: Canvas, colorSpace: ColorSpace = SRGBColorSpace): DataTexture {
  const texture = new DataTexture(canvas.data, canvas.size, canvas.size, RGBAFormat);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 8;
  texture.colorSpace = colorSpace;
  texture.needsUpdate = true;
  return texture;
}

function speckled(
  size: number,
  base: string,
  tones: readonly string[],
  count: number,
  low: number,
  high: number,
  seed: number,
): DataTexture {
  const canvas = canvasOf(size);
  fill(canvas, base);
  speckle(canvas, tones, count, low, high, seed);
  return textureOf(canvas);
}

/** Cobbles: offset rows of rounded stones in a dozen greys over dark grout. */
function cobbles(): DataTexture {
  const canvas = canvasOf(256);
  fill(canvas, "#6e665a");
  const rnd = seeded(3);
  const rows = 16;
  const cell = canvas.size / rows;
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column <= rows; column += 1) {
      const tone = 138 + Math.floor(rnd() * 46);
      const rgb = [tone, tone - 8, tone - 20];
      const left = column * cell + (row % 2) * (cell / 2) - (row % 2 ? cell : 0);
      for (let y = 1; y < cell - 1; y += 1) {
        for (let x = 1; x < cell - 1; x += 1) {
          // Note that the stone's corners are rounded by leaving out what lies beyond a quarter circle.
          const cornerX = Math.max(0, Math.abs(x - cell / 2) - (cell / 2 - 4));
          const cornerY = Math.max(0, Math.abs(y - cell / 2) - (cell / 2 - 4));
          if (cornerX * cornerX + cornerY * cornerY > 9) continue;
          blend(canvas, Math.floor(left + x), Math.floor(row * cell + y), rgb, 1);
        }
      }
    }
  }
  return textureOf(canvas);
}

/** Concrete: a fine speckle cut into four slabs a side. */
function concrete(): DataTexture {
  const canvas = canvasOf(256);
  fill(canvas, "#bdbab2");
  speckle(canvas, ["#aaa79f", "#cbc8c0", "#b3b0a8"], 3000, 0.5, 3, 5);
  const seam = bytesOf("#5a5550");
  for (let line = 0; line < canvas.size; line += canvas.size / 4) {
    for (let along = 0; along < canvas.size; along += 1) {
      blend(canvas, line, along, seam, 0.35);
      blend(canvas, along, line, seam, 0.35);
    }
  }
  return textureOf(canvas);
}

/** Low patches of lighter and darker turf, soft-edged, to lie over the flock so the board is never one flat green. */
function patches(): DataTexture {
  const canvas = canvasOf(256);
  const rnd = seeded(77);
  const tones = [
    [40, 62, 28],
    [150, 160, 80],
    [120, 95, 55],
  ] as const;
  const alpha = new Float32Array(canvas.size * canvas.size);
  const rgb = new Float32Array(canvas.size * canvas.size * 3);
  for (let blob = 0; blob < 130; blob += 1) {
    const cx = rnd() * canvas.size;
    const cy = rnd() * canvas.size;
    const radius = 5 + rnd() * 22;
    const strength = 0.12 + rnd() * 0.16;
    const tone = tones[rnd() < 0.5 ? 0 : rnd() < 0.6 ? 1 : 2] ?? tones[0];
    for (
      let y = Math.max(0, Math.floor(cy - radius));
      y < Math.min(canvas.size, cy + radius);
      y += 1
    ) {
      for (
        let x = Math.max(0, Math.floor(cx - radius));
        x < Math.min(canvas.size, cx + radius);
        x += 1
      ) {
        const fall = Math.max(0, 1 - Math.hypot(x - cx, y - cy) / radius) * strength;
        if (fall <= 0) continue;
        const at = y * canvas.size + x;
        const was = alpha[at] ?? 0;
        const next = was + fall * (1 - was);
        for (let channel = 0; channel < 3; channel += 1) {
          rgb[at * 3 + channel] =
            ((rgb[at * 3 + channel] ?? 0) * was + (tone[channel] ?? 0) * fall) /
            Math.max(0.001, next);
        }
        alpha[at] = next;
      }
    }
  }
  for (let at = 0; at < alpha.length; at += 1) {
    canvas.data[at * 4] = rgb[at * 3] ?? 0;
    canvas.data[at * 4 + 1] = rgb[at * 3 + 1] ?? 0;
    canvas.data[at * 4 + 2] = rgb[at * 3 + 2] ?? 0;
    canvas.data[at * 4 + 3] = Math.round((alpha[at] ?? 0) * 255);
  }
  const texture = textureOf(canvas);
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  return texture;
}

/** The table's walnut: dark planks crossed by wavy grain, lighter and darker. */
function wood(): DataTexture {
  const canvas = canvasOf(512);
  fill(canvas, "#4e2f1c");
  const rnd = seeded(21);
  for (let stroke = 0; stroke < 200; stroke += 1) {
    const y = rnd() * canvas.size;
    const alpha = 0.05 + rnd() * 0.14;
    const width = 1 + Math.floor(rnd() * 3);
    const rgb = rnd() < 0.5 ? [40, 18, 6] : [190, 120, 70];
    for (let x = 0; x < canvas.size; x += 1) {
      const wave = y + Math.sin(x * 0.012 + stroke) * 6 + Math.sin(x * 0.042 + stroke * 3) * 2;
      for (let w = 0; w < width; w += 1) blend(canvas, x, Math.floor(wave) + w, rgb, alpha);
    }
  }
  return textureOf(canvas);
}

/** A ploughed field's rows: a crop's tone striped with its shadow, flecked light and dark. */
function crops(): DataTexture {
  const canvas = canvasOf(128);
  fill(canvas, "#ffffff");
  const furrow = [200, 200, 200];
  for (let y = 0; y < canvas.size; y += 8) {
    for (let x = 0; x < canvas.size; x += 1) {
      for (let row = 0; row < 3; row += 1) blend(canvas, x, y + row, furrow, 1);
    }
  }
  speckle(canvas, ["#000000", "#ffffff"], 300, 0.6, 1.2, 50);
  return textureOf(canvas);
}

/** The water's ripple: the slopes of a few crossing waves, as a tangent-space normal map. */
function ripples(): DataTexture {
  const canvas = canvasOf(128);
  const size = canvas.size;
  const waves = [
    [3, 1, 0],
    [1, 4, 1.3],
    [5, -2, 2.1],
    [-2, 6, 0.7],
    [7, 3, 3.3],
  ] as const;
  const height = (x: number, y: number) =>
    waves.reduce(
      (sum, [kx, ky, phase], index) =>
        sum + Math.sin((TAU * (kx * x + ky * y)) / size + phase) / (1 + index * 0.6),
      0,
    );
  const normal = new Vector3();
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = height(x + 1, y) - height(x - 1, y);
      const dy = height(x, y + 1) - height(x, y - 1);
      normal.set(-dx * 1.4, -dy * 1.4, 1).normalize();
      const at = (y * size + x) * 4;
      canvas.data[at] = (normal.x * 0.5 + 0.5) * 255;
      canvas.data[at + 1] = (normal.y * 0.5 + 0.5) * 255;
      canvas.data[at + 2] = (normal.z * 0.5 + 0.5) * 255;
      canvas.data[at + 3] = 255;
    }
  }
  return textureOf(canvas, NoColorSpace);
}

/**
 * The room the layout stands in, as an equirectangular light probe: a warm
 * ceiling, two bright windows, dim walls, and a dark floor. The renderer
 * prefilters it the first time it is drawn, so shiny rails and glazed roofs
 * catch a soft light without a probe of the host's.
 */
function room(): DataTexture {
  const width = 64;
  const height = 32;
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const up = 1 - y / (height - 1);
    for (let x = 0; x < width; x += 1) {
      const window =
        up > 0.55 && up < 0.8 && (Math.abs(x - 16) < 5 || Math.abs(x - 44) < 4) ? 1 : 0;
      const wall = 70 + up * 120;
      const at = (y * width + x) * 4;
      data[at] = clamp(wall + 40 * up + window * 120, 0, 255);
      data[at + 1] = clamp(wall + 20 * up + window * 110, 0, 255);
      data[at + 2] = clamp(wall - 10 + window * 100, 0, 255);
      data[at + 3] = 255;
    }
  }
  const texture = new DataTexture(data, width, height, RGBAFormat);
  texture.mapping = EquirectangularReflectionMapping;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/** Every texture the railway paints, each made once as the world is created. */
export function paintTextures() {
  return {
    grass: speckled(
      256,
      "#5d7f3f",
      ["#4f7135", "#6d8f48", "#587a3a", "#7a9450", "#46672f", "#8a945a"],
      4200,
      1,
      4,
      7,
    ),
    gravel: speckled(
      256,
      "#a39a88",
      ["#8c8474", "#bdb3a0", "#776f62", "#c9c0ad"],
      5000,
      0.6,
      2.2,
      11,
    ),
    cobble: cobbles(),
    concrete: concrete(),
    lawn: speckled(256, "#86ad58", ["#739c48", "#98bc66", "#7ea852"], 4000, 1, 4, 13),
    dirt: speckled(256, "#8a6a4a", ["#76583c", "#9c7b58", "#6a4e35"], 4000, 0.6, 2.4, 17),
    wood: wood(),
    patches: patches(),
    crops: crops(),
    ripples: ripples(),
    room: room(),
  };
}

export type RailwayTextures = ReturnType<typeof paintTextures>;
