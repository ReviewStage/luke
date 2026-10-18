import {
  AdditiveBlending,
  BackSide,
  type BufferGeometry,
  CapsuleGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  EllipseCurve,
  Euler,
  Fog,
  HemisphereLight,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Quaternion,
  type Scene,
  ShaderMaterial,
  Shape,
  ShapeGeometry,
  SphereGeometry,
  SpotLight,
  type Texture,
  Vector2,
  Vector3,
} from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { type Burrows, COLONY } from "./layout";
import { seeded, vnoise } from "./shapes";
import { grainOf, type SoilFace, type Turf, woodTexture } from "./soil";

/**
 * room.ts -- the terrarium and the room it stands in: the sky, the desk, the wooden frame and its glass, the soil slab and its cut face, the meadow and its grass, the lights, the dust in the air, and the butterflies.
 *
 * All of it is built once. The meadow's grass is replanted, and its turf
 * repainted, only when the burrows change, since it parts around every
 * anthill, shaft, and the trail. Light and dark dress the same room: a
 * warm afternoon, or the terrarium after dark under a desk lamp.
 */

/** How many grass blades the meadow holds at most. */
const GRASS = 15000;

const BUTTERFLY_WINGS = [
  ["#ffb84a", "#5b3412"],
  ["#9ec8ff", "#2d3e66"],
  ["#ffd9ef", "#8a4a6a"],
  ["#fff2a8", "#7a6020"],
  ["#ffb84a", "#5b3412"],
] as const;

/** The room's two dressings: its sky, its fog, and its lights. */
const MOOD = {
  LIGHT: {
    sky: ["#c9dfd8", "#f6e6c8", "#c9a57c"],
    fog: "#efe1c6",
    hemi: ["#fff1da", "#6a4a32", 0.6],
    sun: ["#ffe2b6", 3.4],
    lamp: ["#fff0cf", 1.8],
    desk: "#d8c7b0",
  },
  DARK: {
    sky: ["#101624", "#1d1a17", "#0d0907"],
    fog: "#14110f",
    hemi: ["#7d8cb0", "#1e140c", 0.32],
    sun: ["#a9b9e6", 1.2],
    lamp: ["#ffc98f", 3.2],
    desk: "#6f5e4c",
  },
} as const;

/** Glowing motes: one camera-facing quad per mote, sized in scene units, drifting and twinkling in the shader. */
export interface Motes {
  readonly mesh: Mesh<InstancedBufferGeometry, ShaderMaterial>;
  readonly center: InstancedBufferAttribute;
  readonly alpha: InstancedBufferAttribute;
  readonly color: InstancedBufferAttribute;
}

