import {
  AUTOMATION_CALL_FAILURE,
  AUTOMATION_FOLLOW,
  type AutomationCallFailure,
  type AutomationChangeParams,
  type AutomationCreateParams,
  type AutomationDeletedView,
  type AutomationView,
} from "@repo/features/automation-view";
import type { AutomationSummary } from "@repo/features/automation-wire";
import { ACT_KIND } from "@repo/host/acts";
import { mutationOptions, useMutation, useQuery } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { sendAct, unreachedAs } from "../act.js";
import { actMutation } from "../act-mutations.js";
import { automationsQuery, automationsRetryMutation } from "../live-reads.js";

type AutomationsRead =
  | { readonly automations: readonly AutomationSummary[] }
  | { readonly failure: AutomationCallFailure }
  | undefined;

const unreached = unreachedAs(AUTOMATION_CALL_FAILURE.UNANSWERED);

const UNANSWERED = { failure: AUTOMATION_CALL_FAILURE.UNANSWERED } as const;

export const AUTOMATION_DELETE_MUTATION = mutationOptions({
  mutationKey: [ACT_KIND.AUTOMATIONS_DELETE],
  mutationFn: (automationId: string): Promise<AutomationDeletedView> =>
    sendAct(ACT_KIND.AUTOMATIONS_DELETE, { automationId }).catch(unreached),
});

export const WEBHOOK_SECRET_MUTATION = mutationOptions({
  mutationKey: [ACT_KIND.AUTOMATIONS_NEW_WEBHOOK_SECRET],
  mutationFn: (automationId: string): Promise<AutomationView> =>
    sendAct(ACT_KIND.AUTOMATIONS_NEW_WEBHOOK_SECRET, { automationId }).catch(unreached),
});

export function useAutomations(workspaceId: string | undefined) {
  const { mutateAsync: sendCreate } = useMutation(actMutation(ACT_KIND.AUTOMATIONS_CREATE));
  const { mutateAsync: sendChange } = useMutation(actMutation(ACT_KIND.AUTOMATIONS_CHANGE));
  const held = useQuery(automationsQuery(workspaceId));
  const { mutateAsync: retry } = useMutation(automationsRetryMutation());
  const rows = held.data;
  const failed = held.isError;
  const read = useMemo<AutomationsRead>(() => {
    if (workspaceId === undefined) return undefined;
    if (rows !== undefined) return { automations: rows };
    return failed ? UNANSWERED : undefined;
  }, [workspaceId, rows, failed]);
  const reload = useCallback(
    (): Promise<void> =>
      workspaceId === undefined
        ? Promise.resolve()
        : retry({ kind: AUTOMATION_FOLLOW.WORKSPACE, id: workspaceId }).then(
            () => undefined,
            () => undefined,
          ),
    [retry, workspaceId],
  );
  const create = useCallback(
    (params: AutomationCreateParams): Promise<AutomationView> =>
      sendCreate(params).catch(unreached),
    [sendCreate],
  );
  const change = useCallback(
    (params: AutomationChangeParams): Promise<AutomationView> =>
      sendChange(params).catch(unreached),
    [sendChange],
  );
  const toggle = useCallback(
    (automationId: string, enabled: boolean) => change({ automationId, change: { enabled } }),
    [change],
  );
  return { read, reload, create, change, toggle };
}
