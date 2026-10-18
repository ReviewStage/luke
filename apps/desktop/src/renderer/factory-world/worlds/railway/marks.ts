import type { SIGNAL_COLOR } from "@luke/ui/factory-world";
import {
  Color,
  type DataTexture,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
} from "three";
import { placing, smooth } from "./kit";
import type { Layout } from "./layout";
import { writeTexel } from "./materials";
import type { SceneryMeshes } from "./scenery";
import { groundOf, plotRadiusOf } from "./scenery";

/**
 * marks.ts -- the signals painted onto the ground: a halo round each district (shipped's colour as it is alive with merges, selection's under the pointer, the blast radius's where the selected agent's work ripples), ripples spreading out of the blast, the glow along its tracks, the signals it turns, and a ring round whatever is chosen.
 *
 * The blast spreads outward one dependency at a time: a zone `d` steps from
 * what the agent touched lights up a beat after the zone before it, and
 * pulses while it stays selected. A still frame shows the whole blast lit at
 * once. Every mark is drawn in its signal's colour exactly, untouched by
 * tone mapping, its strength carried by its opacity rather than its colour.
 */

/** The most districts a board holds (`FACTORY_WORLD_BOUNDS.MAX_ZONES`). */
const CAPACITY = 200;

/** A flat material in one exact colour per instance, each instance's opacity its own (`aOpacity`). */
function markMaterial(): MeshBasicMaterial {
  const material = new MeshBasicMaterial({
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  });
  material.customProgramCacheKey = () => "railway-mark";
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = `attribute float aOpacity;\nvarying float vOpacity;\n${shader.vertexShader.replace(
      "#include <begin_vertex>",
      "#include <begin_vertex>\nvOpacity = aOpacity;",
    )}`;
    shader.fragmentShader = `varying float vOpacity;\n${shader.fragmentShader.replace(
      "#include <color_fragment>",
      "#include <color_fragment>\ndiffuseColor.a *= vOpacity;",
    )}`;
  };
  return material;
}

function marked(geometry: RingGeometry, capacity: number): InstancedMesh {
  geometry.setAttribute("aOpacity", new InstancedBufferAttribute(new Float32Array(capacity), 1));
  const mesh = new InstancedMesh(geometry, markMaterial(), capacity);
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  return mesh;
}

/** The marks' meshes, made once. */
export function markMeshes(signal: typeof SIGNAL_COLOR) {
  const ring = (inner: number) => new RingGeometry(inner, 1, 72).rotateX(-Math.PI / 2);
  const chosen = (opacity: number) => {
    // Note that a chosen thing's ring is drawn over everything, since a site in a busy street is ringed by houses taller than the ring.
    const mesh = new Mesh(
      ring(0.86),
      new MeshBasicMaterial({
        color: signal.SELECTION,
        transparent: true,
        opacity,
        depthWrite: false,
        depthTest: false,
        toneMapped: false,
      }),
    );
    mesh.visible = false;
    mesh.renderOrder = 10;
    return mesh;
  };
  return {
    halos: marked(ring(0.8), CAPACITY),
    ripples: marked(ring(0.92), CAPACITY),
    selected: chosen(1),
    hovered: chosen(0.75),
  };
}

export type MarkMeshes = ReturnType<typeof markMeshes>;

/** What the marks draw this frame. */
export interface MarkState {
  readonly blast: ReadonlyMap<string, number>;
  /** Seconds since the blast was chosen; infinite for a still frame, which shows it whole. */
  readonly blastAge: number;
  readonly hoveredZone: string | undefined;
  readonly selectedZone: string | undefined;
  /** Whether the shipped layer is on, for the halos merges light. */
  readonly shipped: boolean;
  readonly time: number;
  /** How alive a zone is with merges at the board's instant, by path: the reading's, not the board's when it was built. */
  readonly aliveOf: (path: string) => number;
}

/** A blast zone's strength `age` seconds into the blast, `distance` steps from the work: arriving a beat per step, then pulsing. */
function blastStrength(distance: number, age: number): number {
  if (!Number.isFinite(age)) return distance === 0 ? 1 : 0.75;
  const arrived = smooth((age * 2.4 - distance) * 1.5);
  const pulse = 0.65 + 0.35 * Math.sin(age * 4.5 - distance * 1.1);
  return arrived * pulse * (distance === 0 ? 1 : 0.75);
}

const MATRIX = new Matrix4();

