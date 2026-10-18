import {
  AdditiveBlending,
  BackSide,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Euler,
  Float32BufferAttribute,
  HemisphereLight,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  type MeshStandardMaterial,
  MultiplyBlending,
  PlaneGeometry,
  PointLight,
  Quaternion,
  type Scene,
  SphereGeometry,
  Vector3,
} from "three";
import { CITY, type CityLayout, DISTRICT_KIND, SURVEY_BAND, sceneRadiusOf } from "./city";
import {
  boulderGeometry,
  clamp,
  fractalNoise,
  merged,
  seabedHeightAt,
  seededRandom,
  smoothstep,
} from "./geometry";
import { MOOD, type Mood, type Sea, TAU } from "./sea";
import { type Billboards, PARTICLE_KIND, PARTICLE_LAYER, type Particles } from "./sprites";

/**
 * seabed.ts -- the sea Atlantis stands in: the water overhead and its light, the sand and the canyon wall beyond the city, the plaza's survey lines and sonar, marine snow, god rays, rocks, kelp, jellyfish, the vents round the great dome, and the lights.
 *
 * None of it is a signal, and all of it is built once. The rocks near the
 * city are the one thing that moves with the data: they are set again
 * whenever the districts are laid out, so none stands inside one. One sun
 * casts the world's one shadow; the warm light at the heart is the city's
 * own and casts none.
 */

/** Where the sun shines from, high over the city. */
const SUN_AT = new Vector3(90, 340, 70);

/** How many boulders stand near the city, among the districts, and how many far out on the canyon floor. */
const BOULDERS = { NEAR: 70, FAR: 350 } as const;

const KELP = 420;
const SNOW = 5000;
const GODRAYS = 16;
const JELLIES = 9;
const VENTS = 7;

/** The sea floor and everything in its water that is no signal. */
export interface Seabed {
  /** Lights and dresses the sea for `mood`. */
  readonly enter: (mood: Mood) => void;
  /** Clears the near boulders out of `layout`'s districts. */
  readonly settle: (layout: CityLayout) => void;
  /** Shows the sonar sweep, which wakes the planned blueprints, or hides it. */
  readonly sweep: (shown: boolean) => void;
  /** Swims the jellyfish and puffs the vents, `delta` seconds on. */
  readonly step: (delta: number, elapsed: number, particles: Particles) => void;
  /** Draws its standing lights. */
  readonly paint: (glows: Billboards, elapsed: number) => void;
}

const VIGNETTE_VERTEX = /* glsl */ `
varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy*2.0, 0.0, 1.0); }`;

const VIGNETTE_FRAGMENT = /* glsl */ `
uniform float uVignette; varying vec2 vUv;
void main(){
  vec2 c = vUv - 0.5;
  float k = mix(0.42, 1.0, smoothstep(0.95, 0.25, length(c*vec2(1.0, 1.15))));
  vec3 grade = mix(vec3(1.0), vec3(0.95,1.01,1.03), uVignette);
  gl_FragColor = vec4(grade*mix(1.0, k, uVignette), 1.0);
}`;

const BACKDROP_VERTEX = /* glsl */ `
varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix*modelViewMatrix*vec4(position,1.0); gl_Position = p.xyww; }`;

const BACKDROP_FRAGMENT = /* glsl */ `
uniform vec3 uSun; uniform vec3 uAbyss; uniform vec3 uSurface; varying vec3 vDir;
void main(){
  vec3 d = normalize(vDir);
  vec3 col = d.y < 0.0 ? mix(uFogColor, uAbyss, smoothstep(0.0,-0.5,d.y)) : mix(uFogColor, uSurface, pow(d.y, 0.9));
  float snell = smoothstep(0.62, 0.78, d.y);
  vec2 sp = d.xz / max(d.y, 0.2);
  float rip = causticAt(sp*0.35, uTime*0.4);
  col += vec3(0.5,0.95,1.0) * snell * (0.25 + rip*0.5);
  float sun = pow(max(dot(d, uSun), 0.0), 40.0);
  col += vec3(0.8,1.0,1.0) * sun * 1.6;
  gl_FragColor = vec4(col, 1.0);
}`;

