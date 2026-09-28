import { NewPlanForm } from "./new-plan-form";
import { PLANS_PAGE } from "./planning-model";
import { MicrophoneRow, PlanDocumentView, PlanList } from "./planning-parts";
import type { PlansControl } from "./use-plans-tab";

/**
 * plans-panel.tsx -- the panel's Plans tab: the plan list, the new-plan form, or the open plan's document over its microphone row.
 *
 * One page at a time, the way the Conversation tab turns between its thread
 * and its agents. The document page holds its header and its microphone row
 * still and scrolls the document between them, inside the panel's own
 * ceiling. It does not record anything of its own: the panel's session
 * replay masks every word it draws, as it does the rest of the panel.
 */
export function PlansPanel({ control }: { control: PlansControl }): React.JSX.Element {
  if (!control.signedIn) {
    return (
      <section className="plans-view plans-signed-out">
        <p>Sign in to Luke to plan a feature.</p>
      </section>
    );
  }
  switch (control.page) {
    case PLANS_PAGE.NEW:
      return (
        <section className="plans-view">
          <NewPlanForm onStarted={control.onCancelNew} onCancel={control.onCancelNew} />
        </section>
      );
    case PLANS_PAGE.DOCUMENT:
      return (
        <section className="plans-view">
          <PlanDocumentView
            region={control.region}
            onRetry={control.onRetryDocument}
            onBack={control.onLeavePlan}
            copy={control.copy}
          />
          <MicrophoneRow status={control.status} microphone={control.microphone} />
        </section>
      );
    case PLANS_PAGE.LIST:
      return (
        <section className="plans-view">
          <PlanList
            plans={control.plans}
            activePlanId={control.activePlanId}
            failed={control.listFailed}
            onSelect={control.onSelect}
            onRetry={control.onRetryList}
            onNewPlan={control.onNewPlan}
          />
        </section>
      );
  }
}
