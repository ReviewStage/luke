import type { StoredAccount } from "@sidecar/credentials";

/**
 * The access token one call on the vault's chain may carry: the signed-in
 * account's, and only while that account is the one the call's step began
 * under, by address. The vault client reads its bearer fresh for every
 * attempt, so a step that began under one account and reached the wire after
 * another signed in reads no credential here and never travels, rather than
 * carrying the first account's key under the second's bearer; a call outside
 * any step has no account to travel as.
 */
export function vaultStepBearer(
  account: StoredAccount | undefined,
  stepAccount: string | undefined,
): string | undefined {
  if (account === undefined || stepAccount === undefined) return undefined;
  return account.email === stepAccount ? account.accessToken : undefined;
}
