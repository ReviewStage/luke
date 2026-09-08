import type { SessionKey } from "@sidecar/runtime-contracts";
import {
  isRecord,
  isWireBoolean,
  isWireNumber,
  isWireString,
  type UnparsedWireValue,
} from "@sidecar/wire";
import { Cron } from "croner";
import type { ScheduledTimer } from "./timers.js";

/**
 * The durable scheduler. A job names a conversation and a schedule — a cron
 * expression parsed by the croner version OpenClaw `b7528507` pins, a fixed
 * interval, or one instant — and the scheduler opens a turn in that
 * conversation when the job is due. Jobs and their last run stand in a store
 * the scheduler is handed, so a launch finds what was scheduled and when it
 * last ran; a run is recorded as taken before its turn opens, so a crash
 * mid-turn does not replay it and a job that was due several times while
 * the app was closed runs once, now, rather than once per missed occurrence.
 * The tick itself runs on the cron coordinator lane; the job's own work runs
 * where the caller's `run` puts it.
 */

export const CRON_SCHEDULE_KIND = {
  CRON: "cron",
  EVERY: "every",
  AT: "at",
} as const;

export type CronScheduleKind = (typeof CRON_SCHEDULE_KIND)[keyof typeof CRON_SCHEDULE_KIND];

export type CronSchedule =
  | {
      readonly kind: typeof CRON_SCHEDULE_KIND.CRON;
      readonly expression: string;
      readonly timezone?: string;
    }
  | { readonly kind: typeof CRON_SCHEDULE_KIND.EVERY; readonly everyMs: number }
  | { readonly kind: typeof CRON_SCHEDULE_KIND.AT; readonly atMs: number };

export interface ScheduledJob {
  readonly id: string;
  readonly name: string;
  readonly sessionKey: SessionKey;
  readonly schedule: CronSchedule;
  readonly enabled: boolean;
  readonly createdAt: number;
  readonly lastRunAt?: number;
}

/** Where jobs stand between launches; the scheduler is its only writer. */
export interface ScheduledJobStore {
  list(): Promise<readonly ScheduledJob[]>;
  put(job: ScheduledJob): Promise<boolean>;
  delete(id: string): Promise<boolean>;
}

export const CRON_DEFAULTS = {
  /** The least a cron-expressed job may be asked to run apart, OpenClaw's trigger floor. */
  MINIMUM_INTERVAL_MS: 30_000,
  /** How far ahead the scheduler looks when nothing is due, so a clock change is noticed. */
  MAXIMUM_SLEEP_MS: 60 * 60 * 1000,
} as const;

function finiteInstant(value: UnparsedWireValue): value is number {
  return isWireNumber(value) && Number.isFinite(value) && value >= 0;
}

export function cronScheduleFromWire(value: UnparsedWireValue): CronSchedule | undefined {
  if (!isRecord(value)) return undefined;
  switch (value.kind) {
    case CRON_SCHEDULE_KIND.CRON:
      if (!isWireString(value.expression) || !validCronExpression(value.expression))
        return undefined;
      if (value.timezone !== undefined && !isWireString(value.timezone)) return undefined;
      return {
        kind: CRON_SCHEDULE_KIND.CRON,
        expression: value.expression,
        ...(value.timezone !== undefined ? { timezone: value.timezone } : undefined),
      };
    case CRON_SCHEDULE_KIND.EVERY:
      if (!finiteInstant(value.everyMs) || value.everyMs < CRON_DEFAULTS.MINIMUM_INTERVAL_MS) {
        return undefined;
      }
      return { kind: CRON_SCHEDULE_KIND.EVERY, everyMs: value.everyMs };
    case CRON_SCHEDULE_KIND.AT:
      if (!finiteInstant(value.atMs)) return undefined;
      return { kind: CRON_SCHEDULE_KIND.AT, atMs: value.atMs };
    default:
      return undefined;
  }
}

