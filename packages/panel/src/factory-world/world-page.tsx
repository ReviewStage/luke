import type { FactoryWorld } from "@luke/features/factory-world-wire";
import { cssCustomProperties, EmptyState, ERROR_STATE_PLACEMENT, ErrorState } from "@luke/ui";
import { taskBlastRadiusOf } from "@luke/ui/factory-campus";
import { blastRadiusOf, factoryWorldViewOf, SIGNAL_COLOR } from "@luke/ui/factory-world";
import { FactoryIcon } from "lucide-react";
import {
  type RefObject,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { SpinnerRegion } from "../spinner.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { usePrefersReducedMotion } from "../use-reduced-motion.js";
import { CampusScene } from "./campus/campus-scene.js";
import type { SceneHover, StageSceneProps } from "./contract.js";
import { useFactoryWorld } from "./use-factory-world.js";
import {
  PICK_KIND,
  type PickTarget,
  WORLD_LAYER,
  type WorldLayer,
  type WorldLayers,
  type WorldState,
} from "./world.js";
import { HomeButton, HoverLabel, namingOf, PipelineBar, WorldCard } from "./world-chrome.js";

/**
 * world-page.tsx -- the campus in the board's place: the workspace's snapshot read, the campus drawn over it, and the chrome over that.
 *
 * Until the snapshot is read a ring stands where the campus will; a read that
 * failed says so with Retry, and a workspace with no repository to draw is
 * the app's empty state, as the board says it holds nothing. Once read, the
 * campus (`campus/`) is drawn in SVG over the snapshot's view, and the chrome
 * over it: the pipeline bar, the hover label, the card, and the home button.
 * What the developer does here, choosing, hovering, switching a layer, is the
 * page's state and is handed to the campus whole on each change. Esc steps
 * back one thing at a time: from a selection or a view away from home to the
 * establishing shot, and only from there out of Factory (`backOut`).
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

/**
 * The layers the campus draws: the one the pipeline bar previews while the
 * pointer or the keyboard rests on its count, else the one pressed, alone;
 * every layer with neither.
 */
function layersShown(chosen: WorldLayer | undefined, preview: WorldLayer | undefined): WorldLayers {
  const alone = preview ?? chosen;
  if (alone === undefined) return ALL_LAYERS;
  return {
    [WORLD_LAYER.PLANNED]: alone === WORLD_LAYER.PLANNED,
    [WORLD_LAYER.BUILDING]: alone === WORLD_LAYER.BUILDING,
    [WORLD_LAYER.SHIPPED]: alone === WORLD_LAYER.SHIPPED,
    [WORLD_LAYER.DEFECTS]: alone === WORLD_LAYER.DEFECTS,
  };
}

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

/** The listed tasks' names, by id, which the hover label and a task's card name a building by. */
function useTaskNames(tasks: TasksControl): ReadonlyMap<string, string> {
  const listed = tasks.listed.tasks;
  return useMemo(() => new Map(listed.map((task) => [task.id, task.name])), [listed]);
}

/** The campus over one snapshot: the scene, and the chrome over it. */
function WorldStage({
  snapshot,
  tasks,
  backOut,
}: {
  snapshot: FactoryWorld;
  tasks: TasksControl;
  backOut: RefObject<(() => boolean) | undefined>;
}): React.JSX.Element {
  const [root, setRoot] = useState<HTMLElement | null>(null);
  const [selected, setSelected] = useState<PickTarget | undefined>(undefined);
  const [hover, setHover] = useState<SceneHover | undefined>(undefined);
  const [chosenLayer, setChosenLayer] = useState<WorldLayer | undefined>(undefined);
  const [previewLayer, setPreviewLayer] = useState<WorldLayer | undefined>(undefined);
  const layers = useMemo(() => layersShown(chosenLayer, previewLayer), [chosenLayer, previewLayer]);
  const [away, setAway] = useState(false);
  const homeTo = useRef<(() => void) | undefined>(undefined);
  const still = useMotionStill(root);
  const dark = useDarkAppearance();
  const taskNames = useTaskNames(tasks);

  const view = useMemo(() => factoryWorldViewOf(snapshot), [snapshot]);
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
      snapshot,
      live: true,
      selected,
      hovered: hover?.target,
      blast,
      layers,
      still,
      dark,
    }),
    [view, snapshot, selected, hover?.target, blast, layers, still, dark],
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

  const choose = useCallback((layer: WorldLayer | undefined) => {
    setChosenLayer(layer);
    // Note that the press settles what the pointer previewed, so leaving the count shows the press, not the preview.
    setPreviewLayer(undefined);
  }, []);
  const hovered =
    hover === undefined ? undefined : namingOf(hover.target, view, snapshot, taskNames);
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
      <CampusScene {...sceneProps} tasks={tasks.listed.tasks} />
      <PipelineBar
        counts={view.pipeline}
        chosen={chosenLayer}
        onChoose={choose}
        onPreview={setPreviewLayer}
      />
      {away || selected !== undefined ? <HomeButton onHome={home} /> : null}
      {hover === undefined || hovered === undefined ? null : (
        <HoverLabel hover={hover} naming={hovered} />
      )}
      {selected === undefined ? null : (
        <WorldCard
          target={selected}
          view={view}
          world={snapshot}
          blast={blast}
          tasks={tasks}
          taskNames={taskNames}
          onClose={() => setSelected(undefined)}
        />
      )}
    </div>
  );
}

/** The campus in the board's place, over the listed workspace's snapshot. */
export function FactoryWorldPage({
  tasks,
  backOut,
}: {
  tasks: TasksControl;
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
        <WorldStage snapshot={read.world} tasks={tasks} backOut={backOut} />
      )}
    </div>
  );
}
