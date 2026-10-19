import { PULL_REQUEST_STATE } from "@luke/features/coding-agent-wire";
import type { FactoryWorld } from "@luke/features/factory-world-wire";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import {
  BUTTON_VARIANT,
  Button,
  CHIP_LOOK,
  Chip,
  cssCustomProperties,
  IconButton,
  TEXT_ELEMENT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
} from "@luke/ui";
import {
  AGENT_KIND,
  AGENT_STATE,
  type AgentState,
  type AgentView,
  type FactoryWorldView,
  type PipelineCounts,
  SIGNAL_COLOR,
  type ZoneView,
} from "@luke/ui/factory-world";
import {
  ArrowRightIcon,
  ArrowUpRightIcon,
  BlocksIcon,
  BotIcon,
  BugIcon,
  CornerUpLeftIcon,
  FileTextIcon,
  GitMergeIcon,
  HouseIcon,
  ListTodoIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { LinesChanged } from "../tasks/agent-published.js";
import { dayAndTimeText } from "../tasks/task-time.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { Tooltip } from "../tooltip.js";
import type { SceneHover } from "./contract.js";
import { PICK_KIND, type PickTarget, WORLD_LAYER, type WorldLayer } from "./world.js";

/**
 * world-chrome.tsx -- what the page draws over the campus, in its DOM: the pipeline bar whose counts switch the layers, the hover label, the card of what is selected, and the way home.
 *
 * Every word here is DOM text, so session replay masks it as it masks the
 * rest of the panel. The colours a signal is drawn in are the view model's
 * (`SIGNAL_COLOR`), the same in the bar, the card, and the campus. A card only opens places that already
 * exist: an agent's page, a pull request on GitHub, a task.
 */

/** What Esc and the home button say they do. */
const OVERVIEW = "Overview";

/** Each stage of the pipeline bar: the layer its count switches, its name, its glyph, and its signal. */
const STAGES = [
  { layer: WORLD_LAYER.PLANNED, name: "Planned", Icon: ListTodoIcon, color: SIGNAL_COLOR.PLANNED },
  { layer: WORLD_LAYER.BUILDING, name: "Building", Icon: BlocksIcon, color: SIGNAL_COLOR.BUILDING },
  { layer: WORLD_LAYER.SHIPPED, name: "Shipped", Icon: GitMergeIcon, color: SIGNAL_COLOR.SHIPPED },
  { layer: WORLD_LAYER.DEFECTS, name: "Defects", Icon: BugIcon, color: SIGNAL_COLOR.DEFECT },
] as const;

/** How an agent's state is said. */
const STATE_WORDS = {
  [AGENT_STATE.WORKING]: "Working",
  [AGENT_STATE.STUCK]: "Stuck",
  [AGENT_STATE.WAITING]: "Waiting on you",
  [AGENT_STATE.FAILED]: "Failed",
  [AGENT_STATE.IDLE]: "Idle",
} as const satisfies Record<AgentState, string>;

/** How a task at rest whose work merged is said. */
const SHIPPED_WORDS = "Shipped";

/** The signal an agent's card is edged in, by its state. */
const STATE_COLOR = {
  [AGENT_STATE.WORKING]: SIGNAL_COLOR.BUILDING,
  [AGENT_STATE.STUCK]: SIGNAL_COLOR.BUILDING,
  [AGENT_STATE.WAITING]: SIGNAL_COLOR.BUILDING,
  [AGENT_STATE.FAILED]: SIGNAL_COLOR.DEFECT,
  [AGENT_STATE.IDLE]: SIGNAL_COLOR.SELECTION,
} as const satisfies Record<AgentState, string>;

/** How many of a world's pull requests' lines fill the card's bar: past it, the bar is full. */
const BAR_FULL_LINES = 5000;

function signalStyle(color: string) {
  return cssCustomProperties({ "--world-signal": color });
}

/** The count a stage shows: its pipeline count, building with those stuck beside it. */
function stageCount(layer: WorldLayer, counts: PipelineCounts): number {
  if (layer === WORLD_LAYER.PLANNED) return counts.planned;
  if (layer === WORLD_LAYER.BUILDING) return counts.building;
  if (layer === WORLD_LAYER.SHIPPED) return counts.shipped;
  return counts.defects;
}

/**
 * The pipeline bar: planned, then building with those stuck beside it, then
 * shipped, and the defects that loop back to planned. Each count picks out
 * its layer: the pointer resting on it, or the keyboard on it, draws that
 * layer alone for as long as it stays, and a press keeps it alone, pressed,
 * until it is pressed again or another count is. With none pressed, every
 * layer is drawn.
 */
export function PipelineBar({
  counts,
  chosen,
  onChoose,
  onPreview,
}: {
  counts: PipelineCounts;
  /** The layer pressed, drawn alone; none while every layer is drawn. */
  chosen: WorldLayer | undefined;
  /** A press on a count: its layer alone, or every layer again where it was the one pressed. */
  onChoose: (layer: WorldLayer) => void;
  /** The count the pointer rests on, else the one the keyboard is on, or neither. */
  onPreview: (layer: WorldLayer | undefined) => void;
}): React.JSX.Element {
  // Note that the pointer and the keyboard are held apart, so one leaving a count never takes the other's preview with it.
  const [pointed, setPointed] = useState<WorldLayer | undefined>(undefined);
  const [focused, setFocused] = useState<WorldLayer | undefined>(undefined);
  useEffect(() => onPreview(pointed ?? focused), [pointed, focused, onPreview]);
  return (
    <fieldset className="factory-world-pipeline" aria-label="Layers">
      {STAGES.map(({ layer, name, Icon, color }, index) => (
        <span key={layer} className="factory-world-stage-slot">
          {index === 0 ? null : (
            <span
              className="factory-world-flow"
              data-back={layer === WORLD_LAYER.DEFECTS ? "" : undefined}
              aria-hidden="true"
            >
              {layer === WORLD_LAYER.DEFECTS ? <CornerUpLeftIcon /> : <ArrowRightIcon />}
            </span>
          )}
          <Chip
            look={CHIP_LOOK.FILTER}
            aria-pressed={chosen === layer}
            data-layer={layer}
            data-faded={chosen !== undefined && chosen !== layer ? "" : undefined}
            onClick={() => {
              onChoose(layer);
              // Note that a press settles the preview: what is drawn now is the press, until the pointer or keyboard moves to another count.
              setPointed(undefined);
              setFocused(undefined);
            }}
            onPointerOver={() => setPointed(layer)}
            onPointerOut={(event) => {
              // Note that leaving a count for its own words keeps the preview, and for an arrow, a gap, or out of the bar ends it.
              if (
                !(
                  event.relatedTarget instanceof Node &&
                  event.currentTarget.contains(event.relatedTarget)
                )
              )
                setPointed(undefined);
            }}
            onFocus={() => setFocused(layer)}
            onBlur={() => setFocused(undefined)}
          >
            <span className="factory-world-signal" style={signalStyle(color)}>
              <Icon aria-hidden="true" />
            </span>
            <span className="factory-world-stage-count">{stageCount(layer, counts)}</span>
            <span>{name}</span>
            {layer === WORLD_LAYER.BUILDING && counts.stuck > 0 ? (
              <span className="factory-world-stuck">{`${counts.stuck} stuck`}</span>
            ) : null}
          </Chip>
        </span>
      ))}
    </fieldset>
  );
}

/** The way back to the establishing shot, which Esc takes too. */
export function HomeButton({ onHome }: { onHome: () => void }): React.JSX.Element {
  return (
    <div className="factory-world-home">
      <Tooltip label={OVERVIEW} command={APP_COMMAND.EXIT_FACTORY}>
        <IconButton icon={<HouseIcon />} label={OVERVIEW} onClick={onHome} />
      </Tooltip>
    </div>
  );
}

/** What a target is called, and the line under it, as the label and the card name it; nothing where the view no longer holds it. */
interface Naming {
  readonly title: string;
  readonly detail: string;
  readonly color: string;
}

function zoneDetail(zone: ZoneView): string {
  const files = `${zone.files} ${zone.files === 1 ? "file" : "files"}`;
  return zone.label === zone.path ? `${zone.layer} · ${files}` : `${zone.path} · ${files}`;
}

/** A task's most pressing state: what its agents say, the most pressing first, and idle with none at work. */
const STATE_RANK: readonly AgentState[] = [
  AGENT_STATE.FAILED,
  AGENT_STATE.WORKING,
  AGENT_STATE.WAITING,
  AGENT_STATE.STUCK,
  AGENT_STATE.IDLE,
];

/** The agents of the view that work on `taskId`. */
function agentsOfTask(view: FactoryWorldView, taskId: string): AgentView[] {
  return view.agents.filter((agent) => agent.agent.taskId === taskId);
}

function taskNaming(
  taskId: string,
  view: FactoryWorldView,
  taskNames: ReadonlyMap<string, string>,
): Naming | undefined {
  const name = taskNames.get(taskId);
  if (name === undefined) return undefined;
  const agents = agentsOfTask(view, taskId);
  const state =
    STATE_RANK.find((each) => agents.some((agent) => agent.state === each)) ?? AGENT_STATE.IDLE;
  const count = `${agents.length} ${agents.length === 1 ? "agent" : "agents"}`;
  // Note that a task at rest with merged work and nothing open is shipped, as its building says.
  const states = agents.flatMap((agent) =>
    agent.agent.pullRequest === null ? [] : [agent.agent.pullRequest.state],
  );
  const merged =
    states.includes(PULL_REQUEST_STATE.MERGED) ||
    view.timeline.some((entry) => entry.taskId === taskId && entry.mergedAt <= view.snapshotAt);
  const open =
    states.includes(PULL_REQUEST_STATE.OPEN) || states.includes(PULL_REQUEST_STATE.DRAFT);
  if (state === AGENT_STATE.IDLE && merged && !open) {
    return { title: name, detail: `${SHIPPED_WORDS} · ${count}`, color: SIGNAL_COLOR.SHIPPED };
  }
  return { title: name, detail: `${STATE_WORDS[state]} · ${count}`, color: STATE_COLOR[state] };
}

/** What a target is called and said to be, read from the view at the scrubber's instant, the snapshot it was read from, and the listed tasks' names. */
export function namingOf(
  target: PickTarget,
  view: FactoryWorldView,
  world: FactoryWorld,
  taskNames: ReadonlyMap<string, string>,
): Naming | undefined {
  if (target.kind === PICK_KIND.TASK) return taskNaming(target.id, view, taskNames);
  if (target.kind === PICK_KIND.AGENT) {
    const agent = view.agentById.get(target.id);
    if (agent === undefined) return undefined;
    const pullRequest = agent.agent.pullRequest;
    const title = pullRequest?.title ?? agent.agent.title ?? "Untitled agent";
    const number = pullRequest === null ? "" : ` · #${pullRequest.number}`;
    return {
      title,
      detail: `${STATE_WORDS[agent.state]}${number}`,
      color: STATE_COLOR[agent.state],
    };
  }
  if (target.kind === PICK_KIND.ZONE) {
    const zone = view.zoneByPath.get(target.id);
    return zone === undefined
      ? undefined
      : { title: zone.label, detail: zoneDetail(zone), color: SIGNAL_COLOR.SELECTION };
  }
  if (target.kind === PICK_KIND.SHIPPED) {
    const merged = view.timeline.find((entry) => entry.url === target.id);
    return merged === undefined
      ? undefined
      : {
          title: merged.title,
          detail: `#${merged.number} · merged ${dayAndTimeText(merged.mergedAt)}`,
          color: SIGNAL_COLOR.SHIPPED,
        };
  }
  if (target.kind === PICK_KIND.PLANNED) {
    const issue = world.planned.find((each) => each.identifier === target.id);
    return issue === undefined
      ? undefined
      : {
          title: issue.title,
          detail:
            issue.state === undefined ? issue.identifier : `${issue.identifier} · ${issue.state}`,
          color: SIGNAL_COLOR.PLANNED,
        };
  }
  const defect = world.defects.find((each) => each.id === target.id);
  return defect === undefined
    ? undefined
    : {
        title: defect.title,
        detail: `${defect.events} events · ${defect.users} users`,
        color: SIGNAL_COLOR.DEFECT,
      };
}

/** The label that follows the pointer over what it rests on. */
export function HoverLabel({
  hover,
  naming,
}: {
  hover: SceneHover;
  naming: Naming;
}): React.JSX.Element {
  return (
    <div
      className="factory-world-label"
      style={cssCustomProperties({
        "--label-x": `${hover.at.x}px`,
        "--label-y": `${hover.at.y}px`,
      })}
      role="status"
    >
      <span className="factory-world-signal" style={signalStyle(naming.color)} aria-hidden="true" />
      <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.LABEL} truncate>
        {naming.title}
      </Text>
      <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED} truncate>
        {naming.detail}
      </Text>
    </div>
  );
}

