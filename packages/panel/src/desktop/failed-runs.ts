/**
 * failed-runs.ts -- tells the developer in the window that a run of their own automation failed to start: whether the sidebar's Automations wears the failed mark.
 *
 * The window says a failed run by this mark alone, the OS's notification
 * saying it too while the window is behind (`@luke/host/agent-notices`); the
 * mark goes on saying it until the automation is opened. Main hands the window the
 * newest failed run of each of the account's own automations
 * (`AppInboxSlice.failedRuns`), and opening an automation sees its failure,
 * kept in the renderer's own storage as the folds are, so the mark stays off
 * across launches until another run of it fails. A `staged` run keeps
 * nothing, so its frames never wear a developer's choices.
 */

import type { AccountFailedRun } from "@luke/features/account-inbox-wire";
import { Schema } from "effect";
import { useEffect, useState } from "react";
import { readKept, writeKept } from "../kept-storage.js";

/** Where the failures seen are kept in the renderer's storage. */
const STORAGE_KEY = "luke.seenFailedRuns";

/** The newest failed run seen of each automation, by the automation's id. */
const storedSeen = Schema.fromJsonString(Schema.Record(Schema.String, Schema.String));

type Seen = Readonly<Record<string, string>>;

/**
 * Whether a run of the account's own automation in the listed workspace
 * failed since that automation was last opened on this Mac, among
 * `failedRuns`, every workspace's. The automation `opened` sees its newest
 * failure as it opens. Note that a failure is told by its run's id rather
 * than its instant, because two runs may fail within one millisecond.
 */
export function useFailedRunsMark(
  failedRuns: readonly AccountFailedRun[],
  workspaceId: string | undefined,
  opened: string | undefined,
  staged: boolean,
): boolean {
  const [seen, setSeen] = useState<Seen>(() =>
    staged ? {} : readKept(STORAGE_KEY, storedSeen, {}),
  );
  // Note that only the listed workspace's runs are seen, because an editor left open across a switch shows no other's.
  const listed = failedRuns.filter(
    (run) => workspaceId === undefined || run.workspaceId === workspaceId,
  );
  const openedRun = listed.find((run) => run.automationId === opened);
  useEffect(() => {
    if (openedRun === undefined || seen[openedRun.automationId] === openedRun.id) return;
    // Note that only the automations still failing are kept, in every workspace, because one whose failures aged out of the read has nothing left to mark.
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
