import { SCENE_GROUND, SIGNAL_COLOR } from "@luke/ui/factory-world";
import {
  ACESFilmicToneMapping,
  InstancedMesh,
  Line,
  type Material,
  Mesh,
  type Object3D,
  PCFSoftShadowMap,
  PerspectiveCamera,
  Points,
  Scene,
  Sprite,
  SRGBColorSpace,
  Texture,
  WebGLRenderer,
} from "three";
import type { FactorySceneHandle, FactorySceneProps } from "../contract";
import type { PickTarget, WorldHost, WorldInstance, WorldState } from "../world";
import { cameraRig } from "./camera-rig";
import { type PickPointer, sameTarget, scenePicking } from "./picking";

/**
 * scene-host.ts -- the one WebGL scene every world draws in: its renderer and canvas, the loop that draws only while something moves and rests while the page is hidden or the world is not shown, the pointer's hover and press, and everything let go on unmount.
 *
 * One renderer stands per mounted world, fitted to its box and capped at
 * `MAX_PIXEL_RATIO`, tone-mapped so a world's lights read the same in every
 * world. The loop runs on animation frames while the scene is on screen and
 * the page is visible, and draws a frame only when the camera moved, the
 * state changed, the world asked, or the world animates; held still, a world
 * is never stepped. A move of the pointer is picked once per frame, and a
 * press that did not drag picks what it landed on. Unmounting disposes the
 * world, then every geometry, material, and texture left in the scene, then
 * the renderer and its context, so choosing another world leaves nothing of
 * the last on the GPU.
 */

/** The most device pixels drawn per CSS pixel: a Retina display's two, and no more, since a third costs more than it shows. */
const MAX_PIXEL_RATIO = 2;

/** How far a press may move, in CSS pixels, and still be a press rather than a drag. */
const PRESS_SLOP_PX = 4;

/** The longest a frame's step may be, in seconds, so a frame after a rest does not leap. */
const LONGEST_STEP = 0.1;

/** Lets go of a material and every texture it holds, under whatever name it holds it. */
function disposeMaterial(material: Material): void {
  for (const value of Object.values(material)) {
    if (value instanceof Texture) value.dispose();
  }
  material.dispose();
}

/** Lets go of every geometry, material, and texture under `root`, and what the scene itself is lit and backed by. */
function disposeTree(root: Scene): void {
  root.traverse((object: Object3D) => {
    if (object instanceof InstancedMesh) object.dispose();
    if (
      object instanceof Mesh ||
      object instanceof Line ||
      object instanceof Points ||
      object instanceof Sprite
    ) {
      object.geometry.dispose();
      const materials: Material[] = Array.isArray(object.material)
        ? object.material
        : [object.material];
      for (const material of materials) disposeMaterial(material);
    }
  });
  if (root.background instanceof Texture) root.background.dispose();
  if (root.environment instanceof Texture) root.environment.dispose();
}

