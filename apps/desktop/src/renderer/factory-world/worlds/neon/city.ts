import { ZONE_LAYER } from "@luke/ui/factory-world";
import {
  AdditiveBlending,
  BackSide,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DataTexture,
  DoubleSide,
  DynamicDrawUsage,
  EdgesGeometry,
  Group,
  IcosahedronGeometry,
  InstancedBufferAttribute,
  InstancedMesh,
  LinearFilter,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Points,
  RGBAFormat,
  RingGeometry,
  type Scene,
  ShaderMaterial,
  SphereGeometry,
  TorusGeometry,
  UnsignedByteType,
  Vector3,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { WorldPalette } from "../../world";
import {
  COMMON_GLSL,
  OUTPUT_GLSL,
  type SharedUniforms,
  ZONE_ROW,
  ZONE_STATE_GLSL,
  zoneTexel,
} from "./glsl";
import {
  BUILDING_BOUNDS,
  BUILDING_STYLE,
  type Building,
  CITY,
  type CityLayout,
  seededRandom,
  unitHash,
} from "./layout";

/**
 * city.ts -- the Neon Megacity itself: the storm sky, the wet streets and their ring roads, every district's towers and the filler city and sprawl around them, the data core under the plaza, and the city's ambient life of traffic, rain, a blimp, and searchlights.
 *
 * The towers are two instanced meshes on one shader, the districts' and the
 * fillers', so the whole skyline is two draw calls. Each tower reads its
 * zone's row of the state texture (`glsl.ts`): its trim and windows glow the
 * shipped colour as the zone is alive with merges, a damaged zone glitches
 * and cracks, the selected agent's blast radius outlines it and sweeps up
 * it, and a hovered or selected zone outlines in the selection colour.
 *
 * The streets are wet without a second render of the scene: a small light
 * map painted on each redraw holds the pools of light each district casts,
 * and the street shader streaks it away from the camera as a reflection
 * would. There is no bloom pass either; the glow comes from emissive colour
 * over one, additive halos, and the fog.
 */

/** The night's horizon, in linear light: the colour the fog fades to. */
const NIGHT_FOG = new Color(0.032, 0.017, 0.052);

/** How far the street light map reaches either side of the centre. */
const LIGHT_EXTENT = 320;

/** The street light map's texels a side. */
const LIGHT_TEXELS = 128;

/** The most holographic billboards the surface districts wear between them. */
const BILLBOARD_BOUND = 600;

/** The most aircraft warning lights the skyline carries. */
const WARNING_BOUND = 4000;

/** How many cars and spinners ride the ring roads and circle the sky. */
const TRAFFIC = 480;

/** How many raindrops fall around the camera. */
const RAINDROPS = 12_000;

/** A cone of light fading towards its far end, or by a formula of its own over `f` (facing) and `vUv`. */
function lightMaterial(
  uniforms: SharedUniforms,
  color: string,
  amp: number,
  alpha = "f * pow(1.0 - vUv.y, 1.4)",
): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { ...uniforms, uColor: { value: new Color(color) }, uAmp: { value: amp } },
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
    vertexShader: /* glsl */ `varying vec2 vUv; varying vec3 vN; varying vec3 vW; varying float vDist;
      void main(){ vUv = uv; vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz;
        vec4 mv = viewMatrix * w; vDist = -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `${COMMON_GLSL}
      uniform vec3 uColor; uniform float uAmp, uTime; varying vec2 vUv; varying vec3 vN; varying vec3 vW; varying float vDist;
      void main(){ vec3 V = normalize(cameraPosition - vW); float f = pow(abs(dot(normalize(vN), V)), 1.6);
        float a = ${alpha};
        gl_FragColor = vec4(uColor * a * uAmp * (1.0 - fogF(vDist) * 0.7), 1.0);
        ${OUTPUT_GLSL} }`,
  });
}

/** The storm sky: a gradient from the horizon's glow to the zenith, a drifting cloud deck that lightning lights, and stars between the clouds at night. */
function skyOf(uniforms: SharedUniforms) {
  const flash = { value: 0 };
  const material = new ShaderMaterial({
    uniforms: { ...uniforms, uFlash: flash },
    side: BackSide,
    depthWrite: false,
    vertexShader: /* glsl */ `varying vec3 vDir; void main(){ vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`,
    fragmentShader: /* glsl */ `${COMMON_GLSL}
      uniform float uTime, uFlash, uDay; varying vec3 vDir;
      void main(){
        vec3 d = normalize(vDir); float h = d.y;
        vec3 zen = mix(vec3(0.003, 0.002, 0.01), vec3(0.24, 0.25, 0.4), uDay);
        vec3 mid = mix(vec3(0.018, 0.009, 0.038), vec3(0.5, 0.48, 0.6), uDay);
        vec3 hor = mix(vec3(0.075, 0.024, 0.08), uFogColor, uDay);
        vec3 col = mix(hor, mid, smoothstep(-0.02, 0.2, h));
        col = mix(col, zen, smoothstep(0.2, 0.75, h));
        col += vec3(0.5, 0.13, 0.06) * exp(-max(h, 0.0) * 30.0) * 0.3 * (1.0 - uDay * 0.6);
        if (h > 0.0) {
          vec2 uv = d.xz / (h + 0.12) * 1.3 + vec2(uTime * 0.012, uTime * 0.005);
          float c = fbm(uv * 0.55) * 0.75 + fbm(uv * 1.7 + 3.0) * 0.35;
          float cov = smoothstep(0.38, 0.9, c);
          vec3 cc = mix(vec3(0.33, 0.08, 0.22), vec3(0.06, 0.025, 0.09), smoothstep(0.0, 0.45, h));
          cc = mix(cc, mix(vec3(0.62, 0.5, 0.6), vec3(0.42, 0.42, 0.55), smoothstep(0.0, 0.45, h)), uDay);
          cc *= 0.55 + 0.6 * (1.0 - c);
          cc += uFlash * vec3(0.55, 0.32, 0.8) * cov;
          col = mix(col, cc, cov * 0.88 * smoothstep(0.0, 0.06, h));
          float st = step(0.9965, h21(floor(d.xz / (h + 0.3) * 260.0))) * (1.0 - cov) * smoothstep(0.25, 0.6, h);
          col += vec3(0.7, 0.8, 1.0) * st * 0.6 * (1.0 - uDay);
        }
        gl_FragColor = vec4(col, 1.0);
        ${OUTPUT_GLSL}
      }`,
  });
  const sky = new Mesh(new SphereGeometry(2600, 48, 24), material);
  sky.renderOrder = -10;
  sky.frustumCulled = false;
  return { sky, flash };
}

/** The wet streets: asphalt, puddles, rain ripples, the ring roads and their lanes, the plaza's rings, and the city's light streaked across them. */
function groundOf(uniforms: SharedUniforms, roads: readonly [number, number, number]) {
  const data = new Uint8Array(LIGHT_TEXELS * LIGHT_TEXELS * 4);
  const lightMap = new DataTexture(data, LIGHT_TEXELS, LIGHT_TEXELS, RGBAFormat, UnsignedByteType);
  lightMap.magFilter = LinearFilter;
  lightMap.minFilter = LinearFilter;
  lightMap.needsUpdate = true;
  const material = new ShaderMaterial({
    uniforms: {
      ...uniforms,
      uLight: { value: lightMap },
      uExtent: { value: LIGHT_EXTENT },
      uRoads: { value: new Vector3(...roads) },
      uPlaza: { value: CITY.PLAZA },
    },
    vertexShader: /* glsl */ `varying vec3 vWorld; varying float vDist;
      void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; vec4 mv = viewMatrix * w; vDist = -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `${COMMON_GLSL}
      uniform sampler2D uLight; uniform float uTime, uExtent, uPlaza, uDay; uniform vec3 uRoads;
      varying vec3 vWorld; varying float vDist;
      vec2 ripple(vec2 p, float sc, float t){
        vec2 q = p * sc; vec2 c = floor(q); vec2 f = fract(q) - 0.5;
        vec2 o = vec2(h21(c), h21(c + 3.7)) - 0.5; vec2 d = f - o * 0.5;
        float ph = fract(t * 0.85 + h21(c + 9.1)); float r = length(d);
        float w = exp(-pow((r - ph * 0.45) * 26.0, 2.0)) * (1.0 - ph);
        return normalize(d + 1e-4) * w;
      }
      float line(float d, float w){ return smoothstep(w, 0.0, abs(d)); }
      vec3 lightAt(vec2 p){ return texture2D(uLight, p / (2.0 * uExtent) + 0.5).rgb; }
      void main(){
        vec2 p = vWorld.xz; float rad = length(p);
        float puddle = smoothstep(0.47, 0.6, fbm(p * 0.03 + 3.0));
        vec2 rp = ripple(p, 0.8, uTime) + ripple(p + 17.0, 1.6, uTime * 1.3) * 0.7;
        vec2 dd = rp * 0.6 + (vec2(vnoise(p * 0.7), vnoise(p * 0.7 + 5.0)) - 0.5) * 0.8 * (1.0 - puddle);
        vec3 V = normalize(cameraPosition - vWorld);
        vec2 away = -normalize(V.xz + 1e-4);
        // Note that a light reflects in wet ground between itself and the eye, so its streak is sampled away from the camera.
        float stretch = mix(7.0, 3.0, puddle);
        vec3 refl = vec3(0.0); float ws = 0.0;
        for (int i = 0; i < 7; i++){ float fi = float(i); float w = exp(-fi * 0.32); refl += lightAt(p + dd + away * fi * stretch) * w; ws += w; }
        refl /= ws;
        float fres = 0.16 + 0.84 * pow(1.0 - max(V.y, 0.0), 3.5);
        vec3 asphalt = mix(vec3(0.011, 0.010, 0.017), vec3(0.05, 0.05, 0.06), uDay) * (0.6 + 0.8 * vnoise(p * 1.7));
        vec3 skyRefl = mix(vec3(0.06, 0.02, 0.07), uFogColor * 0.55, uDay);
        vec3 col = asphalt + (refl * 3.4 + skyRefl) * fres * mix(0.5, 1.0, puddle) + lightAt(p) * 0.15;
        float road = 0.0, lane = 0.0, curb = 0.0;
        float ang = atan(p.y, p.x);
        for (int k = 0; k < 3; k++){
          float R = uRoads[k]; float dr = rad - R;
          road += smoothstep(5.0, 4.2, abs(dr));
          lane += line(dr, 0.14) * step(0.5, fract(ang * R / 5.0));
          curb += line(abs(dr) - 4.4, 0.12);
        }
        col *= 1.0 - clamp(road, 0.0, 1.0) * 0.35;
        col += vec3(1.0, 0.55, 0.16) * lane * 0.55 + vec3(0.5, 0.75, 1.0) * curb * 0.35;
        if (rad < uPlaza + 3.0) {
          float rings = line(fract(rad / 3.0 - uTime * 0.25) - 0.5, 0.06) * smoothstep(uPlaza + 3.0, 4.0, rad);
          float spokes = line(fract(ang * 6.0 / 6.2832) - 0.5, 0.02) * step(6.0, rad);
          col += vec3(0.2, 0.95, 1.3) * (rings * 0.9 + spokes * 0.35) * smoothstep(uPlaza + 3.0, uPlaza - 3.0, rad);
        }
        col += vec3(0.35, 0.45, 0.7) * length(rp) * 0.09;
        gl_FragColor = vec4(applyFog(col, vDist, 0.0), 1.0);
        ${OUTPUT_GLSL}
      }`,
  });
  const ground = new Mesh(new CircleGeometry(1500, 96), material);
  ground.rotation.x = -Math.PI / 2;
  return {
    ground,
    light: { texture: lightMap, data, sums: new Float32Array(LIGHT_TEXELS * LIGHT_TEXELS * 3) },
  };
}