const PLAZA_VERTEX = /* glsl */ `
varying vec3 vW; varying float vDepth;
void main(){ vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz; vec4 mv = viewMatrix*w; vDepth = -mv.z; gl_Position = projectionMatrix*mv; }`;

const PLAZA_FRAGMENT = /* glsl */ `
uniform float uSweepOn; uniform vec4 uRings; uniform vec3 uPlanned; varying vec3 vW; varying float vDepth;
float ring(float r, float c, float w){ return exp(-pow((r-c)/w, 2.0)); }
void main(){
  float r = length(vW.xz); float a = atan(vW.z, vW.x);
  float col = 0.0;
  col += ring(r, uRings.x, 0.35)*0.9 + ring(r, uRings.x + 2.5, 0.2)*0.5;
  float dash = step(0.5, fract(a*40.0/6.28318));
  col += ring(r, uRings.y, 0.25)*0.35*dash;
  float spokes = pow(abs(cos(a*6.0)), 400.0) * smoothstep(uRings.z, uRings.z + 10.0, r) * smoothstep(uRings.w, uRings.w - 30.0, r);
  col += spokes*0.25;
  float sweepAt = mod(uTime*0.45, 6.28318);
  float da = mod(sweepAt - a, 6.28318);
  float edge = exp(-pow(da*40.0, 2.0)) * smoothstep(uRings.y - 50.0, uRings.y - 10.0, r) * smoothstep(uRings.y + 60.0, uRings.y + 20.0, r) * uSweepOn;
  vec3 c = vec3(0.3,0.9,1.0)*col*0.3 + uPlanned*1.6*edge*0.22;
  gl_FragColor = vec4(c*(1.0-fogF(vDepth)), 1.0);
}`;

const GODRAY_VERTEX = /* glsl */ `
attribute vec4 aRay; attribute float aSeed; uniform vec3 uSun;
varying vec2 vUv; varying float vDepth; varying float vSeed; varying float vAlign;
void main(){
  vec3 base = vec3(aRay.x, -5.0, aRay.y);
  vec3 toCam = cameraPosition - base; toCam -= uSun*dot(toCam, uSun); toCam = normalize(toCam);
  vec3 right = normalize(cross(uSun, toCam));
  vec3 w = base + right*position.x*aRay.z + uSun*position.y*aRay.w;
  vUv = uv; vSeed = aSeed; vAlign = abs(dot(normalize(cameraPosition - w), uSun));
  vec4 mv = viewMatrix*vec4(w,1.0); vDepth = -mv.z; gl_Position = projectionMatrix*mv;
}`;

const GODRAY_FRAGMENT = /* glsl */ `
uniform float uRayGain; varying vec2 vUv; varying float vDepth; varying float vSeed; varying float vAlign;
void main(){
  float side = smoothstep(0.75, 0.35, vAlign);
  float edge = pow(sin(3.14159*vUv.x), 2.0);
  float stripes = 0.55 + 0.45*sin(vUv.x*17.0 + uTime*0.35 + vSeed*10.0)*sin(vUv.x*7.0 - uTime*0.21 + vSeed*3.0);
  float v = pow(vUv.y, 1.4) * smoothstep(0.0, 0.25, vUv.y);
  float flick = 0.7 + 0.3*sin(uTime*0.5 + vSeed*20.0);
  float a = edge*stripes*v*flick*0.11*side*uRayGain;
  gl_FragColor = vec4(vec3(0.55,0.95,1.0)*a*(1.0-fogF(vDepth)*0.6), 1.0);
}`;

const SNOW_VERTEX = /* glsl */ `
attribute vec4 aP; varying vec2 vUv; varying float vDepth; varying float vA;
void main(){
  vec3 c = aP.xyz;
  c.y = mod(c.y - uTime*(0.5 + aP.w*0.9), 220.0) - 4.0;
  c.x += sin(uTime*0.21 + aP.w*40.0)*2.5; c.z += cos(uTime*0.17 + aP.w*30.0)*2.5;
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  float s = 0.18 + aP.w*0.32;
  vec3 w = c + (right*position.x + up*position.y)*s;
  vec4 mv = viewMatrix*vec4(w,1.0); vDepth = -mv.z; gl_Position = projectionMatrix*mv; vUv = uv;
  vA = smoothstep(2.0, 12.0, vDepth);
}`;

