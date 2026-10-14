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
  AutomationWebhookSecretParams,
} from "@sidecar/hosted/automation-view";
import type { Effect } from "effect";
import { ACT, ACT_KIND } from "#shared/messages/acts";
import { ActRefused, type ActRows, type ActSender } from "../act-router";

/**
 * automation-acts.ts -- the Automations page's acts: the panel's asks of the host about the account's automations.
 *
 * The one check this process makes is who asked: only a panel draws the
 * Automations page, so every row refuses the takeover and the hidden voice
 * window. What the service answers comes back as the panel's own answer. A
 * webhook trigger's secret, which the panel mints, passes through to the
 * host once in a write's payload and is noted nowhere; no answer carries
 * one. Nothing is held here.
 */
export interface AutomationActsDependencies {
  host: {
    automationsList(params: AutomationListParams): Effect.Effect<AutomationListView>;
    automationsCreate(params: AutomationCreateParams): Effect.Effect<AutomationView>;
    automationsChange(params: AutomationChangeParams): Effect.Effect<AutomationView>;
    automationsDelete(params: AutomationIdParams): Effect.Effect<AutomationDeletedView>;
    automationsRun(params: AutomationRunParams): Effect.Effect<AutomationRunView>;
    automationsRuns(params: AutomationIdParams): Effect.Effect<AutomationRunsView>;
    automationsWebhookSecret(params: AutomationWebhookSecretParams): Effect.Effect<AutomationView>;
  };
}

type AutomationActKind =
  | typeof ACT_KIND.AUTOMATIONS_LIST
  | typeof ACT_KIND.AUTOMATIONS_CREATE
  | typeof ACT_KIND.AUTOMATIONS_CHANGE
  | typeof ACT_KIND.AUTOMATIONS_DELETE
  | typeof ACT_KIND.AUTOMATIONS_RUN
  | typeof ACT_KIND.AUTOMATIONS_RUNS
  | typeof ACT_KIND.AUTOMATIONS_WEBHOOK_SECRET;

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
      return host.automationsList(params);
    },
    [ACT_KIND.AUTOMATIONS_CREATE]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.AUTOMATIONS_CREATE, sender);
      return host.automationsCreate(params);
    },
    [ACT_KIND.AUTOMATIONS_CHANGE]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.AUTOMATIONS_CHANGE, sender);
      return host.automationsChange(params);
    },
    [ACT_KIND.AUTOMATIONS_DELETE]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.AUTOMATIONS_DELETE, sender);
      return host.automationsDelete(params);
    },
    [ACT_KIND.AUTOMATIONS_RUN]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.AUTOMATIONS_RUN, sender);
      return host.automationsRun(params);
    },
    [ACT_KIND.AUTOMATIONS_RUNS]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.AUTOMATIONS_RUNS, sender);
      return host.automationsRuns(params);
    },
    [ACT_KIND.AUTOMATIONS_WEBHOOK_SECRET]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.AUTOMATIONS_WEBHOOK_SECRET, sender);
      return host.automationsWebhookSecret(params);
    },
  };
}
