import { AUTOMATION_CALL_FAILURE, type AutomationRunView } from "@luke/features/automation-view";
import type { AutomationRunSummary } from "@luke/features/automation-wire";
import { ACT_KIND } from "@luke/host/acts";
import { useCallback, useState } from "react";
import { useAct } from "../act.js";
import { useFollowedRuns } from "./use-followed-automations.js";

/**
 * use-automation-runs.ts -- one automation's runs as its page's panel draws them, pushed while the page stands, and its Run now.
 *
 * The runs are followed while the page stands (`use-followed-automations.ts`),
 * so a run's agent moving on, and the run a Run now made, reach it without a
 * clock here or a read after the press. A push that fails keeps the runs it
 * would have replaced, as the list does, and only a failure with nothing
 * held yet is said as one.
 */

/** The runs as the panel draws them: read, failed, or not yet read. */
export type RunsRead =
  | { readonly runs: readonly AutomationRunSummary[] }
  | { readonly failed: true }
  | undefined;

const RUNS_FAILED = { failed: true } as const;

const UNANSWERED = { failure: AUTOMATION_CALL_FAILURE.UNANSWERED } as const;

/** One automation's runs, none asked for before it exists, with its Run now. */
export function useAutomationRuns(automationId: string | undefined) {
  const { act } = useAct();
  const [held, setHeld] = useState<{ automationId: string; read: RunsRead } | undefined>(undefined);
  const reload = useFollowedRuns(automationId, (answer) => {
    if (automationId === undefined) return;
    const read: RunsRead = "failure" in answer ? RUNS_FAILED : { runs: answer.runs };
    setHeld((was) =>
      "failed" in read &&
      was?.automationId === automationId &&
      was.read !== undefined &&
      "runs" in was.read
        ? was
        : { automationId, read },
    );
  });
  /** Runs it now under a key of the press's own; the run it made is pushed as it lands. */
  const runNow = useCallback((): Promise<AutomationRunView> => {
    if (automationId === undefined) return Promise.resolve(UNANSWERED);
    return act(ACT_KIND.AUTOMATIONS_RUN, {
      automationId,
      idempotencyKey: crypto.randomUUID(),
    }).catch((): AutomationRunView => UNANSWERED);
  }, [act, automationId]);
  const read = held?.automationId === automationId ? held?.read : undefined;
  return { read, reload, runNow };
}
