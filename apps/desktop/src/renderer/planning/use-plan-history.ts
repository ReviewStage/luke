import type { PlanDocument, PlanRevisionLine } from "@luke/features/task-wire";
import type { TasksRevisionAnswer, TasksRevisionsAnswer } from "@luke/features/tasks-view";
import { ACTION_RESULT_STATUS, type ActionResult } from "@luke/wire";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { revisionOfSave } from "./plan-history-model";

/**
 * use-plan-history.ts -- the open plan's history as its version history holds it: the revisions read, the version chosen, and its restore.
 *
 * The history is read through the service while the plan's version history
 * stands, the newest page first and each older page as the list asks, and
 * read again whenever the plan is edited while it stands, so a save Luke
 * makes on a call lands at the head of the list as it lands in the
 * document. The newest revision, the plan as it stands, is chosen until the
 * developer chooses another, and a save landing meanwhile moves the view on
 * to the new newest; choosing one reads its content and the content before
 * it, and the version history draws what that revision changed until it is
 * left or another plan opens, and opens again on the newest. Opened from a
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

/** Where the history is read from and written to: main's acts, or a test's own. */
export interface PlanHistorySource {
  readPage: (planId: string, before: number | undefined) => Promise<TasksRevisionsAnswer>;
  readRevision: (planId: string, seq: number) => Promise<TasksRevisionAnswer>;
  restore: (planId: string, seq: number) => Promise<boolean>;
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
  onRetry: () => void;
  /** Reads the page of revisions older than the oldest read; answers whether it landed. */
  onLoadEarlier: () => Promise<boolean>;
  /** Restores the version chosen as the plan's content; the caller hears it landed through `onRestored`. */
  onRestore: () => Promise<ActionResult>;
}

/** What a restore the service did not carry answers, so the dialog stays and says why. */
const RESTORE_REFUSED: ActionResult = {
  status: ACTION_RESULT_STATUS.REJECTED,
  reason: "The version could not be restored. Try again.",
};

/** A list read for one plan. */
interface HeldList {
  readonly planId: string;
  readonly list: HistoryList;
}

/**
 * A version chosen on one plan: its revision, none while the newest is
 * followed, so a save landing moves the view onto it; the moment of the save
 * it was opened to find, until the pages read show which revision made it;
 * its content as read and the revision that read was for; how many times
 * it was asked for, so choosing one whose read failed reads it again; and the
 * revision whose sections are open, drawn only while it is the one chosen.
 */
interface HeldVersion {
  readonly planId: string;
  readonly seq: number | undefined;
  readonly seeking: number | undefined;
  readonly opened: OpenedSections | undefined;
  readonly read: VersionRead;
  readonly readOf: number | undefined;
  readonly asked: number;
}

/** The version history opened on a plan: following the newest, seeking a save's revision, or where it stood before, nothing read yet. */
function openedOn(
  planId: string,
  seek: number | undefined,
  returnTo: HistorySpot | undefined,
): HeldVersion {
  return {
    planId,
    seq: returnTo?.revision,
    seeking: seek,
    opened: returnTo?.opened,
    read: { kind: HISTORY_READ.READING },
    readOf: undefined,
    asked: 1,
  };
}

/**
 * The newest page laid over what was read before: the page whole, then
 * every older revision already read past it, so a list scrolled back keeps
 * what it read, and the place the next older page is read from with them.
 */
function withNewestPage(held: HistoryList | undefined, page: HistoryList): HistoryList {
  if (page.kind !== HISTORY_READ.READY || held?.kind !== HISTORY_READ.READY) return page;
  const oldest = page.revisions.at(-1)?.seq;
  if (oldest === undefined || page.earlier === undefined) return page;
  const older = held.revisions.filter((line) => line.seq < oldest);
  if (older.length === 0) return page;
  return { ...page, revisions: [...page.revisions, ...older], earlier: held.earlier };
}

/** A page as the list holds it, or the failure it stands for. */
function listOf(answer: TasksRevisionsAnswer): HistoryList {
  return "failure" in answer
    ? { kind: HISTORY_READ.FAILED }
    : { kind: HISTORY_READ.READY, revisions: answer.revisions, earlier: answer.earlier };
}

