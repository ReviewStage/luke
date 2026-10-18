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
import type { Effect } from "effect";
import { ACT, ACT_KIND } from "../acts.js";
import { ActRefused, type ActRows, type ActSender } from "./router.js";

/**
 * automation-acts.ts -- the Automations pages' asks of the host about the account's automations.
 *
 * The one check these rows make is who asked: only a panel draws the
 * Automations pages, so every row refuses the takeover and the hidden voice
 * window. What the service answers comes back as the panel's own answer, or
 * why there is none. Nothing is held here.
 */
export interface AutomationActsDependencies {
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

export type AutomationActKind =
  | typeof ACT_KIND.AUTOMATIONS_LIST
  | typeof ACT_KIND.AUTOMATIONS_CREATE
  | typeof ACT_KIND.AUTOMATIONS_CHANGE
  | typeof ACT_KIND.AUTOMATIONS_DELETE
  | typeof ACT_KIND.AUTOMATIONS_RUN
  | typeof ACT_KIND.AUTOMATIONS_RUNS
  | typeof ACT_KIND.AUTOMATIONS_NEW_WEBHOOK_SECRET;

/** The refusal a window that draws no Automations page hears, in its kind's own words. */
function refuseUnlessPanel(kind: AutomationActKind, sender: ActSender): void {
  if (!sender.panel) throw new ActRefused({ message: ACT[kind].refusal });
}

export function automationActRows(
  dependencies: AutomationActsDependencies,
): Pick<ActRows, AutomationActKind> {
  const { host } = dependencies;
  return {
    [ACT_KIND.AUTOMATIONS_LIST]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.AUTOMATIONS_LIST, sender);
      return host.automationList(params);
    },
    [ACT_KIND.AUTOMATIONS_CREATE]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.AUTOMATIONS_CREATE, sender);
      return host.automationCreate(params);
    },
    [ACT_KIND.AUTOMATIONS_CHANGE]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.AUTOMATIONS_CHANGE, sender);
      return host.automationChange(params);
    },
    [ACT_KIND.AUTOMATIONS_DELETE]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.AUTOMATIONS_DELETE, sender);
      return host.automationDelete(params);
    },
    [ACT_KIND.AUTOMATIONS_RUN]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.AUTOMATIONS_RUN, sender);
      return host.automationRun(params);
    },
    [ACT_KIND.AUTOMATIONS_RUNS]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.AUTOMATIONS_RUNS, sender);
      return host.automationRuns(params);
    },
    [ACT_KIND.AUTOMATIONS_NEW_WEBHOOK_SECRET]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.AUTOMATIONS_NEW_WEBHOOK_SECRET, sender);
      return host.automationNewWebhookSecret(params);
    },
  };
}
