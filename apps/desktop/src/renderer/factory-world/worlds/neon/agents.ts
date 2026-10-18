import type { WorldPalette } from "@luke/panel/factory-world/world";
import { AGENT_STATE, type AgentState, BUILD_FULL_LINES } from "@luke/ui/factory-world";
import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CapsuleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  HemisphereLight,
  InstancedBufferAttribute,
  InstancedMesh,
  type Material,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PointLight,
  Points,
  Quaternion,
  type Scene,
  ShaderMaterial,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  Vector4,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { COMMON_GLSL, OUTPUT_GLSL, type SharedUniforms } from "./glsl";

/**
 * agents.ts -- Luke's coding agents as hard-hat hover-workers with jet boots, each raising the hologram of its pull request on a roof in its district.
 *
 * A worker's state is its pose, so a still frame says what a moving one
 * would. One at work welds its hologram with a construction beam, sparks
 * falling, and now and then flies off to another district its pull request
 * touches and back. One waiting on the developer floats near the top of a
 * nearly finished hologram, arms folded, looking around, a bubble of three
 * dots over it. One stuck dozes at the foot of a barely begun one under a
 * crescent moon. One that failed slumps beside a hologram glitching in the
 * defect colour, a cross in its bubble; an idle one hovers grey with no
 * hologram at all. A hologram's width and height follow the pull request's
 * lines (`buildSize`), so a big change stands as a big build.
 *
 * Every body part is one instanced mesh across all the workers, posed each
 * frame from a rig of nodes, so a hundred workers cost the same draw calls
 * as one. Everything a worker does is a function of the elapsed time and
 * its own seed, never of state carried from frame to frame.
 */

/** How large a worker stands. */
const WORKER_SCALE = 1.7;

/** Sparks each welder throws. */
const SPARKS_PER_WORKER = 26;

/** A worker's pose: what its body is doing. */
const POSE = {
  WORK: "work",
  WAIT: "wait",
  NAP: "nap",
  SLUMP: "slump",
  IDLE: "idle",
} as const;

type Pose = (typeof POSE)[keyof typeof POSE];

/** The bubble over a worker: the cell of its glyph, or none. */
const EMOTE = {
  NONE: -1,
  MOON: 0,
  DOTS: 1,
  STAR: 2,
  CROSS: 3,
} as const;

type Emote = (typeof EMOTE)[keyof typeof EMOTE];

/** A roof a worker works: the building's top, in scene units. */
export interface WorkSite {
  readonly x: number;
  readonly z: number;
  readonly top: number;
  readonly w: number;
  readonly d: number;
}

/** One worker as the world places it. */
export interface WorkerPlacement {
  readonly state: AgentState;
  readonly buildSize: number;
  /** Selected or hovered: it turns to the camera and waves. */
  readonly noticed: boolean;
  readonly selected: boolean;
  /** The roof its hologram stands on, and how far up the stack of holograms there it starts. */
  readonly home: WorkSite;
  readonly stack: number;
  /** Roofs in the other districts its pull request touches, which it visits while at work. */
  readonly trips: readonly WorkSite[];
  /** Its district, for a ship event's cheer. */
  readonly path: string | undefined;
  readonly seed: number;
}

/** A hologram's height and width for a build of `buildSize`. */
export function hologramOf(buildSize: number) {
  const lines = Math.expm1(buildSize * Math.log1p(BUILD_FULL_LINES));
  const log = Math.log2(lines + 2);
  return { h: 1.25 * log, w: Math.min(2.2 + 0.42 * log, 9.5) };
}

function poseOf(state: AgentState): Pose {
  switch (state) {
    case AGENT_STATE.WORKING:
      return POSE.WORK;
    case AGENT_STATE.WAITING:
      return POSE.WAIT;
    case AGENT_STATE.STUCK:
      return POSE.NAP;
    case AGENT_STATE.FAILED:
      return POSE.SLUMP;
    case AGENT_STATE.IDLE:
      return POSE.IDLE;
  }
}

function emoteOf(pose: Pose): Emote {
  switch (pose) {
    case POSE.WAIT:
      return EMOTE.DOTS;
    case POSE.NAP:
      return EMOTE.MOON;
    case POSE.SLUMP:
      return EMOTE.CROSS;
    case POSE.WORK:
    case POSE.IDLE:
      return EMOTE.NONE;
  }
}

function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

/** A smooth stand-in for a flicker: noise from the time and a seed, in [0, 1]. */
function flicker(t: number, seed: number): number {
  return 0.5 + 0.25 * Math.sin(t * 37 + seed * 91) + 0.25 * Math.sin(t * 23 + seed * 53);
}

