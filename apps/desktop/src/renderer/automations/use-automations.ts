import {
  AUTOMATION_CALL_FAILURE,
  type AutomationCallFailure,
  type AutomationChangeParams,
  type AutomationCreateParams,
} from "@sidecar/hosted/automation-view";
import type { AutomationRunSummary, AutomationSummary } from "@sidecar/hosted/automation-wire";
import { useCallback, useEffect, useRef, useState } from "react";
import { ACT_KIND } from "#shared/messages/acts";
import { useAct } from "../act";
import { useMinute } from "../planning/plan-time";

/**
 * use-automations.ts -- the Automations page's reads and writes: the account's automations, the chosen one's runs, and each write the page makes, every answer taken in place.
 *
 * Nothing is held past the page. The list is read when the page opens and
 * again each minute while it stands, so a schedule's next run and a run's
 * agent move on without a press; the chosen automation's runs are read the
 * same way. A write answers the automation as the service then holds it,
 * which takes its place in the list at once, and a "Run now" reads the runs
 * again. A failure is kept to be said rather than thrown, since every caller
 * does the same with one: says it, and offers to try again.
 */

/** The list as the page draws it: read, failed, or not yet read. */
export type AutomationsRead =
  | { readonly automations: readonly AutomationSummary[] }
  | { readonly failure: AutomationCallFailure }
  | undefined;

/** One automation's runs as the page draws them. */
export type RunsRead =
  | { readonly runs: readonly AutomationRunSummary[] }
  | { readonly failure: AutomationCallFailure }
  | undefined;

/** What a write came to: the automation as kept, or why not. */
export type AutomationWrite =
  | { readonly automation: AutomationSummary }
  | { readonly failure: AutomationCallFailure };

const UNANSWERED = { failure: AUTOMATION_CALL_FAILURE.UNANSWERED } as const;

/** The list of automations, one plan's where the page was opened from it, with the writes that change it. */
export function useAutomations(plan: string | undefined) {
  const { act } = useAct();
  const now = useMinute();
  const [read, setRead] = useState<AutomationsRead>(undefined);
  // Note that every read and every write moves the generation on, so only
  // the newest read is taken: one asked before a write, or for another plan,
  // answers nothing over what came after it.
  const generation = useRef(0);
  const reload = useCallback(() => {
    generation.current += 1;
    const asked = generation.current;
    const taken = (answer: AutomationsRead) => {
      if (asked === generation.current) setRead(answer);
    };
    return act(ACT_KIND.AUTOMATIONS_LIST, plan === undefined ? {} : { planId: plan }).then(
      taken,
      () => taken(UNANSWERED),
    );
  }, [act, plan]);
  // Note that the minute is read so the list is read again each minute the page stands.
  useEffect(() => {
    void now;
    void reload();
  }, [reload, now]);
  // Another plan's list is not this one's, so a new filter starts unread.
  useEffect(() => {
    void plan;
    setRead(undefined);
  }, [plan]);
  /**
   * One automation taken into the list as the service answered it, first
   * where it is new, and the list read again: the read a write overtook is
   * no longer taken, so this one brings back whatever it would have.
   */
  const take = useCallback(
    (automation: AutomationSummary) => {
      setRead((held) => {
        if (held === undefined || "failure" in held) return held;
        const known = held.automations.some((each) => each.id === automation.id);
        return {
          automations: known
            ? held.automations.map((each) => (each.id === automation.id ? automation : each))
            : [automation, ...held.automations],
        };
      });
      void reload();
    },
    [reload],
  );
  const written = useCallback(
    (answer: AutomationWrite): AutomationWrite => {
      if ("automation" in answer) take(answer.automation);
      return answer;
    },
    [take],
  );
  const create = useCallback(
    (params: AutomationCreateParams) =>
      act(ACT_KIND.AUTOMATIONS_CREATE, params).then(written, (): AutomationWrite => UNANSWERED),
    [act, written],
  );
  const change = useCallback(
    (params: AutomationChangeParams) =>
      act(ACT_KIND.AUTOMATIONS_CHANGE, params).then(written, (): AutomationWrite => UNANSWERED),
    [act, written],
  );
  const rotate = useCallback(
    (automationId: string, webhookSecret: string) =>
      act(ACT_KIND.AUTOMATIONS_WEBHOOK_SECRET, { automationId, webhookSecret }).then(
        written,
        (): AutomationWrite => UNANSWERED,
      ),
    [act, written],
  );
  const remove = useCallback(
    (automationId: string) =>
      act(ACT_KIND.AUTOMATIONS_DELETE, { automationId }).then(
        (answer) => {
          if ("deleted" in answer) {
            setRead((held) =>
              held === undefined || "failure" in held
                ? held
                : { automations: held.automations.filter((each) => each.id !== automationId) },
            );
            void reload();
          }
          return answer;
        },
        () => UNANSWERED,
      ),
    [act, reload],
  );
  return { read, reload, create, change, rotate, remove };
}

/** One automation's runs, read when it is chosen and each minute after, and a "Run now" that reads them again. */
export function useAutomationRuns(automationId: string | undefined) {
  const { act } = useAct();
  const now = useMinute();
  const [read, setRead] = useState<RunsRead>(undefined);
  // The automation shown now, so a read of the one before that answers late is not taken as this one's.
  const shown = useRef(automationId);
  shown.current = automationId;
  const reload = useCallback(() => {
    if (automationId === undefined) return Promise.resolve();
    const taken = (answer: RunsRead) => {
      if (shown.current === automationId) setRead(answer);
    };
    return act(ACT_KIND.AUTOMATIONS_RUNS, { automationId }).then(taken, () => taken(UNANSWERED));
  }, [act, automationId]);
  useEffect(() => {
    void now;
    void reload();
  }, [reload, now]);
  // A run of another automation's is not this one's, so a new choice starts unread.
  useEffect(() => {
    void automationId;
    setRead(undefined);
  }, [automationId]);
  const runNow = useCallback(() => {
    if (automationId === undefined) return Promise.resolve(UNANSWERED);
    return act(ACT_KIND.AUTOMATIONS_RUN, {
      automationId,
      idempotencyKey: crypto.randomUUID(),
    }).then(
      (answer) => {
        void reload();
        return answer;
      },
      () => UNANSWERED,
    );
  }, [act, automationId, reload]);
  return { read, reload, runNow };
}
