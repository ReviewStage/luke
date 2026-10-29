import { Schema as EffectSchema } from "effect";
import { sealedLiveQuerySchema } from "./live-wire.js";
import {
  type AgentSectionEntry,
  agentSectionEntrySchema,
  type TaskSection,
  type TaskSectionEntry,
  type TaskSections,
  taskSectionEntrySchema,
  taskSectionSchema,
} from "./task-section-wire.js";
import { type RepositoryPin, repositoryPinSchema } from "./task-wire.js";

/**
 * sidebar-live.ts -- the account's sidebar sections and pinned repositories as the host follows them over the service's held poll: the statements the service answers, and the rows they deliver.
 *
 * The rows are the wire's own values, each instant as epoch milliseconds and
 * what the wire leaves out as null, in no order; the host keeps them in
 * collections and draws them in the held reads' order
 * (`@luke/host`'s `sidebar-collections.ts`).
 */

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

/** The sidebar's rows as the live statements deliver them: what the wire leaves out where it holds nothing is null. */
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

/** The sidebar's rows as the host keeps them: each part's rows in no order, what the wire leaves out where it holds nothing left out. */
export interface SidebarRows {
  readonly sections: readonly TaskSection[];
  readonly entries: readonly TaskSectionEntry[];
  readonly agentEntries: readonly AgentSectionEntry[];
  readonly pins: readonly RepositoryPin[];
}

/** The sidebar's rows as the live statements deliver them, each null the wire answers where a row holds nothing left out. */
export function sidebarRowsOfLive(rows: typeof sidebarLiveRowsSchema.Type): SidebarRows {
  return {
    sections: rows.sections.map(({ icon, position, ...section }) => ({
      ...section,
      ...(icon === null ? undefined : { icon }),
      ...(position === null ? undefined : { position }),
    })),
    entries: rows.entries.map(({ position, ...entry }) => ({
      ...entry,
      ...(position === null ? undefined : { position }),
    })),
    agentEntries: rows.agentEntries.map(({ position, ...entry }) => ({
      ...entry,
      ...(position === null ? undefined : { position }),
    })),
    pins: rows.pins,
  };
}