/** The tower shader every district and filler building is drawn with. */
function buildingMaterial(
  uniforms: SharedUniforms,
  zones: { value: DataTexture },
  palette: WorldPalette,
) {
  const signals = {
    uShipColor: { value: new Color(palette.signal.SHIPPED) },
    uBlastColor: { value: new Color(palette.signal.BLAST_RADIUS) },
    uSelectColor: { value: new Color(palette.signal.SELECTION) },
    uShipOn: { value: 1 },
    uGlitchOn: { value: 1 },
  };
  const material = new ShaderMaterial({
    uniforms: { ...uniforms, ...signals, uZones: zones },
    vertexShader: /* glsl */ `${ZONE_STATE_GLSL}
      attribute float aZone; attribute float aSeed; attribute float aStyle; attribute vec3 aAccent;
      uniform float uTime; uniform float uGlitchOn;
      varying float vShipFlash;
      varying vec3 vLocal; varying vec3 vScale; varying vec3 vN; varying vec3 vWN; varying vec3 vWorld;
      varying float vSeed; varying float vStyle; varying vec3 vAccent; varying vec4 vZA; varying vec4 vZB; varying float vDist;
      float hh(float n){ return fract(sin(n * 91.7) * 43758.5453); }
      void main(){
        vZA = zoneRow(aZone, ${ZONE_ROW.GLOW}); vZB = zoneRow(aZone, ${ZONE_ROW.BLAST}); vShipFlash = zoneRow(aZone, ${ZONE_ROW.FLASH}).x;
        vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
        float g = vZA.y * uGlitchOn;
        float jolt = step(0.94, hh(floor(uTime * 6.0) + aSeed * 13.0)) * g;
        float slice = step(0.5, hh(floor(position.y * 6.0) + floor(uTime * 20.0)));
        wp.x += (hh(floor(uTime * 30.0) + aSeed) - 0.5) * jolt * 2.2 * slice;
        wp.z += (hh(floor(uTime * 27.0) + aSeed * 3.0) - 0.5) * jolt * 1.2 * slice;
        vScale = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
        vLocal = position; vN = normal;
        vWN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
        vWorld = wp.xyz; vSeed = aSeed; vStyle = aStyle; vAccent = aAccent;
        vec4 mv = viewMatrix * wp; vDist = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `${COMMON_GLSL}
      uniform float uTime, uShipOn, uGlitchOn, uFocus, uDay; uniform vec3 uSelectColor, uBlastColor, uShipColor;
      varying float vShipFlash;
      varying vec3 vLocal; varying vec3 vScale; varying vec3 vN; varying vec3 vWN; varying vec3 vWorld;
      varying float vSeed; varying float vStyle; varying vec3 vAccent; varying vec4 vZA; varying vec4 vZB; varying float vDist;
      void main(){
        vec3 n = vN; float H = vScale.y;
        float st = vStyle;
        float isFill = step(st, 0.5) + step(4.5, st);
        float isSprawl = step(4.5, st);
        float isArc = step(1.5, st) * step(st, 2.5);
        float isCore = isArc + step(3.5, st) * step(st, 4.5);
        float isSurf = step(2.5, st) * step(st, 3.5);
        float ship = vZA.x * uShipOn; float glitch = vZA.y * uGlitchOn;
        vec3 L = normalize(vec3(-0.35, 0.55, -0.6));
        float ndl = max(dot(vWN, L), 0.0);
        vec3 night = mix(vec3(0.010, 0.011, 0.022), vec3(0.03, 0.024, 0.055), vLocal.y) * mix(1.0, 0.55, isCore);
        vec3 day = mix(vec3(0.03, 0.03, 0.045), vec3(0.075, 0.07, 0.095), vLocal.y) * mix(1.0, 0.7, isCore);
        vec3 base = mix(night, day, uDay);
        vec3 col = base * (0.5 + 0.9 * ndl);
        vec3 V = normalize(cameraPosition - vWorld);
        float rim = pow(1.0 - max(dot(vWN, V), 0.0), 4.0);
        col += mix(vec3(0.11, 0.05, 0.2), uFogColor * 0.5, uDay) * rim * 0.6;
        vec2 fc = vec2(0.0, H); float span = 1.0; float face = 0.0; float edgeD;
        vec3 trimC = mix(vAccent, uShipColor * 1.6, clamp(ship * 1.3, 0.0, 0.9));
        if (n.y > 0.5) {
          vec2 rc = vec2((vLocal.x + 0.5) * vScale.x, (vLocal.z + 0.5) * vScale.z);
          edgeD = min(min(rc.x, vScale.x - rc.x), min(rc.y, vScale.z - rc.y));
          col = base * 1.2 + trimC * smoothstep(0.24, 0.0, edgeD) * mix(1.5, 0.12, isFill) * (1.0 + ship * 0.6);
          float vent = step(0.75, h21(floor(rc * 0.8) + vSeed * 9.0)) * (1.0 - isFill);
          col += vec3(0.02, 0.02, 0.035) * vent;
        } else {
          if (abs(n.x) > 0.5) { fc = vec2((vLocal.z + 0.5) * vScale.z, vLocal.y * H); span = vScale.z; face = n.x; }
          else { fc = vec2((vLocal.x + 0.5) * vScale.x, vLocal.y * H); span = vScale.x; face = 2.0 + n.z; }
          edgeD = min(min(fc.x, span - fc.x), H - fc.y);
          col += vec3(0.32, 0.07, 0.22) * exp(-fc.y * 0.25) * 0.16 * (1.0 - uDay);
          vec2 cs = mix(vec2(1.05, 1.4), vec2(0.72, 0.95), isCore);
          cs = mix(cs, vec2(1.6, 1.9), isSprawl);
          vec2 g = fc / cs; vec2 cid = floor(g); vec2 cf = fract(g);
          float r1 = h21(cid + vec2(face * 17.0, vSeed * 91.0));
          float r2 = h21(cid.yx + vec2(vSeed * 13.0, face * 5.0));
          float litFrac = isFill > 0.5 ? mix(0.13, 0.2, isSprawl) : (isCore > 0.5 ? 0.15 : (isSurf > 0.5 ? 0.42 : 0.28));
          litFrac = min(0.6, litFrac + ship * 0.12) * mix(1.0, 0.55, uDay);
          float slow = h21(cid + floor(uTime * 0.06 + r2 * 20.0));
          float lit = step(mix(r1, slow, 0.22), litFrac);
          float win = step(0.16, cf.x) * step(cf.x, 0.84) * step(0.24, cf.y) * step(cf.y, 0.8);
          vec3 warm = vec3(1.0, 0.6, 0.3), cool = vec3(0.55, 0.78, 1.0);
          vec3 wc = r2 < 0.45 ? warm : (r2 < 0.9 ? cool : vAccent);
          wc = mix(wc, mix(cool, vAccent, r2), isCore);
          float inten = (0.45 + 1.5 * r2 * r2) * (1.0 + ship * 0.3) * mix(1.0, 0.6, isFill) * (1.0 + isSprawl * 1.2);
          vec3 wcol = wc * inten * lit * win;
          vec3 avg = mix(warm, cool, 0.5) * litFrac * 0.28 * (1.0 + ship * 0.3) * mix(1.0, 0.6, isFill);
          float px = length(fwidth(g));
          col += mix(wcol, avg, smoothstep(0.3, 0.85, px));
          col += uFogColor * 0.12 * uDay * win * (1.0 - lit);
          float sweep = exp(-abs(fract(vLocal.y * 0.8 - uTime * 0.16 + vSeed) - 0.5) * 22.0);
          col += uShipColor * ship * sweep * win * 0.6;
          float flick = 1.0 - glitch * step(0.5, h11(floor(uTime * 14.0) + vSeed * 7.0));
          float trimTop = step(H - 0.32, fc.y) * (1.0 - isSprawl * 0.85);
          float trimEdge = smoothstep(0.14, 0.0, min(fc.x, span - fc.x)) * isSurf;
          float bandK = (1.0 - isFill) * (1.0 - isSurf) * step(0.965, fract(fc.y / 7.0));
          col += trimC * (trimTop * mix(1.9, 0.35, isFill) * (1.0 + ship * 0.6) + trimEdge * 0.8 + bandK * 0.4) * flick;
          if (isArc > 0.5) {
            float band = smoothstep(1.0, 0.0, abs(fc.x - span * 0.5));
            float flow = pow(fract(fc.y * 0.03 - uTime * 0.45 + vSeed), 6.0);
            col += vAccent * band * (0.45 + 4.0 * flow) * (0.85 + 0.15 * sin(uTime * 2.2 + vSeed * 6.0)) * flick;
            col += vAccent * smoothstep(0.12, 0.0, min(fc.x, span - fc.x)) * 0.6;
          }
        }
        if (glitch > 0.001) {
          float tq = floor(uTime * 9.0);
          float burst = smoothstep(0.3, 0.85, vnoise(vec2(uTime * 1.6, vSeed * 10.0)));
          float gi = glitch * (0.5 + 0.5 * burst);
          vec2 blk = floor(vec2(fc.x * 0.45, fc.y * 0.2) + vec2(h21(vec2(floor(fc.y * 0.5), tq)) * 3.0, 0.0));
          float hb = h21(blk + tq * 0.37 + vSeed);
          float corrupt = step(hb, gi * 0.22);
          vec3 gcol = mix(vec3(3.6, 0.12, 0.25), vec3(0.15, 2.2, 2.8), step(0.82, h21(blk + 11.0 + tq)));
          col = mix(col, gcol * (0.35 + h21(blk + tq * 1.3)), corrupt);
          col *= 1.0 - step(h21(blk * 1.7 + tq), gi * 0.22) * 0.9;
          float tear = step(1.0 - gi * 0.1, h21(vec2(floor(fc.y * 3.0), tq)));
          col += vec3(2.6, 0.1, 0.22) * tear;
          col = mix(col, col * vec3(1.5, 0.35, 0.45), gi * 0.55);
          // Note that a badly damaged zone cracks, so its damage reads in a still frame as well as a moving one.
          if (glitch > 0.55) {
            float cr = abs(fbm(fc * 0.09 + vSeed * 7.0) - 0.5);
            float region = smoothstep(0.42, 0.62, fbm(fc * 0.025 + vSeed * 3.0 + 4.0));
            float crack = smoothstep(0.035, 0.0, cr) * region * smoothstep(0.55, 1.0, glitch);
            col = mix(col, vec3(4.5, 0.25, 0.12) * (0.65 + 0.35 * sin(uTime * 5.0 + fc.y)), crack);
          }
          col += vec3(1.8, 0.1, 0.25) * vZA.w * glitch;
        }
        float lvl = vZB.x; float tt = uTime - vZB.y;
        float outline = 1.0 - smoothstep(0.0, clamp(fwidth(edgeD) * 2.5, 0.03, 0.35), edgeD);
        if (lvl > 0.0 && tt > 0.0) {
          float on = lvl * smoothstep(0.0, 0.3, tt);
          float wave = exp(-abs(fc.y - tt * 45.0) * 0.35) * exp(-tt * 0.4);
          col += uBlastColor * on * (outline * mix(1.8, 2.6, vZB.w) + mix(0.08, 0.3, vZB.w) + wave * 1.6 + 0.05 * sin(uTime * 4.0 - fc.y * 0.3));
        }
        if (vShipFlash > 0.0) {
          float rise = exp(-abs(vLocal.y - (1.0 - vShipFlash)) * 6.0);
          col += uShipColor * vShipFlash * (outline * 2.5 + rise * 1.2 + 0.15);
        }
        col += uSelectColor * vZB.z * (outline * 2.6 + 0.12);
        float involved = min(1.0, step(0.01, vZB.x) + vZB.z);
        col *= mix(1.0, 0.22, uFocus * (1.0 - involved));
        gl_FragColor = vec4(applyFog(col, vDist, vWorld.y), 1.0);
        ${OUTPUT_GLSL}
      }`,
  });
  return { material, signals };
}

/** An instanced mesh of `bound` towers on `material`, and how to write a list of buildings into it. */
function towerMesh(material: ShaderMaterial, bound: number) {
  const geometry = new BoxGeometry(1, 1, 1);
  geometry.translate(0, 0.5, 0);
  const mesh = new InstancedMesh(geometry, material, bound);
  const zone = new InstancedBufferAttribute(new Float32Array(bound), 1);
  const seed = new InstancedBufferAttribute(new Float32Array(bound), 1);
  const style = new InstancedBufferAttribute(new Float32Array(bound), 1);
  const accent = new InstancedBufferAttribute(new Float32Array(bound * 3), 3);
  geometry.setAttribute("aZone", zone);
  geometry.setAttribute("aSeed", seed);
  geometry.setAttribute("aStyle", style);
  geometry.setAttribute("aAccent", accent);
  mesh.frustumCulled = false;
  mesh.count = 0;
  const placing = new Object3D();
  const fillAccents = ["#ff3ad6", "#3df0ff", "#ffa23d", "#8a6bff", "#ff5f8f"].map((hex) =>
    new Color(hex).multiplyScalar(0.5),
  );
  const write = (list: readonly Building[], accentOf: (building: Building) => Color) => {
    const count = Math.min(bound, list.length);
    for (let index = 0; index < count; index += 1) {
      const building = list[index];
      if (building === undefined) continue;
      placing.position.set(building.x, 0, building.z);
      placing.rotation.set(0, building.rot, 0);
      placing.scale.set(building.w, building.h, building.d);
      placing.updateMatrix();
      mesh.setMatrixAt(index, placing.matrix);
      zone.setX(index, building.slot);
      seed.setX(index, building.seed);
      style.setX(index, building.style);
      const color =
        building.style === BUILDING_STYLE.FILL || building.style === BUILDING_STYLE.SPRAWL
          ? (fillAccents[Math.floor(building.seed * 97) % fillAccents.length] ?? accentOf(building))
          : accentOf(building);
      color.toArray(accent.array, index * 3);
    }
    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
    for (const attribute of [zone, seed, style, accent]) attribute.needsUpdate = true;
  };
  return { mesh, write };
}

/** Red aircraft warning lights blinking on every tall roof. */
function warningLightsOf(uniforms: SharedUniforms) {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new BufferAttribute(new Float32Array(WARNING_BOUND * 3), 3).setUsage(DynamicDrawUsage),
  );
  geometry.setAttribute("aSeed", new BufferAttribute(new Float32Array(WARNING_BOUND), 1));
  geometry.setDrawRange(0, 0);
  const points = new Points(
    geometry,
    new ShaderMaterial({
      uniforms: { ...uniforms },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      vertexShader: /* glsl */ `attribute float aSeed; uniform float uTime; varying float vB; varying float vD;
        void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vB = step(0.82, fract(uTime * 0.55 + aSeed)); vD = -mv.z; gl_PointSize = clamp(900.0 / -mv.z, 2.0, 9.0); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */ `${COMMON_GLSL} varying float vB; varying float vD; void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d);
        gl_FragColor = vec4(vec3(3.0, 0.15, 0.1) * a * (0.15 + vB) * (1.0 - fogF(vD) * 0.6), 1.0); ${OUTPUT_GLSL} }`,
    }),
  );
  points.frustumCulled = false;
  const write = (layout: CityLayout) => {
    const tall = [
      ...layout.buildings.filter(
        (building) =>
          building.h > 26 && (building.style !== BUILDING_STYLE.ARCOLOGY || building.site),
      ),
      ...layout.fillers.filter((building) => building.h > 50),
    ].slice(0, WARNING_BOUND);
    const position = geometry.getAttribute("position");
    const seed = geometry.getAttribute("aSeed");
    tall.forEach((building, index) => {
      position.setXYZ(index, building.x, building.h + 0.6, building.z);
      seed.setX(index, unitHash(`${building.x}:${building.z}`));
    });
    position.needsUpdate = true;
    seed.needsUpdate = true;
    geometry.setDrawRange(0, tall.length);
  };
  return { points, write };
}

