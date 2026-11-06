import { Schema } from "effect";
import {
  LIVE_MODE,
  LIVE_PARAM,
  type LiveReadAnswer,
  liveRead,
  liveRows,
  ORDER,
} from "./live-read.js";
import { LIVE_USER_QUERY } from "./live-wire.js";
import { HOSTED_SERVICE_PATH } from "./service-paths.js";
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
 * sidebar-live.ts -- the account's sidebar sections and pinned repositories as the host follows them over the service's held poll: the read declared, and the rows the host keeps of it.
 *
 * The rows are the wire's own values, each instant as epoch milliseconds and
 * what the wire leaves out as null, in no order; the host keeps them in
 * collections and draws them in the held reads' order
 * (`@repo/host`'s `sidebar-collections.ts`).
 */

/**
 * The account's sidebar as the host follows it: four parts, its sections,
 * the tasks and the agents it keeps in them, and its pinned repositories.
 * The host keeps them in collections and draws them in the held reads'
 * order, so each part's order here only fixes the one its rows are read in:
 * each section, entry, and pin as it was made, and a pin's newest first.
 */
export const SIDEBAR_READ = liveRead({
  name: "sidebar",
  path: HOSTED_SERVICE_PATH.LIVE_SIDEBAR,
  params: { [LIVE_USER_QUERY]: LIVE_PARAM.USER },
  mode: LIVE_MODE.SNAPSHOT,
  parts: {
    sections: liveRows({
      row: Schema.Struct({
        ...taskSectionSchema.fields,
        icon: Schema.NullOr(taskSectionSchema.fields.icon),
        position: Schema.NullOr(taskSectionSchema.fields.position),
      }),
      key: "id",
      order: [
        ["createdAt", ORDER.ASC],
        ["id", ORDER.ASC],
      ],
    }),
    entries: liveRows({
      row: Schema.Struct({
        ...taskSectionEntrySchema.fields,
        position: Schema.NullOr(taskSectionEntrySchema.fields.position),
      }),
      key: "taskId",
      order: [
        ["addedAt", ORDER.ASC],
        ["taskId", ORDER.ASC],
      ],
    }),
    agentEntries: liveRows({
      row: Schema.Struct({
        ...agentSectionEntrySchema.fields,
        position: Schema.NullOr(agentSectionEntrySchema.fields.position),
      }),
      key: "agentId",
      order: [
        ["addedAt", ORDER.ASC],
        ["agentId", ORDER.ASC],
      ],
    }),
    pins: liveRows({
      row: repositoryPinSchema,
      key: "repository",
      order: [
        ["pinnedAt", ORDER.DESC],
        ["repository", ORDER.ASC],
      ],
    }),
  },
});

export type SidebarLiveAnswer = LiveReadAnswer<typeof SIDEBAR_READ>;

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
export function sidebarRowsOfLive(rows: typeof SIDEBAR_READ.rows.Type): SidebarRows {
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
