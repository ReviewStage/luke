import type { IntegrationsAppSeams } from "../integrations-app.js";
import { mintIntegrationState } from "../integrations-app.js";
import { resolveHostedUserId } from "./bearer.js";
import {
  beginIntegrationSignIn,
  completeIntegrationSignIn,
  deleteIntegrationConnection,
  readIntegrationConnections,
  readIntegrationSignIn,
} from "./integration-store.js";

/**
 * integration-seams.ts -- the integrations group's seams over this deployment's real database and auth session.
 *
 * `server/integrations-app.ts` describes the endpoints; this is the one
 * place that hands them the real connection rows and the real bearer
 * resolver, so every `routes/account/integrations*` function builds the
 * group from the same wiring. Vercel Connect itself is `IntegrationConnect`,
 * which the web runtime provides.
 */
export function integrationsAppSeams(): IntegrationsAppSeams {
  return {
    resolveUserId: resolveHostedUserId,
    readConnections: readIntegrationConnections,
    readSignIn: readIntegrationSignIn,
    beginSignIn: beginIntegrationSignIn,
    completeSignIn: completeIntegrationSignIn,
    deleteConnection: deleteIntegrationConnection,
    mintState: mintIntegrationState,
    now: () => Date.now(),
  };
}
