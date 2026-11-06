import type { TaskCallResult } from "@repo/features";
import { WRITE_UNTAKEN, type WriteUntaken } from "@repo/features/keyed-write";
import type { SidebarRead, SidebarRows } from "@repo/features/sidebar-live";
import type {
  AgentSectionEntry,
  TaskSection,
  TaskSectionEntry,
  TaskSections,
  TaskSectionsWritten,
  TaskSectionWrite,
} from "@repo/features/task-section-wire";
import { applySectionWrite } from "@repo/features/task-section-writes";
import type { RepositoryPin, RepositoryPinsWritten } from "@repo/features/task-wire";
import {
  type TasksPinRepositoryParams,
  type TasksWriteSectionParams,
  tasksPinRepositoryParamsSchema,
  tasksWriteSectionParamsSchema,
} from "@repo/features/tasks-view";
import { GATEWAY_METHOD } from "@repo/gateway";
import {
  type Confirmation,
  type EntityKind,
  type EntityPool,
  type FieldChange,
  fieldKind,
  type HeldRows,
  ROW_GONE,
  type WriteDeclaration,
} from "@repo/sync";
import { Effect, Equal, Schema, type Scope } from "effect";
import { confirmWrite, type TxWait } from "./live-follow.js";
import { callKey, untaken, type WriteAnswers } from "./queued-writes.js";

export interface SectionsRow extends TaskSections {
  readonly ownerId: string;
}

export type SectionsChange = (sections: TaskSections) => TaskSections;

export const SECTIONS: EntityKind<SectionsRow, SectionsChange> = {
  key: (row) => row.ownerId,
  drawn: (change, row) => {
    if (row === undefined) return undefined;
    const drawn: SectionsRow = { ...change(row), ownerId: row.ownerId };
    return Equal.equals(drawn, row) ? undefined : drawn;
  },
};

export const REPOSITORY_PIN = fieldKind((pin: RepositoryPin) => pin.repository);

function sectionsAfter(writes: readonly TaskSectionWrite[], at: number): SectionsChange {
  return (sections) =>
    writes.reduce<TaskSections>((held, write) => applySectionWrite(held, write, at), sections);
}

const NO_SECTIONS: TaskSections = { sections: [], entries: [], agentEntries: [] };

function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function sectionsInOrder({ sections, entries, agentEntries }: TaskSections): TaskSections {
  return {
    sections: sections.toSorted(
      (a: TaskSection, b) => a.createdAt - b.createdAt || byCodeUnit(a.id, b.id),
    ),
    entries: entries.toSorted(
      (a: TaskSectionEntry, b) => a.addedAt - b.addedAt || byCodeUnit(a.taskId, b.taskId),
    ),
    agentEntries: agentEntries.toSorted(
      (a: AgentSectionEntry, b) => a.addedAt - b.addedAt || byCodeUnit(a.agentId, b.agentId),
    ),
  };
}

function pinsInOrder(pins: readonly RepositoryPin[]): readonly RepositoryPin[] {
  return pins.toSorted((a, b) => b.pinnedAt - a.pinnedAt || byCodeUnit(a.repository, b.repository));
}

export interface SidebarDependencies {
  readonly pool: EntityPool;
  readonly draw: (read: SidebarRead) => void;
  readonly ownerId: () => string | undefined;
  readonly txWait: () => TxWait | undefined;
}

export interface SidebarCollections {
  readonly answer: (rows: SidebarRows) => Effect.Effect<void>;
  readonly keep: (txid: string | undefined, kept: TaskSections) => Effect.Effect<void>;
}

export function sidebarCollections(
  dependencies: SidebarDependencies,
): Effect.Effect<SidebarCollections, never, Scope.Scope> {
  return Effect.gen(function* () {
    const { pool } = dependencies;
    let open = true;
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        open = false;
      }),
    );
    const confirmation = (): Confirmation | undefined => {
      const wait = dependencies.txWait();
      return wait === undefined ? undefined : (txid) => confirmWrite(wait, txid);
    };
    const redraw = () => Effect.sync(() => drawn());
    const sections: HeldRows<SectionsRow> = yield* pool.stand(SECTIONS, { redraw, confirmation });
    const pins: HeldRows<RepositoryPin> = yield* pool.stand(REPOSITORY_PIN, {
      redraw,
      confirmation,
      adopts: () => true,
    });

    const drawn = () => {
      if (!open) return;
      const [held] = sections.rows();
      dependencies.draw({
        taskSections: held === undefined ? NO_SECTIONS : sectionsInOrder(held),
        repositoryPins: pinsInOrder(pins.rows()),
      });
    };

    const sectionsRows = (answered: TaskSections): readonly SectionsRow[] => {
      const ownerId = dependencies.ownerId();
      if (ownerId === undefined) return [];
      const { sections: kept, entries, agentEntries } = answered;
      return [{ ownerId, sections: kept, entries, agentEntries }];
    };

    return {
      answer: (rows) =>
        Effect.andThen(
          Effect.andThen(sections.answer(sectionsRows(rows)), pins.answer(rows.pins)),
          redraw(),
        ),
      keep: (txid, kept) => {
        const wait = confirmation();
        if (wait !== undefined && txid !== undefined) return wait(txid);
        return Effect.andThen(sections.answer(sectionsRows(kept)), redraw());
      },
    };
  });
}