/** Every part of the worker body, each an instanced mesh across all the workers. */
function bodyOf(bound: number) {
  const shell = new MeshStandardMaterial({
    color: 0xe9edf6,
    metalness: 0.2,
    roughness: 0.35,
    emissive: 0x2a3040,
  });
  const hat = new MeshStandardMaterial({
    color: 0xffffff,
    metalness: 0.25,
    roughness: 0.35,
    emissive: 0x201408,
  });
  const glow = new MeshBasicMaterial({ color: 0xffffff });
  const flame = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    vertexShader: /* glsl */ `varying float vY; varying vec3 vC; void main(){ vY = position.y; vC = instanceColor; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `varying float vY; varying vec3 vC; void main(){ float a = smoothstep(-1.0, 0.0, vY); gl_FragColor = vec4(vC * a * a * 2.4, 1.0); ${OUTPUT_GLSL} }`,
  });
  const additive = (opacity: number) =>
    new MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity,
      blending: AdditiveBlending,
      depthWrite: false,
    });
  const geometry = {
    torso:
      mergeGeometries([
        new CapsuleGeometry(0.4, 0.42, 6, 14),
        new BoxGeometry(0.5, 0.56, 0.24).translate(0, 0.06, -0.42),
        new CylinderGeometry(0.07, 0.11, 0.28, 8).translate(0.16, -0.28, -0.46),
        new CylinderGeometry(0.07, 0.11, 0.28, 8).translate(-0.16, -0.28, -0.46),
      ]) ?? new BufferGeometry(),
    chest: new BoxGeometry(0.34, 0.1, 0.06),
    head: new SphereGeometry(0.36, 18, 14).scale(1, 0.9, 1),
    hat:
      mergeGeometries([
        new SphereGeometry(0.4, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2),
        new CylinderGeometry(0.52, 0.52, 0.05, 24),
        new BoxGeometry(0.09, 0.08, 0.5).translate(0, 0.36, 0),
      ]) ?? new BufferGeometry(),
    visor: new CapsuleGeometry(0.085, 0.34, 4, 10).rotateZ(Math.PI / 2),
    tip: new SphereGeometry(0.08, 8, 6),
    arm:
      mergeGeometries([
        new CapsuleGeometry(0.1, 0.42, 4, 8).translate(0, -0.3, 0),
        new SphereGeometry(0.14, 10, 8).translate(0, -0.62, 0),
      ]) ?? new BufferGeometry(),
    tool: new CylinderGeometry(0.06, 0.1, 0.34, 8).rotateX(Math.PI / 2),
    leg:
      mergeGeometries([
        new CapsuleGeometry(0.12, 0.3, 4, 8).translate(0, -0.25, 0),
        new CylinderGeometry(0.13, 0.17, 0.2, 10).translate(0, -0.55, 0),
      ]) ?? new BufferGeometry(),
    flame: new ConeGeometry(0.15, 1.0, 12, 1, true).rotateX(Math.PI).translate(0, -0.5, 0),
    ring: new TorusGeometry(0.62, 0.045, 8, 36).rotateX(Math.PI / 2),
    beam: new CylinderGeometry(1, 1, 1, 6, 1, true).translate(0, 0.5, 0),
  };
  // Note that paired limbs share one mesh at twice the bound, the left at an agent's index and the right after every left.
  const mesh = (part: BufferGeometry, material: Material, count = bound) => {
    const instanced = new InstancedMesh(part, material, count);
    instanced.frustumCulled = false;
    instanced.instanceMatrix.setUsage(DynamicDrawUsage);
    instanced.setColorAt(0, new Color(1, 1, 1));
    instanced.count = 0;
    return instanced;
  };
  return {
    torso: mesh(geometry.torso, shell),
    head: mesh(geometry.head, shell),
    hat: mesh(geometry.hat, hat),
    arms: mesh(geometry.arm, shell, bound * 2),
    legs: mesh(geometry.leg, shell, bound * 2),
    chest: mesh(geometry.chest, glow),
    visor: mesh(geometry.visor, glow),
    tip: mesh(geometry.tip, glow),
    tool: mesh(geometry.tool, glow),
    ring: mesh(geometry.ring, glow),
    flames: mesh(geometry.flame, flame, bound * 2),
    beam: mesh(geometry.beam, additive(1)),
    beamGlow: mesh(geometry.beam, additive(0.25)),
  };
}

/** The halo over each worker that keeps it readable from the establishing shot. */
function halosOf(uniforms: SharedUniforms, bound: number) {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new BufferAttribute(new Float32Array(bound * 3), 3).setUsage(DynamicDrawUsage),
  );
  geometry.setAttribute("aColor", new BufferAttribute(new Float32Array(bound * 3), 3));
  geometry.setAttribute("aOn", new BufferAttribute(new Float32Array(bound), 1));
  geometry.setDrawRange(0, 0);
  const points = new Points(
    geometry,
    new ShaderMaterial({
      uniforms: { ...uniforms },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      vertexShader: /* glsl */ `attribute vec3 aColor; attribute float aOn; varying vec3 vC; varying float vA;
        void main(){ vC = aColor; vec4 mv = modelViewMatrix * vec4(position, 1.0); float d = -mv.z;
          vA = aOn * smoothstep(25.0, 140.0, d);
          gl_PointSize = clamp(3400.0 / d, 12.0, 30.0) * (0.6 + 0.4 * min(aOn, 1.5)); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */ `varying vec3 vC; varying float vA; void main(){ float d = length(gl_PointCoord - 0.5); float core = smoothstep(0.13, 0.0, d); float halo = pow(smoothstep(0.5, 0.0, d), 3.0); float ring = smoothstep(0.05, 0.0, abs(d - 0.36));
        gl_FragColor = vec4(vC * (core * 3.5 + halo * 0.6 + ring * 1.2) * min(vA, 1.0), 1.0); ${OUTPUT_GLSL} }`,
    }),
  );
  points.frustumCulled = false;
  return points;
}