/** Animated holographic billboards on the surface districts' towers: waveforms, glyph rain, rings, and bars, never words. */
function billboardsOf(
  uniforms: SharedUniforms,
  zones: { value: DataTexture },
  glitchOn: { value: number },
) {
  const geometry = new PlaneGeometry(1, 1);
  const seed = new InstancedBufferAttribute(new Float32Array(BILLBOARD_BOUND), 1);
  const zone = new InstancedBufferAttribute(new Float32Array(BILLBOARD_BOUND), 1);
  geometry.setAttribute("aSeed", seed);
  geometry.setAttribute("aZone", zone);
  const mesh = new InstancedMesh(
    geometry,
    new ShaderMaterial({
      uniforms: { ...uniforms, uZones: zones, uGlitchOn: glitchOn },
      side: DoubleSide,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      vertexShader: /* glsl */ `${ZONE_STATE_GLSL} attribute float aSeed; attribute float aZone;
        varying vec2 vUv; varying float vSeed; varying float vDist; varying vec4 vZA;
        void main(){ vUv = uv; vSeed = aSeed; vZA = zoneRow(aZone, ${ZONE_ROW.GLOW}); vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
          vec4 mv = viewMatrix * w; vDist = -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */ `${COMMON_GLSL}
        uniform float uTime, uGlitchOn, uFocus; varying vec2 vUv; varying float vSeed; varying float vDist; varying vec4 vZA;
        void main(){
          vec2 uv = vUv; float s = vSeed; float t = uTime;
          vec3 c1 = mix(vec3(0.75, 0.4, 1.0), vec3(0.45, 0.55, 1.0), step(0.5, fract(s * 7.0)));
          vec3 c2 = mix(vec3(0.9, 0.75, 1.0), vec3(0.55, 0.45, 1.0), step(0.5, fract(s * 13.0)));
          float kind = floor(fract(s * 3.7) * 4.0);
          float v = 0.0;
          if (kind < 1.0) {
            float x = uv.x * 18.0; float amp = 0.12 + 0.3 * abs(sin(floor(x) * 1.7 + t * 3.0 + s * 9.0)) * vnoise(vec2(floor(x), t * 2.0));
            v = step(abs(uv.y - 0.5), amp) * step(0.2, fract(x));
          } else if (kind < 2.0) {
            float speed = 2.0 + h11(floor(uv.x * 7.0)) * 4.0;
            vec2 g = vec2(floor(uv.x * 7.0), floor(uv.y * 14.0 + t * speed));
            v = step(0.45, h21(g + s)) * step(0.15, fract(uv.x * 7.0)) * step(0.2, fract(uv.y * 14.0 + t * speed));
          } else if (kind < 3.0) {
            float r = length(uv - 0.5); v = smoothstep(0.08, 0.0, abs(fract(r * 4.0 - t * 0.6) - 0.5) - 0.15) * step(r, 0.5);
          } else {
            v = step(0.5, fract(uv.y * 6.0 + t * 0.5 + uv.x * 0.6)) * 0.7 + step(0.9, fract(uv.x * 3.0 - t)) * 0.4;
          }
          vec3 col = mix(c1, c2, uv.y) * v * 0.9;
          float frame = step(min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y)), 0.035);
          col += c1 * frame * 0.8 + c1 * 0.05;
          col *= 0.75 + 0.25 * sin(uv.y * 160.0 + t * 12.0);
          float g = vZA.y * uGlitchOn;
          if (g > 0.0) { float b = step(1.0 - g * 0.6, h21(vec2(floor(uv.y * 9.0), floor(t * 11.0)) + s)); col = mix(col, vec3(3.0, 0.1, 0.2) * step(0.4, h21(uv * 30.0 + t)), b); col *= 1.0 - g * 0.6 * step(0.7, h11(floor(t * 6.0) + s)); }
          col *= 1.0 - uFocus * 0.7;
          gl_FragColor = vec4(col * (1.0 - fogF(vDist)), 1.0);
          ${OUTPUT_GLSL}
        }`,
    }),
    BILLBOARD_BOUND,
  );
  mesh.frustumCulled = false;
  mesh.count = 0;
  const placing = new Object3D();
  const write = (layout: CityLayout) => {
    let count = 0;
    for (const district of layout.districts) {
      if (district.zone.layer !== ZONE_LAYER.SURFACE) continue;
      const tall = district.buildings
        .filter((building) => building.h > 9)
        .sort((left, right) => right.h - left.h);
      const wanted = Math.min(tall.length, 2 + Math.round(district.r / 9));
      for (let k = 0; k < wanted && count < BILLBOARD_BOUND; k += 1) {
        const building = tall[(k * 3) % tall.length];
        if (building === undefined) continue;
        const path = district.zone.path;
        const side = Math.floor(unitHash(`${path}${k}`) * 4);
        const nx = [1, -1, 0, 0][side] ?? 0;
        const nz = [0, 0, 1, -1][side] ?? 0;
        const w = Math.min(building.w, building.d) * 0.7;
        const h = Math.min(building.h * 0.45, w * (1.4 + unitHash(`${path}h${k}`)));
        const y = building.h * (0.45 + 0.35 * unitHash(`${path}y${k}`));
        placing.position.set(
          building.x + nx * (building.w / 2 + 0.12),
          y,
          building.z + nz * (building.d / 2 + 0.12),
        );
        placing.rotation.set(0, Math.atan2(nx, nz), 0);
        placing.scale.set(w, h, 1);
        placing.updateMatrix();
        mesh.setMatrixAt(count, placing.matrix);
        seed.setX(count, unitHash(`${path}b${k}`));
        zone.setX(count, district.slot);
        count += 1;
      }
    }
    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
    seed.needsUpdate = true;
    zone.needsUpdate = true;
  };
  return { mesh, write };
}

/** The data core under the plaza: a turning icosahedron round a bright heart, two rings, a column of light into the clouds, and conduits pulsing out to every core district. */
function dataCoreOf(uniforms: SharedUniforms) {
  const core = new Group();
  const wire = new LineSegments(
    new EdgesGeometry(new IcosahedronGeometry(7.5, 1)),
    new LineBasicMaterial({
      color: new Color(0.4, 2.2, 2.8),
      transparent: true,
      blending: AdditiveBlending,
    }),
  );
  const heart = new Mesh(
    new IcosahedronGeometry(3.6, 3),
    lightMaterial(uniforms, "#5ff6ff", 1.6, "0.35 + pow(1.0 - f, 2.0) * 2.5"),
  );
  const inner = new Mesh(
    new TorusGeometry(10.5, 0.12, 6, 96),
    new MeshBasicMaterial({ color: new Color(0.3, 1.6, 2.2) }),
  );
  const outer = new Mesh(
    new TorusGeometry(12.5, 0.08, 6, 96),
    new MeshBasicMaterial({ color: new Color(1.8, 0.3, 1.6) }),
  );
  inner.rotation.x = Math.PI / 2;
  core.add(wire, heart, inner, outer);
  core.position.set(0, 11, 0);
  const column = new Mesh(
    new CylinderGeometry(2.5, 2.5, 900, 16, 1, true).translate(0, 450, 0),
    lightMaterial(uniforms, "#5ff6ff", 0.32),
  );
  const conduits = new Mesh(
    new BufferGeometry(),
    new ShaderMaterial({
      uniforms: { ...uniforms },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      vertexShader: /* glsl */ `varying vec2 vUv; varying float vDist; void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0); vDist = -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */ `${COMMON_GLSL} uniform float uTime; varying vec2 vUv; varying float vDist; void main(){
        float pulse = pow(fract(vUv.x * 4.0 - uTime * 0.8), 8.0); float edge = smoothstep(0.5, 0.2, abs(vUv.y - 0.5));
        gl_FragColor = vec4(vec3(0.2, 1.1, 1.5) * edge * (0.3 + pulse * 2.5) * (1.0 - fogF(vDist)), 1.0); ${OUTPUT_GLSL} }`,
    }),
  );
  conduits.position.y = 0.1;
  const write = (layout: CityLayout) => {
    const pieces = layout.districts
      .filter((district) => district.zone.layer === ZONE_LAYER.CORE)
      .map((district) => {
        const length = Math.max(1, Math.hypot(district.x, district.z) - district.r * 0.6);
        const piece = new PlaneGeometry(length, 0.7, 64, 1);
        piece.translate(length / 2, 0, 0);
        piece.rotateX(-Math.PI / 2);
        piece.rotateY(-Math.atan2(district.z, district.x));
        return piece;
      });
    conduits.geometry.dispose();
    conduits.geometry =
      pieces.length > 0 ? (mergeGeometries(pieces) ?? new BufferGeometry()) : new BufferGeometry();
    for (const piece of pieces) piece.dispose();
  };
  const frame = (t: number) => {
    wire.rotation.set(t * 0.13, t * 0.21, 0);
    inner.rotation.z = t * 0.5;
    outer.rotation.set(Math.PI / 2 + Math.sin(t * 0.3) * 0.4, t * 0.3, 0);
    core.position.y = 11 + Math.sin(t * 0.8) * 0.6;
  };
  return { objects: [core, column, conduits], write, frame };
}

