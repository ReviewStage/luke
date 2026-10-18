import { type AgentView, agentDrawnUnder } from "@luke/ui/factory-world";
import { Color, type Vector3 } from "three";
import { PICK_KIND, type PickKind, type WorldModule, type WorldState } from "../../world";
import { agentsOf } from "./agents";
import { type CityLayout, cityLayoutOf, laidOutFrom } from "./city";
import { defectsOf } from "./defects";
import { districtsOf, type ZoneLight } from "./districts";
import { seededRandom } from "./geometry";
import { pipesOf } from "./pipes";
import { plannedOf } from "./planned";
import { MOOD, type Mood, seaOf } from "./sea";
import { seabedOf } from "./seabed";
import { shippedOf } from "./shipped";
import { billboardsOf, PARTICLE_LAYER, particlesOf, pingsOf, SPRITE_KIND } from "./sprites";

/**
 * index.ts -- Atlantis: the repository as a city under the sea, its core a cluster of crystals under a great glass dome, its domain a ring of domed towns, its surface reefs with lighthouses, its tooling rigs on the rim, and Luke's coding agents divers building domes of their own beside the zones they work in.
 *
 * The signals each have their own metaphor. Building is a diver's dome
 * going up, as large as its pull request; shipped is anemones blooming where
 * the work landed, fish schooling and light rising over the districts most
 * alive with it; planned is a hologram of a dome not yet built, tethered to
 * the zones its work will touch and woken by the plaza's sonar; a defect is
 * damage, a crack in the glass leaking bubbles and ink, and a kraken at the
 * worst of them. A selected agent's blast radius ripples out ring by ring
 * across the zones that depend on its work, and the rest of the city dims.
 *
 * It glows without a bloom pass: every light is an additive sprite or an
 * emissive surface, fogged with the water, so the world is one render of a
 * few dozen instanced draws. Each part lives in its own module, and this
 * one hands each the state it draws.
 */

/** The establishing shot: high over the city, looking down at the great dome from the south-east. */
const HOME = {
  position: { x: Math.cos(0.65) * 240, y: 150, z: Math.sin(0.65) * 240 },
  target: { x: 0, y: 10, z: 0 },
} as const;

/** How near the camera may come to what it looks at, and how far it may pull back. */
const REACH = { NEAREST: 6, FARTHEST: 640 } as const;

/** The sprites and particles drawn at once, at most. */
const SPRITES = { GLOWS: 5000, BUBBLES: 5000, INK: 400, PARTICLES: 5000, PINGS: 24 } as const;

/** How much a defect hurts a zone's ring: its events, of this many, and never less than a third. */
const HURT_EVENTS = 30;

/** Whether the developer chose or hovers the item of `kind` and `id`. */
function chosen(state: WorldState, kind: PickKind, id: string): boolean {
  return [state.selected, state.hovered].some(
    (target) => target?.kind === kind && target.id === id,
  );
}

/** Whether an agent stands drawn: every agent while building is shown, and a failed one while defects are. */
function agentShown(state: WorldState, agent: AgentView): boolean {
  return agentDrawnUnder(agent, state.layers);
}