const SNOW_FRAGMENT = /* glsl */ `
varying vec2 vUv; varying float vDepth; varying float vA;
void main(){ float d = length(vUv-0.5)*2.0; float a = exp(-d*d*4.0)*vA*(1.0-fogF(vDepth)); gl_FragColor = vec4(vec3(0.7,0.95,1.0)*a*0.7, 1.0); }`;

const KELP_VERTEX = /* glsl */ `
attribute vec4 aK; varying vec2 vUv; varying float vDepth; varying vec3 vW;
void main(){
  float h = 14.0 + aK.w*30.0; float wdt = 2.2 + aK.w*2.2;
  float y = position.y;
  float yaw = aK.w*40.0;
  vec3 dir = vec3(cos(yaw), 0.0, sin(yaw));
  vec3 p = aK.xyz + dir*position.x*wdt*(1.0-y*0.6) + vec3(0.0, y*h, 0.0);
  p.x += sin(uTime*0.6 + aK.w*20.0 + y*2.5)*y*y*4.0;
  p.z += cos(uTime*0.5 + aK.w*13.0 + y*2.0)*y*y*3.0;
  vW = p; vUv = uv;
  vec4 mv = viewMatrix*vec4(p,1.0); vDepth = -mv.z; gl_Position = projectionMatrix*mv;
}`;

const KELP_FRAGMENT = /* glsl */ `
varying vec2 vUv; varying float vDepth; varying vec3 vW;
void main(){
  float vein = 1.0 - abs(vUv.x-0.5)*2.0;
  vec3 c = mix(vec3(0.05,0.09,0.06), vec3(0.2,0.32,0.16), vUv.y) * (0.55 + 0.45*vein);
  c += vec3(0.4,0.8,0.5)*caustic(vW, uTime*0.5)*0.25*vUv.y;
  gl_FragColor = vec4(mix(c, uFogColor, fogF(vDepth)), 1.0);
}`;

const JELLY_VERTEX = /* glsl */ `
attribute float aPart; attribute float aSeed;
varying float vPart; varying vec3 vN; varying vec3 vV; varying float vDepth;
void main(){
  vec3 p = position;
  float pulse = sin(uTime*1.8 + aSeed);
  if (aPart < 0.5) { p.xz *= 1.0 - 0.14*pulse*(1.0-p.y); p.y *= 1.0 + 0.12*pulse; }
  else { p.x += sin(uTime*1.5 + aSeed + p.y*1.2)*(-p.y)*0.12; p.z += cos(uTime*1.2 + aSeed + p.y)*(-p.y)*0.12; }
  vec4 w = modelMatrix*instanceMatrix*vec4(p,1.0);
  vN = normalize(mat3(modelMatrix*instanceMatrix)*normal); vV = cameraPosition - w.xyz; vPart = aPart;
  vec4 mv = viewMatrix*w; vDepth = -mv.z; gl_Position = projectionMatrix*mv;
}`;

const JELLY_FRAGMENT = /* glsl */ `
varying float vPart; varying vec3 vN; varying vec3 vV; varying float vDepth;
void main(){
  float fr = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.0);
  vec3 c = vPart < 0.5 ? vec3(0.75,0.85,1.0)*(0.08 + fr*0.7) : vec3(0.7,0.8,1.0)*0.22;
  gl_FragColor = vec4(c*(1.0-fogF(vDepth)*0.8), 1.0);
}`;

/** The sand, dark silt, rock and weed the floor is painted in, by height and noise. */
function groundGeometry(): PlaneGeometry {
  const ground = new PlaneGeometry(1900, 1900, 240, 240);
  ground.rotateX(-Math.PI / 2);
  const position = ground.getAttribute("position");
  const colors = new Float32Array(position.count * 3);
  const sand = new Color("#978d76");
  const silt = new Color("#5b5644");
  const rock = new Color("#3c4646");
  const weed = new Color("#4f6640");
  const paint = new Color();
  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index);
    const z = position.getZ(index);
    const height = seabedHeightAt(x, z);
    position.setY(index, height);
    paint.copy(sand).lerp(silt, clamp(fractalNoise(x * 0.03 + 9, z * 0.03, 3) * 0.9 - 0.15, 0, 1));
    paint.lerp(weed, clamp((fractalNoise(x * 0.012, z * 0.012 + 4, 3) - 0.55) * 2, 0, 0.5));
    paint.lerp(rock, smoothstep(4, 40, height));
    colors.set([paint.r, paint.g, paint.b], index * 3);
  }
  ground.setAttribute("color", new Float32BufferAttribute(colors, 3));
  ground.computeVertexNormals();
  return ground;
}

