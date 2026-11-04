import {
  AUTOMATION_CALL_FAILURE,
  type AutomationCallFailure,
  type AutomationChangeParams,
  type AutomationCreateParams,
  type AutomationDeletedView,
  type AutomationView,
} from "@repo/features/automation-view";
import type { AutomationSummary } from "@repo/features/automation-wire";
import { LIVE_READ } from "@repo/features/live-wire";
import { ACT_KIND } from "@repo/host/acts";
import { useCallback, useMemo } from "react";
import { unreachedAs, useAct } from "../act.js";
import { HOST_READ_STATUS, useHostRead } from "../use-host-read.js";

/**
 * use-automations.ts -- the Automations pages' list: one workspace's automations, held while a page stands, and the writes that make, change, and delete one.
 *
 * The list is a read the host holds while a page holds it and a while
 * after (`useHostRead`), so a schedule's next run, a run's agent, and what
 * changed elsewhere reach it without a press or a clock here, and a page
 * drawn again draws it at once. A write is drawn on the list the host
 * holds (`@repo/host`'s `automation-collections.ts`), a change or a
 * deletion the moment it is asked and a new automation once the service
 * made it, and laid before the write answers, so nothing here holds a
 * write's answer over the list. A read that fails once it has answered
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

/** One workspace's automations, none held while no workspace is listed, with the writes that make, change, and delete one. */
export function useAutomations(workspaceId: string | undefined) {
  const { act } = useAct();
  const held = useHostRead(LIVE_READ.AUTOMATIONS, workspaceId);
  // Note that the read keeps one identity while its rows do, so a page memoized on it draws again only as they move.
  const rows = held.rows;
  const read = useMemo<AutomationsRead>(() => {
    if (workspaceId === undefined) return undefined;
    if (rows !== undefined) return { automations: rows };
    return held.status === HOST_READ_STATUS.FAILED ? UNANSWERED : undefined;
  }, [workspaceId, rows, held.status]);
  const create = useCallback(
    (params: AutomationCreateParams): Promise<AutomationView> =>
      act(ACT_KIND.AUTOMATIONS_CREATE, params).catch(unreached),
    [act],
  );
  const change = useCallback(
    (params: AutomationChangeParams): Promise<AutomationView> =>
      act(ACT_KIND.AUTOMATIONS_CHANGE, params).catch(unreached),
    [act],
  );
  /** One automation turned on or off, and why where the service refused it. */
  const toggle = useCallback(
    (automationId: string, enabled: boolean) => change({ automationId, change: { enabled } }),
    [change],
  );
  const remove = useCallback(
    (automationId: string): Promise<AutomationDeletedView> =>
      act(ACT_KIND.AUTOMATIONS_DELETE, { automationId }).catch(unreached),
    [act],
  );
  /** A webhook's new secret, answered once for the asking page to show; the list keeps the automation alone. */
  const newWebhookSecret = useCallback(
    (automationId: string): Promise<AutomationView> =>
      act(ACT_KIND.AUTOMATIONS_NEW_WEBHOOK_SECRET, { automationId }).catch(unreached),
    [act],
  );
  return { read, reload: held.retry, create, change, toggle, remove, newWebhookSecret };
}
