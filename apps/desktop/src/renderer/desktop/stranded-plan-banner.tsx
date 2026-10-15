import type { PlanSummary } from "@luke/features/plan-wire";
import { strandedPlanHome } from "@luke/ui/planning-model";
import { FolderInputIcon } from "lucide-react";
import { useId } from "react";
import type { PlansControl } from "../planning/use-plans-tab";
import { useMovePlanDialog } from "./move-plan-dialog";

/**
 * stranded-plan-banner.tsx -- the banner over a plan whose repository its own workspace cannot reach and another of the account's can: which one, and Move to it.
 *
 * Since #2524 a workspace reaches only its own GitHub installation's
 * repositories, so a plan written before then in a workspace with no GitHub
 * connected, or one on another account, still names a repository nothing
 * there can work in: an agent will not start on it and its files will not
 * open. Where another workspace the account is in reaches that repository,
 * moving the plan there is what mends it, so the plan says so before
 * anything is refused, with the press that opens Move to workspace… (#2761)
 * on that workspace. The dialog is the move's confirmation and says who
 * gains the plan, since a plan moved from a workspace of the reader's own
 * into a team's is read by that team. Note that the plan is never moved
 * without the press, for that same reason. The banner stands only where
 * the menu offers the move: a plan the reader owns, not archived. Its
 * names stand in text alone, never an attribute, because the session
 * recording masks text and nothing else.
 */

/** The banner over a stranded plan's document; nothing over any other plan. */
export function StrandedPlanBanner({
  plans,
  plan,
}: {
  plans: PlansControl;
  plan: PlanSummary;
}): React.JSX.Element | null {
  const moving = useMovePlanDialog(plans, plan);
  const titleId = useId();
  const home = strandedPlanHome(plan, plans.workspaces);
  if (home === undefined || moving.ask === undefined || plan.repository === null) {
    return moving.dialog;
  }
  const own = plans.workspaces.find((workspace) => workspace.id === plan.workspaceId);
  return (
    <>
      <section className="document-banner stranded-plan-banner" aria-labelledby={titleId}>
        <span className="document-banner-glyph" aria-hidden="true">
          <FolderInputIcon />
        </span>
        <div className="document-banner-words">
          <p id={titleId} className="document-banner-title">
            {`This plan's repository belongs to ${home.name}`}
          </p>
          <p className="document-banner-detail">
            {`${own?.name ?? "This workspace"} can't reach ${plan.repository}, so agents can't start on it here.`}
          </p>
        </div>
        <button type="button" className="primary-button" onClick={moving.ask}>
          {`Move to ${home.name}…`}
        </button>
      </section>
      {moving.dialog}
    </>
  );
}
