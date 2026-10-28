/**
 * sidebar-collections.ts -- the account's sidebar held in TanStack DB collections: its sections, the tasks and agents in them, and its pinned repositories, fed by the sidebar's follow, drawn in the held reads' order, and changed by a pin or a section write the moment it is asked.
 *
 * Each part of the sidebar's read is a collection of its own
 * (`live-collection.ts`), drawn through a live query in the order the held
 * reads kept: sections, and the rows in them, oldest first, and pins newest
 * pinned first, each by id among one instant. The sidebar is drawn whole,
 * once for a whole answer of the follow however many parts it moved, once
 * as a write is drawn, and once as it settles, so a window never draws a
 * section without its rows.
 *
 * A pin, or a drag's or a menu's section writes, is drawn at once, as the
 * service will keep it (`@luke/features/task-section-writes`), and stands
 * while it is written: kept once the followed sidebar has its transaction,
 * and taken back where the service refused it. Where the follow hands no
 * wait yet, as before Luke Sync first woke it, the service's own answer is
 * taken in the read's place. Either lands with the drop of what was drawn,
 * so nothing flickers back between the two. A drag's writes go to the
 * service one after another, and after every drag's asked before it, since
 * each was drawn over the ones before; one refused takes the drag back
 * onto what the service kept of the rest.
 *
 * Note that a write's wait settles once the follow has handed on the answer
 * carrying its transaction (`live-follow.ts`), whose reader is woken before
 * the writer, so the answer is in its collection, held behind the write,
 * before the write settles.
 */

import type { SidebarRead, SidebarRows } from "@luke/features/sidebar-live";
import type {
  AgentSectionEntry,
  TaskSection,
  TaskSectionEntry,
  TaskSections,
  TaskSectionsWritten,
  TaskSectionWrite,
} from "@luke/features/task-section-wire";
import { applySectionWrite } from "@luke/features/task-section-writes";
import type { RepositoryPin, RepositoryPinsWritten } from "@luke/features/task-wire";
import { createLiveQueryCollection } from "@tanstack/db";
import { Data, Deferred, Effect, type Scope } from "effect";
import {
  answeredCollection,
  drawRows,
  KEPT_BY_SCOPE,
  optimistically,
  rowsOf,
  scopedCollection,
} from "./live-collection.js";
import { confirmWrite, type TxWait } from "./live-follow.js";

/** How an id breaks a tie between two rows of one instant: by code unit, as the held reads compared them. */
const BY_CODE_UNIT = { direction: "asc", stringSort: "lexical" } as const;

/** A write the service did not answer, which takes back what it drew. */
class Unwritten extends Data.TaggedError("Unwritten") {}

export interface SidebarDependencies {
  /** Draws the sidebar as it now stands. */
  readonly draw: (read: SidebarRead) => void;
  /** Now, by the host's clock, which a pin or a section made here is stamped with. */
  readonly now: () => number;
  /** The followed sidebar's wait for a write's transaction; none while the follow hands none. */
  readonly txWait: () => TxWait | undefined;
}

/** The account's sidebar in collections, for as long as its scope stands. */
export interface SidebarCollections {
  /** Takes one answer of the sidebar's follow, every part of it, and draws it once. */
  readonly answer: (rows: SidebarRows) => void;
  /**
   * A repository pinned or unpinned, drawn at once and standing while
   * `written` writes it, answering whether it was kept.
   */
  readonly pinRepository: (
    repository: string,
    pinned: boolean,
    written: Effect.Effect<RepositoryPinsWritten | undefined>,
  ) => Effect.Effect<boolean>;
  /**
   * A drag's or a menu's section writes, drawn at once over every write
   * before them and standing while `written` writes each in turn, answering
   * whether they were kept.
   */
  readonly writeSections: (
    writes: readonly TaskSectionWrite[],
    written: (write: TaskSectionWrite) => Effect.Effect<TaskSectionsWritten | undefined>,
  ) => Effect.Effect<boolean>;
}

