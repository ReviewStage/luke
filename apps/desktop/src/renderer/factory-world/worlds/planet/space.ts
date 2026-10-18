import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  type Color,
  DirectionalLight,
  HemisphereLight,
  MathUtils,
  Mesh,
  type Object3D,
  type PerspectiveCamera,
  PlaneGeometry,
  PointLight,
  Points,
  ShaderMaterial,
  SphereGeometry,
  Vector2,
  Vector3,
  type WebGLRenderer,
} from "three";
import { GLSL_NOISE, GLSL_OUTPUT, glowMaterial, rng, type SharedUniforms } from "./kit";

/**
 * space.ts -- what the planet hangs in: the nebula and the stars behind it, the sun, and the lights it casts.
 *
 * The sky is a far sphere whose shader paints a faint nebula over the dark
 * ground, with a field of stars before it; in the window's light appearance
 * both give way to the light ground alone, since a star does not read on
 * it. The sun keeps its place against the camera, as the mockup's
 * establishing shot did, so whichever way the planet is turned the lit side
 * faces the viewer with the terminator and its city lights on the left: it
 * is re-aimed before every frame is drawn, from where the camera stands. It
 * is the one light that casts a shadow; a dim sky light and a hot light in
 * the cutaway fill the rest.
 */

/** How far the sky sphere stands, inside the camera's far plane. */
const SKY_RADIUS = 450;

/** How far the stars stand. */
const STAR_RADIUS = 400;

const STAR_COUNT = 7000;

/** The sun's height above the planet's equator, in radians. */
const SUN_ELEVATION = 0.32;

/** How far the sun stands round from the camera, in radians: to its left, so the terminator shows. */
const SUN_OFFSET = -1.18;

function stars(shared: SharedUniforms): Points {
  const draw = rng(9);
  const positions = new Float32Array(STAR_COUNT * 3);
  const sizes = new Float32Array(STAR_COUNT);
  const colours = new Float32Array(STAR_COUNT * 3);
  const direction = new Vector3();
  for (let star = 0; star < STAR_COUNT; star += 1) {
    direction.set(draw() * 2 - 1, draw() * 2 - 1, draw() * 2 - 1).normalize();
    direction.multiplyScalar(STAR_RADIUS).toArray(positions, star * 3);
    sizes[star] = 0.6 + draw() ** 6 * 4.2;
    const tint = draw();
    const tone = tint < 0.15 ? [1, 0.75, 0.55] : tint < 0.35 ? [0.7, 0.8, 1] : [0.95, 0.95, 1];
    const brightness = 0.35 + draw() * 0.9;
    colours.set(
      tone.map((value) => value * brightness),
      star * 3,
    );
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setAttribute("aSize", new BufferAttribute(sizes, 1));
  geometry.setAttribute("aCol", new BufferAttribute(colours, 3));
  return new Points(
    geometry,
    new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: shared,
      vertexShader: /* glsl */ `
        attribute float aSize; attribute vec3 aCol; uniform float uTime; uniform float uPixelRatio; varying vec3 vC;
        void main(){ vC = aCol * (0.75 + 0.25 * sin(uTime * 1.7 + position.x * 0.6 + position.y * 0.35));
          gl_PointSize = aSize * uPixelRatio * 1.4; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        varying vec3 vC;
        void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d);
          gl_FragColor = vec4(vC * a * a * 1.6, 1.0); ${GLSL_OUTPUT} }`,
    }),
  );
}

function nebula(shared: SharedUniforms, ground: Color): Mesh {
  const mesh = new Mesh(
    new SphereGeometry(SKY_RADIUS, 48, 32),
    new ShaderMaterial({
      side: BackSide,
      depthWrite: false,
      uniforms: { ...shared, uGround: { value: ground } },
      vertexShader: /* glsl */ `
        varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uGround; varying vec3 vD; ${GLSL_NOISE}
        void main(){
          vec3 d = normalize(vD);
          float n = fbm(d * 2.2 + 4.0), m = fbm(d * 4.5 + 11.0);
          float band = exp(-pow(dot(d, normalize(vec3(0.35, 1.0, 0.25))) * 3.2, 2.0));
          vec3 c = uGround * 0.6;
          c += vec3(0.07, 0.025, 0.11) * smoothstep(0.42, 0.8, n) * (0.4 + band);
          c += vec3(0.0, 0.05, 0.075) * smoothstep(0.5, 0.85, m) * (0.3 + band);
          c += vec3(0.035, 0.03, 0.05) * band * (0.4 + n);
          gl_FragColor = vec4(c, 1.0); ${GLSL_OUTPUT}
        }`,
    }),
  );
  mesh.renderOrder = -10;
  return mesh;
}

/** The sky, the sun, and the lights, re-aimed before each frame from the camera. */
export interface Space {
  readonly objects: readonly Object3D[];
  /** Dresses the sky for the window's appearance. */
  readonly appear: (dark: boolean) => void;
  /** Turns the sun to keep its place against the camera, and reads the screen the frame is drawn on. */
  readonly aim: (renderer: WebGLRenderer) => void;
}

export function createSpace(
  shared: SharedUniforms,
  camera: PerspectiveCamera,
  darkGround: Color,
): Space {
  const sky = nebula(shared, darkGround);
  const starField = stars(shared);
  const sunGlow = new Mesh(new PlaneGeometry(1, 1), glowMaterial(new Vector3(6, 5.2, 4.2), 90));
  sunGlow.frustumCulled = false;
  const sun = new DirectionalLight(0xfff0dc, 2.5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, {
    left: -14,
    right: 14,
    top: 14,
    bottom: -14,
    near: 1,
    far: 90,
  });
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.025;
  sun.shadow.radius = 4;
  const skyLight = new HemisphereLight(0x33447a, 0x0b0608, 0.42);
  const heat = new PointLight(0xff7a30, 26, 14, 1.4);
  heat.position.set(2.4, 1.3, 2.4);
  const buffer = new Vector2();
  return {
    objects: [sky, starField, sunGlow, sun, sun.target, skyLight, heat],
    appear: (dark) => {
      sky.visible = dark;
      starField.visible = dark;
      sunGlow.visible = dark;
    },
    aim: (renderer) => {
      const azimuth = Math.atan2(camera.position.x, camera.position.z) + SUN_OFFSET;
      const direction = shared.uSunDir.value
        .set(
          Math.sin(azimuth) * Math.cos(SUN_ELEVATION),
          Math.sin(SUN_ELEVATION),
          Math.cos(azimuth) * Math.cos(SUN_ELEVATION),
        )
        .normalize();
      sun.position.copy(direction).multiplyScalar(50);
      sun.target.position.set(0, 0, 0);
      sun.updateMatrixWorld();
      sun.target.updateMatrixWorld();
      sunGlow.position.copy(direction).multiplyScalar(STAR_RADIUS * 0.95);
      sunGlow.updateMatrixWorld();
      const pixelRatio = renderer.getPixelRatio();
      const height = renderer.getDrawingBufferSize(buffer).y / pixelRatio;
      shared.uPixelRatio.value = pixelRatio;
      shared.uProjection.value = height / (2 * Math.tan(MathUtils.degToRad(camera.fov / 2)));
    },
  };
}