/** The speech bubbles: a crescent moon, three dots, a star, or a cross, each drawn by its distance field. */
function emotesOf(uniforms: SharedUniforms, bound: number) {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new BufferAttribute(new Float32Array(bound * 3), 3).setUsage(DynamicDrawUsage),
  );
  geometry.setAttribute("aCell", new BufferAttribute(new Float32Array(bound).fill(EMOTE.NONE), 1));
  geometry.setAttribute("aColor", new BufferAttribute(new Float32Array(bound * 3), 3));
  geometry.setDrawRange(0, 0);
  const points = new Points(
    geometry,
    new ShaderMaterial({
      uniforms: { ...uniforms },
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: AdditiveBlending,
      vertexShader: /* glsl */ `attribute float aCell; attribute vec3 aColor; uniform float uTime; varying float vCell; varying vec3 vC; varying float vA;
        void main(){ vCell = aCell; vC = aColor; vec4 mv = modelViewMatrix * vec4(position, 1.0); float d = -mv.z;
          vA = step(-0.5, aCell) * (1.0 - smoothstep(160.0, 420.0, d) * 0.55);
          gl_PointSize = clamp(1500.0 / d, 18.0, 64.0) * (aCell > 1.5 && aCell < 2.5 ? 1.0 + 0.15 * sin(uTime * 12.0) : 1.0);
          gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */ `varying float vCell; varying vec3 vC; varying float vA;
        float box(vec2 p, vec2 b, float r){ vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
        float segment(vec2 p, vec2 a, vec2 b){ vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h); }
        float star(vec2 p, float r){
          const vec2 k1 = vec2(0.809016994375, -0.587785252292); const vec2 k2 = vec2(-k1.x, k1.y);
          p.x = abs(p.x); p -= 2.0 * max(dot(k1, p), 0.0) * k1; p -= 2.0 * max(dot(k2, p), 0.0) * k2; p.x = abs(p.x);
          p.y -= r; vec2 ba = 0.42 * vec2(-k1.y, k1.x) - vec2(0.0, 1.0); float h = clamp(dot(p, ba) / dot(ba, ba), 0.0, r);
          return length(p - ba * h) * sign(p.y * ba.x - p.x * ba.y); }
        void main(){
          vec2 p = vec2(gl_PointCoord.x, 1.0 - gl_PointCoord.y) - vec2(0.5, 0.56);
          float bubble = abs(box(p, vec2(0.42, 0.33), 0.2)) - 0.022;
          float tail = segment(p, vec2(-0.08, -0.33), vec2(0.0, -0.46));
          tail = min(tail, segment(p, vec2(0.08, -0.33), vec2(0.0, -0.46))) - 0.02;
          float glyph;
          if (vCell < 0.5) { glyph = max(length(p) - 0.17, -(length(p - vec2(0.08, 0.05)) - 0.15)); }
          else if (vCell < 1.5) { glyph = min(min(length(p - vec2(-0.16, 0.0)), length(p)), length(p - vec2(0.16, 0.0))) - 0.055; }
          else if (vCell < 2.5) { glyph = star(p * vec2(1.0, -1.0) * -1.0, 0.2); }
          else { glyph = min(segment(p, vec2(-0.13, -0.13), vec2(0.13, 0.13)), segment(p, vec2(-0.13, 0.13), vec2(0.13, -0.13))) - 0.04; }
          float a = smoothstep(0.02, 0.0, min(min(bubble, tail), glyph));
          gl_FragColor = vec4(vC * a * vA * 1.6, 1.0); ${OUTPUT_GLSL} }`,
    }),
  );
  points.frustumCulled = false;
  points.renderOrder = 10;
  return points;
}

/** The welding sparks, simulated on the GPU from each welder's weld point. */
function sparksOf(uniforms: SharedUniforms, bound: number, welds: Vector4[]) {
  const count = bound * SPARKS_PER_WORKER;
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(count * 3), 3));
  const seeds = new Float32Array(count * 4);
  for (let index = 0; index < count; index += 1) {
    const at = index * 4;
    seeds[at] = Math.floor(index / SPARKS_PER_WORKER);
    seeds[at + 1] = (index * 0.618034) % 1;
    seeds[at + 2] = (index * 0.414214 + 0.3) % 1;
    seeds[at + 3] = (index * 0.732051 + 0.7) % 1;
  }
  geometry.setAttribute("aS", new BufferAttribute(seeds, 4));
  const points = new Points(
    geometry,
    new ShaderMaterial({
      uniforms: { ...uniforms, uWeld: { value: welds } },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      vertexShader: /* glsl */ `attribute vec4 aS; uniform vec4 uWeld[${bound}]; uniform float uTime; varying vec3 vC; varying float vA;
        void main(){ vec4 w = uWeld[int(aS.x + 0.5)]; float t = fract(uTime * 1.4 + aS.y);
          vec3 v = vec3(aS.z - 0.5, 0.35 + aS.w * 0.8, fract(aS.z * 7.3) - 0.5) * vec3(5.0, 4.0, 5.0);
          vec3 p = w.xyz + v * t + vec3(0.0, -9.0, 0.0) * t * t;
          vC = mix(vec3(3.0, 2.6, 2.0), vec3(2.0, 1.1, 0.1), t); vA = w.w * (1.0 - t);
          vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_PointSize = clamp(90.0 / -mv.z, 1.0, 5.0); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */ `varying vec3 vC; varying float vA; void main(){ float d = length(gl_PointCoord - 0.5); gl_FragColor = vec4(vC * smoothstep(0.5, 0.1, d) * vA, 1.0); ${OUTPUT_GLSL} }`,
    }),
  );
  points.frustumCulled = false;
  return points;
}