export function scheduledJobFromWire(value: UnparsedWireValue): ScheduledJob | undefined {
  if (!isRecord(value)) return undefined;
  if (!isWireString(value.id) || value.id.length === 0 || !isWireString(value.name))
    return undefined;
  if (!isWireString(value.sessionKey) || value.sessionKey.length === 0) return undefined;
  const schedule = cronScheduleFromWire(value.schedule);
  if (!schedule || !isWireBoolean(value.enabled) || !finiteInstant(value.createdAt)) {
    return undefined;
  }
  if (value.lastRunAt !== undefined && !finiteInstant(value.lastRunAt)) return undefined;
  return {
    id: value.id,
    name: value.name,
    // SAFETY: a non-empty string is what the session key constructor admits.
    sessionKey: value.sessionKey as SessionKey,
    schedule,
    enabled: value.enabled,
    createdAt: value.createdAt,
    ...(value.lastRunAt !== undefined ? { lastRunAt: value.lastRunAt } : undefined),
  };
}

export function validCronExpression(expression: string): boolean {
  try {
    new Cron(expression, { catch: false });
    return true;
  } catch {
    return false;
  }
}

/**
 * When a job next runs, after `afterMs`, given when it last ran. An interval
 * counts from the last run, or from creation for a job that never ran; an
 * instant runs once and never again; a cron expression asks croner for the
 * next occurrence in its timezone, or the machine's.
 */
export function nextRunAt(job: ScheduledJob, afterMs: number): number | undefined {
  const schedule = job.schedule;
  switch (schedule.kind) {
    case CRON_SCHEDULE_KIND.EVERY: {
      const anchor = job.lastRunAt ?? job.createdAt;
      const next = anchor + schedule.everyMs;
      return next > afterMs ? next : afterMs;
    }
    case CRON_SCHEDULE_KIND.AT:
      return job.lastRunAt !== undefined ? undefined : schedule.atMs;
    case CRON_SCHEDULE_KIND.CRON: {
      const from = job.lastRunAt !== undefined ? Math.max(job.lastRunAt, afterMs) : afterMs;
      let cron: Cron;
      try {
        cron = new Cron(schedule.expression, {
          catch: false,
          ...(schedule.timezone ? { timezone: schedule.timezone } : undefined),
        });
      } catch {
        return undefined;
      }
      const next = cron.nextRun(new Date(from));
      return next ? next.getTime() : undefined;
    }
  }
}

/**
 * When the job next runs, reading each kind of schedule from where its own
 * occurrences count from: a cron expression from the job's last run, or its
 * creation, so an occurrence missed while the app was closed is still the
 * next one; an interval and an instant from the floor the caller gives, which
 * is zero when the question is whether the job is due at all and now when the
 * question is how long to sleep.
 */
function dueAt(job: ScheduledJob, afterMs: number): number | undefined {
  const anchor = job.lastRunAt ?? job.createdAt;
  return nextRunAt(job, job.schedule.kind === CRON_SCHEDULE_KIND.CRON ? anchor : afterMs);
}

/** Whether the job is due at `nowMs`: enabled, and its next run at or before now. */
export function jobDue(job: ScheduledJob, nowMs: number): boolean {
  if (!job.enabled) return false;
  const next = dueAt(job, 0);
  return next !== undefined && next <= nowMs;
}

export interface CronSchedulerOptions {
  store: ScheduledJobStore;
  /** Opens the job's turn; the caller puts it on whatever lane the job's work belongs on. */
  run: (job: ScheduledJob) => Promise<void>;
  /** Runs one tick's coordination; the cron coordinator lane in the app, the bare work in a test. */
  coordinate?: <T>(work: () => Promise<T>) => Promise<T>;
  now?: () => number;
  schedule?: (callback: () => void, delayMs: number) => ScheduledTimer;
  cancel?: (timer: ScheduledTimer) => void;
  report?: (message: string) => void;
}

export class CronScheduler {
  readonly #options: CronSchedulerOptions;
  readonly #now: () => number;
  readonly #schedule: (callback: () => void, delayMs: number) => ScheduledTimer;
  readonly #cancel: (timer: ScheduledTimer) => void;
  readonly #coordinate: <T>(work: () => Promise<T>) => Promise<T>;
  #jobs = new Map<string, ScheduledJob>();
  #timer: ScheduledTimer | undefined;
  #started = false;
  #ticking: Promise<void> | undefined;

