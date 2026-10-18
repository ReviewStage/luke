import { FACTORY_WORLD_BOUNDS } from "@luke/features/factory-world-wire";
import {
  AGENT_STATE,
  type AgentState,
  agentDrawnUnder,
  ZONE_LAYER,
  type ZoneLayer,
} from "@luke/ui/factory-world";
import {
  AmbientLight,
  BoxGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  InstancedMesh,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  OctahedronGeometry,
} from "three";
import {
  PICK_KIND,
  type PickKind,
  type PickTarget,
  type WorldModule,
  type WorldPalette,
  type WorldState,
} from "../../world";

/**
 * index.ts -- the test pattern: the plainest world that draws every part of the reading, so the scene host can be stood up and checked with no world of its own.
 *
 * It is offered only in a development build (`../../registry.ts`'s
 * `DEV_WORLDS`), never in a packaged app. Each zone is a box on the floor at
 * its layout's place, as wide as its footprint, grey by its layer, glowing
 * the shipped colour as it is alive with merges, and the blast radius's
 * colour where the selected agent's work ripples. Each agent is a diamond
 * over its primary zone in its state's signal, bobbing while motion runs.
 * Both are one instanced mesh each, as a world of a hundred agents should
 * be, and both register for picking per instance. Planned issues and
 * defects are tokens on the floor beside the zone each is placed on first,
 * or on its rim where they are placed on none. It is also the smallest
 * example of the world interface (`../README.md`).
 */

/** Scene units per layout unit: the layout's four rings stand inside a floor 26 units across. */
const SCALE = 6.5;

/** Each layer's grey, the core darkest so it reads as the heart. */
const LAYER_GREY = {
  [ZONE_LAYER.CORE]: "#6b6f78",
  [ZONE_LAYER.DOMAIN]: "#8a8f99",
  [ZONE_LAYER.SURFACE]: "#a9aeb7",
  [ZONE_LAYER.TOOLING]: "#c4c7cd",
} as const satisfies Record<ZoneLayer, string>;

/** The signal each agent state is drawn in: a failed one a defect's, an idle one a surface's grey, and one at work building's. */
function agentColor(state: AgentState, signal: WorldPalette["signal"]): string {
  if (state === AGENT_STATE.FAILED) return signal.DEFECT;
  if (state === AGENT_STATE.IDLE) return LAYER_GREY[ZONE_LAYER.SURFACE];
  return signal.BUILDING;
}

/** Whether the developer chose or hovers the item of `kind` and `id`. */
function chosen(state: WorldState, kind: PickKind, id: string): boolean {
  return [state.selected, state.hovered].some(
    (target) => target?.kind === kind && target.id === id,
  );
}

