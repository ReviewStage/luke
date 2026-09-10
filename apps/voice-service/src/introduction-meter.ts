import { createHash, randomBytes } from "node:crypto";

/**
 * The introduction's own ceiling, kept by the service because no account
 * stands behind an introduction to meter it on. Two counts a day: one per
 * caller and one shared, the same two the introduction mint kept. The caller
 * is known only as a hash of its network address under a salt minted at
 * launch, so the meter can tell a repeat caller from a new one for one day
 * and nothing on this machine can name either; a restart forgets everything.
 */
export const INTRODUCTION_METER_LIMITS = {
  /** Introductions one address may open in a UTC day; a fresh install needs one. */
  PER_CALLER: 8,
  /** Introductions every caller together may open in a UTC day. */
  GLOBAL: 500,
} as const;

export interface IntroductionSpend {
  allowed: boolean;
}

interface DayCounts {
  day: string;
  global: number;
  callers: Map<string, number>;
}

function utcDayKey(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

export class IntroductionMeter {
  readonly #salt = randomBytes(16).toString("hex");
  readonly #now: () => number;
  #counts: DayCounts | undefined;

  constructor(options: { now?: () => number } = {}) {
    this.#now = options.now ?? Date.now;
  }

  /** Spends one introduction for the address; a refused attempt still counts, as the mint's did. */
  spend(address: string): IntroductionSpend {
    const counts = this.#today();
    const caller = createHash("sha256").update(this.#salt).update(address).digest("hex");
    const used = (counts.callers.get(caller) ?? 0) + 1;
    counts.callers.set(caller, used);
    counts.global += 1;
    return {
      allowed:
        used <= INTRODUCTION_METER_LIMITS.PER_CALLER &&
        counts.global <= INTRODUCTION_METER_LIMITS.GLOBAL,
    };
  }

  #today(): DayCounts {
    const day = utcDayKey(this.#now());
    if (this.#counts?.day !== day) {
      this.#counts = { day, global: 0, callers: new Map() };
    }
    return this.#counts;
  }
}
