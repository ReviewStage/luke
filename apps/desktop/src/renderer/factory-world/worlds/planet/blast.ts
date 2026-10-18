import { FACTORY_WORLD_BOUNDS } from "@luke/features/factory-world-wire";
import { ZONE_LAYER, type ZoneLayer } from "@luke/ui/factory-world";
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CatmullRomCurve3,
  Color,
  CylinderGeometry,
  DoubleSide,
  InstancedBufferAttribute,
  InstancedMesh,
  LineSegments,
  Object3D,
  ShaderMaterial,
  Vector3,
} from "three";
import {
  anchorOf,
  type CrustZone,
  PLANET_RADIUS,
  type PlanetLayout,
  type PlanetZone,
  ZONE_PLACE,
} from "./globe";
import { clamp, flush, GLSL_NOISE, GLSL_OUTPUT, GLSL_ZONE, type SharedUniforms } from "./kit";

/**
 * blast.ts -- the blast radius as the planet shows it: an aurora rising over every zone the selected agent's work ripples to, and the dependency routes between them lit.
 *
 * The ripple itself is in the crust's shader (`globe.ts`), which reads the
 * same zone state; here are the curtains of light that stand over each
 * zone in the blast radius, brighter over what the agent touched, and the
 * routes that carry each dependency over the planet's surface. The routes
 * stand faint whenever an agent is selected, and those inside the blast
 * radius burn in its colour. Every brightness here is read on the GPU from
 * the zone-state texture, after each zone's own delay, so the ripple
 * spreads outward one dependency at a time with no work on the CPU.
 */

/** The most dependency routes drawn. */
const MAX_ROUTES = 600;

/** How many points along one route's curve. */
const ROUTE_POINTS = 48;

/** How tall a curtain stands over its zone, in scene units. */
const CURTAIN_HEIGHT = 2;

/** Each layer's colour along a route, so a route reads from where it starts to where it ends. */
const ROUTE_COLOUR = {
  [ZONE_LAYER.CORE]: new Color(2.2, 0.75, 0.2),
  [ZONE_LAYER.DOMAIN]: new Color(0.3, 1.6, 1.2),
  [ZONE_LAYER.SURFACE]: new Color(1.8, 1.4, 0.7),
  [ZONE_LAYER.TOOLING]: new Color(1, 1, 1),
} as const satisfies Record<ZoneLayer, Color>;

/** An aurora curtain over each instance's zone (`aZone`), as bright as the zone's blast level times `strength`. */
export function curtainMaterial(shared: SharedUniforms, strength: number): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    blending: AdditiveBlending,
    uniforms: { ...shared, uStrength: { value: strength } },
    vertexShader: /* glsl */ `
      attribute float aZone; attribute float aSeed;
      varying vec2 vUv; varying float vNear; varying float vSeed; varying float vK;
      ${GLSL_ZONE}
      void main(){
        vUv = uv; vSeed = aSeed;
        vec4 zs = zoneState(int(aZone + 0.5));
        vK = zoneBlast(zs) * (zs.x > 0.99 ? 0.55 : 0.24);
        vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        vNear = smoothstep(1.5, 6.0, -mv.z);
        gl_Position = vK < 0.003 ? vec4(2.0, 2.0, 2.0, 1.0) : projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform float uStrength; uniform vec3 uBlast;
      varying vec2 vUv; varying float vNear; varying float vSeed; varying float vK;
      ${GLSL_NOISE}
      void main(){
        float k = vK * uStrength;
        if (k < 0.003) discard;
        float x = vUv.x, y = vUv.y;
        float streak = vnoise(vec3(x * 46.0 + vSeed, y * 1.5 - uTime * 0.5, uTime * 0.15));
        float wave = 0.55 + 0.45 * sin(x * 70.0 + uTime * 1.8 + sin(x * 17.0 + uTime) * 2.5);
        float a = smoothstep(0.0, 0.12, y) * pow(1.0 - y, 1.4) * (0.3 + 0.7 * streak) * wave * k;
        vec3 c = uBlast * mix(2.2, 1.4, smoothstep(0.15, 0.95, y)) + vec3(0.1, 0.0, 0.25) * y;
        gl_FragColor = vec4(c * a * vNear, 1.0); ${GLSL_OUTPUT}
      }`,
  });
}

