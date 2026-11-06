import type {
  DescriptionDocument,
  DescriptionRevisionLine,
  DescriptionRevisionsAnswer,
} from "@repo/features/task-wire";
import type { TasksRevisionAnswer, TasksRevisionsAnswer } from "@repo/features/tasks-view";
import { ACT_KIND } from "@repo/host/acts";
import { ACTION_RESULT_STATUS, type ActionResult } from "@repo/wire";
import { queryOptions, skipToken, type UseQueryResult, useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type ActedResult, askAct, askKept, type Kept } from "../act.js";
import { QUERY_ROOT } from "../query-keys.js";
import { useRegained } from "../use-regained.js";
import { revisionOfSave } from "./description-history-model.js";

export const HISTORY_READ = {
  READING: "reading",
  READY: "ready",
  FAILED: "failed",
} as const;

type HistoryList =
  | { readonly kind: typeof HISTORY_READ.READING }
  | { readonly kind: typeof HISTORY_READ.FAILED }
  | {
      readonly kind: typeof HISTORY_READ.READY;
      readonly revisions: readonly DescriptionRevisionLine[];
      readonly earlier: number | undefined;
    };

type VersionRead =
  | { readonly kind: typeof HISTORY_READ.READING }
  | { readonly kind: typeof HISTORY_READ.FAILED }
  | {
      readonly kind: typeof HISTORY_READ.READY;
      readonly document: DescriptionDocument;
      readonly previous: DescriptionDocument | null;
    };

export interface ViewedVersion {
  readonly line: DescriptionRevisionLine;
  readonly current: boolean;
  readonly read: VersionRead;
}

export interface HeldHistory {
  readonly rows: DescriptionRevisionsAnswer | undefined;
  readonly failed: boolean;
  readonly onRetry: () => void;
}

export interface DescriptionHistorySource {
  readPage: (taskId: string, before: number) => Promise<TasksRevisionsAnswer>;
  restore: (taskId: string, seq: number) => Promise<boolean>;
}

export interface OpenedSections {
  readonly seq: number;
  readonly heading: string | undefined;
}

export interface HistorySpot {
  readonly revision: number | undefined;
  readonly opened: OpenedSections | undefined;
  readonly listed?: boolean;
}

export interface DescriptionHistoryControl {
  list: HistoryList;
  selected: number | undefined;
  viewing: ViewedVersion | undefined;
  onSelect: (seq: number) => void;
  spot: HistorySpot | undefined;
  onOpenSections: (seq: number) => void;
  onChooseSection: (heading: string | undefined) => void;
  onCloseSections: () => void;
  listed: boolean;
  onList: () => void;
  onStand: (spot: HistorySpot) => void;
  onRetry: () => void;
  onRetryVersion: () => void;
  onLoadEarlier: () => Promise<boolean>;
  onRestore: (seq?: number) => Promise<ActedResult>;
}

const RESTORE_REFUSED: ActionResult = {
  status: ACTION_RESULT_STATUS.REJECTED,
  reason: "The version could not be restored. Try again.",
};

interface HeldVersion {
  readonly taskId: string;
  readonly seq: number | undefined;
  readonly seeking: number | undefined;
  readonly opened: OpenedSections | undefined;
  readonly listed: boolean;
}

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

function listOf(
  rows: DescriptionRevisionsAnswer | undefined,
  failed: boolean,
): HistoryList | undefined {
  if (rows !== undefined) {
    return { kind: HISTORY_READ.READY, revisions: rows.revisions, earlier: rows.earlier };
  }
  return failed ? { kind: HISTORY_READ.FAILED } : undefined;
}

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

export function useDescriptionHistory(input: {
  source: DescriptionHistorySource;
  taskId: string | undefined;
  history: HeldHistory;
  editedAt: number | undefined;
  name: string | undefined;
  shown: boolean;
  seek: number | undefined;
  returnTo: HistorySpot | undefined;
  onRestored: (undo: (() => Promise<Kept>) | undefined) => void;
}): DescriptionHistoryControl {
  const { source, taskId, history, editedAt, name, shown, seek, returnTo, onRestored } = input;
  const [version, setVersion] = useState<HeldVersion | undefined>(undefined);
  const latest = useRef(source);
  latest.current = source;
  const reading = shown && taskId !== undefined;

  const chosen = reading && version?.taskId === taskId ? version : undefined;
  if (version !== undefined && chosen === undefined) setVersion(undefined);
  const heldRows = reading ? history.rows : undefined;
  const heldFailed = reading && history.failed;
  const held = useMemo(() => listOf(heldRows, heldFailed), [heldRows, heldFailed]);
  const revisions = held?.kind === HISTORY_READ.READY ? held.revisions : [];
  const newest = revisions[0]?.seq;
  if (reading && taskId !== undefined && chosen === undefined) {
    setVersion(openedOn(taskId, seek, returnTo));
  }
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
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[1] === taskId && previousQuery?.queryKey[2] === seq
        ? previous
        : undefined,
  });
  const read = versionRead(versionQuery);
  const readAgain = versionQuery.refetch;

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
  const onRetryVersion = useCallback(() => void readAgain(), [readAgain]);
  useRegained(() => {
    if (chosen === undefined) return;
    if (read.kind === HISTORY_READ.FAILED || read.kind === HISTORY_READ.READING) onRetryVersion();
  });
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

  const onLoadEarlier = async (): Promise<boolean> => {
    if (taskId === undefined || held?.kind !== HISTORY_READ.READY || held.earlier === undefined) {
      return false;
    }
    const answer = await source.readPage(taskId, held.earlier).catch(() => undefined);
    return answer !== undefined && !("failure" in answer);
  };

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

  const opened = chosen?.opened?.seq === seq ? chosen?.opened : undefined;
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