/** The holograms of the pull requests under construction: wireframe floors rising to their progress. */
function hologramsOf(uniforms: SharedUniforms, bound: number) {
  const geometry = new BoxGeometry(1, 1, 1);
  geometry.translate(0, 0.5, 0);
  const color = new InstancedBufferAttribute(new Float32Array(bound * 3), 3);
  const progress = new InstancedBufferAttribute(new Float32Array(bound * 3), 3);
  geometry.setAttribute("aColor", color);
  geometry.setAttribute("aP", progress);
  const mesh = new InstancedMesh(
    geometry,
    new ShaderMaterial({
      uniforms: { ...uniforms },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
      vertexShader: /* glsl */ `attribute vec3 aColor; attribute vec3 aP; varying vec3 vLocal; varying vec3 vScale; varying vec3 vN; varying vec3 vColor; varying vec3 vP; varying float vDist; varying float vId;
        void main(){ vLocal = position; vN = normal; vScale = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
          vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0); vColor = aColor; vP = aP; vId = float(gl_InstanceID);
          vec4 mv = viewMatrix * w; vDist = -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */ `${COMMON_GLSL}
        uniform float uTime, uFocus; varying vec3 vLocal; varying vec3 vScale; varying vec3 vN; varying vec3 vColor; varying vec3 vP; varying float vDist; varying float vId;
        float gl(float x, float s, float w){ return smoothstep(w, 0.0, abs(fract(x / s + 0.5) - 0.5) * s); }
        void main(){
          vec2 fc; float span; float edgeD;
          if (abs(vN.y) > 0.5) { vec2 rc = vec2((vLocal.x + 0.5) * vScale.x, (vLocal.z + 0.5) * vScale.z); edgeD = min(min(rc.x, vScale.x - rc.x), min(rc.y, vScale.z - rc.y)); fc = vec2(rc.x, vN.y > 0.5 ? vScale.y : 0.0); }
          else { if (abs(vN.x) > 0.5) { fc = vec2((vLocal.z + 0.5) * vScale.z, vLocal.y * vScale.y); span = vScale.z; } else { fc = vec2((vLocal.x + 0.5) * vScale.x, vLocal.y * vScale.y); span = vScale.x; }
            edgeD = min(min(fc.x, span - fc.x), min(fc.y, vScale.y - fc.y)); }
          float prog = vP.x; float y = vLocal.y;
          float built = step(y, prog);
          float outline = 1.0 - smoothstep(0.0, clamp(fwidth(edgeD) * 2.0, 0.025, 0.16), edgeD);
          float floors = gl(fc.y, 1.3, 0.06);
          float mull = gl(fc.x, 1.1, 0.04) * built;
          float front = exp(-abs(y - prog) * vScale.y * 2.2);
          float scan = pow(fract(fc.y * 0.5 - uTime * 1.4), 10.0) * (1.0 - built);
          float a = outline * 1.2 + floors * (0.2 + built * 0.4) + mull * 0.18 + built * 0.07 + front * 1.6 + scan * 0.2 + 0.01;
          a *= (0.85 + 0.15 * sin(uTime * 14.0 + vId)) * vP.y;
          float sel = vP.z > 0.5 ? 1.1 : 1.0 - uFocus * 0.7;
          gl_FragColor = vec4(vColor * a * 1.3 * sel * smoothstep(3.0, 14.0, vDist) * (1.0 - fogF(vDist) * 0.7), 1.0);
          ${OUTPUT_GLSL}
        }`,
    }),
    bound,
  );
  mesh.frustumCulled = false;
  mesh.count = 0;
  return { mesh, color, progress };
}

/** The rig every worker is posed through, one node per part. */
function rigOf() {
  const rig = new Object3D();
  rig.rotation.order = "YXZ";
  const node = (parent: Object3D, x: number, y: number, z: number) => {
    const child = new Object3D();
    child.position.set(x, y, z);
    parent.add(child);
    return child;
  };
  const torso = node(rig, 0, 0, 0);
  const head = node(rig, 0, 0.9, 0);
  const shoulderLeft = node(rig, -0.56, 0.3, 0);
  const shoulderRight = node(rig, 0.56, 0.3, 0);
  const hipLeft = node(rig, -0.2, -0.48, 0);
  const hipRight = node(rig, 0.2, -0.48, 0);
  return {
    rig,
    torso,
    chest: node(torso, 0, 0.14, 0.4),
    head,
    visor: node(head, 0, 0, 0.27),
    hat: node(head, 0, 0.1, -0.02),
    tip: node(head, 0, 0.6, -0.02),
    shoulderLeft,
    shoulderRight,
    tool: node(shoulderRight, 0, -0.76, 0.1),
    hipLeft,
    hipRight,
    flameLeft: node(hipLeft, 0, -0.66, 0),
    flameRight: node(hipRight, 0, -0.66, 0),
    ring: node(rig, 0, -0.12, 0),
  };
}

export interface Workers {
  readonly group: Group;
  /** The meshes a press on a worker lands on: its body and its hologram. */
  readonly pickable: readonly InstancedMesh[];
  /** Places the workers to draw, in order; their instance index is their place in `placed`. */
  readonly place: (placed: readonly WorkerPlacement[]) => void;
  /** Poses every worker at `t`, cheering where a ship event landed in its district. */
  readonly pose: (
    t: number,
    camera: Vector3,
    cheer: { path: string | undefined; since: number } | undefined,
  ) => void;
  /** Where worker `index` stands now. */
  readonly positionOf: (index: number) => Vector3 | undefined;
  /** The top of worker `index`'s hologram. */
  readonly hologramTopOf: (index: number) => Vector3 | undefined;
}

/** The workers, the lights they are seen by, and everything they raise. */
export function createWorkers(
  scene: Scene,
  uniforms: SharedUniforms,
  palette: WorldPalette,
  bound: number,
): Workers {
  const group = new Group();
  const body = bodyOf(bound);
  const welds = Array.from({ length: bound }, () => new Vector4());
  const halos = halosOf(uniforms, bound);
  const emotes = emotesOf(uniforms, bound);
  const sparks = sparksOf(uniforms, bound, welds);
  const holograms = hologramsOf(uniforms, bound);
  const selectionRing = new Mesh(
    new TorusGeometry(1.7, 0.06, 6, 48).rotateX(Math.PI / 2),
    new MeshBasicMaterial({
      color: new Color(palette.signal.SELECTION).multiplyScalar(2.5),
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
    }),
  );
  selectionRing.visible = false;
  const spot = new PointLight(0xfff1d6, 0, 30, 1.6);
  group.add(...Object.values(body), halos, emotes, sparks, holograms.mesh, selectionRing, spot);
  scene.add(group);
  scene.add(new HemisphereLight(0x8a9cff, 0x2a0a26, 0.9));
  const moon = new DirectionalLight(0xbcc8ff, 1.2);
  moon.position.set(-200, 300, -260);
  scene.add(moon);

  const building = new Color(palette.signal.BUILDING);
  const defect = new Color(palette.signal.DEFECT);
  const shipped = new Color(palette.signal.SHIPPED);
  const selection = new Color(palette.signal.SELECTION);
  const grey = new Color(0.32, 0.3, 0.36);
  const flameBlue = new Color(0.35, 0.75, 1.2);
  const white = new Color(1, 1, 1);
  const rig = rigOf();
  const zero = new Matrix4().makeScale(0, 0, 0);
  const up = new Vector3(0, 1, 0);
  const scratch = {
    position: new Vector3(),
    before: new Vector3(),
    weld: new Vector3(),
    hand: new Vector3(),
    toward: new Vector3(),
    size: new Vector3(),
    turn: new Quaternion(),
    matrix: new Matrix4(),
    color: new Color(),
  };
  const flight = { from: new Vector3(), to: new Vector3(), middle: new Vector3() };
  let placed: readonly WorkerPlacement[] = [];
  const positions: Vector3[] = Array.from({ length: bound }, () => new Vector3());

  const signalOf = (worker: WorkerPlacement) =>
    worker.state === AGENT_STATE.FAILED
      ? defect
      : worker.state === AGENT_STATE.IDLE
        ? grey
        : building;
  const hologramBase = (worker: WorkerPlacement) => worker.home.top + worker.stack;

  /** Where a worker hovers at `site` at `t`: round its hologram at home, round the roof elsewhere. */
  const spotAt = (
    worker: WorkerPlacement,
    site: WorkSite,
    home: boolean,
    t: number,
    pose: Pose,
    out: Vector3,
  ) => {
    const theta = worker.seed * Math.PI * 2;
    if (home) {
      const { h, w } = hologramOf(worker.buildSize);
      const resting = pose === POSE.NAP || pose === POSE.SLUMP || pose === POSE.IDLE;
      const radius = w * 0.5 + (resting ? 1.6 : 2.4);
      const angle =
        theta +
        (pose === POSE.WORK
          ? Math.sin(t * 0.22 + worker.seed * 10) * 1.1
          : Math.sin(t * 0.06 + worker.seed * 10) * 0.4);
      const rise =
        pose === POSE.NAP || pose === POSE.IDLE
          ? 0.08
          : pose === POSE.SLUMP
            ? 0.3
            : pose === POSE.WAIT
              ? 0.85
              : 0.35 + 0.4 * (0.5 + 0.5 * Math.sin(t * 0.31 + worker.seed * 7));
      const bob = resting
        ? Math.sin(t * 0.9 + worker.seed) * 0.25
        : Math.sin(t * 2.1 + worker.seed) * 0.18;
      return out.set(
        site.x + Math.cos(angle) * radius,
        hologramBase(worker) + h * rise + (resting ? 0.6 : 0) + bob,
        site.z + Math.sin(angle) * radius,
      );
    }
    const angle = theta + t * 0.15;
    const radius = Math.max(site.w, site.d) * 0.5 + 1.6;
    return out.set(
      site.x + Math.cos(angle) * radius,
      site.top + 2.2 + Math.sin(t * 2.1) * 0.18,
      site.z + Math.sin(angle) * radius,
    );
  };

  /**
   * Where a worker is at `t`, and whether it flies: at work it keeps a
   * seeded round, most of it at home, then a flight to one of the districts
   * its pull request touches, a spell there, and a flight back.
   */
  const whereAt = (worker: WorkerPlacement, pose: Pose, t: number, out: Vector3) => {
    const home = { site: worker.home, home: true, flying: false };
    if (pose !== POSE.WORK || worker.trips.length === 0 || worker.selected) {
      spotAt(worker, worker.home, true, t, pose, out);
      return home;
    }
    const period = 36 + worker.seed * 14;
    const shifted = t + worker.seed * period;
    const round = Math.floor(shifted / period);
    const phase = shifted - round * period;
    const away = worker.trips[round % worker.trips.length] ?? worker.home;
    const stay = period - 14;
    if (phase < stay) {
      spotAt(worker, worker.home, true, t, pose, out);
      return home;
    }
    if (phase >= stay + 4 && phase < stay + 10) {
      spotAt(worker, away, false, t, pose, out);
      return { site: away, home: false, flying: false };
    }
    const outbound = phase < stay + 4;
    const progress = easeInOut(
      Math.min(1, outbound ? (phase - stay) / 4 : (phase - stay - 10) / 4),
    );
    const from = spotAt(worker, outbound ? worker.home : away, outbound, t, pose, flight.from);
    const to = spotAt(worker, outbound ? away : worker.home, !outbound, t, pose, flight.to);
    const middle = flight.middle.copy(from).lerp(to, 0.5);
    middle.y = Math.max(from.y, to.y) + 14 + from.distanceTo(to) * 0.12;
    const s = 1 - progress;
    out.set(
      s * s * from.x + 2 * s * progress * middle.x + progress * progress * to.x,
      s * s * from.y + 2 * s * progress * middle.y + progress * progress * to.y,
      s * s * from.z + 2 * s * progress * middle.z + progress * progress * to.z,
    );
    return { site: outbound ? away : worker.home, home: !outbound, flying: true };
  };

  const weldAt = (
    worker: WorkerPlacement,
    site: WorkSite,
    home: boolean,
    at: Vector3,
    t: number,
    out: Vector3,
  ) => {
    if (home) {
      const half = hologramOf(worker.buildSize).w / 2;
      const dx = at.x - site.x;
      const dz = at.z - site.z;
      const most = Math.max(Math.abs(dx), Math.abs(dz)) || 1;
      out.set(
        site.x + (dx / most) * half,
        at.y - 0.6 + Math.sin(t * 3.1 + worker.seed * 9) * 0.5,
        site.z + (dz / most) * half,
      );
      const along = Math.sin(t * 1.3 + worker.seed * 5) * half * 0.6;
      const length = Math.hypot(dx, dz) || 1;
      return out.add(scratch.toward.set((-dz / length) * along, 0, (dx / length) * along));
    }
    return out.set(
      site.x + Math.sin(t * 1.7 + worker.seed) * site.w * 0.25,
      site.top + 0.05,
      site.z + Math.cos(t * 1.3 + worker.seed) * site.d * 0.25,
    );
  };

  const place = (next: readonly WorkerPlacement[]) => {
    placed = next.slice(0, bound);
    const count = placed.length;
    placed.forEach((worker, index) => {
      const signal = signalOf(worker);
      const hat = scratch.color
        .copy(signal)
        .multiplyScalar(worker.state === AGENT_STATE.IDLE ? 1 : 1.6);
      body.hat.setColorAt(index, hat);
      body.chest.setColorAt(index, scratch.color.copy(signal).multiplyScalar(2.5));
      body.tip.setColorAt(
        index,
        scratch.color.copy(signal).multiplyScalar(worker.state === AGENT_STATE.IDLE ? 1 : 4),
      );
      body.tool.setColorAt(index, scratch.color.copy(signal).lerp(white, 0.6).multiplyScalar(3));
      body.ring.setColorAt(index, scratch.color.copy(signal).multiplyScalar(2.2));
      body.beam.setColorAt(index, scratch.color.copy(signal).lerp(white, 0.55).multiplyScalar(5));
      body.beamGlow.setColorAt(index, scratch.color.copy(signal).multiplyScalar(2.5));
      for (const part of [body.torso, body.head]) part.setColorAt(index, white);
      for (const pair of [body.arms, body.legs]) {
        pair.setColorAt(index, white);
        pair.setColorAt(index + bound, white);
      }
      body.flames.setColorAt(index, flameBlue);
      body.flames.setColorAt(index + bound, flameBlue);
      const shown = worker.state !== AGENT_STATE.IDLE;
      const pose = poseOf(worker.state);
      const progress =
        pose === POSE.NAP
          ? 0.18 + 0.2 * worker.buildSize
          : pose === POSE.WAIT
            ? 0.9
            : pose === POSE.SLUMP
              ? 0.5
              : 0.3 + 0.55 * worker.buildSize;
      const fade =
        pose === POSE.NAP ? 0.4 : pose === POSE.WAIT ? 0.7 : pose === POSE.SLUMP ? 0.8 : 1;
      holograms.progress.setXYZ(index, progress, shown ? fade : 0, worker.selected ? 1 : 0);
      scratch.color
        .copy(worker.noticed ? selection : signal)
        .multiplyScalar(worker.noticed ? 1.4 : 1.2);
      scratch.color.toArray(holograms.color.array, index * 3);
      const { h, w } = hologramOf(worker.buildSize);
      scratch.matrix.compose(
        scratch.position.set(worker.home.x, hologramBase(worker), worker.home.z),
        scratch.turn.identity(),
        scratch.size.set(w, h, w),
      );
      holograms.mesh.setMatrixAt(index, shown ? scratch.matrix : zero);
    });
    for (const part of Object.values(body)) {
      part.count =
        part === body.arms || part === body.legs || part === body.flames ? bound + count : count;
      if (part.instanceColor !== null) part.instanceColor.needsUpdate = true;
    }
    holograms.mesh.count = count;
    holograms.mesh.instanceMatrix.needsUpdate = true;
    holograms.color.needsUpdate = true;
    holograms.progress.needsUpdate = true;
    for (const points of [halos, emotes]) points.geometry.setDrawRange(0, count);
    // Note that a paired mesh draws every left and right, so the lefts past the workers placed are hidden.
    for (let index = count; index < bound; index += 1) {
      for (const pair of [body.arms, body.legs, body.flames]) pair.setMatrixAt(index, zero);
      welds[index]?.setW(0);
    }
  };

  const pose = (
    t: number,
    camera: Vector3,
    cheer: { path: string | undefined; since: number } | undefined,
  ) => {
    const haloPosition = halos.geometry.getAttribute("position");
    const haloColor = halos.geometry.getAttribute("aColor");
    const haloOn = halos.geometry.getAttribute("aOn");
    const emotePosition = emotes.geometry.getAttribute("position");
    const emoteCell = emotes.geometry.getAttribute("aCell");
    const emoteColor = emotes.geometry.getAttribute("aColor");
    let spotlit: Vector3 | undefined;
    placed.forEach((worker, index) => {
      const basePose = poseOf(worker.state);
      const cheering =
        cheer !== undefined &&
        cheer.path !== undefined &&
        cheer.path === worker.path &&
        cheer.since < 2.6 &&
        basePose !== POSE.IDLE;
      const where = whereAt(worker, basePose, t, scratch.position);
      const flying = where.flying;
      const noticed = worker.noticed;
      positions[index]?.copy(scratch.position);
      weldAt(worker, where.site, where.home, scratch.position, t, scratch.weld);
      let yaw: number;
      if (cheering) yaw = t * 9 + worker.seed * 6;
      else if (flying) {
        whereAt(worker, basePose, t - 0.05, scratch.before);
        yaw = Math.atan2(
          scratch.position.x - scratch.before.x,
          scratch.position.z - scratch.before.z,
        );
      } else if (noticed)
        yaw = Math.atan2(camera.x - scratch.position.x, camera.z - scratch.position.z);
      else if (basePose === POSE.WAIT)
        yaw =
          Math.atan2(worker.home.x - scratch.position.x, worker.home.z - scratch.position.z) +
          Math.PI +
          Math.sin(t * 0.45 + worker.seed * 9) * 1.3;
      else
        yaw = Math.atan2(scratch.weld.x - scratch.position.x, scratch.weld.z - scratch.position.z);
      const resting =
        (basePose === POSE.NAP || basePose === POSE.SLUMP || basePose === POSE.IDLE) &&
        !noticed &&
        !cheering;
      const pitch = flying ? 0.5 : resting ? (basePose === POSE.SLUMP ? 0.5 : 0.32) : 0.05;
      const phase = t * 1.6 + worker.seed * 20;
      const { rig: root } = rig;
      root.position.copy(scratch.position);
      root.position.y += cheering
        ? Math.abs(Math.sin(t * 9)) * 1.3
        : Math.sin(t * 2.3 + worker.seed * 9) * 0.12;
      root.rotation.set(
        pitch,
        yaw,
        resting ? Math.sin(t * 0.8 + worker.seed) * 0.12 : Math.sin(t * 1.1 + worker.seed) * 0.06,
      );
      root.scale.setScalar(WORKER_SCALE * (noticed ? 1.3 : 1));
      const welding =
        !flying &&
        !cheering &&
        !noticed &&
        basePose === POSE.WORK &&
        Math.sin(t * 0.9 + worker.seed * 30) > -0.55;
      if (cheering) {
        rig.head.rotation.set(-0.35, 0, Math.sin(t * 9) * 0.2);
        rig.shoulderRight.rotation.set(-2.9 + Math.sin(t * 18) * 0.25, 0, -0.2);
        rig.shoulderLeft.rotation.set(-2.9 + Math.sin(t * 18 + 1) * 0.25, 0, 0.2);
        rig.hipLeft.rotation.set(0.5 + Math.sin(t * 9) * 0.4, 0, 0.2);
        rig.hipRight.rotation.set(0.5 - Math.sin(t * 9) * 0.4, 0, -0.2);
      } else if (noticed && !flying) {
        rig.head.rotation.set(-0.15, 0, Math.sin(t * 3) * 0.12);
        rig.shoulderLeft.rotation.set(0, 0, -2.5 + Math.sin(t * 11) * 0.45);
        rig.shoulderRight.rotation.set(0.15, 0, -0.15);
        rig.hipLeft.rotation.set(0.1 + Math.sin(phase * 1.3) * 0.2, 0, 0.05);
        rig.hipRight.rotation.set(0.1 - Math.sin(phase * 1.3) * 0.2, 0, -0.05);
      } else if (resting) {
        rig.head.rotation.set(basePose === POSE.SLUMP ? 0.8 : 0.55, 0, Math.sin(t * 0.8) * 0.15);
        rig.shoulderLeft.rotation.set(0.15, 0, basePose === POSE.SLUMP ? 0.02 : 0.12);
        rig.shoulderRight.rotation.set(0.15, 0, basePose === POSE.SLUMP ? -0.02 : -0.12);
        rig.hipLeft.rotation.set(0.25, 0, 0.05);
        rig.hipRight.rotation.set(0.25, 0, -0.05);
      } else if (basePose === POSE.WAIT && !flying) {
        rig.head.rotation.set(0.1, Math.sin(t * 0.9 + worker.seed) * 0.5, 0);
        rig.shoulderLeft.rotation.set(-0.35, 0, 0.75);
        rig.shoulderRight.rotation.set(-0.35, 0, -0.75);
        rig.hipLeft.rotation.set(0.1 + Math.sin(phase) * 0.25, 0, 0.05);
        rig.hipRight.rotation.set(0.1, 0, -0.05);
      } else {
        rig.head.rotation.set(
          flying ? -0.3 : 0.25 + Math.sin(t * 0.9 + worker.seed) * 0.12,
          Math.sin(t * 0.7 + worker.seed * 3) * 0.35,
          0,
        );
        rig.shoulderRight.rotation.set(
          flying ? 0.9 : -1.25 + Math.sin(t * 9 + worker.seed) * 0.07,
          0,
          flying ? 0.15 : -0.1,
        );
        rig.shoulderLeft.rotation.set(
          flying ? 0.9 : 0.25 + Math.sin(phase) * 0.25,
          0,
          flying ? -0.15 : 0.3 + Math.sin(phase * 0.7) * 0.1,
        );
        rig.hipLeft.rotation.set((flying ? 0.7 : 0.1) + Math.sin(phase * 1.3) * 0.22, 0, 0.05);
        rig.hipRight.rotation.set(
          (flying ? 0.7 : 0.1) + Math.sin(phase * 1.3 + Math.PI) * 0.22,
          0,
          -0.05,
        );
      }
      rig.ring.rotation.set(Math.sin(t * 2 + worker.seed) * 0.12, t * (resting ? 0.6 : 3), 0);
      const thrust =
        (flying ? 1.6 : cheering ? 1.2 : resting ? 0.3 : 0.65) *
        (0.85 + 0.3 * flicker(t, worker.seed));
      rig.flameLeft.scale.set(1, thrust, 1);
      rig.flameRight.scale.set(1, thrust * (0.9 + 0.2 * flicker(t, worker.seed + 1)), 1);
      rig.tip.scale.setScalar(resting ? 0.5 : Math.sin(t * 6 + worker.seed * 20) > 0.3 ? 1.5 : 0.7);
      root.updateMatrixWorld(true);
      body.torso.setMatrixAt(index, rig.torso.matrixWorld);
      body.chest.setMatrixAt(index, rig.chest.matrixWorld);
      body.head.setMatrixAt(index, rig.head.matrixWorld);
      body.hat.setMatrixAt(index, rig.hat.matrixWorld);
      body.visor.setMatrixAt(index, rig.visor.matrixWorld);
      body.tip.setMatrixAt(index, rig.tip.matrixWorld);
      body.arms.setMatrixAt(index, rig.shoulderLeft.matrixWorld);
      body.arms.setMatrixAt(index + bound, rig.shoulderRight.matrixWorld);
      body.tool.setMatrixAt(index, rig.tool.matrixWorld);
      body.legs.setMatrixAt(index, rig.hipLeft.matrixWorld);
      body.legs.setMatrixAt(index + bound, rig.hipRight.matrixWorld);
      body.flames.setMatrixAt(index, rig.flameLeft.matrixWorld);
      body.flames.setMatrixAt(index + bound, rig.flameRight.matrixWorld);
      body.ring.setMatrixAt(index, rig.ring.matrixWorld);
      const signal = signalOf(worker);
      const visor = cheering
        ? scratch.color.copy(shipped).multiplyScalar(4)
        : noticed
          ? scratch.color.copy(selection).multiplyScalar(3.5)
          : resting
            ? worker.state === AGENT_STATE.FAILED
              ? scratch.color.copy(defect).multiplyScalar(3)
              : scratch.color.setRGB(0.25, 0.3, 0.45)
            : scratch.color.copy(signal).multiplyScalar(basePose === POSE.WAIT ? 1.6 : 4);
      body.visor.setColorAt(index, visor);
      scratch.hand.setFromMatrixPosition(rig.tool.matrixWorld);
      if (welding) {
        scratch.toward.copy(scratch.weld).sub(scratch.hand);
        const length = scratch.toward.length();
        scratch.toward.normalize();
        scratch.turn.setFromUnitVectors(up, scratch.toward);
        const jitter = 0.7 + flicker(t * 3, worker.seed) * 0.6;
        scratch.matrix.compose(
          scratch.hand,
          scratch.turn,
          scratch.size.set(0.05 * jitter, length, 0.05 * jitter),
        );
        body.beam.setMatrixAt(index, scratch.matrix);
        scratch.matrix.compose(
          scratch.hand,
          scratch.turn,
          scratch.size.set(0.22 * jitter, length, 0.22 * jitter),
        );
        body.beamGlow.setMatrixAt(index, scratch.matrix);
        welds[index]?.set(scratch.weld.x, scratch.weld.y, scratch.weld.z, 1);
      } else {
        body.beam.setMatrixAt(index, zero);
        body.beamGlow.setMatrixAt(index, zero);
        welds[index]?.setW(0);
      }
      const scale = noticed ? 1.3 : 1;
      haloPosition.setXYZ(
        index,
        scratch.position.x,
        scratch.position.y + 1.9 * scale,
        scratch.position.z,
      );
      haloOn.setX(index, cheering ? 1.5 : noticed ? 1.4 : basePose === POSE.IDLE ? 0.6 : 1);
      const halo = cheering
        ? shipped
        : noticed
          ? selection
          : basePose === POSE.WAIT
            ? scratch.color.copy(building).multiplyScalar(0.45)
            : resting && worker.state !== AGENT_STATE.FAILED
              ? grey
              : signal;
      halo.toArray(haloColor.array, index * 3);
      const emote = cheering ? EMOTE.STAR : flying ? EMOTE.NONE : emoteOf(basePose);
      emoteCell.setX(index, emote);
      if (emote !== EMOTE.NONE) {
        const tint =
          emote === EMOTE.STAR
            ? scratch.color.copy(shipped).multiplyScalar(1.6)
            : emote === EMOTE.CROSS
              ? scratch.color.copy(defect).multiplyScalar(1.4)
              : emote === EMOTE.DOTS
                ? scratch.color.copy(building).multiplyScalar(1.1)
                : scratch.color.setRGB(0.55, 0.62, 0.9);
        tint.toArray(emoteColor.array, index * 3);
        emotePosition.setXYZ(
          index,
          scratch.position.x,
          scratch.position.y +
            (3.3 + (resting ? Math.sin(t * 1.2 + worker.seed) * 0.3 : 0)) * scale,
          scratch.position.z,
        );
      }
      if (worker.selected) spotlit = positions[index];
    });
    for (const part of Object.values(body)) {
      part.instanceMatrix.needsUpdate = true;
    }
    if (body.visor.instanceColor !== null) body.visor.instanceColor.needsUpdate = true;
    for (const attribute of [
      haloPosition,
      haloColor,
      haloOn,
      emotePosition,
      emoteCell,
      emoteColor,
    ]) {
      attribute.needsUpdate = true;
    }
    const noticedIndex =
      placed.findIndex((worker) => worker.selected) >= 0
        ? placed.findIndex((worker) => worker.selected)
        : placed.findIndex((worker) => worker.noticed);
    const ringAt = positions[noticedIndex];
    selectionRing.visible = noticedIndex >= 0 && ringAt !== undefined;
    if (ringAt !== undefined && noticedIndex >= 0) {
      selectionRing.position.copy(ringAt).add(scratch.toward.set(0, -1.6 * 1.3, 0));
      selectionRing.rotation.y = t * 1.5;
      selectionRing.scale.setScalar(1.3 * (1 + Math.sin(t * 4) * 0.08));
    }
    spot.intensity = spotlit === undefined ? 0 : 22;
    if (spotlit !== undefined) spot.position.copy(spotlit).add(scratch.toward.set(2, 3, 2));
  };

  return {
    group,
    pickable: [body.torso, body.head, holograms.mesh],
    place,
    pose,
    positionOf: (index) => (index < placed.length ? positions[index] : undefined),
    hologramTopOf: (index) => {
      const worker = placed[index];
      if (worker === undefined) return undefined;
      return new Vector3(
        worker.home.x,
        hologramBase(worker) + hologramOf(worker.buildSize).h,
        worker.home.z,
      );
    },
  };
}