/** One route's points: up out of a core shell through the cutaway, or over the crust between two zones. */
function routePoints(layout: PlanetLayout, from: PlanetZone, to: PlanetZone): Vector3[] {
  const opening = new Vector3(1, 0.85, 1).normalize();
  const ends = [from, to].map((zone) => {
    const anchor = anchorOf(layout, zone, 0);
    if (zone.place !== ZONE_PLACE.CORE)
      return { inner: [anchor], direction: anchor.clone().normalize() };
    const rise = anchor
      .clone()
      .add(new Vector3(0, 3.2, 0))
      .lerp(opening.clone().multiplyScalar(PLANET_RADIUS * 0.9), 0.5);
    return {
      inner: [anchor, anchor.clone().add(new Vector3(0, 1.4, 0)), rise],
      direction: opening,
    };
  });
  const [start, end] = ends;
  if (start === undefined || end === undefined) return [];
  if (from.place === ZONE_PLACE.CORE && to.place === ZONE_PLACE.CORE) {
    const a = start.inner[0] ?? new Vector3();
    const b = end.inner[0] ?? new Vector3();
    const lift = new Vector3(0, 0.7 + a.distanceTo(b) * 0.35, 0);
    return [a, a.clone().add(lift), b.clone().add(lift), b];
  }
  const angle = Math.acos(clamp(start.direction.dot(end.direction), -1, 1));
  const altitude = PLANET_RADIUS + 0.7 + angle * 0.75;
  const middle: Vector3[] = [];
  for (let step = 1; step <= 7; step += 1) {
    const t = step / 8;
    const direction = start.direction
      .clone()
      .multiplyScalar(Math.sin((1 - t) * angle))
      .add(end.direction.clone().multiplyScalar(Math.sin(t * angle)))
      .divideScalar(Math.sin(angle) || 1)
      .normalize();
    middle.push(
      direction.multiplyScalar(
        PLANET_RADIUS + 0.5 + (altitude - PLANET_RADIUS - 0.5) * Math.sin(Math.PI * t),
      ),
    );
  }
  return [...start.inner, ...middle, ...[...end.inner].reverse()];
}

function routesMaterial(shared: SharedUniforms, dim: { value: number }): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: { ...shared, uDim: dim },
    vertexShader: /* glsl */ `
      attribute float aT; attribute float aFrom; attribute float aTo; attribute vec3 aC;
      varying float vT; varying float vHi; varying vec3 vC; varying float vNear; varying float vSeed;
      ${GLSL_ZONE}
      void main(){
        vT = aT; vC = aC; vSeed = aFrom * 0.37 + aTo * 0.11;
        vHi = min(zoneBlast(zoneState(int(aFrom + 0.5))), zoneBlast(zoneState(int(aTo + 0.5))));
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vNear = smoothstep(0.6, 3.5, -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform float uDim; uniform vec3 uBlast;
      varying float vT; varying float vHi; varying vec3 vC; varying float vNear; varying float vSeed;
      void main(){
        float pulse = smoothstep(0.86, 1.0, fract(vT * 4.0 - uTime * (0.35 + vHi * 0.6) + vSeed));
        float ends = smoothstep(0.0, 0.05, vT) * smoothstep(1.0, 0.95, vT);
        float base = 0.006 + vHi * 0.18;
        vec3 c = mix(vC, uBlast * 2.2, vHi) * (base + pulse * (0.06 + vHi * 0.55)) * ends * uDim;
        gl_FragColor = vec4(c * vNear, 1.0); ${GLSL_OUTPUT}
      }`,
  });
}

/** The curtains and the routes, rebuilt with the zones. */
export interface Blast {
  readonly objects: readonly Object3D[];
  readonly rebuild: (layout: PlanetLayout) => void;
  /** Shows the routes, faint, while an agent is selected; `amount` eases it in. */
  readonly show: (amount: number) => void;
}

