/**
 * index.ts -- the hosted service's oRPC contract, one key per resource.
 *
 * A subpath door of its own (`@luke/features/contract`), so a bundle that
 * reads the contract resolves no service code behind it.
 */

import { modelsContract } from "./models.js";

export { HOSTED_ERRORS } from "./errors.js";

/** Every resource's procedures, one line each, in alphabetical order. */
export const hostedContract = {
  models: modelsContract,
};
