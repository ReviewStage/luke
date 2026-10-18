import { SCENE_GROUND } from "@luke/ui/factory-world";
import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  Matrix3,
  Matrix4,
  Mesh,
  Points,
  type Scene,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from "three";
import { seeded, v3 } from "./kit";
import { SHADER_OUTPUT, type StationUniforms } from "./materials";
import { environmentTexture, SUN_DIRECTION } from "./textures";

/**
 * sky.ts -- where the station hangs: Earth far below with its clouds, city lights and limb, the stars and the galaxy's band, the sun, and the light all of it throws on the hull.
 *
 * Note that the station is lit by a higher sun than Earth's shader uses,
 * because a dusk terminator across the planet and a well-lit station cannot
 * share one sun at this altitude. Earth is real geometry, a sphere 1400
 * units across hung 1580 below, inside the camera's reach; the sky and the
 * stars are drawn at the far plane whatever the camera's reach, as a skybox
 * is, so the stars stand still as the camera orbits.
 *
 * In the window's light appearance the station hangs in a pale, high
 * daylight (`SCENE_GROUND.LIGHT` at the horizon) and the stars go out; in
 * its dark, space is `SCENE_GROUND.DARK` and starry, as the mockup's is.
 */

const EARTH_RADIUS = 1400;
const EARTH_DEPTH = -1580;
/** Earth's own sun: lower than the station's, so a terminator crosses it. */
const EARTH_SUN = new Vector3(0.17, 0.4, 0.95).normalize();
const STAR_COUNT = 9000;
/** The galaxy's band across the sky. */
const BAND = new Vector3(0.3, 0.8, -0.5).normalize();

/** Simplex noise and its fractal sums, for Earth's continents and clouds. */
const NOISE = /* glsl */ `
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0); const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy)); vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz); vec3 l = 1.0 - g; vec3 i1 = min(g.xyz, l.zxy); vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx; vec3 x2 = x0 - i2 + C.yyy; vec3 x3 = x0 - D.yyy; i = mod289(i);
  vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857; vec3 ns = n_ * D.wyz - D.xzx; vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z); vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy; vec4 y = y_ * ns.x + ns.yyyy; vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy); vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0; vec4 s1 = floor(b1) * 2.0 + 1.0; vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy; vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x); vec3 p1 = vec3(a0.zw, h.y); vec3 p2 = vec3(a1.xy, h.z); vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0); m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}
float fbm3(vec3 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 3; i++) { s += a * snoise(p); p *= 2.1; a *= 0.5; } return s; }
float fbm4(vec3 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * snoise(p); p *= 2.1; a *= 0.5; } return s; }
`;

/** Earth's vertex shader, shared by its surface, clouds and air. */
const EARTH_VERTEX = /* glsl */ `
varying vec3 vNormal; varying vec3 vWorld;
void main() {
  vNormal = normalize(position);
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}`;

/** A vertex shader that draws at the far plane from the camera's turn alone, as a skybox. */
const SKYBOX_VERTEX = /* glsl */ `
varying vec3 vDirection;
void main() {
  vDirection = normalize(position);
  vec4 clip = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
  gl_Position = vec4(clip.xy, clip.w * 0.99999, clip.w);
}`;

/** What `update` and `frame` turn: the appearance, and Earth's slow spin. */
export interface Sky {
  readonly setDark: (dark: boolean) => void;
  readonly step: (elapsed: number) => void;
}

