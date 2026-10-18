import type { WorldPalette } from "@luke/panel/factory-world/world";
import {
  Color,
  FogExp2,
  type IUniform,
  MeshStandardMaterial,
  type MeshStandardMaterialParameters,
  ShaderMaterial,
  type ShaderMaterialParameters,
} from "three";

/**
 * sea.ts -- the water every part of Atlantis is seen through: its fog, the caustic light it throws on whatever faces up, the clock its shaders share, and the two moods it is drawn in.
 *
 * Every material in the world is made here, so they all share one set of
 * uniforms: the time, the fog, the mood, the signal colours, and the blast
 * radius's ripple. A `ShaderMaterial` is handed the shared GLSL (`GLSL_SEA`)
 * and the shared uniforms; a lit `MeshStandardMaterial` is patched
 * (`standard`) so it keeps Three.js's lights, shadows, and fog while taking
 * the sea's caustics and whatever glow its part needs.
 *
 * The mood follows the window's appearance: the deep at night, a dark
 * teal abyss lit from the city itself, and the sunlit shallows by day, a
 * paler water the signals still stand out against.
 */

export const TAU = Math.PI * 2;

/** The water in each appearance: its fog, its sky, and how strongly the sun and the sky light the floor. */
export const MOOD = {
  /** The dark appearance: the deep. */
  DEEP: {
    fog: "#06283b",
    fogDensity: 0.0023,
    abyss: "#01060a",
    surface: "#12546b",
    sky: "#62c4f0",
    bed: "#06111a",
    skyLight: 0.62,
    sunLight: 1.55,
    sand: "#ffffff",
    vignette: 1,
    ink: [0.035, 0.012, 0.045],
    hologram: 0.2,
  },
  /** The light appearance: the sunlit shallows. */
  SHALLOWS: {
    fog: "#2f8aa0",
    fogDensity: 0.0019,
    abyss: "#0c3a4a",
    surface: "#9fe2ee",
    sky: "#b8f0ff",
    bed: "#2a4c55",
    skyLight: 1.15,
    sunLight: 2.3,
    sand: "#ffe9c8",
    vignette: 0.55,
    ink: [0.16, 0.1, 0.2],
    hologram: 0.55,
  },
} as const;

export type Mood = (typeof MOOD)[keyof typeof MOOD];

/** Noise, the caustic net, and the fog, which every shader of the world includes. */
const GLSL_SEA = /* glsl */ `
uniform float uTime;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform float uMotion;
uniform float uRippleAt;
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*0.1031); p3 += dot(p3, p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
vec2 hash22(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*vec3(.1031,.1030,.0973)); p3 += dot(p3, p3.yzx+33.33); return fract((p3.xx+p3.yz)*p3.zy); }
float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.-2.*f);
  return mix(mix(hash12(i),hash12(i+vec2(1,0)),u.x), mix(hash12(i+vec2(0,1)),hash12(i+vec2(1,1)),u.x), u.y); }
float fbm2(vec2 p){ float s=0., a=.5; for(int i=0;i<4;i++){ s+=a*vnoise(p); p*=2.03; a*=.5; } return s; }
float causticAt(vec2 uv, float time){
  vec2 p = uv*6.28318 - 250.0;
  vec2 i = p; float c = 1.0; float inten = 0.005;
  for (int n = 0; n < 4; n++) {
    float t = time * (1.0 - (3.5 / float(n+1)));
    i = p + vec2(cos(t - i.x) + sin(t + i.y), sin(t - i.y) + cos(t + i.x));
    c += 1.0/length(vec2(p.x / (sin(i.x+t)/inten), p.y / (cos(i.y+t)/inten)));
  }
  c /= 4.0; c = 1.17 - pow(c, 1.4);
  return clamp(pow(abs(c), 8.0), 0.0, 2.0);
}
float caustic(vec3 w, float t){ vec2 q = w.xz*0.032 + w.y*0.004 + vec2(vnoise(w.xz*0.011), vnoise(w.xz*0.011 + 7.3))*1.6; return causticAt(q, t) * (0.45 + 0.9*vnoise(w.xz*0.015 + t*0.02)); }
float fogF(float d){ float x = uFogDensity*d; return 1.0 - exp(-x*x); }
// The blast radius's ripple at a zone some steps out, which runs only while motion does.
float ripple(float steps){
  if (steps < 0.0) return 0.0;
  float since = uTime - uRippleAt - steps*0.45;
  return since > 0.0 ? exp(-mod(since, 1.6)*2.4) * uMotion : 0.0;
}
`;

