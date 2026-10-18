import { ZONE_LAYER } from "@luke/ui/factory-world";
import {
  BoxGeometry,
  type BufferGeometry,
  CatmullRomCurve3,
  Color,
  Float32BufferAttribute,
  BufferGeometry as Geometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  type Scene,
  TorusGeometry,
  TubeGeometry,
  Vector3,
} from "three";
import { edgePoint, type Isle, reserve } from "./islands";
import { beam, cylinder, hashOf, merged, PALETTE, randomOf, tint, UP, xf } from "./kit";
import { bridgeGlowMaterial, type ZoneUniforms } from "./zone-light";

/**
 * bridges.ts -- the dependencies between zones, as the islands are tied together: a rope bridge of planks between near neighbours, an iron chain across a wide or steep gap, and a glowing tube along each that lights where the blast radius runs.
 *
 * A zone is tied to each zone it depends on directly, once per pair. The
 * core is one landmass, so a zone depending on several core zones is tied
 * only to the nearest of them, and the core's own ties among itself are left
 * out. The planks and the chain links are instanced at their bounds; the
 * ropes, the posts, and the glow are one merged mesh each, built with the
 * islands and never on a hover. Each glow tube carries the two zones it ties,
 * so `zone-light.ts` lights it from their texels alone.
 */

/** The most planks and chain links every bridge together holds. */
const BOUND = {
  PLANKS: 16000,
  LINKS: 20000,
} as const;

/** When a tie is a chain rather than a rope bridge: across more than this much air, or this much height; and when a slim cable rather than a chain. */
const CHAIN_GAP = 26;
const CHAIN_RISE = 14;
const CABLE_GAP = 44;

/** How far apart a chain's links are strung. */
const LINK_SPACING = 0.28;

/** One tie between two zones: the dependent, and the zone it depends on. */
interface Tie {
  readonly from: Isle;
  readonly to: Isle;
}

/** The ties to draw: each dependency once per pair, the core's collapsed onto its nearest island. */
function tiesOf(isles: ReadonlyMap<string, Isle>): Tie[] {
  const seen = new Map<string, Set<string>>();
  const ties: Tie[] = [];
  const once = (a: Isle, b: Isle) => {
    const [low, high] = a.zone.path < b.zone.path ? [a, b] : [b, a];
    const tied = seen.get(low.zone.path) ?? new Set<string>();
    if (tied.has(high.zone.path)) return;
    tied.add(high.zone.path);
    seen.set(low.zone.path, tied);
    ties.push({ from: a, to: b });
  };
  for (const isle of isles.values()) {
    const depended = isle.zone.dependsOn.flatMap((path) => isles.get(path) ?? []);
    for (const other of depended) if (other.zone.layer !== ZONE_LAYER.CORE) once(isle, other);
    // Note that a core zone's ties to the rest of the core are left out, since the core is one landmass.
    if (isle.zone.layer === ZONE_LAYER.CORE) continue;
    const core = depended.filter((other) => other.zone.layer === ZONE_LAYER.CORE);
    const nearest = core.sort(
      (a, b) => a.position.distanceTo(isle.position) - b.position.distanceTo(isle.position),
    )[0];
    if (nearest !== undefined) once(isle, nearest);
  }
  return ties;
}

/** Where a tie meets an island: its rim towards the other, or below it for a chain hung from the higher one. */
function anchorFor(isle: Isle, other: Isle, below: boolean): Vector3 {
  const toward = new Vector3().subVectors(other.position, isle.position);
  const point = edgePoint(isle, Math.atan2(toward.z, toward.x), below ? 0.7 : 0.94);
  point.y -= below ? 1.0 : 0.05;
  reserve(isle, point.x, point.z, 1.4);
  return point.add(isle.position);
}

/** What the bridges gather before they are merged and instanced. */
interface Spans {
  readonly planks: { matrix: Matrix4; dark: boolean }[];
  readonly links: { matrix: Matrix4; rusty: boolean }[];
  readonly ropes: BufferGeometry[];
  readonly glows: BufferGeometry[];
}

function sagging(from: Vector3, to: Vector3, sag: number): CatmullRomCurve3 {
  const points: Vector3[] = [];
  for (let i = 0; i <= 40; i += 1) {
    const t = i / 40;
    points.push(
      new Vector3().lerpVectors(from, to, t).add(new Vector3(0, -sag * Math.sin(Math.PI * t), 0)),
    );
  }
  return new CatmullRomCurve3(points);
}

