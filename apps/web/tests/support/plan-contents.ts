import { NOTE_KIND, type PlanNote } from "@sidecar/hosted/plan-template";
import type { PlanField } from "@sidecar/hosted/plan-wire";

/**
 * plan-contents.ts -- the notes a notetaker would take, as a test writes them.
 *
 * A note names one of the template's fields, and lands in the plan's section
 * under that field's heading. Every word a test writes with one is invented.
 */

/** A note adding one point under a field. */
export function added(field: PlanField, text: string): PlanNote {
  return { kind: NOTE_KIND.ADD, field, text };
}
