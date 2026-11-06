import { AUTOMATION_CALL_FAILURE, type AutomationRunView } from "@repo/features/automation-view";
import type { AutomationRunSummary, AutomationWorkspaceRun } from "@repo/features/automation-wire";
import { LIVE_READ } from "@repo/features/live-wire";
import { ACT_KIND } from "@repo/host/acts";
import { useMutation } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { actMutation } from "../act-mutations.js";
import { HOST_READ_STATUS, type HostRead, useHostRead } from "../use-host-read.js";

/**
 * use-automation-runs.ts -- one automation's runs as its page's panel draws them, held while the page stands, and its Run now; and a workspace's runs as the Runs tab draws them.
 *
 * The runs are a read the host holds while a page holds it and a while
 * after (`useHostRead`), so a run's agent moving on, and the run a Run now
 * made, reach it without a clock here or a read after the press. A read
 * that fails once it has answered keeps the runs it held, as the list
 * does, and only a failure with nothing held yet is said as one.
 */

/** The runs as the panel draws them: read, failed, or not yet read. */
export type RunsRead =
  | { readonly runs: readonly AutomationRunSummary[] }
  | { readonly failed: true }
  | undefined;

const RUNS_FAILED = { failed: true } as const;

const UNANSWERED = { failure: AUTOMATION_CALL_FAILURE.UNANSWERED } as const;

/** A held read of runs as the panel draws them, none while it names nothing, with its Try again. */
function useRunsRead<Run>(id: string | undefined, held: HostRead<readonly Run[]>) {
  const rows = held.rows;
  const read = useMemo((): { readonly runs: readonly Run[] } | typeof RUNS_FAILED | undefined => {
    if (id === undefined) return undefined;
    if (rows !== undefined) return { runs: rows };
    return held.status === HOST_READ_STATUS.FAILED ? RUNS_FAILED : undefined;
  }, [id, rows, held.status]);
  return { read, reload: held.retry };
}

/** One automation's runs, none held before it exists, with its Run now. */
export function useAutomationRuns(automationId: string | undefined) {
  const { mutateAsync: runAutomation } = useMutation(actMutation(ACT_KIND.AUTOMATIONS_RUN));
  const { read, reload } = useRunsRead(
    automationId,
    useHostRead(LIVE_READ.AUTOMATION_RUNS, automationId),
  );
  /** Runs it now under a key of the press's own; the run it made is laid on the held runs as it lands. */
  const runNow = useCallback((): Promise<AutomationRunView> => {
    if (automationId === undefined) return Promise.resolve(UNANSWERED);
    return runAutomation({
      automationId,
      idempotencyKey: crypto.randomUUID(),
    }).catch((): AutomationRunView => UNANSWERED);
  }, [runAutomation, automationId]);
  return { read: read satisfies RunsRead, reload, runNow };
}

/** A workspace's runs as the Runs tab draws them: read, failed, or not yet read. */
export type WorkspaceRunsRead =
  | { readonly runs: readonly AutomationWorkspaceRun[] }
  | { readonly failed: true }
  | undefined;

/** Every run of a workspace's automations the account reads, held while the Runs tab stands, with Try again. */
export function useWorkspaceRuns(workspaceId: string | undefined) {
  const { read, reload } = useRunsRead(
    workspaceId,
    useHostRead(LIVE_READ.AUTOMATION_WORKSPACE_RUNS, workspaceId),
  );
  return { read: read satisfies WorkspaceRunsRead, reload };
}
