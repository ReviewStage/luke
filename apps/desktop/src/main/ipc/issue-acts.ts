import type {
  IssueChangeParams,
  IssueCreateParams,
  IssueIdParams,
  IssueListParams,
  IssueListView,
  IssueView,
} from "@luke/features/issue-view";
import { ACT, ACT_KIND } from "@luke/host/acts";
import type { Effect } from "effect";
import { ActRefused, type ActRows, type ActSender } from "../act-router";

/**
 * issue-acts.ts -- the Issues page's asks of the host about a workspace's issues.
 *
 * The one check this process makes is who asked: only a panel draws the
 * Issues page, so every row refuses the takeover and the hidden voice
 * window. What the service answers comes back as the panel's own answer, or
 * why there is none. Nothing is held here.
 */
export interface IssueActsDependencies {
  host: {
    issueList(params: IssueListParams): Effect.Effect<IssueListView>;
    issueRead(params: IssueIdParams): Effect.Effect<IssueView>;
    issueCreate(params: IssueCreateParams): Effect.Effect<IssueView>;
    issueChange(params: IssueChangeParams): Effect.Effect<IssueView>;
  };
}

type IssueActKind =
  | typeof ACT_KIND.ISSUES_LIST
  | typeof ACT_KIND.ISSUES_READ
  | typeof ACT_KIND.ISSUES_CREATE
  | typeof ACT_KIND.ISSUES_CHANGE;

/** The refusal a window that draws no Issues page hears, in its kind's own words. */
function refuseUnlessPanel(kind: IssueActKind, sender: ActSender): void {
  if (!sender.panel) throw new ActRefused({ message: ACT[kind].refusal });
}

export function issueActRows(dependencies: IssueActsDependencies): Pick<ActRows, IssueActKind> {
  const { host } = dependencies;
  return {
    [ACT_KIND.ISSUES_LIST]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.ISSUES_LIST, sender);
      return host.issueList(params);
    },
    [ACT_KIND.ISSUES_READ]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.ISSUES_READ, sender);
      return host.issueRead(params);
    },
    [ACT_KIND.ISSUES_CREATE]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.ISSUES_CREATE, sender);
      return host.issueCreate(params);
    },
    [ACT_KIND.ISSUES_CHANGE]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.ISSUES_CHANGE, sender);
      return host.issueChange(params);
    },
  };
}
