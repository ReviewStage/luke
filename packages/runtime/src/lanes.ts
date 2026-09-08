import { availableParallelism } from "node:os";

/**
 * Execution lanes: the separate budgets under which the runtime's work runs,
 * ported from OpenClaw `b7528507`'s agent limits and Gateway lane setup.
 * Each lane admits at most its width at once and queues the rest in order;
 * lanes are separate budgets, never one cap over Luke as a whole. A group
 * bounds several lanes to one shared budget and may reserve part of it for a
 * member, which is how hook dispatch shares the cron inner budget without
 * being starved by it: the reservation guarantees the member one slot, and
 * the member may still use every free slot inside the budget.
 */

export const LANE = {
  /** Ordinary conversation turns: asks, observation looks, heartbeats' own turns. */
  AGENT: "agent",
  /** Child agent runs. */
  CHILD: "child",
  /** The cron coordinator: deciding which jobs are due and dispatching them. */
  CRON: "cron",
  /** A cron job's inner agent work; shares one budget with hook dispatch. */
  CRON_NESTED: "cron-nested",
  /** A provider hook's dispatch into a conversation; shares the cron inner budget. */
  HOOK_DISPATCH: "hook-dispatch",
  /** Work one conversation asks of another. */
  NESTED: "nested",
  /** Background memory and plugin completions. */
  BACKGROUND: "background",
} as const;

export type Lane = (typeof LANE)[keyof typeof LANE];

export const LANE_LIST: readonly Lane[] = Object.values(LANE);

export const LANE_DEFAULTS = {
  AGENT_MIN: 8,
  AGENT_MAX: 16,
  CHILD: 8,
  CRON: 8,
  /** The one budget cron inner work and hook dispatch share. */
  CRON_HOOK_BUDGET: 8,
  /** What hook dispatch is guaranteed inside that budget while hooks are enabled. */
  HOOK_RESERVATION: 1,
  NESTED: 1,
  BACKGROUND: 3,
} as const;

/** The name of the group bounding cron inner work and hook dispatch together. */
export const CRON_HOOK_GROUP = "cron-hooks";

/** The ordinary agent lane's width for a machine: `min(16, max(8, parallelism))`. */
export function agentLaneWidth(parallelism: number = availableParallelism()): number {
  const floored = Number.isFinite(parallelism) ? Math.floor(parallelism) : LANE_DEFAULTS.AGENT_MIN;
  return Math.min(LANE_DEFAULTS.AGENT_MAX, Math.max(LANE_DEFAULTS.AGENT_MIN, floored));
}

export type LaneWidths = Readonly<Record<Lane, number>>;

export interface LaneGroup {
  readonly budget: number;
  readonly members: readonly Lane[];
  /** Slots held inside the budget for a member, so the others cannot take its last one. */
  readonly reservations?: Readonly<Partial<Record<Lane, number>>>;
}

/** One atomic publication: every lane's width and every group, applied together or not at all. */
export interface LaneConfiguration {
  readonly widths: LaneWidths;
  readonly groups: Readonly<Record<string, LaneGroup>>;
}

export interface LaneConfigurationInputs {
  parallelism?: number;
  hooksEnabled: boolean;
  /**
   * How many hook dispatches are running as the configuration is published.
   * Disabling hooks with dispatches still running keeps the shared group
   * standing, without its reservation, until a later publication sees none:
   * cron inner work must not expand back to the whole budget while hook work
   * still counts against it.
   */
  activeHooks?: number;
}

/**
 * The defaults for a machine, following OpenClaw's Gateway lane setup. Hook
 * dispatch is zero-wide while hooks are disabled, and a clean hooks-off
 * publication installs no group at all, so cron inner work keeps the whole
 * budget.
 */
export function laneConfiguration(inputs: LaneConfigurationInputs): LaneConfiguration {
  const hookWidth = inputs.hooksEnabled ? LANE_DEFAULTS.CRON_HOOK_BUDGET : 0;
  const retainInFlightHookBudget = !inputs.hooksEnabled && (inputs.activeHooks ?? 0) > 0;
  const widths = {
    [LANE.AGENT]: agentLaneWidth(inputs.parallelism),
    [LANE.CHILD]: LANE_DEFAULTS.CHILD,
    [LANE.CRON]: LANE_DEFAULTS.CRON,
    [LANE.CRON_NESTED]: LANE_DEFAULTS.CRON_HOOK_BUDGET,
    [LANE.HOOK_DISPATCH]: hookWidth,
    [LANE.NESTED]: LANE_DEFAULTS.NESTED,
    [LANE.BACKGROUND]: LANE_DEFAULTS.BACKGROUND,
  } satisfies LaneWidths;
  const groups: Record<string, LaneGroup> =
    inputs.hooksEnabled || retainInFlightHookBudget
      ? {
          [CRON_HOOK_GROUP]: {
            budget: LANE_DEFAULTS.CRON_HOOK_BUDGET,
            members: [LANE.CRON_NESTED, LANE.HOOK_DISPATCH],
            ...(inputs.hooksEnabled
              ? { reservations: { [LANE.HOOK_DISPATCH]: LANE_DEFAULTS.HOOK_RESERVATION } }
              : undefined),
          },
        }
      : {};
  return { widths, groups };
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
 * slot and every group the lane belongs to has one it may take, and queues it
 * otherwise, in arrival order per lane; `configure` replaces every width and
 * group in one step and then drains, so a change can never let two lanes
 * dispatch up to their individual widths before the group bounding them
 * exists. Work already admitted keeps running whatever the new widths say;
 * a lane narrowed below its active count simply admits nothing until enough
 * of it ends.
 */
export class LaneScheduler {
  #configuration: LaneConfiguration;
  readonly #active = new Map<Lane, number>();
  readonly #waiting: Waiting[] = [];

  constructor(configuration: LaneConfiguration) {
    this.#configuration = configuration;
  }

  get configuration(): LaneConfiguration {
    return this.#configuration;
  }

  configure(configuration: LaneConfiguration): void {
    this.#configuration = configuration;
    this.#drain();
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
    const { widths, groups } = this.#configuration;
    const active = this.#active.get(lane) ?? 0;
    if (active >= widths[lane]) return false;
    for (const group of Object.values(groups)) {
      if (!group.members.includes(lane)) continue;
      const groupActive = group.members.reduce(
        (sum, member) => sum + (this.#active.get(member) ?? 0),
        0,
      );
      const free = group.budget - groupActive;
      // Slots other members are still owed inside the budget cannot be taken by this lane.
      const owedToOthers = group.members
        .filter((member) => member !== lane)
        .reduce((sum, member) => {
          const reserved = group.reservations?.[member] ?? 0;
          return sum + Math.max(0, reserved - (this.#active.get(member) ?? 0));
        }, 0);
      if (free - owedToOthers < 1) return false;
    }
    return true;
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
