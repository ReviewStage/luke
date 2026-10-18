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
import { useAct } from "@luke/panel/act";
import { useCallback, useEffect, useRef, useState } from "react";
import { useMinute } from "../tasks/task-time";

/**
 * use-automations.ts -- the Automations pages' list: one workspace's automations, read when a page opens and each minute after, and the writes that make, change, and delete one.
 *
 * Nothing is held past the pages. The list is read again each minute they
 * stand, so a schedule's next run and a run's agent move on without a
 * press. A write answers the automation as the service then holds it,
 * which takes its place in the list at once, a new one first, where it is
 * the newest write of that automation, and a deletion takes its row away;
 * the list is read again once any write settles, so what changed elsewhere
 * while it was out is not lost to it. A refresh that fails keeps the list
 * it would have replaced, so nothing drawn from it is taken down. A failure is kept to be said rather
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
  const now = useMinute();
  const [held, setHeld] = useState<HeldRead | undefined>(undefined);
  // Note that every read and every write moves the generation on, so only
  // the newest read is taken: one asked before a write, or for another
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
    // Note that a refresh that fails keeps the list it would have replaced,
    // so a page drawn from it, an editor's draft among them, stands; only a
    // first read that fails is said as one.
    const taken = (read: AutomationsRead) => {
      if (asked !== generation.current) return;
      setHeld((was) =>
        read !== undefined &&
        "failure" in read &&
        was?.workspaceId === workspaceId &&
        was.read !== undefined &&
        "automations" in was.read
          ? was
          : { workspaceId, read },
      );
    };
    act(ACT_KIND.AUTOMATIONS_LIST, { workspaceId }).then(taken, () => taken(UNANSWERED));
  }, [act, workspaceId]);
  // Note that a write settles by reading the workspace listed then, through
  // the newest reload, so one made before the window moved to another
  // workspace reads that one's list rather than the list it was made in.
  const reloadNow = useRef(reload);
  reloadNow.current = reload;
  // Note that the minute is read so the list is read again each minute the pages stand.
  useEffect(() => {
    void now;
    reload();
  }, [reload, now]);
  /**
   * One write out: counted as its automation's newest, a new one's under
   * no automation yet, its answer handed to `land` only while it still is,
   * and the list read again once it settles.
   */
  const written = useCallback(
    <Answer>(
      automationId: string | undefined,
      asked: Promise<Answer>,
      refused: Answer,
      land: (answer: Answer) => void,
    ): Promise<Answer> => {
      generation.current += 1;
      writes.current += 1;
      const count = writes.current;
      if (automationId !== undefined) newestWrite.set(automationId, count);
      const settled = (answer: Answer): Answer => {
        if (automationId === undefined || newestWrite.get(automationId) === count) land(answer);
        reloadNow.current();
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