function crustCurtains(shared: SharedUniforms): InstancedMesh {
  const ratio = (PLANET_RADIUS + 0.12 + CURTAIN_HEIGHT) / (PLANET_RADIUS + 0.12);
  const curtains = new InstancedMesh(
    new CylinderGeometry(ratio, 1, 1, 64, 1, true).translate(0, 0.5, 0),
    curtainMaterial(shared, 1),
    FACTORY_WORLD_BOUNDS.MAX_ZONES,
  );
  curtains.geometry.setAttribute(
    "aZone",
    new InstancedBufferAttribute(new Float32Array(FACTORY_WORLD_BOUNDS.MAX_ZONES), 1),
  );
  curtains.geometry.setAttribute(
    "aSeed",
    new InstancedBufferAttribute(
      Float32Array.from({ length: FACTORY_WORLD_BOUNDS.MAX_ZONES }, (_, at) => at * 1.7),
      1,
    ),
  );
  curtains.frustumCulled = false;
  curtains.renderOrder = 12;
  curtains.count = 0;
  return curtains;
}

const placing = new Object3D();
const UP = new Vector3(0, 1, 0);

function placeCurtain(curtains: InstancedMesh, at: number, zone: CrustZone): void {
  const theta = zone.theta * 0.82;
  const base = PLANET_RADIUS + 0.12;
  const bottom = base * Math.cos(theta);
  const top = (base + CURTAIN_HEIGHT) * Math.cos(theta);
  placing.position.copy(zone.centre).multiplyScalar(bottom);
  placing.quaternion.setFromUnitVectors(UP, zone.centre);
  placing.scale.set(base * Math.sin(theta), top - bottom, base * Math.sin(theta));
  placing.updateMatrix();
  curtains.setMatrixAt(at, placing.matrix);
  curtains.geometry.getAttribute("aZone").setX(at, zone.index);
}

export function createBlast(shared: SharedUniforms): Blast {
  const curtains = crustCurtains(shared);
  const vertices = MAX_ROUTES * (ROUTE_POINTS - 1) * 2;
  const geometry = new BufferGeometry();
  const positions = new BufferAttribute(new Float32Array(vertices * 3), 3);
  const along = new BufferAttribute(new Float32Array(vertices), 1);
  const froms = new BufferAttribute(new Float32Array(vertices), 1);
  const tos = new BufferAttribute(new Float32Array(vertices), 1);
  const colours = new BufferAttribute(new Float32Array(vertices * 3), 3);
  geometry.setAttribute("position", positions);
  geometry.setAttribute("aT", along);
  geometry.setAttribute("aFrom", froms);
  geometry.setAttribute("aTo", tos);
  geometry.setAttribute("aC", colours);
  const dim = { value: 0 };
  const routes = new LineSegments(geometry, routesMaterial(shared, dim));
  routes.frustumCulled = false;
  routes.renderOrder = 10;

  const writeRoute = (layout: PlanetLayout, from: PlanetZone, to: PlanetZone, at: number) => {
    const points = routePoints(layout, from, to);
    if (points.length < 2) return at;
    const curve = new CatmullRomCurve3(points, false, "centripetal").getSpacedPoints(
      ROUTE_POINTS - 1,
    );
    const colour = new Color();
    for (let step = 0; step < ROUTE_POINTS - 1; step += 1) {
      for (const end of [step, step + 1]) {
        const t = end / (ROUTE_POINTS - 1);
        curve[end]?.toArray(positions.array, at * 3);
        along.setX(at, t);
        froms.setX(at, from.index);
        tos.setX(at, to.index);
        colour.copy(ROUTE_COLOUR[from.view.layer]).lerp(ROUTE_COLOUR[to.view.layer], t);
        colours.setXYZ(at, colour.r, colour.g, colour.b);
        at += 1;
      }
    }
    return at;
  };

  return {
    objects: [curtains, routes],
    rebuild: (layout) => {
      layout.crust.forEach((zone, at) => {
        placeCurtain(curtains, at, zone);
      });
      curtains.count = layout.crust.length;
      curtains.geometry.getAttribute("aZone").needsUpdate = true;
      flush(curtains);
      let written = 0;
      let drawn = 0;
      for (const zone of layout.zones) {
        for (const path of zone.view.dependsOn) {
          const to = layout.byPath.get(path);
          if (to === undefined || drawn >= MAX_ROUTES) continue;
          if (zone.place === ZONE_PLACE.MOON || to.place === ZONE_PLACE.MOON) continue;
          written = writeRoute(layout, zone, to, written);
          drawn += 1;
        }
      }
      geometry.setDrawRange(0, written);
      for (const attribute of [positions, along, froms, tos, colours]) attribute.needsUpdate = true;
    },
    show: (amount) => {
      dim.value = amount;
      routes.visible = amount > 0.02;
    },
  };
}
