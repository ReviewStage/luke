import {
  AUTOMATION_CALL_FAILURE,
  AUTOMATION_FOLLOW,
  type AutomationFollow,
  type AutomationRunView,
} from "@repo/features/automation-view";
import type { AutomationRunSummary, AutomationWorkspaceRun } from "@repo/features/automation-wire";
import { ACT_KIND } from "@repo/host/acts";
import { type UseQueryResult, useMutation, useQuery } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { actMutation } from "../act-mutations.js";
import {
  automationRunsQuery,
  automationsRetryMutation,
  automationWorkspaceRunsQuery,
} from "../live-reads.js";

export type RunsRead =
  | { readonly runs: readonly AutomationRunSummary[] }
  | { readonly failed: true }
  | undefined;

const RUNS_FAILED = { failed: true } as const;

const UNANSWERED = { failure: AUTOMATION_CALL_FAILURE.UNANSWERED } as const;

function useRunsRead<Run>(
  kind: AutomationFollow["kind"],
  id: string | undefined,
  held: UseQueryResult<readonly Run[]>,
) {
  const { mutateAsync: retry } = useMutation(automationsRetryMutation());
  const rows = held.data;
  const failed = held.isError;
  const read = useMemo((): { readonly runs: readonly Run[] } | typeof RUNS_FAILED | undefined => {
    if (id === undefined) return undefined;
    if (rows !== undefined) return { runs: rows };
    return failed ? RUNS_FAILED : undefined;
  }, [id, rows, failed]);
  const reload = useCallback(
    (): Promise<void> =>
      id === undefined
        ? Promise.resolve()
        : retry({ kind, id }).then(
            () => undefined,
            () => undefined,
          ),
    [retry, kind, id],
  );
  return { read, reload };
}

export function useAutomationRuns(automationId: string | undefined) {
  const { mutateAsync: runAutomation } = useMutation(actMutation(ACT_KIND.AUTOMATIONS_RUN));
  const { read, reload } = useRunsRead(
    AUTOMATION_FOLLOW.RUNS,
    automationId,
    useQuery(automationRunsQuery(automationId)),
  );
  const runNow = useCallback((): Promise<AutomationRunView> => {
    if (automationId === undefined) return Promise.resolve(UNANSWERED);
    return runAutomation({
      automationId,
      idempotencyKey: crypto.randomUUID(),
    }).catch((): AutomationRunView => UNANSWERED);
  }, [runAutomation, automationId]);
  return { read: read satisfies RunsRead, reload, runNow };
}

export type WorkspaceRunsRead =
  | { readonly runs: readonly AutomationWorkspaceRun[] }
  | { readonly failed: true }
  | undefined;

export function useWorkspaceRuns(workspaceId: string | undefined) {
  const { read, reload } = useRunsRead(
    AUTOMATION_FOLLOW.WORKSPACE_RUNS,
    workspaceId,
    useQuery(automationWorkspaceRunsQuery(workspaceId)),
  );
  return { read: read satisfies WorkspaceRunsRead, reload };
}
