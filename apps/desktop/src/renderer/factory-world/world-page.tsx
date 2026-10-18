import { useAtomValue } from "@effect/atom-react";
import type { FactoryWorld } from "@luke/features/factory-world-wire";
import { cssCustomProperties, EmptyState, ERROR_STATE_PLACEMENT, ErrorState } from "@luke/ui";
import { taskBlastRadiusOf } from "@luke/ui/factory-campus";
import {
  blastRadiusOf,
  factoryWorldAsOf,
  factoryWorldViewOf,
  SIGNAL_COLOR,
} from "@luke/ui/factory-world";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { FactoryIcon } from "lucide-react";
import {
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useSideBundles, WORLD_LOAD_FAILED, worldBundleAtom } from "../bundle-loader";
import { SpinnerRegion } from "../spinner";
import type { TasksControl } from "../tasks/use-tasks-tab";
import { usePrefersReducedMotion } from "../use-reduced-motion";
import { CampusScene } from "./campus/campus-scene";
import type {
  FactorySceneHandle,
  FactorySceneModule,
  SceneHover,
  StageSceneProps,
} from "./contract";
import type { WorldEntry } from "./registry";
import { useFactoryWorld } from "./use-factory-world";
import {
  PICK_KIND,
  type PickTarget,
  WORLD_LAYER,
  type WorldLayer,
  type WorldLayers,
  type WorldModule,
  type WorldState,
} from "./world";
import { HomeButton, HoverLabel, namingOf, PipelineBar, Scrubber, WorldCard } from "./world-chrome";

/**
 * world-page.tsx -- a Factory world or the campus in the board's place: the workspace's snapshot read, the scene it is drawn in, and the chrome every one shares over it.
 *
 * Until the snapshot is read a ring stands where the world will; a read that
 * failed says so with Retry, and a workspace with no repository to draw is
 * the app's empty state, as the board says it holds nothing. Once read, the
 * scene is drawn over the view the scrubber's instant reads, and the chrome
 * over it. A world's scene is Three.js's: its bundle and the world's own are
 * loaded and the world mounted in it. The campus's is SVG drawn by React in
 * the panel's own bundle (`campus/`), which loads no Three.js at all; the
 * page hands either the same state and hears the same hover, press, and
 * flight away from home, so the chrome serves both alike. What the
 * developer does here, choosing, hovering, switching a layer, winding the
 * clock, is the page's state and is handed to the world whole on each
 * change. Esc steps back one thing at a time: from a selection or a camera
 * away from home to the establishing shot, and only from there out of
 * Factory (`backOut`).
 */

/** What the page says where the world could not be read. */
const UNREAD_LINE = "The world could not be read.";

/** What the page says where the workspace has no repository to draw. */
const NO_REPOSITORY_LINE = "No repository to draw yet";

const ALL_LAYERS: WorldLayers = {
  [WORLD_LAYER.PLANNED]: true,
  [WORLD_LAYER.BUILDING]: true,
  [WORLD_LAYER.SHIPPED]: true,
  [WORLD_LAYER.DEFECTS]: true,
};

const NO_BLAST: ReadonlyMap<string, number> = new Map();

/** The signals the chrome's stylesheet draws in, from the view model's palette. */
const SIGNALS = cssCustomProperties({
  "--world-shipped": SIGNAL_COLOR.SHIPPED,
  "--world-blast": SIGNAL_COLOR.BLAST_RADIUS,
  "--world-touched": SIGNAL_COLOR.SELECTION,
});

const DARK_APPEARANCE = "(prefers-color-scheme: dark)";

/** Whether the window draws in its dark appearance, kept as it flips. */
function useDarkAppearance(): boolean {
  return useSyncExternalStore(
    (changed) => {
      const query = window.matchMedia(DARK_APPEARANCE);
      query.addEventListener("change", changed);
      return () => query.removeEventListener("change", changed);
    },
    () => window.matchMedia(DARK_APPEARANCE).matches,
  );
}

/**
 * Whether motion is held still where `element` stands: reduced motion, or a
 * capture run, both of which pause `--loop-motion` at the tokens (base.css),
 * so the scene answers both as the spinner and Luke's face do.
 */
function useMotionStill(element: HTMLElement | null): boolean {
  const reduced = usePrefersReducedMotion();
  return useMemo(
    () =>
      reduced ||
      (element !== null &&
        getComputedStyle(element).getPropertyValue("--loop-motion").trim() === "paused"),
    [element, reduced],
  );
}