export type RepositoryPinInput = TasksPinRepositoryParams & { readonly at: number };

export type SectionsInput = TasksWriteSectionParams & {
  readonly ownerId: string | undefined;
  readonly at: number;
};

type SidebarWritten = { readonly changed: boolean };

export interface SidebarWrites {
  readonly pinned: WriteDeclaration<
    RepositoryPin,
    FieldChange<RepositoryPin>,
    RepositoryPinInput,
    SidebarWritten
  >;
  readonly sectionsWritten: WriteDeclaration<
    SectionsRow,
    SectionsChange,
    SectionsInput,
    SidebarWritten
  >;
}

export interface SidebarWriteDependencies {
  readonly gate: () => boolean;
  readonly pinRepository: (
    repository: string,
    pinned: boolean,
    key: string | undefined,
  ) => Effect.Effect<TaskCallResult<RepositoryPinsWritten, WriteUntaken>>;
  readonly writeSection: (
    write: TaskSectionWrite,
    key: string | undefined,
  ) => Effect.Effect<TaskCallResult<TaskSectionsWritten, WriteUntaken>>;
  readonly collections: () => SidebarCollections;
}

const REFUSED = { refused: { changed: false } } as const;

const ANSWERS: WriteAnswers<SidebarWritten> = {
  kept: { changed: true },
  refused: { changed: false },
};

export function sidebarWrites(dependencies: SidebarWriteDependencies): SidebarWrites {
  const { gate } = dependencies;
  return {
    pinned: {
      kind: REPOSITORY_PIN,
      keys: ({ repository }) => [repository],
      change: ({ repository, pinned, at }) =>
        pinned ? { made: { repository, pinnedAt: at } } : () => ROW_GONE,
      send: ({ repository, pinned }, { key }) =>
        gate()
          ? Effect.map(dependencies.pinRepository(repository, pinned, key), (pinnedAs) => {
              if (!pinnedAs.ok) return untaken(pinnedAs.failure, ANSWERS);
              const answered = pinnedAs.answer;
              const kept = answered.pins.find((pin) => pin.repository === repository);
              return {
                answer: { changed: true },
                txid: answered.txid,
                taken: kept === undefined ? () => ROW_GONE : { made: kept },
              };
            })
          : Effect.succeed(REFUSED),
      queue: {
        name: GATEWAY_METHOD.TASKS_PIN_REPOSITORY,
        input: Schema.Struct({ ...tasksPinRepositoryParamsSchema.fields, at: Schema.Number }),
        queued: () => ANSWERS.kept,
      },
    },
    sectionsWritten: {
      kind: SECTIONS,
      keys: ({ ownerId }) => (ownerId === undefined ? [] : [ownerId]),
      change: ({ writes, at }) => sectionsAfter(writes, at),
      send: ({ writes }, { key }) =>
        gate()
          ? Effect.gen(function* () {
              let kept: TaskSections | undefined;
              let txid: string | undefined;
              let refused = false;
              for (const [call, write] of writes.entries()) {
                const writtenAs = yield* dependencies.writeSection(write, callKey(key, call));
                if (!writtenAs.ok) {
                  if (writtenAs.failure === WRITE_UNTAKEN.UNANSWERED) {
                    return untaken(writtenAs.failure, ANSWERS);
                  }
                  if (writtenAs.failure === WRITE_UNTAKEN.REFUSED) refused = true;
                  continue;
                }
                const { txid: committed, ...sections } = writtenAs.answer;
                kept = sections;
                txid = committed ?? txid;
              }
              const last = kept;
              if (!refused && last !== undefined) {
                return { answer: { changed: true }, txid, taken: () => last };
              }
              if (!refused) return { answer: { changed: true }, txid: undefined, settled: true };
              if (last !== undefined) yield* dependencies.collections().keep(txid, last);
              return REFUSED;
            })
          : Effect.succeed(REFUSED),
      queue: {
        name: GATEWAY_METHOD.TASKS_WRITE_SECTION,
        input: Schema.Struct({
          ...tasksWriteSectionParamsSchema.fields,
          ownerId: Schema.UndefinedOr(Schema.String),
          at: Schema.Number,
        }),
        queued: () => ANSWERS.kept,
      },
    },
  };
}