/** Makes `count` motes, each filled in by `fill`, drifting by `drift` units. */
export function motesOf(
  count: number,
  time: { value: number },
  drift: number,
  fill: (
    index: number,
    mote: { center: Vector3; color: Color; size: number; alpha: number },
  ) => void,
): Motes {
  const quad = new PlaneGeometry(1, 1);
  const geometry = new InstancedBufferGeometry();
  geometry.setIndex(quad.getIndex());
  geometry.setAttribute("position", quad.getAttribute("position"));
  geometry.setAttribute("uv", quad.getAttribute("uv"));
  const center = new InstancedBufferAttribute(new Float32Array(count * 3), 3);
  const size = new InstancedBufferAttribute(new Float32Array(count), 1);
  const alpha = new InstancedBufferAttribute(new Float32Array(count), 1);
  const color = new InstancedBufferAttribute(new Float32Array(count * 3), 3);
  const seed = new InstancedBufferAttribute(new Float32Array(count), 1);
  const random = seeded(count + 31);
  const mote = { center: new Vector3(), color: new Color(), size: 0, alpha: 0 };
  for (let index = 0; index < count; index += 1) {
    fill(index, mote);
    center.setXYZ(index, mote.center.x, mote.center.y, mote.center.z);
    color.setXYZ(index, mote.color.r, mote.color.g, mote.color.b);
    size.setX(index, mote.size);
    alpha.setX(index, mote.alpha);
    seed.setX(index, random());
  }
  geometry.setAttribute("aCenter", center);
  geometry.setAttribute("aSize", size);
  geometry.setAttribute("aAlpha", alpha);
  geometry.setAttribute("aColor", color);
  geometry.setAttribute("aSeed", seed);
  geometry.instanceCount = count;
  const material = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: { uTime: time, uDrift: { value: drift } },
    vertexShader: `attribute vec3 aCenter; attribute float aSize; attribute float aAlpha; attribute vec3 aColor; attribute float aSeed;
      uniform float uTime, uDrift; varying vec2 vUv; varying float vA; varying vec3 vC;
      void main(){
        vec3 p = aCenter;
        p.x += sin(uTime * 0.21 + aSeed * 7.0) * 0.8 * uDrift; p.y += sin(uTime * 0.17 + aSeed * 11.0) * 0.6 * uDrift; p.z += cos(uTime * 0.13 + aSeed * 5.0) * 0.6 * uDrift;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        mv.xy += position.xy * aSize;
        gl_Position = projectionMatrix * mv;
        vUv = uv; vA = aAlpha * (0.6 + 0.4 * sin(uTime * 1.3 + aSeed * 20.0)); vC = aColor;
      }`,
    fragmentShader: `varying vec2 vUv; varying float vA; varying vec3 vC;
      void main(){ float a = smoothstep(0.5, 0.0, length(vUv - 0.5)) * vA; gl_FragColor = vec4(vC * a, a);
      #include <colorspace_fragment>
      }`,
  });
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  return { mesh, center, alpha, color };
}

/** The sky: a gradient drawn behind everything, centred on the camera wherever it goes. */
function skyOf(): Mesh<SphereGeometry, ShaderMaterial> {
  const sky = new Mesh(
    new SphereGeometry(1, 32, 16),
    new ShaderMaterial({
      side: BackSide,
      depthWrite: false,
      uniforms: {
        top: { value: new Color() },
        mid: { value: new Color() },
        bottom: { value: new Color() },
      },
      vertexShader:
        "varying vec3 vP; void main(){ vP = position; vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0); gl_Position = p.xyww; }",
      fragmentShader: `uniform vec3 top, mid, bottom; varying vec3 vP;
        void main(){ float h = normalize(vP).y; vec3 c = h > 0.0 ? mix(mid, top, smoothstep(0.0, 0.55, h)) : mix(mid, bottom, smoothstep(0.0, 0.3, -h)); gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
        }`,
    }),
  );
  sky.frustumCulled = false;
  sky.renderOrder = -1;
  return sky;
}

/** The terrarium's wooden frame, one merged mesh: its base, its two posts, and the two rails along its top. */
function frameOf(grain: Texture): Mesh {
  const { WIDTH, HALF, SLAB, GLASS_Z } = COLONY;
  const parts: BufferGeometry[] = [
    new RoundedBoxGeometry(WIDTH + 7, 4.2, SLAB + 4.4, 4, 0.9).translate(0, -56, -SLAB / 2),
  ];
  for (const side of [-1, 1]) {
    parts.push(
      new RoundedBoxGeometry(2.2, 73, SLAB + 3, 4, 0.7).translate(
        side * (HALF + 1.1),
        -21,
        -SLAB / 2,
      ),
    );
  }
  for (const z of [GLASS_Z + 0.5, -SLAB - 0.9]) {
    parts.push(new RoundedBoxGeometry(WIDTH + 4.4, 1.4, 1.4, 3, 0.55).translate(0, 14.8, z));
  }
  const map = woodTexture("#c48d55", "#6e3c19", 3);
  const frame = new Mesh(
    mergeGeometries(parts),
    new MeshStandardMaterial({
      map,
      roughness: 0.55,
      normalMap: grainOf(grain, 2, 2),
      normalScale: new Vector2(0.25, 0.25),
    }),
  );
  frame.castShadow = true;
  frame.receiveShadow = true;
  return frame;
}

