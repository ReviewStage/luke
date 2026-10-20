import type {
  TasksIssueLinkAnswer,
  TasksIssueLinkParams,
  TasksIssueLinksAnswer,
  TasksIssueLinksParams,
  TasksIssueRelateAnswer,
  TasksIssueRelateParams,
  TasksIssueUnlinkAnswer,
  TasksIssueUnlinkParams,
} from "@luke/features/tasks-view";
import { Effect } from "effect";
import { TASK_ISSUE_ACT_KIND } from "../contract/index.js";
import type { ActSender } from "./base.js";
import { actPort } from "./base.js";

/**
 * task-issue-procedures.ts -- a task page's asks of the host about the issues the task links.
 *
 * The one check these procedures make is who asked: only a panel draws a
 * task's page, so every one refuses the takeover and the hidden voice
 * window, in its own sentence. What the service answers comes back as the
 * panel's own answer, or why there is none. Nothing is held here.
 */
export interface TaskIssueProceduresDependencies {
  host: {
    tasksIssueLinks(params: TasksIssueLinksParams): Effect.Effect<TasksIssueLinksAnswer>;
    tasksIssueLink(params: TasksIssueLinkParams): Effect.Effect<TasksIssueLinkAnswer>;
    tasksIssueRelate(params: TasksIssueRelateParams): Effect.Effect<TasksIssueRelateAnswer>;
    tasksIssueUnlink(params: TasksIssueUnlinkParams): Effect.Effect<TasksIssueUnlinkAnswer>;
  };
}

/** The refusal a window that draws no task's page hears, or nothing for a panel. */
function refuseUnlessPanel<E>(actor: ActSender, refused: () => E): Effect.Effect<void, E> {
  return actor.panel ? Effect.void : Effect.fail(refused());
}

export function taskIssueProcedures(dependencies: TaskIssueProceduresDependencies) {
  const { host } = dependencies;
  return {
    [TASK_ISSUE_ACT_KIND.TASK_ISSUES_READ]: actPort[TASK_ISSUE_ACT_KIND.TASK_ISSUES_READ].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        return yield* host.tasksIssueLinks(input);
      },
    ),
    [TASK_ISSUE_ACT_KIND.TASK_ISSUES_LINK]: actPort[TASK_ISSUE_ACT_KIND.TASK_ISSUES_LINK].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        return yield* host.tasksIssueLink(input);
      },
    ),
    [TASK_ISSUE_ACT_KIND.TASK_ISSUES_RELATE]: actPort[
      TASK_ISSUE_ACT_KIND.TASK_ISSUES_RELATE
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.tasksIssueRelate(input);
    }),
    [TASK_ISSUE_ACT_KIND.TASK_ISSUES_UNLINK]: actPort[
      TASK_ISSUE_ACT_KIND.TASK_ISSUES_UNLINK
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.tasksIssueUnlink(input);
    }),
  };
}