/** What a lit material takes from the sea beyond Three.js's own lighting. */
interface StandardPatch {
  /** How strongly the caustic net lights what faces up. */
  readonly caustic?: number;
  /** Reads a per-instance `aGlow` into `vGlow`. */
  readonly glow?: boolean;
  /** Lit windows on the walls, more of them as `vGlow` rises. */
  readonly windows?: boolean;
  /** Sand ripples on the floor. */
  readonly ripples?: boolean;
  /** The shipped signal's glow, by `vGlow`. */
  readonly shipGlow?: boolean;
  /** Emissive from its own colour, by `vGlow`. */
  readonly glowFromColor?: number;
  /** A per-vertex `aLit` that makes that part of the geometry shine its own colour. */
  readonly lit?: boolean;
  /** A fish's tail wiggle, by a per-instance `aPhase`. */
  readonly fish?: boolean;
  /** The kraken's skin: a defect's rim light and glowing spots. */
  readonly kraken?: boolean;
  /** A tentacle's sway and suckers, this strong, by per-vertex `aU` and `aPh`. */
  readonly tentacle?: number;
}

/** The uniforms every material of the world shares. */
interface SeaUniforms {
  readonly uTime: IUniform<number>;
  readonly uFogColor: IUniform<Color>;
  readonly uFogDensity: IUniform<number>;
  /** 1 while motion runs, 0 held still. */
  readonly uMotion: IUniform<number>;
  /** When the selected agent's ripple set out, in the world's own seconds. */
  readonly uRippleAt: IUniform<number>;
  /** How strongly the kraken's free tentacles sway. */
  readonly uKrakenSway: IUniform<number>;
  readonly uShipped: IUniform<Color>;
  readonly uDefect: IUniform<Color>;
}

/** The sea as the world's parts draw through it. */
export interface Sea {
  readonly uniforms: SeaUniforms;
  readonly fog: FogExp2;
  readonly signal: WorldPalette["signal"];
  /** A shader on the sea's uniforms and its GLSL, which every fragment shader may call. */
  readonly shader: (
    uniforms: Record<string, IUniform>,
    vertexShader: string,
    fragmentShader: string,
    parameters?: ShaderMaterialParameters,
  ) => ShaderMaterial;
  /** A lit material patched with the sea's light and `patch`. */
  readonly standard: (
    parameters: MeshStandardMaterialParameters,
    patch?: StandardPatch,
  ) => MeshStandardMaterial;
  /** Moves the water into `mood`. */
  readonly enter: (mood: Mood) => void;
  /** The mood the water is in. */
  readonly mood: () => Mood;
}

const WINDOWS_GLSL = /* glsl */ `
vec3 windowGlow(vec3 w, vec3 n, float g){
  if (abs(n.y) > 0.5 || w.y < 0.9) return vec3(0.);
  float u = (abs(n.x) > abs(n.z)) ? w.z : w.x;
  vec2 gp = vec2(u*1.15, w.y*1.5);
  vec2 c = floor(gp); vec2 f = fract(gp);
  float win = step(0.2,f.x)*step(f.x,0.8)*step(0.28,f.y)*step(f.y,0.72);
  float r = hash12(c + floor(w.xz*0.08)*17.0);
  float lit = step(r, clamp(0.2 + 0.4*g, 0.0, 0.92));
  vec3 col = mix(vec3(1.0,0.8,0.55), uShipped*1.6, step(0.9 - g*0.35, hash12(c+3.1)));
  float flick = 0.85 + 0.15*sin(uTime*2.0 + r*40.0);
  return col * win * lit * (0.4 + 0.45*g) * flick;
}
`;

