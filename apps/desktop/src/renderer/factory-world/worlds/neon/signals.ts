import type { WorldPalette } from "@luke/panel/factory-world/world";
import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  OctahedronGeometry,
  PlaneGeometry,
  Points,
  RingGeometry,
  type Scene,
  ShaderMaterial,
  TorusGeometry,
  Vector3,
  Vector4,
} from "three";
import { COMMON_GLSL, OUTPUT_GLSL, type SharedUniforms } from "./glsl";
import { seededRandom } from "./layout";

/**
 * signals.ts -- the four signals every world draws, dressed as the Neon Megacity draws them: shipped work as beams of light into the sky, planned work as translucent ghost towers on empty lots, defects as red glitch storms over the wounded districts, and the factory line's throughput as packets arcing from stage to stage.
 *
 * Each signal is one or two instanced meshes allocated at its bound, so a
 * redraw writes instance matrices and colours and nothing else. The newest
 * merges land one after another on a loop while the scrubber stands at now,
 * each with a shockwave, a flare of light, and a burst of sparks, a ship
 * event the world's agents cheer; it is idle motion, played from the
 * elapsed time alone, and a still frame keeps every beam without it.
 */

/** Seconds between two ship events on the loop. */
const SHIP_EVENT_SECONDS = 3.4;

/** How many of the newest merges the loop plays. */
const SHIP_EVENT_RECENT = 8;

/** The most districts that carry a storm, the worst first. */
export const STORM_BOUND = 12;

/** The most storm particles over one district. */
const STORM_PARTICLES = 360;

/** Halo rings over each storm. */
const STORM_RINGS = 4;

/** Line vertices a lightning bolt may use. */
const BOLT_VERTICES = 400;

/** The most arcs of the factory line, and the packets each carries. */
const FLOW_BOUND = 320;
const FLOW_PACKETS = 2;
const FLOW_TRAIL = 6;

/** The stage of the factory line an arc hands work across. */
export const FLOW_KIND = {
  DEFECT: 0,
  PLAN: 1,
  SHIP: 2,
} as const;

type FlowKind = (typeof FLOW_KIND)[keyof typeof FLOW_KIND];

/** One shipped beam as drawn. */
export interface ShippedBeam {
  readonly x: number;
  readonly z: number;
  /** The roof it rises from. */
  readonly top: number;
  /** Its width, by its lines. */
  readonly width: number;
  /** How bright it stands, fading with its age. */
  readonly intensity: number;
  readonly chosen: boolean;
  /** The district it landed in, for the ship event's cheer and flash. */
  readonly path: string | undefined;
}

/** One ghost tower as drawn. */
export interface GhostTower {
  readonly x: number;
  readonly z: number;
  readonly h: number;
  readonly w: number;
  readonly seed: number;
  readonly chosen: boolean;
}

/** One storm as drawn: a damaged district and how badly. */
export interface Storm {
  readonly x: number;
  readonly z: number;
  readonly r: number;
  readonly height: number;
  /** In (0, 1]: its share of the worst district's events. */
  readonly strength: number;
  readonly seed: number;
}

/** One defect's shard as drawn. */
export interface DefectShard {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly chosen: boolean;
}

/** One arc of the factory line. */
export interface FlowArc {
  readonly from: Vector3;
  readonly to: Vector3;
  readonly kind: FlowKind;
  readonly rate: number;
}

/** What a ship event on the loop is doing now. */
export interface ShipEvent {
  readonly path: string | undefined;
  /** Seconds since it landed. */
  readonly since: number;
}

function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