/** The glass: a faint fresnel with a couple of soft diagonal streaks, front, back, and sides as one mesh. */
function glassOf(): Mesh {
  const { WIDTH, HALF, DEPTH, SLAB, GLASS_Z } = COLONY;
  const front = new PlaneGeometry(WIDTH, DEPTH + 15).translate(0, -DEPTH / 2 + 7.5, GLASS_Z);
  const back = new PlaneGeometry(WIDTH, 15).rotateY(Math.PI).translate(0, 7.5, -SLAB - 0.4);
  const sides = [-1, 1].map((side) =>
    new PlaneGeometry(SLAB + 0.8, 15)
      .rotateY((side * Math.PI) / 2)
      .translate(side * (HALF - 0.05), 7.5, -SLAB / 2),
  );
  const glass = new Mesh(
    mergeGeometries([front, back, ...sides]),
    new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uOpacity: { value: 1 } },
      vertexShader:
        "varying vec2 vUv; varying vec3 vW; varying vec3 vN; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * w; }",
      fragmentShader: `varying vec2 vUv; varying vec3 vW; varying vec3 vN; uniform float uOpacity;
        void main(){
          vec3 V = normalize(cameraPosition - vW); float f = pow(1.0 - abs(dot(V, vN)), 4.0);
          float s = vUv.x * 1.3 + vUv.y * 0.7;
          float b = exp(-pow((s - 0.42) * 28.0, 2.0)) * 0.14 + exp(-pow((s - 1.25) * 22.0, 2.0)) * 0.1;
          float edge = smoothstep(0.985, 1.0, max(abs(vUv.x - 0.5), abs(vUv.y - 0.5)) * 2.0);
          gl_FragColor = vec4(vec3(1.0, 0.99, 0.96), (0.025 + f * 0.35 + b * 0.075 + edge * 0.25) * uOpacity);
        }`,
    }),
  );
  glass.renderOrder = 10;
  return glass;
}

/** The soil's cut face: its painted strata, the burrows cut through its alpha, and their rims darkened. */
function faceOf(soil: SoilFace, grain: Texture): Mesh {
  const material = new MeshStandardMaterial({
    map: soil.texture,
    alphaTest: 0.5,
    roughness: 1,
    normalMap: grainOf(grain, 26, 11),
    normalScale: new Vector2(0.55, 0.55),
    shadowSide: DoubleSide,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uRims = { value: soil.rims };
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform sampler2D uRims;")
      .replace(
        "#include <map_fragment>",
        "#include <map_fragment>\nfloat rimShade = texture2D(uRims, vMapUv).r;\ndiffuseColor.rgb *= mix(0.45, 1.0, smoothstep(0.1, 0.9, rimShade));",
      );
  };
  material.customProgramCacheKey = () => "colony-face";
  const face = new Mesh(new PlaneGeometry(COLONY.WIDTH, COLONY.DEPTH), material);
  face.position.set(0, -COLONY.DEPTH / 2, 0);
  face.castShadow = true;
  face.receiveShadow = true;
  return face;
}

/** The slab's sides and back, one mesh, and the dark behind them. */
function slabOf(grain: Texture): Mesh[] {
  const { WIDTH, HALF, DEPTH, SLAB } = COLONY;
  const sides = [-1, 1].map((side) =>
    new PlaneGeometry(SLAB, DEPTH)
      .rotateY((side * Math.PI) / 2)
      .translate(side * HALF, -DEPTH / 2, -SLAB / 2),
  );
  const back = new PlaneGeometry(WIDTH, DEPTH).rotateY(Math.PI).translate(0, -DEPTH / 2, -SLAB);
  const walls = new Mesh(
    mergeGeometries([...sides, back]),
    new MeshStandardMaterial({
      color: "#6b4530",
      roughness: 1,
      normalMap: grainOf(grain, 6, 10),
      normalScale: new Vector2(0.5, 0.5),
      shadowSide: DoubleSide,
    }),
  );
  walls.castShadow = true;
  const inner = new Mesh(
    new PlaneGeometry(WIDTH, DEPTH),
    new MeshBasicMaterial({ color: "#2a1910" }),
  );
  inner.position.set(0, -DEPTH / 2, -SLAB + 0.05);
  return [walls, inner];
}

/** A grass blade's material: shaded darker at its root and swaying in the wind by `time`. */
function grassMaterial(time: { value: number }): MeshStandardMaterial {
  const material = new MeshStandardMaterial({ roughness: 0.75, side: DoubleSide });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uTime;\nvarying float vH;")
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        vH = position.y;
        vec2 wp = vec2(instanceMatrix[3].x, instanceMatrix[3].z);
        float w = sin(uTime * 1.6 + wp.x * 0.16 + wp.y * 0.3) * 0.22 + sin(uTime * 3.4 + wp.x * 0.7) * 0.05;
        transformed.x += w * vH * vH; transformed.z += w * 0.5 * vH * vH;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vH;")
      .replace(
        "#include <color_fragment>",
        "#include <color_fragment>\ndiffuseColor.rgb *= mix(0.42, 1.18, vH);",
      );
  };
  material.customProgramCacheKey = () => "colony-grass";
  return material;
}

