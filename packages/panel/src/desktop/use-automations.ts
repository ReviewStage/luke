import {
  AUTOMATION_CALL_FAILURE,
  type AutomationCallFailure,
  type AutomationChangeParams,
  type AutomationCreateParams,
  type AutomationDeletedView,
  type AutomationView,
} from "@luke/features/automation-view";
import type { AutomationSummary } from "@luke/features/automation-wire";
import { ACT_KIND } from "@luke/host/acts";
import { useCallback, useState } from "react";
import { unreachedAs, useAct } from "../act.js";
import { useFollowedAutomations } from "./use-followed-automations.js";

/**
 * use-automations.ts -- the Automations pages' list: one workspace's automations, pushed while a page stands, and the writes that make, change, and delete one.
 *
 * Nothing is held past the pages. The list is followed while they stand
 * (`use-followed-automations.ts`), so a schedule's next run, a run's agent,
 * and what changed elsewhere reach it without a press or a clock here. A
 * write is drawn on the list the host pushes (`@luke/host`'s
 * `automation-collections.ts`), a change or a deletion the moment it is
 * asked and a new automation once the service made it, and pushed before
 * the write answers, so nothing here holds a write's answer over the list.
 * A push that fails keeps the list it would have replaced, so nothing drawn
 * from it is taken down, and is told as `refreshFailed` until a push lands.
 * A failure is kept to be said rather than thrown, since every caller does
 * the same with one: says it, and offers to try again.
 */

/** The list as the pages draw it: read, failed, or not yet read. */
type AutomationsRead =
  | { readonly automations: readonly AutomationSummary[] }
  | { readonly failure: AutomationCallFailure }
  | undefined;

const unreached = unreachedAs(AUTOMATION_CALL_FAILURE.UNANSWERED);

/** A read held with the workspace it is of, so another workspace's list is never drawn as this one's, and whether the push after it failed. */
interface HeldRead {
  readonly workspaceId: string;
  readonly read: AutomationsRead;
  readonly refreshFailed: boolean;
}

/** One workspace's automations, none asked for while no workspace is listed, with the writes that make, change, and delete one. */
export function useAutomations(workspaceId: string | undefined) {
  const { act } = useAct();
  const [held, setHeld] = useState<HeldRead | undefined>(undefined);
  // Note that a push that fails keeps the list it would have replaced, so a
  // page drawn from it, an editor's draft among them, stands; the failure is
  // kept beside it as `refreshFailed`, which the list says, and only a failure
  // with nothing held yet is said as a read that failed.
  const reload = useFollowedAutomations(workspaceId, (read) => {
    if (workspaceId === undefined) return;
    setHeld((was) =>
      "failure" in read &&
      was?.workspaceId === workspaceId &&
      was.read !== undefined &&
      "automations" in was.read
        ? was.refreshFailed
          ? was
          : { ...was, refreshFailed: true }
        : { workspaceId, read, refreshFailed: false },
    );
  });
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
  const current = held?.workspaceId === workspaceId ? held : undefined;
  const read = current?.read;
  const refreshFailed = current?.refreshFailed === true;
  return { read, refreshFailed, reload, create, change, toggle, remove, newWebhookSecret };
}
