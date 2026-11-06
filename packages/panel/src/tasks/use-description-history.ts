import type {
  DescriptionDocument,
  DescriptionRevisionLine,
  DescriptionRevisionsAnswer,
} from "@repo/features/task-wire";
import type { TasksRevisionAnswer, TasksRevisionsAnswer } from "@repo/features/tasks-view";
import { ACT_KIND } from "@repo/host/acts";
import { ACTION_RESULT_STATUS, type ActionResult } from "@repo/wire";
import { queryOptions, skipToken, type UseQueryResult, useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { type ActedResult, askAct, askKept, type Kept } from "../act.js";
import { QUERY_ROOT } from "../query-keys.js";
import { useRegained } from "../use-regained.js";
import { revisionOfSave } from "./description-history-model.js";

/**
 * use-description-history.ts -- the open description's history as its version history holds it: the revisions read, the version chosen, and its restore.
 *
 * The history is the one main holds for the description's version history while it
 * stands, and a while after (`LIVE_READ.HISTORY`): its newest page, which
 * main follows as each save lands, then each older page the list asked for,
 * which main lays after it, so a save lands at the head of the list as it
 * lands in the document, a version history opened again lists its versions
 * in its first frame, and nothing is read again here. The newest revision,
 * the description as it stands, is chosen where the history's address names
 * no revision, and a save landing meanwhile moves the view on to the new
 * newest; choosing one reads its content and the content before it, and the
 * version history draws what that revision changed. Where it stands is its
 * address's alone (`version-history-route.ts`), so every choice is a move
 * asked of the router, and the history gone back to stands where it stood.
 * Opened from a section's "Edited by", it opens instead on the revision that
 * made the section's last save, reading older pages until one shows it, and
 * on the newest where none can be read.
 * Restoring the version is the service's write; the description it answers arrives
 * in the document through main's view like any other save, and the history
 * reads again on it. A restore is undone by restoring the version that stood
 * before it, which the caller is handed to offer.
 */

/** Where a read of the history or of one version stands. */
export const HISTORY_READ = {
  READING: "reading",
  READY: "ready",
  FAILED: "failed",
} as const;

/** The description's revisions as read: reading the first page, its read failed, or the pages read, newest first, with where the next older page is read from. */
type HistoryList =
  | { readonly kind: typeof HISTORY_READ.READING }
  | { readonly kind: typeof HISTORY_READ.FAILED }
  | {
      readonly kind: typeof HISTORY_READ.READY;
      readonly revisions: readonly DescriptionRevisionLine[];
      readonly earlier: number | undefined;
    };

/** A version's content as read: reading, failed, or the description after the revision and before it, none before the first. */
type VersionRead =
  | { readonly kind: typeof HISTORY_READ.READING }
  | { readonly kind: typeof HISTORY_READ.FAILED }
  | {
      readonly kind: typeof HISTORY_READ.READY;
      readonly document: DescriptionDocument;
      readonly previous: DescriptionDocument | null;
    };

/** The version the version history draws: its revision, whether it is the description as it stands, and its content as read. */
export interface ViewedVersion {
  readonly line: DescriptionRevisionLine;
  /** Whether it is the newest revision, which is the description as it stands and has nothing to restore. */
  readonly current: boolean;
  readonly read: VersionRead;
}

/** The history as main holds it for the version history: its rows once read, whether its read failed, and Try again. */
export interface HeldHistory {
  readonly rows: DescriptionRevisionsAnswer | undefined;
  readonly failed: boolean;
  readonly onRetry: () => void;
}

/** Where the history's older pages are read from, and a version is restored: main's acts, or a test's own. */
export interface DescriptionHistorySource {
  /** Reads the page before `before`, which main lays after the history it holds. */
  readPage: (taskId: string, before: number) => Promise<TasksRevisionsAnswer>;
  restore: (taskId: string, seq: number) => Promise<boolean>;
}

/**
 * The revision whose sections are open, and the one of them drawn by its
 * heading, the first until another is chosen. Note that the section is
 * held by its heading rather than its place, because a save that joins the
 * revision while it is open can add a section before it.
 */
export interface OpenedSections {
  readonly seq: number;
  readonly heading: string | undefined;
}

/** Where a version history stands: the revision chosen, none while the newest is followed, and the revision whose sections are open. */
export interface HistorySpot {
  readonly revision: number | undefined;
  readonly opened: OpenedSections | undefined;
  /**
   * Whether its list stands rather than the version, which only a narrow
   * room draws apart and only the window's history there records; a spot
   * that says nothing opens on the version.
   */
  readonly listed?: boolean;
}

/** What the version history draws, and its presses. */
export interface DescriptionHistoryControl {
  list: HistoryList;
  /** The revision chosen, the newest until another is, while the version history stands. */
  selected: number | undefined;
  /** The version drawn, once the list holds the revision chosen. */
  viewing: ViewedVersion | undefined;
  onSelect: (seq: number) => void;
  /** Where the version history stands while it does. */
  spot: HistorySpot | undefined;
  /** Chooses a revision and opens the sections it changed, the first drawn. */
  onOpenSections: (seq: number) => void;
  /** Draws another of the open revision's sections, by its heading. */
  onChooseSection: (heading: string | undefined) => void;
  /** Closes the open revision's sections, back to every version. */
  onCloseSections: () => void;
  /**
   * Whether the history stands on its list rather than on the version chosen,
   * which only a narrow room draws apart: a history opened on the description as it
   * stands does, one opened on a save or a version, or with a version or a
   * section chosen, does not.
   */
  listed: boolean;
  /** Goes back from the version chosen to the list. */
  onList: () => void;
  onRetry: () => void;
  /** Reads the version chosen again after its read failed, leaving its sections open. */
  onRetryVersion: () => void;
  /** Reads the page of revisions older than the oldest read; answers whether it landed. */
  onLoadEarlier: () => Promise<boolean>;
  /** Restores the version `seq`, or the one chosen, as the description's content; the caller hears it landed through `onRestored`. */
  onRestore: (seq?: number) => Promise<ActedResult>;
}

/** What a restore the service did not carry answers, so its press says why. */
const RESTORE_REFUSED: ActionResult = {
  status: ACTION_RESULT_STATUS.REJECTED,
  reason: "The version could not be restored. Try again.",
};

/** The history main holds as the list draws it: its pages once read, failed where it never answered, and none while it reads. */
function listOf(
  rows: DescriptionRevisionsAnswer | undefined,
  failed: boolean,
): HistoryList | undefined {
  if (rows !== undefined) {
    return { kind: HISTORY_READ.READY, revisions: rows.revisions, earlier: rows.earlier };
  }
  return failed ? { kind: HISTORY_READ.FAILED } : undefined;
}

/**
 * One version's content: the plan after the revision and before it. A
 * revision never changes, but the plan's last edit and its name are in its
 * key, since a save and a rename read the version drawn again, as before.
 * A failed read is answered at once, and read again on Retry.
 */
function taskRevisionQueryOptions(
  taskId: string | undefined,
  seq: number | undefined,
  editedAt: number | undefined,
  name: string | undefined,
) {
  return queryOptions({
    queryKey: [QUERY_ROOT.TASK_REVISION, taskId, seq, editedAt ?? null, name ?? null],
    queryFn:
      taskId === undefined || seq === undefined
        ? skipToken
        : () => askAct(ACT_KIND.TASKS_REVISION, { taskId, seq }),
    retry: false,
  });
}

/** A version's content as the view holds it: reading, a read again after a failure among them, the failure it stands for, or the content. */
function versionRead(version: UseQueryResult<TasksRevisionAnswer>): VersionRead {
  const failed = version.isError || (version.data !== undefined && "failure" in version.data);
  if (version.isPending || (version.isFetching && failed)) return { kind: HISTORY_READ.READING };
  if (version.isError || version.data === undefined || "failure" in version.data) {
    return { kind: HISTORY_READ.FAILED };
  }
  return {
    kind: HISTORY_READ.READY,
    document: version.data.revision.document,
    previous: version.data.revision.previous,
  };
}

/**
 * The open description's history. `taskId` is the open task, none while no
 * task is drawn; `history` its history as main holds it, which the caller
 * holds while the version history is shown; `editedAt` its last edit, which
 * reads the version drawn again and which a list must be as new as to be
 * sought in; `name` its name, under which a version is formatted, so a
 * rename reads the version drawn again; `at` where the version history
 * stands, as its address says (`version-history-route.ts`), none while it
 * stands nowhere, which is what reads it; `seek` the moment of the save whose
 * revision it opens on, sought as it opens, which `onSought` hears found or
 * given up on; and `narrow` whether the room shows one pane at a time, where
 * its list stands apart. Every move is asked of `onMove`, which stands the
 * history where it is asked to.
 */
export function useDescriptionHistory(input: {
  source: DescriptionHistorySource;
  taskId: string | undefined;
  history: HeldHistory;
  editedAt: number | undefined;
  name: string | undefined;
  at: HistorySpot | undefined;
  seek: number | undefined;
  narrow: boolean;
  onMove: (spot: HistorySpot) => void;
  onSought: () => void;
  /**
   * Says a restore landed, with the way to undo it: a restore of the
   * version that stood before it, where the history read names one.
   */
  onRestored: (undo: (() => Promise<Kept>) | undefined) => void;
}): DescriptionHistoryControl {
  const { source, taskId, history, editedAt, name, at, seek, narrow, onRestored } = input;
  // Note that the source and the doors are read where they are called rather
  // than named by the reads below, because a caller's acts are a new object
  // on each of its renders, and a read keyed on them would read again on every one.
  const latest = useRef({ source, onMove: input.onMove, onSought: input.onSought });
  latest.current = { source, onMove: input.onMove, onSought: input.onSought };
  const chosen = taskId === undefined ? undefined : at;
  const reading = chosen !== undefined;

  const heldRows = reading ? history.rows : undefined;
  const heldFailed = reading && history.failed;
  const held = useMemo(() => listOf(heldRows, heldFailed), [heldRows, heldFailed]);
  const revisions = held?.kind === HISTORY_READ.READY ? held.revisions : [];
  // Until one is chosen, the description as it stands is, whichever revision that is now.
  const newest = revisions[0]?.seq;
  // A save sought is its revision once the pages read show it, which the
  // history then stands on. Note that it is sought only in a list as new as
  // the task's last edit, because a list kept from an earlier visit may lack
  // the revision the save made since, and would find the one before it.
  const current =
    held?.kind === HISTORY_READ.READY &&
    (editedAt === undefined || (revisions[0]?.lastEdit.at ?? -1) >= editedAt);
  const complete = current && held.earlier === undefined;
  const seeking = reading ? seek : undefined;
  const sought =
    seeking === undefined || !current ? undefined : revisionOfSave(revisions, seeking, complete);
  // A version stood on that no page read so far shows is read for on older
  // pages as a save is, and gives way to the description as it stands where
  // the whole history read holds none.
  const returned = seeking === undefined ? chosen?.revision : undefined;
  const unread =
    returned !== undefined && current && !revisions.some((line) => line.seq === returned);
  const readBefore =
    (seeking !== undefined && sought === undefined) || unread
      ? current
        ? held.earlier
        : undefined
      : undefined;
  useEffect(() => {
    if (sought === undefined) return;
    latest.current.onMove({ revision: sought, opened: undefined, listed: false });
    latest.current.onSought();
  }, [sought]);
  const gaveWay = unread && complete;
  useEffect(() => {
    if (gaveWay) latest.current.onMove({ revision: undefined, opened: undefined, listed: true });
  }, [gaveWay]);

  const seq = !reading ? undefined : seeking === undefined ? (chosen.revision ?? newest) : sought;
  const versionQuery = useQuery({
    ...taskRevisionQueryOptions(taskId, seq, editedAt, name),
    // Note that the version drawn stands while a save or a rename reads it again, never another version's.
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[1] === taskId && previousQuery?.queryKey[2] === seq
        ? previous
        : undefined,
  });
  const read = versionRead(versionQuery);
  const readAgain = versionQuery.refetch;

  // Choosing the version drawn again leaves it as it is, unless its read failed.
  const onSelect = useCallback(
    (chosenSeq: number) => {
      if (chosen === undefined) return;
      const same = seeking === undefined && seq === chosenSeq;
      if (same && read.kind === HISTORY_READ.FAILED) void readAgain();
      if (same && chosen.listed !== true) return;
      latest.current.onMove({ revision: chosenSeq, opened: undefined, listed: false });
    },
    [chosen, seeking, seq, read.kind, readAgain],
  );
  const onRetry = history.onRetry;
  // Note that the sections stay open, since they are drawn from the very version this reads again.
  const onRetryVersion = useCallback(() => void readAgain(), [readAgain]);
  // A version whose read failed, or is still out and may have been sent while the connection was gone, is read again as the app reaches the service again, as its Try again reads it.
  useRegained(() => {
    if (chosen === undefined) return;
    if (read.kind === HISTORY_READ.FAILED || read.kind === HISTORY_READ.READING) onRetryVersion();
  });
  // Note that a revision's sections are listed where the versions are, so opening them keeps to the list.
  const onOpenSections = (sectionsOf: number) =>
    latest.current.onMove({
      revision: sectionsOf,
      opened: { seq: sectionsOf, heading: undefined },
      listed: true,
    });
  const onChooseSection = (heading: string | undefined) => {
    if (chosen?.opened === undefined) return;
    latest.current.onMove({ ...chosen, opened: { ...chosen.opened, heading }, listed: false });
  };
  // Note that a narrow room's sections close onto every version, its list, and a wide room's onto the version they were of.
  const onCloseSections = () => {
    if (chosen === undefined) return;
    latest.current.onMove({ revision: chosen.revision, opened: undefined, listed: narrow });
  };
  const onList = () => {
    if (chosen !== undefined) latest.current.onMove({ ...chosen, listed: true });
  };

  // Note that the page is drawn from what main holds, which lays it after the history held.
  const onLoadEarlier = async (): Promise<boolean> => {
    if (taskId === undefined || held?.kind !== HISTORY_READ.READY || held.earlier === undefined) {
      return false;
    }
    const answer = await source.readPage(taskId, held.earlier).catch(() => undefined);
    return answer !== undefined && !("failure" in answer);
  };

  // A save or a version stood on that no page read so far shows is sought
  // on the next older page, and one whose page could not be read gives way
  // to the description as it stands: a save sought is given up on, and a
  // version stood on leaves for the newest, unless the history has since
  // moved on to another task or another version.
  const standingOn = useRef({ taskId, returned });
  standingOn.current = { taskId, returned };
  useEffect(() => {
    if (readBefore === undefined || taskId === undefined) return;
    onLoadEarlier().then((landed) => {
      const now = standingOn.current;
      if (landed || now.taskId !== taskId) return;
      if (seeking !== undefined) latest.current.onSought();
      else if (now.returned === returned) {
        latest.current.onMove({ revision: undefined, opened: undefined, listed: true });
      }
    });
  }, [readBefore]);

  const onRestore = async (at = seq): Promise<ActedResult> => {
    if (taskId === undefined || at === undefined) return RESTORE_REFUSED;
    // The version standing before the restore is the newest the list read.
    const before = newest;
    const restored = await askKept(source.restore(taskId, at));
    if (!restored.kept) return { ...RESTORE_REFUSED, cause: restored.cause };
    onRestored(
      before === undefined || before === at
        ? undefined
        : () => askKept(latest.current.source.restore(taskId, before)),
    );
    return { status: ACTION_RESULT_STATUS.ACCEPTED };
  };

  // A newer version arriving while the newest's sections are open moves the
  // history on to it, as it does over the list, so the sections give way.
  const opened = chosen?.opened?.seq === seq ? chosen?.opened : undefined;
  // Note that the spot is the same object while it stands as it was, because what reads it keys on it.
  const revision = chosen?.revision;
  const openedSeq = opened?.seq;
  const heading = opened?.heading;
  const spot = useMemo((): HistorySpot | undefined => {
    if (!reading) return undefined;
    return { revision, opened: openedSeq === undefined ? undefined : { seq: openedSeq, heading } };
  }, [reading, revision, openedSeq, heading]);

  const line = revisions.find((each) => each.seq === seq);
  return {
    list: held ?? { kind: HISTORY_READ.READING },
    selected: seq,
    viewing:
      chosen === undefined || line === undefined
        ? undefined
        : {
            line,
            current: newest === line.seq,
            read,
          },
    onSelect,
    spot,
    onOpenSections,
    onChooseSection,
    onCloseSections,
    listed: chosen?.listed ?? true,
    onList,
    onRetry,
    onRetryVersion,
    onLoadEarlier,
    onRestore,
  };
}
