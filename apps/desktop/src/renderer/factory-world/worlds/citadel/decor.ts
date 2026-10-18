import {
  Color,
  DoubleSide,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
} from "three";
import type { FlagSpot, Stonework } from "./architecture";
import { sailGeometry, sailMaterial } from "./architecture";
import { hash2, placed } from "./math";
import { WIND } from "./terrain";

/**
 * decor.ts -- what dresses the stonework: the windows, some lit, more by night; the cloth flags waving in the wind; and the windmills' turning sails.
 *
 * None of it is a signal. A window is lit by its own hash, never by what
 * merged, so the warm glow of a town at dusk never reads as the shipped
 * signal, which the torches and lanterns carry (`signals.ts`).
 */

const MAX_WINDOWS = 9000;
const MAX_FLAGS = 700;
const MAX_MILLS = 40;

const WINDOW = {
  DARK: new Color("#2b1d14"),
  LIT: new Color("#ffae55"),
  SOFT: new Color("#d98a43"),
} as const;

/** How many windows burn, of all of them: a few by day, most by night. */
const LIT_SHARE = { DAY: 0.18, NIGHT: 0.55 } as const;

export interface Decor {
  readonly meshes: readonly InstancedMesh[];
  /** Hangs the windows, flags, and sails a build found. */
  readonly hang: (found: Stonework) => void;
  /** Lights the windows for the light appearance or the dark one. */
  readonly light: (dark: boolean) => void;
  readonly step: (elapsed: number) => void;
}

/** The flag cloth: a plane hung from its hoist, rippling down its fly by the shader. */
function flagMesh(time: { value: number }): InstancedMesh {
  const geometry = new PlaneGeometry(1.6, 1, 10, 3).translate(0.8, -0.5, 0);
  const material = new MeshStandardMaterial({ roughness: 0.8, side: DoubleSide });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uTime;")
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        float phase = float(gl_InstanceID) * 1.7;
        float fly = position.x / 1.6;
        transformed.z += sin(position.x * 3.2 - uTime * 6.0 + phase) * 0.22 * fly + sin(position.y * 4.0 + uTime * 3.0 + phase) * 0.05 * fly;
        transformed.y -= fly * fly * 0.12;`,
      );
  };
  const mesh = new InstancedMesh(geometry, material, MAX_FLAGS);
  mesh.castShadow = true;
  mesh.frustumCulled = false;
  mesh.count = 0;
  return mesh;
}

export function buildDecor(): Decor {
  const time = { value: 0 };
  const windows = new InstancedMesh(new PlaneGeometry(1, 1), new MeshBasicMaterial(), MAX_WINDOWS);
  windows.frustumCulled = false;
  windows.count = 0;
  windows.setColorAt(0, WINDOW.DARK);
  const flags = flagMesh(time);
  flags.setColorAt(0, WINDOW.DARK);
  const mills = new InstancedMesh(sailGeometry(), sailMaterial(), MAX_MILLS);
  mills.castShadow = true;
  mills.count = 0;
  const hubs: Matrix4[] = [];
  const matrix = new Matrix4();
  const spin = new Matrix4();
  const tint = new Color();
  const turn = (elapsed: number) => {
    for (const [index, hub] of hubs.entries()) {
      mills.setMatrixAt(
        index,
        matrix.copy(hub).multiply(spin.makeRotationZ(elapsed * 0.6 + index)),
      );
    }
    mills.instanceMatrix.needsUpdate = true;
  };
  return {
    meshes: [windows, flags, mills],
    hang: (found) => {
      const shown = found.windows.slice(0, MAX_WINDOWS);
      for (const [index, spot] of shown.entries()) {
        windows.setMatrixAt(
          index,
          placed(matrix, spot.x, spot.y, spot.z, spot.yaw, spot.width, spot.height, 1),
        );
      }
      windows.count = shown.length;
      windows.instanceMatrix.needsUpdate = true;
      const wind = Math.atan2(WIND.x, WIND.z) - Math.PI / 2;
      const hung: readonly FlagSpot[] = found.flags.slice(0, MAX_FLAGS);
      hung.forEach((flag, index) => {
        flags.setMatrixAt(
          index,
          placed(
            matrix,
            flag.x,
            flag.y,
            flag.z,
            wind + (hash2(index, 3) - 0.5) * 0.4,
            flag.size,
            flag.size,
            flag.size,
          ),
        );
        flags.setColorAt(index, tint.set(flag.color));
      });
      flags.count = hung.length;
      flags.instanceMatrix.needsUpdate = true;
      if (flags.instanceColor !== null) flags.instanceColor.needsUpdate = true;
      hubs.splice(0, hubs.length, ...found.mills.slice(0, MAX_MILLS));
      mills.count = hubs.length;
      turn(0);
    },
    light: (dark) => {
      const share = dark ? LIT_SHARE.NIGHT : LIT_SHARE.DAY;
      for (let index = 0; index < windows.count; index += 1) {
        const glow = hash2(index, 5);
        const lit = glow < share;
        tint.copy(lit ? WINDOW.SOFT : WINDOW.DARK);
        if (lit)
          tint.lerp(WINDOW.LIT, 1 - glow / share).multiplyScalar(0.8 + (1 - glow / share) * 1.6);
        windows.setColorAt(index, tint);
      }
      if (windows.instanceColor !== null) windows.instanceColor.needsUpdate = true;
    },
    step: (elapsed) => {
      time.value = elapsed;
      turn(elapsed);
    },
  };
}
