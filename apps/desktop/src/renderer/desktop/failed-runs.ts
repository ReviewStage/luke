/**
 * failed-runs.ts -- tells the developer in the window that a run of their own automation failed to start: the failed-tone toast whose View opens the automation, and whether the sidebar's Automations wears the failed mark.
 *
 * Main decides which failed runs the window hears (`@luke/host/agent-notices`):
 * one for each run, and only while the window is focused, the OS's
 * notification saying it while the window is behind. The toast stands until
 * it is dismissed or its View is pressed, as an agent's end does, and the
 * mark stands until the automation is opened. Main hands the window the
 * newest failed run of each of the account's own automations
 * (`AppInboxSlice.failedRuns`), and opening an automation sees its failure,
 * kept in the renderer's own storage as the folds are, so the mark stays off
 * across launches until another run of it fails. A `staged` run keeps
 * nothing, so its frames never wear a developer's choices.
 */

import type { AccountFailedRun } from "@luke/features/account-inbox-wire";
import { Schema } from "effect";
import { useEffect, useRef, useState } from "react";
import { TOAST_TONE, useToast } from "../toast";
import { readKept, writeKept } from "./folded-groups";

/** What a failed run's toast offers, to open its automation. */
const VIEW_LABEL = "View";

/** Where the failures seen are kept in the renderer's storage. */
const STORAGE_KEY = "luke.seenFailedRuns";

/** The instant of the newest failure seen of each automation, by its id. */
const storedSeen = Schema.fromJsonString(Schema.Record(Schema.String, Schema.Finite));

type Seen = Readonly<Record<string, number>>;

/** Says each failed run main hands the window, `view` opening its automation. */
export function useFailedRunToasts(view: (automationId: string) => void): void {
  const toast = useToast();
  // Read through a ref, because the caller hands a new closure each render
  // and the subscription is owed to the window, not to a render.
  const viewing = useRef(view);
  viewing.current = view;
  useEffect(
    () =>
      window.luke.onRunFailed(({ automationId, words, detail }) =>
        toast({
          words,
          detail,
          waits: true,
          persists: true,
          tone: TOAST_TONE.FAILED,
          action: { label: VIEW_LABEL, onPress: () => viewing.current(automationId) },
        }),
      ),
    [toast],
  );
}

/**
 * Whether a run of the account's own automation failed since that
 * automation was last opened on this Mac, among `failedRuns`, the listed
 * workspace's. The automation `opened` sees its failure as it opens.
 */
export function useFailedRunsMark(
  failedRuns: readonly AccountFailedRun[],
  opened: string | undefined,
  staged: boolean,
): boolean {
  const [seen, setSeen] = useState<Seen>(() =>
    staged ? {} : readKept(STORAGE_KEY, storedSeen, {}),
  );
  const openedRun = failedRuns.find((run) => run.automationId === opened);
  useEffect(() => {
    if (openedRun === undefined || (seen[openedRun.automationId] ?? 0) >= openedRun.failedAt) {
      return;
    }
    // Note that only the automations still failing are kept, because one whose failures aged out of the read has nothing left to mark.
    const next = Object.fromEntries(
      failedRuns.flatMap((run) => {
        const at =
          run.automationId === openedRun.automationId ? run.failedAt : seen[run.automationId];
        return at === undefined ? [] : [[run.automationId, at]];
      }),
    );
    setSeen(next);
    if (!staged) writeKept(STORAGE_KEY, storedSeen, next);
  }, [openedRun, failedRuns, seen, staged]);
  return failedRuns.some(
    (run) => run.automationId !== opened && run.failedAt > (seen[run.automationId] ?? 0),
  );
}