/** The zones a selection lights on the card's small map: those it touches, and those its work ripples out to. */
interface Reach {
  readonly touched: ReadonlySet<string>;
  readonly downstream: ReadonlySet<string>;
}

/** Each zone a dot at its place on the floor, those the selection touches and those it ripples to lit. */
function BlastMap({ view, reach }: { view: FactoryWorldView; reach: Reach }): React.JSX.Element {
  // Note that the layout's rings stand inside a radius of four units.
  return (
    <div className="factory-world-blast">
      <svg className="factory-world-blast-map" viewBox="-4.2 -4.2 8.4 8.4" aria-hidden="true">
        {view.zones.map((zone) => (
          <circle
            key={zone.path}
            cx={zone.x}
            cy={zone.y}
            r={0.2 + zone.footprint * 0.3}
            data-reach={
              reach.touched.has(zone.path)
                ? "touched"
                : reach.downstream.has(zone.path)
                  ? "downstream"
                  : undefined
            }
          />
        ))}
      </svg>
      <div className="factory-world-blast-counts">
        <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.CAPTION}>
          {`${reach.touched.size} touched`}
        </Text>
        <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.CAPTION}>
          {`${reach.downstream.size} downstream`}
        </Text>
      </div>
    </div>
  );
}

/** The lines a pull request adds and removes, as counts and as a bar filled by their share, its length by how many there are. */
function LinesBar({
  additions,
  deletions,
}: {
  additions: number;
  deletions: number;
}): React.JSX.Element {
  const lines = additions + deletions;
  const filled = Math.min(1, Math.log1p(lines) / Math.log1p(BAR_FULL_LINES));
  const added = lines === 0 ? 0 : (additions / lines) * filled;
  return (
    <div className="factory-world-lines">
      <span
        className="factory-world-lines-bar"
        style={cssCustomProperties({ "--added": added, "--removed": filled - added })}
        aria-hidden="true"
      />
      <LinesChanged additions={additions} deletions={deletions} />
    </div>
  );
}