/** Mounts `props.world` in `element`. */
export function mountScene(element: HTMLElement, props: FactorySceneProps): FactorySceneHandle {
  const renderer = new WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;
  const canvas = renderer.domElement;
  canvas.className = "factory-world-canvas";
  element.append(canvas);

  const scene = new Scene();
  const camera = new PerspectiveCamera(40, 1, 0.1, 500);
  const picking = scenePicking();
  let state: WorldState = props.state;
  let shownOnPage = true;
  let dirty = true;
  let frame: number | undefined;
  let lastTime: number | undefined;
  let elapsed = 0;
  let pointer: PickPointer | undefined;
  let pointerMoved = false;
  let pressedAt: { readonly x: number; readonly y: number } | undefined;
  let hovered: PickTarget | undefined;
  let world: WorldInstance | undefined;

  const running = () => shownOnPage && !document.hidden;
  const redraw = () => {
    dirty = true;
    if (frame === undefined && running()) frame = requestAnimationFrame(tick);
  };
  const hover = () => {
    pointerMoved = false;
    // Note that a drag names nothing, since the camera moves under the pointer rather than the pointer over the world.
    const target =
      pointer === undefined || pressedAt !== undefined ? undefined : picking.pick(pointer, camera);
    if (target === undefined && hovered === undefined) return;
    hovered = target;
    props.onHover(
      target === undefined || pointer === undefined
        ? undefined
        : { target, at: { x: pointer.x, y: pointer.y } },
    );
  };
  function tick(time: number): void {
    frame = undefined;
    if (!running()) {
      lastTime = undefined;
      return;
    }
    const delta = lastTime === undefined ? 0 : Math.min(LONGEST_STEP, (time - lastTime) / 1000);
    lastTime = time;
    const moved = rig.step(delta);
    const animating = !state.still && world?.frame !== undefined;
    if (animating) {
      elapsed += delta;
      world?.frame?.(delta, elapsed);
    }
    if (pointerMoved) hover();
    if (dirty || moved || animating) {
      dirty = false;
      renderer.render(scene, camera);
    }
    // Note that a still scene rests once nothing moves, and the next change wakes it.
    if (animating || moved || pointerMoved) frame = requestAnimationFrame(tick);
    else lastTime = undefined;
  }

  // Note that the pointer's orbit, pan, and zoom move the camera from the controls' own handlers, which only need a frame drawn.
  const rig = cameraRig(camera, canvas, props.onAway, redraw);
  rig.setStill(state.still);
  const host: WorldHost = {
    scene,
    camera: rig,
    palette: { signal: SIGNAL_COLOR, ground: SCENE_GROUND },
    picking,
    invalidate: redraw,
  };
  // Note that a world that throws as it is set up takes the renderer down with it, since no handle reaches the page to unmount it by.
  try {
    world = props.world.create(host);
    world.update(state);
  } catch (failure) {
    world?.dispose();
    picking.clear();
    rig.dispose();
    disposeTree(scene);
    renderer.dispose();
    renderer.forceContextLoss();
    canvas.remove();
    throw failure;
  }
  const created = world;

  const resize = new ResizeObserver(() => {
    const width = element.clientWidth;
    const height = element.clientHeight;
    renderer.setSize(width, height, false);
    rig.fit(width, height);
    redraw();
  });
  resize.observe(element);

  const pointerOf = (event: PointerEvent): PickPointer => {
    const box = canvas.getBoundingClientRect();
    return {
      x: event.clientX - box.left,
      y: event.clientY - box.top,
      width: box.width,
      height: box.height,
    };
  };
  const onPointerMove = (event: PointerEvent) => {
    pointer = pointerOf(event);
    pointerMoved = true;
    redraw();
  };
  const onPointerLeave = () => {
    pointer = undefined;
    pointerMoved = true;
    redraw();
  };
  const onPointerDown = (event: PointerEvent) => {
    pressedAt = { x: event.clientX, y: event.clientY };
    pointerMoved = true;
    redraw();
  };
  const onPointerUp = (event: PointerEvent) => {
    const from = pressedAt;
    pressedAt = undefined;
    pointerMoved = true;
    redraw();
    if (from === undefined) return;
    if (Math.hypot(event.clientX - from.x, event.clientY - from.y) > PRESS_SLOP_PX) return;
    props.onPick(picking.pick(pointerOf(event), camera));
  };
  const onVisibility = () => redraw();
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerleave", onPointerLeave);
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointerup", onPointerUp);
  document.addEventListener("visibilitychange", onVisibility);
  redraw();

  return {
    show: (next) => {
      const chose = next.selected !== undefined && !sameTarget(next.selected, state.selected);
      state = next;
      rig.setStill(next.still);
      created.update(next);
      const anchor =
        chose && next.selected !== undefined ? picking.anchorOf(next.selected) : undefined;
      if (anchor !== undefined) rig.flyTo(anchor);
      redraw();
    },
    setShown: (next) => {
      shownOnPage = next;
      redraw();
    },
    home: () => {
      rig.home();
      redraw();
    },
    unmount: () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      frame = undefined;
      shownOnPage = false;
      resize.disconnect();
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointerup", onPointerUp);
      document.removeEventListener("visibilitychange", onVisibility);
      created.dispose();
      picking.clear();
      rig.dispose();
      disposeTree(scene);
      scene.clear();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
}
