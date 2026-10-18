import {
  BoxGeometry,
  Color,
  ConeGeometry,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  type Object3D,
  Vector3,
} from "three";
import {
  type CrustZone,
  groundAt,
  PLANET_RADIUS,
  type PlanetLayout,
  type PlanetZone,
  type Site,
  sampleSite,
} from "./globe";
import {
  clamp,
  flush,
  frameMatrix,
  GLSL_NOISE,
  GLSL_ZONE,
  hash,
  rng,
  type SharedUniforms,
  tangentBasis,
} from "./kit";

/**
 * cities.ts -- what stands on the crust: each city's towers and each continent's settlements, their windows lit at night and brighter where work shipped, and the forests between.
 *
 * A city (a surface zone) is a cluster of towers, more as its footprint
 * grows and tallest at its centre; a continent (a domain zone) has a few
 * low settlements and its forests. The towers' shader lights their windows
 * on the night side and in a zone alive with shipped work, and pulses them
 * in the blast radius's colour, reading the zone-state texture as the crust
 * does. The same tower is what a shipped pull request raises
 * (`shipped.ts`), glowing the shipped colour while it is fresh.
 */

/** The most towers and settlements the cities hold between them. */
const MAX_BUILDINGS = 6000;

/** The most trees on the continents. */
const MAX_TREES = 1700;

/** One tower or settlement: where it stands, its size, and its turn. */
export interface Building {
  readonly site: Site;
  readonly width: number;
  readonly depth: number;
  readonly height: number;
  readonly yaw: number;
  readonly seed: number;
}

/**
 * The towers' material: plain stone by day, windows lit by night, the shipped
 * glow of the zone, the freshness of a just-merged tower (`aFresh`) in the
 * shipped colour, and the blast radius's pulse.
 */
