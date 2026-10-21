import {
  AUTOMATION_CALL_FAILURE,
  AUTOMATION_FOLLOW,
  type AutomationListView,
  type AutomationRunsView,
} from "@luke/features/automation-view";
import { ACT_KIND } from "@luke/host/acts";
import { useCallback, useEffect, useRef, useState } from "react";
import { askAct } from "../act.js";

/**
 * use-followed-automations.ts -- a workspace's automations, or an automation's runs, pushed to the page that draws them while it stands.
 *
 * The page holds its stream open on the act port (`automations.follow`) while
 * it is drawn and closes it when it is not; the host follows what it names
 * and pushes it as it stands and each time it moves, so nothing here asks
 * again or keeps a clock. A stream that could not open, or broke, is heard as
 * unanswered, which the page says with Try again, which opens it anew.
 */

const UNANSWERED = { failure: AUTOMATION_CALL_FAILURE.UNANSWERED } as const;

/** What one stream is opened on: its kind, the id of what it follows, and the hearing of each push. */
function follow<View>(
  scope: { readonly kind: "workspace" | "runs"; readonly id: string },
  hear: (view: View | typeof UNANSWERED) => void,
): () => void {
  let stopped = false;
  let stream: AsyncIteratorObject<AutomationListView | AutomationRunsView> | undefined;
  const following = askAct(ACT_KIND.AUTOMATIONS_FOLLOW, scope).then(async (opened) => {
    stream = opened;
    // A stream that opened only after the page let it go is closed at once.
    if (stopped) {
      await opened.return?.(undefined);
      return;
    }
    for await (const view of opened) {
      // SAFETY: a stream of a workspace pushes its list and one of runs its runs, as the host's follow names them.
      if (!stopped) hear(view as View);
    }
  });
  following.catch(() => {
    if (!stopped) hear(UNANSWERED);
  });
  return () => {
    stopped = true;
    void stream?.return?.(undefined);
  };
}

/** One followed list or history, heard while `id` names one, with Try again, which opens it anew. */
function useFollowed<View>(
  kind: "workspace" | "runs",
  id: string | undefined,
  hear: (view: View | typeof UNANSWERED) => void,
): () => void {
  const [round, setRound] = useState(0);
  const hearNow = useRef(hear);
  hearNow.current = hear;
  useEffect(() => {
    void round;
    if (id === undefined) return;
    return follow<View>({ kind, id }, (view) => hearNow.current(view));
  }, [kind, id, round]);
  return useCallback(() => setRound((was) => was + 1), []);
}

/** A workspace's automations as pushed while the page stands. */
export function useFollowedAutomations(
  workspaceId: string | undefined,
  hear: (view: AutomationListView) => void,
): () => void {
  return useFollowed<AutomationListView>(AUTOMATION_FOLLOW.WORKSPACE, workspaceId, hear);
}

/** An automation's runs as pushed while its page stands. */
export function useFollowedRuns(
  automationId: string | undefined,
  hear: (view: AutomationRunsView) => void,
): () => void {
  return useFollowed<AutomationRunsView>(AUTOMATION_FOLLOW.RUNS, automationId, hear);
}