/** The shipped beams, their roof flares, and the ship event loop. */
export function createShipped(
  scene: Scene,
  uniforms: SharedUniforms,
  palette: WorldPalette,
  bound: number,
) {
  const group = new Group();
  const shipped = new Color(palette.signal.SHIPPED);
  const selection = new Color(palette.signal.SELECTION);
  const beamGeometry = new CylinderGeometry(1, 1, 1, 14, 1, true);
  beamGeometry.translate(0, 0.5, 0);
  const beamColor = new InstancedBufferAttribute(new Float32Array(bound * 3), 3);
  const beamLevel = new InstancedBufferAttribute(new Float32Array(bound * 2), 2);
  beamGeometry.setAttribute("aColor", beamColor);
  beamGeometry.setAttribute("aLevel", beamLevel);
  const beams = new InstancedMesh(
    beamGeometry,
    new ShaderMaterial({
      uniforms: { ...uniforms },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
      vertexShader: /* glsl */ `attribute vec3 aColor; attribute vec2 aLevel; varying vec3 vC; varying float vI; varying float vY; varying vec3 vWN; varying vec3 vW; varying float vDist; varying float vSeed;
        void main(){ vI = aLevel.x; vSeed = aLevel.y; vC = aColor; vY = position.y;
          vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0); vW = w.xyz; vWN = normalize(mat3(instanceMatrix) * normal);
          vec4 mv = viewMatrix * w; vDist = -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */ `${COMMON_GLSL} uniform float uTime, uFocus; varying vec3 vC; varying float vI; varying float vY; varying vec3 vWN; varying vec3 vW; varying float vDist; varying float vSeed;
        void main(){
          vec3 V = normalize(cameraPosition - vW); vec3 n = normalize(vWN); float f = pow(abs(dot(n, normalize(vec3(V.x, 0.0, V.z) + 1e-4))), 2.5);
          float fade = pow(1.0 - vY, 1.6) * smoothstep(0.0, 0.01, vY);
          float pk = pow(fract(vY * 5.0 - uTime * 0.55 + vSeed * 3.0), 18.0) * 3.0;
          vec3 c = vC * f * fade * vI * (0.9 + pk) * (1.0 - uFocus * 0.6);
          gl_FragColor = vec4(c * (1.0 - fogF(vDist) * 0.6), 1.0);
          ${OUTPUT_GLSL} }`,
    }),
    bound,
  );
  beams.frustumCulled = false;
  beams.count = 0;
  const flareGeometry = new BufferGeometry();
  flareGeometry.setAttribute(
    "position",
    new BufferAttribute(new Float32Array(bound * 3), 3).setUsage(DynamicDrawUsage),
  );
  flareGeometry.setAttribute("aColor", new BufferAttribute(new Float32Array(bound * 3), 3));
  flareGeometry.setAttribute("aA", new BufferAttribute(new Float32Array(bound), 1));
  flareGeometry.setDrawRange(0, 0);
  const flares = new Points(
    flareGeometry,
    new ShaderMaterial({
      uniforms: { ...uniforms },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      vertexShader: /* glsl */ `attribute vec3 aColor; attribute float aA; varying vec3 vC; varying float vA; varying float vDist;
        void main(){ vA = aA; vC = aColor; vec4 mv = modelViewMatrix * vec4(position, 1.0); vDist = -mv.z;
          gl_PointSize = clamp(300.0 / -mv.z, 1.5, 40.0); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */ `${COMMON_GLSL} uniform float uFocus; varying vec3 vC; varying float vA; varying float vDist; void main(){ float d = length(gl_PointCoord - 0.5); float a = pow(smoothstep(0.5, 0.0, d), 2.0);
        gl_FragColor = vec4(vC * a * vA * (1.0 - uFocus * 0.6) * (1.0 - fogF(vDist) * 0.6), 1.0); ${OUTPUT_GLSL} }`,
    }),
  );
  flares.frustumCulled = false;
  // Note that a ship event is one shockwave, one flare of light, and one burst at a time, since the loop never overlaps two.
  const shock = new Mesh(
    new RingGeometry(0.86, 1, 64).rotateX(-Math.PI / 2),
    new MeshBasicMaterial({
      color: shipped.clone().multiplyScalar(3),
      transparent: true,
      opacity: 0,
      blending: AdditiveBlending,
      depthWrite: false,
      side: DoubleSide,
    }),
  );
  const pillar = new Mesh(
    new CylinderGeometry(1, 1, 1, 16, 1, true).translate(0, 0.5, 0),
    new MeshBasicMaterial({
      color: shipped.clone().multiplyScalar(3),
      transparent: true,
      opacity: 0,
      blending: AdditiveBlending,
      depthWrite: false,
    }),
  );
  const burstAt = { value: new Vector4(0, -999, 0, -99) };
  const random = seededRandom(31);
  const sparks = 70;
  const burstGeometry = new BufferGeometry();
  burstGeometry.setAttribute("position", new BufferAttribute(new Float32Array(sparks * 3), 3));
  const direction = new Float32Array(sparks * 4);
  for (let index = 0; index < sparks; index += 1) {
    const theta = random() * Math.PI * 2;
    const phi = Math.acos(random() * 1.6 - 0.6);
    direction.set(
      [
        Math.sin(phi) * Math.cos(theta),
        Math.cos(phi),
        Math.sin(phi) * Math.sin(theta),
        0.5 + random() * 0.8,
      ],
      index * 4,
    );
  }
  burstGeometry.setAttribute("aD", new BufferAttribute(direction, 4));
  const burst = new Points(
    burstGeometry,
    new ShaderMaterial({
      uniforms: {
        ...uniforms,
        uBurst: burstAt,
        uShip: { value: shipped.clone().multiplyScalar(2.4) },
      },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      vertexShader: /* glsl */ `attribute vec4 aD; uniform vec4 uBurst; uniform float uTime; varying float vA; varying float vT;
        void main(){ float t = uTime - uBurst.w; vT = t;
          vec3 p = uBurst.xyz + aD.xyz * aD.w * 16.0 * (1.0 - exp(-t * 3.2)) - vec3(0.0, 3.5 * t * t, 0.0);
          vA = step(0.0, t) * (1.0 - smoothstep(0.6, 2.0, t));
          vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_PointSize = clamp(700.0 / -mv.z, 2.0, 14.0) * max(0.2, 1.2 - t * 0.4); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */ `uniform vec3 uShip; varying float vA; varying float vT; void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d);
        gl_FragColor = vec4(mix(vec3(3.0, 3.0, 2.6), uShip, clamp(vT * 1.5, 0.0, 1.0)) * a * vA, 1.0); ${OUTPUT_GLSL} }`,
    }),
  );
  burst.frustumCulled = false;
  shock.visible = false;
  pillar.visible = false;
  group.add(beams, flares, shock, pillar, burst);
  scene.add(group);

  let recent: ShippedBeam[] = [];
  const placing = new Object3D();
  const tint = new Color();
  const draw = (items: readonly ShippedBeam[]) => {
    const count = Math.min(bound, items.length);
    const position = flareGeometry.getAttribute("position");
    const color = flareGeometry.getAttribute("aColor");
    const alpha = flareGeometry.getAttribute("aA");
    for (let index = 0; index < count; index += 1) {
      const item = items[index];
      if (item === undefined) continue;
      placing.position.set(item.x, item.top, item.z);
      placing.rotation.set(0, 0, 0);
      placing.scale.set(item.width, 420, item.width);
      placing.updateMatrix();
      beams.setMatrixAt(index, placing.matrix);
      tint.copy(item.chosen ? selection : shipped).multiplyScalar(item.chosen ? 2.6 : 1.9);
      tint.toArray(beamColor.array, index * 3);
      beamLevel.setXY(index, item.chosen ? 1 : item.intensity, (index * 0.618) % 1);
      position.setXYZ(index, item.x, item.top + 0.6, item.z);
      tint.toArray(color.array, index * 3);
      alpha.setX(index, 0.4 + item.intensity * 1.4);
    }
    beams.count = count;
    beams.instanceMatrix.needsUpdate = true;
    beamColor.needsUpdate = true;
    beamLevel.needsUpdate = true;
    position.needsUpdate = true;
    color.needsUpdate = true;
    alpha.needsUpdate = true;
    flareGeometry.setDrawRange(0, count);
    recent = items.slice(-SHIP_EVENT_RECENT);
  };
  /** Plays the loop at `t`, or holds it off; answers the event standing. */
  const frame = (t: number, playing: boolean): ShipEvent | undefined => {
    const event = playing && recent.length > 0 ? Math.floor(t / SHIP_EVENT_SECONDS) : -1;
    const item = event < 0 ? undefined : recent[event % recent.length];
    if (item === undefined) {
      shock.visible = false;
      pillar.visible = false;
      burstAt.value.w = -99;
      return undefined;
    }
    const landed = event * SHIP_EVENT_SECONDS;
    const since = t - landed;
    const ring = since / 1.4;
    shock.visible = ring < 1;
    shock.position.set(item.x, item.top + 0.3, item.z);
    shock.scale.setScalar(1 + easeInOut(Math.min(1, ring * 1.2)) * 16);
    shock.material.opacity = Math.max(0, 1 - ring) ** 2;
    const rise = since / 1.6;
    pillar.visible = rise < 1;
    pillar.position.set(item.x, item.top + 0.3, item.z);
    const width = 2.4 + (0.25 - 2.4) * Math.sqrt(Math.min(1, rise));
    pillar.scale.set(width, 260 * Math.min(1, rise * 6), width);
    pillar.material.opacity = Math.max(0, 1 - rise);
    burstAt.value.set(item.x, item.top + 6, item.z, landed);
    return { path: item.path, since };
  };
  return { group, beams, draw, frame };
}

/** The planned ghost towers and the blueprint glyph floating over each. */
export function createGhosts(
  scene: Scene,
  uniforms: SharedUniforms,
  palette: WorldPalette,
  bound: number,
) {
  const group = new Group();
  const planned = new Color(palette.signal.PLANNED);
  const selection = new Color(palette.signal.SELECTION);
  const towerGeometry = new BoxGeometry(1, 1, 1);
  towerGeometry.translate(0, 0.5, 0);
  const towerColor = new InstancedBufferAttribute(new Float32Array(bound * 3), 3);
  const towerSeed = new InstancedBufferAttribute(new Float32Array(bound), 1);
  towerGeometry.setAttribute("aColor", towerColor);
  towerGeometry.setAttribute("aSeed", towerSeed);
  const towers = new InstancedMesh(
    towerGeometry,
    new ShaderMaterial({
      uniforms: { ...uniforms },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
      vertexShader: /* glsl */ `attribute vec3 aColor; attribute float aSeed; varying vec3 vLocal; varying vec3 vScale; varying vec3 vN; varying vec3 vWN; varying vec3 vW; varying vec3 vColor; varying float vSeed; varying float vDist;
        void main(){ vLocal = position; vN = normal; vScale = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
          vWN = normalize(mat3(instanceMatrix) * normal); vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0); vW = w.xyz; vColor = aColor; vSeed = aSeed;
          vec4 mv = viewMatrix * w; vDist = -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */ `${COMMON_GLSL}
        uniform float uTime, uFocus; varying vec3 vLocal; varying vec3 vScale; varying vec3 vN; varying vec3 vWN; varying vec3 vW; varying vec3 vColor; varying float vSeed; varying float vDist;
        float gl(float x, float s, float w){ return smoothstep(w, 0.0, abs(fract(x / s + 0.5) - 0.5) * s); }
        vec2 faceCoord(vec3 L, vec3 S, vec3 n, out float edgeD){
          vec2 fc; float span;
          if (n.y > 0.5 || n.y < -0.5) { vec2 rc = vec2((L.x + 0.5) * S.x, (L.z + 0.5) * S.z); edgeD = min(min(rc.x, S.x - rc.x), min(rc.y, S.z - rc.y)); return vec2(rc.x, n.y > 0.5 ? S.y : 0.0); }
          if (abs(n.x) > 0.5) { fc = vec2((L.z + 0.5) * S.z, L.y * S.y); span = S.z; } else { fc = vec2((L.x + 0.5) * S.x, L.y * S.y); span = S.x; }
          edgeD = min(min(fc.x, span - fc.x), min(fc.y, S.y - fc.y));
          return fc;
        }
        void main(){
          float edgeD; vec2 fc = faceCoord(vLocal, vScale, vN, edgeD);
          vec3 V = normalize(cameraPosition - vW);
          float fres = pow(1.0 - abs(dot(normalize(vWN), V)), 2.0);
          float grid = max(gl(fc.x, 1.6, 0.05), gl(fc.y, 1.6, 0.05)) * 0.5;
          float outline = 1.0 - smoothstep(0.0, clamp(fwidth(edgeD) * 2.0, 0.03, 0.22), edgeD);
          float scan = pow(fract(fc.y * 0.35 - uTime * 0.5), 14.0);
          float sweep = exp(-abs(vLocal.y - fract(uTime * 0.11 + vSeed)) * 26.0);
          float a = 0.05 + fres * 0.2 + grid * 0.16 + outline * 0.95 + scan * 0.2 + sweep * 0.45;
          a *= 0.82 + 0.18 * sin(uTime * 3.1 + vSeed * 10.0) * step(0.5, fract(uTime * 0.7 + vSeed));
          a *= 1.0 - uFocus * 0.75;
          gl_FragColor = vec4(vColor * a * 1.6 * (1.0 - fogF(vDist) * 0.8), 1.0);
          ${OUTPUT_GLSL}
        }`,
    }),
    bound,
  );
  towers.frustumCulled = false;
  towers.count = 0;
  const glyphGeometry = new PlaneGeometry(1, 1);
  const glyphColor = new InstancedBufferAttribute(new Float32Array(bound * 3), 3);
  const glyphSeed = new InstancedBufferAttribute(new Float32Array(bound), 1);
  glyphGeometry.setAttribute("aColor", glyphColor);
  glyphGeometry.setAttribute("aSeed", glyphSeed);
  // Note that the glyph is a four-point spark drawn by its distance field, a mark rather than a word.
  const glyphs = new InstancedMesh(
    glyphGeometry,
    new ShaderMaterial({
      uniforms: { ...uniforms },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
      vertexShader: /* glsl */ `attribute vec3 aColor; attribute float aSeed; uniform float uTime; varying vec2 vUv; varying vec3 vC; varying float vDist;
        void main(){ vUv = uv; vC = aColor;
          vec4 w = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          float s = length(instanceMatrix[0].xyz);
          w.y += sin(uTime * 1.2 + aSeed * 6.0) * 0.6;
          vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
          w.xyz += right * position.x * s + vec3(0.0, 1.0, 0.0) * position.y * s;
          vec4 mv = viewMatrix * w; vDist = -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */ `${COMMON_GLSL} uniform float uTime, uFocus; varying vec2 vUv; varying vec3 vC; varying float vDist;
        void main(){ vec2 uv = vUv; float frame = step(min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y)), 0.04);
          vec2 q = abs(uv - 0.5) * 2.0;
          float spark = step(pow(q.x, 0.5) + pow(q.y, 0.5), 0.78);
          float scan = 0.75 + 0.25 * sin(uv.y * 90.0 - uTime * 8.0);
          vec3 c = vC * (spark * 1.6 + frame * 1.1 + 0.05) * scan * (1.0 - uFocus * 0.75);
          gl_FragColor = vec4(c * (1.0 - fogF(vDist) * 0.8), 1.0); ${OUTPUT_GLSL} }`,
    }),
    bound,
  );
  glyphs.frustumCulled = false;
  glyphs.count = 0;
  group.add(towers, glyphs);
  scene.add(group);
  const placing = new Object3D();
  const tint = new Color();
  const draw = (items: readonly GhostTower[]) => {
    const count = Math.min(bound, items.length);
    for (let index = 0; index < count; index += 1) {
      const item = items[index];
      if (item === undefined) continue;
      placing.position.set(item.x, 0, item.z);
      placing.rotation.set(0, 0, 0);
      placing.scale.set(item.w, item.h, item.w);
      placing.updateMatrix();
      towers.setMatrixAt(index, placing.matrix);
      placing.position.set(item.x, item.h + 6, item.z);
      placing.scale.setScalar(5.5);
      placing.updateMatrix();
      glyphs.setMatrixAt(index, placing.matrix);
      tint.copy(item.chosen ? selection : planned).multiplyScalar(item.chosen ? 1.6 : 1.2);
      tint.toArray(towerColor.array, index * 3);
      tint.toArray(glyphColor.array, index * 3);
      towerSeed.setX(index, item.seed);
      glyphSeed.setX(index, item.seed);
    }
    for (const mesh of [towers, glyphs]) {
      mesh.count = count;
      mesh.instanceMatrix.needsUpdate = true;
    }
    for (const attribute of [towerColor, towerSeed, glyphColor, glyphSeed])
      attribute.needsUpdate = true;
  };
  return { group, towers, draw };
}

/** The defects: a red glitch storm over each damaged district, lightning into its towers, and a shard over the district for each defect. */
export function createStorms(
  scene: Scene,
  uniforms: SharedUniforms,
  palette: WorldPalette,
  bound: number,
) {
  const group = new Group();
  const defect = new Color(palette.signal.DEFECT);
  const selection = new Color(palette.signal.SELECTION);
  const random = seededRandom(1717);
  const particles = STORM_BOUND * STORM_PARTICLES;
  const stormGeometry = new BufferGeometry();
  stormGeometry.setAttribute("position", new BufferAttribute(new Float32Array(particles * 3), 3));
  stormGeometry.setAttribute("aA", new BufferAttribute(new Float32Array(particles * 4), 4));
  const chance = new Float32Array(particles * 3);
  for (let index = 0; index < chance.length; index += 1) chance[index] = random();
  stormGeometry.setAttribute("aR", new BufferAttribute(chance, 3));
  const defectGlow = { value: defect.clone().multiplyScalar(3.2) };
  const storm = new Points(
    stormGeometry,
    new ShaderMaterial({
      uniforms: { ...uniforms, uDefect: defectGlow },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      vertexShader: /* glsl */ `attribute vec4 aA; attribute vec3 aR; uniform float uTime; uniform vec3 uDefect; varying float vA; varying vec3 vC; varying float vDist;
        void main(){
          float H = aA.z; float R = aA.y;
          float fall = step(0.8, aR.z);
          float y = mix(H * 0.25, H * 1.45, aR.y);
          float rr = R * (0.35 + 0.75 * aR.x) * (0.75 + 0.35 * (y / max(H, 1.0)));
          float a = aR.x * 31.4 + uTime * (0.9 + aR.z * 1.2) * (12.0 / (rr + 4.0));
          vec3 p = position + vec3(cos(a) * rr, y, sin(a) * rr);
          if (fall > 0.5) { float t = fract(uTime * 0.25 + aR.y * 5.0); p = position + vec3(cos(aR.x * 40.0) * R * 0.6 * aR.y, H * (1.1 - t * 1.1), sin(aR.x * 40.0) * R * 0.6 * aR.y); }
          float flick = step(0.25, fract(sin(floor(uTime * 12.0) + aR.x * 91.0) * 43758.5));
          vA = flick * (0.5 + 0.5 * aR.z) * aA.w;
          vC = mix(uDefect, vec3(2.8, 0.3, 0.9), step(0.85, aR.y));
          if (aR.x > 0.94) vC = vec3(0.3, 2.0, 2.6);
          vec4 mv = viewMatrix * vec4(p, 1.0); vDist = -mv.z;
          gl_PointSize = clamp((fall > 0.5 ? 220.0 : 420.0) * (0.5 + aR.z) / -mv.z, 1.5, 14.0);
          gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */ `${COMMON_GLSL} varying float vA; varying vec3 vC; varying float vDist; void main(){
        vec2 q = gl_PointCoord - 0.5; float sq = step(max(abs(q.x), abs(q.y)), 0.42);
        gl_FragColor = vec4(vC * sq * vA * 0.75 * (1.0 - fogF(vDist) * 0.7), 1.0); ${OUTPUT_GLSL} }`,
    }),
  );
  storm.frustumCulled = false;
  const cloudGeometry = new CircleGeometry(1, 64);
  const cloudStrength = new InstancedBufferAttribute(new Float32Array(STORM_BOUND), 1);
  cloudGeometry.setAttribute("aS", cloudStrength);
  const clouds = new InstancedMesh(
    cloudGeometry,
    new ShaderMaterial({
      uniforms: { ...uniforms, uDefect: defectGlow },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
      vertexShader: /* glsl */ `attribute float aS; varying vec2 vUv; varying float vDist; varying float vS; void main(){ vUv = uv; vS = aS; vec4 mv = viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0); vDist = -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */ `${COMMON_GLSL} uniform float uTime; uniform vec3 uDefect; varying vec2 vUv; varying float vDist; varying float vS; void main(){
        vec2 p = vUv - 0.5; float r = length(p) * 2.0; float a = atan(p.y, p.x);
        float sw = fbm(vec2(a * 2.0 + r * 5.0 - uTime * 0.7, r * 3.0 - uTime * 0.25));
        float v = smoothstep(0.35, 0.85, sw) * smoothstep(1.0, 0.35, r) * (0.4 + 0.6 * smoothstep(0.0, 0.3, r));
        float eye = smoothstep(0.18, 0.05, r);
        vec3 c = mix(uDefect * 0.5, vec3(1.5, 0.12, 0.45), sw * sw) * v * (0.55 + 0.6 * vS);
        c += uDefect * 0.6 * eye * 0.5;
        gl_FragColor = vec4(c * (1.0 - fogF(vDist) * 0.7), 1.0); ${OUTPUT_GLSL} }`,
    }),
    STORM_BOUND,
  );
  clouds.frustumCulled = false;
  clouds.count = 0;
  const ringGeometry = new TorusGeometry(1, 0.012, 4, 128);
  const ringSeed = new InstancedBufferAttribute(new Float32Array(STORM_BOUND * STORM_RINGS), 1);
  ringGeometry.setAttribute("aSeed", ringSeed);
  const rings = new InstancedMesh(
    ringGeometry,
    new ShaderMaterial({
      uniforms: { ...uniforms, uDefect: defectGlow },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      vertexShader: /* glsl */ `attribute float aSeed; varying vec2 vUv; varying float vDist; varying float vSeed; void main(){ vUv = uv; vSeed = aSeed; vec4 mv = viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0); vDist = -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */ `${COMMON_GLSL} uniform float uTime; uniform vec3 uDefect; varying vec2 vUv; varying float vDist; varying float vSeed; void main(){
        float seg = floor(vUv.x * 64.0); float on = step(0.38, h21(vec2(seg, floor(uTime * 7.0) + vSeed)));
        float dash = step(0.12, fract(vUv.x * 64.0));
        gl_FragColor = vec4(uDefect * on * dash * (1.0 - fogF(vDist) * 0.7), 1.0); ${OUTPUT_GLSL} }`,
    }),
    STORM_BOUND * STORM_RINGS,
  );
  rings.frustumCulled = false;
  rings.count = 0;
  const bolt = new LineSegments(
    new BufferGeometry(),
    new LineBasicMaterial({
      color: defect
        .clone()
        .multiplyScalar(4)
        .add(new Color(0, 0.4, 0.5)),
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
    }),
  );
  bolt.geometry.setAttribute(
    "position",
    new BufferAttribute(new Float32Array(BOLT_VERTICES * 3), 3).setUsage(DynamicDrawUsage),
  );
  bolt.frustumCulled = false;
  bolt.visible = false;
  const shardColor = new InstancedBufferAttribute(new Float32Array(bound * 3), 3);
  const shardGeometry = new OctahedronGeometry(1.8);
  shardGeometry.setAttribute("aColor", shardColor);
  const shards = new InstancedMesh(
    shardGeometry,
    new ShaderMaterial({
      uniforms: { ...uniforms },
      vertexShader: /* glsl */ `attribute vec3 aColor; varying vec3 vC; varying vec3 vN; varying float vDist; varying vec3 vW;
        void main(){ vC = aColor; vN = normalize(mat3(modelMatrix * instanceMatrix) * normal); vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0); vW = w.xyz;
          vec4 mv = viewMatrix * w; vDist = -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */ `${COMMON_GLSL} uniform float uTime; varying vec3 vC; varying vec3 vN; varying float vDist; varying vec3 vW; void main(){
        vec3 V = normalize(cameraPosition - vW); float f = pow(1.0 - abs(dot(normalize(vN), V)), 1.5);
        float flick = 0.8 + 0.2 * step(0.5, h11(floor(uTime * 9.0) + vW.x));
        gl_FragColor = vec4(applyFog(vC * (0.7 + f * 1.8) * flick, vDist, vW.y), 1.0); ${OUTPUT_GLSL} }`,
    }),
    bound,
  );
  shards.frustumCulled = false;
  shards.count = 0;
  group.add(storm, clouds, rings, bolt, shards);
  scene.add(group);

  let storms: Storm[] = [];
  const placing = new Object3D();
  const tint = new Color();
  const draw = (stormsNow: readonly Storm[], items: readonly DefectShard[]) => {
    storms = stormsNow.slice(0, STORM_BOUND);
    const position = stormGeometry.getAttribute("position");
    const about = stormGeometry.getAttribute("aA");
    for (let index = 0; index < particles; index += 1) {
      const item = storms[Math.floor(index / STORM_PARTICLES)];
      const within = index % STORM_PARTICLES;
      if (item === undefined) {
        about.setW(index, 0);
        continue;
      }
      const wanted = Math.min(STORM_PARTICLES, Math.round(80 + item.strength * 280));
      position.setXYZ(index, item.x, 0, item.z);
      about.setXYZW(
        index,
        0,
        item.r * (0.5 + 1.1 * Math.sqrt(item.strength)),
        item.height,
        within < wanted ? 1 : 0,
      );
    }
    position.needsUpdate = true;
    about.needsUpdate = true;
    storms.forEach((item, index) => {
      const s = Math.sqrt(item.strength);
      placing.position.set(item.x, item.height * 1.5 + 2, item.z);
      placing.rotation.set(-Math.PI / 2, 0, 0);
      placing.scale.setScalar(item.r * (1.2 + 1.8 * s));
      placing.updateMatrix();
      clouds.setMatrixAt(index, placing.matrix);
      cloudStrength.setX(index, s);
      for (let ring = 0; ring < STORM_RINGS; ring += 1) {
        ringSeed.setX(index * STORM_RINGS + ring, ring * 1.7 + item.seed * 10);
      }
    });
    clouds.count = storms.length;
    clouds.instanceMatrix.needsUpdate = true;
    cloudStrength.needsUpdate = true;
    ringSeed.needsUpdate = true;
    placeRings(0);
    const count = Math.min(bound, items.length);
    for (let index = 0; index < count; index += 1) {
      const item = items[index];
      if (item === undefined) continue;
      placing.position.set(item.x, item.y, item.z);
      placing.rotation.set(0, index * 0.7, 0);
      placing.scale.set(1, 1.6, 1);
      placing.updateMatrix();
      shards.setMatrixAt(index, placing.matrix);
      tint.copy(item.chosen ? selection : defect).multiplyScalar(item.chosen ? 1.8 : 1.4);
      tint.toArray(shardColor.array, index * 3);
    }
    shards.count = count;
    shards.instanceMatrix.needsUpdate = true;
    shardColor.needsUpdate = true;
  };
  /** Turns the halo rings: a ring per step of a storm's strength, each tilted its own way. */
  const placeRings = (t: number) => {
    let count = 0;
    storms.forEach((item, index) => {
      const shown = Math.round(1 + Math.sqrt(item.strength) * 3);
      for (let ring = 0; ring < shown; ring += 1) {
        const tilt = (((item.seed * 7 + ring * 0.37) % 1) - 0.5) * 0.5;
        placing.position.set(item.x, item.height * (0.45 + ring * 0.22), item.z);
        placing.rotation.set(
          Math.PI / 2 + tilt + Math.sin(t * 0.7 + ring) * 0.08,
          (ring % 2 ? -1 : 1) * t * 0.4,
          tilt,
        );
        placing.scale.set(
          item.r * (0.75 + 0.22 * ring),
          item.r * (0.75 + 0.22 * ring),
          item.r * (0.75 + 0.22 * ring),
        );
        placing.updateMatrix();
        rings.setMatrixAt(count, placing.matrix);
        ringSeed.setX(count, ring * 1.7 + index);
        count += 1;
      }
    });
    rings.count = count;
    rings.instanceMatrix.needsUpdate = true;
    ringSeed.needsUpdate = true;
  };
  /** Strikes lightning into the worst storms on a seeded schedule; answers the district struck and how bright the flash stands. */
  const frame = (t: number): { index: number; flash: number } | undefined => {
    placeRings(t);
    const struck = storms.filter((item) => item.strength >= 0.2);
    // Note that each strike is seeded by its own number, so the schedule is played from the elapsed time alone.
    const period = 2.2;
    const strike = Math.floor(t / period);
    const life = 0.22 - (t - strike * period);
    const item = struck[Math.floor(seededRandom(strike * 7 + 3)() ** 2 * struck.length)];
    if (item === undefined || life <= 0) {
      bolt.visible = false;
      return undefined;
    }
    const strikeRandom = seededRandom(strike * 13 + 1);
    const positions = bolt.geometry.getAttribute("position");
    let vertices = 0;
    const top = new Vector3(
      item.x + (strikeRandom() - 0.5) * item.r,
      item.height * 1.5,
      item.z + (strikeRandom() - 0.5) * item.r,
    );
    const end = new Vector3(
      item.x + (strikeRandom() - 0.5) * item.r * 0.5,
      item.height * (0.55 + strikeRandom() * 0.45),
      item.z + (strikeRandom() - 0.5) * item.r * 0.5,
    );
    const branch = (from: Vector3, to: Vector3, depth: number) => {
      let previous = from.clone();
      for (let step = 1; step <= 9 && vertices < BOLT_VERTICES - 4; step += 1) {
        const next = from.clone().lerp(to, step / 9);
        if (step < 9)
          next.add(
            new Vector3(
              (strikeRandom() - 0.5) * 3.5,
              (strikeRandom() - 0.5) * 2,
              (strikeRandom() - 0.5) * 3.5,
            ),
          );
        positions.setXYZ(vertices, previous.x, previous.y, previous.z);
        positions.setXYZ(vertices + 1, next.x, next.y, next.z);
        vertices += 2;
        previous = next;
        if (depth < 2 && strikeRandom() < 0.22) {
          branch(
            next,
            next
              .clone()
              .add(
                new Vector3(
                  (strikeRandom() - 0.5) * 14,
                  -5 - strikeRandom() * 10,
                  (strikeRandom() - 0.5) * 14,
                ),
              ),
            depth + 1,
          );
        }
      }
    };
    branch(top, end, 0);
    bolt.geometry.setDrawRange(0, vertices);
    positions.needsUpdate = true;
    bolt.visible = Math.sin(t * 90) > -0.5;
    return { index: storms.indexOf(item), flash: life * 4 };
  };
  return { group, shards, draw, frame, stormAt: (index: number) => storms[index] };
}

/** The factory line: packets of light arcing from a defect to the planned work that answers it, from planned work to the agents building it, and from the agents to what shipped. */
export function createFlow(scene: Scene, uniforms: SharedUniforms, palette: WorldPalette) {
  const points = FLOW_BOUND * FLOW_PACKETS * FLOW_TRAIL;
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(points * 3), 3));
  const from = new BufferAttribute(new Float32Array(points * 3), 3);
  const to = new BufferAttribute(new Float32Array(points * 3), 3);
  const pace = new BufferAttribute(new Float32Array(points * 4), 4);
  geometry.setAttribute("aA", from);
  geometry.setAttribute("aB", to);
  geometry.setAttribute("aP", pace);
  geometry.setDrawRange(0, 0);
  const on = { value: new Vector3(1, 1, 1) };
  const alpha = { value: 1 };
  const colors = {
    uDefect: { value: new Color(palette.signal.DEFECT).multiplyScalar(3.2) },
    uPlanned: { value: new Color(palette.signal.PLANNED).multiplyScalar(3.2) },
    uShipped: { value: new Color(palette.signal.SHIPPED).multiplyScalar(3.2) },
  };
  const flow = new Points(
    geometry,
    new ShaderMaterial({
      uniforms: { ...uniforms, ...colors, uOn: on, uFlowAlpha: alpha },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      vertexShader: /* glsl */ `attribute vec3 aA; attribute vec3 aB; attribute vec4 aP; uniform float uTime, uFlowAlpha; uniform vec3 uOn, uDefect, uPlanned, uShipped; varying vec3 vC; varying float vA;
        void main(){
          float k = aP.w; float on = k < 0.5 ? uOn.x : (k < 1.5 ? uOn.y : uOn.z);
          float t = fract(uTime * aP.y + aP.x) - aP.z * 0.011;
          vec3 mid = mix(aA, aB, 0.5); mid.y = max(aA.y, aB.y) + distance(aA.xz, aB.xz) * 0.22 + 6.0;
          float s = 1.0 - t; vec3 p = s * s * aA + 2.0 * s * t * mid + t * t * aB;
          vC = k < 0.5 ? uDefect : (k < 1.5 ? uPlanned : uShipped);
          vA = on * uFlowAlpha * smoothstep(0.0, 0.06, t) * smoothstep(1.0, 0.92, t) * (1.0 - aP.z / 6.0) * step(0.0, t);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = clamp(900.0 / -mv.z, 4.0, 14.0) * (1.0 - aP.z * 0.12);
          gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */ `uniform float uFocus; varying vec3 vC; varying float vA; void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d);
        gl_FragColor = vec4(vC * a * a * vA * (1.0 - uFocus * 0.7), 1.0); ${OUTPUT_GLSL} }`,
    }),
  );
  flow.frustumCulled = false;
  scene.add(flow);
  const draw = (arcs: readonly FlowArc[]) => {
    const random = seededRandom(5);
    let index = 0;
    for (const arc of arcs.slice(0, FLOW_BOUND)) {
      const length = arc.from.distanceTo(arc.to);
      for (let packet = 0; packet < FLOW_PACKETS; packet += 1) {
        for (let trail = 0; trail < FLOW_TRAIL; trail += 1) {
          from.setXYZ(index, arc.from.x, arc.from.y, arc.from.z);
          to.setXYZ(index, arc.to.x, arc.to.y, arc.to.z);
          pace.setXYZW(
            index,
            packet / FLOW_PACKETS + random() * 0.2,
            (8 * arc.rate) / (length + 20),
            trail,
            arc.kind,
          );
          index += 1;
        }
      }
    }
    from.needsUpdate = true;
    to.needsUpdate = true;
    pace.needsUpdate = true;
    geometry.setDrawRange(0, index);
  };
  return { flow, on, alpha, draw };
}