/** The account's sidebar, empty until its follow first answers or a write is drawn. */
export function sidebarCollections(
  dependencies: SidebarDependencies,
): Effect.Effect<SidebarCollections, never, Scope.Scope> {
  return Effect.gen(function* () {
    const sections = yield* answeredCollection({ getKey: (row: TaskSection) => row.id });
    const entries = yield* answeredCollection({ getKey: (row: TaskSectionEntry) => row.taskId });
    const agentEntries = yield* answeredCollection({
      getKey: (row: AgentSectionEntry) => row.agentId,
    });
    const pins = yield* answeredCollection({ getKey: (row: RepositoryPin) => row.repository });
    const sectionsInOrder = yield* scopedCollection(() =>
      createLiveQueryCollection({
        gcTime: KEPT_BY_SCOPE,
        startSync: true,
        query: (q) =>
          q
            .from({ section: sections.collection })
            .orderBy(({ section }) => section.createdAt)
            .orderBy(({ section }) => section.id, BY_CODE_UNIT),
      }),
    );
    const entriesInOrder = yield* scopedCollection(() =>
      createLiveQueryCollection({
        gcTime: KEPT_BY_SCOPE,
        startSync: true,
        query: (q) =>
          q
            .from({ entry: entries.collection })
            .orderBy(({ entry }) => entry.addedAt)
            .orderBy(({ entry }) => entry.taskId, BY_CODE_UNIT),
      }),
    );
    const agentEntriesInOrder = yield* scopedCollection(() =>
      createLiveQueryCollection({
        gcTime: KEPT_BY_SCOPE,
        startSync: true,
        query: (q) =>
          q
            .from({ entry: agentEntries.collection })
            .orderBy(({ entry }) => entry.addedAt)
            .orderBy(({ entry }) => entry.agentId, BY_CODE_UNIT),
      }),
    );
    const pinsInOrder = yield* scopedCollection(() =>
      createLiveQueryCollection({
        gcTime: KEPT_BY_SCOPE,
        startSync: true,
        query: (q) =>
          q
            .from({ pin: pins.collection })
            .orderBy(({ pin }) => pin.pinnedAt, "desc")
            .orderBy(({ pin }) => pin.repository, BY_CODE_UNIT),
      }),
    );

    // Note that a write still standing once the scope closed draws nothing, since a sign-out closed it and its rows were the account's that left.
    let open = true;
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        open = false;
      }),
    );

    /** Draws the sidebar as it stands now, what every standing write drew among it. */
    const drawn = () => {
      if (!open) return;
      dependencies.draw({
        taskSections: {
          sections: rowsOf(sectionsInOrder),
          entries: rowsOf(entriesInOrder),
          agentEntries: rowsOf(agentEntriesInOrder),
        },
        repositoryPins: rowsOf(pinsInOrder),
      });
    };

    /**
     * A write's work, answering whether it was kept: the sidebar drawn as
     * the work begins, which shows what the write drew, and again once
     * TanStack has kept or taken it back.
     */
    const kept = (draw: () => void, work: Effect.Effect<void, Unwritten>) =>
      optimistically(draw, Effect.andThen(Effect.sync(drawn), work)).pipe(
        Effect.as(true),
        Effect.catchTag("Unwritten", () => Effect.succeed(false)),
        Effect.ensuring(Effect.sync(drawn)),
      );

    /** Confirms a write on the followed sidebar where it hands a wait, or takes the service's answer in its place where it does not. */
    const confirmed = (txid: string | undefined, answered: () => void) => {
      const wait = dependencies.txWait();
      return wait === undefined || txid === undefined
        ? Effect.sync(answered)
        : confirmWrite(wait, txid);
    };

    /** The newest drag's writes settling, which the next drag's writes wait on before they are written. */
    let lastDrag: Deferred.Deferred<void> | undefined;

    return {
      answer: (rows) => {
        sections.answer(rows.sections);
        entries.answer(rows.entries);
        agentEntries.answer(rows.agentEntries);
        pins.answer(rows.pins);
        drawn();
      },
      pinRepository: (repository, pinned, written) =>
        kept(
          () => {
            const shown = pins.collection.has(repository);
            if (pinned && !shown)
              pins.collection.insert({ repository, pinnedAt: dependencies.now() });
            if (!pinned && shown) pins.collection.delete(repository);
          },
          Effect.gen(function* () {
            const answered = yield* written;
            if (answered === undefined) return yield* new Unwritten();
            yield* confirmed(answered.txid, () => pins.answer(answered.pins));
          }),
        ),
      writeSections: (writes, written) =>
        Effect.gen(function* () {
          const before = lastDrag;
          const settled = yield* Deferred.make<void>();
          lastDrag = settled;
          const draw = () => {
            const now = dependencies.now();
            const next = writes.reduce<TaskSections>(
              (held, write) => applySectionWrite(held, write, now),
              {
                sections: rowsOf(sections.collection),
                entries: rowsOf(entries.collection),
                agentEntries: rowsOf(agentEntries.collection),
              },
            );
            drawRows(sections.collection, next.sections);
            drawRows(entries.collection, next.entries);
            drawRows(agentEntries.collection, next.agentEntries);
          };
          // Note that a write the service refused does not stop the ones after it, since each
          // stands alone on the service, and what the service kept is confirmed before the drag
          // is taken back, so taking back what it drew lands on the service's word.
          const work = Effect.gen(function* () {
            if (before !== undefined) yield* Deferred.await(before);
            let last: TaskSectionsWritten | undefined;
            let txid: string | undefined;
            let refused = false;
            for (const write of writes) {
              const answered = yield* written(write);
              if (answered === undefined) refused = true;
              else {
                last = answered;
                txid = answered.txid ?? txid;
              }
            }
            if (last !== undefined) {
              const kept = last;
              yield* confirmed(txid, () => {
                sections.answer(kept.sections);
                entries.answer(kept.entries);
                agentEntries.answer(kept.agentEntries);
              });
            }
            if (refused) return yield* new Unwritten();
          });
          return yield* kept(draw, work).pipe(
            Effect.ensuring(Deferred.succeed(settled, undefined)),
          );
        }),
    };
  });
}