/** A version's content as the view holds it, or the failure it stands for. */
function versionOf(answer: TasksRevisionAnswer): VersionRead {
  return "failure" in answer
    ? { kind: HISTORY_READ.FAILED }
    : {
        kind: HISTORY_READ.READY,
        document: answer.revision.document,
        previous: answer.revision.previous,
      };
}

/**
 * The open plan's history. `planId` is the open plan, none while no plan is
 * drawn; `editedAt` its last edit, which reads what is read again; `name`
 * its name, under which a version is formatted, so a rename reads the
 * version drawn again; `shown` whether the plan's version history is on
 * screen, which is what reads it and what a version chosen stands on; and
 * `seek` the moment of the save whose revision it opens on, read as it
 * opens, none to open on the plan as it stands or, given `returnTo`, where
 * it stood on an earlier visit.
 */
export function usePlanHistory(input: {
  source: PlanHistorySource;
  planId: string | undefined;
  editedAt: number | undefined;
  name: string | undefined;
  shown: boolean;
  seek: number | undefined;
  returnTo: HistorySpot | undefined;
  /**
   * Says a restore landed, with the way to undo it: a restore of the
   * version that stood before it, where the history read names one.
   */
  onRestored: (undo: (() => Promise<boolean>) | undefined) => void;
}): PlanHistoryControl {
  const { source, planId, editedAt, name, shown, seek, returnTo, onRestored } = input;
  const [list, setList] = useState<HeldList | undefined>(undefined);
  const [version, setVersion] = useState<HeldVersion | undefined>(undefined);
  const [retries, setRetries] = useState(0);
  // Note that every read counts itself, because an answer landing after a
  // newer read was made, or after another plan opened, is not the list's.
  const listReads = useRef(0);
  const versionReads = useRef(0);
  // Note that the source is read where it is called rather than named by the
  // reads below, because a caller's acts are a new object on each of its
  // renders, and a read keyed on them would read again on every one.
  const latest = useRef(source);
  latest.current = source;
  const reading = shown && planId !== undefined;

  // A version stands while the version history does, on its own plan.
  const chosen = reading && version?.planId === planId ? version : undefined;
  if (version !== undefined && chosen === undefined) setVersion(undefined);
  const held = list !== undefined && list.planId === planId ? list.list : undefined;
  const revisions = held?.kind === HISTORY_READ.READY ? held.revisions : [];
  // Until one is chosen, the plan as it stands is, whichever revision that is now.
  const newest = revisions[0]?.seq;
  if (reading && planId !== undefined && chosen === undefined) {
    setVersion(openedOn(planId, seek, returnTo));
  }
  // A save sought is its revision once the pages read show it, kept as chosen
  // from then on. Note that it is sought only in a list as new as the plan's
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

  useEffect(() => {
    if (!reading || planId === undefined) return;
    listReads.current += 1;
    const read = listReads.current;
    setList((held) =>
      held?.planId === planId ? held : { planId, list: { kind: HISTORY_READ.READING } },
    );
    latest.current.readPage(planId, undefined).then(
      (answer) => {
        if (read !== listReads.current) return;
        setList((held) => {
          const was = held?.planId === planId ? held.list : undefined;
          const page = listOf(answer);
          // A read that failed keeps the list already drawn.
          if (page.kind === HISTORY_READ.FAILED && was?.kind === HISTORY_READ.READY) return held;
          return { planId, list: withNewestPage(was, page) };
        });
      },
      // A read main refused is one that failed, which keeps a list already drawn too.
      () => {
        if (read !== listReads.current) return;
        setList((held) =>
          held?.planId === planId && held.list.kind === HISTORY_READ.READY
            ? held
            : { planId, list: { kind: HISTORY_READ.FAILED } },
        );
      },
    );
  }, [reading, planId, editedAt, retries]);

  const seq =
    chosen === undefined
      ? undefined
      : chosen.seeking === undefined
        ? (chosen.seq ?? newest)
        : sought;
  const asked = chosen?.asked;
  useEffect(() => {
    if (planId === undefined || seq === undefined || asked === undefined) return;
    versionReads.current += 1;
    const read = versionReads.current;
    const land = (landed: VersionRead) => {
      if (read !== versionReads.current) return;
      setVersion((held) =>
        held?.planId === planId ? { ...held, read: landed, readOf: seq } : held,
      );
    };
    latest.current.readRevision(planId, seq).then(
      (answer) => land(versionOf(answer)),
      () => land({ kind: HISTORY_READ.FAILED }),
    );
  }, [planId, seq, asked, editedAt, name]);

  // Choosing the version drawn again leaves it as it is, unless its read
  // failed; choosing the newest follows the newest from then on.
  const onSelect = useCallback(
    (chosenSeq: number) => {
      if (planId === undefined) return;
      setVersion((held) => {
        const same =
          held?.planId === planId &&
          held.seeking === undefined &&
          (held.seq ?? newest) === chosenSeq;
        if (same && held.read.kind !== HISTORY_READ.FAILED) return held;
        return {
          planId,
          seq: chosenSeq === newest ? undefined : chosenSeq,
          seeking: undefined,
          opened: undefined,
          read: { kind: HISTORY_READ.READING },
          readOf: undefined,
          asked: (same ? held.asked : 0) + 1,
        };
      });
    },
    [planId, newest],
  );
  const onRetry = useCallback(() => setRetries((was) => was + 1), []);
  const onOpenSections = (sectionsOf: number) => {
    onSelect(sectionsOf);
    setVersion((held) => held && { ...held, opened: { seq: sectionsOf, heading: undefined } });
  };
  const onChooseSection = (heading: string | undefined) =>
    setVersion((held) => held?.opened && { ...held, opened: { ...held.opened, heading } });
  const onCloseSections = () => setVersion((held) => held && { ...held, opened: undefined });

  const onLoadEarlier = async (): Promise<boolean> => {
    if (planId === undefined || held?.kind !== HISTORY_READ.READY || held.earlier === undefined) {
      return false;
    }
    const before = held.earlier;
    const answer = await source.readPage(planId, before).catch(() => undefined);
    if (answer === undefined || "failure" in answer) return false;
    setList((was) => {
      if (was?.planId !== planId || was.list.kind !== HISTORY_READ.READY) return was;
      const kept = was.list.revisions.filter((line) => line.seq >= before);
      return {
        planId,
        list: {
          kind: HISTORY_READ.READY,
          revisions: [...kept, ...answer.revisions],
          earlier: answer.earlier,
        },
      };
    });
    return true;
  };

  // A save or a version gone back to that no page read so far shows is
  // sought on the next older page, and one whose page could not be read gives
  // way to the plan as it stands, unless the view has since been opened on
  // another plan, another save, or another version.
  useEffect(() => {
    if (readBefore === undefined || planId === undefined) return;
    onLoadEarlier().then((landed) => {
      if (landed) return;
      setVersion((held) => {
        if (held === undefined || held.planId !== planId || held.seeking !== seeking) return held;
        if (seeking !== undefined) return { ...held, seeking: undefined };
        return held.seq === returned ? { ...held, seq: undefined, opened: undefined } : held;
      });
    });
  }, [readBefore]);

  const onRestore = async (): Promise<ActionResult> => {
    if (planId === undefined || seq === undefined) return RESTORE_REFUSED;
    // The version standing before the restore is the newest the list read.
    const before = newest;
    const restored = await source.restore(planId, seq).catch(() => false);
    if (!restored) return RESTORE_REFUSED;
    onRestored(
      before === undefined || before === seq
        ? undefined
        : () => latest.current.restore(planId, before).catch(() => false),
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
            // A read made for the revision followed before a save moved it on is not this one's.
            read: chosen.readOf === seq ? chosen.read : { kind: HISTORY_READ.READING },
          },
    onSelect,
    spot,
    onOpenSections,
    onChooseSection,
    onCloseSections,
    onRetry,
    onLoadEarlier,
    onRestore,
  };
}