/** Two searchlights sweeping up from the tallest crowns into the cloud deck. */
function searchlightsOf(uniforms: SharedUniforms) {
  const lights = ["#9fe9ff", "#d0b8ff"].map((color) => {
    const geometry = new CylinderGeometry(26, 0.6, 520, 24, 1, true);
    geometry.translate(0, 260, 0);
    const mesh = new Mesh(geometry, lightMaterial(uniforms, color, 0.05));
    mesh.rotation.order = "YXZ";
    mesh.visible = false;
    return { mesh, phase: 0, speed: 0.15 };
  });
  const write = (layout: CityLayout) => {
    const crowns = [...layout.districts]
      .sort(
        (left, right) => right.height - left.height || (left.zone.path < right.zone.path ? -1 : 1),
      )
      .slice(0, lights.length);
    lights.forEach((light, index) => {
      const crown = crowns[index];
      light.mesh.visible = crown !== undefined;
      if (crown === undefined) return;
      light.mesh.position.set(crown.x, crown.height * 1.02, crown.z);
      light.phase = unitHash(crown.zone.path) * 6.28;
      light.speed = 0.12 + unitHash(`${crown.zone.path}s`) * 0.1;
    });
  };
  const frame = (t: number) => {
    for (const light of lights) {
      light.mesh.rotation.set(0.38 + Math.sin(t * light.speed * 1.3 + light.phase) * 0.18, 0, 0);
      light.mesh.rotation.y = t * light.speed + light.phase;
    }
  };
  return { objects: lights.map((light) => light.mesh), write, frame };
}

