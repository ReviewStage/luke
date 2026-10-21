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
import { useCallback, useRef, useState } from "react";
import { useAct } from "../act.js";
import { useFollowedAutomations } from "./use-followed-automations.js";

/**
 * use-automations.ts -- the Automations pages' list: one workspace's automations, pushed while a page stands, and the writes that make, change, and delete one.
 *
 * Nothing is held past the pages. The list is followed while they stand
 * (`use-followed-automations.ts`), so a schedule's next run, a run's agent,
 * and what changed elsewhere reach it without a press or a clock here. A
 * write answers the automation as the service then holds it, which takes
 * its place in the list at once, a new one first, where it is the newest
 * write of that automation, and a deletion takes its row away, until the
 * list pushed next stands in for it. A push that fails keeps the list it
 * would have replaced, so nothing drawn from it is taken down. A failure is kept to be said rather
 * than thrown, since every caller does the same with one: says it, and
 * offers to try again.
 */

/** The list as the pages draw it: read, failed, or not yet read. */
export type AutomationsRead =
  | { readonly automations: readonly AutomationSummary[] }
  | { readonly failure: AutomationCallFailure }
  | undefined;

const UNANSWERED = { failure: AUTOMATION_CALL_FAILURE.UNANSWERED } as const;

/** One automation put in the place of the one it replaces, or first where it is new, the rest as they stood. */
function replaced(read: AutomationsRead, automation: AutomationSummary): AutomationsRead {
  if (read === undefined || "failure" in read) return read;
  const known = read.automations.some((each) => each.id === automation.id);
  return {
    automations: known
      ? read.automations.map((each) => (each.id === automation.id ? automation : each))
      : [automation, ...read.automations],
  };
}

/** The list with one automation taken away. */
function without(read: AutomationsRead, automationId: string): AutomationsRead {
  if (read === undefined || "failure" in read) return read;
  return { automations: read.automations.filter((each) => each.id !== automationId) };
}

/** A read held with the workspace it is of, so another workspace's list is never drawn as this one's. */
interface HeldRead {
  readonly workspaceId: string;
  readonly read: AutomationsRead;
}

/** One workspace's automations, none asked for while no workspace is listed, with the writes that make, change, and delete one. */
export function useAutomations(workspaceId: string | undefined) {
  const { act } = useAct();
  const [held, setHeld] = useState<HeldRead | undefined>(undefined);
  // Note that each automation's newest write is counted, so an answer to an
  // older write that lands after a newer one's draws nothing over it.
  const writes = useRef(0);
  const newestWrite = useRef(new Map<string, number>()).current;
  // Note that a push that fails keeps the list it would have replaced, so a
  // page drawn from it, an editor's draft among them, stands; only a failure
  // with nothing held yet is said as one.
  // Note that every list pushed is counted, so a write's answer that lands after a push it was
  // sent before draws nothing over it: that push may hold a newer write of another window's, and
  // the write's own commit is pushed after it in any case.
  const pushes = useRef(0);
  const reload = useFollowedAutomations(workspaceId, (read) => {
    if (workspaceId === undefined) return;
    if (!("failure" in read)) pushes.current += 1;
    setHeld((was) =>
      "failure" in read &&
      was?.workspaceId === workspaceId &&
      was.read !== undefined &&
      "automations" in was.read
        ? was
        : { workspaceId, read },
    );
  });
  /**
   * One write out: counted as its automation's newest, a new one's under
   * no automation yet, and its answer handed to `land` only while it still
   * is and no list was pushed since it was sent.
   */
  const written = useCallback(
    <Answer>(
      automationId: string | undefined,
      asked: Promise<Answer>,
      refused: Answer,
      land: (answer: Answer) => void,
    ): Promise<Answer> => {
      writes.current += 1;
      const count = writes.current;
      if (automationId !== undefined) newestWrite.set(automationId, count);
      const pushedBefore = pushes.current;
      const settled = (answer: Answer): Answer => {
        const newest = automationId === undefined || newestWrite.get(automationId) === count;
        if (newest && pushes.current === pushedBefore) land(answer);
        return answer;
      };
      return asked.then(settled, () => settled(refused));
    },
    [newestWrite],
  );
  /** A write's answer taken into the list of the workspace it is of, in its place, and into no other's. */
  const landAutomation = useCallback((answer: AutomationView) => {
    if (!("automation" in answer)) return;
    const { automation } = answer;
    setHeld((was) =>
      was !== undefined && was.workspaceId === automation.workspaceId
        ? { ...was, read: replaced(was.read, automation) }
        : was,
    );
  }, []);
  const create = useCallback(
    (params: AutomationCreateParams) =>
      written<AutomationView>(
        undefined,
        act(ACT_KIND.AUTOMATIONS_CREATE, params),
        UNANSWERED,
        landAutomation,
      ),
    [act, written, landAutomation],
  );
  const change = useCallback(
    (params: AutomationChangeParams) =>
      written<AutomationView>(
        params.automationId,
        act(ACT_KIND.AUTOMATIONS_CHANGE, params),
        UNANSWERED,
        landAutomation,
      ),
    [act, written, landAutomation],
  );
  /** One automation turned on or off: the list takes the service's answer in its place, and why where it refused. */
  const toggle = useCallback(
    (automationId: string, enabled: boolean) => change({ automationId, change: { enabled } }),
    [change],
  );
  const remove = useCallback(
    (automationId: string) =>
      written<AutomationDeletedView>(
        automationId,
        act(ACT_KIND.AUTOMATIONS_DELETE, { automationId }),
        UNANSWERED,
        (answer) => {
          if ("deleted" in answer) {
            setHeld((was) => was && { ...was, read: without(was.read, automationId) });
          }
        },
      ),
    [act, written],
  );
  /** A webhook's new secret, answered once for the asking page to show; the list keeps the automation alone. */
  const newWebhookSecret = useCallback(
    (automationId: string) =>
      written<AutomationView>(
        automationId,
        act(ACT_KIND.AUTOMATIONS_NEW_WEBHOOK_SECRET, { automationId }),
        UNANSWERED,
        landAutomation,
      ),
    [act, written, landAutomation],
  );
  const read = held?.workspaceId === workspaceId ? held?.read : undefined;
  return { read, reload, create, change, toggle, remove, newWebhookSecret };
}
