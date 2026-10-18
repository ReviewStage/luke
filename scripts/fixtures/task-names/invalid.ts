// Each name below calls the unit of work a plan; `task-names.mjs` must refuse every one.

/** A task's ⋯ menu. */
export const planGroups = ["Rename", "Archive"];

/** What a task's page hands its mentions. */
export interface PlanMentions {
  readonly taskId: string;
}
export declare function ensurePlanChannel(taskId: string): string;

/** A sidebar row of a task. */
export const PLAN_ROW = "row";

/** A task's title, in a file that is not AI Elements' Plan card. */
export const planTitle = "Teammate invitations";

/** Luke's post in a task's chat. */
export declare function runPlannerPost(words: string): void;

/** A note beside a task, which is not the New task dialog's Plan switch. */
export const planningNote = "";

/** A test's task, opened. */
export declare const openSharedPlan: string;

/** A stored key, read outside the file that keeps it. */
export const planClosed = false;

/** A chat member's task name, which is no automation run's wire key. */
export const planName = "Teammate invitations";

/** A task's board behind an allowed document word. */
export const planDocumentPlanBoard = "";
