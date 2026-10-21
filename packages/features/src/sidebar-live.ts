import { Schema as EffectSchema } from "effect";
import { sealedLiveQuerySchema } from "./live-wire.js";
import {
  agentSectionEntrySchema,
  type TaskSections,
  taskSectionEntrySchema,
  taskSectionSchema,
} from "./task-section-wire.js";
import { type RepositoryPin, repositoryPinSchema } from "./task-wire.js";

/**
 * sidebar-live.ts -- the account's sidebar sections and pinned repositories as the desktop follows them over Neon Realtime: the sealed statements the service answers, and the rows they deliver.
 *
 * The rows are the wire's own values, each instant as epoch milliseconds and
 * what the wire leaves out as null; Realtime keeps no order, so the reader
 * orders them as the held reads do.
 */

/** By code unit, as a comparator answers. */
function byText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The account's sidebar sealed for following: the address, and four
 * statements, its sections, the tasks and the agents it keeps in them, and
 * its pinned repositories. Asked to poll, or where Realtime cannot seal them, the
 * service answers each statement's rows inline instead (`LIVE_POLL`).
 */
export const sidebarLiveAnswerSchema = EffectSchema.Struct({
  url: EffectSchema.String,
  queries: EffectSchema.Struct({
    sections: sealedLiveQuerySchema,
    entries: sealedLiveQuerySchema,
    agentEntries: sealedLiveQuerySchema,
    pins: sealedLiveQuerySchema,
  }),
});

export type SidebarLiveAnswer = typeof sidebarLiveAnswerSchema.Type;

/** The sidebar's rows as Realtime delivers them: what the wire leaves out where it holds nothing is null. */
export const sidebarLiveRowsSchema = EffectSchema.Struct({
  sections: EffectSchema.Array(
    EffectSchema.Struct({
      ...taskSectionSchema.fields,
      icon: EffectSchema.NullOr(taskSectionSchema.fields.icon),
      position: EffectSchema.NullOr(taskSectionSchema.fields.position),
    }),
  ),
  entries: EffectSchema.Array(
    EffectSchema.Struct({
      ...taskSectionEntrySchema.fields,
      position: EffectSchema.NullOr(taskSectionEntrySchema.fields.position),
    }),
  ),
  agentEntries: EffectSchema.Array(
    EffectSchema.Struct({
      ...agentSectionEntrySchema.fields,
      position: EffectSchema.NullOr(agentSectionEntrySchema.fields.position),
    }),
  ),
  pins: EffectSchema.Array(repositoryPinSchema),
});

/** The sidebar as the held reads answer it: the account's sections and the tasks and agents in them, and its pins. */
export interface SidebarRead {
  readonly taskSections: TaskSections;
  readonly repositoryPins: readonly RepositoryPin[];
}

/**
 * The sidebar as the held reads answer it: the sections oldest made first,
 * the tasks and the agents in them oldest put there first, each by id among
 * one instant, an icon and a place only where they stand; and the pins
 * newest pinned first, then by name.
 */
export function sidebarOfLiveRows(rows: typeof sidebarLiveRowsSchema.Type): SidebarRead {
  return {
    taskSections: {
      sections: rows.sections
        .toSorted((a, b) => a.createdAt - b.createdAt || byText(a.id, b.id))
        .map(({ icon, position, ...section }) => ({
          ...section,
          ...(icon === null ? undefined : { icon }),
          ...(position === null ? undefined : { position }),
        })),
      entries: rows.entries
        .toSorted((a, b) => a.addedAt - b.addedAt || byText(a.taskId, b.taskId))
        .map(({ position, ...entry }) => ({
          ...entry,
          ...(position === null ? undefined : { position }),
        })),
      agentEntries: rows.agentEntries
        .toSorted((a, b) => a.addedAt - b.addedAt || byText(a.agentId, b.agentId))
        .map(({ position, ...entry }) => ({
          ...entry,
          ...(position === null ? undefined : { position }),
        })),
    },
    repositoryPins: rows.pins.toSorted(
      (a, b) => b.pinnedAt - a.pinnedAt || byText(a.repository, b.repository),
    ),
  };
}
