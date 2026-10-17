import {
  AUTOMATION_CALL_FAILURE,
  AUTOMATION_FOLLOW,
  type AutomationRunView,
} from "@luke/features/automation-view";
import type { AutomationRunSummary } from "@luke/features/automation-wire";
import { ACT_KIND } from "@luke/host/acts";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAct } from "../act";
import { useFollowedAutomations } from "./use-followed-automations";

/**
 * use-automation-runs.ts -- one automation's runs as its page's panel draws them, read when the page opens and followed while it stands, and its Run now.
 *
 * A run's agent moves on while the page stands, so the runs are followed
 * (`use-followed-automations.ts`): the host pushes them each time they
 * move, and nothing is read on a clock here. They are read again once a Run
 * now settles, so the run it made stands first at once. A read that fails keeps the runs it would have replaced,
 * as the list does, and only a first read that fails is said as one.
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
  // Note that only the newest read is taken, so one asked before a Run now answers nothing over what came after it.
  const generation = useRef(0);
  const reload = useCallback(() => {
    generation.current += 1;
    if (automationId === undefined) return;
    const asked = generation.current;
    const taken = (read: RunsRead) => {
      if (asked !== generation.current) return;
      setHeld((was) =>
        read !== undefined &&
        "failed" in read &&
        was?.automationId === automationId &&
        was.read !== undefined &&
        "runs" in was.read
          ? was
          : { automationId, read },
      );
    };
    act(ACT_KIND.AUTOMATIONS_RUNS, { automationId }).then(
      (answer) => taken("failure" in answer ? RUNS_FAILED : { runs: answer.runs }),
      () => taken(RUNS_FAILED),
    );
  }, [act, automationId]);
  useEffect(() => {
    reload();
  }, [reload]);
  // Note that runs the host pushed are the newest word of them, so they are taken whatever read is out.
  useFollowedAutomations(
    automationId === undefined ? undefined : { kind: AUTOMATION_FOLLOW.RUNS, id: automationId },
    (changed) => {
      const { view } = changed;
      if (changed.scope.kind !== AUTOMATION_FOLLOW.RUNS || "automations" in view) return;
      const followed = changed.scope.id;
      setHeld((was) =>
        "failure" in view &&
        was?.automationId === followed &&
        was.read !== undefined &&
        "runs" in was.read
          ? was
          : { automationId: followed, read: "failure" in view ? RUNS_FAILED : { runs: view.runs } },
      );
    },
  );
  /** Runs it now under a key of the press's own, and reads the runs again once it settles. */
  const runNow = useCallback((): Promise<AutomationRunView> => {
    if (automationId === undefined) return Promise.resolve(UNANSWERED);
    return act(ACT_KIND.AUTOMATIONS_RUN, { automationId, idempotencyKey: crypto.randomUUID() })
      .catch((): AutomationRunView => UNANSWERED)
      .then((answer) => {
        reload();
        return answer;
      });
  }, [act, automationId, reload]);
  const read = held?.automationId === automationId ? held?.read : undefined;
  return { read, reload, runNow };
}