/** The world mounted in its box once both bundles have landed, handed each later state, and taken down as it goes. */
function SceneCanvas({
  scene,
  world,
  state,
  shown,
  handle,
  onHover,
  onPick,
  onAway,
}: {
  scene: FactorySceneModule;
  world: WorldModule;
  state: WorldState;
  shown: boolean;
  handle: RefObject<FactorySceneHandle | undefined>;
  onHover: (hover: SceneHover | undefined) => void;
  onPick: (target: PickTarget | undefined) => void;
  onAway: (away: boolean) => void;
}): React.JSX.Element {
  const box = useRef<HTMLDivElement>(null);
  const firstState = useRef(state);
  const [failed, setFailed] = useState(false);
  const doors = useRef({ onHover, onPick, onAway });
  doors.current = { onHover, onPick, onAway };

  useEffect(() => {
    const element = box.current;
    if (element === null) return undefined;
    let mounted: FactorySceneHandle;
    try {
      mounted = scene.mount(element, {
        world,
        state: firstState.current,
        onHover: (hover) => doors.current.onHover(hover),
        onPick: (target) => doors.current.onPick(target),
        onAway: (away) => doors.current.onAway(away),
      });
    } catch {
      // Note that a Mac whose WebGL cannot be had says so rather than standing blank.
      setFailed(true);
      return undefined;
    }
    handle.current = mounted;
    return () => {
      handle.current = undefined;
      mounted.unmount();
    };
  }, [scene, world, handle]);

  useEffect(() => {
    if (state !== firstState.current) handle.current?.show(state);
  }, [state, handle]);

  useEffect(() => {
    handle.current?.setShown(shown);
  }, [shown, handle]);

  return failed ? (
    <ErrorState placement={ERROR_STATE_PLACEMENT.CENTRED}>{WORLD_LOAD_FAILED}</ErrorState>
  ) : (
    <div ref={box} className="factory-world-scene" />
  );
}

/** What the page draws: a world, or the campus. */
export type FactoryScene = { readonly world: WorldEntry } | { readonly campus: true };

/** A world's scene: the scene bundle and the world's own loaded, then the world mounted in it. */
function WorldScene({
  entry,
  ...props
}: StageSceneProps & { entry: WorldEntry }): React.JSX.Element {
  const scene = useAtomValue(useSideBundles().factoryScene);
  const world = useAtomValue(worldBundleAtom(entry.load));
  const handle = useRef<FactorySceneHandle | undefined>(undefined);
  const { home } = props;
  useLayoutEffect(() => {
    home.current = () => handle.current?.home();
    return () => {
      home.current = undefined;
    };
  }, [home]);
  if (AsyncResult.isFailure(scene) || AsyncResult.isFailure(world)) {
    return <ErrorState placement={ERROR_STATE_PLACEMENT.CENTRED}>{WORLD_LOAD_FAILED}</ErrorState>;
  }
  if (!AsyncResult.isSuccess(scene) || !AsyncResult.isSuccess(world)) {
    return <SpinnerRegion label="Loading world" />;
  }
  return (
    <SceneCanvas
      scene={scene.value}
      world={world.value}
      state={props.state}
      shown={props.shown}
      handle={handle}
      onHover={props.onHover}
      onPick={props.onPick}
      onAway={props.onAway}
    />
  );
}

/** The listed tasks' names, by id, which the hover label and a task's card name a building by. */
function useTaskNames(tasks: TasksControl): ReadonlyMap<string, string> {
  const listed = tasks.listed.tasks;
  return useMemo(() => new Map(listed.map((task) => [task.id, task.name])), [listed]);
}

