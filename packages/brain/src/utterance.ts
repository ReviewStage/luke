/**
 * One thing the brain decided to say aloud unprompted: the words for the
 * voice and the instant they were decided. Nothing here detects a change or
 * decides a word; the brain does both, against its own memory, and the host
 * hands what it decided to the speech arbiter.
 */
export interface BrainUtterance {
  text: string;
  decidedAt: number;
}