/** One of a card's doors to a place that already exists. */
interface CardDoor {
  readonly label: string;
  readonly icon: React.ReactNode;
  readonly onOpen: () => void;
}

/** What a card says of the selection: its tag, its naming, its pull request's lines, the zones it reaches, and its doors. */
interface CardFace {
  readonly tag: string;
  readonly naming: Naming;
  readonly lines?: { readonly additions: number; readonly deletions: number } | undefined;
  readonly reach?: Reach;
  readonly doors: readonly CardDoor[];
}

/** An agent's page: its task's where it has one, else its own. */
function openAgent(tasks: TasksControl, agentId: string, taskId: string | null | undefined): void {
  if (taskId === null || taskId === undefined) tasks.agentView.onOpen(agentId);
  else tasks.onShowAgent(taskId, agentId);
}

/** What the card says of `target`; nothing where the view no longer holds it. */
function cardFaceOf(
  target: PickTarget,
  view: FactoryWorldView,
  world: FactoryWorld,
  blast: ReadonlyMap<string, number>,
  tasks: TasksControl,
  taskNames: ReadonlyMap<string, string>,
): CardFace | undefined {
  const naming = namingOf(target, view, world, taskNames);
  if (naming === undefined) return undefined;
  const lit = (paths: readonly string[]): Reach => ({
    touched: new Set(paths),
    downstream: new Set(),
  });
  const rippled = (): Reach => {
    const touched = new Set(
      [...blast].flatMap(([path, distance]) => (distance === 0 ? [path] : [])),
    );
    return {
      touched,
      downstream: new Set([...blast.keys()].filter((path) => !touched.has(path))),
    };
  };
  if (target.kind === PICK_KIND.TASK) {
    // Note that two agents of one task may name one pull request, so each is counted once by its number.
    const pullRequests = new Map(
      agentsOfTask(view, target.id).flatMap((agent) =>
        agent.agent.pullRequest === null
          ? []
          : [[agent.agent.pullRequest.number, agent.agent.pullRequest] as const],
      ),
    );
    const lines = [...pullRequests.values()].reduce(
      (sum, pullRequest) => ({
        additions: sum.additions + pullRequest.additions,
        deletions: sum.deletions + pullRequest.deletions,
      }),
      { additions: 0, deletions: 0 },
    );
    return {
      tag: "Task",
      naming,
      lines: pullRequests.size === 0 ? undefined : lines,
      reach: rippled(),
      doors: [
        { label: "Open task", icon: <FileTextIcon />, onOpen: () => tasks.onSelect(target.id) },
      ],
    };
  }
  if (target.kind === PICK_KIND.AGENT) {
    const agent = view.agentById.get(target.id);
    if (agent === undefined) return undefined;
    const { pullRequest, taskId } = agent.agent;
    const doors: CardDoor[] = [
      { label: "Open agent", icon: <BotIcon />, onOpen: () => openAgent(tasks, agent.id, taskId) },
    ];
    if (pullRequest !== null) {
      doors.push({
        label: `#${pullRequest.number}`,
        icon: <ArrowUpRightIcon />,
        onOpen: () => tasks.repositories.openGitHub(pullRequest.url),
      });
    }
    if (taskId !== null) {
      doors.push({
        label: "Open task",
        icon: <FileTextIcon />,
        onOpen: () => tasks.onSelect(taskId),
      });
    }
    return {
      tag: agent.kind === AGENT_KIND.UNKNOWN ? "Agent" : agent.kind,
      naming,
      lines:
        pullRequest === null
          ? undefined
          : { additions: pullRequest.additions, deletions: pullRequest.deletions },
      reach: rippled(),
      doors,
    };
  }
  if (target.kind === PICK_KIND.SHIPPED) {
    const merged = view.timeline.find((entry) => entry.url === target.id);
    if (merged === undefined) return undefined;
    const { taskId } = merged;
    const doors: CardDoor[] = [
      {
        label: `#${merged.number}`,
        icon: <ArrowUpRightIcon />,
        onOpen: () => tasks.repositories.openGitHub(merged.url),
      },
    ];
    if (taskId !== undefined) {
      doors.push({
        label: "Open task",
        icon: <FileTextIcon />,
        onOpen: () => tasks.onSelect(taskId),
      });
    }
    return {
      tag: PULL_REQUEST_STATE.MERGED,
      naming,
      lines: { additions: merged.additions, deletions: merged.deletions },
      reach: lit(merged.zonePaths),
      doors,
    };
  }
  if (target.kind === PICK_KIND.ZONE) {
    return { tag: "Zone", naming, reach: lit([target.id]), doors: [] };
  }
  const placed =
    target.kind === PICK_KIND.PLANNED
      ? world.planned.find((each) => each.identifier === target.id)?.zonePaths
      : world.defects.find((each) => each.id === target.id)?.zonePaths;
  return {
    tag: target.kind === PICK_KIND.PLANNED ? "Planned" : "Defect",
    naming,
    reach: lit(placed ?? []),
    doors: [],
  };
}

