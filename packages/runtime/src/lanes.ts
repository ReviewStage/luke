import { availableParallelism } from "node:os";

/**
 * Execution lanes: the separate budgets under which the runtime's work runs,
 * ported from OpenClaw `b7528507`'s agent limits and Gateway lane setup.
 * Each lane admits at most its width at once and queues the rest in order;
 * lanes are separate budgets, never one cap over Luke as a whole.
 */

export const LANE = {
  /** Ordinary conversation turns: asks and observation looks. */
  AGENT: "agent",
  CHILD: "child",
  /** A provider hook's dispatch into a conversation; shares the cron inner budget. */
  HOOK_DISPATCH: "hook-dispatch",
  /** Background memory and plugin completions. */
  BACKGROUND: "background",
} as const;

export type Lane = (typeof LANE)[keyof typeof LANE];

export const LANE_LIST: readonly Lane[] = Object.values(LANE);

export const LANE_DEFAULTS = {
  AGENT_MIN: 8,
  AGENT_MAX: 16,
  CHILD: 8,
  HOOK_DISPATCH: 8,
  BACKGROUND: 3,
} as const;

/** The ordinary agent lane's width for a machine: `min(16, max(8, parallelism))`. */
export function agentLaneWidth(parallelism: number = availableParallelism()): number {
  const floored = Number.isFinite(parallelism) ? Math.floor(parallelism) : LANE_DEFAULTS.AGENT_MIN;
  return Math.min(LANE_DEFAULTS.AGENT_MAX, Math.max(LANE_DEFAULTS.AGENT_MIN, floored));
}

export type LaneWidths = Readonly<Record<Lane, number>>;

/** Every lane's width, applied together or not at all. */
export interface LaneConfiguration {
  readonly widths: LaneWidths;
}

/**
 * The defaults for a machine, following OpenClaw's Gateway lane setup. Hook
 * registration converges at every launch rather than answering to a
 * preference, so hook dispatch always stands.
 */
export function laneConfiguration(parallelism?: number): LaneConfiguration {
  return {
    widths: {
      [LANE.AGENT]: agentLaneWidth(parallelism),
      [LANE.CHILD]: LANE_DEFAULTS.CHILD,
      [LANE.HOOK_DISPATCH]: LANE_DEFAULTS.HOOK_DISPATCH,
      [LANE.BACKGROUND]: LANE_DEFAULTS.BACKGROUND,
    },
  };
}

interface Waiting {
  readonly lane: Lane;
  readonly start: () => void;
}

export interface LaneSnapshot {
  readonly width: number;
  readonly active: number;
  readonly queued: number;
}

/**
 * The scheduler over the lanes. `run` admits work when its lane has a free
 * slot and queues it otherwise, in arrival order per lane.
 */
export class LaneScheduler {
  readonly #configuration: LaneConfiguration;
  readonly #active = new Map<Lane, number>();
  readonly #waiting: Waiting[] = [];

  constructor(configuration: LaneConfiguration) {
    this.#configuration = configuration;
  }

  snapshot(lane: Lane): LaneSnapshot {
    return {
      width: this.#configuration.widths[lane],
      active: this.#active.get(lane) ?? 0,
      queued: this.#waiting.filter((waiting) => waiting.lane === lane).length,
    };
  }

  /** Runs the work under the lane, once admitted; settles as the work does. */
  run<T>(lane: Lane, work: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const start = () => {
        this.#active.set(lane, (this.#active.get(lane) ?? 0) + 1);
        let settled: Promise<T>;
        try {
          settled = work();
        } catch (error) {
          settled = Promise.reject(error);
        }
        settled.then(resolve, reject).finally(() => {
          this.#active.set(lane, (this.#active.get(lane) ?? 0) - 1);
          this.#drain();
        });
      };
      if (this.#admits(lane)) start();
      else this.#waiting.push({ lane, start });
    });
  }

  #admits(lane: Lane): boolean {
    return (this.#active.get(lane) ?? 0) < this.#configuration.widths[lane];
  }

  #drain(): void {
    // One pass in arrival order; a lane that cannot admit keeps its place and
    // blocks nothing behind it in another lane.
    let index = 0;
    while (index < this.#waiting.length) {
      const waiting = this.#waiting[index];
      if (waiting && this.#admits(waiting.lane)) {
        this.#waiting.splice(index, 1);
        waiting.start();
      } else {
        index += 1;
      }
    }
  }
}
