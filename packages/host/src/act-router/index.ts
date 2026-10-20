import { Effect } from "effect";
import { ACT, type ActKind } from "../acts.js";
import { ActRefused, type ActRows } from "./router.js";

export {
  ActRefused,
  type ActRouter,
  type ActRows,
  type ActSender,
  createActRouter,
} from "./router.js";

/**
 * The rows a platform answers itself: every kind `app:act` still carries,
 * since the host's own acts all ride the act port. Total by type, so a kind
 * added to the vocabulary without a row does not build.
 */
export type PlatformActRows<Sender> = ActRows<Sender>;

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
