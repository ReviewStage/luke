import assert from "node:assert/strict";
import { factoryWorldViewOf } from "@luke/ui/factory-world";
import { factoryWorldOf, factoryZoneOf } from "@luke/ui/testing";
import { test } from "vitest";
import { type Burrows, burrowsOf } from "./layout";
import { type SoilFace, soilFace } from "./soil";

/**
 * soil.test.ts -- the soil face repainted, as a world repaints it when the damage or the burrows change, shows what a face painted once for the same reading shows.
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
  assert.ok(sameFace(face, paintedOnce(small, wounded)), "wounded");
  face.paint(small, new Map());
  assert.ok(sameFace(face, paintedOnce(small, new Map())), "healed on the same burrows");
  face.paint(grown, wounded);
  assert.ok(sameFace(face, paintedOnce(grown, wounded)), "wounded again on burrows dug further");
});
