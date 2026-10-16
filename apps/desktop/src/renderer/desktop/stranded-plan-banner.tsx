import type { TaskSummary } from "@luke/features/task-wire";
import type { PlansControl } from "../planning/use-plans-tab";
import { strandedHome, useMovePlanDialog } from "./move-plan-dialog";
import { PlanBanner } from "./plan-banner";
import { WorkspaceCard, WorkspaceRef } from "./workspace-ref";

/**
 * stranded-plan-banner.tsx -- the plan-wide banner of a plan whose repository its own workspace cannot reach and another of the account's can: which one, and Move to it.
 *
 * Since #2524 a workspace reaches only its own GitHub installation's
 * repositories, so a plan written before then in a workspace with no GitHub
 * connected, or one on another account, still names a repository nothing
 * there can work in: an agent will not start on it and its files will not
 * open. Where another workspace the account is in reaches that repository,
 * moving the plan there is what mends it, so the plan says so before
 * anything is refused, over every tab of it (`plan-banner.tsx`), naming
 * that workspace by its tile and name, with the press that opens Move to
 * workspace (#2761) on it. The dialog is the move's confirmation and says
 * who gains the plan, since a plan moved from a workspace of the reader's own
 * into a team's is read by that team. Note that the plan is never moved
 * without the press, for that same reason. The banner stands only where the
 * menu offers the move: a plan the reader owns, not archived.
 */

/** A stranded plan's banner, drawn wherever the plan places it, and the Move dialog it opens, drawn once beside the plan. */
interface StrandedPlanNotice {
  readonly banner: React.JSX.Element | null;
  readonly dialog: React.JSX.Element | null;
}

/** The open plan's banner while it is stranded, nothing otherwise, and the dialog its press opens. */
export function useStrandedPlanBanner(
  plans: PlansControl,
  plan: TaskSummary | undefined,
): StrandedPlanNotice {
  const moving = useMovePlanDialog(plans, plan);
  const home = plan === undefined ? undefined : strandedHome(plans, plan);
  const { ask } = moving;
  if (home === undefined || ask === undefined) return { banner: null, dialog: moving.dialog };
  const personal = plans.workspaces[0]?.id === home.id;
  return {
    banner: (
      <PlanBanner action={{ label: `Move to ${home.name}`, onPress: ask }}>
        This task's repository belongs to{" "}
        <WorkspaceRef
          workspace={home}
          card={<WorkspaceCard workspace={home} personal={personal} />}
        />
      </PlanBanner>
    ),
    dialog: moving.dialog,
  };
}