function earthSurface(uniforms: Record<string, { value: unknown }>): Mesh {
  return new Mesh(
    new SphereGeometry(EARTH_RADIUS, 192, 96),
    new ShaderMaterial({
      uniforms,
      vertexShader: EARTH_VERTEX,
      fragmentShader: /* glsl */ `
${NOISE}
uniform vec3 uSun; uniform mat3 uRotation;
varying vec3 vNormal; varying vec3 vWorld;
void main() {
  vec3 N = normalize(vNormal); vec3 q = uRotation * N; vec3 V = normalize(cameraPosition - vWorld);
  float c = fbm4(q * 1.5 + vec3(3.1, 0.0, 1.7)) + 0.05 * fbm3(q * 8.0);
  float land = smoothstep(0.14, 0.17, c);
  float detail = fbm3(q * 14.0);
  vec3 ocean = mix(vec3(0.006, 0.04, 0.13), vec3(0.02, 0.17, 0.3), smoothstep(-0.25, 0.04, c));
  vec3 green = mix(vec3(0.06, 0.15, 0.05), vec3(0.2, 0.26, 0.1), detail * 0.5 + 0.5);
  vec3 desert = mix(vec3(0.42, 0.31, 0.17), vec3(0.6, 0.48, 0.3), detail * 0.5 + 0.5);
  vec3 ground = mix(green, desert, smoothstep(0.25, 0.6, fbm3(q * 3.0 + 7.0)));
  ground = mix(ground, vec3(0.3, 0.28, 0.26), smoothstep(0.4, 0.65, c));
  vec3 color = mix(ocean, ground, land);
  color = mix(color, vec3(0.85, 0.9, 0.95), smoothstep(0.78, 0.86, abs(q.y) + detail * 0.05));
  float facing = dot(N, uSun);
  float day = smoothstep(-0.08, 0.22, facing);
  vec3 H = normalize(uSun + V);
  float glint = pow(max(dot(N, H), 0.0), 120.0) * (1.0 - land) * 2.5;
  vec3 lit = color * (0.05 + 2.2 * pow(max(facing, 0.0), 0.75)) + vec3(1.0, 0.88, 0.7) * glint * day;
  float clusters = smoothstep(0.05, 0.6, snoise(q * 40.0) * 0.6 + snoise(q * 110.0) * 0.35);
  float points = smoothstep(0.55, 0.95, snoise(q * 900.0) * 0.5 + 0.5);
  float cities = clusters * (0.12 + points * 1.3) * land * (1.0 - smoothstep(0.7, 0.8, abs(q.y)));
  vec3 night = vec3(1.0, 0.62, 0.28) * cities * 1.2 + color * 0.02;
  vec3 result = mix(night, lit, day);
  float terminator = exp(-pow(facing * 7.0, 2.0));
  result += vec3(0.6, 0.25, 0.08) * terminator * 0.08;
  float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  vec3 haze = mix(vec3(0.22, 0.48, 1.0), vec3(1.0, 0.5, 0.25), terminator * 0.6);
  result = mix(result, haze * (0.05 + 0.9 * day), clamp(rim * 1.1, 0.0, 1.0) * (0.3 + 0.55 * day));
  gl_FragColor = vec4(result, 1.0);
  ${SHADER_OUTPUT}
}`,
    }),
  );
}

function earthClouds(uniforms: Record<string, { value: unknown }>): Mesh {
  return new Mesh(
    new SphereGeometry(EARTH_RADIUS + 5, 192, 96),
    new ShaderMaterial({
      uniforms,
      transparent: true,
      depthWrite: false,
      vertexShader: EARTH_VERTEX,
      fragmentShader: /* glsl */ `
${NOISE}
uniform vec3 uSun; uniform float uTime; uniform mat3 uRotation;
varying vec3 vNormal; varying vec3 vWorld;
void main() {
  vec3 N = normalize(vNormal); vec3 q = uRotation * N; vec3 V = normalize(cameraPosition - vWorld);
  vec3 w = vec3(q.x * 2.2, q.y * 5.5, q.z * 2.2) + vec3(uTime * 0.003, 0.0, 0.0);
  w += 1.1 * vec3(fbm3(w * 0.7 + 1.3), fbm3(w * 0.7 + 4.7), fbm3(w * 0.7 + 9.1));
  float density = fbm4(w) + 0.04 * snoise(w * 9.0);
  float alpha = smoothstep(0.05, 0.45, density) * 0.85 * smoothstep(-0.25, 0.25, fbm3(q * 1.1 + 2.0));
  float facing = dot(N, uSun); float day = smoothstep(-0.1, 0.25, facing);
  vec3 color = mix(vec3(0.02, 0.025, 0.04), vec3(1.0, 0.97, 0.93) * (0.2 + 1.5 * pow(max(facing, 0.0), 0.75)), day);
  color = mix(color, vec3(1.0, 0.55, 0.3), exp(-pow(facing * 6.0, 2.0)) * 0.5);
  float rim = pow(1.0 - max(dot(N, V), 0.0), 2.0);
  gl_FragColor = vec4(color, alpha * 0.9 * (1.0 - rim * 0.6));
  ${SHADER_OUTPUT}
}`,
    }),
  );
}