/** Ribbons of kelp swaying on the canyon's slopes. */
function kelpOf(sea: Sea, random: () => number): Mesh {
  const blade = new PlaneGeometry(1, 1, 1, 14).translate(0, 0.5, 0);
  const geometry = new InstancedBufferGeometry();
  geometry.index = blade.index;
  geometry.setAttribute("position", blade.getAttribute("position"));
  geometry.setAttribute("uv", blade.getAttribute("uv"));
  const roots = new Float32Array(KELP * 4);
  for (let index = 0; index < KELP; index += 1) {
    const turn = random() * TAU;
    const out = 330 + random() * 170;
    const x = Math.cos(turn) * out;
    const z = Math.sin(turn) * out;
    roots.set([x, seabedHeightAt(x, z) - 0.5, z, random()], index * 4);
  }
  geometry.setAttribute("aK", new InstancedBufferAttribute(roots, 4));
  geometry.instanceCount = KELP;
  const kelp = new Mesh(geometry, sea.shader({}, KELP_VERTEX, KELP_FRAGMENT, { side: DoubleSide }));
  kelp.frustumCulled = false;
  return kelp;
}

/** Marine snow, drifting down through the whole sea. */
function snowOf(sea: Sea, random: () => number): Mesh {
  const quad = new PlaneGeometry(1, 1);
  const geometry = new InstancedBufferGeometry();
  geometry.index = quad.index;
  geometry.setAttribute("position", quad.getAttribute("position"));
  geometry.setAttribute("uv", quad.getAttribute("uv"));
  const flakes = new Float32Array(SNOW * 4);
  for (let index = 0; index < SNOW; index += 1) {
    flakes.set([random() * 840 - 420, random() * 220, random() * 840 - 420, random()], index * 4);
  }
  geometry.setAttribute("aP", new InstancedBufferAttribute(flakes, 4));
  geometry.instanceCount = SNOW;
  const snow = new Mesh(
    geometry,
    sea.shader({}, SNOW_VERTEX, SNOW_FRAGMENT, {
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    }),
  );
  snow.frustumCulled = false;
  snow.renderOrder = 7;
  return snow;
}

/** Shafts of sunlight slanting down through the water, each turned to face the camera about the sun's line. */
function godraysOf(sea: Sea, sun: Vector3, gain: { value: number }, random: () => number): Mesh {
  const plane = new PlaneGeometry(1, 1).translate(0, 0.5, 0);
  const geometry = new InstancedBufferGeometry();
  geometry.index = plane.index;
  geometry.setAttribute("position", plane.getAttribute("position"));
  geometry.setAttribute("uv", plane.getAttribute("uv"));
  const rays = new Float32Array(GODRAYS * 4);
  const seeds = new Float32Array(GODRAYS);
  for (let index = 0; index < GODRAYS; index += 1) {
    const turn = random() * TAU;
    const out = 10 + random() * 250;
    rays.set(
      [Math.cos(turn) * out, Math.sin(turn) * out, 14 + random() * 32, 260 + random() * 100],
      index * 4,
    );
    seeds[index] = random();
  }
  geometry.setAttribute("aRay", new InstancedBufferAttribute(rays, 4));
  geometry.setAttribute("aSeed", new InstancedBufferAttribute(seeds, 1));
  geometry.instanceCount = GODRAYS;
  const shafts = new Mesh(
    geometry,
    sea.shader({ uSun: { value: sun }, uRayGain: gain }, GODRAY_VERTEX, GODRAY_FRAGMENT, {
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
    }),
  );
  shafts.frustumCulled = false;
  shafts.renderOrder = 6;
  return shafts;
}

