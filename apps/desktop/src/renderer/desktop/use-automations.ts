import {
  AUTOMATION_CALL_FAILURE,
  type AutomationCallFailure,
  type AutomationView,
} from "@luke/features/automation-view";
import type { AutomationSummary } from "@luke/features/automation-wire";
import { ACT_KIND } from "@luke/host/acts";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAct } from "../act";
import { useMinute } from "../planning/plan-time";

/**
 * use-automations.ts -- the Automations page's list: one workspace's automations, read when the page opens and each minute after, and the switch that turns one on or off.
 *
 * Nothing is held past the page. The list is read again each minute it
 * stands, so a schedule's next run and a run's agent move on without a
 * press. A switch's write answers the automation as the service then holds
 * it, which takes its place in the list at once where it is the newest
 * write of that automation, and the list is read again once it settles, so
 * what changed elsewhere while it was out is not lost to it. A failure is kept to be
 * said rather than thrown, since every caller does the same with one: says
 * it, and offers to try again.
 */

/** The list as the page draws it: read, failed, or not yet read. */
export type AutomationsRead =
  | { readonly automations: readonly AutomationSummary[] }
  | { readonly failure: AutomationCallFailure }
  | undefined;

const UNANSWERED = { failure: AUTOMATION_CALL_FAILURE.UNANSWERED } as const;

/** One automation put in the place of the one it replaces, the rest as they stood. */
function replaced(read: AutomationsRead, automation: AutomationSummary): AutomationsRead {
  if (read === undefined || "failure" in read) return read;
  return {
    automations: read.automations.map((each) => (each.id === automation.id ? automation : each)),
  };
}

/** A read held with the workspace it is of, so another workspace's list is never drawn as this one's. */
interface HeldRead {
  readonly workspaceId: string;
  readonly read: AutomationsRead;
}

/** One workspace's automations, none asked for while no workspace is listed, with the switch that turns one on or off. */
export function useAutomations(workspaceId: string | undefined) {
  const { act } = useAct();
  const now = useMinute();
  const [held, setHeld] = useState<HeldRead | undefined>(undefined);
  // Note that every read and every write moves the generation on, so only
  // the newest read is taken: one asked before a switch, or for another
  // workspace, answers nothing over what came after it.
  const generation = useRef(0);
  // Note that each automation's newest write is counted, so an answer to an
  // older write that lands after a newer one's draws nothing over it.
  const writes = useRef(0);
  const newestWrite = useRef(new Map<string, number>()).current;
  const reload = useCallback(() => {
    generation.current += 1;
    if (workspaceId === undefined) return;
    const asked = generation.current;
    const taken = (read: AutomationsRead) => {
      if (asked === generation.current) setHeld({ workspaceId, read });
    };
    act(ACT_KIND.AUTOMATIONS_LIST, { workspaceId }).then(taken, () => taken(UNANSWERED));
  }, [act, workspaceId]);
  // Note that the minute is read so the list is read again each minute the page stands.
  useEffect(() => {
    void now;
    reload();
  }, [reload, now]);
  /** One automation turned on or off: the list takes the service's answer in its place, and why where it refused. */
  const toggle = useCallback(
    (automationId: string, enabled: boolean): Promise<AutomationView> => {
      generation.current += 1;
      writes.current += 1;
      const written = writes.current;
      newestWrite.set(automationId, written);
      const settled = (answer: AutomationView): AutomationView => {
        if ("automation" in answer && newestWrite.get(automationId) === written) {
          const { automation } = answer;
          setHeld((was) => was && { ...was, read: replaced(was.read, automation) });
        }
        reload();
        return answer;
      };
      return act(ACT_KIND.AUTOMATIONS_CHANGE, { automationId, change: { enabled } }).then(
        settled,
        () => settled(UNANSWERED),
      );
    },
    [act, newestWrite, reload],
  );
  const read = held?.workspaceId === workspaceId ? held?.read : undefined;
  return { read, reload, toggle };
}