/** Draws every district's halo, ripple, and plot tint, the blast's glow along the tracks, and the signals it turns. */
export function paintMarks(
  layout: Layout,
  state: MarkState,
  meshes: MarkMeshes,
  scenery: SceneryMeshes,
  glows: DataTexture,
  lamps: InstancedMesh,
  signal: typeof SIGNAL_COLOR,
): void {
  const halos = meshes.halos.geometry.getAttribute("aOpacity");
  const ripples = meshes.ripples.geometry.getAttribute("aOpacity");
  const blastColor = new Color(signal.BLAST_RADIUS);
  const tint = new Color();
  const plotSlots = new Map<InstancedMesh, number>();
  const glowData = glows.image.data;
  if (glowData instanceof Uint8Array) glowData.fill(0);
  const anyBlast = state.blast.size > 0;
  for (const district of layout.districts) {
    const { index } = district;
    const distance = state.blast.get(district.path);
    const alive = state.aliveOf(district.path);
    const strength = distance === undefined ? 0 : blastStrength(distance, state.blastAge);
    const chosen = district.path === state.selectedZone || district.path === state.hoveredZone;
    const halo = district.radius + 1.4;
    meshes.halos.setMatrixAt(
      index,
      placing(district.x, 0.12, district.z, 0, halo, 1, halo, 0, 0, MATRIX),
    );
    if (chosen) {
      meshes.halos.setColorAt(index, tint.set(signal.SELECTION));
      halos.setX(index, 0.9);
    } else if (distance !== undefined) {
      meshes.halos.setColorAt(index, blastColor);
      halos.setX(index, strength * (distance === 0 ? 0.95 : 0.7));
    } else if (state.shipped && !anyBlast && alive > 0.02) {
      const breathe = Number.isFinite(state.blastAge)
        ? 0.75 + 0.25 * Math.sin(state.time * 1.6 + index)
        : 1;
      meshes.halos.setColorAt(index, tint.set(signal.SHIPPED));
      halos.setX(index, Math.min(0.7, alive * 0.9) * breathe);
    } else halos.setX(index, 0);
    const wave =
      Number.isFinite(state.blastAge) && distance !== undefined
        ? (((state.blastAge * 0.8 - distance * 0.35) % 1) + 1) % 1
        : 0;
    const ripple = district.radius * (0.8 + wave * 0.9);
    meshes.ripples.setMatrixAt(
      index,
      placing(district.x, 0.2, district.z, 0, ripple, 1, ripple, 0, 0, MATRIX),
    );
    meshes.ripples.setColorAt(index, blastColor);
    ripples.setX(
      index,
      distance === undefined || !Number.isFinite(state.blastAge) ? 0 : strength * (1 - wave) * 0.7,
    );
    const plots = scenery.plots[groundOf(district)];
    const slot = plotSlots.get(plots) ?? 0;
    plotSlots.set(plots, slot + 1);
    tint.set("#f2ece0").lerp(district.color, 0.12);
    if (chosen) tint.lerp(new Color(signal.SELECTION), 0.3);
    else if (distance !== undefined) tint.lerp(blastColor, 0.3 * strength);
    plots.setColorAt(slot, tint);
    if (distance !== undefined) writeTexel(glows, index, blastColor, strength * 0.55);
    void plotRadiusOf;
  }
  paintSignals(layout, state, lamps, glows, blastColor);
  meshes.halos.count = layout.districts.length;
  meshes.ripples.count = layout.districts.length;
  halos.needsUpdate = true;
  ripples.needsUpdate = true;
  for (const mesh of [meshes.halos, meshes.ripples, ...Object.values(scenery.plots)]) {
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true;
  }
  glows.needsUpdate = true;
}

/** Turns each signal to the blast's colour where its line runs between two zones of the blast, away from the work, and lights that line. */
function paintSignals(
  layout: Layout,
  state: MarkState,
  lamps: InstancedMesh,
  glows: DataTexture,
  blastColor: Color,
): void {
  const clear = new Color("#fff3d0");
  layout.signals.forEach((line, index) => {
    const from = state.blast.get(line.from);
    const to = state.blast.get(line.to);
    const carries = from !== undefined && to !== undefined && Math.max(from, to) > 0;
    const strength = carries ? blastStrength(Math.max(from, to) - 1, state.blastAge) : 0;
    lamps.setColorAt(index, carries && strength > 0.3 ? blastColor : clear);
    if (carries)
      writeTexel(
        glows,
        line.glow,
        blastColor,
        strength *
          (Number.isFinite(state.blastAge) ? 0.45 + 0.15 * Math.sin(state.blastAge * 6) : 0.5),
      );
  });
  if (lamps.instanceColor !== null) lamps.instanceColor.needsUpdate = true;
}

/** Rings what is chosen and what the pointer rests on, each at its spot and size; hides a ring with nothing to mark. */
export function ringChosen(
  meshes: MarkMeshes,
  selected: { x: number; z: number; r: number } | undefined,
  hovered: { x: number; z: number; r: number } | undefined,
  time: number,
): void {
  for (const [mesh, spot, beat] of [
    [meshes.selected, selected, 0],
    [meshes.hovered, hovered, Math.sin(time * 8) * 0.08],
  ] as const) {
    mesh.visible = spot !== undefined;
    if (spot === undefined) continue;
    mesh.position.set(spot.x, 0.16, spot.z);
    mesh.scale.set(spot.r + beat, 1, spot.r + beat);
  }
}
