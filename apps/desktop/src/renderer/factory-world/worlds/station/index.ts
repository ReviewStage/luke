import { FACTORY_WORLD_BOUNDS } from "@luke/features/factory-world-wire";
import { AGENT_STATE, type ZoneView } from "@luke/ui/factory-world";
import { Color, DoubleSide, Group, Mesh, PlaneGeometry, Vector3 } from "three";
import {
  PICK_KIND,
  type PickKind,
  type PickTarget,
  type WorldModule,
  type WorldPalette,
  type WorldState,
} from "../../world";
import { Crew, type CrewPlan } from "./crew";
import { Damage } from "./damage";
import { Bursts, Reticle, Sparks, Streaks } from "./effects";
import { hashOf, TAU } from "./kit";
import {
  EFFECT,
  effectMaterial,
  GLOW_MODE,
  setAppearance,
  stationMaterials,
  stationUniforms,
  ZoneSignals,
} from "./materials";
import { buildSky } from "./sky";
import { buildStation, type Station, sameStation, type ZoneBody } from "./station";
import { blueprint, Fleet, Pods, ShippedLights, type ZoneFlash } from "./traffic";

/**
 * index.ts -- the Orbital Station: the repository as a station turning in orbit above Earth, its core at the heart, its domain on the spokes, its surface around the outer ring, and its tooling up and down the spine.
 *
 * Each signal is the station's own: an agent at work is an astronaut
 * welding a truss as long as its pull request is large (`crew.ts`); the
 * blast radius is the zones that depend on its work lighting one step at a
 * time, the conduits between them running with it and a ripple spreading
 * across the station's plane; shipped work is the navigation lights on the
 * zones it landed in, those zones' windows lit by how alive they are, and
 * cargo pods launched toward Earth (`traffic.ts`); planned work is supply
 * ships holding orbit with blueprints aboard; and defects are breaches torn
 * in the hull (`damage.ts`). The zones themselves are `station.ts`.
 *
 * `update` redraws from the state alone, and rebuilds the station only when
 * the zones it is built from change. `frame` is idle motion: the station's
 * slow turn, Earth's, the crew's work, the traffic's comings and goings.
 * Held still, every part is posed so the frame says the same.
 */

/** The station's turn, in radians a second: once round in a little under six minutes. */
const STATION_SPIN = TAU / 340;

/** The pixel scale halos are sized by, about half a panel's height. */
const HALO_SCALE = 450;

/** How fast a zone's flash, from a launch or a blueprint's arrival, fades, a second. */
const FLASH_FADE = 0.6;

/** Whether the developer chose or hovers the item of `kind` and `id`. */
function chosen(state: WorldState, kind: PickKind, id: string): boolean {
  return [state.selected, state.hovered].some(
    (target) => target?.kind === kind && target.id === id,
  );
}

/** What the developer chose and hovers, which every layer lights in the selection colour. */
function chosenTargets(state: WorldState): PickTarget[] {
  return [state.selected, state.hovered].flatMap((target) =>
    target === undefined ? [] : [target],
  );
}