export function windowMaterial(shared: SharedUniforms): MeshStandardMaterial {
  const material = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0.15 });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, shared);
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
        attribute float aZone; attribute float aFresh; attribute float aSeed;
        varying vec3 vBP; varying vec3 vBS; flat varying int vZone; varying float vFresh; varying float vSeed; varying vec3 vWPos;`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        vBP = position; vBS = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
        vZone = int(floor(aZone + 0.5)); vFresh = aFresh; vSeed = aSeed; vWPos = (modelMatrix * instanceMatrix * vec4(position, 1.0)).xyz;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        uniform float uTime; uniform vec3 uSunDir; uniform vec3 uShipped; uniform vec3 uBlast;
        varying vec3 vBP; varying vec3 vBS; flat varying int vZone; varying float vFresh; varying float vSeed; varying vec3 vWPos;
        ${GLSL_NOISE} ${GLSL_ZONE}`,
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
        float night = smoothstep(0.08, -0.25, dot(normalize(vWPos), uSunDir));
        bool side = vBP.y < 0.995;
        float u = abs(vBP.x) > 0.499 ? vBP.z * vBS.z : vBP.x * vBS.x;
        float fy = vBP.y * vBS.y / 0.038, fx = u / 0.03;
        float win = step(0.3, fract(fx)) * step(0.38, fract(fy)) * (side ? 1.0 : 0.0) * step(0.6, fy);
        float hsh = hash3(vec3(floor(fx), floor(fy), vSeed * 91.0));
        vec4 zs = vZone >= 0 ? zoneState(vZone) : vec4(0.0);
        float ship = zs.z;
        float lit = step(0.62 - ship * 0.3 - vFresh * 0.5, hsh);
        vec3 warm = mix(vec3(1.0, 0.6, 0.3), vec3(0.85, 0.92, 1.0), step(0.85, hsh));
        warm = mix(warm, uShipped * 1.5, max(ship * 0.6, vFresh));
        totalEmissiveRadiance += warm * win * lit * (night * 2.2 + 0.08 + vFresh * 2.6);
        totalEmissiveRadiance += uShipped * vFresh * (0.25 + 0.75 * step(0.995, vBP.y)) * 1.6;
        totalEmissiveRadiance += uBlast * zoneBlast(zs) * 0.3 * (0.5 + 0.5 * sin(uTime * 4.0 + vBP.y * 6.0));`,
      );
  };
  return material;
}

/** An instanced mesh of `count` towers, each with its zone, freshness, and seed. */
export function towerMesh(material: MeshStandardMaterial, count: number): InstancedMesh {
  const geometry = new BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  geometry.setAttribute("aZone", new InstancedBufferAttribute(new Float32Array(count).fill(-1), 1));
  geometry.setAttribute("aFresh", new InstancedBufferAttribute(new Float32Array(count), 1));
  geometry.setAttribute("aSeed", new InstancedBufferAttribute(new Float32Array(count), 1));
  const mesh = new InstancedMesh(geometry, material, count);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  mesh.count = 0;
  return mesh;
}

const placing = new Matrix4();
const sizing = new Matrix4();
const sunk = new Vector3();

/** Stands `building` at instance `at` of `mesh`, its height times `rise`. */
export function placeTower(mesh: InstancedMesh, at: number, building: Building, rise = 1): void {
  const { site } = building;
  const forward = tangentBasis(site.up)[0].applyAxisAngle(site.up, building.yaw);
  sunk.copy(site.position).addScaledVector(site.up, -0.03);
  frameMatrix(placing, sunk, site.up, forward, 1);
  placing.multiply(
    sizing.makeScale(
      building.width,
      (building.height + 0.03) * Math.max(0.0001, rise),
      building.depth,
    ),
  );
  mesh.setMatrixAt(at, placing);
  mesh.geometry.getAttribute("aZone").setX(at, site.zone?.index ?? -1);
  mesh.geometry.getAttribute("aSeed").setX(at, building.seed);
}

/** How many towers a zone raises: a city by its footprint, a continent a few settlements. */
function towersOf(zone: CrustZone): number {
  return Math.round(zone.city ? 10 + 50 * zone.view.footprint : 3 + 8 * zone.view.footprint);
}

function buildingsOf(layout: PlanetLayout, taken: Map<PlanetZone, Vector3[]>): Building[] {
  const draw = rng(77);
  const wanted = layout.crust.reduce((sum, zone) => sum + towersOf(zone), 0);
  const share = Math.min(1, MAX_BUILDINGS / Math.max(1, wanted));
  const buildings: Building[] = [];
  for (const zone of layout.crust) {
    // Note that each zone's share is rounded down and the whole capped, so the towers never pass the instances allocated for them.
    const count = Math.min(Math.floor(towersOf(zone) * share), MAX_BUILDINGS - buildings.length);
    for (let tower = 0; tower < count; tower += 1) {
      const site = sampleSite(layout, zone, draw, taken, {
        apart: zone.city ? 0.16 : 0.2,
        spread: zone.city ? 0.85 : 0.6,
      });
      if (!zone.city) {
        if (site.position.length() - PLANET_RADIUS > 0.3) continue;
        buildings.push({
          site,
          width: 0.06 + draw() * 0.05,
          depth: 0.06 + draw() * 0.05,
          height: 0.05 + draw() * 0.12,
          yaw: draw() * Math.PI * 2,
          seed: draw(),
        });
        continue;
      }
      const fromCentre = Math.acos(clamp(site.up.dot(zone.centre), -1, 1)) / zone.theta;
      const tall = (1 - clamp(fromCentre, 0, 1)) ** 1.6;
      buildings.push({
        site,
        width: 0.07 + draw() * 0.1,
        depth: 0.07 + draw() * 0.1,
        height: 0.08 + tall * (0.25 + draw() * 0.75) + draw() * 0.08,
        yaw: draw() * Math.PI * 2,
        seed: draw(),
      });
    }
  }
  return buildings;
}

/** The cities and the forests, placed with the layout. */
export interface Cities {
  readonly objects: readonly Object3D[];
  /** Places every tower and tree, and answers what the towers took of each zone, for what stands among them after. */
  readonly rebuild: (layout: PlanetLayout) => Map<PlanetZone, Vector3[]>;
}

export function createCities(material: MeshStandardMaterial): Cities {
  const towers = towerMesh(material, MAX_BUILDINGS);
  const trees = new InstancedMesh(
    new ConeGeometry(0.035, 0.11, 5).translate(0, 0.05, 0),
    new MeshStandardMaterial({ roughness: 0.85, flatShading: true }),
    MAX_TREES,
  );
  trees.castShadow = true;
  trees.receiveShadow = true;
  trees.frustumCulled = false;
  trees.count = 0;
  const tint = new Color();
  const tone = new Color();

  const rebuild = (layout: PlanetLayout) => {
    const taken = new Map<PlanetZone, Vector3[]>();
    const buildings = buildingsOf(layout, taken);
    buildings.forEach((building, at) => {
      placeTower(towers, at, building);
      towers.setColorAt(
        at,
        tone.setHSL(
          0.6 + building.seed * 0.08,
          0.08 + building.seed * 0.1,
          0.62 + building.seed * 0.25,
        ),
      );
    });
    towers.count = buildings.length;
    towers.geometry.getAttribute("aZone").needsUpdate = true;
    towers.geometry.getAttribute("aSeed").needsUpdate = true;
    flush(towers);
    plantForests(layout);
    return taken;
  };

  const plantForests = (layout: PlanetLayout) => {
    const draw = rng(5);
    const direction = new Vector3();
    let planted = 0;
    for (let attempt = 0; attempt < 2600 && planted < MAX_TREES; attempt += 1) {
      direction.set(draw() * 2 - 1, draw() * 2 - 1, draw() * 2 - 1).normalize();
      const scale = 0.6 + draw() * 0.8;
      if (Math.min(direction.x, direction.y, direction.z) > -0.06) continue;
      const ground = groundAt(layout, direction);
      const owner = ground.owner;
      if (owner === undefined || owner.city || ground.inside < 0.07 || ground.height > 0.42)
        continue;
      if (Math.abs(direction.y) > 0.8) continue;
      frameMatrix(
        placing,
        sunk.copy(direction).multiplyScalar(PLANET_RADIUS + ground.height - 0.01),
        direction,
        tangentBasis(direction)[0],
        scale,
      );
      trees.setMatrixAt(planted, placing);
      tint
        .copy(owner.biome)
        .multiplyScalar(0.55 + hash(planted) * 0.25)
        .offsetHSL(0.02, 0.05, -0.02);
      trees.setColorAt(planted, tint);
      planted += 1;
    }
    trees.count = planted;
    flush(trees);
  };

  return { objects: [towers, trees], rebuild };
}
