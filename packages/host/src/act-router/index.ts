import type { ActKind } from "../acts.js";
import { type HostActDependencies, type HostActKind, hostActRows } from "./host-act-rows.js";
import { type ActRouter, type ActRows, createActRouter } from "./router.js";

export type { HostActDependencies } from "./host-act-rows.js";
export {
  ActRefused,
  type ActRouter,
  type ActRows,
  type ActSender,
  createActRouter,
} from "./router.js";
export type { ClientSettingSideEffects } from "./settings-acts.js";

/**
 * The rows a platform answers itself: every kind the host's rows leave, and
 * none of theirs. Derived rather than listed, so a kind added to the
 * vocabulary with a row on neither side does not build, and a platform table
 * that carries a row for one of the host's kinds, by a spread or a whole
 * table, does not build either, so no kind is ever answered by two rows.
 */
export type PlatformActRows<Sender> = Pick<ActRows<Sender>, Exclude<ActKind, HostActKind>> & {
  readonly [Kind in HostActKind]?: never;
};

/**
 * The one act table, assembled: the host's rows beside the platform's. A
 * platform hands in the rows only it can answer (its windows, ports,
 * dialogs, and updater) and its own handle on the window that asked; each
 * kind has its row on exactly one side.
 */
export function createHostActRouter<Sender>(
  dependencies: HostActDependencies<Sender>,
  platformRows: PlatformActRows<Sender>,
): ActRouter<Sender> {
  const rows: ActRows<Sender> = { ...platformRows, ...hostActRows(dependencies) };
  return createActRouter(rows);
}