function ropeBridge(
  tie: Tie,
  curve: CatmullRomCurve3,
  from: Vector3,
  to: Vector3,
  spans: Spans,
): void {
  const length = from.distanceTo(to);
  const planks = Math.max(6, Math.floor(length / 0.34));
  const random = randomOf(hashOf(tie.from.zone.path) ^ hashOf(tie.to.zone.path));
  const across = new Vector3().subVectors(to, from).setY(0).normalize();
  const side = new Vector3().crossVectors(UP, across).normalize();
  const look = new Matrix4();
  for (let i = 0; i < planks && spans.planks.length < BOUND.PLANKS; i += 1) {
    const t = (i + 0.5) / planks;
    const at = curve.getPointAt(t);
    look.lookAt(new Vector3(), curve.getTangentAt(t), UP);
    const matrix = new Matrix4()
      .makeRotationY(Math.PI / 2 + (random() - 0.5) * 0.12)
      .premultiply(look)
      .setPosition(at);
    spans.planks.push({ matrix, dark: random() < 0.2 });
  }
  const points = curve.getPoints(40);
  for (const offset of [-0.6, 0.6]) {
    for (const height of [0, 0.55]) {
      const rope = new CatmullRomCurve3(
        points.map((p, i) =>
          p
            .clone()
            .addScaledVector(side, offset)
            .add(
              new Vector3(0, height - (height > 0 ? 0.08 * Math.sin((Math.PI * i) / 40) : 0), 0),
            ),
        ),
      );
      spans.ropes.push(
        tint(
          new TubeGeometry(rope, 32, height > 0 ? 0.035 : 0.03, 4),
          height > 0 ? PALETTE.ROPE : PALETTE.WOOD_DARK,
        ),
      );
    }
  }
  for (let i = 0; i <= planks; i += 3) {
    const at = curve.getPointAt(i / planks);
    for (const offset of [-0.6, 0.6]) {
      const foot = at.clone().addScaledVector(side, offset);
      spans.ropes.push(
        beam(foot, foot.clone().add(new Vector3(0, 0.5, 0)), 0.018, PALETTE.ROPE, 1, 3),
      );
    }
  }
  for (const end of [from, to]) {
    for (const offset of [-0.65, 0.65]) {
      spans.ropes.push(
        xf(
          cylinder(0.08, 0.1, 1.1, 6, PALETTE.WOOD_DARK),
          end.x + side.x * offset,
          end.y + 0.35,
          end.z + side.z * offset,
        ),
      );
    }
  }
}

/** A tie too long for a chain: one slim iron cable, ringed at each end. */
function cable(curve: CatmullRomCurve3, from: Vector3, to: Vector3, spans: Spans): void {
  spans.ropes.push(tint(new TubeGeometry(curve, 48, 0.07, 5), PALETTE.IRON));
  for (const end of [from, to]) {
    spans.ropes.push(
      xf(
        tint(new TorusGeometry(0.35, 0.1, 6, 12), PALETTE.IRON),
        end.x,
        end.y,
        end.z,
        0,
        Math.atan2(to.x - from.x, to.z - from.z),
      ),
    );
  }
}

function chain(curve: CatmullRomCurve3, from: Vector3, to: Vector3, spans: Spans): void {
  const links = Math.floor(from.distanceTo(to) / LINK_SPACING);
  const size = 1;
  if (spans.links.length + links > BOUND.LINKS) {
    cable(curve, from, to, spans);
    return;
  }
  for (let i = 0; i < links; i += 1) {
    const t = (i + 0.5) / links;
    const tangent = curve.getTangentAt(t);
    const across = new Vector3().crossVectors(tangent, UP).normalize();
    const basis = new Matrix4().makeBasis(
      tangent,
      across,
      new Vector3().crossVectors(tangent, across).normalize(),
    );
    const matrix = new Matrix4()
      .makeScale(size, 0.72 * size, 0.72 * size)
      .premultiply(new Matrix4().makeRotationX(i % 2 === 1 ? Math.PI / 2 : 0))
      .premultiply(basis)
      .setPosition(curve.getPointAt(t));
    spans.links.push({ matrix, rusty: i % 5 === 0 });
  }
  for (const end of [from, to]) {
    spans.ropes.push(
      xf(
        tint(new TorusGeometry(0.5, 0.14, 6, 14), PALETTE.IRON),
        end.x,
        end.y,
        end.z,
        0,
        Math.atan2(to.x - from.x, to.z - from.z),
      ),
    );
  }
}

