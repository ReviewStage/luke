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

/**
 * use-automations.ts -- the Automations pages' list: one workspace's automations, held while a page stands, and the writes that make, change, and delete one.
 *
 * The list is a read the host holds while a page holds it and a while
 * after (`automationsQuery`), so a schedule's next run, a run's agent, and what
 * changed elsewhere reach it without a press or a clock here, and a page
 * drawn again draws it at once. A write is drawn on the list the host
 * holds (`@repo/host`'s `automation-collections.ts`), a new automation, a
 * change, or a deletion the moment it is asked, and laid before the write
 * answers, so nothing here holds a write's answer over the list. A read that fails once it has answered
 * keeps the list it held, as every held read does, so nothing drawn from
 * it is taken down. A failure is kept to be said rather than thrown, since
 * every caller does the same with one: says it, and offers to try again.
 */

/** The list as the pages draw it: read, failed, or not yet read. */
type AutomationsRead =
  | { readonly automations: readonly AutomationSummary[] }
  | { readonly failure: AutomationCallFailure }
  | undefined;

const unreached = unreachedAs(AUTOMATION_CALL_FAILURE.UNANSWERED);

const UNANSWERED = { failure: AUTOMATION_CALL_FAILURE.UNANSWERED } as const;

/** One automation deleted, as the question asking it holds its own mutation over it, and why where the service refused it. */
export const AUTOMATION_DELETE_MUTATION = mutationOptions({
  mutationKey: [ACT_KIND.AUTOMATIONS_DELETE],
  mutationFn: (automationId: string): Promise<AutomationDeletedView> =>
    sendAct(ACT_KIND.AUTOMATIONS_DELETE, { automationId }).catch(unreached),
});

/** A webhook's new secret, as the question asking it holds its own mutation over it, answered once for the asking page to show; the list keeps the automation alone. */
export const WEBHOOK_SECRET_MUTATION = mutationOptions({
  mutationKey: [ACT_KIND.AUTOMATIONS_NEW_WEBHOOK_SECRET],
  mutationFn: (automationId: string): Promise<AutomationView> =>
    sendAct(ACT_KIND.AUTOMATIONS_NEW_WEBHOOK_SECRET, { automationId }).catch(unreached),
});

/** One workspace's automations, none held while no workspace is listed, with the writes that make and change one. */
export function useAutomations(workspaceId: string | undefined) {
  const { mutateAsync: sendCreate } = useMutation(actMutation(ACT_KIND.AUTOMATIONS_CREATE));
  const { mutateAsync: sendChange } = useMutation(actMutation(ACT_KIND.AUTOMATIONS_CHANGE));
  const held = useQuery(automationsQuery(workspaceId));
  const { mutateAsync: retry } = useMutation(automationsRetryMutation());
  // Note that the read keeps one identity while its rows do, so a page memoized on it draws again only as they move.
  const rows = held.data;
  const failed = held.isError;
  const read = useMemo<AutomationsRead>(() => {
    if (workspaceId === undefined) return undefined;
    if (rows !== undefined) return { automations: rows };
    return failed ? UNANSWERED : undefined;
  }, [workspaceId, rows, failed]);
  // Note that a Try again the port refuses settles as one that landed, since the read's own failure is what the pages draw.
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
  /** One automation turned on or off, and why where the service refused it. */
  const toggle = useCallback(
    (automationId: string, enabled: boolean) => change({ automationId, change: { enabled } }),
    [change],
  );
  return { read, reload, create, change, toggle };
}
