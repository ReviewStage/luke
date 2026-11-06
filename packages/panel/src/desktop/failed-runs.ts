import type { AccountFailedRun } from "@repo/features/account-inbox-wire";
import { Schema } from "effect";
import { useEffect, useState } from "react";
import { readKept, writeKept } from "../kept-storage.js";

const STORAGE_KEY = "app.seenFailedRuns";

const storedSeen = Schema.fromJsonString(Schema.Record(Schema.String, Schema.String));

type Seen = Readonly<Record<string, string>>;

export function useFailedRunsMark(
  failedRuns: readonly AccountFailedRun[],
  workspaceId: string | undefined,
  opened: string | undefined,
  staged: boolean,
): boolean {
  const [seen, setSeen] = useState<Seen>(() =>
    staged ? {} : readKept(STORAGE_KEY, storedSeen, {}),
  );
  const listed = failedRuns.filter(
    (run) => workspaceId === undefined || run.workspaceId === workspaceId,
  );
  const openedRun = listed.find((run) => run.automationId === opened);
  useEffect(() => {
    if (openedRun === undefined || seen[openedRun.automationId] === openedRun.id) return;
    const next = Object.fromEntries(
      failedRuns.flatMap((run) => {
        const runId = run.automationId === openedRun.automationId ? run.id : seen[run.automationId];
        return runId === undefined ? [] : [[run.automationId, runId]];
      }),
    );
    setSeen(next);
    if (!staged) writeKept(STORAGE_KEY, storedSeen, next);
  }, [openedRun, failedRuns, seen, staged]);
  return listed.some((run) => run.automationId !== opened && seen[run.automationId] !== run.id);
}