/** Ground cars on the ring roads, and spinners circling the sky. */
function trafficOf(uniforms: SharedUniforms, roads: readonly [number, number, number]) {
  const random = seededRandom(20261017);
  const geometry = new BoxGeometry(1, 1, 1);
  const orbit = new Float32Array(TRAFFIC * 4);
  const kind = new Float32Array(TRAFFIC);
  for (let index = 0; index < TRAFFIC; index += 1) {
    const air = index % 3 === 0;
    if (air) {
      orbit.set(
        [
          40 + random() * 330,
          16 + random() * random() * 95,
          random() * 6.28,
          (random() < 0.5 ? -1 : 1) * (14 + random() * 18),
        ],
        index * 4,
      );
    } else {
      const road = roads[index % 3] ?? roads[0];
      const radius = road + (index % 2 ? 1.8 : -1.8) + (random() - 0.5) * 0.8;
      orbit.set(
        [radius, 0.35, random() * 6.28, (index % 2 ? 1 : -1) * (8 + random() * 6)],
        index * 4,
      );
    }
    kind[index] = air ? 1 : 0;
  }
  geometry.setAttribute("aOrb", new InstancedBufferAttribute(orbit, 4));
  geometry.setAttribute("aKind", new InstancedBufferAttribute(kind, 1));
  const mesh = new InstancedMesh(
    geometry,
    new ShaderMaterial({
      uniforms: { ...uniforms },
      vertexShader: /* glsl */ `attribute vec4 aOrb; attribute float aKind; uniform float uTime; varying vec3 vC; varying float vDist;
        void main(){ float R = aOrb.x, h = aOrb.y, sp = aOrb.w; float a = aOrb.z + uTime * sp / R;
          vec3 p = vec3(cos(a) * R, h + sin(uTime * 0.7 + aOrb.z * 5.0) * aKind * 1.5, sin(a) * R);
          vec3 fwd = normalize(vec3(-sin(a), 0.0, cos(a))) * sign(sp); vec3 side = normalize(cross(fwd, vec3(0.0, 1.0, 0.0))); vec3 up = vec3(0.0, 1.0, 0.0);
          vec3 lp = position * mix(vec3(0.7, 0.35, 1.6), vec3(0.6, 0.35, 1.9), aKind);
          vec3 w = p + side * lp.x + up * lp.y + fwd * lp.z;
          vC = position.z > 0.0 ? vec3(2.2, 2.3, 2.6) : vec3(2.6, 0.2, 0.25);
          if (aKind > 0.5 && position.z > 0.0) vC = mix(vec3(0.4, 2.0, 2.8), vec3(2.6, 0.5, 2.2), step(0.5, fract(aOrb.z * 3.0)));
          vec4 mv = viewMatrix * vec4(w, 1.0); vDist = -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */ `${COMMON_GLSL} varying vec3 vC; varying float vDist; void main(){ gl_FragColor = vec4(vC * (1.0 - fogF(vDist)), 1.0); ${OUTPUT_GLSL} }`,
    }),
    TRAFFIC,
  );
  mesh.frustumCulled = false;
  return mesh;
}

/** The advertising blimp, circling the domain ring and broadcasting a voice waveform. */
function blimpOf(uniforms: SharedUniforms) {
  const blimp = new Group();
  blimp.scale.setScalar(0.7);
  const hull = new MeshStandardMaterial({ color: 0x1a1d2a, metalness: 0.6, roughness: 0.45 });
  const body = new Mesh(
    mergeGeometries([
      new SphereGeometry(1, 32, 16).scale(26, 7.5, 7.5),
      new BoxGeometry(7, 8, 0.5).translate(-23, 3, 0),
    ]) ?? new BufferGeometry(),
    hull,
  );
  const screen = new ShaderMaterial({
    uniforms: { ...uniforms },
    side: DoubleSide,
    vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `${COMMON_GLSL} uniform float uTime; varying vec2 vUv; void main(){
      vec2 uv = vUv; float x = uv.x * 46.0; float bar = floor(x);
      float amp = 0.08 + 0.36 * pow(abs(sin(bar * 0.37 + uTime * 2.3) * sin(bar * 0.11 - uTime * 1.3)), 0.8) * (0.5 + 0.5 * vnoise(vec2(bar * 0.3, uTime * 3.0)));
      float v = step(abs(uv.y - 0.5), amp) * step(0.25, fract(x));
      vec3 c = mix(vec3(0.2, 1.0, 1.4), vec3(1.6, 0.25, 1.3), uv.x) * v * 2.0;
      c += vec3(0.6, 0.1, 0.5) * 0.08;
      c *= 0.8 + 0.2 * sin(uv.y * 200.0 + uTime * 20.0);
      gl_FragColor = vec4(c, 1.0); ${OUTPUT_GLSL} }`,
  });
  const screens = new Mesh(
    mergeGeometries([
      new PlaneGeometry(30, 7.5).translate(0, 0, 7.6),
      new PlaneGeometry(30, 7.5).rotateY(Math.PI).translate(0, 0, -7.6),
    ]) ?? new BufferGeometry(),
    screen,
  );
  const beacon = new Mesh(
    new SphereGeometry(0.5, 8, 8),
    new MeshBasicMaterial({ color: new Color(3, 0.2, 0.2) }),
  );
  beacon.position.set(26, 0, 0);
  blimp.add(body, screens, beacon);
  const orbit = CITY.RING_START + 1.5 * CITY.RING_WIDTH + 40;
  const frame = (t: number) => {
    const angle = t * 0.035;
    blimp.position.set(
      Math.cos(angle) * orbit,
      92 + Math.sin(t * 0.2) * 3,
      Math.sin(angle) * orbit,
    );
    blimp.rotation.y = -angle - Math.PI;
  };
  frame(0);
  return { blimp, frame };
}

/** Rain: streaks falling in a box that follows the camera. */
function rainOf(uniforms: SharedUniforms) {
  const random = seededRandom(7);
  const position = new Float32Array(RAINDROPS * 2 * 3);
  const seed = new Float32Array(RAINDROPS * 2 * 4);
  for (let index = 0; index < RAINDROPS; index += 1) {
    const drop = [random(), random(), random(), random()];
    seed.set(drop, index * 8);
    seed.set(drop, index * 8 + 4);
    position.set([0, 0, 0, 0, 1, 0], index * 6);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(position, 3));
  geometry.setAttribute("aS", new BufferAttribute(seed, 4));
  const centre = { value: new Vector3() };
  const rain = new LineSegments(
    geometry,
    new ShaderMaterial({
      uniforms: { ...uniforms, uCenter: centre, uBox: { value: 150 } },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      vertexShader: /* glsl */ `attribute vec4 aS; uniform vec3 uCenter; uniform float uBox, uTime; varying float vA;
        void main(){ float B = uBox; vec3 wind = vec3(0.22, -1.0, 0.08);
          float fallT = uTime * (55.0 + aS.w * 25.0) / B;
          vec3 p; p.x = (fract(aS.x - uCenter.x / B) - 0.5) * B; p.z = (fract(aS.z - uCenter.z / B) - 0.5) * B;
          float yy = fract(aS.y - fallT); p.y = yy * B * 0.8;
          p += vec3(uCenter.x, max(uCenter.y - B * 0.4, 0.0), uCenter.z);
          p -= wind * (1.0 - yy) * 8.0;
          p += normalize(wind) * position.y * (1.1 + aS.w);
          vA = 0.07 + aS.w * 0.08;
          vec4 mv = modelViewMatrix * vec4(p, 1.0); vA *= smoothstep(B * 0.9, 8.0, -mv.z) * step(0.0, p.y);
          gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */ `uniform float uDay; varying float vA; void main(){ gl_FragColor = vec4(mix(vec3(0.6, 0.72, 1.0), vec3(0.35, 0.4, 0.55), uDay) * vA, 1.0); ${OUTPUT_GLSL} }`,
    }),
  );
  rain.frustumCulled = false;
  return { rain, centre };
}

/** Each district's footprint on the street: a neon property line, and a ring that ripples out from it as the blast radius arrives. */
function plotsOf(bound: number) {
  const line = new RingGeometry(0.975, 1, 128);
  line.rotateX(-Math.PI / 2);
  const material = () =>
    new MeshBasicMaterial({ transparent: true, blending: AdditiveBlending, depthWrite: false });
  const plots = new InstancedMesh(line, material(), bound);
  const ripples = new InstancedMesh(line.clone(), material(), bound);
  for (const mesh of [plots, ripples]) {
    mesh.frustumCulled = false;
    mesh.count = 0;
    mesh.setColorAt(0, new Color());
  }
  plots.position.y = 0.06;
  ripples.position.y = 0.08;
  return { plots, ripples };
}

/** The street light map and the bytes behind it. */
export interface StreetLight {
  readonly texture: DataTexture;
  readonly data: Uint8Array;
  /** Scratch for a repaint: each texel's light before it is clamped into a byte. */
  readonly sums: Float32Array;
}

/** What the city answers its world with. */
export interface City {
  readonly towers: InstancedMesh;
  readonly plots: InstancedMesh;
  readonly ripples: InstancedMesh;
  readonly light: StreetLight;
  readonly signals: ReturnType<typeof buildingMaterial>["signals"];
  readonly flash: { value: number };
  /** Lays the city out anew: every tower, billboard, warning light, conduit, and searchlight. */
  readonly plan: (layout: CityLayout) => void;
  readonly frame: (t: number, camera: { position: Vector3 }, target: Vector3) => void;
  /** The night's horizon, or the day's smog. */
  readonly fogFor: (dark: boolean, ground: string) => Color;
}

/** Builds the city's scenery into `scene`, every part sized for the bounds and empty until `plan`. */
export function createCity(
  scene: Scene,
  uniforms: SharedUniforms,
  zones: { value: DataTexture },
  palette: WorldPalette,
): City {
  const roads = [
    CITY.RING_START + CITY.RING_WIDTH,
    CITY.RING_START + 2 * CITY.RING_WIDTH,
    CITY.RING_START + 3 * CITY.RING_WIDTH,
  ] as const;
  const { sky, flash } = skyOf(uniforms);
  const { ground, light } = groundOf(uniforms, roads);
  const { material, signals } = buildingMaterial(uniforms, zones, palette);
  const districts = towerMesh(material, BUILDING_BOUNDS.DISTRICT);
  const fillers = towerMesh(material, BUILDING_BOUNDS.FILLER);
  const warnings = warningLightsOf(uniforms);
  const billboards = billboardsOf(uniforms, zones, signals.uGlitchOn);
  const core = dataCoreOf(uniforms);
  const searchlights = searchlightsOf(uniforms);
  const traffic = trafficOf(uniforms, roads);
  const { blimp, frame: blimpFrame } = blimpOf(uniforms);
  const { rain, centre } = rainOf(uniforms);
  const { plots, ripples } = plotsOf(201);
  scene.add(
    sky,
    ground,
    districts.mesh,
    fillers.mesh,
    warnings.points,
    billboards.mesh,
    ...core.objects,
    ...searchlights.objects,
    traffic,
    blimp,
    rain,
    plots,
    ripples,
  );
  const dayFog = new Color();
  return {
    towers: districts.mesh,
    plots,
    ripples,
    light,
    signals,
    flash,
    plan: (layout) => {
      const accentBySlot = new Map(
        layout.districts.map((district) => [district.slot, district.accent]),
      );
      const fallback = new Color("#7f8db0");
      districts.write(layout.buildings, (building) => accentBySlot.get(building.slot) ?? fallback);
      fillers.write(layout.fillers, () => fallback);
      warnings.write(layout);
      billboards.write(layout);
      core.write(layout);
      searchlights.write(layout);
    },
    frame: (t, camera, target) => {
      core.frame(t);
      searchlights.frame(t);
      blimpFrame(t);
      centre.value.copy(camera.position).lerp(target, 0.35);
    },
    fogFor: (dark, groundColor) => (dark ? NIGHT_FOG : dayFog.set(groundColor)),
  };
}

/** Paints the street light map: a pool of each district's light, glowing the shipped colour as it is alive and the blast radius's as it ripples. */
export function paintStreetLight(
  { texture: lightMap, data, sums }: StreetLight,
  pools: readonly { x: number; z: number; r: number; color: Color }[],
): void {
  sums.fill(0);
  const texel = (2 * LIGHT_EXTENT) / LIGHT_TEXELS;
  for (const pool of pools) {
    const reach = pool.r * 1.7;
    const fromX = Math.max(0, Math.floor((pool.x - reach + LIGHT_EXTENT) / texel));
    const toX = Math.min(LIGHT_TEXELS - 1, Math.ceil((pool.x + reach + LIGHT_EXTENT) / texel));
    const fromZ = Math.max(0, Math.floor((pool.z - reach + LIGHT_EXTENT) / texel));
    const toZ = Math.min(LIGHT_TEXELS - 1, Math.ceil((pool.z + reach + LIGHT_EXTENT) / texel));
    for (let j = fromZ; j <= toZ; j += 1) {
      for (let i = fromX; i <= toX; i += 1) {
        const x = (i + 0.5) * texel - LIGHT_EXTENT;
        const z = (j + 0.5) * texel - LIGHT_EXTENT;
        const falloff = Math.exp(
          -((x - pool.x) ** 2 + (z - pool.z) ** 2) / (pool.r * pool.r * 0.9),
        );
        const at = (j * LIGHT_TEXELS + i) * 3;
        sums[at] = (sums[at] ?? 0) + pool.color.r * falloff;
        sums[at + 1] = (sums[at + 1] ?? 0) + pool.color.g * falloff;
        sums[at + 2] = (sums[at + 2] ?? 0) + pool.color.b * falloff;
      }
    }
  }
  for (let index = 0; index < LIGHT_TEXELS * LIGHT_TEXELS; index += 1) {
    for (let channel = 0; channel < 3; channel += 1) {
      data[index * 4 + channel] = Math.min(255, Math.round((sums[index * 3 + channel] ?? 0) * 255));
    }
    data[index * 4 + 3] = 255;
  }
  lightMap.needsUpdate = true;
}

/** Writes slot `slot`'s row `row` of the zone state texture's data. */
export function writeZoneRow(
  data: Float32Array,
  slot: number,
  row: number,
  values: readonly [number, number, number, number],
): void {
  data.set(values, zoneTexel(slot, row));
}
