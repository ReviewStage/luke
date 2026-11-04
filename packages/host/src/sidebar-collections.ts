/**
 * sidebar-collections.ts -- the account's sidebar as rows of the sync engine's pool: its sections and what stands in them as one row, and each pinned repository as one, fed by the sidebar's follow, drawn in the held reads' order, and changed by a write the moment it is asked.
 *
 * The sections and the tasks and agents in them are one kind of the pool
 * (`SECTIONS`), one row under the account's own id, because the read
 * answers them whole under one owner and a drag rewrites them as one write
 * (`@repo/features/task-section-writes`); each pinned repository is a row of
 * its own (`REPOSITORY_PIN`). The sidebar stands on both for the signed-in
 * session and is drawn whole, in the order the held reads kept: sections,
 * and the rows in them, oldest first, and pins newest pinned first, each by
 * id among one instant. It is drawn once for a whole answer of the follow
 * however many parts it moved, and once as a write is drawn or settles, so
 * a window never draws a section without its rows.
 *
 * A pin, or a drag's or a menu's section writes, is a write the pool draws
 * at once (`compose-tasks.ts` declares them), standing until the followed
 * sidebar carries its transaction, or taken back where the service refused
 * it; where the follow hands no wait yet, as before Sync first woke it, the
 * service's own answer is taken in the read's place. Every drag stands on
 * the one row of sections, so the pool sends drags in the order they were
 * asked. A drag the service refused part of lands on what the service kept
 * of the rest before what it drew is taken back (`keep`).
 */

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
import type { TasksPinRepositoryParams, TasksWriteSectionParams } from "@repo/features/tasks-view";
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
import { Effect, Equal, type Scope } from "effect";
import { confirmWrite, type TxWait } from "./live-follow.js";

/** The account's sections and the rows in them as the pool holds them: one row, under the account's own id. */
export interface SectionsRow extends TaskSections {
  readonly ownerId: string;
}

/** A change to the account's sections: what it leaves of them as they are drawn now. */
export type SectionsChange = (sections: TaskSections) => TaskSections;

/**
 * The account's sections as the pool holds them, by the account's id, a
 * change drawn over the row whole. Note that a change that leaves the
 * sections as they stand leaves the row alone, so a reader holds the very
 * row.
 */
export const SECTIONS: EntityKind<SectionsRow, SectionsChange> = {
  key: (row) => row.ownerId,
  drawn: (change, row) => {
    if (row === undefined) return undefined;
    const drawn: SectionsRow = { ...change(row), ownerId: row.ownerId };
    return Equal.equals(drawn, row) ? undefined : drawn;
  },
};

/** A pinned repository as the pool holds it, by its full name. */
export const REPOSITORY_PIN = fieldKind((pin: RepositoryPin) => pin.repository);

/** The sections as `writes` leave them, made at `at`, each drawn over the one before. */
function sectionsAfter(writes: readonly TaskSectionWrite[], at: number): SectionsChange {
  return (sections) =>
    writes.reduce<TaskSections>((held, write) => applySectionWrite(held, write, at), sections);
}

/** No sections, as the sidebar draws before its follow first answers. */
const NO_SECTIONS: TaskSections = { sections: [], entries: [], agentEntries: [] };

/** Two ids of one instant in the order the held reads kept them: by code unit. */
function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The sections and the rows in them oldest first, each by id among one instant. */
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

/** The pins newest pinned first, each by name among one instant. */
function pinsInOrder(pins: readonly RepositoryPin[]): readonly RepositoryPin[] {
  return pins.toSorted((a, b) => b.pinnedAt - a.pinnedAt || byCodeUnit(a.repository, b.repository));
}

export interface SidebarDependencies {
  /** The pool the sidebar's rows stand in. */
  readonly pool: EntityPool;
  /** Draws the sidebar as it now stands. */
  readonly draw: (read: SidebarRead) => void;
  /** The account signed in now, whose sections the follow answers; none while nobody is. */
  readonly ownerId: () => string | undefined;
  /** The followed sidebar's wait for a write's transaction; none while the follow hands none. */
  readonly txWait: () => TxWait | undefined;
}

/** The account's sidebar standing in the pool, for as long as its scope stands. */
export interface SidebarCollections {
  /** Takes one answer of the sidebar's follow, every part of it, and draws it once. */
  readonly answer: (rows: SidebarRows) => Effect.Effect<void>;
  /**
   * Lands what the service kept of a drag it refused part of, before what
   * the drag drew is taken back: once the followed sidebar carries its
   * transaction, or taken in the read's place where it hands no wait.
   */
  readonly keep: (txid: string | undefined, kept: TaskSections) => Effect.Effect<void>;
}

