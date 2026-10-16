import { NOTE_KIND, type PlanNote } from "@luke/features/plan-template";

/**
 * task-contents.ts -- the notes a notetaker would take, as a test writes them.
 *
 * A note names a heading of the plan's text, and lands at the end of the
 * section under it, written as given. Every word a test writes with one is
 * invented.
 */

/** A note adding one point under a heading. */
export function added(section: string, text: string): PlanNote {
  return { kind: NOTE_KIND.ADD, section, text };
}
