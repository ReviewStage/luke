import assert from "node:assert/strict";
import { factoryWorldViewOf } from "@luke/ui/factory-world";
import { factoryWorldOf, factoryZoneOf } from "@luke/ui/testing";
import { test } from "vitest";
import { type Burrows, burrowsOf, COLONY } from "./layout";
import { type SoilFace, soilFace } from "./soil";

/**
 * soil.test.ts -- the soil face repainted, as a world repaints it when the damage or the burrows change, is cut through at every chamber and solid away from them, and shows what a face painted once for the same reading shows.
 */

function burrowsOfZones(zones: ReturnType<typeof factoryZoneOf>[]): Burrows {
  return burrowsOf(factoryWorldViewOf(factoryWorldOf({ zones })));
}

/** Whether `a` and `b` hold the same face and the same rims, byte for byte. */
function sameFace(a: SoilFace, b: SoilFace): boolean {
  const same = (x: ArrayBufferView | null, y: ArrayBufferView | null) =>
    x !== null &&
    y !== null &&
    Buffer.compare(
      new Uint8Array(x.buffer, x.byteOffset, x.byteLength),
      new Uint8Array(y.buffer, y.byteOffset, y.byteLength),
    ) === 0;
  return (
    same(a.texture.image.data, b.texture.image.data) && same(a.rims.image.data, b.rims.image.data)
  );
}

/** The face's alpha at scene point (x, y), its row zero the bottom of the slab. */
function alphaAt(face: SoilFace, x: number, y: number): number | undefined {
  const { data, width, height } = face.texture.image;
  const perUnit = width / COLONY.WIDTH;
  const px = Math.floor((x + COLONY.HALF) * perUnit);
  const py = Math.floor((y + COLONY.DEPTH) * perUnit);
  return px < 0 || py < 0 || px >= width || py >= height
    ? undefined
    : data?.[(py * width + px) * 4 + 3];
}

/** Whether every chamber of `burrows` is cut through at its centre, and the slab's bottom corner is solid. */
function cutFor(face: SoilFace, burrows: Burrows): boolean {
  return (
    burrows.chambers.every((chamber) => alphaAt(face, chamber.cx, chamber.cy) === 0) &&
    alphaAt(face, -COLONY.HALF + 1, -COLONY.DEPTH + 1) === 255
  );
}

function paintedOnce(burrows: Burrows, damage: ReadonlyMap<number, number>): SoilFace {
  const face = soilFace();
  face.paint(burrows, damage);
  return face;
}

test("a face repainted for new damage or new burrows shows what one painted once for them shows", () => {
  const core = factoryZoneOf("packages/core", []);
  const web = factoryZoneOf("apps/web", ["packages/core"]);
  const small = burrowsOfZones([core, web]);
  const grown = burrowsOfZones([core, web, factoryZoneOf("packages/billing", ["packages/core"])]);
  const wounded = new Map([[0, 40]]);
  const face = soilFace();
  face.paint(small, wounded);
  assert.ok(cutFor(face, small), "wounded, cut for its burrows");
  assert.ok(sameFace(face, paintedOnce(small, wounded)), "wounded");
  face.paint(small, new Map());
  assert.ok(cutFor(face, small), "healed, still cut for its burrows");
  assert.ok(sameFace(face, paintedOnce(small, new Map())), "healed on the same burrows");
  face.paint(grown, wounded);
  assert.ok(cutFor(face, grown), "cut for the burrows dug further");
  assert.ok(sameFace(face, paintedOnce(grown, wounded)), "wounded again on burrows dug further");
});
