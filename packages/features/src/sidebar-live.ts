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

export interface SidebarRead {
  readonly taskSections: TaskSections;
  readonly repositoryPins: readonly RepositoryPin[];
}

export interface SidebarRows {
  readonly sections: readonly TaskSection[];
  readonly entries: readonly TaskSectionEntry[];
  readonly agentEntries: readonly AgentSectionEntry[];
  readonly pins: readonly RepositoryPin[];
}

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
