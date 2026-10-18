import { FACTORY_WORLD_BOUNDS, type FactoryDefect } from "@luke/features/factory-world-wire";
import { ZONE_LAYER } from "@luke/ui/factory-world";
import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  DodecahedronGeometry,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NormalBlending,
  OctahedronGeometry,
  PointLight,
  Points,
  ShaderMaterial,
  SphereGeometry,
} from "three";
import {
  PICK_KIND,
  type PickTarget,
  type WorldPalette,
  type WorldPicking,
  type WorldPoint,
} from "../../world";
import { breachAngleOf } from "./architecture";
import type { ZoneSite } from "./layout";
import { HUE } from "./materials";
import { placed, polar, seeded } from "./math";
import { groundAt, HILL, profile, WIND } from "./terrain";

/**
 * damage.ts -- defects as damage: fire and smoke where each one burns, rubble spilled from the wound, a glowing ember at its heart, and the wound's own light; with the breach in the curtain and the broken crowns the stonework builds (`architecture.ts`).
 *
 * A defect burns in the first zone it is placed on: on the curtain where it
 * breached a surface zone, in a tower's broken crown, or by a field's
 * building. A defect placed on no zone burns in the yard by the main gate.
 * Its fire is larger, its smoke higher, and its rubble wider the more events
 * it reached. The fire is drawn in the defect signal's colour, so damage
 * reads the same as every world's defects.
 */

const MAX_DEFECTS = FACTORY_WORLD_BOUNDS.MAX_DEFECTS;
const FLAMES_PER_WOUND = 46;
const PLUMES_PER_WOUND = 40;
const EMBERS_PER_WOUND = 14;
const RUBBLE_PER_WOUND = 14;

/** One defect's wound: where it burns and how fiercely. */
export interface Wound {
  readonly defect: FactoryDefect;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** The square root of its events: how large it burns. */
  readonly scale: number;
}

/** Where each defect burns, by its first zone's layer, the zone's defects in turn. */
export function woundsOf(
  defects: readonly FactoryDefect[],
  sites: ReadonlyMap<string, ZoneSite>,
  gates: readonly number[],
): Wound[] {
  const used = new Map<ZoneSite | undefined, number>();
  return defects.slice(0, MAX_DEFECTS).map((defect) => {
    const first = defect.zonePaths[0];
    const site = first === undefined ? undefined : sites.get(first);
    const k = used.get(site) ?? 0;
    used.set(site, k + 1);
    const scale = Math.sqrt(Math.max(1, defect.events));
    let x: number;
    let y: number;
    let z: number;
    if (site === undefined) {
      const gate = gates[0] ?? Math.PI / 2;
      [x, z] = polar(51.5 + (k % 2) * 3, gate - 0.2 - k * 0.07);
      y = groundAt(x, z) + 0.3;
    } else if (site.layer === ZONE_LAYER.SURFACE) {
      [x, z] = polar(HILL.OUTER_RADIUS, breachAngleOf(site, k));
      y = profile(HILL.OUTER_RADIUS) + 1.4 + (k === 0 ? 0.6 : 1.2);
    } else if (k === 0 && site.layer !== ZONE_LAYER.TOOLING) {
      ({ x, z } = site.crown);
      y = site.crown.y - 0.9;
    } else {
      const [dx, dz] = polar(site.size * 0.5 + 0.8, site.angle + 1.3 * k);
      [x, z] = [site.x + dx, site.z + dz];
      y = Math.max(groundAt(x, z) + 0.4, site.top - 1.2 - k);
    }
    return { defect, x, y, z, scale };
  });
}