/** A vent chimney: a rough, open cone a unit tall. */
function ventGeometry() {
  const vent = new CylinderGeometry(0.9, 2.6, 1, 9, 4, true);
  const position = vent.getAttribute("position");
  const point = new Vector3();
  for (let index = 0; index < position.count; index += 1) {
    point.fromBufferAttribute(position, index);
    const k = 1 + (fractalNoise(point.x * 3, point.y * 4 + point.z * 3, 1) - 0.5) * 0.5;
    position.setXYZ(index, point.x * k, point.y, point.z * k);
  }
  vent.computeVertexNormals();
  return merged([vent]);
}

/** A jellyfish: a bell and eight trailing tentacles, `aPart` 0 for the bell and 1 for a tentacle. */
function jellyGeometry() {
  const bell = new SphereGeometry(1, 20, 10, 0, TAU, 0, Math.PI / 2).toNonIndexed();
  bell.setAttribute(
    "aPart",
    new Float32BufferAttribute(new Float32Array(bell.getAttribute("position").count), 1),
  );
  const parts = [bell];
  for (let arm = 0; arm < 8; arm += 1) {
    const turn = (arm / 8) * TAU;
    const tentacle = new CylinderGeometry(0.03, 0.01, 3.5, 3, 8, true)
      .translate(Math.cos(turn) * 0.6, -1.75, Math.sin(turn) * 0.6)
      .toNonIndexed();
    tentacle.setAttribute(
      "aPart",
      new Float32BufferAttribute(
        new Float32Array(tentacle.getAttribute("position").count).fill(1),
        1,
      ),
    );
    parts.push(tentacle);
  }
  return merged(parts, ["position", "normal", "aPart"]);
}

