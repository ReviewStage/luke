/**
 * automation-words.ts -- an automation's owner and next run in the few words every place naming it says them, the Automations list's row and an automation's card, what the list says while it is read, and what deleting one asks.
 */

import { AUTOMATION_NEXT, automationNext } from "@luke/features/automation-list-model";
import {
  AUTOMATION_SCOPE,
  type AutomationScope,
  type AutomationSummary,
} from "@luke/features/automation-wire";
import { dayAndTimeText, momentText, weekdayAndTimeText } from "@luke/features/time-format";
import { CONFIRM_LOSS, type DialogQuestion } from "@luke/ui";

/** What the Automations list says to a reader while it is first read, on its page and in the frame standing while the page's code loads. */
export const READING_AUTOMATIONS = "Reading your automations…";

/** What deleting an automation asks, from its editor's ⋯ and its row's menu alike: what goes, and what stays. */
export function automationDeleteQuestion(name: string | undefined): DialogQuestion {
  return {
    title: `Delete ${name ?? "this automation"}?`,
    body: "Its schedule stops and its run history goes. Agents its runs started stay.",
    verb: "Delete",
    running: "Deleting",
    loss: CONFIRM_LOSS.IRREVERSIBLE,
  };
}

/** How near a next run is still named by its weekday alone: under a week, so no weekday stands for two days. */
const WEEKDAY_REACH_MS = 6 * 24 * 60 * 60 * 1000;

/** A run due at `at`, in a few words: within the week by its weekday, further off by its date. */
function dueText(at: number, now: number): string {
  return at - now < WEEKDAY_REACH_MS
    ? `Next ${weekdayAndTimeText(at)}`
    : `Next ${dayAndTimeText(at)}`;
}

/** When an automation runs next, in a few words; none for one an event fires, whose trigger already says when. */
export function automationNextText(automation: AutomationSummary, now: number): string | undefined {
  const next = automationNext(automation);
  switch (next.kind) {
    case AUTOMATION_NEXT.OFF:
      return "Off";
    case AUTOMATION_NEXT.EVENT:
      return undefined;
    case AUTOMATION_NEXT.UNSCHEDULED:
      return "Not scheduled";
    case AUTOMATION_NEXT.AT:
      return dueText(next.at, now);
  }
}

/** An owner as a place names it: the workspace by its name, a personal one the reader made as Only you, and one a teammate made, an admin's to see, as Personal. */
export function automationOwnerName(
  owner: AutomationScope,
  workspaceName: string | undefined,
  mine: boolean,
): string {
  if (owner === AUTOMATION_SCOPE.WORKSPACE) return workspaceName ?? "Workspace";
  return mine ? "Only you" : "Personal";
}

/**
 * An automation's line under its name in a row with no room for the owner's
 * and the next run's columns, a phone's: when it runs next, where it is set
 * to, before what fires it, so the line's end is cut rather than the time.
 * A run due in another year names its year, since the row has no hint to
 * say it whole as the wide row's column does. One turned off or waiting on an
 * event says what fires it alone, its switch saying the rest.
 */
export function automationNarrowLine(
  automation: AutomationSummary,
  trigger: string,
  now: number,
): string {
  const next = automationNext(automation);
  if (next.kind !== AUTOMATION_NEXT.AT) return trigger;
  const sameYear = new Date(next.at).getFullYear() === new Date(now).getFullYear();
  const when = sameYear ? dueText(next.at, now) : `Next ${momentText(next.at)}`;
  return `${when} · ${trigger}`;
}
