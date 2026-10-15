/**
 * turn-budget.ts -- how many calls of one kind each turn has made in this instance, held to a bound.
 *
 * A turn runs its calls on the instance that runs the turn, so a count kept
 * here is the bound the turn meets. Only so many turns are tracked: past
 * that the oldest is forgotten, long after it ended, so the count never
 * grows with the instance's life.
 */
export class TurnBudget {
  private readonly used = new Map<string, number>();
  private readonly limit: number;
  private readonly tracked: number;

  constructor(limit: number, tracked: number) {
    this.limit = limit;
    this.tracked = tracked;
  }

  /** Whether `turnId` has spent every call the bound admits, spending nothing. */
  exhausted(turnId: string): boolean {
    return (this.used.get(turnId) ?? 0) >= this.limit;
  }

  /** Spends one call for `turnId`; answers whether the bound still admitted it. */
  take(turnId: string): boolean {
    const spent = this.used.get(turnId) ?? 0;
    if (spent >= this.limit) return false;
    // Re-inserted, so the turn last spent in is the last forgotten.
    this.used.delete(turnId);
    this.used.set(turnId, spent + 1);
    const oldest = this.used.keys().next();
    if (this.used.size > this.tracked && !oldest.done) this.used.delete(oldest.value);
    return true;
  }
}
