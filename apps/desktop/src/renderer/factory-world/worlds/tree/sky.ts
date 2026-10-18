import {
  BackSide,
  BufferGeometry,
  type Camera,
  Color,
  CylinderGeometry,
  DataTexture,
  DirectionalLight,
  DoubleSide,
  Euler,
  Float32BufferAttribute,
  FogExp2,
  HemisphereLight,
  InstancedBufferAttribute,
  InstancedMesh,
  LinearFilter,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  RGBAFormat,
  type Scene,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { GLOW_SHAPE, type GlowField } from "./glow";
import {
  AIR_DENSITY,
  between,
  GLSL_NOISE,
  painted,
  randomOf,
  SUN_DIRECTION,
  valueNoise,
} from "./nature";
import type { SharedUniforms } from "./wood";
import { clumpGeometry } from "./wood";

/**
 * sky.ts -- the World Tree's sky and air: the dusk dome and its night, the sun and the fill lights, the sea of clouds below the island, the islets drifting far off, the birds circling the crown, and the fireflies.
 *
 * Dusk is the light appearance and night the dark one; every colour that
 * differs between them is mixed by the shared `uNight`, and the lights are
 * set by `dress`. Nothing here is a signal, and nothing here is picked.
 */

const DUSK = {
  FOG: new Color("#d9a9b6"),
  HEMI_SKY: new Color("#aab4ff"),
  HEMI_GROUND: new Color("#e3a57a"),
  SUN: new Color("#ffd09a"),
} as const;

const NIGHT = {
  FOG: new Color("#3a2f58"),
  HEMI_SKY: new Color("#6a74c8"),
  HEMI_GROUND: new Color("#5a3f5a"),
  SUN: new Color("#b8c6ff"),
} as const;

const CLOUD_COUNT = 95;
const ISLET_COUNT = 6;
const BIRD_COUNT = 11;
const FIREFLY_COUNT = 110;

/** The dome: dusk's peach horizon under a violet zenith, or night's, with the sun's bloom and a scatter of stars. */
function skyDome(shared: SharedUniforms, camera: Camera): Mesh {
  const material = new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    fog: false,
    uniforms: { uSunDir: shared.uSunDir, uTime: shared.uTime, uNight: shared.uNight },
    vertexShader: /* glsl */ `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position.z = gl_Position.w; }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uSunDir; uniform float uTime; uniform float uNight; varying vec3 vDir;
      ${GLSL_NOISE}
      void main(){
        vec3 d = normalize(vDir);
        float y = d.y;
        vec3 zen = mix(srgb(vec3(0.17, 0.21, 0.48)), srgb(vec3(0.04, 0.05, 0.16)), uNight);
        vec3 mid = mix(srgb(vec3(0.52, 0.47, 0.80)), srgb(vec3(0.16, 0.14, 0.34)), uNight);
        vec3 hor = mix(srgb(vec3(1.0, 0.80, 0.66)), srgb(vec3(0.42, 0.28, 0.42)), uNight);
        vec3 low = mix(srgb(vec3(0.95, 0.76, 0.78)), srgb(vec3(0.26, 0.20, 0.36)), uNight);
        vec3 col = mix(hor, mid, smoothstep(-0.01, 0.16, y));
        col = mix(col, zen, smoothstep(0.12, 0.62, y));
        col = mix(col, low, smoothstep(0.0, -0.25, y));
        col = mix(col, mix(srgb(vec3(0.55, 0.47, 0.72)), srgb(vec3(0.12, 0.10, 0.24)), uNight), smoothstep(-0.25, -0.9, y));
        float s = max(dot(d, uSunDir), 0.0);
        vec3 glow = vec3(1.0, 0.62, 0.35) * pow(s, 6.0) * 0.55 + vec3(1.0, 0.85, 0.6) * pow(s, 60.0) * 0.9 + vec3(1.0, 0.95, 0.85) * smoothstep(0.9993, 0.9996, s) * 3.0;
        col += glow * mix(1.0, 0.25, uNight);
        vec3 cell = floor(d * 380.0);
        float star = step(0.9975 - uNight * 0.0025, h31(cell)) * smoothstep(0.25 - uNight * 0.2, 0.7, y) * (0.6 + 0.4 * sin(uTime * 2.0 + h31(cell + 3.0) * 30.0));
        col += vec3(0.9, 0.9, 1.0) * star * (1.4 + uNight * 1.2);
        float band = vn3(vec3(d.x * 3.0 + uTime * 0.004, d.y * 14.0, d.z * 3.0));
        col += vec3(1.0, 0.8, 0.7) * smoothstep(0.55, 0.9, band) * smoothstep(0.35, 0.08, abs(y - 0.12)) * 0.12 * (1.0 - uNight * 0.6);
        gl_FragColor = vec4(min(col, vec3(0.98)) * 0.92, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const dome = new Mesh(new SphereGeometry(450, 48, 24), material);
  dome.renderOrder = -2;
  dome.frustumCulled = false;
  // Note that the dome travels with the camera, so it stays at the far plane however far the camera pulls back.
  dome.onBeforeRender = () => {
    dome.position.copy(camera.position);
    dome.updateMatrixWorld();
  };
  return dome;
}

/** A cloud's soft puff as an alpha map: the mockup's blobs along an arc, cut flat beneath. */
function cloudTexture(): DataTexture {
  const size = 128;
  const data = new Uint8Array(size * size * 4);
  const random = randomOf(5);
  const blobs = Array.from({ length: 34 }, () => {
    const u = random();
    const x = size * (0.18 + u * 0.64);
    const y = size * (0.5 - Math.sin(u * Math.PI) * (0.08 + random() * 0.14));
    const r = size * (0.07 + random() * 0.12) * (0.6 + Math.sin(u * Math.PI));
    return { x, y, r };
  });
  // Note that each blob covers only its own square, so the puff is built a blob at a time rather than every blob at every texel.
  const coverage = new Float32Array(size * size);
  for (const blob of blobs) {
    const low = Math.max(0, Math.floor(blob.y - blob.r));
    const high = Math.min(size - 1, Math.ceil(blob.y + blob.r));
    const left = Math.max(0, Math.floor(blob.x - blob.r));
    const right = Math.min(size - 1, Math.ceil(blob.x + blob.r));
    for (let py = low; py <= high; py += 1) {
      for (let px = left; px <= right; px += 1) {
        const d = Math.hypot(px - blob.x, py - blob.y);
        const k = 1 - Math.min(1, Math.max(0, (d - blob.r * 0.55) / (blob.r * 0.45)));
        const at = py * size + px;
        coverage[at] = (coverage[at] ?? 0) + k * 0.95 * (1 - (coverage[at] ?? 0));
      }
    }
  }
  for (let py = 0; py < size; py += 1) {
    const cut = 1 - Math.min(1, Math.max(0, (py / size - 0.56) / 0.16));
    for (let px = 0; px < size; px += 1) {
      const at = ((size - 1 - py) * size + px) * 4;
      data[at] = 255;
      data[at + 1] = 255;
      data[at + 2] = 255;
      data[at + 3] = Math.round(255 * (coverage[py * size + px] ?? 0) * cut);
    }
  }
  const texture = new DataTexture(data, size, size, RGBAFormat);
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/** The islets far off, one merged little island with a tree on it. */
function isletGeometry(): BufferGeometry {
  const segments = 18;
  const levels = 8;
  const position: number[] = [];
  const color: number[] = [];
  const index: number[] = [];
  const shade = new Color();
  for (let i = 0; i <= levels; i += 1) {
    const f = i / levels;
    for (let j = 0; j < segments; j += 1) {
      const th = (j / segments) * Math.PI * 2;
      const rho =
        (i === levels ? 0.05 : (1 - f) ** 0.8) *
        (0.85 + 0.3 * valueNoise(Math.cos(th) * 2 + 9, f * 3, Math.sin(th) * 2));
      position.push(Math.cos(th) * rho, -f * 1.6 - (i === levels ? 0.3 : 0), Math.sin(th) * rho);
      shade.set("#b0806a").lerp(new Color("#5a4474"), f);
      color.push(shade.r, shade.g, shade.b);
    }
  }
  for (let i = 0; i < levels; i += 1) {
    for (let j = 0; j < segments; j += 1) {
      const a = i * segments + j;
      const b = i * segments + ((j + 1) % segments);
      const c = (i + 1) * segments + j;
      const d = (i + 1) * segments + ((j + 1) % segments);
      index.push(a, b, c, b, d, c);
    }
  }
  const body = new BufferGeometry();
  body.setAttribute("position", new Float32BufferAttribute(position, 3));
  body.setAttribute("color", new Float32BufferAttribute(color, 3));
  body.setIndex(index);
  body.computeVertexNormals();
  const random = randomOf(23);
  const parts = [
    body.toNonIndexed(),
    painted(new CylinderGeometry(0.95, 0.98, 0.14, 18).translate(0, 0.05, 0), "#86b85c"),
    painted(new CylinderGeometry(0.07, 0.13, 0.8, 6).translate(0, 0.45, 0), "#6b4b3a"),
    ...Array.from({ length: 4 }, () => {
      const s = between(random, 0.28, 0.42);
      return painted(
        clumpGeometry()
          .scale(s, s, s)
          .translate(
            between(random, -0.25, 0.25),
            0.85 + between(random, 0, 0.3),
            between(random, -0.25, 0.25),
          ),
        "#4fa865",
      );
    }),
  ];
  const merged = mergeGeometries(parts);
  if (merged === null) throw new Error("tree: the islet's parts would not merge");
  return merged;
}

/** One wing, a thin triangle; the flock is twice as many wings as birds. */
function wingGeometry(): BufferGeometry {
  const wing = new BufferGeometry();
  wing.setAttribute(
    "position",
    new Float32BufferAttribute([0, 0, 0.12, 0, 0, -0.12, 0.7, 0, -0.05], 3),
  );
  wing.computeVertexNormals();
  return wing;
}

export interface Sky {
  /** Sets the lights and the air for dusk or night. */
  readonly dress: (night: boolean) => void;
  /** Steps the clouds, islets, birds, and fireflies `t` seconds in. */
  readonly drift: (t: number) => void;
  /** Lets go of the cloud texture, which no material holds by name. */
  readonly dispose: () => void;
}

export function sky(scene: Scene, camera: Camera, shared: SharedUniforms, glow: GlowField): Sky {
  scene.add(skyDome(shared, camera));
  const fog = new FogExp2(DUSK.FOG.clone(), AIR_DENSITY);
  scene.fog = fog;
  const hemi = new HemisphereLight(DUSK.HEMI_SKY.clone(), DUSK.HEMI_GROUND.clone(), 0.95);
  const sun = new DirectionalLight(DUSK.SUN.clone(), 3.4);
  sun.position.copy(SUN_DIRECTION).multiplyScalar(80);
  sun.target.position.set(0, 4, 0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, {
    left: -40,
    right: 40,
    top: 44,
    bottom: -34,
    near: 20,
    far: 170,
  });
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.04;
  sun.shadow.radius = 4;
  const rim = new DirectionalLight("#9fc4ff", 0.7);
  rim.position.set(40, 20, -50);
  scene.add(hemi, sun, sun.target, rim);

  const cloudPuff = cloudTexture();
  const cloudMaterial = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    fog: false,
    uniforms: {
      uTex: { value: cloudPuff },
      uSunDir: shared.uSunDir,
      uFog: { value: fog.color },
      uNight: shared.uNight,
    },
    vertexShader: /* glsl */ `attribute vec4 aTint; varying vec2 vUv; varying vec4 vTint; varying float vDist; varying float vSun; uniform vec3 uSunDir;
      void main(){ vUv = uv; vTint = aTint;
        vec3 c = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
        float sz = length(vec3(instanceMatrix[0][0], instanceMatrix[0][1], instanceMatrix[0][2]));
        vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
        vec3 w = c + (right * position.x + up * position.y * 0.62) * sz;
        vDist = length(cameraPosition - w);
        vSun = dot(normalize(c - cameraPosition), uSunDir);
        gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0); }`,
    fragmentShader: /* glsl */ `vec3 srgb(vec3 c){ return pow(c, vec3(2.2)); }
      uniform sampler2D uTex; uniform vec3 uFog; uniform float uNight; varying vec2 vUv; varying vec4 vTint; varying float vDist; varying float vSun;
      void main(){ vec4 t = texture2D(uTex, vUv);
        vec3 lit = mix(srgb(vec3(0.66, 0.58, 0.84)), srgb(vec3(1.0, 0.95, 0.92)), smoothstep(0.38, 0.66, vUv.y));
        lit = mix(lit, lit * srgb(vec3(0.42, 0.40, 0.62)), uNight);
        lit += vec3(1.0, 0.6, 0.35) * pow(max(vSun, 0.0), 4.0) * 0.5 * (1.0 - uNight);
        vec3 col = lit * vTint.rgb;
        col = mix(col, uFog * 1.05, smoothstep(160.0, 600.0, vDist) * 0.6);
        gl_FragColor = vec4(col, t.a * vTint.a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const clouds = new InstancedMesh(new PlaneGeometry(1, 1), cloudMaterial, CLOUD_COUNT);
  const tint = new Float32Array(CLOUD_COUNT * 4);
  const random = randomOf(31);
  const cloudBase = Array.from({ length: CLOUD_COUNT }, (_, index) => {
    const sea = index < 78;
    const th = random() * 6.28;
    // Note that the far ring stands nearer than the mockup's, inside the camera's reach.
    const rho = sea ? between(random, 30, 300) : between(random, 300, 380);
    const y = sea ? between(random, -80, -60) - rho * 0.05 : between(random, -30, 20);
    const b = between(random, 0.88, 1.05);
    tint.set(
      [
        b,
        b * between(random, 0.95, 1),
        b,
        sea ? between(random, 0.75, 1) : between(random, 0.25, 0.4),
      ],
      index * 4,
    );
    return {
      p: new Vector3(Math.cos(th) * rho, y, Math.sin(th) * rho),
      size: sea ? between(random, 45, 110) : between(random, 90, 160),
      speed: between(random, 0.2, 0.6),
    };
  });
  clouds.geometry.setAttribute("aTint", new InstancedBufferAttribute(tint, 4));
  clouds.frustumCulled = false;
  clouds.renderOrder = -1;

  const islets = new InstancedMesh(
    isletGeometry(),
    new MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }),
    ISLET_COUNT,
  );
  const isletSpots = [
    [-60, 4, 180, 7],
    [190, -16, -40, 9],
    [-130, 30, 120, 5],
    [150, 30, 120, 4.5],
    [-200, -12, -30, 8],
    [40, -30, -200, 6],
  ] as const;
  const isletBase = isletSpots.map(([x, y, z, s]) => ({
    p: new Vector3(x, y, z),
    s,
    turn: random() * 6,
    phase: random() * 6,
  }));

  const birdMaterial = new MeshBasicMaterial({ color: "#5a4a72", side: DoubleSide });
  const birds = new InstancedMesh(wingGeometry(), birdMaterial, BIRD_COUNT * 2);
  birds.frustumCulled = false;
  const flock = Array.from(
    { length: BIRD_COUNT },
    (_, index) =>
      new Vector3(
        (index % 2 ? 1 : -1) * Math.ceil(index / 2) * 1.2,
        between(random, -0.3, 0.3),
        -Math.ceil(index / 2) * 1.1,
      ),
  );

  const fireflyFirst = glow.reserve(FIREFLY_COUNT);
  const fireflies = Array.from({ length: FIREFLY_COUNT }, (_, index) => {
    const under = index < 30;
    const th = random() * 6.28;
    const rho = under ? between(random, 1, 12) : between(random, 3, 26);
    const y = under ? between(random, -24, -2) : between(random, 0.5, 30);
    return {
      c: new Vector3(Math.cos(th) * rho, y, Math.sin(th) * rho),
      phase: random() * 30,
      speed: between(random, 0.2, 0.6),
      amp: between(random, 0.6, 2),
    };
  });
  scene.add(clouds, islets, birds);

  let night = false;
  const matrix = new Matrix4();
  const turn = new Quaternion();
  const euler = new Euler();
  const scale = new Vector3();
  const p = new Vector3();
  const centre = new Vector3();
  const forward = new Vector3();

  const drift = (t: number) => {
    cloudBase.forEach((cloud, index) => {
      const a = t * 0.004 * cloud.speed;
      p.set(
        cloud.p.x * Math.cos(a) - cloud.p.z * Math.sin(a),
        cloud.p.y + Math.sin(t * 0.1 + index) * 0.8,
        cloud.p.x * Math.sin(a) + cloud.p.z * Math.cos(a),
      );
      matrix.makeScale(cloud.size, cloud.size, cloud.size).setPosition(p);
      clouds.setMatrixAt(index, matrix);
    });
    clouds.instanceMatrix.needsUpdate = true;
    isletBase.forEach((islet, index) => {
      p.copy(islet.p);
      p.y += Math.sin(t * 0.3 + islet.phase) * 1.2;
      matrix.compose(p, turn.setFromEuler(euler.set(0, islet.turn, 0)), scale.setScalar(islet.s));
      islets.setMatrixAt(index, matrix);
    });
    islets.instanceMatrix.needsUpdate = true;
    // Note that the birds circle the crown in a loose V.
    const around = t * 0.07;
    centre.set(Math.cos(around) * 40, 36 + Math.sin(t * 0.2) * 3, Math.sin(around) * 40);
    forward.set(-Math.sin(around), 0, Math.cos(around));
    const yaw = Math.atan2(forward.x, forward.z);
    flock.forEach((offset, index) => {
      p.copy(centre)
        .addScaledVector(forward, offset.z)
        .add(
          scale.set(
            Math.cos(yaw) * offset.x,
            offset.y + Math.sin(t * 1.2 + index) * 0.2,
            -Math.sin(yaw) * offset.x,
          ),
        );
      const flap = Math.sin(t * 7 + index * 0.7) * 0.7;
      matrix.compose(
        p,
        turn.setFromEuler(euler.set(0, yaw - Math.PI / 2, flap)),
        scale.setScalar(0.75),
      );
      birds.setMatrixAt(index * 2, matrix);
      matrix.compose(
        p,
        turn.setFromEuler(euler.set(0, yaw + Math.PI / 2, -flap)),
        scale.setScalar(0.75),
      );
      birds.setMatrixAt(index * 2 + 1, matrix);
    });
    birds.instanceMatrix.needsUpdate = true;
    const lit = night ? 1.6 : 1;
    fireflies.forEach((fly, index) => {
      const flicker = (0.5 + 0.5 * Math.sin(t * (1.5 + fly.speed * 3) + fly.phase * 7)) ** 3;
      glow.set(
        fireflyFirst + index,
        fly.c.x + Math.sin(t * fly.speed + fly.phase) * fly.amp * 2,
        fly.c.y + Math.sin(t * fly.speed * 1.3 + fly.phase * 2) * fly.amp,
        fly.c.z + Math.cos(t * fly.speed * 0.8 + fly.phase) * fly.amp * 2,
        0.28,
        1.1,
        1.2,
        1.0,
        (0.1 + 0.5 * flicker) * 0.7 * lit,
        GLOW_SHAPE.DOT,
      );
    });
  };
  drift(0);

  return {
    dress: (dark) => {
      night = dark;
      const k = dark ? 1 : 0;
      shared.uNight.value = k;
      fog.color.copy(DUSK.FOG).lerp(NIGHT.FOG, k);
      hemi.color.copy(DUSK.HEMI_SKY).lerp(NIGHT.HEMI_SKY, k);
      hemi.groundColor.copy(DUSK.HEMI_GROUND).lerp(NIGHT.HEMI_GROUND, k);
      hemi.intensity = dark ? 0.55 : 0.95;
      sun.color.copy(DUSK.SUN).lerp(NIGHT.SUN, k);
      sun.intensity = dark ? 1.3 : 3.4;
      rim.intensity = dark ? 0.9 : 0.7;
      birdMaterial.color.set(dark ? "#2a2240" : "#5a4a72");
    },
    drift,
    dispose: () => cloudPuff.dispose(),
  };
}
