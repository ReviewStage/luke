import type {
  AnyContractProcedure,
  ContractRouterClient,
  InferContractRouterInputs,
  InferContractRouterOutputs,
} from "@orpc/contract";
import { issueActsContract } from "./issues.js";
import type { PortActKind } from "./kinds.js";
import { pushesContract } from "./pushes.js";

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
export { ISSUE_ACT_KIND, type PortActKind } from "./kinds.js";
export {
  PUSH,
  PUSH_GUARD,
  PUSH_METHOD,
  PUSH_PROCEDURE,
  type PushEvent,
  type PushName,
  type PushPayload,
} from "./pushes.js";

/** Every domain's procedures, one spread each, in alphabetical order. */
const actContract = {
  ...issueActsContract,
} satisfies Record<PortActKind, AnyContractProcedure>;

/**
 * Everything a window's act port answers: every act kind's procedure, and
 * beside them the stream of what main pushes the window, under a key no act
 * kind spells.
 */
export const actPortContract = {
  ...actContract,
  ...pushesContract,
};

/** The window's typed client of the act port. */
export type ActPortClient = ContractRouterClient<typeof actPortContract>;

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
