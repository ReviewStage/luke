import type {
  AnyContractProcedure,
  ContractRouterClient,
  InferContractRouterInputs,
  InferContractRouterOutputs,
} from "@orpc/contract";
import { automationActsContract } from "./automations.js";
import { factoryActsContract } from "./factory.js";
import { integrationActsContract } from "./integrations.js";
import { issueActsContract } from "./issues.js";
import type { PortActKind } from "./kinds.js";

/**
 * index.ts -- the oRPC contract of the acts a window's act port answers, keyed by act kind.
 *
 * A subpath door of its own (`@luke/host/contract`), read by the panel's act
 * door and implemented by `@luke/host/act-port`, so it and everything it
 * imports stay free of Node. The router is flat and keyed by the kind
 * itself, so a window calls a kind by the name it already spells, and a kind
 * with no procedure here cannot be called on the port at all.
 */

export { ACT_ERROR } from "./base.js";
export {
  AUTOMATION_ACT_KIND,
  FACTORY_ACT_KIND,
  INTEGRATION_ACT_KIND,
  ISSUE_ACT_KIND,
  type PortActKind,
} from "./kinds.js";

/** Every domain's procedures, one spread each, in alphabetical order. */
export const actContract = {
  ...automationActsContract,
  ...factoryActsContract,
  ...integrationActsContract,
  ...issueActsContract,
} satisfies Record<PortActKind, AnyContractProcedure>;

/** The window's typed client of the act port. */
export type ActPortClient = ContractRouterClient<typeof actContract>;

/** What one port kind takes. */
export type PortActPayload<Kind extends PortActKind> = InferContractRouterInputs<
  typeof actContract
>[Kind];

/** What one port kind answers, as it crosses the port. */
export type PortActResult<Kind extends PortActKind> = InferContractRouterOutputs<
  typeof actContract
>[Kind];

/** Whether a kind rides the act port rather than `app:act`. */
export function isPortActKind(kind: string): kind is PortActKind {
  return Object.hasOwn(actContract, kind);
}
