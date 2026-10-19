import type {
  AutomationChangeParams,
  AutomationCreateParams,
  AutomationDeletedView,
  AutomationIdParams,
  AutomationListParams,
  AutomationListView,
  AutomationRunParams,
  AutomationRunsView,
  AutomationRunView,
  AutomationView,
} from "@luke/features/automation-view";
import { Effect } from "effect";
import type { ActSender } from "../act-router/router.js";
import { AUTOMATION_ACT_KIND } from "../contract/index.js";
import { actPort } from "./base.js";

/**
 * automation-procedures.ts -- the Automations pages' asks of the host about the account's automations.
 *
 * The one check these procedures make is who asked: only a panel draws the
 * Automations pages, so every one refuses the takeover and the hidden voice
 * window, in its own sentence. What the service answers comes back as the
 * panel's own answer, or why there is none. Nothing is held here.
 */
export interface AutomationProceduresDependencies {
  host: {
    automationList(params: AutomationListParams): Effect.Effect<AutomationListView>;
    automationCreate(params: AutomationCreateParams): Effect.Effect<AutomationView>;
    automationChange(params: AutomationChangeParams): Effect.Effect<AutomationView>;
    automationDelete(params: AutomationIdParams): Effect.Effect<AutomationDeletedView>;
    automationRun(params: AutomationRunParams): Effect.Effect<AutomationRunView>;
    automationRuns(params: AutomationIdParams): Effect.Effect<AutomationRunsView>;
    automationNewWebhookSecret(params: AutomationIdParams): Effect.Effect<AutomationView>;
  };
}

/** The refusal a window that draws no Automations page hears, or nothing for a panel. */
function refuseUnlessPanel<E>(actor: ActSender, refused: () => E): Effect.Effect<void, E> {
  return actor.panel ? Effect.void : Effect.fail(refused());
}

export function automationProcedures(dependencies: AutomationProceduresDependencies) {
  const { host } = dependencies;
  return {
    [AUTOMATION_ACT_KIND.AUTOMATIONS_LIST]: actPort[AUTOMATION_ACT_KIND.AUTOMATIONS_LIST].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        return yield* host.automationList(input);
      },
    ),
    [AUTOMATION_ACT_KIND.AUTOMATIONS_CREATE]: actPort[
      AUTOMATION_ACT_KIND.AUTOMATIONS_CREATE
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.automationCreate(input);
    }),
    [AUTOMATION_ACT_KIND.AUTOMATIONS_CHANGE]: actPort[
      AUTOMATION_ACT_KIND.AUTOMATIONS_CHANGE
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.automationChange(input);
    }),
    [AUTOMATION_ACT_KIND.AUTOMATIONS_DELETE]: actPort[
      AUTOMATION_ACT_KIND.AUTOMATIONS_DELETE
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.automationDelete(input);
    }),
    [AUTOMATION_ACT_KIND.AUTOMATIONS_RUN]: actPort[AUTOMATION_ACT_KIND.AUTOMATIONS_RUN].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        return yield* host.automationRun(input);
      },
    ),
    [AUTOMATION_ACT_KIND.AUTOMATIONS_RUNS]: actPort[AUTOMATION_ACT_KIND.AUTOMATIONS_RUNS].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        return yield* host.automationRuns(input);
      },
    ),
    [AUTOMATION_ACT_KIND.AUTOMATIONS_NEW_WEBHOOK_SECRET]: actPort[
      AUTOMATION_ACT_KIND.AUTOMATIONS_NEW_WEBHOOK_SECRET
    ].effect(function* ({ input, context, errors }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.automationNewWebhookSecret(input);
    }),
  };
}