export const world: WorldModule = {
  create: (host) => {
    const { scene, picking, palette } = host;
    host.camera.setHome(HOME.position, HOME.target);
    host.camera.setReach(REACH.NEAREST, REACH.FARTHEST);

    const sea = seaOf(palette);
    const seabed = seabedOf(scene, sea);
    const districts = districtsOf(scene, sea, picking);
    const pipes = pipesOf(scene, sea);
    const planned = plannedOf(scene, sea, picking);
    const defects = defectsOf(scene, sea, picking);
    const agents = agentsOf(scene, sea, picking, host.camera.camera);
    const glows = billboardsOf(sea, SPRITES.GLOWS, SPRITE_KIND.GLOW);
    const bubbles = billboardsOf(sea, SPRITES.BUBBLES, SPRITE_KIND.BUBBLE);
    const inks = billboardsOf(sea, SPRITES.INK, SPRITE_KIND.INK);
    const pings = pingsOf(sea, SPRITES.PINGS);
    const shipped = shippedOf(scene, sea, picking, districts);
    const particles = particlesOf(SPRITES.PARTICLES, seededRandom(9));
    scene.add(glows.mesh, bubbles.mesh, inks.mesh, pings.mesh);
    const blast = new Color(palette.signal.BLAST_RADIUS);
    const selection = new Color(palette.signal.SELECTION);

    let layout: CityLayout | undefined;
    let lights: ZoneLight[] = [];
    let state: WorldState | undefined;
    let mood: Mood | undefined;
    let elapsed = 0;
    let rippleFrom: string | undefined;

    const layerShown = (layer: number) => {
      if (state === undefined) return false;
      if (layer === PARTICLE_LAYER.BUILDING) return state.layers.building;
      if (layer === PARTICLE_LAYER.SHIPPED) return state.layers.shipped;
      if (layer === PARTICLE_LAYER.DEFECTS) return state.layers.defects;
      return true;
    };
    const paint = (moving: boolean) => {
      glows.begin();
      bubbles.begin();
      inks.begin();
      particles.draw(bubbles, glows, layerShown);
      seabed.paint(glows, elapsed);
      districts.glow(glows, elapsed, lights, moving);
      shipped.paint(glows);
      defects.paint(glows, inks, elapsed);
      agents.paint(glows, elapsed, moving);
      glows.end();
      bubbles.end();
      inks.end();
    };
    const sendPing = (centre: Vector3) => pings.send(centre, 0.7, 260, blast, 3.2, elapsed);

    /** How each district is lit on `next`: chosen, in the blast radius, alive with shipped work, hurt. */
    const lightUp = (city: CityLayout, next: WorldState) => {
      const hurt = new Map<string, number>();
      if (next.layers.defects) {
        for (const defect of next.snapshot.defects) {
          for (const path of defect.zonePaths) {
            hurt.set(
              path,
              Math.max(hurt.get(path) ?? 0, Math.min(1, defect.events / HURT_EVENTS + 0.3)),
            );
          }
        }
      }
      const focused = next.blast.size > 0;
      city.districts.forEach((district, index) => {
        const light = lights[index];
        if (light === undefined) return;
        const path = district.zone.path;
        const steps = next.blast.get(path);
        const picked = chosen(next, PICK_KIND.ZONE, path);
        if (picked) {
          light.lit = 1.2;
          light.highlight.copy(selection);
        } else if (steps !== undefined) {
          light.lit = 0.15 + 1 / (1 + steps * 0.6);
          light.highlight.copy(blast);
        } else {
          light.lit = 0;
          light.highlight.copy(blast);
        }
        light.steps = steps ?? -1;
        light.dim = focused && steps === undefined && !picked ? 0.28 : 1;
        light.alive = next.layers.shipped ? district.zone.alive : 0;
        light.hurt = hurt.get(path) ?? 0;
      });
    };

    return {
      update: (next) => {
        state = next;
        const moving = !next.still;
        sea.uniforms.uMotion.value = moving ? 1 : 0;
        const nextMood = next.dark ? MOOD.DEEP : MOOD.SHALLOWS;
        if (nextMood !== mood) {
          mood = nextMood;
          sea.enter(nextMood);
          seabed.enter(nextMood);
        }
        const { view, snapshot, layers } = next;
        if (layout === undefined || !laidOutFrom(layout, view.zones)) {
          layout = cityLayoutOf(view.zones);
          districts.build(layout);
          seabed.settle(layout);
          lights = layout.districts.map(() => ({
            lit: 0,
            highlight: new Color(),
            steps: -1,
            dim: 1,
            alive: 0,
            hurt: 0,
          }));
        }
        const city = layout;
        lightUp(city, next);
        // Note that a newly selected agent's ripple sets out from the moment it was chosen.
        const selectedAgent =
          next.selected?.kind === PICK_KIND.AGENT ? next.selected.id : undefined;
        if (selectedAgent !== rippleFrom) {
          rippleFrom = selectedAgent;
          sea.uniforms.uRippleAt.value = elapsed;
        }
        districts.paint(city, lights);
        pipes.draw(city, view.edges, lights);
        shipped.draw(
          city,
          view.timeline,
          view.snapshotAt,
          (url) => chosen(next, PICK_KIND.SHIPPED, url),
          layers.shipped,
          lights.map((light) => light.alive),
        );
        planned.draw(
          city,
          snapshot.planned,
          (identifier) => chosen(next, PICK_KIND.PLANNED, identifier),
          layers.planned,
        );
        seabed.sweep(layers.planned);
        defects.draw(
          city,
          snapshot.defects,
          (id) => chosen(next, PICK_KIND.DEFECT, id),
          layers.defects,
        );
        agents.draw(
          city,
          view.agents,
          (agent) => agentShown(next, agent),
          (id) => chosen(next, PICK_KIND.AGENT, id),
          selectedAgent,
          elapsed,
          moving,
        );
        if (!moving) {
          shipped.quiet();
          particles.clear();
          pings.clear();
          planned.sweep(elapsed, false);
        }
        paint(moving);
      },
      frame: (delta, now) => {
        elapsed = now;
        sea.uniforms.uTime.value = now;
        seabed.step(delta, now, particles);
        agents.step(delta, now, particles, sendPing);
        shipped.step(delta, now, state?.live === true, particles);
        defects.step(delta, now, particles);
        planned.sweep(now, true);
        particles.step(delta);
        pings.step(now);
        paint(true);
      },
      dispose: () => {
        scene.fog = null;
      },
    };
  },
};
