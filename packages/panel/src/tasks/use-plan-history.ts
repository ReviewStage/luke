import type { PlanDocument, PlanRevisionLine, PlanRevisionsAnswer } from "@repo/features/task-wire";
import type { TasksRevisionAnswer, TasksRevisionsAnswer } from "@repo/features/tasks-view";
import { ACT_KIND } from "@repo/host/acts";
import { ACTION_RESULT_STATUS, type ActionResult } from "@repo/wire";
import { queryOptions, skipToken, type UseQueryResult, useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type ActedResult, askAct, askKept, type Kept } from "../act.js";
import { QUERY_ROOT } from "../query-keys.js";
import { useRegained } from "../use-regained.js";
import { revisionOfSave } from "./plan-history-model.js";

/**
 * use-plan-history.ts -- the open plan's history as its version history holds it: the revisions read, the version chosen, and its restore.
 *
 * The history is the one main holds for the plan's version history while it
 * stands, and a while after (`LIVE_READ.HISTORY`): its newest page, which
 * main follows as each save lands, then each older page the list asked for,
 * which main lays after it, so a save lands at the head of the list as it
 * lands in the document, a version history opened again lists its versions
 * in its first frame, and nothing is read again here. The newest revision,
 * the plan as it stands, is chosen until the developer chooses another, and
 * a save landing meanwhile moves the view on
 * to the new newest; choosing one reads its content and the content before
 * it, and the version history draws what that revision changed until it is
 * left or another task opens, and opens again on the newest. Opened from a
 * section's "Edited by", it opens instead on the revision that made the
 * section's last save, reading older pages until one shows it, and on the
 * newest where none can be read. Gone back to, it opens where it stood when
 * it was left: on the version chosen then, with the sections then open.
 * Restoring the version is the service's write; the plan it answers arrives
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

/** The plan's revisions as read: reading the first page, its read failed, or the pages read, newest first, with where the next older page is read from. */
type HistoryList =
  | { readonly kind: typeof HISTORY_READ.READING }
  | { readonly kind: typeof HISTORY_READ.FAILED }
  | {
      readonly kind: typeof HISTORY_READ.READY;
      readonly revisions: readonly PlanRevisionLine[];
      readonly earlier: number | undefined;
    };

/** A version's content as read: reading, failed, or the plan after the revision and before it, none before the first. */
type VersionRead =
  | { readonly kind: typeof HISTORY_READ.READING }
  | { readonly kind: typeof HISTORY_READ.FAILED }
  | {
      readonly kind: typeof HISTORY_READ.READY;
      readonly document: PlanDocument;
      readonly previous: PlanDocument | null;
    };

/** The version the version history draws: its revision, whether it is the plan as it stands, and its content as read. */
export interface ViewedVersion {
  readonly line: PlanRevisionLine;
  /** Whether it is the newest revision, which is the plan as it stands and has nothing to restore. */
  readonly current: boolean;
  readonly read: VersionRead;
}

/** The history as main holds it for the version history: its rows once read, whether its read failed, and Try again. */
export interface HeldHistory {
  readonly rows: PlanRevisionsAnswer | undefined;
  readonly failed: boolean;
  readonly onRetry: () => void;
}