/** How much the meadow at (x, z) keeps its grass: none on the trail, a shaft's mouth, or an anthill, and thinner around one. */
function bareOf(burrows: Burrows, x: number, z: number): number {
  if (Math.abs(z - COLONY.TRAIL_Z - Math.sin(x * 0.2) * 0.15) < 1.05) return 1;
  for (const bore of burrows.bores)
    if (bore.top === 0 && Math.abs(x - bore.x) < 1.4 && z > -1.6) return 1;
  let bare = 0;
  for (const chamber of burrows.chambers) {
    const mound = chamber.mound;
    if (mound === undefined) continue;
    const dx = (x - mound.x) / (mound.r + 0.3);
    const dz = (z - mound.z) / (mound.rz + 0.3);
    if (dx * dx + dz * dz < 1) return 1;
    const ex = (x - mound.x) / (mound.r + 3.2);
    const ez = (z - mound.z) / (mound.rz + 3.2);
    if (ex * ex + ez * ez < 1) bare = 0.88;
  }
  return bare;
}

/** A butterfly's wing: a forewing and a hindwing, the root at the origin, reaching out along +x. */
function wingGeometry(grow: number): BufferGeometry {
  const scale = 1.4 / 128;
  const lobe = (cx: number, cy: number, rx: number, ry: number, turn: number) => {
    const curve = new EllipseCurve(
      cx * scale,
      cy * scale - 0.7,
      (rx + grow) * scale,
      (ry + grow) * scale,
      0,
      Math.PI * 2,
      false,
      turn,
    );
    return new ShapeGeometry(new Shape(curve.getPoints(28)));
  };
  return mergeGeometries([lobe(70, 46, 52, 40, -0.35), lobe(56, 96, 34, 26, 0.5)]).rotateX(
    Math.PI / 2,
  );
}

/* ----- Public ----- */

/** The room as built: what the world switches between light and dark, replants, and steps. */
export interface Room {
  readonly setDark: (dark: boolean) => void;
  readonly plant: (burrows: Burrows) => void;
  readonly step: (elapsed: number) => void;
}

