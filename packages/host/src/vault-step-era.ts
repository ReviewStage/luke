/**
 * The era a hand pressed in: the vault generation standing at the press and
 * the account signed in, by address. A step on the vault's queue is offered
 * with the era of its press and begins only if that era still stands when
 * the queue reaches it, so a Save that waited behind a reconcile's round
 * trips cannot run under whoever signed in meanwhile.
 */
export interface VaultStepEra {
  readonly generation: number;
  readonly accountKey: string;
}

/**
 * Whether the era a step was pressed in still stands: the generation a
 * sign-out moves has not moved, and the account signed in now is the one
 * that pressed. A step whose era has passed does nothing and answers a
 * refusal, whatever account now stands, since the key it carries was
 * entered under another.
 */
export function vaultStepEraStands(
  pressed: VaultStepEra,
  generation: number,
  signedInAccountKey: string | undefined,
): boolean {
  return pressed.generation === generation && pressed.accountKey === signedInAccountKey;
}
