import type { PlanDocument, PlanRevisionLine } from "@sidecar/hosted/plan-wire";
import type {
  PlanningRevisionAnswer,
  PlanningRevisionsAnswer,
} from "@sidecar/hosted/planning-view";
import { ACTION_RESULT_STATUS, type ActionResult } from "@sidecar/wire";
import { useCallback, useEffect, useRef, useState } from "react";
import { VERSION_COMPARE, type VersionCompare } from "./plan-history-model";

/**
 * use-plan-history.ts -- the open plan's history as the History tab and the version view hold it: the revisions read, the version chosen, and its restore.
 *
 * The history is read through the service while the History tab is on
 * screen, the newest page first and each older page as the list asks, and
 * read again whenever the plan is edited while it stands, so a save Luke
 * makes on a call lands at the head of the list as it lands in the
 * document. Choosing a revision reads its content and the content before it,
 * and the document area draws that version against one of them
 * (`VERSION_COMPARE`) until the developer goes back to the plan as it
 * stands, leaves the tab, or opens another plan. Restoring the version is
 * the service's write; the plan it answers arrives in the document through
 * main's view like any other save, and the history reads again on it. A
 * restore is undone by restoring the version that stood before it, which
 * the caller is handed to offer.
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

/** The version the document area draws: its revision, whether it is the plan as it stands, and its content as read. */
export interface ViewedVersion {
  readonly line: PlanRevisionLine;
  /** Whether it is the newest revision, which is the plan as it stands and has nothing to restore. */
  readonly current: boolean;
  readonly read: VersionRead;
}

/** Where the history is read from and written to: main's acts, or a test's own. */
export interface PlanHistorySource {
  readPage: (planId: string, before: number | undefined) => Promise<PlanningRevisionsAnswer>;
  readRevision: (planId: string, seq: number) => Promise<PlanningRevisionAnswer>;
  restore: (planId: string, seq: number) => Promise<boolean>;
}

/** What the History tab and the version view draw, and their presses. */
export interface PlanHistoryControl {
  list: HistoryList;
  /** The revision chosen, while the tab is on screen. */
  selected: number | undefined;
  /** The version the document area draws in the plan's place, while one is chosen. */
  viewing: ViewedVersion | undefined;
  compare: VersionCompare;
  onSelect: (seq: number) => void;
  onCompare: (compare: VersionCompare) => void;
  /** Goes back to the plan as it stands. */
  onBack: () => void;
  onRetry: () => void;
  /** Reads the page of revisions older than the oldest read; answers whether it landed. */
  onLoadEarlier: () => Promise<boolean>;
  /** Restores the version chosen as the plan's content, and goes back to the plan once it is. */
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

/** A version chosen on one plan, its content as read, and how many times it was asked for, so choosing one whose read failed reads it again. */
interface HeldVersion {
  readonly planId: string;
  readonly seq: number;
  readonly read: VersionRead;
  readonly asked: number;
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
function listOf(answer: PlanningRevisionsAnswer): HistoryList {
  return "failure" in answer
    ? { kind: HISTORY_READ.FAILED }
    : { kind: HISTORY_READ.READY, revisions: answer.revisions, earlier: answer.earlier };
}

/** A version's content as the view holds it, or the failure it stands for. */
function versionOf(answer: PlanningRevisionAnswer): VersionRead {
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
 * version drawn again; and `shown` whether the History tab is on screen,
 * which is what reads it and what a version view stands on.
 */
export function usePlanHistory(input: {
  source: PlanHistorySource;
  planId: string | undefined;
  editedAt: number | undefined;
  name: string | undefined;
  shown: boolean;
  /**
   * Says a restore landed, once the plan is back as it stands, with the way
   * to undo it: a restore of the version that stood before it, where the
   * history read names one.
   */
  onRestored: (undo: (() => Promise<boolean>) | undefined) => void;
}): PlanHistoryControl {
  const { source, planId, editedAt, name, shown, onRestored } = input;
  const [list, setList] = useState<HeldList | undefined>(undefined);
  const [version, setVersion] = useState<HeldVersion | undefined>(undefined);
  const [compare, setCompare] = useState<VersionCompare>(VERSION_COMPARE.PREVIOUS);
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

  // A version stands while its tab does, on its own plan.
  const chosen = reading && version?.planId === planId ? version : undefined;
  if (version !== undefined && chosen === undefined) setVersion(undefined);

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

  const seq = chosen?.seq;
  const asked = chosen?.asked;
  useEffect(() => {
    if (planId === undefined || seq === undefined || asked === undefined) return;
    versionReads.current += 1;
    const read = versionReads.current;
    const land = (landed: VersionRead) => {
      if (read !== versionReads.current) return;
      setVersion((held) =>
        held?.planId === planId && held.seq === seq ? { ...held, read: landed } : held,
      );
    };
    latest.current.readRevision(planId, seq).then(
      (answer) => land(versionOf(answer)),
      () => land({ kind: HISTORY_READ.FAILED }),
    );
  }, [planId, seq, asked, editedAt, name]);

  // Choosing the version drawn again leaves it as it is, unless its read failed.
  const onSelect = useCallback(
    (chosenSeq: number) => {
      if (planId === undefined) return;
      setVersion((held) => {
        const same = held?.planId === planId && held.seq === chosenSeq;
        if (same && held.read.kind !== HISTORY_READ.FAILED) return held;
        return {
          planId,
          seq: chosenSeq,
          read: { kind: HISTORY_READ.READING },
          asked: (same ? held.asked : 0) + 1,
        };
      });
    },
    [planId],
  );
  const onBack = useCallback(() => setVersion(undefined), []);
  const onRetry = useCallback(() => setRetries((was) => was + 1), []);

  const held = list !== undefined && list.planId === planId ? list.list : undefined;
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

  const revisions = held?.kind === HISTORY_READ.READY ? held.revisions : [];
  const onRestore = async (): Promise<ActionResult> => {
    if (planId === undefined || seq === undefined) return RESTORE_REFUSED;
    // The version standing before the restore is the newest the list read.
    const before = revisions[0]?.seq;
    const restored = await source.restore(planId, seq).catch(() => false);
    if (!restored) return RESTORE_REFUSED;
    setVersion((was) => (was?.planId === planId && was.seq === seq ? undefined : was));
    onRestored(
      before === undefined || before === seq
        ? undefined
        : () => latest.current.restore(planId, before).catch(() => false),
    );
    return { status: ACTION_RESULT_STATUS.ACCEPTED };
  };

  const line = revisions.find((each) => each.seq === seq);
  return {
    list: held ?? { kind: HISTORY_READ.READING },
    selected: seq,
    viewing:
      chosen === undefined || line === undefined
        ? undefined
        : { line, current: revisions[0]?.seq === line.seq, read: chosen.read },
    compare,
    onSelect,
    onCompare: setCompare,
    onBack,
    onRetry,
    onLoadEarlier,
    onRestore,
  };
}