function earthAir(uniforms: Record<string, { value: unknown }>): Mesh {
  return new Mesh(
    new SphereGeometry(EARTH_RADIUS * 1.028, 160, 80),
    new ShaderMaterial({
      uniforms,
      side: BackSide,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      vertexShader: EARTH_VERTEX,
      fragmentShader: /* glsl */ `
uniform vec3 uSun;
varying vec3 vNormal; varying vec3 vWorld;
void main() {
  vec3 N = normalize(vNormal); vec3 V = normalize(cameraPosition - vWorld);
  float x = clamp(-dot(N, V) / 0.235, 0.0, 1.0); x = x * x * (3.0 - 2.0 * x);
  float alpha = pow(x, 5.0) * 1.3 + pow(x, 1.5) * 0.12;
  float facing = dot(N, uSun); float day = smoothstep(-0.25, 0.3, facing);
  vec3 color = mix(vec3(0.3, 0.55, 1.0), vec3(1.0, 0.55, 0.3), exp(-pow(facing * 5.0, 2.0)) * 0.7);
  gl_FragColor = vec4(color * alpha * (0.15 + 1.6 * day), 1.0);
  ${SHADER_OUTPUT}
}`,
    }),
  );
}

/** The sky behind it all: space or high daylight, the galaxy's band, and the sun's disc and glare. */
function skyDome(light: { value: number }): Mesh {
  const dome = new Mesh(
    new SphereGeometry(1, 48, 24),
    new ShaderMaterial({
      uniforms: {
        uBand: { value: BAND },
        uSun: { value: SUN_DIRECTION },
        uLight: light,
        uDark: { value: new Color(SCENE_GROUND.DARK) },
        uPale: { value: new Color(SCENE_GROUND.LIGHT) },
      },
      side: BackSide,
      depthWrite: false,
      vertexShader: SKYBOX_VERTEX,
      fragmentShader: /* glsl */ `
${NOISE}
uniform vec3 uBand, uSun, uDark, uPale; uniform float uLight;
varying vec3 vDirection;
void main() {
  vec3 d = normalize(vDirection);
  float band = pow(1.0 - abs(dot(d, uBand)), 10.0);
  float n = fbm4(d * 3.0) * 0.5 + 0.5;
  vec3 space = uDark * 0.25 + vec3(0.1, 0.12, 0.2) * band * n * 0.35 + vec3(0.18, 0.08, 0.16) * pow(band, 3.0) * smoothstep(0.5, 0.9, n) * 0.25;
  vec3 daylight = mix(uPale, vec3(0.55, 0.68, 0.86), smoothstep(-0.05, 0.9, d.y));
  vec3 color = mix(space, daylight, uLight);
  float facing = max(dot(d, uSun), 0.0);
  color += vec3(1.0, 0.95, 0.85) * (pow(facing, 2400.0) * 40.0 + pow(facing, 300.0) * 1.2 + pow(facing, 24.0) * 0.12);
  gl_FragColor = vec4(color, 1.0);
  ${SHADER_OUTPUT}
}`,
    }),
  );
  dome.frustumCulled = false;
  dome.renderOrder = -10;
  return dome;
}

