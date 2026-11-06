import { AUTOMATION_NEXT, automationNext } from "@repo/features/automation-list-model";
import {
  AUTOMATION_SCOPE,
  type AutomationScope,
  type AutomationSummary,
} from "@repo/features/automation-wire";
import { dayAndTimeText, momentText, weekdayAndTimeText } from "@repo/features/time-format";
import { CONFIRM_LOSS, type DialogQuestion } from "@repo/ui";

export const READING_AUTOMATIONS = "Reading your automations…";

export function automationDeleteQuestion(name: string | undefined): DialogQuestion {
  return {
    title: `Delete ${name ?? "this automation"}?`,
    body: "Its schedule stops and its run history goes. Agents its runs started stay.",
    verb: "Delete automation",
    running: "Deleting",
    loss: CONFIRM_LOSS.IRREVERSIBLE,
    replayUnmasked: true,
    titleReplayMasked: name !== undefined,
  };
}

const WEEKDAY_REACH_MS = 6 * 24 * 60 * 60 * 1000;

function dueText(at: number, now: number): string {
  return at - now < WEEKDAY_REACH_MS
    ? `Next ${weekdayAndTimeText(at)}`
    : `Next ${dayAndTimeText(at)}`;
}

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

export function automationOwnerName(
  owner: AutomationScope,
  workspaceName: string | undefined,
  mine: boolean,
): string {
  if (owner === AUTOMATION_SCOPE.WORKSPACE) return workspaceName ?? "Workspace";
  return mine ? "Only you" : "Personal";
}

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
