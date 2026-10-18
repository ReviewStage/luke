import { useAtom } from "@effect/atom-react";
import type { TaskSummary } from "@luke/features/task-wire";
import { cssCustomProperties, Segmented } from "@luke/ui";
import {
  type BuildingPiece,
  blastShapesOf,
  blueprintShapesOf,
  buildingPiecesOf,
  buildingShadowOf,
  CAMPUS_BIG_FROM,
  CAMPUS_DETAIL,
  CAMPUS_GRADIENT,
  CAMPUS_LAYOUT,
  CAMPUS_OBJECT,
  CAMPUS_SIGNAL,
  type CampusDetail,
  type CampusDistrict,
  type CampusDrawing,
  type CampusGradient,
  type CampusLayout,
  type CampusObject,
  type CampusPlan,
  type CampusShape,
  type CampusSignal,
  type CampusSlot,
  type CampusTask,
  CONTAINER_PLACE,
  campusBoundsOf,
  campusColoursOf,
  campusDetailOf,
  campusGradientStopsOf,
  campusObjectsOf,
  campusPlanOf,
  campusProject,
  campusReadingOf,
  campusSeen,
  containerOutlineOf,
  containerShadowOf,
  containerShapesOf,
  craneShapesOf,
  districtAnchorOf,
  districtShapesOf,
  gateShadowOf,
  gateShapesOf,
  groundShapesOf,
  insideShapesOf,
  lampShapesOf,
  laneLampShapesOf,
  lotFlagShapesOf,
  NOT_IN_CODE,
  nameAnchorOf,
  outlineOf,
  PIECE,
  type PieceKind,
  type PlacedContainer,
  plotShapesOf,
  routePointsOf,
  type ScreenBounds,
  SHAPE_MARK,
  type ShapeMark,
  shadowFillOf,
  smokeRationOf,
  treeShadowOf,
  treeShapesOf,
  yardAnchorsOf,
} from "@luke/ui/factory-campus";
import { AGENT_STATE, agentDrawnUnder, SIGNAL_COLOR } from "@luke/ui/factory-world";
import * as Atom from "effect/reactivity/Atom";
import {
  createElement,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { dayText } from "../../tasks/task-time";
import type { StageSceneProps } from "../contract";
import { PICK_KIND, type PickTarget, WORLD_LAYER, type WorldLayer } from "../world";

/**
 * campus-scene.tsx -- the Factory's campus: the world snapshot and the listed tasks drawn in SVG as an isometric town, each task a building, each pull request a container, under the chrome every world shares.
 *
 * The reading, the layout, and every shape are `@luke/ui/factory-campus`'s;
 * this file puts the shapes on screen and is the camera, the pointer, and the
 * keyboard. It is not a world (`../world.ts`): a world is geometry in a
 * Three.js scene, and the campus loads none of Three.js. The page hands it
 * the same state a world is handed and hears the same hover, press, and
 * flight away from home (`../contract.ts`'s `StageSceneProps`).
 *
 * What a press or a hover lands on is a `PickTarget`: a building is its task,
 * a container at the gate its agent, one in the lot its merge, a blueprint
 * its issue, a district its zone, and an open building's station its agent.
 * An element names what it is by an index into the reading
 * (`data-pick-kind`, `data-pick-index`), never by a word, since session
 * replay records attributes; every name on screen is SVG text, which it
 * masks, or an `aria-label`, which it asterisks.
 *
 * It keeps a big campus cheap the way the mockup measured:
 *
 *   - Only the open building draws its inside.
 *   - Far out, a wall's windows are one band, nothing glows, and there are no
 *     shadows (`CAMPUS_DETAIL`).
 *   - Past `CAMPUS_BIG_FROM` tasks, zoomed in, only what stands on screen and
 *     a margin round it is drawn, nothing carries a blur filter (a lit window
 *     glows by a stroke), and nothing loops: it is a still frame.
 *   - At most `CRANES_MAX` cranes turn, none in a big campus, and the one
 *     animation loop runs only while one does, the campus is on screen, the
 *     page is visible, and motion is not held still.
 *   - The reading and the layout are worked out once a draw, and every
 *     building and container is a memoized element, so a new snapshot or a
 *     hover redraws only what changed.
 *   - The camera moves by one transform, written to the DOM without a render;
 *     only a change of detail, of what is culled, or of the names' scale draws.
 */

/** How the plots are laid out, kept for the window's session. */
const layoutAtom = Atom.keepAlive(Atom.make<CampusLayout>(CAMPUS_LAYOUT.DISTRICTS));

const LAYOUT_OPTIONS = [
  { value: CAMPUS_LAYOUT.DISTRICTS, label: "Districts" },
  { value: CAMPUS_LAYOUT.TOWN, label: "Town" },
] as const;

/** The most cranes that turn at once. */
const CRANES_MAX = 4;

/** How a jib turns, in radians a second, and where a still one stands. */
const CRANE_TURN = 0.18;
const CRANE_REST = 0.6;

/** How near and how far the camera goes, as multiples of the scale that fits the campus, and how far in a flight goes. */
const REACH = {
  NEAREST: 5,
  FARTHEST: 0.6,
  BUILDING: 1.9,
  BUILDING_LEAST: 1.15,
  CONTAINER: 2.4,
  YARD: 2,
} as const;

/** Room the fitted campus leaves round it, for the chrome. */
const FIT_ROOM = { WIDE: 80, HIGH: 110, LIFT: 40 } as const;

/** How far the pointer moves before a press becomes a drag. */
const DRAG_SLOP = 4;

/** How much a step of the wheel zooms, and a pinch, which steps finer. */
const WHEEL_ZOOM = { WHEEL: 0.0022, PINCH: 0.01 } as const;

/** How much of the screen past each edge a culled campus still draws, and how far the scale moves before the names are refitted. */
const CULL_MARGIN = 0.3;
const NAME_REFIT = 0.12;

/** A big campus names only buildings where something happens; a smaller one names them all. */
const NAME_ALL_UP_TO = 12;

/** A name's chip: its font, its height, its rise over its anchor, and its padding. */
const NAME = { FONT_SIZE: 12, HIGH: 19, RISE: 25, PAD: 7, DOT_PAD: 18, GAP: 30 } as const;

/** What a pickable element is, by the fixed words of `data-pick-kind`. */
const PICK_SOURCE = {
  TASK: "task",
  CONTAINER: "container",
  PLANNED: "planned",
  DISTRICT: "district",
  STATION: "station",
} as const;

/** Which edge an outline draws: what the pointer rests on, or what is selected. */
const EDGE = {
  HOVERED: "hovered",
  SELECTED: "selected",
} as const;

/** The class each mark draws with. */
const MARK_CLASS = {
  [SHAPE_MARK.LIT]: "factory-campus-lit",
  [SHAPE_MARK.GLOW]: "factory-campus-glow",
  [SHAPE_MARK.SMOKE]: "factory-campus-smoke",
  [SHAPE_MARK.PULSE]: "factory-campus-pulse",
  [SHAPE_MARK.FLAG]: "factory-campus-flag",
  [SHAPE_MARK.BELT]: "factory-campus-belt",
} as const satisfies Record<ShapeMark, string>;

/** The class each piece of a building draws in. */
const PIECE_CLASS = {
  [PIECE.BESIDE]: "factory-campus-keep",
  [PIECE.INSIDE]: "factory-campus-inside",
  [PIECE.SHELL]: "factory-campus-shell",
  [PIECE.UPPER]: "factory-campus-upper",
  [PIECE.KEEP]: "factory-campus-keep",
  [PIECE.CRANE]: "factory-campus-upper",
  [PIECE.SCAFFOLD]: "factory-campus-upper",
  [PIECE.SIGN]: "factory-campus-sign",
} as const satisfies Record<PieceKind, string>;

/** Each gradient's id in the page; one campus stands at a time. */
const GRADIENT_ID = {
  [CAMPUS_GRADIENT.METAL]: "factory-campus-metal",
  [CAMPUS_GRADIENT.BRICK]: "factory-campus-brick",
  [CAMPUS_GRADIENT.POOL]: "factory-campus-pool",
} as const satisfies Record<CampusGradient, string>;

const GLOW_FILTER = "factory-campus-glow-filter";

/** The attribute each hidden layer sets on the scene, which its stylesheet answers. */
const HIDDEN_LAYER = {
  [WORLD_LAYER.PLANNED]: "data-hide-planned",
  [WORLD_LAYER.BUILDING]: "data-hide-building",
  [WORLD_LAYER.SHIPPED]: "data-hide-shipped",
  [WORLD_LAYER.DEFECTS]: "data-hide-defects",
} as const satisfies Record<WorldLayer, string>;

/** What a building's name is said with, and the signal its dot is lit in. */
const SIGNAL_WORDS = {
  [CAMPUS_SIGNAL.FAILED]: "an agent failed",
  [CAMPUS_SIGNAL.WORKING]: "at work",
  [CAMPUS_SIGNAL.WAITING]: "waiting on you",
  [CAMPUS_SIGNAL.STUCK]: "stuck",
  [CAMPUS_SIGNAL.SHIPPED]: "shipped",
  [CAMPUS_SIGNAL.IDLE]: "quiet",
} as const satisfies Record<CampusSignal, string>;

const SIGNAL_DOT = {
  [CAMPUS_SIGNAL.FAILED]: SIGNAL_COLOR.DEFECT,
  [CAMPUS_SIGNAL.WORKING]: SIGNAL_COLOR.BUILDING,
  [CAMPUS_SIGNAL.WAITING]: SIGNAL_COLOR.BUILDING,
  [CAMPUS_SIGNAL.STUCK]: SIGNAL_COLOR.BUILDING,
  [CAMPUS_SIGNAL.SHIPPED]: SIGNAL_COLOR.SHIPPED,
  [CAMPUS_SIGNAL.IDLE]: null,
} as const satisfies Record<CampusSignal, string | null>;

/** Which names are placed first: the open task's, then where something is happening. */
const NAME_RANK = {
  [CAMPUS_SIGNAL.FAILED]: 1,
  [CAMPUS_SIGNAL.WORKING]: 2,
  [CAMPUS_SIGNAL.WAITING]: 3,
  [CAMPUS_SIGNAL.STUCK]: 4,
  [CAMPUS_SIGNAL.SHIPPED]: 9,
  [CAMPUS_SIGNAL.IDLE]: 9,
} as const satisfies Record<CampusSignal, number>;
const QUIET_RANK = 9;

/** The camera: where the campus's origin lands in the scene's box, and its scale. */
interface Camera {
  x: number;
  y: number;
  s: number;
}

/** What the drawing reads off the camera: how near it is, what is culled to, and the scale the names were fitted at. */
interface Frame {
  /** Whether the camera has been read once: nothing is drawn before it, so a first draw is drawn once. */
  readonly settled: boolean;
  readonly detail: CampusDetail;
  readonly culled: ScreenBounds | null;
  readonly nameScale: number;
}

/** A name over the campus. */
interface Name {
  readonly x: number;
  readonly y: number;
  readonly text: string;
  readonly dot: string | null;
  readonly painted: boolean;
}

/** A jib's angle, shared by the cranes that turn, which the loop moves. */
interface AngleStore {
  readonly read: () => number;
  readonly write: (angle: number) => void;
  readonly subscribe: (changed: () => void) => () => void;
}

function angleStoreOf(): AngleStore {
  let angle = CRANE_REST;
  const listeners = new Set<() => void>();
  return {
    read: () => angle,
    write: (next) => {
      angle = next;
      for (const listener of listeners) listener();
    },
    subscribe: (changed) => {
      listeners.add(changed);
      return () => listeners.delete(changed);
    },
  };
}

/** One shape as its SVG element. */
function shapeElement(shape: CampusShape, key: number): React.ReactElement {
  return createElement(shape.tag, {
    key,
    ...shape.attributes,
    fill:
      shape.gradient === undefined ? shape.attributes.fill : `url(#${GRADIENT_ID[shape.gradient]})`,
    className: shape.mark === undefined ? undefined : MARK_CLASS[shape.mark],
    "data-layer": shape.layer,
  });
}

function Shapes({ shapes }: { shapes: readonly CampusShape[] }): React.JSX.Element {
  return <>{shapes.map(shapeElement)}</>;
}

/** Whether two drawings draw alike. */
function sameDrawing(left: CampusDrawing, right: CampusDrawing): boolean {
  return (
    left.dark === right.dark &&
    left.detail === right.detail &&
    left.big === right.big &&
    left.still === right.still
  );
}

function samePlace(left: CampusSlot, right: CampusSlot): boolean {
  return (
    left.plot.x === right.plot.x &&
    left.plot.y === right.plot.y &&
    left.plot.w === right.plot.w &&
    left.plot.d === right.plot.d &&
    left.hollow.h === right.hollow.h
  );
}

/** Whether an open building's line would draw alike: the same agents, in the same states, with the same pull requests. */
function sameLine(left: CampusTask, right: CampusTask): boolean {
  return (
    left.agents.length === right.agents.length &&
    left.agents.every((agent, index) => {
      const other = right.agents[index];
      return (
        other !== undefined &&
        other.id === agent.id &&
        other.state === agent.state &&
        other.agent.pullRequest?.number === agent.agent.pullRequest?.number &&
        other.agent.pullRequest?.state === agent.agent.pullRequest?.state &&
        other.agent.pullRequest?.additions === agent.agent.pullRequest?.additions &&
        other.agent.pullRequest?.deletions === agent.agent.pullRequest?.deletions
      );
    })
  );
}

/** A crane, turning with the shared angle where it is one of those that turn, else standing at rest. */
function Crane({
  crane,
  turning,
  angles,
  dark,
}: {
  crane: NonNullable<CampusSlot["crane"]>;
  turning: boolean;
  angles: AngleStore;
  dark: boolean;
}): React.JSX.Element {
  const angle = useSyncExternalStore(
    turning ? angles.subscribe : noSubscription,
    turning ? angles.read : restingAngle,
  );
  return <Shapes shapes={craneShapesOf(crane, angle, dark)} />;
}

function noSubscription(): () => void {
  return () => undefined;
}

function restingAngle(): number {
  return CRANE_REST;
}

interface BuildingProps {
  readonly index: number;
  readonly task: CampusTask;
  readonly slot: CampusSlot;
  readonly drawing: CampusDrawing;
  readonly smokes: boolean;
  readonly open: boolean;
  readonly turning: boolean;
  readonly angles: AngleStore;
  /** Each agent's index among the view's, which an open building's stations are picked by. */
  readonly agentIndex: ReadonlyMap<string, number>;
}

/** A task's building: its pieces, its inside while it is open, and its crane while it goes up. */
const Building = memo(
  function Building({
    index,
    task,
    slot,
    drawing,
    smokes,
    open,
    turning,
    angles,
    agentIndex,
  }: BuildingProps): React.JSX.Element {
    const pieces = useMemo(
      () => buildingPiecesOf(task, slot, drawing, smokes),
      [task, slot, drawing, smokes],
    );
    const inside = useMemo(
      () => (open ? insideShapesOf(task, slot, drawing) : null),
      [open, task, slot, drawing],
    );
    const piece = (each: BuildingPiece, key: number) => {
      if (each.kind === PIECE.INSIDE) {
        return inside === null ? null : (
          <g key={key} className={PIECE_CLASS[PIECE.INSIDE]}>
            <Shapes shapes={inside.back} />
            {inside.stations.map((station, at) =>
              station.agentId === null ? (
                <Shapes key={at} shapes={station.shapes} />
              ) : (
                <g
                  key={at}
                  data-pick-kind={PICK_SOURCE.STATION}
                  data-pick-index={agentIndex.get(station.agentId) ?? -1}
                >
                  <Shapes shapes={station.shapes} />
                </g>
              ),
            )}
            <Shapes shapes={inside.front} />
          </g>
        );
      }
      if (each.kind === PIECE.CRANE && slot.crane !== null) {
        return (
          <g key={key} className={PIECE_CLASS[PIECE.CRANE]} data-layer={each.layer}>
            <Crane crane={slot.crane} turning={turning} angles={angles} dark={drawing.dark} />
          </g>
        );
      }
      return (
        <g key={key} className={PIECE_CLASS[each.kind]} data-layer={each.layer}>
          <Shapes shapes={each.shapes} />
        </g>
      );
    };
    return (
      // biome-ignore lint/a11y/useSemanticElements: an SVG group cannot be a <button>, so the drawn shape takes the role and a tab stop itself.
      <g
        className="factory-campus-building"
        data-pick-kind={PICK_SOURCE.TASK}
        data-pick-index={index}
        data-open={open ? "" : undefined}
        tabIndex={0}
        role="button"
        aria-label={`${task.name}: ${SIGNAL_WORDS[task.signal]}`}
      >
        <g className="factory-campus-lift">{pieces.map(piece)}</g>
      </g>
    );
  },
  (left, right) =>
    left.index === right.index &&
    left.open === right.open &&
    left.turning === right.turning &&
    left.smokes === right.smokes &&
    left.angles === right.angles &&
    left.task.name === right.task.name &&
    left.task.signal === right.task.signal &&
    left.task.working === right.task.working &&
    left.task.underway === right.task.underway &&
    left.task.shipped === right.task.shipped &&
    sameDrawing(left.drawing, right.drawing) &&
    samePlace(left.slot, right.slot) &&
    (!right.open || (sameLine(left.task, right.task) && left.agentIndex === right.agentIndex)),
);

/** A pull request's container, where it stands. */
const Container = memo(
  function Container({
    index,
    placed,
    drawing,
  }: {
    index: number;
    placed: PlacedContainer;
    drawing: CampusDrawing;
  }): React.JSX.Element {
    const { container } = placed;
    const atGate = container.place === CONTAINER_PLACE.GATE;
    return (
      // biome-ignore lint/a11y/useSemanticElements: an SVG group cannot be a <button>, so the drawn shape takes the role and a tab stop itself.
      <g
        className="factory-campus-container"
        data-pick-kind={PICK_SOURCE.CONTAINER}
        data-pick-index={index}
        data-layer={atGate ? WORLD_LAYER.BUILDING : WORLD_LAYER.SHIPPED}
        tabIndex={0}
        role="button"
        aria-label={`Pull request #${container.number}: ${container.additions} additions, ${container.deletions} deletions`}
      >
        <Shapes shapes={containerShapesOf(placed, drawing)} />
      </g>
    );
  },
  (left, right) =>
    left.index === right.index &&
    sameDrawing(left.drawing, right.drawing) &&
    left.placed.x === right.placed.x &&
    left.placed.y === right.placed.y &&
    left.placed.z === right.placed.z &&
    left.placed.w === right.placed.w &&
    left.placed.container.number === right.placed.container.number &&
    left.placed.container.place === right.placed.container.place &&
    left.placed.container.additions === right.placed.container.additions &&
    left.placed.container.deletions === right.placed.container.deletions,
);

/** A planned issue's blueprint. */
const Blueprint = memo(
  function Blueprint({
    index,
    label,
    slot,
    drawing,
    hot,
  }: {
    index: number;
    label: string;
    slot: CampusSlot;
    drawing: CampusDrawing;
    hot: boolean;
  }): React.JSX.Element {
    return (
      // biome-ignore lint/a11y/useSemanticElements: an SVG group cannot be a <button>, so the drawn shape takes the role and a tab stop itself.
      <g
        className="factory-campus-blueprint"
        data-pick-kind={PICK_SOURCE.PLANNED}
        data-pick-index={index}
        data-layer={WORLD_LAYER.PLANNED}
        data-hot={hot ? "" : undefined}
        tabIndex={0}
        role="button"
        aria-label={label}
      >
        <Shapes shapes={blueprintShapesOf(slot, drawing)} />
      </g>
    );
  },
  (left, right) =>
    left.index === right.index &&
    left.label === right.label &&
    left.hot === right.hot &&
    sameDrawing(left.drawing, right.drawing) &&
    samePlace(left.slot, right.slot),
);

/** Scenery and the yards' fixtures, which only the appearance and the detail redraw. */
const Fixture = memo(
  function Fixture({
    object,
    drawing,
    plan,
  }: {
    object: CampusObject;
    drawing: CampusDrawing;
    plan: CampusPlan;
  }): React.JSX.Element | null {
    switch (object.kind) {
      case CAMPUS_OBJECT.TREE:
        return <Shapes shapes={treeShapesOf(object.at.x, object.at.y, drawing)} />;
      case CAMPUS_OBJECT.LAMP:
        return <Shapes shapes={lampShapesOf(object.at.x, object.at.y, drawing)} />;
      case CAMPUS_OBJECT.LANE:
        return (
          <g data-layer={WORLD_LAYER.BUILDING}>
            <Shapes shapes={laneLampShapesOf(object.lane, object.occupied, drawing)} />
          </g>
        );
      case CAMPUS_OBJECT.GATE:
        return <Shapes shapes={gateShapesOf(drawing)} />;
      case CAMPUS_OBJECT.FLAG:
        return (
          <g data-layer={WORLD_LAYER.SHIPPED}>
            <Shapes shapes={lotFlagShapesOf(plan.lot, drawing)} />
          </g>
        );
      default:
        return null;
    }
  },
  (left, right) =>
    left.object.kind === right.object.kind &&
    left.object.at.x === right.object.at.x &&
    left.object.at.y === right.object.at.y &&
    (left.object.kind !== CAMPUS_OBJECT.LANE ||
      (right.object.kind === CAMPUS_OBJECT.LANE &&
        left.object.occupied === right.object.occupied)) &&
    (left.object.kind !== CAMPUS_OBJECT.FLAG || left.plan.lot.w === right.plan.lot.w) &&
    sameDrawing(left.drawing, right.drawing),
);

/** The ground, redrawn only when the campus's extent or the appearance changes. */
const Ground = memo(
  function Ground({
    plan,
    drawing,
  }: {
    plan: CampusPlan;
    drawing: CampusDrawing;
  }): React.JSX.Element {
    return <Shapes shapes={groundShapesOf(plan, drawing)} />;
  },
  (left, right) =>
    left.plan.layout === right.plan.layout &&
    left.plan.width === right.plan.width &&
    left.plan.depth === right.plan.depth &&
    left.plan.lot.w === right.plan.lot.w &&
    left.plan.streets.rows.length === right.plan.streets.rows.length &&
    left.plan.streets.avenues.length === right.plan.streets.avenues.length &&
    left.drawing.dark === right.drawing.dark,
);

/** The districts, each a ground of its own that a hover and a press land on. */
const Districts = memo(function Districts({
  districts,
  labels,
  drawing,
}: {
  districts: readonly CampusDistrict[];
  labels: readonly string[];
  drawing: CampusDrawing;
}): React.JSX.Element {
  return (
    <>
      {districts.map((district, index) => (
        // biome-ignore lint/a11y/useSemanticElements: an SVG group cannot be a <button>, so the drawn shape takes the role and a tab stop itself.
        <g
          key={district.path}
          className="factory-campus-district"
          data-pick-kind={PICK_SOURCE.DISTRICT}
          data-pick-index={index}
          tabIndex={0}
          role="button"
          aria-label={labels[index]}
        >
          <Shapes shapes={districtShapesOf(district, drawing)} />
        </g>
      ))}
    </>
  );
});

/** The rectangle on screen the camera shows, at a scale of one, grown by `margin` of its size past each edge. */
function windowOf(camera: Camera, width: number, height: number, margin: number): ScreenBounds {
  return {
    x0: (-camera.x - width * margin) / camera.s,
    x1: (width * (1 + margin) - camera.x) / camera.s,
    y0: (-camera.y - height * margin) / camera.s,
    y1: (height * (1 + margin) - camera.y) / camera.s,
  };
}

function within(outer: ScreenBounds, inner: ScreenBounds): boolean {
  return (
    inner.x0 >= outer.x0 && inner.x1 <= outer.x1 && inner.y0 >= outer.y0 && inner.y1 <= outer.y1
  );
}

/** How wide a name's words are drawn, measured once each on a canvas in the scene's own font. */
function textMeasure(): (text: string) => number {
  const context = document.createElement("canvas").getContext("2d");
  const widths = new Map<string, number>();
  return (text) => {
    const held = widths.get(text);
    if (held !== undefined) return held;
    if (context === null) return text.length * NAME.FONT_SIZE * 0.55;
    context.font = `500 ${NAME.FONT_SIZE}px ${getComputedStyle(document.body).fontFamily}`;
    const width = context.measureText(text).width;
    widths.set(text, width);
    return width;
  };
}

/** The listed tasks the campus stands, those of the snapshot's repository or of none chosen yet. */
function campusTasksOf(tasks: readonly TaskSummary[], repository: string) {
  const wanted = repository.toLowerCase();
  return tasks
    .filter((task) => task.repository === null || task.repository.toLowerCase() === wanted)
    .map((task) => ({ id: task.id, name: task.name, createdAt: task.createdAt }));
}

/** The campus over the page's state, in the scene's box. */
export function CampusScene({
  state,
  shown,
  home,
  onHover,
  onPick,
  onAway,
  tasks,
}: StageSceneProps & { tasks: readonly TaskSummary[] }): React.JSX.Element {
  const { view, snapshot, selected, hovered, blast, layers, still, dark } = state;
  const [layout, setLayout] = useAtom(layoutAtom);
  const svg = useRef<SVGSVGElement>(null);
  const camera = useRef<SVGGElement>(null);
  const cam = useRef<Camera>({ x: 0, y: 0, s: 1 });
  const size = useRef({ width: 0, height: 0 });
  const away = useRef(false);
  const [frame, setFrame] = useState<Frame>({
    settled: false,
    detail: CAMPUS_DETAIL.NEAR,
    culled: null,
    nameScale: 1,
  });
  const frameNow = useRef(frame);
  frameNow.current = frame;
  const [angles] = useState(angleStoreOf);
  const measure = useMemo(textMeasure, []);

  const inputs = useMemo(
    () => campusTasksOf(tasks, snapshot.repository.fullName),
    [tasks, snapshot.repository.fullName],
  );
  const campus = useMemo(() => campusReadingOf(view, snapshot, inputs), [view, snapshot, inputs]);
  const plan = useMemo(() => campusPlanOf(campus, view, layout), [campus, view, layout]);
  const objects = useMemo(
    () => campusObjectsOf(plan, campus.tasks, campus.planned),
    [plan, campus],
  );
  const bounds = useMemo(() => campusBoundsOf(plan), [plan]);
  const big = campus.tasks.length > CAMPUS_BIG_FROM;
  const drawing = useMemo<CampusDrawing>(
    () => ({ dark, detail: frame.detail, big, still }),
    [dark, frame.detail, big, still],
  );
  const taskIndex = useMemo(
    () => new Map(campus.tasks.map((task, index) => [task.id, index])),
    [campus],
  );
  const agentIndex = useMemo(
    () => new Map(view.agents.map((agent, index) => [agent.id, index])),
    [view],
  );
  const containerIndex = useMemo(
    () => new Map(plan.containers.map((placed, index) => [placed, index])),
    [plan],
  );
  const objectIndex = useMemo(
    () => new Map(objects.map((object, index) => [object, index])),
    [objects],
  );

  // Note that what a press lands on is read from the reading drawn, through a ref, so the handlers never redraw.
  const picks = useRef({ campus, plan, view });
  picks.current = { campus, plan, view };

  /** What the element under the pointer stands for; nothing for the ground. */
  const targetOf = useCallback((element: EventTarget | null): PickTarget | undefined => {
    if (!(element instanceof Element)) return undefined;
    const holder = element.closest("[data-pick-kind]");
    if (holder === null) return undefined;
    const kind = holder.getAttribute("data-pick-kind");
    const index = Number(holder.getAttribute("data-pick-index"));
    const { campus: read, plan: laid, view: viewed } = picks.current;
    if (kind === PICK_SOURCE.TASK) {
      const task = read.tasks[index];
      return task === undefined ? undefined : { kind: PICK_KIND.TASK, id: task.id };
    }
    if (kind === PICK_SOURCE.CONTAINER) {
      const container = laid.containers[index]?.container;
      if (container === undefined) return undefined;
      return {
        kind: container.place === CONTAINER_PLACE.GATE ? PICK_KIND.AGENT : PICK_KIND.SHIPPED,
        id: container.id,
      };
    }
    if (kind === PICK_SOURCE.PLANNED) {
      const issue = read.planned[index];
      return issue === undefined ? undefined : { kind: PICK_KIND.PLANNED, id: issue.identifier };
    }
    if (kind === PICK_SOURCE.DISTRICT) {
      const district = laid.districts[index];
      return district === undefined || district.path === NOT_IN_CODE
        ? undefined
        : { kind: PICK_KIND.ZONE, id: district.path };
    }
    if (kind === PICK_SOURCE.STATION) {
      const agent = viewed.agents[index];
      return agent === undefined ? undefined : { kind: PICK_KIND.AGENT, id: agent.id };
    }
    return undefined;
  }, []);

  /** Reads the camera into the frame the drawing depends on, and redraws only where that changed. */
  const settle = useCallback(() => {
    const { width, height } = size.current;
    const was = frameNow.current;
    const detail = campusDetailOf(cam.current.s);
    const showing = windowOf(cam.current, width, height, 0);
    // Note that a window is kept while the screen stays inside it and it is not far wider than the screen, as it is once zoomed in from it.
    const margined = windowOf(cam.current, width, height, CULL_MARGIN);
    const kept =
      was.culled !== null &&
      within(was.culled, showing) &&
      was.culled.x1 - was.culled.x0 <= 2 * (margined.x1 - margined.x0);
    const culled = !big ? null : kept ? was.culled : margined;
    const nameScale =
      Math.abs(cam.current.s - was.nameScale) / was.nameScale > NAME_REFIT
        ? cam.current.s
        : was.nameScale;
    if (
      was.settled &&
      detail === was.detail &&
      culled === was.culled &&
      nameScale === was.nameScale
    )
      return;
    setFrame({ settled: true, detail, culled, nameScale });
  }, [big]);

  /** Writes the camera to the scene, at once or as a flight, and settles what it draws. */
  const applyCamera = useCallback(
    (instant: boolean) => {
      const group = camera.current;
      const root = svg.current;
      if (group === null || root === null) return;
      group.toggleAttribute("data-instant", instant);
      const { x, y, s } = cam.current;
      group.style.transform = `translate(${x}px, ${y}px) scale(${s})`;
      root.style.setProperty("--campus-k", String(1 / s));
      settle();
    },
    [settle],
  );

  /** The scale that fits the whole campus in the box. */
  const fittedScale = useCallback(() => {
    const { width, height } = size.current;
    return Math.max(
      0.01,
      Math.min(
        (width - FIT_ROOM.WIDE) / (bounds.x1 - bounds.x0),
        (height - FIT_ROOM.HIGH) / (bounds.y1 - bounds.y0),
      ),
    );
  }, [bounds]);

  const fitCampus = useCallback(
    (instant: boolean) => {
      const { width, height } = size.current;
      if (width === 0 || height === 0) return;
      const s = fittedScale();
      cam.current = {
        s,
        x: width / 2 - ((bounds.x0 + bounds.x1) / 2) * s,
        y: (height - FIT_ROOM.LIFT) / 2 - ((bounds.y0 + bounds.y1) / 2) * s,
      };
      away.current = false;
      onAway(false);
      applyCamera(instant);
    },
    [bounds, fittedScale, applyCamera, onAway],
  );

  const flyTo = useCallback(
    (x: number, y: number, z: number, scale: number) => {
      const { width, height } = size.current;
      const [px, py] = campusProject(x, y, z);
      cam.current = {
        s: scale,
        x: width / 2 - px * scale,
        y: height / 2 - py * scale + FIT_ROOM.LIFT / 2,
      };
      away.current = true;
      onAway(true);
      applyCamera(false);
    },
    [applyCamera, onAway],
  );

  const goneAway = useCallback(() => {
    if (away.current) return;
    away.current = true;
    onAway(true);
  }, [onAway]);

  useLayoutEffect(() => {
    home.current = () => fitCampus(false);
    return () => {
      home.current = undefined;
    };
  }, [home, fitCampus]);

  // The box's size: the first lands the fitted campus, a later one keeps its middle where it was, and none at all still draws.
  useLayoutEffect(() => {
    const root = svg.current;
    if (root === null) return undefined;
    const measured = () => {
      const width = root.clientWidth;
      const height = root.clientHeight;
      const was = size.current;
      size.current = { width, height };
      if (width === 0 || height === 0) {
        settle();
        return;
      }
      if (was.width === 0 || was.height === 0) {
        fitCampus(true);
        return;
      }
      cam.current.x += (width - was.width) / 2;
      cam.current.y += (height - was.height) / 2;
      applyCamera(true);
    };
    measured();
    const observer = new ResizeObserver(measured);
    observer.observe(root);
    return () => observer.disconnect();
  }, [fitCampus, applyCamera, settle]);

  // A campus laid out again (the layout switched, or tasks came and went) fits again where the camera stood at home.
  const fitted = useRef(bounds);
  useEffect(() => {
    if (fitted.current === bounds) return;
    const switched =
      fitted.current.x1 - fitted.current.x0 !== bounds.x1 - bounds.x0 ||
      fitted.current.y1 - fitted.current.y0 !== bounds.y1 - bounds.y0;
    fitted.current = bounds;
    if (switched && !away.current) fitCampus(true);
  }, [bounds, fitCampus]);
  const lastLayout = useRef(layout);
  useEffect(() => {
    if (lastLayout.current === layout) return;
    lastLayout.current = layout;
    fitCampus(false);
  }, [layout, fitCampus]);

  // A newly selected building, container, or blueprint is flown to.
  const selectedKind = selected?.kind;
  const selectedId = selected?.id;
  useEffect(() => {
    if (selectedKind === undefined || selectedId === undefined) return;
    const base = fittedScale();
    const laid = picks.current.plan;
    if (selectedKind === PICK_KIND.TASK) {
      const slot = laid.plots.get(selectedId);
      if (slot === undefined) return;
      const hall = slot.hollow;
      flyTo(
        hall.x + hall.w / 2,
        hall.y + hall.d / 2,
        hall.h * 0.45,
        Math.max(base * REACH.BUILDING, REACH.BUILDING_LEAST),
      );
      return;
    }
    if (selectedKind === PICK_KIND.AGENT || selectedKind === PICK_KIND.SHIPPED) {
      const placed = laid.containers.find((each) => each.container.id === selectedId);
      if (placed !== undefined)
        flyTo(placed.x, placed.y, placed.z + placed.h / 2, base * REACH.CONTAINER);
      return;
    }
    if (selectedKind === PICK_KIND.PLANNED) {
      const slot = laid.blueprints.get(selectedId);
      if (slot !== undefined)
        flyTo(slot.plot.x + slot.plot.w / 2, slot.plot.y + slot.plot.d / 2, 0, base * REACH.YARD);
      return;
    }
    if (selectedKind === PICK_KIND.ZONE) {
      const district = laid.districts.find((each) => each.path === selectedId);
      if (district !== undefined)
        flyTo(district.x + district.w / 2, district.y + district.d / 2, 0, base * REACH.YARD);
    }
  }, [selectedKind, selectedId, fittedScale, flyTo]);

  // The wheel zooms about the pointer; it is held on the element itself, since React's wheel cannot keep the page from scrolling.
  useEffect(() => {
    const root = svg.current;
    if (root === null) return undefined;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const box = root.getBoundingClientRect();
      const ox = event.clientX - box.left;
      const oy = event.clientY - box.top;
      const base = fittedScale();
      const factor = Math.exp(
        -event.deltaY * (event.ctrlKey ? WHEEL_ZOOM.PINCH : WHEEL_ZOOM.WHEEL),
      );
      const next = Math.max(base * REACH.FARTHEST, Math.min(REACH.NEAREST, cam.current.s * factor));
      cam.current = {
        x: ox - ((ox - cam.current.x) * next) / cam.current.s,
        y: oy - ((oy - cam.current.y) * next) / cam.current.s,
        s: next,
      };
      onHover(undefined);
      goneAway();
      applyCamera(true);
    };
    root.addEventListener("wheel", wheel, { passive: false });
    return () => root.removeEventListener("wheel", wheel);
  }, [fittedScale, applyCamera, goneAway, onHover]);

  // Which cranes turn: the first few going up, none in a big campus, and none far out or held still.
  const turning = useMemo(() => {
    if (big || still || frame.detail === CAMPUS_DETAIL.FAR) return new Set<string>();
    return new Set(
      campus.tasks
        .filter((task) => task.underway && plan.plots.get(task.id)?.crane != null)
        .slice(0, CRANES_MAX)
        .map((task) => task.id),
    );
  }, [big, still, frame.detail, campus, plan]);

  // The one loop: it runs only while a crane turns, the campus is on screen, and the page is visible.
  const [visible, setVisible] = useState(() => !document.hidden);
  useEffect(() => {
    const changed = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", changed);
    return () => document.removeEventListener("visibilitychange", changed);
  }, []);
  const moving = turning.size > 0 && shown && visible;
  useEffect(() => {
    if (!moving) return undefined;
    let last = performance.now();
    let request = requestAnimationFrame(function step(now) {
      const delta = Math.min(0.05, (now - last) / 1000);
      last = now;
      angles.write(angles.read() + delta * CRANE_TURN);
      request = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(request);
  }, [moving, angles]);

  // The pointer: a press and a drag pan, a press that did not drag picks, and a rest names what it rests on.
  const drag = useRef<{ x: number; y: number; cx: number; cy: number; moved: boolean } | undefined>(
    undefined,
  );
  const dragged = useRef(false);
  const lastHover = useRef<PickTarget | undefined>(undefined);
  const hoverFrame = useRef<number | undefined>(undefined);
  const onPointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    drag.current = {
      x: event.clientX,
      y: event.clientY,
      cx: cam.current.x,
      cy: cam.current.y,
      moved: false,
    };
    dragged.current = false;
  };
  const hoverAt = (target: EventTarget | null, clientX: number, clientY: number) => {
    const root = svg.current;
    if (root === null) return;
    const found = targetOf(target);
    const held = lastHover.current;
    const next =
      found !== undefined && held !== undefined && found.kind === held.kind && found.id === held.id
        ? held
        : found;
    lastHover.current = next;
    if (next === undefined) {
      onHover(undefined);
      return;
    }
    const box = root.getBoundingClientRect();
    onHover({ target: next, at: { x: clientX - box.left, y: clientY - box.top } });
  };
  const onPointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const held = event.buttons === 0 ? undefined : drag.current;
    if (held === undefined) drag.current = undefined;
    if (held !== undefined) {
      const dx = event.clientX - held.x;
      const dy = event.clientY - held.y;
      if (!held.moved && Math.hypot(dx, dy) < DRAG_SLOP) return;
      if (!held.moved) {
        held.moved = true;
        dragged.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
        event.currentTarget.toggleAttribute("data-dragging", true);
        lastHover.current = undefined;
        onHover(undefined);
        goneAway();
      }
      cam.current = { ...cam.current, x: held.cx + dx, y: held.cy + dy };
      applyCamera(true);
      return;
    }
    // Note that a hover is read once a frame however often the pointer reports.
    const { target, clientX, clientY } = event;
    if (hoverFrame.current !== undefined) cancelAnimationFrame(hoverFrame.current);
    hoverFrame.current = requestAnimationFrame(() => {
      hoverFrame.current = undefined;
      hoverAt(target, clientX, clientY);
    });
  };
  const onPointerUp = (event: React.PointerEvent<SVGSVGElement>) => {
    drag.current = undefined;
    event.currentTarget.toggleAttribute("data-dragging", false);
  };
  const onPointerLeave = () => {
    // Note that a press that left before it became a drag is not captured, so its release is never heard here: it ends now.
    if (drag.current !== undefined && !drag.current.moved) drag.current = undefined;
    if (hoverFrame.current !== undefined) cancelAnimationFrame(hoverFrame.current);
    hoverFrame.current = undefined;
    lastHover.current = undefined;
    onHover(undefined);
  };
  useEffect(
    () => () => {
      if (hoverFrame.current !== undefined) cancelAnimationFrame(hoverFrame.current);
    },
    [],
  );
  const onClick = (event: React.MouseEvent<SVGSVGElement>) => {
    if (dragged.current) {
      dragged.current = false;
      return;
    }
    onPick(targetOf(event.target));
  };
  const onKeyDown = (event: React.KeyboardEvent<SVGSVGElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const target = targetOf(event.target);
    if (target === undefined) return;
    event.preventDefault();
    onPick(target);
  };

  // What is drawn: everything in a small campus; in a big one zoomed in, what stands on screen and round it, and what is open.
  const openTask = selected?.kind === PICK_KIND.TASK ? selected.id : undefined;
  const shownObjects = useMemo(
    () =>
      frame.culled === null
        ? objects
        : objects.filter(
            (object) =>
              campusSeen(frame.culled, object.at) ||
              (object.kind === CAMPUS_OBJECT.BUILDING && object.task.id === openTask),
          ),
    [objects, frame.culled, openTask],
  );
  const shownBuildings = useMemo(
    () =>
      shownObjects.flatMap((object) => (object.kind === CAMPUS_OBJECT.BUILDING ? [object] : [])),
    [shownObjects],
  );
  const smoking = useMemo(
    () =>
      smokeRationOf(
        shownBuildings.map((object) => object.task),
        plan.plots,
        frame.detail,
      ),
    [shownBuildings, plan, frame.detail],
  );
  const pads = useMemo(
    () => shownBuildings.flatMap((object) => plotShapesOf(object.slot, drawing)),
    [shownBuildings, drawing],
  );
  const shadows = useMemo(() => {
    if (frame.detail === CAMPUS_DETAIL.FAR) return "";
    return shownObjects
      .map((object) => {
        switch (object.kind) {
          case CAMPUS_OBJECT.BUILDING:
            return buildingShadowOf(object.slot);
          case CAMPUS_OBJECT.CONTAINER:
            return containerShadowOf(object.placed);
          case CAMPUS_OBJECT.TREE:
            return treeShadowOf(object.at.x, object.at.y);
          case CAMPUS_OBJECT.GATE:
            return gateShadowOf();
          default:
            return "";
        }
      })
      .join("");
  }, [shownObjects, frame.detail]);

  // The tasks a route is drawn for, and the edges of what is selected and pointed at.
  const taskOfTarget = (target: PickTarget | undefined): string | undefined => {
    if (target === undefined) return undefined;
    if (target.kind === PICK_KIND.TASK) return target.id;
    if (target.kind === PICK_KIND.AGENT)
      return view.agentById.get(target.id)?.agent.taskId ?? undefined;
    if (target.kind === PICK_KIND.SHIPPED)
      return view.timeline.find((entry) => entry.url === target.id)?.taskId;
    return undefined;
  };
  const selectedTask = taskOfTarget(selected);
  const hoveredTask = taskOfTarget(hovered);
  const routes = [...new Set([selectedTask, hoveredTask])].flatMap((taskId) => {
    const slot = taskId === undefined ? undefined : plan.plots.get(taskId);
    if (taskId === undefined || slot === undefined) return [];
    const mine = plan.containers.filter((placed) => placed.container.taskId === taskId);
    return routePointsOf(slot, mine, plan.lot).map((points) => ({
      points,
      selected: taskId === selectedTask,
    }));
  });
  const containerFor = (target: PickTarget | undefined) =>
    target === undefined || (target.kind !== PICK_KIND.AGENT && target.kind !== PICK_KIND.SHIPPED)
      ? undefined
      : plan.containers.find((placed) => placed.container.id === target.id);
  const edges = [
    {
      state: EDGE.HOVERED,
      task: hoveredTask,
      container: containerFor(hovered),
      zone: hovered?.kind === PICK_KIND.ZONE ? hovered.id : undefined,
    },
    {
      state: EDGE.SELECTED,
      task: selectedTask,
      container: containerFor(selected),
      zone: selected?.kind === PICK_KIND.ZONE ? selected.id : undefined,
    },
  ] as const;
  const hotIssues = new Set(
    [selected, hovered].flatMap((target) =>
      target?.kind === PICK_KIND.PLANNED ? [target.id] : [],
    ),
  );

  // The names: the open task's first, then where something happens, each placed only where it overlaps none already placed.
  const lotWords = `Shipped since ${dayText(view.shippedSince)}`;
  const names = useMemo(() => {
    const scale = frame.nameScale;
    const taken: (readonly [number, number, number, number])[] = [];
    const fits = (x: number, y: number, text: string) => {
      const width = measure(text) + NAME.GAP;
      const box = [
        x * scale - width / 2,
        y * scale - NAME.RISE - 2,
        x * scale + width / 2,
        y * scale - NAME.RISE - 2 + NAME.HIGH + 4,
      ] as const;
      if (
        taken.some(
          (each) => box[0] < each[2] && box[2] > each[0] && box[1] < each[3] && box[3] > each[1],
        )
      )
        return false;
      taken.push(box);
      return true;
    };
    const placed: Name[] = [];
    const anchors = yardAnchorsOf(plan.lot);
    if (fits(anchors.gate[0], anchors.gate[1], "Merge gate")) {
      placed.push({
        x: anchors.gate[0],
        y: anchors.gate[1],
        text: "Merge gate",
        dot: null,
        painted: false,
      });
    }
    const lotY = anchors.lot[1] + 34 / scale;
    if (fits(anchors.lot[0], lotY, lotWords)) {
      placed.push({
        x: anchors.lot[0],
        y: lotY,
        text: lotWords,
        dot: SIGNAL_COLOR.SHIPPED,
        painted: false,
      });
    }
    for (const district of plan.districts) {
      const [x, y] = districtAnchorOf(district);
      const text =
        district.path === NOT_IN_CODE
          ? "Not in code yet"
          : (view.zoneByPath.get(district.path)?.label ?? district.path);
      if (
        campusSeen(frame.culled, {
          x: district.x + district.w,
          y: district.y + district.d,
          z: 0,
        }) &&
        fits(x, y + 44 / scale, text)
      ) {
        placed.push({ x, y, text, dot: null, painted: true });
      }
    }
    const rankOf = (task: CampusTask) => (task.id === openTask ? 0 : NAME_RANK[task.signal]);
    const candidates = shownBuildings
      .filter((object) => campus.tasks.length <= NAME_ALL_UP_TO || rankOf(object.task) < QUIET_RANK)
      .map((object) => ({ task: object.task, at: nameAnchorOf(object.task, object.slot) }))
      .sort(
        (left, right) =>
          rankOf(left.task) - rankOf(right.task) || right.task.createdAt - left.task.createdAt,
      );
    for (const { task, at } of candidates) {
      if (fits(at[0], at[1], task.name)) {
        placed.push({
          x: at[0],
          y: at[1],
          text: task.name,
          dot: SIGNAL_DOT[task.signal],
          painted: false,
        });
      }
    }
    return placed;
  }, [
    frame.nameScale,
    frame.culled,
    plan,
    view,
    shownBuildings,
    campus,
    openTask,
    measure,
    lotWords,
  ]);

  const colours = campusColoursOf(dark);
  const hidden = Object.fromEntries(
    Object.values(WORLD_LAYER).flatMap((layer) =>
      layers[layer] ? [] : [[HIDDEN_LAYER[layer], ""]],
    ),
  );
  // Note that a failed agent's signal stands under Building or Defects, as every world draws a failed agent (`agentDrawnUnder`).
  const failedHidden = !agentDrawnUnder({ state: AGENT_STATE.FAILED }, layers);
  const districtLabels = plan.districts.map((district) =>
    district.path === NOT_IN_CODE
      ? "Not in code yet"
      : `${view.zoneByPath.get(district.path)?.label ?? district.path} district`,
  );
  const glow = !big && dark && frame.detail === CAMPUS_DETAIL.NEAR;
  return (
    <div className="factory-campus">
      <svg
        ref={svg}
        className="factory-campus-scene"
        data-detail={frame.detail}
        data-big={big ? "" : undefined}
        data-glow={glow ? "" : undefined}
        data-resting={shown && visible ? undefined : ""}
        {...hidden}
        data-hide-failed={failedHidden ? "" : undefined}
        style={cssCustomProperties({
          "--campus-ground": colours.ground,
          "--campus-unlit": colours.unlit,
          "--campus-selection": SIGNAL_COLOR.SELECTION,
        })}
        aria-label="Campus"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={onPointerLeave}
        onClick={onClick}
        onKeyDown={onKeyDown}
      >
        <defs>
          <filter id={GLOW_FILTER} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2.2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          {[CAMPUS_GRADIENT.METAL, CAMPUS_GRADIENT.BRICK].map((gradient) => (
            <linearGradient key={gradient} id={GRADIENT_ID[gradient]} x1="0" x2="1">
              {campusGradientStopsOf(gradient, dark).map((stop, index, stops) => (
                <stop key={stop} offset={index / Math.max(1, stops.length - 1)} stopColor={stop} />
              ))}
            </linearGradient>
          ))}
          <radialGradient id={GRADIENT_ID[CAMPUS_GRADIENT.POOL]}>
            <stop offset="0" stopColor={colours.lamp} stopOpacity="0.3" />
            <stop offset="1" stopColor={colours.lamp} stopOpacity="0" />
          </radialGradient>
        </defs>
        <g ref={camera} className="factory-campus-camera">
          {frame.settled ? (
            <>
              <Ground plan={plan} drawing={drawing} />
              <Districts districts={plan.districts} labels={districtLabels} drawing={drawing} />
              {blast.size === 0 ? null : <Shapes shapes={blastShapesOf(plan, blast)} />}
              <Shapes shapes={pads} />
              {edges.map(({ state: edge, task, zone }) => {
                const slot = task === undefined ? undefined : plan.plots.get(task);
                const district =
                  zone === undefined
                    ? undefined
                    : plan.districts.find((each) => each.path === zone);
                return (
                  <g key={edge} className="factory-campus-edge" data-edge={edge}>
                    {slot === undefined ? null : <polygon points={outlineOf(slot.plot, 0.1)} />}
                    {district === undefined ? null : <polygon points={outlineOf(district, 0.02)} />}
                  </g>
                );
              })}
              {shadows === "" ? null : <path d={shadows} fill={shadowFillOf(dark)} />}
              {routes.map((route, index) => (
                <polyline
                  key={index}
                  className="factory-campus-route"
                  data-selected={route.selected ? "" : undefined}
                  points={route.points}
                />
              ))}
              {shownObjects.map((object) => {
                switch (object.kind) {
                  case CAMPUS_OBJECT.BUILDING:
                    return (
                      <Building
                        key={object.task.id}
                        index={taskIndex.get(object.task.id) ?? -1}
                        task={object.task}
                        slot={object.slot}
                        drawing={drawing}
                        smokes={smoking.has(object.task.id)}
                        open={object.task.id === openTask}
                        turning={turning.has(object.task.id)}
                        angles={angles}
                        agentIndex={agentIndex}
                      />
                    );
                  case CAMPUS_OBJECT.CONTAINER:
                    return (
                      <Container
                        key={object.placed.container.id}
                        index={containerIndex.get(object.placed) ?? -1}
                        placed={object.placed}
                        drawing={drawing}
                      />
                    );
                  case CAMPUS_OBJECT.BLUEPRINT:
                    return (
                      <Blueprint
                        key={object.issue.identifier}
                        index={campus.planned.indexOf(object.issue)}
                        label={`Planned: ${object.issue.identifier}, ${object.issue.title}`}
                        slot={object.slot}
                        drawing={drawing}
                        hot={hotIssues.has(object.issue.identifier)}
                      />
                    );
                  default:
                    return (
                      <Fixture
                        key={objectIndex.get(object)}
                        object={object}
                        drawing={drawing}
                        plan={plan}
                      />
                    );
                }
              })}
              {edges.map(({ state: edge, container }) =>
                container === undefined ? null : (
                  <polygon
                    key={edge}
                    className="factory-campus-edge"
                    data-edge={edge}
                    points={containerOutlineOf(container)}
                  />
                ),
              )}
              <g className="factory-campus-names">
                {names.map((name, index) => {
                  const width =
                    measure(name.text) +
                    (name.dot === null ? NAME.PAD * 2 : NAME.DOT_PAD + NAME.PAD);
                  const transform = {
                    transform: `translate(${name.x}px, ${name.y}px) scale(var(--campus-k))`,
                  };
                  return name.painted ? (
                    <g key={index} className="factory-campus-painted" style={transform}>
                      <text x={0} y={16} textAnchor="middle">
                        {name.text}
                      </text>
                    </g>
                  ) : (
                    <g key={index} className="factory-campus-name" style={transform}>
                      <rect x={-width / 2} y={-NAME.RISE} width={width} height={NAME.HIGH} rx={5} />
                      {name.dot === null ? null : (
                        <circle cx={-width / 2 + 10} cy={-15.5} r={3.5} fill={name.dot} />
                      )}
                      <text
                        x={-width / 2 + (name.dot === null ? NAME.PAD : NAME.DOT_PAD)}
                        y={-11.5}
                      >
                        {name.text}
                      </text>
                    </g>
                  );
                })}
              </g>
            </>
          ) : null}
        </g>
      </svg>
      <div className="factory-campus-layout">
        <Segmented legend="Layout" options={LAYOUT_OPTIONS} value={layout} onChange={setLayout} />
      </div>
    </div>
  );
}