export const world: WorldModule = {
  create: (host) => {
    const { scene, picking, palette } = host;
    host.camera.setHome({ x: 0, y: 34, z: 42 }, { x: 0, y: 0, z: 0 });
    host.camera.setReach(4, 80);

    scene.add(new AmbientLight("#ffffff", 1.4));
    const sun = new DirectionalLight("#ffffff", 2.2);
    sun.position.set(12, 30, 18);
    scene.add(sun);
    const floorMaterial = new MeshStandardMaterial();
    const floor = new Mesh(new CircleGeometry(SCALE * 4.2, 96), floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);

    const zones = new InstancedMesh(
      new BoxGeometry(1, 1, 1),
      new MeshStandardMaterial({ roughness: 0.8 }),
      FACTORY_WORLD_BOUNDS.MAX_ZONES,
    );
    const agents = new InstancedMesh(
      new OctahedronGeometry(0.55),
      new MeshStandardMaterial({ roughness: 0.4 }),
      FACTORY_WORLD_BOUNDS.MAX_AGENTS,
    );
    // Note that planned issues and defects are tokens on the floor beside the zone each is placed on first.
    const markers = new InstancedMesh(
      new CylinderGeometry(0.5, 0.5, 0.25, 6),
      new MeshStandardMaterial({ roughness: 0.6 }),
      FACTORY_WORLD_BOUNDS.MAX_PLANNED + FACTORY_WORLD_BOUNDS.MAX_DEFECTS,
    );
    scene.add(zones, agents, markers);

    let zoneTargets: PickTarget[] = [];
    let agentTargets: PickTarget[] = [];
    let agentBases: { x: number; y: number; z: number; bobs: boolean }[] = [];
    picking.addInstances(zones, (instanceId) => zoneTargets[instanceId]);
    picking.addInstances(agents, (instanceId) => agentTargets[instanceId]);
    let markerTargets: PickTarget[] = [];
    picking.addInstances(markers, (instanceId) => markerTargets[instanceId]);

    const placing = new Object3D();
    const tint = new Color();
    const placeAgents = (elapsed: number) => {
      agentBases.forEach((base, index) => {
        const bob = base.bobs ? Math.sin(elapsed * 2 + index) * 0.25 : 0;
        placing.position.set(base.x, base.y + bob, base.z);
        placing.rotation.set(0, base.bobs ? elapsed : 0, 0);
        placing.scale.setScalar(1);
        placing.updateMatrix();
        agents.setMatrixAt(index, placing.matrix);
      });
      agents.instanceMatrix.needsUpdate = true;
    };

    return {
      update: (state) => {
        const { view, layers, blast } = state;
        const ground = state.dark ? palette.ground.DARK : palette.ground.LIGHT;
        scene.background = new Color(ground);
        floorMaterial.color.set(ground).offsetHSL(0, 0, state.dark ? 0.06 : -0.06);

        const shownZones = view.zones.slice(0, FACTORY_WORLD_BOUNDS.MAX_ZONES);
        zoneTargets = shownZones.map((zone) => ({ kind: PICK_KIND.ZONE, id: zone.path }));
        shownZones.forEach((zone, index) => {
          const width = 0.6 + zone.footprint * 2.2;
          const height = 0.3 + zone.footprint * 2.4;
          placing.position.set(zone.x * SCALE, height / 2, zone.y * SCALE);
          placing.rotation.set(0, 0, 0);
          placing.scale.set(width, height, width);
          placing.updateMatrix();
          zones.setMatrixAt(index, placing.matrix);
          if (chosen(state, PICK_KIND.ZONE, zone.path)) tint.set(palette.signal.SELECTION);
          else if (blast.has(zone.path)) tint.set(palette.signal.BLAST_RADIUS);
          else if (layers.shipped && zone.alive > 0.05) {
            tint.set(LAYER_GREY[zone.layer]).lerp(new Color(palette.signal.SHIPPED), zone.alive);
          } else tint.set(LAYER_GREY[zone.layer]);
          zones.setColorAt(index, tint);
        });
        zones.count = shownZones.length;
        zones.instanceMatrix.needsUpdate = true;
        if (zones.instanceColor !== null) zones.instanceColor.needsUpdate = true;

        // Note that an agent stands over its primary zone, one above another where several build there.
        const drawn = view.agents.flatMap((agent) => {
          const zone =
            agent.primaryZone === null ? undefined : view.zoneByPath.get(agent.primaryZone);
          const shown = agentDrawnUnder(agent, layers);
          return zone === undefined || !shown ? [] : [{ agent, zone }];
        });
        agentTargets = drawn.map(({ agent }) => ({ kind: PICK_KIND.AGENT, id: agent.id }));
        const stacked = new Map<string, number>();
        agentBases = drawn.map(({ agent, zone }) => {
          const below = stacked.get(zone.path) ?? 0;
          stacked.set(zone.path, below + 1);
          return {
            x: zone.x * SCALE,
            y: 0.3 + zone.footprint * 2.4 + 1 + below * 1.3,
            z: zone.y * SCALE,
            bobs: agent.state === AGENT_STATE.WORKING,
          };
        });
        drawn.forEach(({ agent }, index) => {
          tint.set(
            chosen(state, PICK_KIND.AGENT, agent.id)
              ? palette.signal.SELECTION
              : agentColor(agent.state, palette.signal),
          );
          agents.setColorAt(index, tint);
        });
        agents.count = drawn.length;
        if (agents.instanceColor !== null) agents.instanceColor.needsUpdate = true;
        placeAgents(0);

        const marked = [
          ...(layers.planned ? state.snapshot.planned : []).map((issue) => ({
            target: { kind: PICK_KIND.PLANNED, id: issue.identifier },
            zonePath: issue.zonePaths[0],
            color: palette.signal.PLANNED,
          })),
          ...(layers.defects ? state.snapshot.defects : []).map((defect) => ({
            target: { kind: PICK_KIND.DEFECT, id: defect.id },
            zonePath: defect.zonePaths[0],
            color: palette.signal.DEFECT,
          })),
        ];
        markerTargets = marked.map(({ target }) => target);
        const besideZone = new Map<string, number>();
        marked.forEach(({ target, zonePath, color }, index) => {
          const zone = zonePath === undefined ? undefined : view.zoneByPath.get(zonePath);
          // Note that one placed on no zone stands on the floor's rim, spaced by its order.
          const around = besideZone.get(zonePath ?? "") ?? 0;
          besideZone.set(zonePath ?? "", around + 1);
          const angle =
            zone === undefined ? (index / Math.max(1, marked.length)) * Math.PI * 2 : around * 0.9;
          const radius = zone === undefined ? SCALE * 3.9 : 0.6 + zone.footprint * 1.4 + 0.6;
          placing.position.set(
            (zone?.x ?? 0) * SCALE + Math.cos(angle) * radius,
            0.15,
            (zone?.y ?? 0) * SCALE + Math.sin(angle) * radius,
          );
          placing.rotation.set(0, 0, 0);
          placing.scale.setScalar(1);
          placing.updateMatrix();
          markers.setMatrixAt(index, placing.matrix);
          tint.set(chosen(state, target.kind, target.id) ? palette.signal.SELECTION : color);
          markers.setColorAt(index, tint);
        });
        markers.count = marked.length;
        markers.instanceMatrix.needsUpdate = true;
        if (markers.instanceColor !== null) markers.instanceColor.needsUpdate = true;
      },
      frame: (_delta, elapsed) => placeAgents(elapsed),
      dispose: () => undefined,
    };
  },
};