/** The ripple of the blast radius: rings of its colour running out across the station's plane from the selected agent's zone. */
function rippleOf(
  color: string,
  time: { value: number },
  motion: { value: number },
  light: { value: number },
) {
  const origin = new Vector3();
  const mesh = new Mesh(
    new PlaneGeometry(240, 240).rotateX(-Math.PI / 2),
    effectMaterial(
      {
        uniforms: {
          uTime: time,
          uMotion: motion,
          uOrigin: { value: origin },
          uColor: { value: new Color(color) },
        },
        side: DoubleSide,
        vertexShader: /* glsl */ `
varying vec3 vPoint;
void main() { vPoint = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */ `
uniform float uTime, uMotion; uniform vec3 uOrigin, uColor;
varying vec3 vPoint;
void main() {
  float d = distance(vPoint.xz, uOrigin.xz);
  float a = 0.0;
  for (int k = 0; k < 3; k++) {
    float r = fract(uTime * 0.32 * uMotion + float(k) / 3.0 + 0.2) * 90.0;
    a += exp(-pow((d - r) * 0.7, 2.0)) * (1.0 - r / 90.0);
  }
  gl_FragColor = vec4(uColor * a * 0.8, 1.0);
  ${EFFECT}
}`,
      },
      light,
    ),
  );
  mesh.visible = false;
  return { mesh, origin };
}

/** Where each agent works: on its primary zone, or the heart where it names none, one beside another where several share a zone. */
function crewPlansOf(state: WorldState, station: Station): CrewPlan[] {
  const { view, layers } = state;
  const shown = view.agents
    .slice(0, FACTORY_WORLD_BOUNDS.MAX_AGENTS)
    .filter((agent) => layers.building || agent.state === AGENT_STATE.FAILED)
    .flatMap((agent) => {
      const primary =
        agent.primaryZone === null ? undefined : station.bodies.get(agent.primaryZone);
      // Note that a gimbal's work site is its crown, on the axis it turns about, so work there stands still.
      const body = primary ?? station.fallback;
      return body === undefined ? [] : [{ agent, body }];
    });
  const sharing = new Map<ZoneBody, number>();
  for (const { body } of shown) sharing.set(body, (sharing.get(body) ?? 0) + 1);
  const placed = new Map<ZoneBody, number>();
  return shown.map(({ agent, body }) => {
    const order = placed.get(body) ?? 0;
    placed.set(body, order + 1);
    const second = agent.touched.find(
      (touched) => touched.path !== body.zone.path && touched.weight > 0.04,
    );
    const secondBody = second === undefined ? undefined : station.bodies.get(second.path);
    return {
      target: { kind: PICK_KIND.AGENT, id: agent.id },
      state: agent.state,
      kind: agent.kind,
      buildSize: agent.buildSize,
      site: body.site(order, sharing.get(body) ?? 1),
      visit:
        secondBody === undefined || secondBody.turning
          ? undefined
          : secondBody.site(hashOf(agent.id) % 5, 5),
      selected: state.selected?.kind === PICK_KIND.AGENT && state.selected.id === agent.id,
      hovered: state.hovered?.kind === PICK_KIND.AGENT && state.hovered.id === agent.id,
    };
  });
}

/** Paints every zone's windows, seams and glow from the state, and from the flashes running. */
function paintZones(
  state: WorldState,
  station: Station,
  signals: ZoneSignals,
  palette: WorldPalette,
  damaged: ReadonlyMap<ZoneBody, number>,
  flashes: ReadonlyMap<ZoneBody, { color: Color; strength: number }>,
): void {
  const { signal } = palette;
  const shipped = new Color(signal.SHIPPED);
  const selection = new Color(signal.SELECTION);
  const building = new Color(signal.BUILDING);
  const blastColor = new Color(signal.BLAST_RADIUS);
  const defect = new Color(signal.DEFECT);
  const accent = new Color();
  const glow = new Color();
  for (const body of station.bodies.values()) {
    const { zone, index } = body;
    const alive = state.layers.shipped ? zone.alive : 0;
    const distance = state.blast.get(zone.path);
    signals.setLight(index, 0.18 + 0.5 * alive, 0.9 + 1.5 * alive, distance ?? -1);
    accent.copy(body.accent).lerp(shipped, alive * 0.85);
    if (distance !== undefined) accent.lerp(distance === 0 ? building : blastColor, 0.85);
    const isChosen = chosen(state, PICK_KIND.ZONE, zone.path);
    if (isChosen) accent.copy(selection);
    signals.setAccent(index, accent, 1.4 + (distance === undefined ? 0 : 1.5));
    signals.setTint(index, body.accent);
    const flash = flashes.get(body);
    const severity = state.layers.defects ? damaged.get(body) : undefined;
    if (isChosen) {
      signals.setGlow(
        index,
        selection,
        state.selected?.kind === PICK_KIND.ZONE && state.selected.id === zone.path ? 0.75 : 0.6,
        GLOW_MODE.CHOSEN,
      );
    } else if (distance !== undefined) {
      signals.setGlow(index, distance === 0 ? building : blastColor, 0, GLOW_MODE.STEADY);
    } else if (flash !== undefined && flash.strength > 0.05) {
      signals.setGlow(index, glow.copy(flash.color), flash.strength * 0.6, GLOW_MODE.CHOSEN);
    } else if (severity !== undefined) {
      signals.setGlow(index, defect, 0.18 + Math.min(0.5, severity / 140), GLOW_MODE.PULSE);
    } else {
      signals.setGlow(index, glow.setRGB(0, 0, 0), 0, GLOW_MODE.STEADY);
    }
  }
  signals.commit();
}

export const world: WorldModule = {
  create: (host) => {
    const { scene, picking, palette } = host;
    const { signal } = palette;
    host.camera.setHome({ x: 86, y: 50, z: 104 }, { x: 0, y: -1, z: 0 });
    host.camera.setReach(3, 520);

    const signals = new ZoneSignals();
    const uniforms = stationUniforms(signals, signal.BLAST_RADIUS);
    const materials = stationMaterials(uniforms);
    const sky = buildSky(scene, uniforms);
    const effects = { viewport: { value: HALO_SCALE }, light: uniforms.uLight };
    const turning = new Group();
    scene.add(turning);

    const sparks = new Sparks(effects);
    const streaks = new Streaks(effects);
    const bursts = new Bursts(effects);
    const crew = new Crew(signal, materials.hull.map, sparks, effects);
    const lights = new ShippedLights(signal, effects, turning);
    const pods = new Pods(signal, materials.white, effects, scene);
    const fleet = new Fleet(signal, materials.hull, uniforms.uTime, effects);
    const damage = new Damage(signal, materials.hull, uniforms.uTime, uniforms.uMotion, effects);
    const ripple = rippleOf(signal.BLAST_RADIUS, uniforms.uTime, uniforms.uMotion, uniforms.uLight);
    const hoverRing = new Reticle(signal.SELECTION, 64, uniforms.uTime, 0);
    const selectRing = new Reticle(signal.SELECTION, 6, uniforms.uTime, 0.6);
    turning.add(crew.group, fleet.group, damage.group, sparks.points, streaks.points, ripple.mesh);
    scene.add(bursts.mesh, hoverRing.mesh, selectRing.mesh);
    picking.addInstances(crew.pick, (instance) => crew.targetOf(instance));
    picking.addInstances(lights.mesh, (instance) => lights.targetOf(instance));
    picking.addInstances(pods.pick, (instance) => pods.targetOf(instance));
    picking.addInstances(fleet.pick, (instance) => fleet.targetOf(instance));
    picking.addInstances(damage.pick, (instance) => damage.targetOf(instance));

    let station: Station | undefined;
    let zones: readonly ZoneView[] = [];
    let unregisterZones: (() => void)[] = [];
    let latest: WorldState | undefined;
    let spinning = true;
    let elapsedNow = 0;
    let selectedAgent: string | undefined;
    let dark: boolean | undefined;
    const flashes = new Map<ZoneBody, { color: Color; strength: number }>();
    const flash: ZoneFlash = (body, color, strength) => {
      const running = flashes.get(body);
      flashes.set(body, {
        color: new Color(color),
        strength: Math.max(strength, running?.strength ?? 0),
      });
    };
    const toStation = (world: Vector3) => turning.worldToLocal(world);
    const send = blueprint(streaks, sparks, flash, signal);

    /** Where the target the developer chose or hovers stands in the scene, and how large it is. */
    const placeOf = (
      target: PickTarget | undefined,
    ): { at: Vector3; radius: number } | undefined => {
      if (target === undefined) return undefined;
      const local =
        target.kind === PICK_KIND.AGENT
          ? crew
              .positionOf(target)
              ?.clone()
              .setY((crew.positionOf(target)?.y ?? 0) + 0.55)
          : target.kind === PICK_KIND.PLANNED
            ? fleet.positionOf(target)?.clone()
            : target.kind === PICK_KIND.DEFECT
              ? damage.positionOf(target)?.clone()
              : target.kind === PICK_KIND.SHIPPED
                ? lights.positionOf(target)?.clone()
                : undefined;
      if (local === undefined) return undefined;
      const radius =
        target.kind === PICK_KIND.PLANNED ? 4 : target.kind === PICK_KIND.SHIPPED ? 0.8 : 1.5;
      return { at: turning.localToWorld(local), radius };
    };
    const aimRings = (state: WorldState) => {
      turning.updateMatrixWorld();
      const hovered =
        state.hovered === undefined || state.hovered.kind === PICK_KIND.ZONE
          ? undefined
          : placeOf(state.hovered);
      const selected = placeOf(state.selected);
      hoverRing.aim(hovered?.at, hovered?.radius ?? 1);
      selectRing.aim(selected?.at, (selected?.radius ?? 1) * 1.25);
    };

    return {
      update: (state) => {
        latest = state;
        const { view, layers, snapshot } = state;
        uniforms.uMotion.value = state.still ? 0 : 1;
        const nextZones = view.zones.slice(0, FACTORY_WORLD_BOUNDS.MAX_ZONES);
        const rebuilt = station === undefined || !sameStation(zones, nextZones);
        if (rebuilt) {
          for (const unregister of unregisterZones) unregister();
          station?.dispose();
          flashes.clear();
          station = buildStation(nextZones, view.edges, materials, uniforms);
          turning.add(station.root);
          const built = station;
          unregisterZones = [...built.proxies].map(([path, proxy]) =>
            picking.add(proxy, { kind: PICK_KIND.ZONE, id: path }),
          );
        }
        zones = nextZones;
        const built = station;
        if (built === undefined) return;
        if (rebuilt || state.dark !== dark) {
          dark = state.dark;
          sky.setDark(state.dark);
          uniforms.uLight.value = state.dark ? 0 : 1;
          setAppearance(scene, state.dark);
        }

        const agent = state.selected?.kind === PICK_KIND.AGENT ? state.selected.id : undefined;
        if (agent !== selectedAgent) uniforms.uBlastTime.value = 0;
        selectedAgent = agent;
        spinning = state.selected === undefined;

        damage.update(
          layers.defects ? snapshot.defects : [],
          built.bodies,
          built.fallback,
          rebuilt,
        );
        paintZones(state, built, signals, palette, damage.severityOf(), flashes);
        crew.update(crewPlansOf(state, built), state.still, elapsedNow);
        lights.update(
          view.timeline,
          built.bodies,
          view.snapshotAt,
          chosenTargets(state),
          layers.shipped,
        );
        fleet.update(layers.planned ? snapshot.planned : [], built.bodies, chosenTargets(state));
        damage.group.visible = layers.defects;
        fleet.group.visible = layers.planned;
        if (state.still || !layers.shipped || !state.live) pods.clear();
        if (state.still) {
          streaks.clear();
          bursts.clear();
        }

        const origin = agent === undefined ? undefined : view.agentById.get(agent);
        const originBody =
          origin?.primaryZone === null || origin === undefined
            ? undefined
            : built.bodies.get(origin.primaryZone);
        ripple.mesh.visible = originBody !== undefined && state.blast.size > 0;
        if (originBody !== undefined) ripple.origin.copy(originBody.center);
        aimRings(state);
      },
      frame: (delta, elapsed) => {
        const state = latest;
        const built = station;
        if (state === undefined || built === undefined) return;
        elapsedNow = elapsed;
        uniforms.uTime.value = elapsed;
        uniforms.uBlastTime.value += delta;
        if (spinning) turning.rotation.y -= delta * STATION_SPIN;
        built.gimbal.rotation.y = elapsed * 0.25;
        sky.step(elapsed);
        turning.updateMatrixWorld();
        crew.frame(elapsed, delta, toStation(host.camera.camera.position.clone()));
        lights.frame(elapsed, false);
        const live = state.live;
        fleet.frame(elapsed, delta, live && state.layers.planned ? send : undefined);
        damage.frame(
          elapsed,
          delta,
          false,
          live && state.layers.defects ? { streaks, sparks } : undefined,
        );
        if (live && state.layers.shipped) {
          pods.frame(
            delta,
            state.view.timeline,
            (entry) => {
              const body = entry.zonePaths
                .map((path) => built.bodies.get(path))
                .find((found) => found !== undefined);
              const spot = body?.spots[Math.floor(Math.random() * body.spots.length)];
              if (body === undefined || spot === undefined) return undefined;
              const at = turning.localToWorld(spot.point.clone().addScaledVector(spot.normal, 0.8));
              const out = spot.normal.clone().transformDirection(turning.matrixWorld);
              return { at, out, body };
            },
            { sparks, bursts, flash, toStation },
          );
        }
        sparks.step(delta);
        streaks.step(delta);
        bursts.step(delta);
        if (flashes.size > 0) {
          for (const [body, running] of flashes) {
            running.strength -= delta * FLASH_FADE;
            if (running.strength <= 0) flashes.delete(body);
          }
          paintZones(state, built, signals, palette, damage.severityOf(), flashes);
        }
        aimRings(state);
      },
      dispose: () => {
        for (const unregister of unregisterZones) unregister();
        station?.dispose();
      },
    };
  },
};