/** The glow along a tie, carrying the two zones it ties. */
function glowAlong(tie: Tie, curve: CatmullRomCurve3, chained: boolean): BufferGeometry {
  const tube = new TubeGeometry(curve, 40, chained ? 0.16 : 0.2, 5);
  const count = tube.getAttribute("position").count;
  const zones = new Float32Array(count * 2);
  for (let i = 0; i < count; i += 1) {
    zones[i * 2] = tie.from.index;
    zones[i * 2 + 1] = tie.to.index;
  }
  tube.setAttribute("zones", new Float32BufferAttribute(zones, 2));
  tube.deleteAttribute("normal");
  return tube;
}

/** The bridges as the world drives them: built with the islands, reserving their anchors before the islands are dressed. */
export interface Bridges {
  readonly build: (isles: ReadonlyMap<string, Isle>) => void;
}

/** The bridges, their meshes allocated in `scene` at their bounds. */
export function bridgesOf(scene: Scene, uniforms: ZoneUniforms): Bridges {
  const wood = new MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true });
  const iron = new MeshStandardMaterial({
    color: PALETTE.IRON,
    roughness: 0.55,
    metalness: 0.35,
    flatShading: true,
  });
  const planks = new InstancedMesh(
    new BoxGeometry(0.3, 0.06, 1.15),
    new MeshStandardMaterial({ roughness: 0.9, flatShading: true }),
    BOUND.PLANKS,
  );
  const links = new InstancedMesh(new TorusGeometry(0.22, 0.06, 3, 5), iron, BOUND.LINKS);
  const ropes = new Mesh(new Geometry(), wood);
  const glow = new Mesh(new Geometry(), bridgeGlowMaterial(uniforms));
  glow.renderOrder = 5;
  glow.frustumCulled = false;
  for (const mesh of [planks, links]) {
    mesh.count = 0;
    mesh.castShadow = true;
    mesh.frustumCulled = false;
  }
  ropes.castShadow = true;
  scene.add(planks, links, ropes, glow);
  const shade = new Color();

  return {
    build: (isles) => {
      const spans: Spans = { planks: [], links: [], ropes: [], glows: [] };
      for (const tie of tiesOf(isles)) {
        const rise = Math.abs(tie.from.position.y - tie.to.position.y);
        const gap = tie.from.position.distanceTo(tie.to.position) - tie.from.radius - tie.to.radius;
        const chained = gap > CHAIN_GAP || rise > CHAIN_RISE;
        const fromHigher = tie.from.position.y > tie.to.position.y;
        const from = anchorFor(tie.from, tie.to, chained && fromHigher);
        const to = anchorFor(tie.to, tie.from, chained && !fromHigher);
        const length = from.distanceTo(to);
        const curve = sagging(from, to, chained ? 0.1 * length + 1 : 0.06 * length + 0.4);
        if (gap > CABLE_GAP) cable(curve, from, to, spans);
        else if (chained) chain(curve, from, to, spans);
        else ropeBridge(tie, curve, from, to, spans);
        spans.glows.push(glowAlong(tie, curve, chained));
      }
      spans.planks.forEach(({ matrix, dark }, index) => {
        planks.setMatrixAt(index, matrix);
        planks.setColorAt(index, shade.set(dark ? PALETTE.WOOD_DARK : PALETTE.WOOD));
      });
      planks.count = spans.planks.length;
      planks.instanceMatrix.needsUpdate = true;
      if (planks.instanceColor !== null) planks.instanceColor.needsUpdate = true;
      spans.links.forEach(({ matrix, rusty }, index) => {
        links.setMatrixAt(index, matrix);
        links.setColorAt(index, shade.set(rusty ? "#a08878" : "#ffffff"));
      });
      links.count = spans.links.length;
      links.instanceMatrix.needsUpdate = true;
      if (links.instanceColor !== null) links.instanceColor.needsUpdate = true;
      ropes.geometry.dispose();
      ropes.geometry = merged(spans.ropes) ?? new Geometry();
      glow.geometry.dispose();
      glow.geometry = merged(spans.glows) ?? new Geometry();
    },
  };
}
