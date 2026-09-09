/**
 * The nominal mark an admitted ask carries, and the one shape a signature can
 * take to say the gauntlet ran. The brand key is a module-private
 * `unique symbol`, so nothing anywhere can spell it: an object literal is
 * never an admitted value, and the whole set is entered at exactly one place
 * in the repository — the cast inside `admit()` in `@sidecar/acts`, whose job
 * is to be that place. Everything downstream of it re-shapes what it already
 * holds through {@link reshapeAdmitted}, which needs an admitted value of its
 * own to answer at all.
 *
 * It lives here, below every package that has an opinion about acts, because
 * both the act vocabulary that mints and the provider contract that demands
 * one have to name it, and the graph stays acts → session → wire.
 */

declare const ADMITTED: unique symbol;

/** A value some single admission minted, and that nothing else can write down. */
export type Admitted<Value> = Value & { readonly [ADMITTED]: true };

/**
 * Re-shapes what admission already minted into the shape the next layer takes.
 * `source` is never read: it is the proof, and requiring it is what keeps a
 * re-shape from being a way in. A caller holding no admitted value cannot call
 * this, so every admitted value in the process still descends from one
 * admission.
 */
export function reshapeAdmitted<Value>(_source: Admitted<unknown>, value: Value): Admitted<Value> {
  // SAFETY: the brand is nominal and carries no run-time field; the caller's
  // own admitted value is what stands behind the one this answers with.
  return value as Admitted<Value>;
}
