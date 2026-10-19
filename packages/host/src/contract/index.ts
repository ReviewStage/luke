import type {
  AnyContractProcedure,
  ContractRouterClient,
  InferContractRouterInputs,
  InferContractRouterOutputs,
} from "@orpc/contract";
import { accountActsContract } from "./account.js";
import { accountAskActsContract } from "./account-asks.js";
import { issueActsContract } from "./issues.js";
import type { PortActKind } from "./kinds.js";
import { settingsActsContract } from "./settings.js";
import { workspaceActsContract } from "./workspaces.js";

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
  ACCOUNT_ACT_KIND,
  ACCOUNT_ASK_ACT_KIND,
  ISSUE_ACT_KIND,
  type PortActKind,
  SETTINGS_ACT_KIND,
  WORKSPACE_ACT_KIND,
} from "./kinds.js";
export type { SettingUpdatePayload } from "./settings.js";

/** Every domain's procedures, one spread each, in alphabetical order. */
export const actContract = {
  ...accountActsContract,
  ...accountAskActsContract,
  ...issueActsContract,
  ...settingsActsContract,
  ...workspaceActsContract,
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
