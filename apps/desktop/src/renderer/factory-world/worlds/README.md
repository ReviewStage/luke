# Factory worlds

A world is one way of drawing a repository as a software factory: a citadel,
a planet, a railway. Every world draws the same reading
(`@luke/ui/factory-world`) on the same host (`../scene/`), so a world is
geometry and nothing else. The host owns the renderer, the loop, the camera,
picking, the data read, the scrubber, and every word on screen; the world
owns its meshes.

`dev/` is the smallest complete world. Read it first.

## Adding a world

A world is one folder and one registry entry. Nothing else changes.

1. Make `worlds/<key>/index.ts`, exporting `world: WorldModule` (`../world.ts`).
   The folder name is the key: lowercase, one word, never `board`.
2. Add one entry to `FACTORY_WORLDS` in `../registry.ts`:

   ```ts
   { key: "citadel", name: "Citadel", icon: CastleIcon, load: () => import("./worlds/citadel/index") },
   ```

   `icon` is a Lucide glyph, and the picker lists worlds in registry order.
3. Build once with `LUKE_UPDATE_BUNDLE_BUDGET=1` and commit the new
   `renderer/factory-world-<key>.js` line in `apps/desktop/bundle-budget.json`
   (see [Budget](#budget)).

`scripts/build.mjs` finds the folder and builds it as its own bundle,
`factory-world-<key>.js`. That bundle is imported the first time the world is
chosen, so one world's weight never loads with another's, and none of it
loads in `panel.js`. Every `index.ts` under `worlds/*/` is a knip entry. Any
other file in the folder is reached through its imports.

## The interface

```ts
export const world: WorldModule = {
  create: (host) => {
    // Build the scene once: lights, ground, meshes, picking registrations.
    host.camera.setHome({ x: 0, y: 34, z: 42 }, { x: 0, y: 0, z: 0 });
    host.camera.setReach(4, 80);
    return {
      update: (state) => { /* redraw from state; called on every change */ },
      frame: (delta, elapsed) => { /* optional; idle motion only */ },
      dispose: () => { /* release anything outside the scene */ },
    };
  },
};
```

What `create` gets (`WorldHost`):

| Field | What it is |
| --- | --- |
| `scene` | The `Scene` the host renders. Add lights and geometry here. |
| `camera.camera` | The `PerspectiveCamera`. The host drives it, so don't move it yourself. |
| `camera.setHome(position, target)` | The establishing shot, which the scene opens on and Esc and the home button fly back to. Scale it to your geometry. |
| `camera.setReach(nearest, farthest)` | Zoom limits, in scene units. |
| `palette.signal` | `SIGNAL_COLOR`: planned, building, shipped, defect, blast radius, selection. |
| `palette.ground` | `SCENE_GROUND.LIGHT` and `.DARK`, the ground colours the signals are checked against. |
| `picking.add(object, target)` | Makes an object, and everything under it, pickable as one target. Returns an unregister function. |
| `picking.addInstances(mesh, targetOf)` | Makes each instance of an `InstancedMesh` its own target, or none. |
| `invalidate()` | Asks for a frame, for a change you made outside `update` or `frame`. |

What `update(state)` gets (`WorldState`), whole, on every change:

| Field | What it is |
| --- | --- |
| `view` | The `FactoryWorldView` at the scrubber's instant: zones (layer, ring, `x`/`y`, `footprint`, `alive`), edges, agents (state, kind, `primaryZone`, `touched`, `buildSize`), timeline, and pipeline counts. |
| `snapshot` | The `FactoryWorld` the view was read from, at the same instant. Draw the planned issues (`snapshot.planned`) and defects (`snapshot.defects`) from it, each placed on its `zonePaths`. |
| `live` | `true` when the scrubber is at now. |
| `selected`, `hovered` | `PickTarget`s (`{ kind, id }`) to highlight. Draw both in `SIGNAL_COLOR.SELECTION`. |
| `blast` | The selected agent's blast radius: zone path to distance, where 0 means touched. Empty when no agent is selected. |
| `layers` | `{ planned, building, shipped, defects }`, which the pipeline bar's counts switch. Leave out what is off. |
| `still` | `true` under reduced motion or a capture run (see [Motion](#motion)). |
| `dark` | The window's appearance. Dress your ground to match. |

`PickTarget` ids: an agent is its `id`, a zone its `path`, a shipped PR its
`url`, a planned issue its `identifier`, and a defect its `id`. The host
resolves them for the hover label and the card, and flies the camera to a
newly selected target that you registered.

## What the host already does

Don't rebuild any of this:

- **Rendering:** one `WebGLRenderer` with tone mapping (ACES Filmic), sRGB
  output, PCF soft shadows enabled, and DPR capped at 2.
- **Loop:** draws only when something changed, and stops while the page is
  hidden or the world is off screen.
- **Camera:** orbit, pan and zoom with damping, a tweened fly-to on selection,
  and home on Esc or the home button. Esc returns to the overview before it
  leaves Factory.
- **Picking:** raycasts first, then falls back to the nearest registered
  target within 18 px on screen. Hidden objects are never picked. A drag never
  picks. An instanced mesh's bounds are recomputed on every pick, so moving
  instances never makes them unpickable.
- **Chrome, all DOM over the canvas:** the pipeline bar (its counts are the
  layer toggles), the hover label, the selection card (PR number, title, +/−
  bar, mini blast radius, and doors to the agent's page, the PR on GitHub and
  the task), the time scrubber, and the home button.
- **Data:** reads the snapshot on open, refreshes it every three minutes while
  shown, and handles the loading, empty and failed states.
- **Disposal:** when the world goes, the host calls your `dispose`, then
  disposes every geometry, material and texture left in the scene, then the
  renderer and its context.

## Rules

- **No words in the scene.** Every name lives in the host's DOM chrome, which
  session replay masks. Canvas recording is off, and a word drawn into a
  texture would be one more thing to keep it off for. Don't use text
  geometry, CSS2D/CSS3D labels, or canvas textures with text.
- **Use the palette unchanged.** A signal is the same colour in every world.
  Your zones, ground and props are yours to dress, but planned, building,
  shipped, defects, blast radius and selection use `palette.signal` as is.
- **View-only.** A world reads `state` and draws. It never calls the act
  channel, the DOM, timers, or the network.
- **Scene code here, readings in the package.** The layout check
  (`scripts/repository-checks.sh`) treats `three` as a platform, so a file
  that imports it, or imports the host (`../../world`), may live here. A file
  that imports neither is logic, and the check refuses it. A reading every
  world could share (a new count, a new grouping of zones) belongs in
  `@luke/ui/factory-world`, in a PR of its own.
- **Scale the layout yourself.** Layout units are polar: rings are one unit
  wide, the radius is under 4, and `footprint` runs from 0.15 to 1 relative to
  the largest zone. Pick a scale (`dev/` uses 6.5) and resolve your own
  overlaps.

## Motion

When `state.still` is `true`, the host never calls `frame`, and a camera
flight lands at once. Draw a still frame that says everything a moving one
would: a stuck agent should look stuck without its animation. `still` follows
the same `--loop-motion` token that holds Luke's face and the spinners still
(`apps/desktop/src/renderer/CLAUDE.md`, "Panel motion").

`frame(delta, elapsed)` is for idle motion only, such as a bob, a crane or a
glow. Never put state there: `update` is the only source of what to draw.

## Performance

- **60 fps on a MacBook Air** with 200 zones, 100 agents, 200 shipped PRs and
  50 planned issues (the contract's bounds, `FACTORY_WORLD_BOUNDS`).
- **Instancing:** draw anything there can be many of as an `InstancedMesh`
  allocated at its bound, and set `.count` on each update. Never one mesh per
  agent. Register it with `picking.addInstances`.
- **Allocate in `create`, not `update`.** `update` runs on every hover, so
  reuse geometries, materials and scratch `Object3D`/`Color`/`Matrix4`.
  Change instance matrices and colours, not meshes.
- **Keep draw calls in the tens.** Merge static props into one geometry.
- **Shadows:** at most one shadow-casting light, with a shadow map of 2048 px
  or less.
- **No post-processing passes** unless the budget delta says why.
- **Textures:** none if you can manage it, and small ones if not. Anything a
  world loads must ship in its bundle, because the panel's CSP is
  `script-src 'self'` and its `connect-src` allows no asset host.

## Budget

Each world is its own entry in `apps/desktop/bundle-budget.json`
(`renderer/factory-world-<key>.js`). It is measured beyond what the panel and
the scene host have already loaded (`LOADED_AFTER` in `scripts/build.mjs`), so
the number is your world's own code plus any part of Three.js that only your
world reaches. The build fails on a renderer entry with no baseline, so:

```sh
LUKE_UPDATE_BUNDLE_BUDGET=1 pnpm --filter @luke/desktop build
git diff apps/desktop/bundle-budget.json
```

Commit your world's new line, and put the size in the PR body. If reaching
more of Three.js than the host does also moves the host's own line
(`renderer/factory-world.js`), commit that line too and say so. Revert any
other line the run rewrote: those numbers are other PRs' decisions.

## Checklist

- [ ] `worlds/<key>/index.ts` exports `world: WorldModule`. The folder holds nothing outside the world.
- [ ] One entry in `FACTORY_WORLDS` (`../registry.ts`), with a Lucide icon.
- [ ] `create` sets `camera.setHome` and `camera.setReach` for your scale.
- [ ] Zones, agents and shipped PRs are pickable. Planned issues and defects are too, where you draw them.
- [ ] `selected`, `hovered` and `blast` are visible, in `SIGNAL_COLOR.SELECTION` and `SIGNAL_COLOR.BLAST_RADIUS`.
- [ ] Every `layers` switch hides what it names.
- [ ] Scrubbing (`live: false`) redraws from `view` alone. Nothing depends on wall-clock time.
- [ ] With `still`, the frame says everything. Without it, `frame` only adds idle motion.
- [ ] Light (`SCENE_GROUND.LIGHT`) and dark (`SCENE_GROUND.DARK`) both read.
- [ ] No text in the scene, no network, no DOM, no timers.
- [ ] Instanced meshes at the bounds, with steady 60 fps at 100 agents.
- [ ] Budget line recorded and its size stated in the PR.
- [ ] Picked in a development build (`./scripts/run.sh`), with a screenshot in the PR per `docs/WORKFLOW.md`.