/** Patches `material` so it lights by the sea as `patch` asks. */
function patched(
  material: MeshStandardMaterial,
  uniforms: SeaUniforms,
  patch: StandardPatch,
): MeshStandardMaterial {
  const caustic = (patch.caustic ?? 1).toFixed(2);
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    let vertexHead = "varying vec3 vW; varying vec3 vWN;\n";
    let vertexBody = "";
    if (patch.glow === true) {
      vertexHead += "attribute float aGlow; varying float vGlow;\n";
      vertexBody += "vGlow = aGlow;\n";
    }
    if (patch.lit === true) {
      vertexHead += "attribute float aLit; varying float vLit;\n";
      vertexBody += "vLit = aLit;\n";
    }
    if (patch.fish === true) vertexHead += "attribute float aPhase;\n";
    if (patch.tentacle !== undefined) {
      vertexHead +=
        "uniform float uKrakenSway; attribute float aU; attribute float aPh; varying float vU; varying vec2 vTUv;\n";
    }
    let begin = "#include <begin_vertex>\n";
    if (patch.fish === true) {
      begin +=
        "transformed.x += sin(uTime*9.0 + aPhase + position.z*3.2) * 0.22 * smoothstep(0.3,-1.2,position.z);\n";
    }
    if (patch.tentacle !== undefined) {
      begin += `float tu = pow(aU, 1.5);
transformed += vec3(sin(uTime*0.7+aU*5.0+aPh), sin(uTime*0.55+aU*4.0+aPh*1.3)*0.7, cos(uTime*0.62+aU*6.0+aPh))*tu*${patch.tentacle.toFixed(2)}*uKrakenSway;
vU = aU; vTUv = uv;\n`;
    }
    vertexBody += `vec4 pw = vec4(transformed,1.0);
#ifdef USE_INSTANCING
pw = instanceMatrix*pw;
#endif
vW = (modelMatrix*pw).xyz;
vec3 nw = objectNormal;
#ifdef USE_INSTANCING
nw = mat3(instanceMatrix)*nw;
#endif
vWN = normalize(mat3(modelMatrix)*nw);\n`;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${GLSL_SEA}${vertexHead}`)
      .replace("#include <begin_vertex>", begin)
      .replace("#include <fog_vertex>", `#include <fog_vertex>\n${vertexBody}`);
    let fragmentHead = `${GLSL_SEA}uniform vec3 uShipped; uniform vec3 uDefect; varying vec3 vW; varying vec3 vWN;\n`;
    if (patch.glow === true) fragmentHead += "varying float vGlow;\n";
    if (patch.lit === true) fragmentHead += "varying float vLit;\n";
    if (patch.tentacle !== undefined) fragmentHead += "varying float vU; varying vec2 vTUv;\n";
    if (patch.windows === true) fragmentHead += WINDOWS_GLSL;
    let emissive = "";
    if (patch.windows === true)
      emissive += "totalEmissiveRadiance += windowGlow(vW, vWN, vGlow);\n";
    if (patch.ripples === true) {
      emissive +=
        "{ float rp = dot(vW.xz, vec2(0.82,0.57))*1.6 + vnoise(vW.xz*0.06)*7.0; float ra = clamp(1.0 - fwidth(rp)*0.9, 0.0, 1.0); diffuseColor.rgb *= 1.0 + ra*(0.14*sin(rp) + 0.1*(vnoise(vW.xz*0.7)-0.5)); }\n";
    }
    if (patch.shipGlow === true) {
      emissive +=
        "totalEmissiveRadiance += uShipped*1.4 * vGlow * (0.25 + dot(diffuseColor.rgb, vec3(0.5)));\n";
    }
    if (patch.glowFromColor !== undefined) {
      emissive += `totalEmissiveRadiance += diffuseColor.rgb * ${patch.glowFromColor.toFixed(2)} * vGlow;\n`;
    }
    if (patch.lit === true) emissive += "totalEmissiveRadiance += diffuseColor.rgb * vLit;\n";
    if (patch.kraken === true) {
      emissive += `{ float fr = pow(1.0 - abs(dot(normalize(normal), normalize(vViewPosition))), 2.5);
  float sp = smoothstep(0.62, 0.8, vnoise(vW.xz*0.9 + vW.y*0.7));
  totalEmissiveRadiance += uDefect*1.3*fr*0.75 + uDefect*1.6*sp*(0.5+0.5*sin(uTime*1.5 + vW.y))*0.35; }\n`;
    }
    if (patch.tentacle !== undefined) {
      emissive += `{ float fr = pow(1.0 - abs(dot(normalize(normal), normalize(vViewPosition))), 2.5);
  vec2 sc = fract(vec2(vTUv.x*70.0, vTUv.y*8.0)) - 0.5;
  float suck = smoothstep(0.32, 0.18, length(sc)) * step(abs(vTUv.y - 0.5), 0.13);
  totalEmissiveRadiance += uDefect*1.3*fr*0.9 + mix(uDefect, vec3(1.0), 0.45)*suck*0.6; }\n`;
    }
    const light = `outgoingLight += vec3(0.5,0.92,1.0)*caustic(vW, uTime*0.55)*clamp(vWN.y*0.7+0.3,0.,1.)*${caustic}*(0.25+diffuseColor.rgb*0.75);\n`;
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${fragmentHead}`)
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>\n${emissive}`)
      .replace("#include <opaque_fragment>", `${light}#include <opaque_fragment>`);
  };
  const key = JSON.stringify(patch);
  material.customProgramCacheKey = () => key;
  return material;
}

