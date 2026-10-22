/**
 * failed-runs.ts -- tells the developer in the window that a run of their own automation failed to start: the failed-tone toast whose View opens the automation, and whether the sidebar's Automations wears the failed mark.
 *
 * Main decides which failed runs the window hears (`@luke/host/agent-notices`):
 * one for each run, and only while the window is focused, the OS's
 * notification saying it while the window is behind. The toast stands for
 * the news's hold, as an agent's end does, and leaves by itself, since the
 * mark goes on saying it until the automation is opened. Main hands the window the
 * newest failed run of each of the account's own automations
 * (`AppInboxSlice.failedRuns`), and opening an automation sees its failure,
 * kept in the renderer's own storage as the folds are, so the mark stays off
 * across launches until another run of it fails. A `staged` run keeps
 * nothing, so its frames never wear a developer's choices.
 */

import type { AccountFailedRun } from "@luke/features/account-inbox-wire";
import { Schema } from "effect";
import { useEffect, useRef, useState } from "react";
import { appBridge } from "../app-bridge.js";
import { TOAST_HOLD, TOAST_TONE, useToast } from "../toast.js";
import { readKept, writeKept } from "./folded-groups.js";

/** What a failed run's toast offers, to open the run. */
const VIEW_LABEL = "View";

/** Where the failures seen are kept in the renderer's storage. */
const STORAGE_KEY = "luke.seenFailedRuns";

/** The newest failed run seen of each automation, by the automation's id. */
const storedSeen = Schema.fromJsonString(Schema.Record(Schema.String, Schema.String));

type Seen = Readonly<Record<string, string>>;

/** Where a failed run stands to be opened: the run, in its automation, in the workspace it stands in. */
export interface FailedRunPlace {
  readonly automationId: string;
  readonly runId: string;
  readonly workspaceId: string;
}

/** Says each failed run main hands the window, `view` opening that run. */
export function useFailedRunToasts(view: (place: FailedRunPlace) => void): void {
  const toast = useToast();
  // Read through a ref, because the caller hands a new closure each render
  // and the subscription is owed to the window, not to a render.
  const viewing = useRef(view);
  viewing.current = view;
  useEffect(
    () =>
      appBridge().onRunFailed(({ automationId, runId, workspaceId, words, detail }) =>
        toast({
          words,
          detail,
          waits: true,
          hold: TOAST_HOLD.NEWS,
          tone: TOAST_TONE.FAILED,
          action: {
            label: VIEW_LABEL,
            onPress: () => viewing.current({ automationId, runId, workspaceId }),
          },
        }),
      ),
    [toast],
  );
}

/**
 * Whether a run of the account's own automation in the listed workspace
 * failed since that automation was last opened on this Mac, among
 * `failedRuns`, every workspace's. The automation `opened` sees its newest
 * failure as it opens. Note that a failure is told by its run's id rather
 * than its instant, because two runs may fail within one millisecond.
 */
export function useFailedRunsMark(
  failedRuns: readonly AccountFailedRun[],
  workspaceId: string | undefined,
  opened: string | undefined,
  staged: boolean,
): boolean {
  const [seen, setSeen] = useState<Seen>(() =>
    staged ? {} : readKept(STORAGE_KEY, storedSeen, {}),
  );
  // Note that only the listed workspace's runs are seen, because an editor left open across a switch shows no other's.
  const listed = failedRuns.filter(
    (run) => workspaceId === undefined || run.workspaceId === workspaceId,
  );
  const openedRun = listed.find((run) => run.automationId === opened);
  useEffect(() => {
    if (openedRun === undefined || seen[openedRun.automationId] === openedRun.id) return;
    // Note that only the automations still failing are kept, in every workspace, because one whose failures aged out of the read has nothing left to mark.
    const next = Object.fromEntries(
      failedRuns.flatMap((run) => {
        const runId = run.automationId === openedRun.automationId ? run.id : seen[run.automationId];
        return runId === undefined ? [] : [[run.automationId, runId]];
      }),
    );
    setSeen(next);
    if (!staged) writeKept(STORAGE_KEY, storedSeen, next);
  }, [openedRun, failedRuns, seen, staged]);
  return listed.some((run) => run.automationId !== opened && seen[run.automationId] !== run.id);
}
