import { resolveHostedUserId } from "../auth/bearer.js";
import {
  beginIntegrationSignIn,
  completeIntegrationSignIn,
  deleteIntegrationAccount,
  endIntegrationSignIn,
  fillIntegrationLabel,
  readIntegrationConnections,
  readIntegrationSignIn,
  renameIntegrationConnection,
} from "./integration-store.js";
import type { IntegrationsAppSeams } from "./integrations-app.js";
import { mintIntegrationState, mintIntegrationSubject } from "./integrations-app.js";

export function integrationsAppSeams(): IntegrationsAppSeams {
  return {
    resolveUserId: resolveHostedUserId,
    readConnections: readIntegrationConnections,
    readSignIn: readIntegrationSignIn,
    beginSignIn: beginIntegrationSignIn,
    completeSignIn: completeIntegrationSignIn,
    endSignIn: endIntegrationSignIn,
    deleteAccount: deleteIntegrationAccount,
    fillLabel: fillIntegrationLabel,
    renameConnection: renameIntegrationConnection,
    mintState: mintIntegrationState,
    mintSubject: mintIntegrationSubject,
    now: () => Date.now(),
  };
}