/** The card of what is selected: its tag, its name, its pull request's lines, the zones it reaches, and the places it opens. */
export function WorldCard({
  target,
  view,
  world,
  blast,
  tasks,
  taskNames,
  onClose,
}: {
  target: PickTarget;
  view: FactoryWorldView;
  world: FactoryWorld;
  blast: ReadonlyMap<string, number>;
  tasks: TasksControl;
  /** The listed tasks' names, by id, which a task's card is headed with. */
  taskNames: ReadonlyMap<string, string>;
  onClose: () => void;
}): React.JSX.Element | null {
  const face = cardFaceOf(target, view, world, blast, tasks, taskNames);
  if (face === undefined) return null;
  return (
    <section
      className="factory-world-card"
      style={signalStyle(face.naming.color)}
      aria-label={face.naming.title}
    >
      <div className="factory-world-card-head">
        <span className="factory-world-tag">{face.tag}</span>
        <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED} truncate>
          {face.naming.detail}
        </Text>
        <IconButton icon={<XIcon />} label="Close" onClick={onClose} />
      </div>
      <Text as={TEXT_ELEMENT.P} variant={TEXT_VARIANT.LABEL}>
        {face.naming.title}
      </Text>
      {face.lines === undefined ? null : <LinesBar {...face.lines} />}
      {face.reach === undefined ? null : <BlastMap view={view} reach={face.reach} />}
      {face.doors.length === 0 ? null : (
        <div className="factory-world-card-doors">
          {face.doors.map((door) => (
            <Button
              key={door.label}
              variant={BUTTON_VARIANT.OUTLINE}
              icon={door.icon}
              onClick={door.onOpen}
            >
              {door.label}
            </Button>
          ))}
        </div>
      )}
    </section>
  );
}
