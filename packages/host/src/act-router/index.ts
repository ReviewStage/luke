import { Effect } from "effect";
import { ACT, type ActKind } from "../acts.js";
import { type HostActDependencies, type HostActKind, hostActRows } from "./host-act-rows.js";
import { ActRefused, type ActRouter, type ActRows, createActRouter } from "./router.js";

export type { HostActDependencies } from "./host-act-rows.js";
export {
  ActRefused,
  type ActRouter,
  type ActRows,
  type ActSender,
  createActRouter,
} from "./router.js";

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

/** A row per kind named, each answering its kind's own refusal and nothing else. */
type RefusedRows<Kind extends ActKind> = {
  readonly [Named in Kind]: () => Effect.Effect<never, ActRefused>;
};

/**
 * Rows for the kinds a platform cannot carry at all, each refused in its
 * kind's own sentence, as a row that cannot reach what it needs is. A shell
 * spreads these beside its few real rows into its `PlatformActRows`, so its
 * table stays total by type and a kind it never answers is still said no to
 * in words the window draws. No row reads the sender, so they fit any
 * platform's table.
 */
export function refusedRows<const Kind extends ActKind>(kinds: readonly Kind[]): RefusedRows<Kind> {
  // SAFETY: `Object.fromEntries` erases the keys, which are exactly the kinds named.
  return Object.fromEntries(
    kinds.map((kind) => [kind, () => Effect.fail(new ActRefused({ message: ACT[kind].refusal }))]),
  ) as RefusedRows<Kind>;
}

/**
 * The one act table, assembled: the host's rows beside the platform's. A
 * platform hands in the rows only it can answer (its windows, ports,
 * dialogs, and updater) and its own handle on the window that asked; each
 * kind has its row on exactly one side.
 */
export function createHostActRouter<Sender>(
  dependencies: HostActDependencies,
  platformRows: PlatformActRows<Sender>,
): ActRouter<Sender> {
  const rows: ActRows<Sender> = { ...platformRows, ...hostActRows(dependencies) };
  return createActRouter(rows);
}