/** Builds the room into `scene`, the face painted from `soil` and the meadow from `turf`. */
export function roomOf(
  scene: Scene,
  parts: { soil: SoilFace; turf: Turf; grain: Texture; time: { value: number } },
): Room {
  const { WIDTH, HALF, SLAB } = COLONY;
  const sky = skyOf();
  const fog = new Fog("#efe1c6", 190, 460);
  scene.fog = fog;
  const deskMaterial = new MeshStandardMaterial({
    map: woodTexture("#b98352", "#5c3418", 1),
    roughness: 0.62,
  });
  deskMaterial.map?.repeat.set(12, 8);
  const desk = new Mesh(new PlaneGeometry(900, 600), deskMaterial);
  desk.rotation.x = -Math.PI / 2;
  desk.position.set(0, -58.05, -40);
  desk.receiveShadow = true;

  const hemi = new HemisphereLight();
  const sun = new DirectionalLight();
  sun.position.set(-55, 95, 80);
  sun.target.position.set(0, -20, -6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, {
    left: -90,
    right: 90,
    top: 70,
    bottom: -70,
    near: 10,
    far: 400,
  });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  sun.shadow.radius = 3;
  // Note that the lamp casts no shadow: one shadow-casting light is the budget, and the sun has it.
  const lamp = new SpotLight("#fff0cf", 1.8, 0, 0.62, 0.7, 0);
  lamp.position.set(15, 120, 55);
  lamp.target.position.set(0, -8, -6);

  const meadowGeometry = new PlaneGeometry(WIDTH, SLAB)
    .rotateX(-Math.PI / 2)
    .translate(0, 0, -SLAB / 2);
  const meadow = new Mesh(
    meadowGeometry,
    new MeshStandardMaterial({
      map: parts.turf.texture,
      roughness: 1,
      normalMap: grainOf(parts.grain, 20, 3),
      normalScale: new Vector2(0.5, 0.5),
      shadowSide: DoubleSide,
    }),
  );
  meadow.receiveShadow = true;
  meadow.castShadow = true;

  const blade = new PlaneGeometry(0.16, 1, 1, 4).translate(0, 0.5, 0);
  const bladePositions = blade.getAttribute("position");
  for (let index = 0; index < bladePositions.count; index += 1) {
    bladePositions.setX(index, bladePositions.getX(index) * (1 - bladePositions.getY(index) * 0.9));
  }
  const grass = new InstancedMesh(blade, grassMaterial(parts.time), GRASS);
  grass.receiveShadow = true;
  grass.count = 0;

  const dustRandom = seeded(41);
  const dust = motesOf(220, parts.time, 1, (_, mote) => {
    mote.center.set(
      (dustRandom() * 2 - 1) * (HALF + 10),
      -50 + dustRandom() * 80,
      -18 + dustRandom() * 44,
    );
    mote.color.setRGB(1, 0.86, 0.62);
    mote.size = 0.12 + dustRandom() * 0.18;
    mote.alpha = 0.12 + dustRandom() * 0.18;
  });

  const wingFill = new InstancedMesh(
    wingGeometry(0),
    new MeshStandardMaterial({ side: DoubleSide, roughness: 0.7 }),
    10,
  );
  const wingEdge = new InstancedMesh(
    wingGeometry(3.5),
    new MeshStandardMaterial({ side: DoubleSide, roughness: 0.7 }),
    10,
  );
  const bodies = new InstancedMesh(
    new CapsuleGeometry(0.07, 0.8, 4, 8).rotateX(Math.PI / 2),
    new MeshStandardMaterial({ color: "#3a2a20" }),
    5,
  );
  wingFill.castShadow = true;
  const flutterRandom = seeded(53);
  const flutters = BUTTERFLY_WINGS.map(([fill, edge], index) => {
    for (const side of [0, 1]) {
      wingFill.setColorAt(index * 2 + side, new Color(fill));
      wingEdge.setColorAt(index * 2 + side, new Color(edge));
    }
    return {
      a: 0.04 + flutterRandom() * 0.04,
      b: 0.2 + flutterRandom() * 0.2,
      phase: flutterRandom() * 6,
      previous: new Vector3(),
    };
  });
  // Note that the edge sits a hair below the fill, so the border shows only round its rim.
  wingEdge.position.y = -0.01;

  scene.add(
    sky,
    desk,
    frameOf(parts.grain),
    glassOf(),
    faceOf(parts.soil, parts.grain),
    ...slabOf(parts.grain),
  );
  scene.add(meadow, grass, dust.mesh, wingFill, wingEdge, bodies);
  scene.add(hemi, sun, sun.target, lamp, lamp.target);

  const placing = new Object3D();
  const matrix = new Matrix4();
  const turn = new Quaternion();
  const flap = new Quaternion();
  const mirror = new Vector3();
  const spin = new Euler();
  const step = (elapsed: number) => {
    flutters.forEach((flutter, index) => {
      const k = elapsed * flutter.a + flutter.phase;
      const at = new Vector3(
        Math.sin(k * 1.3) * 55,
        5 + Math.sin(k * 3.1) * 3 + Math.sin(elapsed * flutter.b) * 1.5,
        -8 + Math.sin(k * 2.3) * 7,
      );
      const heading = Math.atan2(at.x - flutter.previous.x, at.z - flutter.previous.z);
      flutter.previous.copy(at);
      turn.setFromEuler(spin.set(0, heading, 0));
      const beat = 0.15 + Math.abs(Math.sin(elapsed * 11 + flutter.phase));
      for (const side of [0, 1]) {
        flap.setFromEuler(spin.set(0, 0, side === 0 ? beat : -beat));
        matrix.compose(at, turn.clone().multiply(flap), mirror.set(side === 0 ? 1 : -1, 1, 1));
        wingFill.setMatrixAt(index * 2 + side, matrix);
        wingEdge.setMatrixAt(index * 2 + side, matrix);
      }
      placing.position.copy(at);
      placing.quaternion.copy(turn);
      placing.updateMatrix();
      bodies.setMatrixAt(index, placing.matrix);
    });
    wingFill.instanceMatrix.needsUpdate = true;
    wingEdge.instanceMatrix.needsUpdate = true;
    bodies.instanceMatrix.needsUpdate = true;
  };
  step(0);

  return {
    setDark: (dark) => {
      const mood = dark ? MOOD.DARK : MOOD.LIGHT;
      sky.material.uniforms.top?.value.set(mood.sky[0]);
      sky.material.uniforms.mid?.value.set(mood.sky[1]);
      sky.material.uniforms.bottom?.value.set(mood.sky[2]);
      fog.color.set(mood.fog);
      scene.background = new Color(mood.fog);
      hemi.color.set(mood.hemi[0]);
      hemi.groundColor.set(mood.hemi[1]);
      hemi.intensity = mood.hemi[2];
      sun.color.set(mood.sun[0]);
      sun.intensity = mood.sun[1];
      lamp.color.set(mood.lamp[0]);
      lamp.intensity = mood.lamp[1];
      deskMaterial.color.set(mood.desk);
    },
    plant: (burrows) => {
      parts.turf.paint(burrows);
      const random = seeded(61);
      const rand = (low: number, high: number) => low + (high - low) * random();
      const tint = new Color();
      let count = 0;
      for (let tries = 0; tries < 26000 && count < GRASS; tries += 1) {
        const x = rand(-HALF + 0.3, HALF - 0.3);
        const z = rand(-SLAB + 0.3, -0.05);
        const bare = bareOf(burrows, x, z);
        if (bare === 1 || random() < bare) continue;
        const height = rand(0.55, 1.35) * (0.75 + 0.6 * vnoise(x * 0.15, z * 0.3));
        placing.position.set(x, 0, z);
        placing.rotation.set(rand(-0.15, 0.15), rand(0, Math.PI), rand(-0.2, 0.2));
        placing.scale.set(rand(0.8, 1.3), height, 1);
        placing.updateMatrix();
        grass.setMatrixAt(count, placing.matrix);
        grass.setColorAt(count, tint.setHSL(rand(0.2, 0.27), rand(0.4, 0.6), rand(0.32, 0.48)));
        count += 1;
      }
      grass.count = count;
      grass.instanceMatrix.needsUpdate = true;
      if (grass.instanceColor !== null) grass.instanceColor.needsUpdate = true;
    },
    step,
  };
}