/** The points a fire, its smoke, or its embers are drawn as: each a particle of one wound's slot, rising and fading by the shader. */
function plume(
  kind: "flame" | "smoke",
  perWound: number,
  color: Color,
  fog: { readonly color: Color; readonly density: { value: number } },
  pixels: { value: number },
  time: { value: number },
  origins: { value: number[] },
  settings: {
    readonly spread: number;
    readonly rise: number;
    readonly speed: number;
    readonly size: number;
    readonly seed: number;
  },
): Points {
  const count = MAX_DEFECTS * perWound;
  const random = seeded(settings.seed);
  const seeds = new Float32Array(count * 4);
  const slots = new Float32Array(count);
  for (let index = 0; index < count; index += 1) {
    seeds.set(
      [random(), settings.speed * (0.75 + random() * 0.5), random(), 0.7 + random() * 0.6],
      index * 4,
    );
    slots[index] = Math.floor(index / perWound);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(new Float32Array(count * 3), 3));
  geometry.setAttribute("aSeed", new Float32BufferAttribute(seeds, 4));
  geometry.setAttribute("aSlot", new Float32BufferAttribute(slots, 1));
  const flame = kind === "flame";
  const material = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: flame ? AdditiveBlending : NormalBlending,
    uniforms: {
      uTime: time,
      uOrigin: origins,
      uPixels: pixels,
      uWind: { value: [WIND.x, WIND.z] },
      uColor: { value: color },
      uFog: { value: fog.color },
      uFogDensity: fog.density,
    },
    vertexShader: `attribute vec4 aSeed; attribute float aSlot; uniform float uTime, uPixels; uniform float uOrigin[${MAX_DEFECTS * 4}]; uniform vec2 uWind;
      varying float vLife; varying float vFog; varying float vOn;
      void main(){
        int at = int(aSlot + 0.5) * 4;
        vec3 p = vec3(uOrigin[at], uOrigin[at + 1], uOrigin[at + 2]);
        float scale = uOrigin[at + 3];
        vOn = step(0.001, scale);
        float life = fract(uTime * aSeed.y + aSeed.x);
        float spread = (${settings.spread.toFixed(3)}) * (0.6 + scale * 0.3);
        float rise = (${settings.rise.toFixed(3)}) * (0.7 + scale * 0.35) * aSeed.w;
        float angle = aSeed.x * 6283.18;
        float r = spread * sqrt(aSeed.z) * ${flame ? "(1.0 - 0.6 * life)" : "(1.0 + life * 1.5)"};
        p.x += cos(angle) * r; p.z += sin(angle) * r;
        p.y += life * rise;
        p.xz += uWind * pow(life, ${flame ? "1.8" : "1.3"}) * rise * ${flame ? "0.25" : "0.75"};
        p.x += sin(uTime * 3.0 + angle) * 0.08 * life * rise;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float size = (${settings.size.toFixed(3)}) * (0.6 + scale * 0.2) * ${flame ? "(1.0 - 0.65 * life)" : "(0.35 + 1.9 * life)"};
        gl_PointSize = size * projectionMatrix[1][1] * uPixels / -mv.z * vOn;
        vLife = life; vFog = -mv.z;
      }`,
    fragmentShader: `uniform vec3 uColor, uFog; uniform float uFogDensity; varying float vLife; varying float vFog; varying float vOn;
      void main(){
        vec2 c = gl_PointCoord - 0.5; float d = length(c); if (d > 0.5 || vOn < 0.5) discard;
        float soft = smoothstep(0.5, 0.0, d);
        float fog = 1.0 - exp(-uFogDensity * uFogDensity * vFog * vFog);
        ${
          flame
            ? `vec3 hot = mix(vec3(1.0, 0.86, 0.6), uColor, 0.35);
        vec3 col = mix(hot, uColor, smoothstep(0.0, 0.3, vLife)); col = mix(col, uColor * 0.35, smoothstep(0.3, 0.85, vLife));
        gl_FragColor = vec4(col * 1.4 * (1.0 - fog), soft * soft * (1.0 - vLife) * 0.5);`
            : `vec3 col = mix(vec3(0.09, 0.07, 0.065), vec3(0.38, 0.33, 0.31), smoothstep(0.05, 1.0, vLife));
        col += uColor * (1.0 - vLife) * 0.18;
        col = mix(col, uFog, fog);
        gl_FragColor = vec4(col, pow(soft, 1.5) * smoothstep(0.0, 0.12, vLife) * (1.0 - vLife) * 0.62);`
        }
        #include <colorspace_fragment>
      }`,
  });
  const points = new Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = flame ? 5 : 4;
  return points;
}

export interface Damage {
  readonly group: Group;
  /** Sets each wound burning, its rubble spilled, and its ember in the defect's colour or the selection's where chosen. */
  readonly burn: (
    wounds: readonly Wound[],
    shown: boolean,
    chosen: (target: PickTarget) => boolean,
  ) => void;
  readonly step: (elapsed: number) => void;
  readonly spotOf: (id: string) => (WorldPoint & { readonly size: number }) | undefined;
}