/** Where the history's older pages are read from, and a version is restored: main's acts, or a test's own. */
export interface PlanHistorySource {
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
export interface PlanHistoryControl {
  list: HistoryList;
  /** The revision chosen, the newest until another is, while the version history stands. */
  selected: number | undefined;
  /** The version drawn, once the list holds the revision chosen. */
  viewing: ViewedVersion | undefined;
  onSelect: (seq: number) => void;
  /** Where the version history stands while it does, which it opens on again given as `returnTo`. */
  spot: HistorySpot | undefined;
  /** Chooses a revision and opens the sections it changed, the first drawn. */
  onOpenSections: (seq: number) => void;
  /** Draws another of the open revision's sections, by its heading. */
  onChooseSection: (heading: string | undefined) => void;
  /** Closes the open revision's sections, back to every version. */
  onCloseSections: () => void;
  /**
   * Whether the history stands on its list rather than on the version chosen,
   * which only a narrow room draws apart: a history opened on the plan as it
   * stands does, one opened on a save or a version, or with a version or a
   * section chosen, does not.
   */
  listed: boolean;
  /** Goes back from the version chosen to the list. */
  onList: () => void;
  /** Stands the history open where `spot` says, as the window's history goes back or forward within it. */
  onStand: (spot: HistorySpot) => void;
  onRetry: () => void;
  /** Reads the version chosen again after its read failed, leaving its sections open. */
  onRetryVersion: () => void;
  /** Reads the page of revisions older than the oldest read; answers whether it landed. */
  onLoadEarlier: () => Promise<boolean>;
  /** Restores the version `seq`, or the one chosen, as the plan's content; the caller hears it landed through `onRestored`. */
  onRestore: (seq?: number) => Promise<ActedResult>;
}

/** What a restore the service did not carry answers, so its press says why. */
const RESTORE_REFUSED: ActionResult = {
  status: ACTION_RESULT_STATUS.REJECTED,
  reason: "The version could not be restored. Try again.",
};

/**
 * A version chosen on one task: its revision, none while the newest is
 * followed, so a save landing moves the view onto it; the moment of the save
 * it was opened to find, until the pages read show which revision made it;
 * the revision whose sections are open, drawn only while it is the one
 * chosen; and whether the list stands rather than the version. Its content
 * is read through TanStack Query (`taskRevisionQueryOptions`).
 */
interface HeldVersion {
  readonly taskId: string;
  readonly seq: number | undefined;
  readonly seeking: number | undefined;
  readonly opened: OpenedSections | undefined;
  readonly listed: boolean;
}

/** The version history opened on a task: following the newest, seeking a save's revision, or where it stood before, nothing read yet. */
function openedOn(
  taskId: string,
  seek: number | undefined,
  returnTo: HistorySpot | undefined,
): HeldVersion {
  return {
    taskId,
    seq: returnTo?.revision,
    seeking: seek,
    opened: returnTo?.opened,
    listed: returnTo?.listed ?? (seek === undefined && returnTo === undefined),
  };
}

/**
 * The version history standing open on `held` moved to `spot`: its list kept
 * as it was where the spot is the list, and the version and sections the spot
 * names otherwise.
 */
function stoodAt(held: HeldVersion, spot: HistorySpot): HeldVersion {
  if (spot.listed === true) return { ...held, listed: true };
  if (held.seeking === undefined && held.seq === spot.revision) {
    return { ...held, opened: spot.opened, listed: false };
  }
  return {
    ...held,
    seq: spot.revision,
    seeking: undefined,
    opened: spot.opened,
    listed: false,
  };
}

/** The history main holds as the list draws it: its pages once read, failed where it never answered, and none while it reads. */
function listOf(rows: PlanRevisionsAnswer | undefined, failed: boolean): HistoryList | undefined {
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
 * The open plan's history. `planId` is the open task, none while no task is
 * drawn; `history` its history as main holds it, which the caller holds
 * while the version history is shown; `editedAt` its last edit, which reads
 * the version drawn again and which a list must be as new as to be sought
 * in; `name` its name, under which a version is formatted, so a rename reads
 * the version drawn again; `shown` whether the plan's version history is on
 * screen, which is what reads it and what a version chosen stands on; and
 * `seek` the moment of the save whose revision it opens on, read as it
 * opens, none to open on the plan as it stands or, given `returnTo`, where
 * it stood on an earlier visit.
 */
export function usePlanHistory(input: {
  source: PlanHistorySource;
  taskId: string | undefined;
  history: HeldHistory;
  editedAt: number | undefined;
  name: string | undefined;
  shown: boolean;
  seek: number | undefined;
  returnTo: HistorySpot | undefined;
  /**
   * Says a restore landed, with the way to undo it: a restore of the
   * version that stood before it, where the history read names one.
   */
  onRestored: (undo: (() => Promise<Kept>) | undefined) => void;
}): PlanHistoryControl {
  const { source, taskId, history, editedAt, name, shown, seek, returnTo, onRestored } = input;
  const [version, setVersion] = useState<HeldVersion | undefined>(undefined);
  // Note that the source is read where it is called rather than named by the
  // reads below, because a caller's acts are a new object on each of its
  // renders, and a read keyed on them would read again on every one.
  const latest = useRef(source);
  latest.current = source;
  const reading = shown && taskId !== undefined;

  // A version stands while the version history does, on its own task.
  const chosen = reading && version?.taskId === taskId ? version : undefined;
  if (version !== undefined && chosen === undefined) setVersion(undefined);
  const heldRows = reading ? history.rows : undefined;
  const heldFailed = reading && history.failed;
  const held = useMemo(() => listOf(heldRows, heldFailed), [heldRows, heldFailed]);
  const revisions = held?.kind === HISTORY_READ.READY ? held.revisions : [];
  // Until one is chosen, the plan as it stands is, whichever revision that is now.
  const newest = revisions[0]?.seq;
  if (reading && taskId !== undefined && chosen === undefined) {
    setVersion(openedOn(taskId, seek, returnTo));
  }
  // A save sought is its revision once the pages read show it, kept as chosen
  // from then on. Note that it is sought only in a list as new as the task's
  // last edit, because a list kept from an earlier visit may lack the
  // revision the save made since, and would find the one before it.
  const current =
    held?.kind === HISTORY_READ.READY &&
    (editedAt === undefined || (revisions[0]?.lastEdit.at ?? -1) >= editedAt);
  const complete = current && held.earlier === undefined;
  const seeking = chosen?.seeking;
  const sought =
    seeking === undefined || !current ? undefined : revisionOfSave(revisions, seeking, complete);
  if (chosen !== undefined && sought !== undefined) {
    setVersion({ ...chosen, seq: sought === newest ? undefined : sought, seeking: undefined });
  }
  // A version gone back to that no page read so far shows is read for on
  // older pages as a save is, and gives way to the plan as it stands where
  // the whole history read holds none.
  const returned = seeking === undefined ? chosen?.seq : undefined;
  const unread =
    returned !== undefined && current && !revisions.some((line) => line.seq === returned);
  if (chosen !== undefined && unread && complete) {
    setVersion({ ...chosen, seq: undefined, opened: undefined });
  }
  const readBefore =
    (seeking !== undefined && sought === undefined) || unread
      ? current
        ? held.earlier
        : undefined
      : undefined;

  const seq =
    chosen === undefined
      ? undefined
      : chosen.seeking === undefined
        ? (chosen.seq ?? newest)
        : sought;
  const versionQuery = useQuery({
    ...taskRevisionQueryOptions(taskId, chosen === undefined ? undefined : seq, editedAt, name),
    // Note that the version drawn stands while a save or a rename reads it again, never another version's.
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[1] === taskId && previousQuery?.queryKey[2] === seq
        ? previous
        : undefined,
  });
  const read = versionRead(versionQuery);
  const readAgain = versionQuery.refetch;

  // Choosing the version drawn again leaves it as it is, unless its read
  // failed; choosing the newest follows the newest from then on.
  const onSelect = useCallback(
    (chosenSeq: number) => {
      if (taskId === undefined) return;
      const same =
        chosen?.taskId === taskId &&
        chosen.seeking === undefined &&
        (chosen.seq ?? newest) === chosenSeq;
      if (same && read.kind === HISTORY_READ.FAILED) void readAgain();
      setVersion((held) => {
        if (same && held !== undefined) return held.listed ? { ...held, listed: false } : held;
        return {
          taskId,
          seq: chosenSeq === newest ? undefined : chosenSeq,
          seeking: undefined,
          opened: undefined,
          listed: false,
        };
      });
    },
    [taskId, newest, chosen, read.kind, readAgain],
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
  const onOpenSections = (sectionsOf: number) => {
    onSelect(sectionsOf);
    setVersion(
      (held) => held && { ...held, opened: { seq: sectionsOf, heading: undefined }, listed: true },
    );
  };
  const onChooseSection = (heading: string | undefined) =>
    setVersion(
      (held) => held?.opened && { ...held, opened: { ...held.opened, heading }, listed: false },
    );
  const onCloseSections = () =>
    setVersion((held) => held && { ...held, opened: undefined, listed: true });
  const onList = () => setVersion((held) => held && { ...held, listed: true });
  const onStand = (spot: HistorySpot) => setVersion((held) => held && stoodAt(held, spot));

  // Note that the page is drawn from what main holds, which lays it after the history held.
  const onLoadEarlier = async (): Promise<boolean> => {
    if (taskId === undefined || held?.kind !== HISTORY_READ.READY || held.earlier === undefined) {
      return false;
    }
    const answer = await source.readPage(taskId, held.earlier).catch(() => undefined);
    return answer !== undefined && !("failure" in answer);
  };

  // A save or a version gone back to that no page read so far shows is
  // sought on the next older page, and one whose page could not be read gives
  // way to the plan as it stands, unless the view has since been opened on
  // another task, another save, or another version.
  useEffect(() => {
    if (readBefore === undefined || taskId === undefined) return;
    onLoadEarlier().then((landed) => {
      if (landed) return;
      setVersion((held) => {
        if (held === undefined || held.taskId !== taskId || held.seeking !== seeking) return held;
        if (seeking !== undefined) return { ...held, seeking: undefined };
        return held.seq === returned ? { ...held, seq: undefined, opened: undefined } : held;
      });
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
        : () => askKept(latest.current.restore(taskId, before)),
    );
    return { status: ACTION_RESULT_STATUS.ACCEPTED };
  };

  // A newer version arriving while the newest's sections are open moves the
  // history on to it, as it does over the list, so the sections give way.
  const opened = chosen?.opened?.seq === seq ? chosen?.opened : undefined;
  // Note that the spot is the same object while it stands as it was, because
  // the window's history records it on every change.
  const standing = chosen !== undefined;
  const revision = chosen?.seq;
  const openedSeq = opened?.seq;
  const heading = opened?.heading;
  const spot = useMemo((): HistorySpot | undefined => {
    if (!standing) return undefined;
    return { revision, opened: openedSeq === undefined ? undefined : { seq: openedSeq, heading } };
  }, [standing, revision, openedSeq, heading]);

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
    onStand,
    onRetry,
    onRetryVersion,
    onLoadEarlier,
    onRestore,
  };
}
