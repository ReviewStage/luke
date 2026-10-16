/**
 * automation-words.ts -- an automation's owner and next run in the few words every place naming it says them: the Automations list's row and an automation's card.
 */

import { AUTOMATION_NEXT, automationNext } from "@luke/features/automation-list-model";
import {
  AUTOMATION_SCOPE,
  type AutomationScope,
  type AutomationSummary,
} from "@luke/features/automation-wire";
import { dayAndTimeText } from "../planning/plan-time";

/** How near a next run is still named by its weekday alone: under a week, so no weekday stands for two days. */
const WEEKDAY_REACH_MS = 6 * 24 * 60 * 60 * 1000;

const WEEKDAY_AND_TIME = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  hour: "numeric",
  minute: "2-digit",
});

/** When an automation runs next, in a few words: within the week by its weekday, further off by its date. */
export function automationNextText(automation: AutomationSummary, now: number): string {
  const next = automationNext(automation);
  switch (next.kind) {
    case AUTOMATION_NEXT.OFF:
      return "Off";
    case AUTOMATION_NEXT.UNSCHEDULED:
      return "Not scheduled";
    case AUTOMATION_NEXT.AT:
      return next.at - now < WEEKDAY_REACH_MS
        ? `Next ${WEEKDAY_AND_TIME.format(next.at)}`
        : `Next ${dayAndTimeText(next.at)}`;
  }
}

/** An owner as a place names it: the workspace by its name, or Personal. */
export function automationOwnerName(
  owner: AutomationScope,
  workspaceName: string | undefined,
): string {
  return owner === AUTOMATION_SCOPE.WORKSPACE ? (workspaceName ?? "Workspace") : "Personal";
}