export function buildDamage(
  palette: WorldPalette,
  picking: WorldPicking,
  fog: { readonly color: Color; readonly density: { value: number } },
  pixels: { value: number },
): Damage {
  const time = { value: 0 };
  const origins = { value: Array.from({ length: MAX_DEFECTS * 4 }, () => 0) };
  const color = new Color(palette.signal.DEFECT);
  const flames = plume("flame", FLAMES_PER_WOUND, color, fog, pixels, time, origins, {
    spread: 0.5,
    rise: 2.4,
    speed: 0.85,
    size: 1.1,
    seed: 11,
  });
  const smoke = plume("smoke", PLUMES_PER_WOUND, color, fog, pixels, time, origins, {
    spread: 0.7,
    rise: 10,
    speed: 0.1,
    size: 2.2,
    seed: 12,
  });
  const embers = plume("flame", EMBERS_PER_WOUND, color, fog, pixels, time, origins, {
    spread: 0.6,
    rise: 9,
    speed: 0.32,
    size: 0.2,
    seed: 13,
  });
  const rubble = new InstancedMesh(
    new DodecahedronGeometry(1, 0),
    new MeshStandardMaterial({ roughness: 1, flatShading: true, color: HUE.STONE_DARK }),
    MAX_DEFECTS * RUBBLE_PER_WOUND,
  );
  rubble.castShadow = true;
  rubble.receiveShadow = true;
  rubble.count = 0;
  const hearts = new InstancedMesh(
    new OctahedronGeometry(0.5, 0),
    new MeshBasicMaterial(),
    MAX_DEFECTS,
  );
  hearts.setColorAt(0, color);
  hearts.count = 0;
  const proxies = new InstancedMesh(
    new SphereGeometry(1, 8, 6),
    new MeshBasicMaterial({ visible: false }),
    MAX_DEFECTS,
  );
  proxies.count = 0;
  const light = new PointLight(palette.signal.DEFECT, 0, 30, 1.7);
  const group = new Group();
  group.add(flames, smoke, embers, rubble, hearts, proxies, light);

  let drawn: readonly Wound[] = [];
  const targetOf = (instanceId: number): PickTarget | undefined => {
    const wound = drawn[instanceId];
    return wound === undefined ? undefined : { kind: PICK_KIND.DEFECT, id: wound.defect.id };
  };
  picking.addInstances(proxies, targetOf);
  picking.addInstances(hearts, targetOf);
  const matrix = new Matrix4();
  const tint = new Color();
  let fiercest = 0;

  return {
    group,
    burn: (wounds, shown, chosen) => {
      group.visible = shown;
      drawn = shown ? wounds : [];
      origins.value.fill(0);
      let spilled = 0;
      fiercest = 0;
      drawn.forEach((wound, index) => {
        origins.value.splice(index * 4, 4, wound.x, wound.y, wound.z, wound.scale);
        const size = 0.45 + wound.scale * 0.14;
        hearts.setMatrixAt(
          index,
          placed(matrix, wound.x, wound.y, wound.z, wound.scale, size, size * 1.3, size),
        );
        hearts.setColorAt(
          index,
          tint
            .set(
              chosen({ kind: PICK_KIND.DEFECT, id: wound.defect.id })
                ? palette.signal.SELECTION
                : palette.signal.DEFECT,
            )
            .multiplyScalar(1.6),
        );
        proxies.setMatrixAt(
          index,
          placed(
            matrix,
            wound.x,
            wound.y,
            wound.z,
            0,
            2.2 + wound.scale * 0.35,
            2.2 + wound.scale * 0.35,
            2.2 + wound.scale * 0.35,
          ),
        );
        // Note that rubble spills outward from the wound, more of it the more events it reached.
        const random = seeded(index * 977 + 51);
        const out = Math.atan2(wound.z, wound.x);
        const pieces = Math.min(RUBBLE_PER_WOUND, Math.round(4 + wound.scale * wound.scale * 0.5));
        for (let piece = 0; piece < pieces; piece += 1) {
          const angle = out + (random() - 0.5) * 1.7;
          const reach = 1 + random() * (1.5 + wound.scale * 0.55);
          const x = wound.x + Math.cos(angle) * reach;
          const z = wound.z + Math.sin(angle) * reach;
          const size = 0.18 + random() * 0.42;
          rubble.setMatrixAt(
            spilled,
            placed(
              matrix,
              x,
              groundAt(x, z) + size * 0.4,
              z,
              random() * 6,
              size * (1 + random()),
              size,
              size * (1 + random()),
            ),
          );
          spilled += 1;
        }
        if (wound.scale > (drawn[fiercest]?.scale ?? 0)) fiercest = index;
      });
      const worst = drawn[fiercest];
      if (worst !== undefined) light.position.set(worst.x, worst.y + 1.5, worst.z);
      light.intensity = worst === undefined ? 0 : 22;
      rubble.count = spilled;
      hearts.count = drawn.length;
      proxies.count = drawn.length;
      for (const mesh of [rubble, hearts, proxies]) {
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true;
      }
    },
    step: (elapsed) => {
      time.value = elapsed;
      if (drawn.length > 0)
        light.intensity = 20 + Math.sin(elapsed * 13) * 4 + Math.sin(elapsed * 7.3) * 5;
    },
    spotOf: (id) => {
      const wound = drawn.find((one) => one.defect.id === id);
      return wound === undefined
        ? undefined
        : { x: wound.x, y: groundAt(wound.x, wound.z), z: wound.z, size: 1.6 + wound.scale * 0.3 };
    },
  };
}