/** The world or the campus over one snapshot: the scene, and the chrome over it. */
function WorldStage({
  snapshot,
  scene,
  tasks,
  backOut,
}: {
  snapshot: FactoryWorld;
  scene: FactoryScene;
  tasks: TasksControl;
  backOut: RefObject<(() => boolean) | undefined>;
}): React.JSX.Element {
  const [root, setRoot] = useState<HTMLElement | null>(null);
  const [selected, setSelected] = useState<PickTarget | undefined>(undefined);
  const [hover, setHover] = useState<SceneHover | undefined>(undefined);
  const [layers, setLayers] = useState<WorldLayers>(ALL_LAYERS);
  const [instant, setInstant] = useState<number | undefined>(undefined);
  const [away, setAway] = useState(false);
  const homeTo = useRef<(() => void) | undefined>(undefined);
  const still = useMotionStill(root);
  const dark = useDarkAppearance();
  const taskNames = useTaskNames(tasks);

  const live = useMemo(() => factoryWorldViewOf(snapshot), [snapshot]);
  const asOf = useMemo(
    () => (instant === undefined ? snapshot : factoryWorldAsOf(snapshot, instant)),
    [snapshot, instant],
  );
  const view = useMemo(
    () => (instant === undefined ? live : factoryWorldViewOf(asOf)),
    [instant, live, asOf],
  );
  const blast = useMemo(() => {
    if (selected === undefined) return NO_BLAST;
    const reach =
      selected.kind === PICK_KIND.AGENT
        ? blastRadiusOf(view, selected.id)
        : selected.kind === PICK_KIND.TASK
          ? taskBlastRadiusOf(view, selected.id)
          : [];
    return reach.length === 0 ? NO_BLAST : new Map(reach.map((zone) => [zone.path, zone.distance]));
  }, [view, selected]);
  const state = useMemo<WorldState>(
    () => ({
      view,
      snapshot: asOf,
      live: instant === undefined,
      selected,
      hovered: hover?.target,
      blast,
      layers,
      still,
      dark,
    }),
    [view, asOf, instant, selected, hover?.target, blast, layers, still, dark],
  );

  const home = useCallback(() => {
    setSelected(undefined);
    setAway(false);
    homeTo.current?.();
  }, []);
  // Note that Esc reaches the overview first, and leaves Factory only from there.
  useLayoutEffect(() => {
    backOut.current = () => {
      if (!away && selected === undefined) return false;
      home();
      return true;
    };
    return () => {
      backOut.current = undefined;
    };
  }, [backOut, away, selected, home]);

  const toggle = useCallback(
    (layer: WorldLayer) => setLayers((was) => ({ ...was, [layer]: !was[layer] })),
    [],
  );
  const hovered = hover === undefined ? undefined : namingOf(hover.target, view, asOf, taskNames);
  const sceneProps: StageSceneProps = {
    state,
    shown: tasks.shown,
    home: homeTo,
    onHover: setHover,
    onPick: setSelected,
    onAway: setAway,
  };
  return (
    <div className="factory-world-stage" ref={setRoot} style={SIGNALS}>
      {"world" in scene ? (
        <WorldScene entry={scene.world} {...sceneProps} />
      ) : (
        <CampusScene {...sceneProps} tasks={tasks.listed.tasks} />
      )}
      <PipelineBar counts={view.pipeline} layers={layers} onToggle={toggle} />
      {away || selected !== undefined ? <HomeButton onHome={home} /> : null}
      {hover === undefined || hovered === undefined ? null : (
        <HoverLabel hover={hover} naming={hovered} />
      )}
      {selected === undefined ? null : (
        <WorldCard
          target={selected}
          view={view}
          world={asOf}
          blast={blast}
          tasks={tasks}
          taskNames={taskNames}
          onClose={() => setSelected(undefined)}
        />
      )}
      <Scrubber live={live} instant={instant} onInstant={setInstant} />
    </div>
  );
}

/** A world or the campus in the board's place, over the listed workspace's snapshot. */
export function FactoryWorldPage({
  tasks,
  scene,
  backOut,
}: {
  tasks: TasksControl;
  scene: FactoryScene;
  /** Where the page leaves its Esc: one step back toward the overview, answering whether it took one. */
  backOut: RefObject<(() => boolean) | undefined>;
}): React.JSX.Element {
  const { read, reload } = useFactoryWorld(tasks.workspace?.id, tasks.shown);
  return (
    <div className="factory-world">
      {read === undefined ? (
        <SpinnerRegion label="Loading world" />
      ) : "failure" in read ? (
        <ErrorState onRetry={reload} placement={ERROR_STATE_PLACEMENT.CENTRED}>
          {UNREAD_LINE}
        </ErrorState>
      ) : read.world === null ? (
        <EmptyState icon={<FactoryIcon />}>{NO_REPOSITORY_LINE}</EmptyState>
      ) : (
        <WorldStage snapshot={read.world} scene={scene} tasks={tasks} backOut={backOut} />
      )}
    </div>
  );
}
