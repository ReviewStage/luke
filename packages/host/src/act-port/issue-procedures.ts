import type {
  IssueChangeParams,
  IssueCreateParams,
  IssueIdParams,
  IssueListParams,
  IssueListView,
  IssueView,
} from "@luke/features/issue-view";
import { Effect } from "effect";
import { ISSUE_ACT_KIND } from "../contract/index.js";
import { type ActSender, actPort } from "./base.js";

/**
 * issue-procedures.ts -- the Issues page's asks of the host about a workspace's issues.
 *
 * The one check these procedures make is who asked: only a panel draws the
 * Issues page, so every one refuses the takeover and the hidden voice
 * window, in its own sentence. What the service answers comes back as the
 * panel's own answer, or why there is none. Nothing is held here.
 */
export interface IssueProceduresDependencies {
  host: {
    issueList(params: IssueListParams): Effect.Effect<IssueListView>;
    issueRead(params: IssueIdParams): Effect.Effect<IssueView>;
    issueCreate(params: IssueCreateParams): Effect.Effect<IssueView>;
    issueChange(params: IssueChangeParams): Effect.Effect<IssueView>;
  };
}

/** The refusal a window that draws no Issues page hears, or nothing for a panel. */
function refuseUnlessPanel<E>(actor: ActSender, refused: () => E): Effect.Effect<void, E> {
  return actor.panel ? Effect.void : Effect.fail(refused());
}

export function issueProcedures(dependencies: IssueProceduresDependencies) {
  const { host } = dependencies;
  return {
    [ISSUE_ACT_KIND.ISSUES_LIST]: actPort[ISSUE_ACT_KIND.ISSUES_LIST].effect(function* ({
      input,
      context,
      errors,
    }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.issueList(input);
    }),
    [ISSUE_ACT_KIND.ISSUES_READ]: actPort[ISSUE_ACT_KIND.ISSUES_READ].effect(function* ({
      input,
      context,
      errors,
    }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.issueRead(input);
    }),
    [ISSUE_ACT_KIND.ISSUES_CREATE]: actPort[ISSUE_ACT_KIND.ISSUES_CREATE].effect(function* ({
      input,
      context,
      errors,
    }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.issueCreate(input);
    }),
    [ISSUE_ACT_KIND.ISSUES_CHANGE]: actPort[ISSUE_ACT_KIND.ISSUES_CHANGE].effect(function* ({
      input,
      context,
      errors,
    }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.issueChange(input);
    }),
  };
}
