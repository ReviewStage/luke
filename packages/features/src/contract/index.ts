/**
 * index.ts -- the hosted service's oRPC contract, one key per resource.
 *
 * A subpath door of its own (`@luke/features/contract`), so a bundle that
 * reads the contract resolves no service code behind it.
 */

import { automationsContract } from "./automations.js";
import { integrationsContract } from "./integrations.js";
import { messagesContract } from "./messages.js";
import { modelsContract } from "./models.js";
import { tasksContract } from "./tasks.js";

export { HOSTED_ERRORS } from "./errors.js";
export { integrationStatusesReadSchema } from "./integrations.js";
export { TASK_START_STATUS } from "./tasks.js";

/** Every resource's procedures, one line each, in alphabetical order. */
export const hostedContract = {
  automations: automationsContract,
  integrations: integrationsContract,
  messages: messagesContract,
  models: modelsContract,
  plans: tasksContract,
};