/** The account's sidebar, empty until its follow first answers or a pin is drawn. */
export function sidebarCollections(
  dependencies: SidebarDependencies,
): Effect.Effect<SidebarCollections, never, Scope.Scope> {
  return Effect.gen(function* () {
    const { pool } = dependencies;
    // Note that a write still standing once the scope closed draws nothing, since a sign-out closed it and its rows were the account's that left.
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
    // Note that every pin made is the sidebar's, since it holds every repository the account pinned.
    const pins: HeldRows<RepositoryPin> = yield* pool.stand(REPOSITORY_PIN, {
      redraw,
      confirmation,
      adopts: () => true,
    });

    /** Draws the sidebar as it stands now, what every standing write drew among it. */
    const drawn = () => {
      if (!open) return;
      const [held] = sections.rows();
      dependencies.draw({
        taskSections: held === undefined ? NO_SECTIONS : sectionsInOrder(held),
        repositoryPins: pinsInOrder(pins.rows()),
      });
    };

    /** The sections answered, as the account's one row; none while nobody is signed in. */
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

/** A pin's write as it is asked: the repository, whether it is pinned, and the instant it was asked at, which a pin made here is stamped with. */
export type RepositoryPinInput = TasksPinRepositoryParams & { readonly at: number };

/** A drag's or a menu's section writes as they are asked: the writes as the service takes them, the account whose sections they change, and the instant they were asked at, which a section or an entry made here is stamped with. */
export type SectionsInput = TasksWriteSectionParams & {
  readonly ownerId: string | undefined;
  readonly at: number;
};

/** What a write to the sidebar answers its caller: whether the service kept it. */
type SidebarWritten = { readonly changed: boolean };

/** The sidebar's writes, declared once for every session. */
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

/** What the sidebar's writes are carried to the service through, and the sidebar standing now. */
export interface SidebarWriteDependencies {
  /** Whether the account gate stands open, so a write may reach the service. */
  readonly gate: () => boolean;
  readonly pinRepository: (
    repository: string,
    pinned: boolean,
  ) => Effect.Effect<RepositoryPinsWritten | undefined>;
  readonly writeSection: (
    write: TaskSectionWrite,
  ) => Effect.Effect<TaskSectionsWritten | undefined>;
  /** The account's sidebar standing now, which a sign-out replaces. */
  readonly collections: () => SidebarCollections;
}

/** A write refused, which takes back what it drew. */
const REFUSED = { refused: { changed: false } } as const;

/**
 * The sidebar's writes: a repository pinned or unpinned, drawn at once, a
 * pin stamped as it was asked; and a drag's or a menu's section writes,
 * drawn at once over every drag before them as one write over the
 * account's sections, so drags go to the service in the order asked. Each
 * is kept once the followed sidebar carries it, where it hands no wait the
 * service's answer taken in its place. Note that a section write the
 * service refused does not stop the ones after it, since each stands alone
 * on the service, and what the service kept lands before the drag is taken
 * back (`keep`), so taking back what it drew lands on the service's word.
 */
export function sidebarWrites(dependencies: SidebarWriteDependencies): SidebarWrites {
  const { gate } = dependencies;
  return {
    pinned: {
      kind: REPOSITORY_PIN,
      keys: ({ repository }) => [repository],
      change: ({ repository, pinned, at }) =>
        pinned ? { made: { repository, pinnedAt: at } } : () => ROW_GONE,
      send: ({ repository, pinned }) =>
        gate()
          ? Effect.map(dependencies.pinRepository(repository, pinned), (answered) => {
              if (answered === undefined) return REFUSED;
              const kept = answered.pins.find((pin) => pin.repository === repository);
              return {
                answer: { changed: true },
                txid: answered.txid,
                taken: kept === undefined ? () => ROW_GONE : { made: kept },
              };
            })
          : Effect.succeed(REFUSED),
    },
    sectionsWritten: {
      kind: SECTIONS,
      keys: ({ ownerId }) => (ownerId === undefined ? [] : [ownerId]),
      change: ({ writes, at }) => sectionsAfter(writes, at),
      send: ({ writes }) =>
        gate()
          ? Effect.gen(function* () {
              let kept: TaskSections | undefined;
              let txid: string | undefined;
              let refused = false;
              for (const write of writes) {
                const answered = yield* dependencies.writeSection(write);
                if (answered === undefined) refused = true;
                else {
                  const { txid: committed, ...sections } = answered;
                  kept = sections;
                  txid = committed ?? txid;
                }
              }
              const last = kept;
              if (!refused && last !== undefined) {
                return { answer: { changed: true }, txid, taken: () => last };
              }
              if (last !== undefined) yield* dependencies.collections().keep(txid, last);
              return REFUSED;
            })
          : Effect.succeed(REFUSED),
    },
  };
}
