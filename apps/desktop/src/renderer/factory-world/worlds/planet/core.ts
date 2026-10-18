import { PICK_KIND, type WorldPicking } from "@luke/panel/factory-world/world";
import {
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  CylinderGeometry,
  DoubleSide,
  InstancedBufferAttribute,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { curtainMaterial } from "./blast";
import { CORE_RADIUS, type CoreZone, MAX_STRATA, PLANET_RADIUS, type PlanetLayout } from "./globe";
import { flush, GLSL_NOISE, GLSL_OUTPUT, GLSL_ZONE, type SharedUniforms } from "./kit";

/**
 * core.ts -- the cutaway: the three faces the opened octant shows, banded by the core's shells, and the molten heart at their centre.
 *
 * Each shell of the core layer is one band of the faces, the zone the most
 * else rests on at the heart, as the layout's radius orders them, each as
 * thick as its footprint: white-hot at the heart and cooling to a dark
 * mantle outward, churning slowly. Between the core and the ocean the faces
 * show the crust's strata. The blast radius brightens a shell in its colour
 * and raises a curtain over it, a chosen shell glows, and a defect in one
 * cracks it. Each shell is picked through a proxy of its three bands, drawn
 * by no one.
 */

/** The core's colours from the heart outward, sampled by how far out a shell stands. */
const SHELL_COLOURS = [
  [2.6, 2.2, 1.5],
  [1.6, 1.05, 0.3],
  [1.25, 0.55, 0.1],
  [0.95, 0.3, 0.05],
  [0.75, 0.13, 0.06],
  [0.16, 0.05, 0.05],
] as const;

/** How many arc segments one band of a shell's proxy takes. */
const PROXY_SEGMENTS = 12;

const SEA_FLOOR = PLANET_RADIUS - 0.16;

function shellColour(shell: number, shells: number, out: Vector3): Vector3 {
  const along = shells <= 1 ? 0 : (shell / (shells - 1)) * (SHELL_COLOURS.length - 1);
  const below = Math.floor(along);
  const from = SHELL_COLOURS[below] ?? SHELL_COLOURS[0];
  const to = SHELL_COLOURS[Math.min(below + 1, SHELL_COLOURS.length - 1)] ?? from;
  const t = along - below;
  return out.set(
    from[0] + (to[0] - from[0]) * t,
    from[1] + (to[1] - from[1]) * t,
    from[2] + (to[2] - from[2]) * t,
  );
}

function facesMaterial(shared: SharedUniforms, uniforms: CoreUniforms): ShaderMaterial {
  return new ShaderMaterial({
    side: DoubleSide,
    uniforms: { ...shared, ...uniforms },
    vertexShader: /* glsl */ `
      varying vec3 vLocal; void main(){ vLocal = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      #define SHELLS ${MAX_STRATA}
      uniform float uTime; uniform vec3 uSunDir; uniform float uDefects; uniform vec3 uBlast; uniform vec3 uChosen; uniform vec3 uDefect;
      uniform float uR[SHELLS + 1]; uniform vec3 uCol[SHELLS]; uniform int uZid[SHELLS]; uniform int uShells; uniform float uCrack[SHELLS];
      varying vec3 vLocal; ${GLSL_NOISE} ${GLSL_ZONE}
      void main(){
        float r = length(vLocal);
        vec3 c;
        if (r > ${SEA_FLOOR.toFixed(3)}) {
          c = vec3(0.02, 0.16, 0.3) * (0.4 + 0.8 * max(dot(normalize(vLocal), uSunDir), 0.0)) + vec3(0.0, 0.05, 0.08);
        } else if (r > ${CORE_RADIUS.toFixed(3)}) {
          float s = (r - ${CORE_RADIUS.toFixed(3)}) / ${(SEA_FLOOR - CORE_RADIUS).toFixed(3)};
          float layers = vnoise(vec3(r * 7.0, vLocal.x * 0.5 + vLocal.z * 0.4, vLocal.y * 0.5));
          float grain = vnoise(vLocal * 9.0);
          c = mix(vec3(0.075, 0.05, 0.04), vec3(0.2, 0.14, 0.1), layers) * (0.75 + 0.5 * grain);
          c = mix(c, vec3(0.14, 0.12, 0.1), smoothstep(0.75, 1.0, s));
          c *= 0.55 + 0.9 * max(dot(normalize(vLocal + vec3(0.01)), uSunDir) * 0.5 + 0.5, 0.0);
          c += vec3(1.6, 0.42, 0.1) * exp(-(r - ${CORE_RADIUS.toFixed(3)}) * 5.0) * 0.7;
        } else {
          int k = 0;
          for (int i = 0; i < SHELLS; i++) if (i < uShells && r >= uR[i]) k = i;
          float r0 = uR[k], r1 = uR[k + 1];
          float conv = fbm(vLocal * 1.25 + vec3(0.0, uTime * 0.07, uTime * 0.03));
          float fine = vnoise(vLocal * 6.0 - vec3(uTime * 0.2));
          c = uCol[k] * (0.45 + 0.95 * conv + 0.15 * fine);
          c *= mix(0.12, 1.0, smoothstep(0.0, 0.09, min(r - r0, r1 - r)));
          int zone = uZid[k];
          if (zone >= 0) {
            vec4 zs = zoneState(zone);
            float hi = zoneBlast(zs);
            c = mix(c, c * 0.6 + uBlast * (1.2 + 0.5 * sin(uTime * 4.0 - r * 3.0)), clamp(hi, 0.0, 1.0) * 0.8);
            c = mix(c, c * 1.3 + uChosen * 0.9, zs.w * 0.6);
          }
          float cr = smoothstep(0.05, 0.0, abs(vnoise(vLocal * 1.3 + 2.0) - 0.5)) + 0.6 * smoothstep(0.03, 0.0, abs(vnoise(vLocal * 3.1) - 0.5));
          float crack = clamp(cr * uCrack[k] * uDefects, 0.0, 1.0) * (0.75 + 0.25 * sin(uTime * 3.0 + r));
          c = mix(c, uDefect * 2.2, crack);
        }
        gl_FragColor = vec4(c, 1.0); ${GLSL_OUTPUT}
      }`,
  });
}

function heartMaterial(shared: SharedUniforms, uniforms: CoreUniforms): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { ...shared, ...uniforms },
    vertexShader: /* glsl */ `
      varying vec3 vN; varying vec3 vWP; varying vec3 vLocal;
      void main(){ vLocal = position; vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.0); vWP = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `
      #define SHELLS ${MAX_STRATA}
      uniform float uTime; uniform vec3 uBlast; uniform vec3 uChosen; uniform int uZid[SHELLS];
      varying vec3 vN; varying vec3 vWP; varying vec3 vLocal; ${GLSL_NOISE} ${GLSL_ZONE}
      void main(){
        vec3 V = normalize(cameraPosition - vWP);
        float f = pow(1.0 - max(dot(vN, V), 0.0), 2.0);
        float n = fbm(vLocal * 3.0 + vec3(0.0, uTime * 0.25, 0.0));
        vec3 c = vec3(3.6, 3.0, 2.0) * (0.7 + 0.6 * n) + vec3(2.5, 1.1, 0.3) * f * 2.0;
        if (uZid[0] >= 0) { vec4 zs = zoneState(uZid[0]); c += uBlast * zoneBlast(zs) * 0.8 + uChosen * zs.w * 0.8; }
        gl_FragColor = vec4(c, 1.0); ${GLSL_OUTPUT}
      }`,
  });
}

interface CoreUniforms {
  readonly uR: { value: number[] };
  readonly uCol: { value: Vector3[] };
  readonly uZid: { value: number[] };
  readonly uShells: { value: number };
  readonly uCrack: { value: number[] };
}

/** One band of a shell's proxy on each face: `inner` to `outer`, a quarter turn. */
function writeProxy(geometry: BufferGeometry, inner: number, outer: number): void {
  const positions = geometry.getAttribute("position");
  const faces: ((a: number, b: number) => [number, number, number])[] = [
    (a, b) => [a, b, 0],
    (a, b) => [a, 0, b],
    (a, b) => [0, b, a],
  ];
  let vertex = 0;
  for (const face of faces) {
    for (let step = 0; step <= PROXY_SEGMENTS; step += 1) {
      const angle = (step / PROXY_SEGMENTS) * (Math.PI / 2);
      for (const radius of [inner, outer]) {
        positions.setXYZ(vertex, ...face(radius * Math.cos(angle), radius * Math.sin(angle)));
        vertex += 1;
      }
    }
  }
  positions.needsUpdate = true;
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
}

function proxyGeometry(): BufferGeometry {
  const geometry = new BufferGeometry();
  const perFace = (PROXY_SEGMENTS + 1) * 2;
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(perFace * 3 * 3), 3));
  const index: number[] = [];
  for (let face = 0; face < 3; face += 1) {
    for (let step = 0; step < PROXY_SEGMENTS; step += 1) {
      const at = face * perFace + step * 2;
      index.push(at, at + 1, at + 2, at + 1, at + 3, at + 2);
    }
  }
  geometry.setIndex(index);
  return geometry;
}

/** The cutaway and the heart, and the core's shells as the layout lays them. */
export interface Core {
  readonly objects: readonly Object3D[];
  /** The shells' crack, by shell, which the defects set. */
  readonly cracks: { readonly value: number[] };
  readonly rebuild: (layout: PlanetLayout) => void;
}

export function createCore(shared: SharedUniforms, picking: WorldPicking): Core {
  const uniforms: CoreUniforms = {
    uR: { value: Array.from({ length: MAX_STRATA + 1 }, () => CORE_RADIUS) },
    uCol: { value: Array.from({ length: MAX_STRATA }, () => new Vector3()) },
    uZid: { value: Array.from({ length: MAX_STRATA }, () => -1) },
    uShells: { value: 1 },
    uCrack: { value: Array.from({ length: MAX_STRATA }, () => 0) },
  };
  const faces = new Mesh(
    mergeGeometries([
      new CircleGeometry(PLANET_RADIUS, 120, 0, Math.PI / 2),
      new CircleGeometry(PLANET_RADIUS, 120, 0, Math.PI / 2).rotateX(Math.PI / 2),
      new CircleGeometry(PLANET_RADIUS, 120, 0, Math.PI / 2).rotateY(-Math.PI / 2),
    ]),
    facesMaterial(shared, uniforms),
  );
  const heart = new Mesh(new SphereGeometry(1, 64, 48), heartMaterial(shared, uniforms));
  const curtains = new InstancedMesh(
    new CylinderGeometry(1, 1, 1, 40, 1, true, 0, Math.PI / 2).translate(0, 0.5, 0),
    curtainMaterial(shared, 0.3),
    MAX_STRATA,
  );
  const curtainZones = new InstancedBufferAttribute(new Float32Array(MAX_STRATA), 1);
  curtains.geometry.setAttribute("aZone", curtainZones);
  curtains.geometry.setAttribute(
    "aSeed",
    new InstancedBufferAttribute(
      Float32Array.from({ length: MAX_STRATA }, (_, at) => at * 1.7),
      1,
    ),
  );
  curtains.frustumCulled = false;
  curtains.renderOrder = 12;
  const hidden = new MeshBasicMaterial({ visible: false });
  const proxies = Array.from({ length: MAX_STRATA }, () => new Mesh(proxyGeometry(), hidden));
  let unregister: (() => void)[] = [];

  const rebuild = (layout: PlanetLayout) => {
    for (const release of unregister) release();
    const strata = layout.strata;
    uniforms.uShells.value = Math.max(1, strata.length);
    uniforms.uR.value.fill(CORE_RADIUS);
    uniforms.uR.value[0] = 0;
    uniforms.uZid.value.fill(-1);
    strata.forEach((stratum, shell) => {
      uniforms.uR.value[shell] = stratum.inner;
      uniforms.uR.value[shell + 1] = stratum.outer;
      uniforms.uZid.value[shell] = stratum.index;
    });
    uniforms.uCol.value.forEach((colour, shell) => {
      shellColour(shell, Math.max(1, strata.length), colour);
    });
    heart.scale.setScalar(strata[0]?.outer ?? 1.2);
    unregister = strata.map((stratum, shell) => registerShell(stratum, shell));
    proxies.forEach((proxy, shell) => {
      proxy.visible = shell < strata.length;
    });
    curtains.count = strata.length;
    flush(curtains);
  };

  const registerShell = (stratum: CoreZone, shell: number) => {
    const proxy = proxies[shell];
    if (proxy === undefined) return () => undefined;
    writeProxy(proxy.geometry, stratum.inner, stratum.outer);
    const radius = Math.max(stratum.outer - 0.05, 0.4);
    curtains.setMatrixAt(shell, scaled(radius));
    curtainZones.setX(shell, stratum.index);
    curtainZones.needsUpdate = true;
    return picking.add(proxy, { kind: PICK_KIND.ZONE, id: stratum.view.path });
  };

  return { objects: [faces, heart, curtains, ...proxies], cracks: uniforms.uCrack, rebuild };
}

const placing = new Object3D();

function scaled(radius: number) {
  placing.scale.set(radius, 2.2, radius);
  placing.updateMatrix();
  return placing.matrix;
}