/** Nine thousand stars, half of them crowding the galaxy's band, twinkling. */
function starField(time: { value: number }): Points {
  const random = seeded(3);
  const positions = new Float32Array(STAR_COUNT * 3);
  const colors = new Float32Array(STAR_COUNT * 3);
  const sizes = new Float32Array(STAR_COUNT);
  for (let star = 0; star < STAR_COUNT; star += 1) {
    const direction = v3(random() * 2 - 1, random() * 2 - 1, random() * 2 - 1).normalize();
    if (star < STAR_COUNT * 0.5) {
      direction.addScaledVector(BAND, -direction.dot(BAND) * (0.85 + 0.15 * random())).normalize();
    }
    positions.set(direction.toArray(), star * 3);
    const kind = random();
    const tint = kind < 0.15 ? [0.7, 0.8, 1] : kind < 0.25 ? [1, 0.85, 0.65] : [0.95, 0.95, 1];
    const brightness = random() ** 6 * 2.4 + 0.15;
    colors.set(
      tint.map((channel) => channel * brightness),
      star * 3,
    );
    sizes[star] = 1.2 + random() ** 8 * 5;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setAttribute("color", new BufferAttribute(colors, 3));
  geometry.setAttribute("size", new BufferAttribute(sizes, 1));
  const stars = new Points(
    geometry,
    new ShaderMaterial({
      uniforms: { uTime: time },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      vertexShader: /* glsl */ `
attribute float size; attribute vec3 color;
uniform float uTime;
varying vec3 vColor;
void main() {
  vColor = color * (0.8 + 0.2 * sin(uTime * 1.7 + position.x * 400.0));
  gl_PointSize = size;
  vec4 clip = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
  gl_Position = vec4(clip.xy, clip.w * 0.99999, clip.w);
}`,
      fragmentShader: /* glsl */ `
varying vec3 vColor;
void main() {
  float d = length(gl_PointCoord - 0.5);
  gl_FragColor = vec4(vColor * smoothstep(0.5, 0.0, d), 1.0);
  ${SHADER_OUTPUT}
}`,
    }),
  );
  stars.frustumCulled = false;
  stars.renderOrder = -9;
  return stars;
}

/** Hangs Earth, the sky and the lights in `scene`. */
export function buildSky(scene: Scene, uniforms: StationUniforms): Sky {
  const sun = new DirectionalLight(0xfff0dc, 3.4);
  sun.position.copy(SUN_DIRECTION).multiplyScalar(160);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, {
    left: -62,
    right: 62,
    top: 62,
    bottom: -62,
    near: 40,
    far: 320,
  });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  sun.shadow.radius = 3;
  const hemisphere = new HemisphereLight(0x1b2234, 0x2f5b8f, 0.75);
  const earthFill = new DirectionalLight(0x5f9cff, 0.55);
  earthFill.position.set(0.2, -1, -0.3);
  scene.add(sun, sun.target, hemisphere, earthFill);
  scene.environment = environmentTexture();
  scene.environmentIntensity = 0.8;

  const rotation = new Matrix3();
  const earthUniforms = {
    uSun: { value: EARTH_SUN },
    uTime: uniforms.uTime,
    uRotation: { value: rotation },
  };
  const earth = new Group();
  earth.position.set(0, EARTH_DEPTH, 0);
  earth.add(earthSurface(earthUniforms), earthClouds(earthUniforms), earthAir(earthUniforms));
  const light = { value: 0 };
  const stars = starField(uniforms.uTime);
  scene.add(earth, skyDome(light), stars);

  const turn = new Matrix4();
  const tilt = new Matrix4().makeRotationX(1.1);
  const step = (elapsed: number) =>
    rotation.setFromMatrix4(turn.makeRotationY(elapsed * 0.002).multiply(tilt));
  step(0);
  return {
    setDark: (dark) => {
      light.value = dark ? 0 : 1;
      stars.visible = dark;
      hemisphere.intensity = dark ? 0.75 : 1.4;
    },
    step,
  };
}