/** The sea of `scene`, built once. */
export function seabedOf(scene: Scene, sea: Sea): Seabed {
  const random = seededRandom(20261017);
  const sun = SUN_AT.clone().normalize();
  scene.fog = sea.fog;
  scene.background = null;

  const abyss = new Color();
  const surface = new Color();
  const backdrop = new Mesh(
    new SphereGeometry(2000, 48, 24),
    sea.shader(
      { uSun: { value: sun }, uAbyss: { value: abyss }, uSurface: { value: surface } },
      BACKDROP_VERTEX,
      BACKDROP_FRAGMENT,
      { side: BackSide, depthWrite: false },
    ),
  );
  backdrop.renderOrder = -10;
  backdrop.frustumCulled = false;
  scene.add(backdrop);

  const groundMaterial: MeshStandardMaterial = sea.standard(
    { vertexColors: true, roughness: 0.96, metalness: 0 },
    { caustic: 1.5, ripples: true },
  );
  const ground = new Mesh(groundGeometry(), groundMaterial);
  ground.receiveShadow = true;
  scene.add(ground);

  const sweepOn = { value: 1 };
  const plaza = new Mesh(
    new CircleGeometry(250, 128).rotateX(-Math.PI / 2),
    sea.shader(
      {
        uSweepOn: sweepOn,
        uPlanned: { value: new Color(sea.signal.PLANNED) },
        uRings: {
          value: [
            CITY.DOME_RADIUS + 5.5,
            (SURVEY_BAND.INNER + SURVEY_BAND.OUTER) / 2,
            CITY.RING_START - 6,
            sceneRadiusOf(3),
          ],
        },
      },
      PLAZA_VERTEX,
      PLAZA_FRAGMENT,
      { transparent: true, depthWrite: false, blending: AdditiveBlending },
    ),
  );
  plaza.position.y = 0.9;
  plaza.renderOrder = 1;
  scene.add(plaza);

  // Note that the water darkens towards the edges of the view, as a lens under the sea does: one quad multiplied over the frame as it is drawn, which needs no pass of its own.
  const vignette = { value: 1 };
  const lens = new Mesh(
    new PlaneGeometry(1, 1),
    sea.shader({ uVignette: vignette }, VIGNETTE_VERTEX, VIGNETTE_FRAGMENT, {
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: MultiplyBlending,
      premultipliedAlpha: true,
      toneMapped: false,
    }),
  );
  lens.frustumCulled = false;
  lens.renderOrder = 1000;
  scene.add(lens);

  scene.add(snowOf(sea, random));
  const rayGain = { value: 1 };
  scene.add(godraysOf(sea, sun, rayGain, random));
  scene.add(kelpOf(sea, random));

  // Note that the far boulders are set once, and the near ones on every layout, clear of the districts.
  const boulders = new InstancedMesh(
    boulderGeometry(1.3),
    sea.standard({ color: "#56605c", roughness: 0.92, flatShading: true }, { caustic: 1.2 }),
    BOULDERS.NEAR + BOULDERS.FAR,
  );
  boulders.receiveShadow = true;
  boulders.frustumCulled = false;
  const placing = new Matrix4();
  const turning = new Quaternion();
  const sizing = new Vector3();
  const at = new Vector3();
  const tilt = new Euler();
  const tint = new Color();
  const near = Array.from({ length: BOULDERS.NEAR }, () => {
    const turn = random() * TAU;
    const out = 60 + random() * 180;
    return {
      x: Math.cos(turn) * out,
      z: Math.sin(turn) * out,
      size: 0.6 + random() * 1.2,
      yaw: random() * TAU,
    };
  });
  for (let index = 0; index < BOULDERS.NEAR + BOULDERS.FAR; index += 1) {
    boulders.setColorAt(
      index,
      tint.setHSL(0.45 + random() * 0.1, 0.06 + random() * 0.1, 0.42 + random() * 0.18),
    );
    if (index < BOULDERS.NEAR) continue;
    const turn = random() * TAU;
    const out = 290 + random() * 270;
    const x = Math.cos(turn) * out;
    const z = Math.sin(turn) * out;
    const size = (2 + random() * 10) * (1 + smoothstep(320, 520, out));
    turning.setFromEuler(tilt.set(random() * 0.6 - 0.3, random() * TAU, random() * 0.6 - 0.3));
    placing.compose(
      at.set(x, seabedHeightAt(x, z) - size * 0.15, z),
      turning,
      sizing.set(size * (0.8 + random() * 0.7), size, size * (0.8 + random() * 0.6)),
    );
    boulders.setMatrixAt(index, placing);
  }
  scene.add(boulders);

  const vents = Array.from({ length: VENTS }, (_, index) => {
    const turn = (index / VENTS) * TAU + 0.3;
    const out = CITY.DOME_RADIUS + 12 + random() * 6;
    return {
      x: Math.cos(turn) * out,
      z: Math.sin(turn) * out,
      height: 4 + random() * 5,
      wide: 0.8 + random() * 0.5,
    };
  });
  const ventMesh = new InstancedMesh(
    ventGeometry(),
    sea.standard(
      {
        color: "#2e2a2a",
        roughness: 0.9,
        flatShading: true,
        emissive: "#ff5a10",
        emissiveIntensity: 0.05,
      },
      { caustic: 0.8 },
    ),
    VENTS,
  );
  vents.forEach((vent, index) => {
    placing.compose(
      at.set(vent.x, vent.height / 2 - 0.5, vent.z),
      turning.identity(),
      sizing.set(vent.wide, vent.height, vent.wide),
    );
    ventMesh.setMatrixAt(index, placing);
  });
  ventMesh.castShadow = true;
  scene.add(ventMesh);
  const ventGlow = new Color("#ff7a2a").multiplyScalar(1.8);
  const ventBubble = new Color("#ffd2a8");

  const jellySeeds = new Float32Array(JELLIES).map(() => random() * 100);
  const jellyShape = jellyGeometry();
  jellyShape.setAttribute("aSeed", new InstancedBufferAttribute(jellySeeds, 1));
  const jellies = new InstancedMesh(
    jellyShape,
    sea.shader({}, JELLY_VERTEX, JELLY_FRAGMENT, {
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
    }),
    JELLIES,
  );
  jellies.frustumCulled = false;
  jellies.renderOrder = 6;
  const swims = Array.from({ length: JELLIES }, () => ({
    turn: random() * TAU,
    out: 60 + random() * 200,
    height: 25 + random() * 65,
    size: 0.8 + random() * 1.4,
    speed: (0.01 + random() * 0.02) * (random() < 0.5 ? 1 : -1),
    phase: random() * TAU,
  }));
  const swim = (elapsed: number) => {
    swims.forEach((jelly, index) => {
      const turn = jelly.turn + elapsed * jelly.speed;
      const height =
        jelly.height +
        Math.sin(elapsed * 0.3 + jelly.phase) * 6 +
        Math.max(0, Math.sin(elapsed * 1.8 + jelly.phase)) * 0.6;
      turning.setFromEuler(
        tilt.set(
          Math.sin(elapsed * 0.4 + jelly.phase) * 0.2,
          0,
          Math.cos(elapsed * 0.3 + jelly.phase) * 0.2,
        ),
      );
      placing.compose(
        at.set(Math.cos(turn) * jelly.out, height, Math.sin(turn) * jelly.out),
        turning,
        sizing.setScalar(jelly.size),
      );
      jellies.setMatrixAt(index, placing);
    });
    jellies.instanceMatrix.needsUpdate = true;
  };
  swim(0);
  scene.add(jellies);

  const sky = new HemisphereLight();
  scene.add(sky);
  const sunlight = new DirectionalLight("#bff4ff");
  sunlight.position.copy(SUN_AT);
  sunlight.castShadow = true;
  sunlight.shadow.mapSize.set(2048, 2048);
  Object.assign(sunlight.shadow.camera, {
    left: -280,
    right: 280,
    top: 280,
    bottom: -280,
    near: 40,
    far: 800,
  });
  sunlight.shadow.camera.updateProjectionMatrix();
  sunlight.shadow.bias = -0.0004;
  sunlight.shadow.normalBias = 0.5;
  scene.add(sunlight);
  // Note that the heart's warm light is the city's own, so it lights the districts round the great dome and casts no shadow.
  const heart = new PointLight("#ffad55", 70, 170, 1);
  heart.position.set(0, 16, 0);
  scene.add(heart);

  const rise = new Vector3();
  const drift = new Vector3();
  return {
    enter: (mood) => {
      abyss.set(mood.abyss);
      surface.set(mood.surface);
      sky.color.set(mood.sky);
      sky.groundColor.set(mood.bed);
      sky.intensity = mood.skyLight;
      sunlight.intensity = mood.sunLight;
      groundMaterial.color.set(mood.sand);
      rayGain.value = mood.sunLight / MOOD.DEEP.sunLight;
      vignette.value = mood.vignette;
    },
    settle: (layout) => {
      near.forEach((boulder, index) => {
        const crowded =
          Math.hypot(boulder.x, boulder.z) < CITY.DOME_RADIUS + 14 ||
          layout.districts.some(
            (district) =>
              district.kind !== DISTRICT_KIND.CRYSTAL &&
              Math.hypot(boulder.x - district.centre.x, boulder.z - district.centre.z) <
                district.radius * 1.3 + 8,
          );
        if (crowded) placing.makeScale(0, 0, 0);
        else {
          placing.compose(
            at.set(
              boulder.x,
              seabedHeightAt(boulder.x, boulder.z) - boulder.size * 0.15,
              boulder.z,
            ),
            turning.setFromAxisAngle(rise.set(0, 1, 0), boulder.yaw),
            sizing.set(boulder.size * 1.2, boulder.size, boulder.size * 1.1),
          );
        }
        boulders.setMatrixAt(index, placing);
      });
      boulders.instanceMatrix.needsUpdate = true;
    },
    sweep: (shown) => {
      sweepOn.value = shown ? 1 : 0;
    },
    step: (delta, elapsed, particles) => {
      swim(elapsed);
      for (const vent of vents) {
        if (random() >= delta * 5) continue;
        particles.spawn(
          PARTICLE_KIND.BUBBLE,
          PARTICLE_LAYER.AMBIENT,
          rise.set(vent.x, vent.height - 0.4, vent.z),
          drift.set(0, 2, 0),
          7,
          0.2 + random() * 0.35,
          ventBubble,
          0.8,
        );
      }
    },
    paint: (glows, elapsed) => {
      for (const vent of vents) {
        const flicker =
          0.825 + 0.175 * Math.sin(elapsed * 7 + vent.x) * Math.sin(elapsed * 3.1 + vent.z);
        glows.push(
          vent.x,
          vent.height - 0.4,
          vent.z,
          4.5,
          ventGlow.r * flicker,
          ventGlow.g * flicker,
          ventGlow.b * flicker,
          1,
        );
      }
    },
  };
}
