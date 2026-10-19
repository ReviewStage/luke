/**
 * router.ts -- every implemented hosted resource, merged into the one router the web route serves.
 *
 * The seams are the deployment's: the resolvers a caller middleware reads,
 * handed in by the route so a test can hand in its own.
 */

import { type ModelsProcedureSeams, modelsProcedures } from "../accounts/models-procedures.js";
import { type MessagesProcedureSeams, messagesProcedures } from "../agents/messages-procedures.js";
import {
  type AutomationsProcedureSeams,
  automationsProcedures,
} from "../automations/automations-procedures.js";
import {
  type IntegrationsProcedureSeams,
  integrationsProcedures,
} from "../integrations/integrations-procedures.js";
import { hosted } from "./base.js";

/** What the resources ask of the deployment. */
export type HostedRouterSeams = AutomationsProcedureSeams &
  IntegrationsProcedureSeams &
  MessagesProcedureSeams &
  ModelsProcedureSeams;

/** The hosted router: one line per resource, in alphabetical order. */
export function hostedRouter(seams: HostedRouterSeams) {
  return hosted.router({
    automations: automationsProcedures(seams),
    integrations: integrationsProcedures(seams),
    messages: messagesProcedures(seams),
    models: modelsProcedures(seams),
  });
}
