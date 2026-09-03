import type { BrainDelivery } from "@sidecar/brain";

/**
 * How many briefings wait through a meeting or a pause. A hold that outlives
 * the news is a hold that would replay the morning: the brain re-decides the
 * whole backlog in one turn at the release, so what it needs is the recent
 * few, not every word decided since the quiet began.
 */
export const MAXIMUM_HELD_BRIEFINGS = 8;

/**
 * Briefings the brain decided while announcements were held, kept in the
 * main process until the hold ends. The hold has to outlive any renderer, and
 * this is the one place a briefing passes on its way to the voice. Releasing
 * hands the backlog back for one re-decision rather than reading it out as it
 * stood: the sessions may have moved on while the meeting ran.
 */
export class BriefingHold {
  #held: BrainDelivery[] = [];

  get count(): number {
    return this.#held.length;
  }

  hold(delivery: BrainDelivery): void {
    this.#held.push(delivery);
    if (this.#held.length > MAXIMUM_HELD_BRIEFINGS) {
      this.#held = this.#held.slice(-MAXIMUM_HELD_BRIEFINGS);
    }
  }

  release(): readonly BrainDelivery[] {
    const released = this.#held;
    this.#held = [];
    return released;
  }
}