/**
 * `fragmentShader` with the renderer's tone mapping and output colour space
 * applied as it ends, as Three.js's own materials apply them, so a shader's
 * linear light reads the same as a lit surface's beside it. A shader that
 * multiplies what is drawn rather than adding light (`toned` false) skips
 * both.
 */
function outputOf(fragmentShader: string, toned: boolean): string {
  if (!toned) return fragmentShader;
  const end = fragmentShader.lastIndexOf("}");
  return `${fragmentShader.slice(0, end)}\n  #include <tonemapping_fragment>\n  #include <colorspace_fragment>\n}`;
}

/** The sea of one world, its signals in `palette`, entered in the deep. */
export function seaOf(palette: WorldPalette): Sea {
  const fog = new FogExp2(MOOD.DEEP.fog, MOOD.DEEP.fogDensity);
  let current: Mood = MOOD.DEEP;
  const uniforms: SeaUniforms = {
    uTime: { value: 0 },
    uFogColor: { value: fog.color },
    uFogDensity: { value: fog.density },
    uMotion: { value: 1 },
    uRippleAt: { value: -1e6 },
    uKrakenSway: { value: 1 },
    uShipped: { value: new Color(palette.signal.SHIPPED) },
    uDefect: { value: new Color(palette.signal.DEFECT) },
  };
  return {
    uniforms,
    fog,
    signal: palette.signal,
    shader: (own, vertexShader, fragmentShader, parameters = {}) =>
      new ShaderMaterial({
        ...parameters,
        uniforms: { ...own, ...uniforms },
        vertexShader: `${GLSL_SEA}${vertexShader}`,
        fragmentShader: `${GLSL_SEA}${outputOf(fragmentShader, parameters.toneMapped !== false)}`,
      }),
    standard: (parameters, patch = {}) =>
      patched(new MeshStandardMaterial(parameters), uniforms, patch),
    mood: () => current,
    enter: (mood) => {
      current = mood;
      fog.color.set(mood.fog);
      fog.density = mood.fogDensity;
      uniforms.uFogDensity.value = mood.fogDensity;
    },
  };
}