  constructor(options: CronSchedulerOptions) {
    this.#options = options;
    this.#now = options.now ?? Date.now;
    this.#schedule =
      options.schedule ?? ((callback, delayMs) => globalThis.setTimeout(callback, delayMs));
    this.#cancel =
      options.cancel ??
      ((timer) => {
        // SAFETY: a timer this scheduler set itself came from setTimeout above.
        globalThis.clearTimeout(timer as ReturnType<typeof setTimeout>);
      });
    this.#coordinate = options.coordinate ?? ((work) => work());
  }

  jobs(): readonly ScheduledJob[] {
    return [...this.#jobs.values()];
  }

  /** Loads the stored jobs and arms the first tick. */
  async start(): Promise<void> {
    if (this.#started) return;
    this.#started = true;
    const stored = await this.#options.store.list();
    for (const job of stored) this.#jobs.set(job.id, job);
    this.#arm();
  }

  stop(): void {
    this.#started = false;
    this.#disarm();
  }

  /** Adds or replaces a job durably; a job the store refused is not scheduled. */
  async put(job: ScheduledJob): Promise<boolean> {
    if (!(await this.#options.store.put(job))) return false;
    this.#jobs.set(job.id, job);
    if (this.#started) this.#arm();
    return true;
  }

  /** Keeps a job as it stands in the store when one is stored, or installs the default given. */
  async ensure(defaultJob: ScheduledJob): Promise<ScheduledJob | undefined> {
    const held = this.#jobs.get(defaultJob.id);
    if (held) return held;
    return (await this.put(defaultJob)) ? defaultJob : undefined;
  }

  async remove(id: string): Promise<boolean> {
    if (!(await this.#options.store.delete(id))) return false;
    this.#jobs.delete(id);
    if (this.#started) this.#arm();
    return true;
  }

  /** Runs every due job now, each recorded as run before its turn opens; settles when their turns have. */
  tick(): Promise<void> {
    this.#ticking ??= this.#coordinate(() => this.#runDue()).finally(() => {
      this.#ticking = undefined;
      if (this.#started) this.#arm();
    });
    return this.#ticking;
  }

  async #runDue(): Promise<void> {
    const now = this.#now();
    const due = [...this.#jobs.values()].filter((job) => jobDue(job, now));
    const runs: Promise<void>[] = [];
    for (const job of due) {
      const taken: ScheduledJob = { ...job, lastRunAt: now };
      // The run is durable before it opens: a launch that finds the record
      // does not run it again, and a store that refused leaves it for the next tick.
      if (!(await this.#options.store.put(taken))) {
        this.#options.report?.(`Scheduled job ${job.id} could not be recorded and did not run`);
        continue;
      }
      this.#jobs.set(job.id, taken);
      runs.push(
        this.#options.run(taken).catch((error: Error) => {
          this.#options.report?.(`Scheduled job ${job.id} failed: ${error.name}`);
        }),
      );
    }
    await Promise.all(runs);
  }

  /** When the next job is due, or nothing when none is scheduled. */
  nextDueAt(): number | undefined {
    const now = this.#now();
    let soonest: number | undefined;
    for (const job of this.#jobs.values()) {
      if (!job.enabled) continue;
      const next = dueAt(job, now);
      if (next === undefined) continue;
      if (soonest === undefined || next < soonest) soonest = next;
    }
    return soonest;
  }

  #arm(): void {
    this.#disarm();
    if (!this.#started) return;
    const next = this.nextDueAt();
    if (next === undefined) return;
    const delay = Math.min(Math.max(0, next - this.#now()), CRON_DEFAULTS.MAXIMUM_SLEEP_MS);
    this.#timer = this.#schedule(() => {
      this.#timer = undefined;
      void this.tick();
    }, delay);
  }

  #disarm(): void {
    if (this.#timer === undefined) return;
    this.#cancel(this.#timer);
    this.#timer = undefined;
  }
}
